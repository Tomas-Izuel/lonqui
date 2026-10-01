import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { passwordPolicySchema } from '@/lib/passwords'
import { isRawPostgresMessage } from '@/models/pg-errors'
import type { Tables, TablesUpdate } from '@/lib/supabase/database.types'
import type { AppRole, AppUser } from '@/models/types'

/**
 * Usuarios internos (`app_users`) y las dos RPC de contraseña temporal (D8 en
 * el pipeline 2026-09-25-padron-roles-auditoria).
 *
 * Único lugar que habla con `app_users`, `mark_password_reset` y
 * `confirm_password_changed`. Todas las escrituras van con el cliente de
 * sesión: la auditoría de `app_users` toma el actor de `auth.uid()`, y con la
 * secret key ese valor queda null. El admin client vive aparte, en
 * `services/auth-admin.service.ts`.
 */

export const APP_ROLES = ['admin', 'editor', 'consulta'] as const satisfies readonly AppRole[]

const roleSchema = z.enum(APP_ROLES, 'Elegí un rol')

// `z.email()` valida el string tal cual llega: encadenar `.trim()` DESPUÉS no
// sirve, porque el formato ya se evaluó sobre el valor con espacios antes de
// poder limpiarlo. `.pipe()` sanea primero y valida el resultado saneado.
const emailSchema = z
  .string('Ingresá un email válido')
  .trim()
  .toLowerCase()
  .pipe(z.email('Ingresá un email válido').max(254, 'El email no puede tener más de 254 caracteres'))

const displayNameSchema = z
  .string('El nombre tiene que tener al menos 2 caracteres')
  .trim()
  .min(2, 'El nombre tiene que tener al menos 2 caracteres')
  .max(120, 'El nombre no puede tener más de 120 caracteres')

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export const signInSchema = z
  .object({
    email: emailSchema,
    password: z.string('Ingresá tu contraseña').min(1, 'Ingresá tu contraseña'),
    /** Ruta a la que volver tras loguearse; se valida que sea interna en la action. */
    next: z.string().optional(),
  })
  .strict()

export type SignInInput = z.infer<typeof signInSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string('Ingresá tu contraseña actual').min(1, 'Ingresá tu contraseña actual'),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string('Repetí la contraseña nueva').min(1, 'Repetí la contraseña nueva'),
    next: z.string().optional(),
  })
  .strict()
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    // Chequeo rápido sin ir a la red. La barrera real es `confirm_password_changed()`
    // comparando el hash en la base (ver más abajo): esta es solo la respuesta
    // inmediata cuando el texto ya es igual.
    message: 'La contraseña nueva tiene que ser distinta a la actual',
    path: ['newPassword'],
  })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const createAppUserSchema = z
  .object({
    email: emailSchema,
    displayName: displayNameSchema,
    role: roleSchema,
  })
  .strict()

export type CreateAppUserInput = z.infer<typeof createAppUserSchema>

/**
 * Termina una alta que quedó incompleta (existe en Auth, no en `app_users`):
 * el email no se vuelve a tipear, sale de la fila `incomplete` que ya
 * devolvió `listUsers` (cruzando contra `authAdmin.listAuthUsers()`).
 */
export const completeAppUserSchema = z
  .object({
    userId: z.uuid('Usuario inválido'),
    email: emailSchema,
    displayName: displayNameSchema,
    role: roleSchema,
  })
  .strict()

export type CompleteAppUserInput = z.infer<typeof completeAppUserSchema>

export const resetUserPasswordSchema = z.object({ userId: z.uuid('Usuario inválido') }).strict()

export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>

export const changeUserRoleSchema = z
  .object({ userId: z.uuid('Usuario inválido'), role: roleSchema })
  .strict()

export type ChangeUserRoleInput = z.infer<typeof changeUserRoleSchema>

export const setUserActiveSchema = z
  .object({ userId: z.uuid('Usuario inválido'), isActive: z.boolean() })
  .strict()

