import type { LucideIcon } from 'lucide-react'
import { Banknote, Home, ScrollText, Settings, UserCheck, UserCog, Users } from 'lucide-react'
import type { AppRole, Permission } from '@/models/types'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** Este destino muestra el conteo de pedidos de Revisión pendientes. */
  showsPendingReview?: boolean
}

/** Destino de Revisión (App de socios): lo usa la navegación para el badge. */
export const REVIEW_HREF = '/socios/revision'

// `/caja` ya existe (F1): se prende acá, la única línea que F3 toca de
// `views/shell/**` — el algoritmo de abajo (escritorio y barra inferior) no
// necesita ningún otro cambio para acomodarlo.
const CAJA_ENABLED = true

type NavDestination = NavItem & {
  /**
   * Importancia del destino (pedido de Tomás, 0 = el más importante), fija y
   * ajena al rol: Socios > Cobranza > Inicio > Usuarios > Ajustes >
   * Auditoría. La usan tanto la barra lateral de escritorio (de más a menos
   * importante, arriba primero) como el algoritmo de la barra inferior móvil
   * (`getMobileNav`, más abajo).
   */
  rank: number
  /** Sin `roles`: visible para cualquier rol autenticado. */
  roles?: AppRole[]
  /**
   * Visible solo con este permiso. Se evalúa únicamente cuando quien llama
   * pasa los permisos de la sesión: sin ellos, un destino con `permission` no
   * se muestra (nunca se asume).
   */
  permission?: Permission
  /** Posición en la barra inferior móvil, si debe ser distinta de `rank` (que manda en escritorio). */
  mobileRank?: number
}

const REGISTRY: NavDestination[] = [
  { href: '/socios', label: 'Socios', icon: Users, rank: 0 },
  // Revisión vive "debajo" de Socios en escritorio, pero en el celular es el destino menos
  // frecuente (la hace sobre todo una persona, en la compu): no le saca un lugar a la barra.
  { href: REVIEW_HREF, label: 'Revisión', icon: UserCheck, rank: 0.5, mobileRank: 100, permission: 'portal.review', showsPendingReview: true },
  ...(CAJA_ENABLED ? [{ href: '/caja', label: 'Caja', icon: Banknote, rank: 1 }] : []),
  { href: '/', label: 'Inicio', icon: Home, rank: 2 },
  { href: '/usuarios', label: 'Usuarios', icon: UserCog, rank: 3, roles: ['admin'] },
  { href: '/ajustes', label: 'Ajustes', icon: Settings, rank: 4, roles: ['admin'] },
  { href: '/auditoria', label: 'Auditoría', icon: ScrollText, rank: 5, roles: ['admin'] },
]

function destinationsForRole(role: AppRole, permissions?: Permission[], mobile = false): NavDestination[] {
  const rankOf = (item: NavDestination) => (mobile ? (item.mobileRank ?? item.rank) : item.rank)
  return REGISTRY.filter((item) => (!item.roles || item.roles.includes(role)) && (!item.permission || permissions?.includes(item.permission)))
    .sort((a, b) => rankOf(a) - rankOf(b))
}

/** Barra lateral de escritorio (T6): todo visible, de más a menos importante — Socios arriba. */
export function getNavItems(role: AppRole, permissions?: Permission[]): NavItem[] {
  return destinationsForRole(role, permissions)
}

/** Cuántos espacios tiene la barra inferior, contando "Más" cuando hace falta. */
const MOBILE_MAX_SLOTS = 5

export type MobileNav = {
  /**
   * De izquierda a derecha, importancia CRECIENTE: el destino más importante
   * queda en el extremo derecho, al alcance del pulgar (pedido de Tomás).
   */
  visible: NavItem[]
  /** Los destinos que no entraron en la barra, para el sheet de "Más". Vacío cuando todo entra. */
  overflow: NavItem[]
}

/**
 * Barra inferior móvil: si los destinos del rol entran en `MOBILE_MAX_SLOTS`,
 * se listan todos, ordenados por importancia creciente hacia la derecha. Si
 * no entran, se quedan los `MOBILE_MAX_SLOTS - 1` más importantes como
 * ítems propios (mismo orden) y el resto —los menos importantes— se agrupa
 * en "Más", que ocupa el extremo izquierdo (el lugar menos alcanzable con el
 * pulgar, coherente con ser el destino menos prioritario del conjunto).
 *
 * Genérico sobre `rank`, no une caso por rol: agregar un destino nuevo o
 * prender Cobranza solo cambia `REGISTRY`, este algoritmo no se toca.
 */
export function getMobileNav(role: AppRole, permissions?: Permission[]): MobileNav {
  const destinations = destinationsForRole(role, permissions, true)

  if (destinations.length <= MOBILE_MAX_SLOTS) {
    return { visible: destinations.slice().reverse(), overflow: [] }
  }

  const kept = destinations.slice(0, MOBILE_MAX_SLOTS - 1)
  const overflow = destinations.slice(MOBILE_MAX_SLOTS - 1)
  return { visible: kept.slice().reverse(), overflow }
}
