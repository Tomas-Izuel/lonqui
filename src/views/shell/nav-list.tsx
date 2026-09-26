'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { getNavItems } from '@/views/shell/nav-items'
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
 * como dato, no como referencia. `getNavItems` se resuelve acá adentro.
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

export function MobileBottomNav({ role }: { role: AppRole }) {
  const pathname = usePathname()
  const items = getNavItems(role)

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium text-muted-foreground"
          >
            <span className={cn('flex size-8 items-center justify-center rounded-full', active && 'bg-brand/10')}>
              <Icon aria-hidden className={cn('size-5', active && 'text-brand')} />
            </span>
            <span className={cn(active && 'font-semibold text-foreground')}>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
