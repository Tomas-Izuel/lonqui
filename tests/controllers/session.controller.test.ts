import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `session.controller.ts` es el DAL de sesión y rol: la re-verificación del
 * servidor, no la defensa real (que son las RLS). Estos tests fijan el
 * contrato de sus dos guards, que CLAUDE.md dice que NO son intercambiables:
 * `requirePanelAccess` redirige (para pages/controllers de lectura),
 * `requireRole` tira `PermissionError` (para Server Actions, donde un redirect
 * dentro del try/catch se tragaría como error).
 *
 * Mockeamos en el borde externo real: `getCurrentUser` (lib/supabase/server)
 * y `getOwnAppUser` (models/session.model), nunca el módulo bajo test.
 */

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const getCurrentUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: getCurrentUserMock }))

const getOwnAppUserMock = vi.fn()
// `getOwnPermissions` es del pipeline de cuotas/pagos (slice 2, en paralelo):
// `getSession` ya la llama (`Promise.all`), así que sin mockearla `getSession`
// rompe acá aunque no probemos `requirePermission`/`requirePanelPermission`
// (eso lo cubre el test-engineer de ese slice). Default `[]`: ningún test de
// slice 1 depende de un permiso puntual.
const getOwnPermissionsMock = vi.fn()
vi.mock('@/models/session.model', () => ({
  getOwnAppUser: getOwnAppUserMock,
  getOwnPermissions: getOwnPermissionsMock,
}))

const { getSession, requirePanelAccess, requirePanelPermission, requirePermission, requireRole, requireSession } =
  await import('@/controllers/session.controller')
const { PermissionError, isDomainError } = await import('@/lib/errors')

function mockNoUser() {
  getCurrentUserMock.mockResolvedValue(null)
}

function mockUser(overrides?: {
  displayName?: string | null
  role?: 'admin' | 'editor' | 'consulta'
  isActive?: boolean
  mustChangePassword?: boolean
  noAppUserRow?: boolean
  permissions?: string[]
}) {
  getCurrentUserMock.mockResolvedValue({ id: 'user-1', email: 'persona@lonqui.test' })
  getOwnPermissionsMock.mockResolvedValue(overrides?.permissions ?? [])
  if (overrides?.noAppUserRow) {
    getOwnAppUserMock.mockResolvedValue(null)
    return
  }
  getOwnAppUserMock.mockResolvedValue({
    displayName: overrides?.displayName ?? 'Persona de Prueba',
    role: overrides?.role ?? 'consulta',
    isActive: overrides?.isActive ?? true,
    mustChangePassword: overrides?.mustChangePassword ?? false,
  })
}

beforeEach(() => {
  getCurrentUserMock.mockReset()
  getOwnAppUserMock.mockReset()
  getOwnPermissionsMock.mockReset()
  redirectMock.mockClear()
})

describe('getSession', () => {
  it('sin usuario de Auth, devuelve null', async () => {
    mockNoUser()
    expect(await getSession()).toBeNull()
  })

  it('usuario de Auth sin fila en app_users: role null, isActive false, sin mustChangePassword prendido', async () => {
    mockUser({ noAppUserRow: true })
    const session = await getSession()
    expect(session).toMatchObject({ userId: 'user-1', role: null, isActive: false, mustChangePassword: false })
  })

  it('usuario desactivado: role sale null aunque la fila diga is_active=false y tenga un rol guardado', async () => {
    mockUser({ role: 'admin', isActive: false })
    const session = await getSession()
    // "Desactivado = sin rol, igual que lo ve RLS" (comentario del propio archivo).
    expect(session?.role).toBeNull()
    expect(session?.isActive).toBe(false)
  })

  it('usuario activo con rol: el rol viaja tal cual', async () => {
    mockUser({ role: 'editor', isActive: true })
    const session = await getSession()
    expect(session?.role).toBe('editor')
  })

  it('mustChangePassword viaja aunque el rol efectivo sea null (RLS ya lo esconde, pero el layout necesita saberlo)', async () => {
    mockUser({ role: 'admin', isActive: true, mustChangePassword: true })
    const session = await getSession()
    expect(session?.mustChangePassword).toBe(true)
  })

  // `permissions` es del slice de cuotas/pagos (en paralelo): solo fijamos
  // acá que `getSession` los pasa tal cual desde `getOwnPermissions()`, sin
  // tocarlos. Los guards nuevos (`requirePermission`/`requirePanelPermission`)
  // los prueba el test-engineer de ese slice.
  it('permissions viaja tal cual desde getOwnPermissions()', async () => {
    mockUser({ permissions: ['members.read', 'payments.register'] })
    const session = await getSession()
    expect(session?.permissions).toEqual(['members.read', 'payments.register'])
  })

  it('sin fila de app_users o desactivado, permissions puede seguir viniendo de getOwnPermissions (fail-closed vive en el modelo, no acá)', async () => {
    mockUser({ noAppUserRow: true, permissions: [] })
    const session = await getSession()
    expect(session?.permissions).toEqual([])
  })
})

