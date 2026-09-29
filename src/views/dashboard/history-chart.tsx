'use client'

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS_PROPS, CHART_COLORS, ChartTooltipFrame, TooltipRow, formatAxisTick, shortMonth, useChartEntrance } from '@/views/shared/chart-kit'
import { formatCentsCompact } from '@/lib/money'
import { formatPeriod } from '@/lib/dates'
import type { MonthlyHistoryPoint } from '@/models/types'

/**
 * "Cobrado" y "deuda al cierre" (T8), un solo eje: son la misma unidad
 * (pesos) y a la misma escala — dos ejes distintos es el error #1 de charts
 * (skill `dataviz`). Colores reutilizados de los estados de cuenta ya
 * validados en toda la app (`chart-kit.ts`): "cobrado" ES la lectura
 * positiva y "deuda" la negativa, así que es un uso de estado, no una
 * paleta categórica nueva — nunca un tercer acento. Mitigación del par
 * rojo/verde para daltonismo (dataviz: "nunca color solo"): formas
 * distintas (barra vs. línea), leyenda con texto, tooltip con texto y
 * montos, y la tabla equivalente accesible (abajo) que no depende del color.
 *
 * Fix del pipeline 2026-09-28-ui-expresiva (T se sentía "roto"/sin vida):
 * sin `isAnimationActive` explícito, recharts anima en CADA re-render —
 * incluido el que dispara el propio hover del tooltip — así que las barras
 * "saltaban" cada vez que alguien tocaba el gráfico. `useChartEntrance()`
 * (chart-kit) lo dibuja una sola vez, al montar, y lo deja quieto después.
 */
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number; payload?: MonthlyHistoryPoint }[]
}) {
  if (!active || !payload?.length) return null
  const collected = payload.find((p) => p.dataKey === 'collectedCents')?.value ?? 0
  const debt = payload.find((p) => p.dataKey === 'debtAtCloseCents')?.value ?? 0
  // El período sale de la fila, no de `label`: `label` es el valor del eje X
  // (`shortMonth`, "sep"), y `formatPeriod("sep")` arma un `Date` inválido
  // que hace tirar a `Intl.DateTimeFormat` y voltea todo el inicio al hover.
  const period = payload[0].payload?.period

  return (
    <ChartTooltipFrame title={period ? formatPeriod(period) : ''}>
      <TooltipRow color={CHART_COLORS.collected} label="Cobrado" value={formatCentsCompact(collected)} />
      <TooltipRow color={CHART_COLORS.debt} label="Deuda al cierre" value={formatCentsCompact(debt)} />
    </ChartTooltipFrame>
  )
}

export function HistoryChart({ points }: { points: MonthlyHistoryPoint[] }) {
  const data = points.map((p) => ({ ...p, label: shortMonth(p.period) }))
  const entrance = useChartEntrance()

  return (
    <div
      className="h-64 w-full"
      role="img"
      aria-label="Gráfico de evolución mensual: cobrado y deuda al cierre de los últimos 12 meses. El detalle exacto de cada mes está en la tabla de abajo."
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
          barCategoryGap="30%"
          // Recharts 3 prende su propio foco/navegación por teclado por
          // defecto (`accessibilityLayer`); acá el equivalente accesible es
          // la tabla de abajo (mismos datos, sin depender del gráfico), así
          // que se apaga para no dejar dos caminos de teclado que compiten
          // por el mismo dato con comportamientos distintos.
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} strokeDasharray="0" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} tick={AXIS_PROPS.tick} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tick={AXIS_PROPS.tick}
            tickFormatter={formatAxisTick}
            allowDecimals={false}
            // Dominio con margen (dataviz: "redondear a números limpios"): sin
            // esto, el techo del eje cae justo en el valor máximo y la barra o
            // el punto más alto quedan pegados al borde superior del gráfico.
            domain={[0, (dataMax: number) => Math.ceil((dataMax * 1.15) / 100000) * 100000]}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-muted)' }} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: CHART_COLORS.axis }}
            formatter={(value: string) => (value === 'collectedCents' ? 'Cobrado' : 'Deuda al cierre')}
          />
          <Bar
            dataKey="collectedCents"
            name="collectedCents"
            fill={CHART_COLORS.collected}
            radius={[4, 4, 0, 0]}
            maxBarSize={20}
            {...entrance}
          />
          <Line
            dataKey="debtAtCloseCents"
            name="debtAtCloseCents"
            type="monotone"
            stroke={CHART_COLORS.debt}
            strokeWidth={2}
            dot={{ r: 3, fill: CHART_COLORS.debt, strokeWidth: 2, stroke: 'var(--color-background)' }}
            activeDot={{ r: 5 }}
            {...entrance}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
