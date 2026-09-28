'use client'

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDate } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import { AXIS_PROPS, CHART_COLORS, ChartTooltipFrame, TooltipRow, dayOfMonth, formatAxisTick, useChartEntrance } from '@/views/shared/chart-kit'
import type { DailyCollectionPoint } from '@/models/types'

type TooltipPayload = { payload: DailyCollectionPoint }[]

function DailyTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <ChartTooltipFrame title={formatDate(point.day)}>
      <TooltipRow color={CHART_COLORS.brand} label="Cobrado ese día" value={formatCentsCompact(point.collectedCents)} />
      <TooltipRow label="Acumulado del mes" value={formatCentsCompact(point.cumulativeCents)} />
    </ChartTooltipFrame>
  )
}

/**
 * "Ritmo del mes" (agregado de alcance 1, addendum de `01-tasks.md`): área
 * acumulada de lo cobrado día a día, un solo hue de marca (`--color-chart-
 * brand`, magnitud sin carga de estado — no es "al día"/"en deuda", es la
 * marca del club) contra una referencia punteada en el total de cuotas del
 * mes. Un solo eje (dataviz): los pesos acumulados y la meta comparten
 * escala, nunca dos ejes para "lo mismo visto dos veces".
 */
export function DailyCollectionChart({ points, feesCents }: { points: DailyCollectionPoint[]; feesCents: number }) {
  const anim = useChartEntrance()

  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay días cargados este mes.</p>
  }

  const data = points.map((p) => ({ ...p, label: dayOfMonth(p.day) }))

  return (
    <div
      className="h-56 w-full"
      role="img"
      aria-label="Gráfico de área: cobrado acumulado día a día en el mes, contra el total de las cuotas del mes. El detalle de cada día está en la tabla de abajo."
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} strokeDasharray="0" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} tick={AXIS_PROPS.tick} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width={52} tick={AXIS_PROPS.tick} tickFormatter={formatAxisTick} />
          <Tooltip content={<DailyTooltip />} cursor={{ stroke: CHART_COLORS.axis, strokeDasharray: '4 4' }} />
          {feesCents > 0 ? <ReferenceLine y={feesCents} stroke={CHART_COLORS.track} strokeDasharray="4 4" strokeWidth={1.5} /> : null}
          <Area
            dataKey="cumulativeCents"
            type="monotone"
            stroke={CHART_COLORS.brand}
            strokeWidth={2}
            fill={CHART_COLORS.brand}
            fillOpacity={0.12}
            {...anim}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Tabla equivalente accesible (dataviz: "todo gráfico necesita su tabla"), oculta visualmente. */
export function DailyCollectionTableHidden({ points }: { points: DailyCollectionPoint[] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>Cobrado por día y acumulado del mes</caption>
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col">Cobrado</th>
            <th scope="col">Acumulado</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <td>{formatDate(point.day)}</td>
              <td>{formatCentsCompact(point.collectedCents)}</td>
              <td>{formatCentsCompact(point.cumulativeCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