describe('requireSession', () => {
  it('sin sesión, redirige a /login', async () => {
    mockNoUser()
    await expect(requireSession()).rejects.toThrow('REDIRECT:/login')
  })

  it('sin sesión y con next, arma /login?next=<ruta> codificada', async () => {
    mockNoUser()
    await expect(requireSession('/socios/42')).rejects.toThrow('REDIRECT:/login?next=%2Fsocios%2F42')
  })

  it('con sesión, la devuelve sin importar el rol ni el flag de contraseña', async () => {
    mockUser({ mustChangePassword: true, noAppUserRow: true })
    const session = await requireSession()
    expect(session.userId).toBe('user-1')
  })
})

describe('requirePanelAccess', () => {
  it('sin sesión, redirige a /login', async () => {
    mockNoUser()
    await expect(requirePanelAccess()).rejects.toThrow('REDIRECT:/login')
  })

  it('con mustChangePassword prendido, redirige a /cambiar-contrasena ANTES de mirar el rol', async () => {
    mockUser({ role: 'admin', mustChangePassword: true })
    await expect(requirePanelAccess('admin')).rejects.toThrow('REDIRECT:/cambiar-contrasena')
  })

  it('sesión sin rol activo, redirige al inicio (no tira ni deja pasar)', async () => {
    mockUser({ noAppUserRow: true })
    await expect(requirePanelAccess()).rejects.toThrow('REDIRECT:/')
  })

  it('con rol activo pero fuera de la lista pedida, redirige al inicio', async () => {
    mockUser({ role: 'consulta', isActive: true })
    await expect(requirePanelAccess('admin')).rejects.toThrow('REDIRECT:/')
  })

  it('con el rol pedido, deja pasar y devuelve la sesión', async () => {
    mockUser({ role: 'admin', isActive: true })
    const session = await requirePanelAccess('admin', 'editor')
    expect(session.role).toBe('admin')
  })

  it('sin roles pedidos (cualquier rol activo alcanza), deja pasar', async () => {
    mockUser({ role: 'consulta', isActive: true })
    const session = await requirePanelAccess()
    expect(session.role).toBe('consulta')
  })
})

