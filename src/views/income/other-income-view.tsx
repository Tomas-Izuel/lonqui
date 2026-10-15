import Link from 'next/link'
import { HandCoins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { Amount } from '@/views/shared/money'
import { FilterBar, type FilterDef } from '@/views/shared/filter-bar'
import { CajaTabs } from '@/views/payments/caja-tabs'
import { MonthSelector } from '@/views/payments/month-selector'
import { ExportCsvButton } from '@/views/income/export-csv-button'
import { OtherIncomeList } from '@/views/income/other-income-list'
import { RegisterIncomeButton } from '@/views/income/register-income-button'
import { formatPeriod, toMonthParam } from '@/lib/dates'
import type { CashConcept, CashMonthSummary, CashMovement, SponsorOption } from '@/models/types'

const countFormatter = new Intl.NumberFormat('es-AR')

function countLabel(count: number): string {
  return count === 1 ? '1 ingreso' : `${countFormatter.format(count)} ingresos`
}

/**
 * `/caja/ingresos?mes=&concepto=&sponsor=`. Cero data fetching: todo llega
 * resuelto de la page. Los totales (`summary`) son SIEMPRE del mes completo y
 * vienen de la base (nunca se suman en el cliente); el filtro solo recorta la
 * lista de abajo, y la vista lo dice cuando hay uno activo.
 *
 * Cambiar de mes (`MonthSelector`) descarta `concepto` y `sponsor` a
 * propósito: un sponsor que aportó en agosto casi nunca es el que se busca en
 * septiembre, y un filtro viejo dejaría un mes vacío sin explicación.
 */
export function OtherIncomeView({
  period,
  movements,
  summary,
  concepts,
  sponsors,
  truncated,
  conceptId,
  sponsorId,
  canVoid,
  canExport,
}: {
  period: string
  movements: CashMovement[]
  summary: CashMonthSummary
  concepts: CashConcept[]
  sponsors: SponsorOption[]
  truncated: boolean
  conceptId?: number
  sponsorId?: number
  canVoid: boolean
  canExport: boolean
}) {
  const filtersActive = conceptId !== undefined || sponsorId !== undefined
  const monthLabel = formatPeriod(period)

  const filters: FilterDef[] = [
    {
      param: 'concepto',
      label: 'Concepto',
      placeholder: 'Todos los conceptos',
      options: concepts.map((c) => ({ value: String(c.id), label: c.isActive ? c.name : `${c.name} (desactivado)` })),
    },
    {
      param: 'sponsor',
      label: 'Sponsor',
      placeholder: 'Todos los sponsors',
      options: sponsors.map((s) => ({ value: String(s.id), label: s.isActive ? s.name : `${s.name} (desactivado)` })),
    },
  ]

  const exportParams = new URLSearchParams({ mes: toMonthParam(period) })
  if (conceptId !== undefined) exportParams.set('concepto', String(conceptId))
  if (sponsorId !== undefined) exportParams.set('sponsor', String(sponsorId))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Otros ingresos"
        description="Sponsors, donaciones, indumentaria y eventos. No cuentan para la deuda de los socios."
      />
      <CajaTabs />
      <div className="flex flex-wrap items-center gap-2">
        <RegisterIncomeButton />
        <Button asChild variant="outline" className="h-11">
          <Link href="/caja/sponsors">
            <HandCoins aria-hidden />
            Sponsors
          </Link>
        </Button>
      </div>
      <MonthSelector period={period} basePath="/caja/ingresos" />

      <Panel title={`Otros ingresos de ${monthLabel}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Amount cents={summary.otherIncomeCents} className="text-2xl font-semibold" />
          <span className="text-sm text-muted-foreground tabular-nums">{countLabel(summary.otherIncomeCount)}</span>
        </div>
        {summary.byConcept.length > 0 ? (
          <ul aria-label="Total por concepto" className="mt-3 flex flex-col divide-y divide-border border-t border-border">
            {summary.byConcept.map((row) => (
              <li key={row.conceptId} className="flex min-h-11 items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm">
                  {row.conceptName} <span className="text-muted-foreground tabular-nums">· {countLabel(row.count)}</span>
                </span>
                <Amount cents={row.amountCents} className="text-sm font-medium" />
              </li>
            ))}
          </ul>
        ) : null}
        {filtersActive ? (
          <p className="mt-3 text-sm text-muted-foreground">Los totales son de todo el mes. La lista de abajo está filtrada.</p>
        ) : null}
      </Panel>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <FilterBar filters={filters} />
        {canExport ? (
          <ExportCsvButton href={`/api/caja/ingresos/exportar?${exportParams.toString()}`} />
        ) : null}
      </div>

      {truncated ? (
        <p role="status" className="text-sm text-muted-foreground">
          Mostramos los primeros {countFormatter.format(movements.length)} ingresos del mes. Filtrá por concepto o sponsor para ver el resto.
        </p>
      ) : null}

      <OtherIncomeList
        movements={movements}
        canVoid={canVoid}
        emptyTitle={filtersActive ? 'No hay ingresos con esos filtros' : `Todavía no se registraron otros ingresos en ${monthLabel}`}
        emptyDescription={
          filtersActive
            ? 'Probá con otro concepto o sponsor, o limpiá los filtros.'
            : 'Cuando se cargue un aporte, una venta o una donación aparece acá, con su comprobante.'
        }
      />
    </div>
  )
}
