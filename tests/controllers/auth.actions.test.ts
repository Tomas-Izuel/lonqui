import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `auth.actions.ts`: login/logout/cambio de contraseña. Mockeamos en el
 * borde externo real (el cliente de Supabase, `requireSession`, Next
 * navigation/cache) y usamos los schemas REALES de `app-users.model.ts`
 * (`signInSchema`, `changePasswordSchema`, `isInternalRedirectPath`): son
 * lógica pura, y son justo lo que hay que probar de verdad acá.
 */

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const signInWithPasswordMock = vi.fn()
const signOutMock = vi.fn()
const updateUserMock = vi.fn()
const createClientMock = vi.fn(async () => ({
  auth: {
    signInWithPassword: signInWithPasswordMock,
    signOut: signOutMock,
    updateUser: updateUserMock,
  },
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const getAppUserMock = vi.fn()
const confirmPasswordChangedMock = vi.fn()
vi.mock('@/models/app-users.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/app-users.model')>('@/models/app-users.model')
  return {
    ...actual,
    getAppUser: getAppUserMock,
    confirmPasswordChanged: confirmPasswordChangedMock,
  }
})

const requireSessionMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({ requireSession: requireSessionMock }))

const { signIn, signOut, changePassword } = await import('@/controllers/auth.actions')

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

beforeEach(() => {
  redirectMock.mockClear()
  revalidatePathMock.mockClear()
  signInWithPasswordMock.mockReset()
  signOutMock.mockReset()
  updateUserMock.mockReset()
  createClientMock.mockClear()
  getAppUserMock.mockReset()
  confirmPasswordChangedMock.mockReset()
  requireSessionMock.mockReset()
})

describe('signIn', () => {
  it('formulario inválido (sin contraseña) devuelve un error de validación, sin tocar Auth', async () => {
    const result = await signIn(null, form({ email: 'persona@lonqui.test', password: '' }))
    expect(result.ok).toBe(false)
    expect(signInWithPasswordMock).not.toHaveBeenCalled()
  })

  it('credenciales inválidas: mensaje genérico, sin distinguir el motivo', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } })
    const result = await signIn(null, form({ email: 'persona@lonqui.test', password: 'mal' }))
    expect(result).toEqual({ ok: false, error: 'Email o contraseña incorrectos' })
  })

  it('email que no existe: EXACTAMENTE el mismo mensaje que una contraseña incorrecta', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: 'User not found' } })
    const inexistente = await signIn(null, form({ email: 'nadie@lonqui.test', password: 'x'.repeat(10) }))
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } })
    const incorrecta = await signIn(null, form({ email: 'persona@lonqui.test', password: 'y'.repeat(10) }))
    expect(inexistente).toEqual(incorrecta)
  })

  it('usuario válido pero desactivado: cierra la sesión que Auth acababa de abrir y no redirige', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    getAppUserMock.mockResolvedValue({
      userId: 'u1',
      email: 'persona@lonqui.test',
      displayName: 'Persona',
      role: 'editor',
      isActive: false,
      mustChangePassword: false,
      passwordChangedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    })

    const result = await signIn(null, form({ email: 'persona@lonqui.test', password: 'x'.repeat(10) }))

    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toMatch(/desactivado/)
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('con mustChangePassword, redirige a /cambiar-contrasena IGNORANDO next por completo', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    getAppUserMock.mockResolvedValue({
      userId: 'u1',
      email: 'persona@lonqui.test',
      displayName: 'Persona',
      role: 'admin',
      isActive: true,
      mustChangePassword: true,
      passwordChangedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    })

    await expect(
      signIn(null, form({ email: 'persona@lonqui.test', password: 'x'.repeat(10), next: '/socios' })),
    ).rejects.toThrow('REDIRECT:/cambiar-contrasena')
  })

  it('login normal (sin flag) con next interno: redirige a next', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    getAppUserMock.mockResolvedValue(null) // sin fila: mustChangePassword false por defecto

    await expect(
      signIn(null, form({ email: 'persona@lonqui.test', password: 'x'.repeat(10), next: '/socios/42' })),
    ).rejects.toThrow('REDIRECT:/socios/42')
  })

  it('next externo (protocol-relative) se ignora: redirige a /', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    getAppUserMock.mockResolvedValue(null)

    await expect(
      signIn(null, form({ email: 'persona@lonqui.test', password: 'x'.repeat(10), next: '//evil.example.com' })),
    ).rejects.toThrow('REDIRECT:/')
  })

  it('sin next, redirige a /', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    getAppUserMock.mockResolvedValue(null)

    await expect(signIn(null, form({ email: 'persona@lonqui.test', password: 'x'.repeat(10) }))).rejects.toThrow(
      'REDIRECT:/',
    )
  })
})

