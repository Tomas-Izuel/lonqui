'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_INDICATOR, useMotionPreference } from '@/views/shared/motion'

export type SectionTab = {
  href: string
  label: string
  /**
   * Prefijos que también activan esta pestaña (subpáginas que viven "adentro"
   * de ella, p. ej. `/caja/sponsors` bajo "Otros ingresos"). Sin esto, solo
   * activa la ruta exacta.
   */
  matchPrefixes?: readonly string[]
}

function isTabActive(pathname: string, tab: SectionTab) {
  if (pathname === tab.href) return true
  return tab.matchPrefixes?.some((prefix) => pathname.startsWith(prefix)) ?? false
}

/**
 * Navegación de sección: rutas propias (bookmarkeables, enlazables desde otros
 * módulos) que se VEN y se SIENTEN como pestañas de una sola pantalla. Va
 * justo debajo del `PageHeader`, sin `Panel` alrededor.
 *
 * Mobile first (nació en `/caja`, fix de revisión a 390px): cada pestaña mide
 * lo que su texto necesita (`shrink-0`) y la barra scrollea horizontal si no
 * entran todas; la activa se lleva a la vista al montar o al navegar. Cada
 * pestaña es un `<Link>` real (click del medio y Cmd/Ctrl+click abren en
 * pestaña nueva) y el indicador viaja con `layoutId` (mismo resorte que la
 * navegación principal). `indicatorId` tiene que ser único por barra: dos
 * barras con el mismo id se robarían el indicador entre sí.
 */
export function SectionTabs({
  tabs,
  label,
  indicatorId,
}: {
  tabs: readonly SectionTab[]
  /** `aria-label` del `<nav>`, p. ej. "Secciones de caja". */
  label: string
  indicatorId: string
}) {
  const pathname = usePathname()
  const { reduced } = useMotionPreference()
  const activeRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' })
  }, [pathname, reduced])

  return (
    <nav aria-label={label} className="overflow-x-auto">
      <div className="flex w-max min-w-full gap-1 rounded-xl bg-muted p-1">
        {tabs.map((tab) => {
          const active = isTabActive(pathname, tab)
          return (
            <Link
              key={tab.href}
              ref={active ? activeRef : undefined}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active ? (
                <motion.span
                  layoutId={reduced ? undefined : indicatorId}
                  className="absolute inset-0 rounded-lg bg-background shadow-raised"
                  transition={SPRING_INDICATOR}
                />
              ) : null}
              <span className="relative">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
