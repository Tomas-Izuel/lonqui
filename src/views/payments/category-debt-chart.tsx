'use client'

import Link from 'next/link'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Amount } from '@/views/shared/money'
import { AXIS_PROPS, CHART_COLORS, ChartTooltipFrame, TooltipRow, formatAxisTick, useChartEntrance } from '@/views/shared/chart-kit'
import { formatCentsCompact } from '@/lib/money'
import { categoryRowLabel } from '@/views/payments/account-format'
import { cn } from '@/lib/utils'
import type { DebtByCategoryRow } from '@/models/types'

/**
 * "Fútbol masculino · 5ta", "Cuota social · no practicantes", "Saldo
 * anterior al sistema" — mismo texto en las dos variantes y en
 * `debt-by-category-view.tsx` (que lo reusa para no inventar un segundo
 * formato de nombre de fila).
 */
/** Solo las categorías reales enlazan al listado filtrado (D32): las dos filas especiales no tienen un `categoryId` que filtrar. */
function categoryHref(row: DebtByCategoryRow): string | undefined {
  return row.kind === 'category' && row.categoryId != null ? `/cobranza/deuda?categoriaId=${row.categoryId}` : undefined
}

function rowKey(row: DebtByCategoryRow): string {
  return `${row.kind}-${row.categoryId ?? 'none'}`
}

/**
 * Fila compacta con un riel de magnitud DEBAJO del texto (dataviz: "magnitud
 * → forma de barra", un solo hue secuencial — `--color-status-in-debt` sobre
 * `--color-chart-track`, el mismo par que ya lee "deuda" en el resto de los
 * gráficos, nunca una paleta categórica nueva: la identidad de cada fila la
 * da su texto, no un color por categoría). Fix de revisión: un relleno
 * DETRÁS del texto (un bloque rosado tapando media fila) se leía como
 * selección/resaltado, no como un dato — el riel fino, separado, debajo del
 * texto, es la forma estándar de un mini-bar-chart inline.
 */
function CompactRow({ row, maxDebtCents }: { row: DebtByCategoryRow; maxDebtCents: number }) {
  const href = categoryHref(row)
  const pct = maxDebtCents > 0 ? Math.max(Math.round((row.debtCents / maxDebtCents) * 100), row.debtCents > 0 ? 4 : 0) : 0
  const meta = `${row.members} ${row.members === 1 ? 'socio' : 'socios'}${row.membersInDebt > 0 ? ` · ${row.membersInDebt} con deuda` : ''}`

  const content = (
    <div className="flex min-h-11 flex-col justify-center gap-1.5 rounded-lg px-2.5 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm">
          <span className="font-medium">{categoryRowLabel(row)}</span> <span className="text-muted-foreground">· {meta}</span>
        </span>
        <Amount cents={row.debtCents} className={cn('shrink-0 text-sm font-medium', row.debtCents > 0 && 'text-status-in-debt')} />
      </div>
      <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-chart-track">
        <div className="h-full rounded-full bg-status-in-debt" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )

  return href ? (
    <Link
      href={href}
      className="block rounded-lg hover:bg-muted/40 focus-visible:bg-muted/40"
      aria-label={`${categoryRowLabel(row)}: ${row.members} socios, ver con deuda`}
    >
      {content}
    </Link>
  ) : (
    content
  )
}

