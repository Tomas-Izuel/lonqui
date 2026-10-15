import { SectionTabs, type SectionTab } from '@/views/shared/section-tabs'

/**
 * "Otros ingresos" agrupa su lista y la subpágina de sponsors (un sponsor es
 * parte de ese mundo, no una pestaña más): por prefijo. El resto, exacto.
 */
const TABS: readonly SectionTab[] = [
  { href: '/caja', label: 'Resumen' },
  { href: '/caja/cuotas', label: 'Cuotas' },
  { href: '/caja/ingresos', label: 'Otros ingresos', matchPrefixes: ['/caja/ingresos', '/caja/sponsors'] },
  { href: '/caja/deuda', label: 'Con deuda' },
  { href: '/caja/al-dia', label: 'Al día' },
  { href: '/caja/por-categoria', label: 'Por categoría' },
]

/** Navegación de sección de toda `/caja` (D3, `00-architecture.md` de caja): ver `SectionTabs`. */
export function CajaTabs() {
  return <SectionTabs tabs={TABS} label="Secciones de caja" indicatorId="caja-tab-indicator" />
}
