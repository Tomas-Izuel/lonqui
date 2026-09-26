import { ClubMark } from '@/views/shell/club-mark'
import { DesktopNavList, MobileBottomNav } from '@/views/shell/nav-list'
import { UserMenu } from '@/views/shell/user-menu'
import type { AppRole } from '@/models/types'

export type AppShellSession = {
  displayName: string
  role: AppRole
}

/**
 * El envoltorio de todo el panel: barra superior con el escudo en móvil,
 * lateral de 240px en escritorio, navegación por rol y `UserMenu`. Cero data
 * fetching: recibe la sesión ya resuelta por `(panel)/layout.tsx`.
 *
 * Mobile first (route.md): la barra inferior fija es la lectura de
 * referencia; la lateral de escritorio es la adaptación, no al revés.
 */
export function AppShell({ session, children }: { session: AppShellSession; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      {/* Salto de contenido: invisible hasta que se enfoca con el teclado (Tab). */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-lg focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-primary-foreground"
      >
        Saltar al contenido
      </a>

      {/* Escritorio: barra lateral de 240px */}
      <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:border-r md:border-sidebar-border md:bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-4">
          <ClubMark />
          <span className="truncate font-heading text-sm font-semibold">Naranja y Blanco</span>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <DesktopNavList role={session.role} />
        </div>
        <div className="border-t border-sidebar-border p-2">
          <UserMenu displayName={session.displayName} role={session.role} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Móvil: barra superior con el escudo y el usuario */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background px-4 md:hidden">
          <ClubMark size="sm" />
          <span className="truncate font-heading text-sm font-semibold">Naranja y Blanco</span>
          <div className="ml-auto">
            <UserMenu displayName={session.displayName} role={session.role} />
          </div>
        </header>

        <main id="main-content" className="flex-1 px-4 pt-4 pb-20 md:px-6 md:py-6 md:pb-6">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">{children}</div>
        </main>

        <MobileBottomNav role={session.role} />
      </div>
    </div>
  )
}
