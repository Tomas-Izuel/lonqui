'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { motion } from 'motion/react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { getMobileNav, getNavItems } from '@/views/shell/nav-items'
import type { NavItem } from '@/views/shell/nav-items'
import { SPRING_INDICATOR, useMotionPreference } from '@/views/shared/motion'
import type { AppRole, Permission } from '@/models/types'

function matches(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Un solo destino activo: el de la ruta MÁS específica. Sin esto, estando en
 * `/socios/revision` quedarían activos Socios y Revisión a la vez.
 */
function isActive(pathname: string, href: string, allHrefs: readonly string[]) {
  if (!matches(pathname, href)) return false
  return !allHrefs.some((other) => other.length > href.length && matches(pathname, other))
}

/** Conteo de pendientes de Revisión: un número en el ítem, con el texto para lector de pantalla. */
function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <>
      <span
        aria-hidden
        className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums"
      >
        {count > 99 ? '99+' : count}
      </span>
      <span className="sr-only">, {count} pendiente{count === 1 ? '' : 's'}</span>
    </>
  )
}

/**
 * El ítem activo se distingue con el acento del club (ícono naranja + fondo
 * tenue), nunca con un bloque saturado (route.md, anti-objetivo). Un solo
 * criterio de "activo" para las dos lecturas: lateral en escritorio, barra
 * inferior en móvil.
 *
 * Recibe `role` (un string), no la lista de ítems ya armada: los íconos de
 * `lucide-react` son componentes (funciones), y un Server Component no puede
 * pasarle una función a un Client Component como prop — cruza el límite RSC
 * como dato, no como referencia. `getNavItems`/`getMobileNav` se resuelven
 * acá adentro.
 *
 * El fondo del ítem activo es un `motion.span` con `layoutId` COMPARTIDO
 * entre los ítems del mismo destino (lateral vs. inferior usan ids propios,
 * `desktop-nav-indicator`/`mobile-nav-indicator`, para que un resize de
 * viewport con las dos barras montadas —una en `hidden`— nunca intente
 * animar un salto entre ellas): al cambiar de ruta, solo el nuevo activo lo
 * monta y `motion` interpola desde dónde estaba antes (D5, C1). Con
 * `prefers-reduced-motion`, la misma transición baja a `duration: 0` — el
 * resultado es el mismo color, sin el desplazamiento espacial.
 */
export function DesktopNavList({
  role,
  permissions,
  pendingReviewCount = 0,
}: {
  role: AppRole
  permissions: Permission[]
  pendingReviewCount?: number
}) {
  const pathname = usePathname()
  const items = getNavItems(role, permissions)
  const hrefs = items.map((item) => item.href)
  const { reduced } = useMotionPreference()

  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-0.5 px-2">
      {items.map((item) => {
        const active = isActive(pathname, item.href, hrefs)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {active ? (
              <motion.span
                layoutId="desktop-nav-indicator"
                transition={reduced ? { duration: 0 } : SPRING_INDICATOR}
                className="absolute inset-0 rounded-lg bg-brand/10"
              />
            ) : null}
            <Icon aria-hidden className={cn('relative z-[1] size-5 shrink-0', active && 'text-brand')} />
            <span className="relative z-[1]">{item.label}</span>
            {item.showsPendingReview ? <PendingBadge count={pendingReviewCount} /> : null}
          </Link>
        )
      })}
    </nav>
  )
}

function BottomNavLink({ item, active, onClick, pendingCount = 0 }: { item: NavItem; active: boolean; onClick?: () => void; pendingCount?: number }) {
  const Icon = item.icon
  const { reduced } = useMotionPreference()

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      // `text-xs` (12px), un escalón real de la escala (DESIGN.md): antes
      // `text-[11px]`, un tamaño a mano fuera de la escala, ilegible para
      // "usuarios de todas las edades, al sol" (finish review, fix 2).
      className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-medium text-muted-foreground"
    >
      <span className="relative flex size-8 items-center justify-center rounded-full">
        {active ? (
          <motion.span
            layoutId="mobile-nav-indicator"
            transition={reduced ? { duration: 0 } : SPRING_INDICATOR}
            className="absolute inset-0 rounded-full bg-brand/10"
          />
        ) : null}
        <Icon aria-hidden className={cn('relative z-[1] size-5', active && 'text-brand')} />
      </span>
      <span className={cn(active && 'font-semibold text-foreground')}>{item.label}</span>
      {item.showsPendingReview ? <PendingBadge count={pendingCount} /> : null}
    </Link>
  )
}

export function MobileBottomNav({
  role,
  permissions,
  pendingReviewCount = 0,
}: {
  role: AppRole
  permissions: Permission[]
  pendingReviewCount?: number
}) {
  const pathname = usePathname()
  const { visible, overflow } = getMobileNav(role, permissions)
  const hrefs = [...visible, ...overflow].map((item) => item.href)
  const [moreOpen, setMoreOpen] = useState(false)
  const overflowActive = overflow.some((item) => isActive(pathname, item.href, hrefs))
  // El badge de Revisión vive en "Más" cuando el destino cae ahí: el conteo se ve igual en el botón.
  const overflowPending = overflow.some((item) => item.showsPendingReview) ? pendingReviewCount : 0

  return (
    <>
      {/*
        Translúcida con blur (pipeline 2026-09-28): sobre el lienzo gris, una
        barra blanca opaca se sentía como una tapa; el blur más `border-t`
        la despega sin perder el contraste AA del texto/ícono, que siguen
        siendo tinta/tinta-secundaria sólidas (nunca sobre el blur en sí).
      */}
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {/* "Más" ocupa el extremo izquierdo a propósito (pedido de Tomás): es
            el lugar menos alcanzable con el pulgar, coherente con agrupar
            ahí los destinos menos prioritarios del conjunto. Solo aparece
            cuando no entran todos los destinos del rol en la barra. */}
        {overflow.length > 0 ? (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="true"
            aria-expanded={moreOpen}
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <span className={cn('flex size-8 items-center justify-center rounded-full', overflowActive && 'bg-brand/10')}>
              <MoreHorizontal aria-hidden className={cn('size-5', overflowActive && 'text-brand')} />
            </span>
            <span className={cn(overflowActive && 'font-semibold text-foreground')}>Más</span>
            <PendingBadge count={overflowPending} />
          </button>
        ) : null}

        {visible.map((item) => (
          <BottomNavLink key={item.href} item={item} active={isActive(pathname, item.href, hrefs)} pendingCount={pendingReviewCount} />
        ))}
      </nav>

      {overflow.length > 0 ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="rounded-t-xl md:hidden">
            <SheetHeader>
              <SheetTitle>Más</SheetTitle>
            </SheetHeader>
            <nav aria-label="Más destinos" className="flex flex-col gap-1 px-4 pb-4">
              {overflow.map((item) => {
                const active = isActive(pathname, item.href, hrefs)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                      active ? 'bg-brand/10 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon aria-hidden className={cn('size-5 shrink-0', active && 'text-brand')} />
                    {item.label}
                    {item.showsPendingReview ? <PendingBadge count={pendingReviewCount} /> : null}
                  </Link>
                )
              })}
            </nav>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  )
}