describe('requireRole', () => {
  it('sin sesión, tira PermissionError (nunca redirige: se tragaría en un try/catch de Server Action)', async () => {
    mockNoUser()
    await expect(requireRole('admin')).rejects.toBeInstanceOf(PermissionError)
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('con mustChangePassword prendido, tira PermissionError ANTES de mirar el rol, incluso para un admin', async () => {
    mockUser({ role: 'admin', isActive: true, mustChangePassword: true })
    await expect(requireRole('admin')).rejects.toBeInstanceOf(PermissionError)
  })

  it('con mustChangePassword prendido, el mensaje explica que hay que cambiar la contraseña', async () => {
    mockUser({ role: 'admin', isActive: true, mustChangePassword: true })
    await expect(requireRole('admin')).rejects.toThrow('Tenés que cambiar tu contraseña antes de seguir.')
  })

  it('sin rol activo (desactivado o sin fila), tira PermissionError', async () => {
    mockUser({ noAppUserRow: true })
    await expect(requireRole()).rejects.toBeInstanceOf(PermissionError)
  })

  it('con rol activo pero fuera de la lista pedida, tira PermissionError genérico (403)', async () => {
    mockUser({ role: 'editor', isActive: true })
    const err = await requireRole('admin').catch((e) => e)
    expect(isDomainError(err)).toBe(true)
    expect(err.status).toBe(403)
  })

  it('con el rol pedido, devuelve la sesión sin tirar', async () => {
    mockUser({ role: 'admin', isActive: true })
    const session = await requireRole('admin')
    expect(session.role).toBe('admin')
  })

  it('sin roles pedidos, cualquier rol activo alcanza (uso: requireRole() para "cualquiera con acceso")', async () => {
    mockUser({ role: 'consulta', isActive: true })
    await expect(requireRole()).resolves.toMatchObject({ role: 'consulta' })
  })
})

// -----------------------------------------------------------------------------
// Guards por PERMISO (pipeline 2026-09-27-cuotas-pagos-panel, T12/§6.8):
// `requirePermission` (Server Actions, tira) y `requirePanelPermission`
// (pages/controllers de lectura, redirige). Las cuatro condiciones de
// `requireRole`/`requirePanelAccess` (sesión, mustChangePassword, rol activo)
// corren PRIMERO, después se exige que `session.permissions` incluya TODOS
// los permisos pedidos.
// -----------------------------------------------------------------------------

describe('requirePermission', () => {
  it('con los permisos de editor (payments.register, sin payments.void), pedir payments.void tira PermissionError', async () => {
    mockUser({ role: 'editor', isActive: true, permissions: ['payments.register', 'members.read'] })
    const err = await requirePermission('payments.void').catch((e) => e)
    expect(err).toBeInstanceOf(PermissionError)
  })

  it('con los permisos de admin (todos), pedir payments.void pasa y devuelve la sesión', async () => {
    mockUser({ role: 'admin', isActive: true, permissions: ['payments.register', 'payments.void', 'billing.configure'] })
    const session = await requirePermission('payments.void')
    expect(session.role).toBe('admin')
  })

  it('pedir varios permisos: falta uno solo ya alcanza para tirar', async () => {
    mockUser({ role: 'editor', isActive: true, permissions: ['payments.register'] })
    await expect(requirePermission('payments.register', 'payments.void')).rejects.toBeInstanceOf(PermissionError)
  })

  it('pedir varios permisos y tener todos: pasa', async () => {
    mockUser({ role: 'admin', isActive: true, permissions: ['payments.register', 'payments.void'] })
    await expect(requirePermission('payments.register', 'payments.void')).resolves.toMatchObject({ role: 'admin' })
  })

  it('sin sesión, tira PermissionError sin llegar a mirar los permisos', async () => {
    mockNoUser()
    await expect(requirePermission('payments.void')).rejects.toBeInstanceOf(PermissionError)
  })

  it('con mustChangePassword prendido, tira ANTES de mirar los permisos aunque la sesión traiga todos', async () => {
    mockUser({ role: 'admin', isActive: true, mustChangePassword: true, permissions: ['payments.void'] })
    await expect(requirePermission('payments.void')).rejects.toBeInstanceOf(PermissionError)
  })

  it('sin rol activo, tira aunque permissions traiga algo (no debería pasar en la práctica, pero no es la fuente de la verdad)', async () => {
    mockUser({ noAppUserRow: true, permissions: ['payments.void'] })
    await expect(requirePermission('payments.void')).rejects.toBeInstanceOf(PermissionError)
  })

  it('sin permisos pedidos, cualquier sesión con rol activo alcanza', async () => {
    mockUser({ role: 'consulta', isActive: true, permissions: [] })
    await expect(requirePermission()).resolves.toMatchObject({ role: 'consulta' })
  })
})

describe('requirePanelPermission', () => {
  it('con los permisos de editor, pedir billing.configure redirige al inicio', async () => {
    mockUser({ role: 'editor', isActive: true, permissions: ['payments.register'] })
    await expect(requirePanelPermission('billing.configure')).rejects.toThrow('REDIRECT:/')
  })

  it('con billing.configure (admin), pasa y devuelve la sesión', async () => {
    mockUser({ role: 'admin', isActive: true, permissions: ['billing.configure'] })
    const session = await requirePanelPermission('billing.configure')
    expect(session.role).toBe('admin')
  })

  it('sin sesión, redirige a /login (no a /, y sin mirar permisos)', async () => {
    mockNoUser()
    await expect(requirePanelPermission('reports.read')).rejects.toThrow('REDIRECT:/login')
  })

  it('con mustChangePassword prendido, redirige a /cambiar-contrasena antes de mirar permisos', async () => {
    mockUser({ role: 'admin', isActive: true, mustChangePassword: true, permissions: ['reports.read'] })
    await expect(requirePanelPermission('reports.read')).rejects.toThrow('REDIRECT:/cambiar-contrasena')
  })

  it('sin rol activo, redirige al inicio', async () => {
    mockUser({ noAppUserRow: true, permissions: ['reports.read'] })
    await expect(requirePanelPermission('reports.read')).rejects.toThrow('REDIRECT:/')
  })

  it('pedir varios permisos: falta uno solo ya redirige', async () => {
    mockUser({ role: 'editor', isActive: true, permissions: ['payments.read'] })
    await expect(requirePanelPermission('payments.read', 'payments.void')).rejects.toThrow('REDIRECT:/')
  })
})

describe('getSession: fail-closed de permissions ante un error de lectura', () => {
  it('con getOwnPermissions devolviendo [] (la fail-closed real vive en el modelo), la sesión queda con permissions: [] sin que el controller reintente ni la complete', async () => {
    // `getOwnPermissions` (models/session.model.ts) ya documenta que ante
    // CUALQUIER error de lectura de `my_permissions()` devuelve `[]`: acá se
    // confirma que `getSession` no hace nada más que pasarlo tal cual (ni
    // asume un default distinto, ni lo completa con algo derivado del rol).
    mockUser({ role: 'admin', isActive: true, permissions: [] })
    const session = await getSession()
    expect(session?.permissions).toEqual([])
    // Con permissions: [], ningún requirePermission puede pasar aunque el rol sea admin.
    await expect(requirePermission('billing.configure')).rejects.toBeInstanceOf(PermissionError)
  })
})