describe('signOut', () => {
  it('cierra la sesión y redirige al login', async () => {
    await expect(signOut()).rejects.toThrow('REDIRECT:/login')
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })
})

describe('changePassword', () => {
  function mockSession(overrides?: { mustChangePassword?: boolean; email?: string }) {
    requireSessionMock.mockResolvedValue({
      userId: 'u1',
      email: overrides?.email ?? 'persona@lonqui.test',
      displayName: 'Persona',
      role: 'admin',
      isActive: true,
      mustChangePassword: overrides?.mustChangePassword ?? false,
    })
  }

  it('confirmPassword que no coincide con newPassword: error de validación en confirmPassword, sin tocar Auth', async () => {
    mockSession()
    const result = await changePassword(
      null,
      form({ currentPassword: 'ActualPass1', newPassword: 'NuevaPass1', confirmPassword: 'OtraPass1' }),
    )
    expect(result).toEqual({ ok: false, error: 'Las contraseñas no coinciden', field: 'confirmPassword' })
    expect(signInWithPasswordMock).not.toHaveBeenCalled()
  })

  it('newPassword igual a currentPassword: error de validación SIN ir a la red (chequeo de texto, no de hash)', async () => {
    mockSession()
    const result = await changePassword(
      null,
      form({ currentPassword: 'MismaPass1', newPassword: 'MismaPass1', confirmPassword: 'MismaPass1' }),
    )
    expect(result).toEqual({
      ok: false,
      error: 'La contraseña nueva tiene que ser distinta a la actual',
      field: 'newPassword',
    })
    expect(signInWithPasswordMock).not.toHaveBeenCalled()
  })

  it('la re-autenticación con la contraseña actual falla: error en currentPassword, y NUNCA llama updateUser', async () => {
    mockSession()
    signInWithPasswordMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } })

    const result = await changePassword(
      null,
      form({ currentPassword: 'MalaPass1', newPassword: 'NuevaPass99', confirmPassword: 'NuevaPass99' }),
    )

    expect(result).toEqual({ ok: false, error: 'Tu contraseña actual no es correcta', field: 'currentPassword' })
    expect(updateUserMock).not.toHaveBeenCalled()
    expect(confirmPasswordChangedMock).not.toHaveBeenCalled()
  })

  it('updateUser informa same_password: mismo mensaje que "elegí una distinta a la temporal"', async () => {
    mockSession()
    signInWithPasswordMock.mockResolvedValue({ error: null })
    updateUserMock.mockResolvedValue({ error: { code: 'same_password', message: 'same' } })

    const result = await changePassword(
      null,
      form({ currentPassword: 'ActualPass1', newPassword: 'NuevaPass99', confirmPassword: 'NuevaPass99' }),
    )

    expect(result).toEqual({
      ok: false,
      error: 'Elegí una contraseña distinta a la temporal',
      field: 'newPassword',
    })
  })

  it('éxito con mustChangePassword prendido: llama confirmPasswordChanged y redirige a / IGNORANDO next', async () => {
    mockSession({ mustChangePassword: true })
    signInWithPasswordMock.mockResolvedValue({ error: null })
    updateUserMock.mockResolvedValue({ error: null })
    confirmPasswordChangedMock.mockResolvedValue(undefined)

    await expect(
      changePassword(
        null,
        form({
          currentPassword: 'TemporalPass1',
          newPassword: 'NuevaPass99',
          confirmPassword: 'NuevaPass99',
          next: '/socios',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/')

    expect(confirmPasswordChangedMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('éxito con mustChangePassword apagado (cambio voluntario): NO llama confirmPasswordChanged y respeta next interno', async () => {
    mockSession({ mustChangePassword: false })
    signInWithPasswordMock.mockResolvedValue({ error: null })
    updateUserMock.mockResolvedValue({ error: null })

    await expect(
      changePassword(
        null,
        form({
          currentPassword: 'ActualPass1',
          newPassword: 'NuevaPass99',
          confirmPassword: 'NuevaPass99',
          next: '/socios',
        }),
      ),
    ).rejects.toThrow('REDIRECT:/socios')

    expect(confirmPasswordChangedMock).not.toHaveBeenCalled()
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('nunca llama signOut en ningún camino de éxito (la sesión sigue viva)', async () => {
    mockSession({ mustChangePassword: true })
    signInWithPasswordMock.mockResolvedValue({ error: null })
    updateUserMock.mockResolvedValue({ error: null })
    confirmPasswordChangedMock.mockResolvedValue(undefined)

    await changePassword(
      null,
      form({ currentPassword: 'TemporalPass1', newPassword: 'NuevaPass99', confirmPassword: 'NuevaPass99' }),
    ).catch(() => {})

    expect(signOutMock).not.toHaveBeenCalled()
  })
})