function CompactChart({ rows, limit }: { rows: DebtByCategoryRow[]; limit: number }) {
  const visible = rows.slice(0, limit)
  const rest = rows.slice(limit)
  const maxDebtCents = Math.max(1, ...rows.map((r) => r.debtCents))

  return (
    <div className="flex flex-col gap-0.5">
      {visible.map((row) => (
        <CompactRow key={rowKey(row)} row={row} maxDebtCents={maxDebtCents} />
      ))}
      {rest.length > 0 ? (
        <details className="group/details">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-2.5 text-sm font-medium text-primary marker:content-none hover:underline">
            Ver las {rest.length} categorías restantes
          </summary>
          <div className="flex flex-col gap-0.5">
            {rest.map((row) => (
              <CompactRow key={rowKey(row)} row={row} maxDebtCents={maxDebtCents} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

/**
 * Rótulo corto para el eje Y del chart (fix de revisión: "Fútbol masculino ·
 * 5ta" completo no entra en el ancho de eje a 390px y recharts lo parte en
 * dos líneas diminutas). Se acorta el nombre de la disciplina a su primera
 * palabra — genérico, no una tabla de abreviaturas por disciplina (son datos
 * administrables desde `/ajustes`, CLAUDE.md, nunca un enum fijo en el
 * código) — y el nombre completo sigue disponible en el tooltip
 * (`categoryRowLabel`, que no lee este campo: recalcula del resto de la fila).
 */
function categoryAxisLabel(row: DebtByCategoryRow): string {
  if (row.kind === 'social') return 'Cuota social'
  if (row.kind === 'opening_balance') return 'Saldo anterior'
  if (!row.disciplineName) return row.categoryName
  const [firstWord] = row.disciplineName.split(' ')
  return `${firstWord} · ${row.categoryName}`
}

function FullChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: DebtByCategoryRow }[] }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <ChartTooltipFrame title={categoryRowLabel(row)}>
      <TooltipRow color={CHART_COLORS.debt} label="Deuda" value={formatCentsCompact(row.debtCents)} />
      <TooltipRow label="Con deuda" value={`${row.membersInDebt} de ${row.members}`} />
    </ChartTooltipFrame>
  )
}

/**
 * Barra horizontal real (recharts), ordenada desc, solo con las categorías
 * que efectivamente deben algo (dataviz: una barra en cero no aporta nada al
 * "quién debe más" que este chart responde). `debt-by-category-view.tsx`
 * mantiene la `DataList` con TODAS las filas —incluidas las de deuda
 * cero— como la tabla accesible equivalente que pide la skill.
 */
function FullChart({ rows }: { rows: DebtByCategoryRow[] }) {
  const withDebt = [...rows].filter((r) => r.debtCents > 0).sort((a, b) => b.debtCents - a.debtCents)
  const anim = useChartEntrance()

  if (withDebt.length === 0) return null

  const data = withDebt.map((row) => ({ ...row, label: categoryAxisLabel(row) }))
  const height = Math.max(160, data.length * 40 + 24)

  return (
    <div
      className="w-full"
      style={{ height }}
      role="img"
      aria-label="Gráfico de barras: deuda por categoría, de mayor a menor. El detalle de cada categoría, incluidas las sin deuda, está en la lista de abajo."
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }} accessibilityLayer={false}>
          <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
          <XAxis type="number" {...AXIS_PROPS} axisLine={false} tickFormatter={formatAxisTick} />
          <YAxis type="category" dataKey="label" {...AXIS_PROPS} axisLine={false} width={100} />
          <Tooltip content={<FullChartTooltip />} cursor={{ fill: 'var(--color-muted)' }} />
          <Bar dataKey="debtCents" fill={CHART_COLORS.debt} radius={[0, 4, 4, 0]} maxBarSize={22} {...anim} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Deuda por categoría, en dos lecturas (D4/C5 del pipeline 2026-09-28): el
 * inicio la usa `compact` dentro del panel "Padrón" (barra inline por fila,
 * import de solo lectura desde `views/dashboard`); `/cobranza/por-categoria`
 * la usa `full` arriba de su `DataList`. Mismo dato, mismo componente, cero
 * duplicación del formato de nombre o del criterio de link.
 */
export function CategoryDebtChart({
  rows,
  variant,
  limit = 6,
}: {
  rows: DebtByCategoryRow[]
  variant: 'compact' | 'full'
  /** compact: cuántas filas mostrar antes de "Ver todas" (default 6). */
  limit?: number
}) {
  if (rows.length === 0) return null
  return variant === 'compact' ? <CompactChart rows={rows} limit={limit} /> : <FullChart rows={rows} />
}
