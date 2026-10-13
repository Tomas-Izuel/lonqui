'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_INDICATOR, useMotionPreference } from '@/views/shared/motion'

const TABS = [
  { href: '/caja', label: 'Resumen' },
  { href: '/caja/cuotas', label: 'Cuotas' },
  { href: '/caja/ingresos', label: 'Otros ingresos' },
  { href: '/caja/deuda', label: 'Con deuda' },
  { href: '/caja/al-dia', label: 'Al día' },
  { href: '/caja/por-categoria', label: 'Por categoría' },
] as const

/**
 * "Otros ingresos" agrupa su lista y la subpágina de sponsors (un sponsor es
 * parte de ese mundo, no una pestaña más): por prefijo. El resto, exacto.
 */
function isTabActive(pathname: string, href: string) {
  if (href === '/caja/ingresos') return pathname.startsWith('/caja/ingresos') || pathname.startsWith('/caja/sponsors')
  return pathname === href
}

/**
 * Navegación de sección de TODA `/caja` (el hub y sus listados): seis
 * rutas propias (bookmarkeables, cada una con su propio filtro y su propia
 * exportación — D3, `00-architecture.md`) que se VEN y se SIENTEN como
 * pestañas de una sola pantalla, montadas justo debajo del encabezado de
 * cada página, sin envolverlas en un `Panel` (fix de revisión: vivían al
 * pie, adentro de un panel "Listados", y a 390px la última se recortaba
 * ["Por…"] porque `flex-1` repartía el ancho en partes iguales entre 4
 * pestañas fijas). Ahora cada pestaña mide lo que su texto necesita
 * (`shrink-0`) y la barra entera scrollea horizontal si no entran todas —
 * la activa se lleva a la vista con `scrollIntoView` al montar o al navegar,
 * así nunca queda oculta fuera de cuadro.
 *
 * Cada "pestaña" es un `<Link>` real: click del medio y Cmd/Ctrl+click abren
 * en pestaña nueva sin código propio, y el indicador de la activa viaja con
 * `layoutId` (mismo resorte que la navegación principal, `SPRING_INDICATOR`
 * de `motion.ts`) en vez de aparecer de golpe.
 */
export function CajaTabs() {
  const pathname = usePathname()
  const { reduced } = useMotionPreference()
  const activeRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' })
  }, [pathname, reduced])

  return (
    <nav aria-label="Secciones de caja" className="overflow-x-auto">
      <div className="flex w-max min-w-full gap-1 rounded-xl bg-muted p-1">
        {TABS.map((tab) => {
          const active = isTabActive(pathname, tab.href)
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
                  layoutId={reduced ? undefined : 'caja-tab-indicator'}
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