export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type AppUserRow = Tables<'app_users'>

function mapRow(row: AppUserRow): AppUser {
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as AppRole,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
  }
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

export async function getAppUser(userId: string): Promise<AppUser | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('app_users').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data ? mapRow(data) : null
}

/** Chequeo de duplicado antes de tocar Auth: evita crear una cuenta huérfana por un email que ya está en uso acá. */
export async function getAppUserByEmail(email: string): Promise<AppUser | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('app_users').select('*').eq('email', email).maybeSingle()
  if (error) throw error
  return data ? mapRow(data) : null
}

/** Para `listUsers` (users.controller.ts), que la cruza con `authAdmin.listAuthUsers()`. */
export async function listAppUsers(): Promise<AppUser[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('app_users').select('*').order('display_name')
  if (error) throw error
  return (data ?? []).map(mapRow)
}

// -----------------------------------------------------------------------------
// Escrituras
// -----------------------------------------------------------------------------

/**
 * Mensajes literales de `private.app_users_guard()` (migración
 * `20260925120000_foundation.sql`): auto-cambio de rol/actividad y
 * degradación del último admin activo. Si ese trigger cambia de texto, este
 * set se desincroniza — son las únicas dos formas en que un UPDATE de
 * `app_users` falla por una regla de negocio, así que se traducen puntuales a
 * `DomainError`. Cualquier otro `check_violation` (no debería pasar: Zod ya
 * valida rol y longitud de nombre antes) queda como falla interna en vez de
 * mostrar el texto crudo de una constraint.
 */
const APP_USERS_GUARD_MESSAGES = new Set([
  'No podés cambiar tu propio rol ni desactivar tu propio usuario',
  'Tiene que quedar al menos un administrador activo',
])

function translateAppUsersWriteError(err: unknown): never {
  const pgErr = err as { code?: string; message?: string } | null

  if (pgErr?.code === '23505') {
    if (pgErr.message?.includes('app_users_email_key')) {
      throw new DomainError('Ya hay un usuario con ese email', { field: 'email' })
    }
    throw new DomainError('Ese usuario ya tiene una fila de alta')
  }

  if (pgErr?.code === '23514' && pgErr.message && APP_USERS_GUARD_MESSAGES.has(pgErr.message)) {
    throw new DomainError(pgErr.message)
  }

  // CHECK declarativos (nombres autogenerados): red de seguridad si algo esquiva el Zod.
  if (pgErr?.code === '23514' && pgErr.message?.includes('app_users_display_name_check')) {
    throw new DomainError('El nombre tiene que tener al menos 2 caracteres', { field: 'displayName' })
  }
  if (pgErr?.code === '23514' && pgErr.message?.includes('app_users_role_check')) {
    throw new DomainError('Elegí un rol', { field: 'role' })
  }
  if (pgErr?.code === '23514' && pgErr.message?.includes('app_users_email_check')) {
    throw new DomainError('Ingresá un email válido', { field: 'email' })
  }

  throw err
}

export type UpsertAppUserInput = {
  userId: string
  email: string
  displayName: string
  role: AppRole
  createdBy: string
}

/**
 * A pesar del nombre (que respeta el contrato de `00-architecture.md` §7.2),
 * es un INSERT liso, no un `upsert()` de supabase-js: un upsert real emite
 * `ON CONFLICT ... DO UPDATE SET email = ..., created_by = ...`, y Postgres
 * exige privilegio de UPDATE sobre TODAS las columnas de ese SET para poder
 * planificar la sentencia — incluso cuando el conflicto no ocurre en tiempo
 * de ejecución. `authenticated` no tiene grant de UPDATE sobre `email` ni
 * `created_by` (son inmutables, §6.5): un upsert de verdad falla siempre con
 * `permission denied for table app_users`, confirmado contra la base local.
 *
 * Esta función solo se llama para un `userId` sin fila todavía (alta nueva o
 * `completeUser` tras una alta incompleta), así que el INSERT alcanza; un
 * conflicto de PK sería una carrera rarísima y se traduce igual.
 *
 * `must_change_password` no se manda: nace en `true` por el DEFAULT de la
 * columna, la única vía posible para `authenticated` (sin grant de UPDATE
 * sobre esa columna), y es exactamente lo que queremos.
 */
