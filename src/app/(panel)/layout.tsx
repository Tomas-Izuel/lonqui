import { headers } from 'next/headers'
import { redirect, unstable_rethrow } from 'next/navigation'
import { requireSession } from '@/controllers/session.controller'
import { countPendingPortalRequests } from '@/controllers/portal.controller'
import { log } from '@/lib/log'
import { AppShell } from '@/views/shell/app-shell'
import { NoAccessState } from '@/views/shell/no-access-state'

/**
 * Puerta de entrada al panel (D10): sin sesión → `/login?next=<ruta>`
 * (`requireSession` hace el redirect); `mustChangePassword` → redirect a
 * `/cambiar-contrasena`; con sesión pero sin rol activo → "Tu usuario no
 * tiene acceso" SIN `AppShell` (no hay nada que navegar). Esta es la
 * re-verificación del servidor, no la defensa real: eso son las RLS.
 *
 * `x-pathname` (ver `src/proxy.ts`): los layouts de Next no reciben el
 * pathname de la request (está documentado — "Layouts do not re-render on
 * navigation, so they do not access pathname"), así que viaja como header
 * desde el proxy para poder armar el `next=` del login.
 */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? undefined
  const session = await requireSession(pathname)

  if (session.mustChangePassword) {
    redirect('/cambiar-contrasena')
  }

  if (!session.role) {
    return <NoAccessState />
  }

  // Badge de Revisión en la navegación. Es decoración: si la lectura falla, el panel
  // sigue funcionando sin el número en vez de caerse entero.
  const pendingReviewCount = session.permissions.includes('portal.review')
    ? await countPendingPortalRequests().catch((err: unknown) => {
        unstable_rethrow(err)
        log.error('panel.layout.pendingReviewCount', 'no se pudo leer el conteo de Revisión', err, { userId: session.userId })
        return 0
      })
    : 0

  return (
    <AppShell
      session={{
        displayName: session.displayName ?? session.email,
        role: session.role,
        permissions: session.permissions,
        pendingReviewCount,
      }}
    >
      {children}
    </AppShell>
  )
}
