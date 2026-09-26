import 'server-only'

import { requirePanelAccess } from '@/controllers/session.controller'
import { listAppUsers } from '@/models/app-users.model'
import { listAuthUsers } from '@/services/auth-admin.service'
import type { AppUserListItem } from '@/models/types'

/**
 * `/usuarios`: cruza `app_users` con la lista de Auth para detectar altas
 * incompletas (D8) — un usuario que existe en Auth porque `createUser` llegó
 * a crearlo, pero cuya fila o marker fallaron después. Ese usuario no ve nada
 * del dominio (RLS: sin fila, sin rol efectivo), y esta lista es la única
 * forma de encontrarlo para completar el alta con `completeUser`.
 */
export async function listUsers(): Promise<AppUserListItem[]> {
  await requirePanelAccess('admin')

  const [appUsers, authUsers] = await Promise.all([listAppUsers(), listAuthUsers()])
  const knownIds = new Set(appUsers.map((user) => user.userId))

  const complete: AppUserListItem[] = appUsers.map((user) => ({ ...user, authStatus: 'ok' }))

  // Placeholders para una fila que la UI trata distinto (authStatus === 'incomplete'):
  // no hay displayName ni rol reales todavía, así que no hay que leerlos.
  const incomplete: AppUserListItem[] = authUsers
    .filter((authUser) => !knownIds.has(authUser.id))
    .map((authUser) => ({
      userId: authUser.id,
      email: authUser.email,
      displayName: '',
      role: 'consulta',
      isActive: false,
      mustChangePassword: true,
      passwordChangedAt: null,
      createdAt: '',
      authStatus: 'incomplete',
    }))

  return [...complete, ...incomplete]
}
