'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/controllers/session.controller'
import { DomainError, zodToApiError } from '@/lib/errors'
import { failure, invalid, success, type ActionResult } from '@/lib/action-result'
import { generateTemporaryPassword } from '@/lib/passwords'
import { log } from '@/lib/log'
import {
  createAppUserSchema,
  completeAppUserSchema,
  resetUserPasswordSchema,
  changeUserRoleSchema,
  setUserActiveSchema,
  getAppUser,
  getAppUserByEmail,
  upsertAppUser,
  updateAppUser,
  markPasswordReset,
} from '@/models/app-users.model'
import { createWithPassword, setPassword, ban, unban, AuthAdminError } from '@/services/auth-admin.service'

/**
 * Alta, restablecimiento, rol y actividad de usuarios internos. Todas exigen
 * `admin` (`requireRole('admin')`, re-verificado acá aunque la RLS ya cierre
 * el dominio si el rol no corresponde) y validan con Zod `.strict()` antes de
 * tocar nada: el input llega de un Server Action, así que no hay TS del otro
 * lado que garantice la forma.
 *
 * La temporal (`generateTemporaryPassword`) solo la generan estas actions,
 * nunca el modelo ni el servicio: viaja una única vez dentro del
 * `ActionResult` de éxito y no se vuelve a poder mostrar.
 */

const USERS_PATH = '/usuarios'

export async function createUser(
  input: unknown,
): Promise<ActionResult<{ userId: string; temporaryPassword: string }>> {
  try {
    const session = await requireRole('admin')

    const parsed = createAppUserSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }
    const { email, displayName, role } = parsed.data

    // Chequeo de duplicado ANTES de tocar Auth: evita crear una cuenta
    // huérfana por un email que ya tiene fila acá. La unicidad real la
    // garantiza el índice de la base (`translateAppUsersWriteError` la
    // traduce si dos altas chocan en la carrera).
    if (await getAppUserByEmail(email)) {
      throw new DomainError('Ya hay un usuario con ese email', { field: 'email' })
    }

    const temporaryPassword = generateTemporaryPassword()

    let userId: string
    try {
      const created = await createWithPassword(email, temporaryPassword)
      userId = created.userId
    } catch (err) {
      if (err instanceof AuthAdminError && err.code === 'email_exists') {
        throw new DomainError(
          'Ya existe un usuario de Auth con ese email. Revisá la lista: puede figurar como alta incompleta.',
          { field: 'email' },
        )
      }
      throw err
    }

    try {
      await upsertAppUser({ userId, email, displayName, role, createdBy: session.userId })
      await markPasswordReset(userId)
    } catch (err) {
      // Auth ya creó el usuario; la fila o el marker fallaron a mitad de
      // camino. Queda como "alta incompleta" (D8): `listUsers` la muestra
      // cruzando contra Auth, y `completeUser` la termina con una temporal
      // nueva (esta ya no se puede volver a mostrar).
      log.error('users.createUser', 'alta incompleta: Auth creado, fila o marker fallaron', err, { userId })
      throw err
    }

    revalidatePath(USERS_PATH)
    return success({ userId, temporaryPassword })
  } catch (err) {
    return failure(err, 'users.createUser')
  }
}

export async function completeUser(
  input: unknown,
): Promise<ActionResult<{ userId: string; temporaryPassword: string }>> {
  try {
    const session = await requireRole('admin')

    const parsed = completeAppUserSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }
    const { userId, email, displayName, role } = parsed.data

    if (await getAppUser(userId)) {
      throw new DomainError('Ese usuario ya tiene un alta completa')
    }

    // La temporal del intento anterior no se puede recuperar (nunca se
    // persiste en ningún lado): se genera una nueva y se pisa en Auth.
    const temporaryPassword = generateTemporaryPassword()
    await setPassword(userId, temporaryPassword)
    await upsertAppUser({ userId, email, displayName, role, createdBy: session.userId })
    await markPasswordReset(userId)

    revalidatePath(USERS_PATH)
    return success({ userId, temporaryPassword })
  } catch (err) {
    return failure(err, 'users.completeUser')
  }
}

export async function resetUserPassword(input: unknown): Promise<ActionResult<{ temporaryPassword: string }>> {
  try {
    const session = await requireRole('admin')

    const parsed = resetUserPasswordSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }
    const { userId } = parsed.data

    // Sin trigger que lo impida (a diferencia de rol/actividad): esta regla
    // es de UX, no de dominio, así que se chequea acá.
    if (userId === session.userId) {
      throw new DomainError('Para tu propia contraseña usá "Cambiar contraseña" en tu menú de usuario')
    }

    const temporaryPassword = generateTemporaryPassword()
    await setPassword(userId, temporaryPassword)
    await markPasswordReset(userId)

    revalidatePath(USERS_PATH)
    return success({ temporaryPassword })
  } catch (err) {
    return failure(err, 'users.resetUserPassword')
  }
}

export async function changeUserRole(input: unknown): Promise<ActionResult<void>> {
  try {
    await requireRole('admin')

    const parsed = changeUserRoleSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    // No puede cambiarse el propio rol ni degradar al último admin: lo
    // rechaza `private.app_users_guard()` y `updateAppUser` lo traduce a
    // `DomainError` con el mensaje que el trigger ya trae.
    await updateAppUser(parsed.data.userId, { role: parsed.data.role })

    revalidatePath(USERS_PATH)
    return success()
  } catch (err) {
    return failure(err, 'users.changeUserRole')
  }
}

export async function setUserActive(input: unknown): Promise<ActionResult<void>> {
  try {
    await requireRole('admin')

    const parsed = setUserActiveSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }
    const { userId, isActive } = parsed.data

    // Primero la fila (con sesión, auditada): RLS le cierra el dominio al
    // instante por `is_active`, sin depender de que el baneo de Auth
    // funcione. El baneo es la segunda capa, para que ni siquiera pueda
    // iniciar una sesión nueva. No puede desactivarse a sí mismo: mismo
    // trigger, misma traducción que en `changeUserRole`.
    await updateAppUser(userId, { isActive })

    if (isActive) {
      await unban(userId)
    } else {
      await ban(userId)
    }

    revalidatePath(USERS_PATH)
    return success()
  } catch (err) {
    return failure(err, 'users.setUserActive')
  }
}
