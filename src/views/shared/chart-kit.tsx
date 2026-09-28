'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { DURATION, useMotionPreference } from './motion'

/**
 * Piezas comunes de todos los gráficos del panel (recharts), para que el
 * gráfico de evolución, el de deuda por categoría y el ritmo del mes se lean
 * como un solo sistema: mismo tooltip, mismos ejes, misma animación.
 *
 * Colores por trabajo (skill `dataviz`), siempre como `var(--color-…)`:
 * - Cobrado / al día → `--color-status-up-to-date`; deuda → `--color-status-in-debt`.
 *   Son estados que la app ya usa: no es una paleta categórica nueva.
 * - Serie de marca (ritmo de cobranza, magnitud sin carga de estado) →
 *   `--color-chart-brand` (el naranja institucional: es una marca, no texto).
 * - Riel / meta / "lo que falta" → `--color-chart-track`.
 * Nunca un color por categoría: la identidad de cada barra la da su rótulo.
 */
export { CHART_COLORS, AXIS_PROPS, formatAxisTick, shortMonth, dayOfMonth } from './chart-format'

/**
 * Contenedor del tooltip: flotante de DESIGN.md (sombra con blur + anillo de
 * 1px). El contenido lo arma cada gráfico con `TooltipRow`.
 */
export function ChartTooltipFrame({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-w-40 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lifted ring-1 ring-foreground/5"
    >
      <p className="mb-1 font-medium text-foreground first-letter:uppercase">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

/** Una fila del tooltip: punto de color (decorativo), rótulo y valor tabular. El rótulo siempre dice qué es. */
export function TooltipRow({ color, label, value, className }: { color?: string; label: string; value: string; className?: string }) {
  return (
    <p className={cn('flex items-center justify-between gap-4 text-foreground', className)}>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {color ? <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} /> : null}
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </p>
  )
}

/**
 * Animación de entrada de un gráfico, solo en el primer montaje.
 *
 * Trampa de recharts: `isAnimationActive` se evalúa en cada render, así que
 * un hover que re-renderiza vuelve a disparar el dibujo si queda en `true`.
 * Acá se prende al montar y se apaga apenas termina la animación. Con
 * movimiento reducido, nunca se anima.
 *
 * Uso: `const anim = useChartEntrance()` y `<Bar {...anim} />`.
 */
export function useChartEntrance(): { isAnimationActive: boolean; animationDuration: number; animationEasing: 'ease-out' } {
  const { reduced } = useMotionPreference()
  const [done, setDone] = useState(false)
  const durationMs = Math.round(DURATION.focal * 1000)

  useEffect(() => {
    const timer = window.setTimeout(() => setDone(true), durationMs + 100)
    return () => window.clearTimeout(timer)
  }, [durationMs])

  return { isAnimationActive: !reduced && !done, animationDuration: durationMs, animationEasing: 'ease-out' }
}
