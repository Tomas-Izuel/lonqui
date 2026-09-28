import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/controllers/session.controller'
import { getDashboard } from '@/controllers/reports.controller'
import { DashboardHeader } from '@/views/dashboard/dashboard-header'
import { DashboardContent } from '@/views/dashboard/dashboard-content'
import { EmptyState } from '@/views/shared/states'

export const metadata: Metadata = { title: 'Inicio — Club Naranja y Blanco' }

/**
 * Panel inicial definitivo (F3, fase 2 — reemplaza entero el de antes, que
 * era solo buscador + accesos). Composición elegida por Tomás el
 * 2026-09-28 entre las 3 propuestas de `impeccable shape`: ver
 * `.impeccable/surfaces/route-inicio.md` (decisión y por qué) y
 * `src/views/dashboard/dashboard-content.tsx` (el contenido en sí).
 *
 * Cero data fetching en las vistas (CLAUDE.md): esta page es el único punto
 * que llama a `getSession()`/`getDashboard()`.
 *
 * NO usa `requirePanelAccess()` a propósito, mismo motivo que el inicio
 * anterior: sin rol activo, ese guard redirige a `/` — que es ESTA MISMA
 * page, un loop. Layouts de Next no se re-ejecutan en una navegación del
 * lado del cliente entre páginas hermanas, así que acá se repiten a mano
 * las verificaciones que si importan (sesión, contraseña temporal); "sin
 * rol" se resuelve mostrando el estado vacío de abajo en vez de redirigir.
 */
export default async function HomePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.mustChangePassword) redirect('/cambiar-contrasena')

  const firstName = session.displayName?.trim().split(' ')[0]
  const greeting = firstName ? `Hola, ${firstName}` : 'Hola'

  // Sin rol activo, o sin `reports.read`: nada de montos. Hoy los 3 roles
  // fijos (admin/editor/consulta) tienen `reports.read`, así que esto es
  // defensivo — pero es la regla real (T12: por permiso, no por rol) para
  // cuando existan roles configurables sin ese permiso. `getDashboard()`
  // exige `reports.read` con un redirect a `/` que acá sería el mismo loop
  // que el guard de arriba: se evita no llamándola en vez de confiar en su
  // propio chequeo.
  if (!session.role || !session.permissions.includes('reports.read')) {
    return (
      <div className="flex flex-col gap-5">
        <DashboardHeader greeting={greeting} permissions={session.permissions} />
        <EmptyState
          title="Sin indicadores para tu usuario"
          description="Tu rol no tiene acceso a los reportes del panel inicial. Buscá un socio arriba o consultá a un administrador."
        />
      </div>
    )
  }

  const data = await getDashboard()
  return <DashboardContent data={data} session={session} greeting={greeting} />
}
