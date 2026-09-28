'use client'

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCentsCompact } from '@/lib/money'
import { formatPeriod } from '@/lib/dates'
import type { MonthlyHistoryPoint } from '@/models/types'

/**
 * "Cobrado" y "deuda al cierre" (T8), un solo eje: son la misma unidad
 * (pesos) y a la misma escala — dos ejes distintos es el error #1 de charts
 * (skill `dataviz`). Colores reutilizados de los estados de cuenta ya
 * validados en toda la app (`--color-status-up-to-date` / `--color-status-
 * in-debt`, DESIGN.md): "cobrado" ES la lectura positiva y "deuda" la
 * negativa, así que es un uso de estado, no una paleta categórica nueva —
 * nunca un tercer acento. Mitigación del par rojo/verde para daltonismo
 * (dataviz: "nunca color solo"): formas distintas (barra vs. línea), leyenda
 * con texto, tooltip con texto y montos, y la tabla equivalente accesible
 * (abajo) que no depende del color en absoluto.
 */
function shortMonth(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1, 12)))
    .replace('.', '')
}

/**
 * Ticks del eje Y: notación compacta ("$125 k", "$1,3 M") — la deuda llega a
 * "unos millones de pesos" (route.md) y el monto completo sin comprimir
 * ("$ 1.250.000") no entra en los 44px de ancho reservados sin recortarse.
 * El monto exacto siempre está en el tooltip y en la tabla; acá solo importa
 * "leer la magnitud" (marks-and-anatomy.md: "redondear a números limpios").
 */
const AXIS_TICK_FORMATTER = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatAxisTick(cents: number): string {
  return AXIS_TICK_FORMATTER.format(cents / 100).replace(/\s/g, '')
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const collected = payload.find((p) => p.dataKey === 'collectedCents')?.value ?? 0
  const debt = payload.find((p) => p.dataKey === 'debtAtCloseCents')?.value ?? 0

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-[0_4px_6px_-1px_rgb(0_0_0_/_0.1),0_2px_4px_-2px_rgb(0_0_0_/_0.1)] ring-1 ring-foreground/10"
    >
      <p className="mb-1 font-medium text-foreground capitalize">{label ? formatPeriod(label) : ''}</p>
      <p className="flex items-center justify-between gap-4 text-status-up-to-date">
        <span>Cobrado</span>
        <span className="font-medium tabular-nums">{formatCentsCompact(collected)}</span>
      </p>
      <p className="flex items-center justify-between gap-4 text-status-in-debt">
        <span>Deuda al cierre</span>
        <span className="font-medium tabular-nums">{formatCentsCompact(debt)}</span>
      </p>
    </div>
  )
}

export function HistoryChart({ points }: { points: MonthlyHistoryPoint[] }) {
  const data = points.map((p) => ({ ...p, label: shortMonth(p.period) }))

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
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="0" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: 'var(--color-border)' }}
            tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
            tickFormatter={formatAxisTick}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-muted)' }} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}
            formatter={(value: string) => (value === 'collectedCents' ? 'Cobrado' : 'Deuda al cierre')}
          />
          <Bar dataKey="collectedCents" name="collectedCents" fill="var(--color-status-up-to-date)" radius={[4, 4, 0, 0]} maxBarSize={20} />
          <Line
            dataKey="debtAtCloseCents"
            name="debtAtCloseCents"
            type="monotone"
            stroke="var(--color-status-in-debt)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--color-status-in-debt)', strokeWidth: 2, stroke: 'var(--color-background)' }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
