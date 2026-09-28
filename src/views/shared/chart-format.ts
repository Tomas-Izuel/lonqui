/**
 * Formateadores y constantes puras de los gráficos (sin hooks ni JSX): los
 * pueden usar Server Components (tablas equivalentes, la tira de 12 meses) y
 * también `chart-kit.tsx`, que es la mitad de cliente. Ver el comentario de
 * colores en `chart-kit.tsx`.
 */
export const CHART_COLORS = {
  collected: 'var(--color-status-up-to-date)',
  debt: 'var(--color-status-in-debt)',
  brand: 'var(--color-chart-brand)',
  track: 'var(--color-chart-track)',
  grid: 'var(--color-border)',
  axis: 'var(--color-muted-foreground)',
} as const

/** Props de eje comunes: sin líneas de tick, texto de 12px en tinta secundaria. */
export const AXIS_PROPS = {
  tickLine: false,
  tick: { fill: CHART_COLORS.axis, fontSize: 12 },
} as const

const AXIS_TICK_FORMATTER = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * Ticks de eje en notación compacta ("$125 k", "$1,3 M"): la deuda llega a
 * millones y el monto completo no entra en el ancho del eje. El monto exacto
 * vive en el tooltip y en la tabla equivalente.
 */
export function formatAxisTick(cents: number): string {
  return AXIS_TICK_FORMATTER.format(cents / 100).replace(/\s/g, '')
}

/** "2026-09-01" → "sept". Para el eje de los gráficos mensuales. */
export function shortMonth(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1, 12)))
    .replace('.', '')
}

/** "2026-09-14" → "14". Para el eje del ritmo diario. */
export function dayOfMonth(day: string): string {
  return String(Number(day.slice(8, 10)))
}
