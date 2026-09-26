import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { PermissionError } from '@/lib/errors'
import { getCurrentUser } from '@/lib/supabase/server'
import { getOwnAppUser } from '@/models/session.model'
import type { AppRole, SessionInfo } from '@/models/types'

/**
 * Sesión y rol del usuario, UNA vez por request.
 *
 * Esto es la re-verificación del servidor, no la defensa: la autorización real
 * son las RLS (un usuario sin rol activo ve cero filas aunque llegue acá). Pero
 * cada page y cada Server Action la llama igual, para responder claro en vez
 * de mostrar listas vacías que parecen un bug.
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const user = await getCurrentUser()
  if (!user) return null

  const appUser = await getOwnAppUser(user.id)

  return {
    userId: user.id,
    email: user.email ?? '',
    displayName: appUser?.displayName ?? null,
    // Desactivado = sin rol, igual que lo ve RLS.
    role: appUser?.isActive ? appUser.role : null,
    isActive: appUser?.isActive ?? false,
    mustChangePassword: appUser?.mustChangePassword ?? false,
  }
})

/**
 * Para pages y layouts: sin sesión, al login. `next` vuelve a donde estaba.
 * No chequea el rol ni el flag de contraseña: eso lo decide el layout del
 * panel (redirige o muestra "sin acceso").
 */
export async function requireSession(next?: string): Promise<SessionInfo> {
  const session = await getSession()
  if (!session) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  }
  return session
}

/**
 * Para los controllers de LECTURA que alimentan una page del panel. En vez de
 * tirar, redirige a donde el usuario tiene que ir.
 *
 * Existe porque los layouts de Next NO se vuelven a ejecutar al navegar del
 * lado del cliente entre páginas hermanas: el chequeo de `(panel)/layout.tsx`
 * solo corre en la carga completa. Si a alguien le restablecen la contraseña o
 * lo desactivan con la sesión abierta, su próximo click tiene que llevarlo a
 * `/cambiar-contrasena` (o fuera), no mostrarle un padrón vacío por RLS que
 * parece que se borraron los socios.
 *
 * Para Server Actions seguí usando `requireRole`: un redirect adentro del
 * try/catch de una action se tragaría como error.
 */
export async function requirePanelAccess(...roles: AppRole[]): Promise<SessionInfo & { role: AppRole }> {
  const session = await getSession()

  if (!session) redirect('/login')
  if (session.mustChangePassword) redirect('/cambiar-contrasena')
  // Sin rol activo o sin el rol pedido: al inicio, donde el layout del panel
  // muestra "Tu usuario no tiene acceso" o el panel que sí le corresponde.
  if (!session.role) redirect('/')
  if (roles.length > 0 && !roles.includes(session.role)) redirect('/')

  return session as SessionInfo & { role: AppRole }
}

/**
 * Para controllers y Server Actions. Tira `PermissionError` (403) si no hay
 * sesión, si el usuario no tiene rol activo, si tiene una contraseña temporal
 * pendiente o si su rol no está en la lista.
 *
 * La única action que NO pasa por acá es `changePassword`: la llama justamente
 * quien tiene el flag prendido, así que exige solo sesión.
 */
export async function requireRole(...roles: AppRole[]): Promise<SessionInfo & { role: AppRole }> {
  const session = await getSession()

  if (!session) {
    throw new PermissionError('Tu sesión venció. Volvé a ingresar.')
  }
  if (session.mustChangePassword) {
    throw new PermissionError('Tenés que cambiar tu contraseña antes de seguir.')
  }
  if (!session.role) {
    throw new PermissionError('Tu usuario no tiene acceso al sistema.')
  }
  if (roles.length > 0 && !roles.includes(session.role)) {
    throw new PermissionError()
  }

  return session as SessionInfo & { role: AppRole }
}
