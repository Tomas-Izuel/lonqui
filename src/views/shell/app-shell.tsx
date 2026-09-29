import { Suspense, ViewTransition } from 'react'
import { ClubMark } from '@/views/shell/club-mark'
import { DesktopNavList, MobileBottomNav } from '@/views/shell/nav-list'
import { UserMenu } from '@/views/shell/user-menu'
import { PanelSessionProvider } from '@/views/shell/panel-session'
import { PaymentOverlayHost } from '@/views/payments/payment-overlay-host'
import { MemberQuickViewSheet } from '@/views/members/member-quick-view-sheet'
import type { AppRole, Permission } from '@/models/types'

export type AppShellSession = {
  displayName: string
  role: AppRole
  permissions: Permission[]
}

/**
 * El envoltorio de todo el panel: barra superior con el escudo en móvil,
 * lateral de 240px en escritorio, navegación por rol y `UserMenu`. Cero data
 * fetching: recibe la sesión ya resuelta por `(panel)/layout.tsx`.
 *
 * Mobile first (route.md): la barra inferior fija es la lectura de
 * referencia; la lateral de escritorio es la adaptación, no al revés.
 *
 * Superficies sobre el lienzo (`--canvas`, pipeline 2026-09-28): la barra
 * superior y la inferior son blancas translúcidas con blur — se despegan del
 * contenido que pasa debajo sin tapar la identidad plana del sistema; la
 * lateral de escritorio es blanca opaca con un borde de 1px, para que se lea
 * como superficie distinta del lienzo gris (antes usaba `--sidebar`, un gris
 * casi idéntico al lienzo nuevo — ya no alcanza para "despegarse").
 */
export function AppShell({ session, children }: { session: AppShellSession; children: React.ReactNode }) {
  return (
    <PanelSessionProvider permissions={session.permissions}>
      {/*
        Móvil (`< md`): sin cambios — la página entera scrollea con el
        documento (el `<body>`), con la barra superior `sticky` y la inferior
        `fixed`. Es a propósito: en iOS, la barra de direcciones solo se
        colapsa al hacer scroll con el documento, no un contenedor interno —
        forzar un scroll contenido en el celular perdería ese espacio.
        Escritorio (`md+`, `md:h-dvh md:overflow-hidden`): el documento deja
        de scrollear — el layout ocupa exactamente el viewport y el scroll
        vive en la columna de contenido, para que la lateral quede fija.
      */}
      <div className="min-h-dvh md:flex md:h-dvh md:overflow-hidden">
        {/* Salto de contenido: invisible hasta que se enfoca con el teclado (Tab). */}
        <a
          href="#main-content"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-lg focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-primary-foreground"
        >
          Saltar al contenido
        </a>

        {/*
          Escritorio: barra lateral de 240px, blanca con borde — superficie
          propia contra el lienzo. `md:h-dvh` fija su alto al viewport (no al
          contenido) y NUNCA scrollea: la navegación son 5-6 destinos como
          mucho, siempre entran. `min-h-0` en el bloque de navegación es lo
          que evita que un flex item con `flex-1` empuje al menú de usuario
          fuera de vista si algún día no entrara (el mínimo por defecto de un
          flex item es `auto`, no `0`).
        */}
        <aside className="hidden md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-border md:bg-card">
          <div className="flex h-14 shrink-0 items-center gap-2 px-4">
            <ClubMark />
            <span className="truncate font-heading text-sm font-semibold">Naranja y Blanco</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col py-2">
            <DesktopNavList role={session.role} />
          </div>
          <div className="shrink-0 border-t border-border p-2">
            <UserMenu displayName={session.displayName} role={session.role} />
          </div>
        </aside>

        {/*
          Columna de contenido: en escritorio es EL contenedor de scroll
          (`md:h-dvh md:overflow-y-auto`), no el documento — así la lateral de
          al lado queda fija en vez de desplazarse con la página. En móvil
          sigue siendo un `div` normal dentro del flujo del documento (nada
          de estas clases aplica por debajo de `md`).
          `scrollbar-gutter: stable` reserva el ancho de la barra siempre,
          para que una página sin scroll y una con scroll no muevan el
          contenido centrado un puñado de píxeles al navegar entre ellas.
          El scrollbar en sí (Firefox vía `scrollbar-width`/`-color`, WebKit
          vía los pseudo-elementos) es fino y del color de `--border`, nunca
          el gris del navegador por defecto (craft-floor: "browser surfaces
          still carry the design"). `md:relative` hace que este
          contenedor sea el bloque contenedor de los `absolute` de adentro
          (tooltips de recharts, `sr-only`): sin eso escapan al documento y
          aparece un segundo scroll de página entera.
        */}
        <div
          className="flex min-w-0 flex-1 flex-col md:relative md:h-dvh md:overflow-y-auto md:[scrollbar-gutter:stable] md:[scrollbar-width:thin] md:[scrollbar-color:var(--border)_transparent] md:[&::-webkit-scrollbar]:w-2.5 md:[&::-webkit-scrollbar-thumb]:rounded-full md:[&::-webkit-scrollbar-thumb]:bg-border md:[&::-webkit-scrollbar-track]:bg-transparent"
        >
          {/* Móvil: barra superior blanca translúcida con blur, pegada arriba del lienzo. */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md md:hidden">
            <ClubMark size="sm" />
            <span className="truncate font-heading text-sm font-semibold">Naranja y Blanco</span>
            <div className="ml-auto">
              <UserMenu displayName={session.displayName} role={session.role} />
            </div>
          </header>

          {/*
            `<ViewTransition>` (React 19.2 / Next 16, sin flag de configuración
            — "View transitions work in the App Router with no configuration",
            node_modules/next/dist/docs/01-app/02-guides/view-transitions.md):
            sin `name`, activa el crossfade de `::view-transition-old(root)` /
            `::view-transition-new(root)` que ya vive en `globals.css` (180ms)
            en cada navegación entre páginas del panel. `AppShell` no se
            remonta al navegar (layouts persisten), así que este es el único
            lugar del árbol donde envolver "el contenido de la página" tiene
            sentido sin duplicar el wrapper en cada `page.tsx`.
          */}
          <main id="main-content" className="flex-1 px-4 pt-4 pb-20 md:px-6 md:py-6 md:pb-6">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
              <ViewTransition>{children}</ViewTransition>
            </div>
          </main>

          <MobileBottomNav role={session.role} />
        </div>
      </div>

      {/*
        Overlays globales (C7): se montan UNA sola vez, fuera de `main`, para
        sobrevivir a la navegación entre páginas hermanas sin remontarse. Cada
        uno lee su propio query param y devuelve `null` si no aplica — por
        eso viven acá siempre montados, no solo cuando algún botón los abre.
        `useSearchParams` (dentro de `useOverlayParam`, C2) exige un límite de
        Suspense; el fallback es `null` porque hasta que el cliente hidrata no
        hay nada que mostrar (ninguno de los dos se abre sin una interacción).
      */}
      <Suspense fallback={null}>
        <PaymentOverlayHost />
        <MemberQuickViewSheet />
      </Suspense>
    </PanelSessionProvider>
  )
}
