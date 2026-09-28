import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `users.actions.ts`: alta, restablecimiento, rol y actividad de usuarios
 * internos. Todo pasa por `requireRole('admin')` primero: lo mockeamos para
 * poder simular tanto el corte (PermissionError, incluido con
 * mustChangePassword prendido, que `requireRole` ya resuelve solo) como el
 * camino feliz. Los schemas de `app-users.model.ts` corren de verdad (son
 * puros); solo mockeamos las funciones que hablan con Postgres/Auth.
 */

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const requireRoleMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({ requireRole: requireRoleMock }))

const getAppUserMock = vi.fn()
const getAppUserByEmailMock = vi.fn()
const upsertAppUserMock = vi.fn()
const updateAppUserMock = vi.fn()
const markPasswordResetMock = vi.fn()
vi.mock('@/models/app-users.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/app-users.model')>('@/models/app-users.model')
  return {
    ...actual,
    getAppUser: getAppUserMock,
    getAppUserByEmail: getAppUserByEmailMock,
    upsertAppUser: upsertAppUserMock,
    updateAppUser: updateAppUserMock,
    markPasswordReset: markPasswordResetMock,
  }
})

const createWithPasswordMock = vi.fn()
const setPasswordMock = vi.fn()
const banMock = vi.fn()
const unbanMock = vi.fn()
const getAuthUserEmailMock = vi.fn()
vi.mock('@/services/auth-admin.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/auth-admin.service')>('@/services/auth-admin.service')
  return {
    ...actual,
    createWithPassword: createWithPasswordMock,
    setPassword: setPasswordMock,
    ban: banMock,
    unban: unbanMock,
    getAuthUserEmail: getAuthUserEmailMock,
  }
})

const generateTemporaryPasswordMock = vi.fn(() => 'TempPass123X')
vi.mock('@/lib/passwords', async () => {
  const actual = await vi.importActual<typeof import('@/lib/passwords')>('@/lib/passwords')
  return { ...actual, generateTemporaryPassword: generateTemporaryPasswordMock }
})

const { createUser, completeUser, resetUserPassword, changeUserRole, setUserActive } = await import(
  '@/controllers/users.actions'
)
const { DomainError, PermissionError } = await import('@/lib/errors')
const { AuthAdminError } = await import('@/services/auth-admin.service')

const ADMIN_SESSION = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin' as const }

beforeEach(() => {
  revalidatePathMock.mockClear()
  requireRoleMock.mockReset()
  getAppUserMock.mockReset()
  getAppUserByEmailMock.mockReset()
  upsertAppUserMock.mockReset()
  updateAppUserMock.mockReset()
  markPasswordResetMock.mockReset()
  createWithPasswordMock.mockReset()
  setPasswordMock.mockReset()
  banMock.mockReset()
  unbanMock.mockReset()
  getAuthUserEmailMock.mockReset()
  generateTemporaryPasswordMock.mockClear()
  requireRoleMock.mockResolvedValue(ADMIN_SESSION)
})

