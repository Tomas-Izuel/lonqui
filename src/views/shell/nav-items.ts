import type { LucideIcon } from 'lucide-react'
import { Banknote, Home, ScrollText, Settings, UserCog, Users } from 'lucide-react'
import type { AppRole } from '@/models/types'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

// `/cobranza` ya existe (F1): se prende acá, la única línea que F3 toca de
// `views/shell/**` — el algoritmo de abajo (escritorio y barra inferior) no
// necesita ningún otro cambio para acomodarlo.
const COBRANZA_ENABLED = true

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
}

const REGISTRY: NavDestination[] = [
  { href: '/socios', label: 'Socios', icon: Users, rank: 0 },
  ...(COBRANZA_ENABLED ? [{ href: '/cobranza', label: 'Cobranza', icon: Banknote, rank: 1 }] : []),
  { href: '/', label: 'Inicio', icon: Home, rank: 2 },
  { href: '/usuarios', label: 'Usuarios', icon: UserCog, rank: 3, roles: ['admin'] },
  { href: '/ajustes', label: 'Ajustes', icon: Settings, rank: 4, roles: ['admin'] },
  { href: '/auditoria', label: 'Auditoría', icon: ScrollText, rank: 5, roles: ['admin'] },
]

function destinationsForRole(role: AppRole): NavDestination[] {
  return REGISTRY.filter((item) => !item.roles || item.roles.includes(role)).sort((a, b) => a.rank - b.rank)
}

/** Barra lateral de escritorio (T6): todo visible, de más a menos importante — Socios arriba. */
export function getNavItems(role: AppRole): NavItem[] {
  return destinationsForRole(role)
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
export function getMobileNav(role: AppRole): MobileNav {
  const destinations = destinationsForRole(role)

  if (destinations.length <= MOBILE_MAX_SLOTS) {
    return { visible: destinations.slice().reverse(), overflow: [] }
  }

  const kept = destinations.slice(0, MOBILE_MAX_SLOTS - 1)
  const overflow = destinations.slice(MOBILE_MAX_SLOTS - 1)
  return { visible: kept.slice().reverse(), overflow }
}