export async function upsertAppUser(input: UpsertAppUserInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('app_users').insert({
    user_id: input.userId,
    email: input.email,
    display_name: input.displayName,
    role: input.role,
    created_by: input.createdBy,
  })

  if (error) translateAppUsersWriteError(error)
}

export type AppUserPatch = Partial<{ displayName: string; role: AppRole; isActive: boolean }>

/** Update de columnas propias del rol/estado. `changeUserRole` y `setUserActive` la usan. */
export async function updateAppUser(userId: string, patch: AppUserPatch): Promise<void> {
  const supabase = await createClient()
  const row: TablesUpdate<'app_users'> = {}
  if (patch.displayName !== undefined) row.display_name = patch.displayName
  if (patch.role !== undefined) row.role = patch.role
  if (patch.isActive !== undefined) row.is_active = patch.isActive

  const { error } = await supabase.from('app_users').update(row).eq('user_id', userId)
  if (error) translateAppUsersWriteError(error)
}

// Mensajes de `mark_password_reset` redactados para mostrarse tal cual
// (migración 20260927120000_review_fixes). Si la función suma uno, va acá.
const PASSWORD_RESET_USER_MESSAGES: ReadonlySet<string> = new Set([
  'No tenés permiso para restablecer contraseñas',
  'El usuario no existe',
  'El usuario no tiene contraseña en Auth',
])

/**
 * RPC `mark_password_reset`: prende `must_change_password` y guarda el marker
 * del hash actual. La llama un admin (alta, restablecer contraseña) con el
 * cliente de sesión — el bootstrap es la única excepción, con `service_role`,
 * y vive en `scripts/bootstrap-admin.mjs`, no acá.
 */
export async function markPasswordReset(userId: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('mark_password_reset', { target_user_id: userId })
  if (!error) return

  // Solo son interfaz los mensajes que la función misma levanta con `raise
  // exception` (42501 sin permiso, P0002 no existe / sin contraseña). Todo lo
  // demás (un `permission denied for function` del motor, un error de red, un
  // constraint) es falla interna: sube como error, se loguea arriba y el
  // usuario ve el mensaje genérico. El `42501` crudo de Postgres tiene otro
  // texto, por eso se compara el código Y que no sea un mensaje del motor.
  if (
    (error.code === '42501' || error.code === 'P0002') &&
    !isRawPostgresMessage(error.message) &&
    PASSWORD_RESET_USER_MESSAGES.has(error.message)
  ) {
    throw new DomainError(error.message)
  }
  throw error
}

/**
 * RPC `confirm_password_changed`: apaga el flag solo si el hash de Auth
 * cambió respecto del marker. Fail-closed por diseño (D8): cualquier duda
 * deja el flag prendido.
 *
 * El `check_violation` (`23514`) es el que la función lanza cuando el hash NO
 * cambió (`'La contraseña no cambió'`): es el caso de "eligió la misma
 * contraseña de nuevo", así que se traduce al mensaje que pide el flujo de
 * `changePassword`. El otro camino posible (sin marker pendiente) no debería
 * darse nunca en el flujo normal —solo se llama cuando `mustChangePassword`
 * ya estaba prendido, que implica que hubo un `mark_password_reset` antes—,
 * así que queda como falla interna en vez de un mensaje que confundiría más
 * de lo que ayuda.
 */
export async function confirmPasswordChanged(): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('confirm_password_changed')
  if (!error) return

  if (error.code === '23514') {
    throw new DomainError('Elegí una contraseña distinta a la temporal', { field: 'newPassword' })
  }
  throw error
}
