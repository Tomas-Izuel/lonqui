import { SectionTabs, type SectionTab } from '@/views/shared/section-tabs'

/**
 * Orden por frecuencia de uso: Cuotas es lo que se toca durante el año (y a
 * donde redirige `/ajustes`). Las cuatro entran a 390px sin scroll.
 */
const TABS: readonly SectionTab[] = [
  { href: '/ajustes/cuotas', label: 'Cuotas' },
  { href: '/ajustes/deportes', label: 'Deportes' },
  { href: '/ajustes/caja', label: 'Caja' },
  { href: '/ajustes/club', label: 'Club' },
]

export function SettingsTabs() {
  return <SectionTabs tabs={TABS} label="Secciones de ajustes" indicatorId="ajustes-tab-indicator" />
}
