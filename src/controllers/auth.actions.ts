'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/controllers/session.controller'
import { createClient } from '@/lib/supabase/server'
import { DomainError, zodToApiError } from '@/lib/errors'
import { failure, invalid, type ActionResult } from '@/lib/action-result'
import { isInternalRedirectPath } from '@/lib/safe-redirect'
import { signInSchema, changePasswordSchema, getAppUser, confirmPasswordChanged } from '@/models/app-users.model'

/**
 * Login/logout/cambio de contraseña. Sin flujo de mail (D8): la Fase 1 crea
 * usuarios con contraseña temporal desde `/usuarios`, no por invitación.
 *
 * Pensadas para `useActionState`: `prevState` no se usa, pero la firma
 * `(prevState, formData) => Promise<ActionResult>` es la que espera el hook.
 */

export async function signIn(prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  })

  if (!parsed.success) {
    const { body } = zodToApiError(parsed.error)
    return invalid(body.error, body.field)
  }

  const { email, password, next } = parsed.data
  let mustChangePassword = false

  try {
    const supabase = await createClient()
    // Mismo mensaje genérico para contraseña incorrecta y para un email que no
    // existe: no autenticó, no hay nada que decir sobre si esa cuenta existe.
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      throw new DomainError('Email o contraseña incorrectos')
    }

    const appUser = await getAppUser(data.user.id)

    // Acá sí autenticó: la cuenta existe y la contraseña es correcta. Recién
    // ahora es seguro decir "está desactivada" sin revelar nada por adelantado.
    if (appUser && !appUser.isActive) {
      await supabase.auth.signOut()
      throw new DomainError('Tu usuario está desactivado. Hablá con un administrador del club.')
    }

    mustChangePassword = appUser?.mustChangePassword ?? false
  } catch (err) {
    return failure(err, 'auth.signIn')
  }

  // `redirect()` tira una excepción (`NEXT_REDIRECT`): siempre fuera del
  // try/catch que termina en `failure()`, si no la atrapa como un error interno.
  revalidatePath('/', 'layout')
  redirect(mustChangePassword ? '/cambiar-contrasena' : isInternalRedirectPath(next) ? next : '/')
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function changePassword(prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  // Solo sesión, nunca `requireRole`: quien tiene `mustChangePassword` prendido
  // no tiene rol efectivo (RLS lo cierra) y necesita poder llamar esta action
  // igual para salir de ese estado.
  const session = await requireSession()

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
    next: formData.get('next') || undefined,
  })

  if (!parsed.success) {
    const { body } = zodToApiError(parsed.error)
    return invalid(body.error, body.field)
  }

  const { currentPassword, newPassword, next } = parsed.data

  try {
    const supabase = await createClient()

    // OJO (verificado contra la base local): `current_password` en
    // `updateUser` solo lo valida GoTrue si el proyecto tiene prendido
    // `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`, una env var
    // que hoy NO está seteada acá (no tiene mapeo en `config.toml`: a
    // diferencia de `secure_password_change`/REQUIRE_REAUTHENTICATION, que sí
    // lo tiene). Sin ese flag, `updateUser` cambia la contraseña sin más,
    // ignorando `current_password` en silencio — lo confirmé con un usuario
    // de prueba real contra el stack local. Por eso la verificación se hace
    // acá, re-autenticando contra Auth con la contraseña actual antes de
    // tocar nada: si el proyecto llega a prender esa env var más adelante,
    // esto sigue funcionando igual (es redundante, no conflictivo).
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: session.email,
      password: currentPassword,
    })
    if (reauthError) {
      throw new DomainError('Tu contraseña actual no es correcta', { field: 'currentPassword' })
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      current_password: currentPassword,
    })

    if (error) {
      if (error.code === 'invalid_credentials') {
        throw new DomainError('Tu contraseña actual no es correcta', { field: 'currentPassword' })
      }
      if (error.code === 'same_password') {
        // Mismo mensaje que si el marker de D8 detecta que el hash no cambió:
        // es el mismo caso de negocio ("elegiste la misma de siempre") visto
        // por dos caminos distintos (GoTrue de entrada, la RPC como red de
        // contención si por lo que sea GoTrue no lo frenó).
        throw new DomainError('Elegí una contraseña distinta a la temporal', { field: 'newPassword' })
      }
      throw error
    }

    // Sin el flag prendido (cambio voluntario desde el menú), la RPC no hace
    // falta: nadie necesita liberar nada.
    if (session.mustChangePassword) {
      await confirmPasswordChanged()
    }

    // CLAUDE.md (2026-09-25, "La sesión no vence nunca, a propósito"): nunca
    // se llama a `signOut()` acá. La sesión actual sigue siendo válida
    // después de `updateUser` — @supabase/ssr escribe las cookies nuevas con
    // `setAll` en el propio cliente de sesión de este Server Action — así que
    // la persona sigue logueada y entra directo al panel.
  } catch (err) {
    return failure(err, 'auth.changePassword')
  }

  // El layout del panel lee `mustChangePassword` de la fila propia: sin este
  // revalidate seguiría mandando a /cambiar-contrasena con el flag ya apagado
  // en la base.
  revalidatePath('/', 'layout')
  // Modo obligatorio (el flag estaba prendido antes de este cambio): siempre a
  // '/', ignorando `next`. Modo voluntario (desde el menú): respeta `next` si
  // es una ruta interna.
  redirect(!session.mustChangePassword && isInternalRedirectPath(next) ? next : '/')
}
