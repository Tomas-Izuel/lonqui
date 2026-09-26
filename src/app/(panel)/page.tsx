import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { getSession } from '@/controllers/session.controller'
import { getNavItems } from '@/views/shell/nav-items'
import { HomeSearch } from '@/views/shell/home-search'

export const metadata: Metadata = { title: 'Inicio — Club Naranja y Blanco' }

/**
 * Panel inicial de este slice: búsqueda de socios grande + accesos por rol.
 * Los indicadores del día llegan en el slice 3 (route.md) — nada de
 * métrica-héroe ni tarjetas icono+título acá ni entonces.
 */
export default async function HomePage() {
  const session = await getSession()
  // No usa requirePanelAccess: para un usuario sin rol redirigiría a '/', o sea
  // a sí misma. Sin rol, el layout ya muestra "Tu usuario no tiene acceso".
  // Lo que sí hay que cubrir es la navegación del lado del cliente, donde el
  // layout no se vuelve a ejecutar.
  if (!session) redirect('/login')
  if (session.mustChangePassword) redirect('/cambiar-contrasena')
  const role = session.role
  const firstName = session.displayName?.trim().split(' ')[0]
  const shortcuts = role ? getNavItems(role).filter((item) => item.href !== '/') : []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold sm:text-2xl">{firstName ? `Hola, ${firstName}` : 'Hola'}</h1>
        <p className="text-sm text-muted-foreground">¿A quién buscás?</p>
      </div>

      <HomeSearch />

      {shortcuts.length > 0 ? (
        <nav aria-label="Accesos directos" className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {shortcuts.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-14 items-center gap-3 px-4 hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex-1 font-medium">{item.label}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
