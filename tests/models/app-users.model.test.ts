import { describe, expect, it, vi, beforeEach } from 'vitest'

const fromMock = vi.fn()
const rpcMock = vi.fn()
const createClientMock = vi.fn(async () => ({ from: fromMock, rpc: rpcMock }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const {
  signInSchema,
  changePasswordSchema,
  createAppUserSchema,
  completeAppUserSchema,
  resetUserPasswordSchema,
  changeUserRoleSchema,
  setUserActiveSchema,
  upsertAppUser,
  updateAppUser,
  markPasswordReset,
  confirmPasswordChanged,
} = await import('@/models/app-users.model')
const { DomainError } = await import('@/lib/errors')

// `isInternalRedirectPath` ya no vive acá (03-review.md, blocker 1): se
// unificó en `src/lib/safe-redirect.ts`, con sus tests en
// `tests/lib/safe-redirect.test.ts`. No lo duplicamos.

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

describe('signInSchema', () => {
  it('normaliza el email a minúsculas y sin espacios', () => {
    const result = signInSchema.safeParse({ email: '  Persona@Lonqui.TEST  ', password: 'x' })
    expect(result.success).toBe(true)
    expect(result.success && result.data.email).toBe('persona@lonqui.test')
  })

  it('rechaza un email con formato inválido', () => {
    expect(signInSchema.safeParse({ email: 'no-es-email', password: 'x' }).success).toBe(false)
  })

  it('rechaza una clave desconocida (.strict())', () => {
    expect(signInSchema.safeParse({ email: 'a@b.com', password: 'x', admin: true }).success).toBe(false)
  })
})

describe('changePasswordSchema', () => {
  const BASE = { currentPassword: 'ActualPass1', newPassword: 'NuevaPass99', confirmPassword: 'NuevaPass99' }

  it('acepta cuando confirmPassword coincide y newPassword cumple la política', () => {
    expect(changePasswordSchema.safeParse(BASE).success).toBe(true)
  })

  it('rechaza cuando confirmPassword no coincide con newPassword', () => {
    const result = changePasswordSchema.safeParse({ ...BASE, confirmPassword: 'Otra123456' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path).toEqual(['confirmPassword'])
  })

  it('rechaza cuando newPassword es igual a currentPassword', () => {
    const result = changePasswordSchema.safeParse({
      ...BASE,
      newPassword: BASE.currentPassword,
      confirmPassword: BASE.currentPassword,
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path).toEqual(['newPassword'])
  })

  it('rechaza newPassword que no cumple la política (menos de 10 caracteres)', () => {
    expect(changePasswordSchema.safeParse({ ...BASE, newPassword: 'abc12', confirmPassword: 'abc12' }).success).toBe(
      false,
    )
  })
})

describe('createAppUserSchema / completeAppUserSchema', () => {
  it('rechaza un rol fuera del enum', () => {
    const result = createAppUserSchema.safeParse({ email: 'a@b.com', displayName: 'Ana', role: 'superadmin' })
    expect(result.success).toBe(false)
  })

  it('rechaza displayName de un solo carácter', () => {
    expect(createAppUserSchema.safeParse({ email: 'a@b.com', displayName: 'A', role: 'editor' }).success).toBe(false)
  })

  it('completeAppUserSchema exige userId con forma de UUID', () => {
    expect(
      completeAppUserSchema.safeParse({ userId: 'no-es-uuid', email: 'a@b.com', displayName: 'Ana', role: 'admin' })
        .success,
    ).toBe(false)
  })
})

describe('resetUserPasswordSchema / changeUserRoleSchema / setUserActiveSchema', () => {
  it('todas exigen un userId con forma de UUID', () => {
    expect(resetUserPasswordSchema.safeParse({ userId: 'x' }).success).toBe(false)
    expect(changeUserRoleSchema.safeParse({ userId: 'x', role: 'admin' }).success).toBe(false)
    expect(setUserActiveSchema.safeParse({ userId: 'x', isActive: true }).success).toBe(false)
  })

  it('setUserActiveSchema exige isActive booleano', () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    expect(setUserActiveSchema.safeParse({ userId: uuid, isActive: 'true' }).success).toBe(false)
    expect(setUserActiveSchema.safeParse({ userId: uuid, isActive: true }).success).toBe(true)
  })
})

describe('upsertAppUser / updateAppUser: traducción de errores de Postgres', () => {
  it('23505 sobre app_users_email_key -> DomainError con field email', async () => {
    fromMock.mockReturnValue({
      insert: () => Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint "app_users_email_key"' } }),
    })

    await expect(
      upsertAppUser({ userId: 'u1', email: 'dup@lonqui.test', displayName: 'X', role: 'editor', createdBy: 'admin-1' }),
    ).rejects.toMatchObject({ message: 'Ya hay un usuario con ese email', field: 'email' })
  })

  it('otro 23505 (conflicto de PK) da un DomainError genérico, no el detalle de Postgres', async () => {
    fromMock.mockReturnValue({
      insert: () => Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint "app_users_pkey"' } }),
    })

    await expect(
      upsertAppUser({ userId: 'u1', email: 'x@lonqui.test', displayName: 'X', role: 'editor', createdBy: 'admin-1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('23514 con el mensaje EXACTO del guard de auto-cambio se traduce a DomainError con ese mismo texto', async () => {
    fromMock.mockReturnValue({
      update: () => ({
        eq: () =>
          Promise.resolve({
            error: { code: '23514', message: 'No podés cambiar tu propio rol ni desactivar tu propio usuario' },
          }),
      }),
    })

    await expect(updateAppUser('u1', { role: 'consulta' })).rejects.toMatchObject({
      message: 'No podés cambiar tu propio rol ni desactivar tu propio usuario',
    })
  })

  it('23514 con el mensaje del guard de último admin también se traduce', async () => {
    fromMock.mockReturnValue({
      update: () => ({
        eq: () =>
          Promise.resolve({
            error: { code: '23514', message: 'Tiene que quedar al menos un administrador activo' },
          }),
      }),
    })

    await expect(updateAppUser('u1', { isActive: false })).rejects.toMatchObject({
      message: 'Tiene que quedar al menos un administrador activo',
    })
  })

  it('un 23514 que NO es uno de los dos mensajes conocidos NO se traduce (falla interna, no expone el texto crudo)', async () => {
    fromMock.mockReturnValue({
      update: () => ({
        eq: () => Promise.resolve({ error: { code: '23514', message: 'some_other_check_violation' } }),
      }),
    })

    const err = await updateAppUser('u1', { displayName: 'X' }).catch((e) => e)
    expect(err).not.toBeInstanceOf(DomainError)
  })

  it('sin error, no tira nada', async () => {
    fromMock.mockReturnValue({ insert: () => Promise.resolve({ error: null }) })
    await expect(
      upsertAppUser({ userId: 'u1', email: 'ok@lonqui.test', displayName: 'X', role: 'editor', createdBy: 'admin-1' }),
    ).resolves.toBeUndefined()
  })
})

describe('markPasswordReset / confirmPasswordChanged', () => {
  it('markPasswordReset envuelve el error de la RPC en un DomainError (el mensaje ya es para el usuario)', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'El usuario no existe' } })
    await expect(markPasswordReset('u1')).rejects.toMatchObject({ message: 'El usuario no existe' })
  })

  it('confirmPasswordChanged: 23514 (hash sin cambiar) -> "Elegí una contraseña distinta a la temporal"', async () => {
    rpcMock.mockResolvedValue({ error: { code: '23514', message: 'La contraseña no cambió' } })
    await expect(confirmPasswordChanged()).rejects.toMatchObject({
      message: 'Elegí una contraseña distinta a la temporal',
      field: 'newPassword',
    })
  })

  it('confirmPasswordChanged: otro código de error se relanza tal cual (falla interna)', async () => {
    rpcMock.mockResolvedValue({ error: { code: 'no_data_found', message: 'No hay un cambio de contraseña pendiente' } })
    await expect(confirmPasswordChanged()).rejects.toMatchObject({ code: 'no_data_found' })
  })

  it('sin error, no tira', async () => {
    rpcMock.mockResolvedValue({ error: null })
    await expect(confirmPasswordChanged()).resolves.toBeUndefined()
  })
})
