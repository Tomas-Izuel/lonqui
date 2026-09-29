import type { Metadata } from 'next'
import { requirePanelAccess } from '@/controllers/session.controller'
import { listUsers } from '@/controllers/users.controller'
import { UsersView } from '@/views/users/users-view'

export const metadata: Metadata = { title: 'Usuarios — Lonqui' }

/**
 * Solo lectura acá: `listUsers()` ya exige `admin` (`requireRole` adentro).
 * `requirePanelAccess('admin')` propio es la sesión tipada para `currentUserId` —
 * necesaria para que la vista deshabilite las acciones sobre la fila propia.
 */
export default async function UsuariosPage() {
  const [session, users] = await Promise.all([requirePanelAccess('admin'), listUsers()])

  return <UsersView users={users} currentUserId={session.userId} />
}
