import { getSession } from '@/controllers/session.controller'
import { AccessDenied } from '@/views/shell/access-denied'

/**
 * Sub-grupo de `/usuarios`, `/ajustes` y `/auditoria`: exige `admin`. Para
 * cuando esto se renderiza, `(panel)/layout.tsx` ya garantizó sesión, rol
 * activo y contraseña no pendiente — acá solo falta el rol específico.
 * `AccessDenied`, no `notFound()` ni las APIs experimentales de Next (D10).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()

  if (session?.role !== 'admin') {
    return <AccessDenied />
  }

  return children
}
