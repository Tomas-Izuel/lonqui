'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { getMobileNav, getNavItems } from '@/views/shell/nav-items'
import type { NavItem } from '@/views/shell/nav-items'
import type { AppRole } from '@/models/types'

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
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
 */
export function DesktopNavList({ role }: { role: AppRole }) {
  const pathname = usePathname()
  const items = getNavItems(role)

  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-0.5 px-2">
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
              active ? 'bg-brand/10 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon aria-hidden className={cn('size-5 shrink-0', active && 'text-brand')} />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

function BottomNavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  const Icon = item.icon
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
      <span className={cn('flex size-8 items-center justify-center rounded-full', active && 'bg-brand/10')}>
        <Icon aria-hidden className={cn('size-5', active && 'text-brand')} />
      </span>
      <span className={cn(active && 'font-semibold text-foreground')}>{item.label}</span>
    </Link>
  )
}

export function MobileBottomNav({ role }: { role: AppRole }) {
  const pathname = usePathname()
  const { visible, overflow } = getMobileNav(role)
  const [moreOpen, setMoreOpen] = useState(false)
  const overflowActive = overflow.some((item) => isActive(pathname, item.href))

  return (
    <>
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
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
          </button>
        ) : null}

        {visible.map((item) => (
          <BottomNavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
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
                const active = isActive(pathname, item.href)
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
