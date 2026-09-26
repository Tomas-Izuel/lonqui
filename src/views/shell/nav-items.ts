import type { LucideIcon } from 'lucide-react'
import { Home, ScrollText, Settings, UserCog, Users } from 'lucide-react'
import type { AppRole } from '@/models/types'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

const BASE_ITEMS: NavItem[] = [
  { href: '/', label: 'Inicio', icon: Home },
  { href: '/socios', label: 'Socios', icon: Users },
]

const ADMIN_ITEMS: NavItem[] = [
  { href: '/usuarios', label: 'Usuarios', icon: UserCog },
  { href: '/ajustes', label: 'Ajustes', icon: Settings },
  { href: '/auditoria', label: 'Auditoría', icon: ScrollText },
]

/**
 * Navegación por rol (T6): Inicio y Socios para todos; Usuarios, Ajustes y
 * Auditoría solo admin. `/cobranza` y `/reportes` no existen todavía y no
 * aparecen — un panel con botones muertos no es Operate.
 */
export function getNavItems(role: AppRole): NavItem[] {
  return role === 'admin' ? [...BASE_ITEMS, ...ADMIN_ITEMS] : BASE_ITEMS
}