describe('createUser', () => {
  it('sin admin, requireRole corta antes de tocar cualquier cosa (incluye el caso mustChangePassword)', async () => {
    requireRoleMock.mockRejectedValue(new PermissionError('Tenés que cambiar tu contraseña antes de seguir.'))
    const result = await createUser({ email: 'nuevo@lonqui.test', displayName: 'Nuevo', role: 'editor' })
    expect(result.ok).toBe(false)
    expect(getAppUserByEmailMock).not.toHaveBeenCalled()
    expect(createWithPasswordMock).not.toHaveBeenCalled()
  })

  it('email inválido: error de validación con field, sin tocar nada más', async () => {
    const result = await createUser({ email: 'no-es-email', displayName: 'Nuevo', role: 'editor' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.field).toBe('email')
    expect(getAppUserByEmailMock).not.toHaveBeenCalled()
  })

  it('rol fuera del enum: error de validación con field "role"', async () => {
    const result = await createUser({ email: 'nuevo@lonqui.test', displayName: 'Nuevo', role: 'superadmin' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.field).toBe('role')
  })

  it('email ya en app_users: DomainError ANTES de llamar a Auth', async () => {
    getAppUserByEmailMock.mockResolvedValue({ userId: 'existing' })
    const result = await createUser({ email: 'existe@lonqui.test', displayName: 'Nuevo', role: 'editor' })
    expect(result).toMatchObject({ ok: false, error: 'Ya hay un usuario con ese email', field: 'email' })
    expect(createWithPasswordMock).not.toHaveBeenCalled()
  })

  it('email ya existe en Auth pero no en app_users (alta incompleta ajena): mensaje que invita a revisar la lista', async () => {
    getAppUserByEmailMock.mockResolvedValue(null)
    createWithPasswordMock.mockRejectedValue(new AuthAdminError('ya existe', 'email_exists'))
    const result = await createUser({ email: 'huerfano@lonqui.test', displayName: 'Nuevo', role: 'editor' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/alta incompleta/)
    expect(upsertAppUserMock).not.toHaveBeenCalled()
  })

  it('flujo feliz: crea en Auth, la fila con markPasswordReset, y devuelve la temporal UNA vez', async () => {
    getAppUserByEmailMock.mockResolvedValue(null)
    createWithPasswordMock.mockResolvedValue({ userId: 'new-user-1' })
    upsertAppUserMock.mockResolvedValue(undefined)
    markPasswordResetMock.mockResolvedValue(undefined)

    const result = await createUser({ email: 'nuevo@lonqui.test', displayName: 'Nuevo Editor', role: 'editor' })

    expect(result).toEqual({ ok: true, data: { userId: 'new-user-1', temporaryPassword: 'TempPass123X' } })
    expect(createWithPasswordMock).toHaveBeenCalledWith('nuevo@lonqui.test', 'TempPass123X')
    expect(upsertAppUserMock).toHaveBeenCalledWith({
      userId: 'new-user-1',
      email: 'nuevo@lonqui.test',
      displayName: 'Nuevo Editor',
      role: 'editor',
      createdBy: '11111111-1111-4111-8111-111111111111',
    })
    expect(markPasswordResetMock).toHaveBeenCalledWith('new-user-1')
    expect(revalidatePathMock).toHaveBeenCalledWith('/usuarios')
  })

  it('si la fila o el marker fallan tras crear en Auth, el error se propaga (alta queda incompleta, no silenciosa)', async () => {
    getAppUserByEmailMock.mockResolvedValue(null)
    createWithPasswordMock.mockResolvedValue({ userId: 'new-user-2' })
    upsertAppUserMock.mockRejectedValue(new Error('boom'))

    const result = await createUser({ email: 'nuevo2@lonqui.test', displayName: 'Nuevo', role: 'editor' })
    expect(result.ok).toBe(false)
  })
})

describe('completeUser', () => {
  it('si ya tiene alta completa, rechaza sin volver a tocar Auth', async () => {
    getAppUserMock.mockResolvedValue({ userId: '33333333-3333-4333-8333-333333333333' })
    const result = await completeUser({ userId: '33333333-3333-4333-8333-333333333333', email: 'x@lonqui.test', displayName: 'Ana Prueba', role: 'editor' })
    expect(result).toMatchObject({ ok: false, error: 'Ese usuario ya tiene un alta completa' })
    expect(setPasswordMock).not.toHaveBeenCalled()
  })

  it('completa: regenera la temporal (setPassword, no createWithPassword) y termina el alta', async () => {
    getAppUserMock.mockResolvedValue(null)
    setPasswordMock.mockResolvedValue(undefined)
    upsertAppUserMock.mockResolvedValue(undefined)
    markPasswordResetMock.mockResolvedValue(undefined)
    getAuthUserEmailMock.mockResolvedValue('real@lonqui.test')

    const result = await completeUser({ userId: '44444444-4444-4444-8444-444444444444', email: 'x@lonqui.test', displayName: 'Ana Prueba', role: 'consulta' })

    expect(result).toEqual({ ok: true, data: { userId: '44444444-4444-4444-8444-444444444444', temporaryPassword: 'TempPass123X' } })
    expect(setPasswordMock).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', 'TempPass123X')
    expect(createWithPasswordMock).not.toHaveBeenCalled()
  })

  it('REGRESIÓN minor 9: el email que queda en app_users es el REAL de Auth, no el que mandó el formulario', async () => {
    // Si alguien tipeó mal el email en el formulario de "completar alta" (o
    // mandó uno distinto a propósito), la fila tiene que reflejar el email
    // real de la cuenta de Auth con la que va a entrar, no lo que puso en el
    // campo de texto: ese campo es solo para mostrar/editar en la UI.
    getAppUserMock.mockResolvedValue(null)
    setPasswordMock.mockResolvedValue(undefined)
    upsertAppUserMock.mockResolvedValue(undefined)
    markPasswordResetMock.mockResolvedValue(undefined)
    getAuthUserEmailMock.mockResolvedValue('el-de-verdad@lonqui.test')

    await completeUser({
      userId: '44444444-4444-4444-8444-444444444444',
      email: 'lo-que-tipearon-mal@lonqui.test',
      displayName: 'Ana Prueba',
      role: 'consulta',
    })

    expect(getAuthUserEmailMock).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444')
    expect(upsertAppUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'el-de-verdad@lonqui.test' }),
    )
  })
})

describe('resetUserPassword', () => {
  it('sobre uno mismo: DomainError de UX, sin llamar a Auth', async () => {
    const result = await resetUserPassword({ userId: '11111111-1111-4111-8111-111111111111' })
    expect(result).toMatchObject({
      ok: false,
      error: 'Para tu propia contraseña usá "Cambiar contraseña" en tu menú de usuario',
    })
    expect(setPasswordMock).not.toHaveBeenCalled()
  })

  it('sobre otro usuario: genera temporal, la manda a Auth y prende el flag', async () => {
    setPasswordMock.mockResolvedValue(undefined)
    markPasswordResetMock.mockResolvedValue(undefined)

    const result = await resetUserPassword({ userId: '22222222-2222-4222-8222-222222222222' })

    expect(result).toEqual({ ok: true, data: { temporaryPassword: 'TempPass123X' } })
    expect(setPasswordMock).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'TempPass123X')
    expect(markPasswordResetMock).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
  })
})

