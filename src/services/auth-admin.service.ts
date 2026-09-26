import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Adapter sobre la Admin API de Auth. Única puerta a `createAdminClient()` en
 * este slice: todo lo que necesita crear, banear o listar usuarios de Auth
 * pasa por acá, nunca directo. Las escrituras de dominio (`app_users`) siguen
 * yendo con el cliente de sesión desde `app-users.model.ts`: acá solo vive lo
 * que la Admin API exige (no hay usuario logueado detrás de "crear a otro
 * usuario").
 *
 * Los errores se re-lanzan como `AuthAdminError` con el `code` que manda
 * GoTrue (p. ej. `email_exists`), para que quien llama pueda decidir si es un
 * caso de negocio traducible o un fallo interno.
 */

export class AuthAdminError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AuthAdminError'
    this.code = code
  }
}

/** Crea el usuario de Auth con la temporal. `email_confirm: true`: sin mail, no hay nada que confirmar. */
export async function createWithPassword(email: string, password: string): Promise<{ userId: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error || !data.user) {
    throw new AuthAdminError(error?.message ?? 'No pudimos crear el usuario en Auth', error?.code)
  }

  return { userId: data.user.id }
}

/** Restablecer contraseña (admin) y completar una alta incompleta usan esta misma vía. */
export async function setPassword(userId: string, password: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) throw new AuthAdminError(error.message, error.code)
}

/**
 * `876000h` (100 años) es el valor que documenta la propia librería para un
 * baneo indefinido: no existe un "para siempre" literal en el formato de
 * `ban_duration` (solo ns/us/ms/s/m/h).
 */
const PERMANENT_BAN_DURATION = '876000h'

export async function ban(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: PERMANENT_BAN_DURATION })
  if (error) throw new AuthAdminError(error.message, error.code)
}

export async function unban(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
  if (error) throw new AuthAdminError(error.message, error.code)
}

/**
 * Todos los usuarios de Auth, paginado hasta agotar. `listUsers` (el
 * controller) los cruza contra `app_users` para detectar altas incompletas.
 * Con el tamaño de este club (unos pocos usuarios internos) esto nunca supera
 * una página, pero se pagina igual: es gratis y evita un techo silencioso el
 * día que la Comisión crezca.
 */
export async function listAuthUsers(): Promise<{ id: string; email: string }[]> {
  const admin = createAdminClient()
  const perPage = 200
  const result: { id: string; email: string }[] = []
  let page = 1

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new AuthAdminError(error.message, error.code)

    for (const user of data.users) {
      if (user.email) result.push({ id: user.id, email: user.email })
    }

    if (!data.nextPage) break
    page = data.nextPage
  }

  return result
}