describe('changeUserRole', () => {
  it('delega en updateAppUser, que traduce el trigger de auto-cambio/último admin', async () => {
    updateAppUserMock.mockRejectedValue(new DomainError('No podés cambiar tu propio rol ni desactivar tu propio usuario'))
    const result = await changeUserRole({ userId: '11111111-1111-4111-8111-111111111111', role: 'consulta' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/propio rol/)
  })

  it('éxito: llama updateAppUser con el nuevo rol y revalida /usuarios', async () => {
    updateAppUserMock.mockResolvedValue(undefined)
    const result = await changeUserRole({ userId: '22222222-2222-4222-8222-222222222222', role: 'admin' })
    expect(result).toEqual({ ok: true, data: undefined })
    expect(updateAppUserMock).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', { role: 'admin' })
    expect(revalidatePathMock).toHaveBeenCalledWith('/usuarios')
  })
})

describe('setUserActive', () => {
  it('activar: primero la fila (updateAppUser), después unban (nunca ban)', async () => {
    updateAppUserMock.mockResolvedValue(undefined)
    unbanMock.mockResolvedValue(undefined)

    await setUserActive({ userId: '22222222-2222-4222-8222-222222222222', isActive: true })

    expect(updateAppUserMock).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', { isActive: true })
    expect(unbanMock).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    expect(banMock).not.toHaveBeenCalled()
  })

  it('desactivar: primero la fila, después ban (nunca unban)', async () => {
    updateAppUserMock.mockResolvedValue(undefined)
    banMock.mockResolvedValue(undefined)

    await setUserActive({ userId: '22222222-2222-4222-8222-222222222222', isActive: false })

    expect(updateAppUserMock).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', { isActive: false })
    expect(banMock).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    expect(unbanMock).not.toHaveBeenCalled()
  })

  it('la fila se actualiza ANTES del baneo: si el baneo falla, el dominio ya quedó cerrado por RLS', async () => {
    updateAppUserMock.mockResolvedValue(undefined)
    banMock.mockRejectedValue(new Error('Auth caído'))

    const result = await setUserActive({ userId: '22222222-2222-4222-8222-222222222222', isActive: false })

    expect(result.ok).toBe(false)
    expect(updateAppUserMock).toHaveBeenCalled() // ya se aplicó pese al error posterior
  })

  it('desactivarse a uno mismo: rechazado por el trigger, traducido a DomainError', async () => {
    updateAppUserMock.mockRejectedValue(new DomainError('No podés cambiar tu propio rol ni desactivar tu propio usuario'))
    const result = await setUserActive({ userId: '11111111-1111-4111-8111-111111111111', isActive: false })
    expect(result.ok).toBe(false)
    expect(banMock).not.toHaveBeenCalled()
  })
})
