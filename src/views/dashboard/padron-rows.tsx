import { ChevronDown } from 'lucide-react'
import { Amount } from '@/views/shared/money'
import { DataRow, DataRowGroup } from '@/views/dashboard/data-row'
import type { DashboardSummary, DebtByCategoryRow } from '@/models/types'

/** Activos, altas (+ reactivaciones aparte, nunca sumadas — T9), bajas del mes. */
export function PadronHeadlineRows({ summary }: { summary: DashboardSummary }) {
  return (
    <DataRowGroup>
      <DataRow label="Socios activos" value={summary.activeMembers} href="/socios?status=active" />
      <DataRow
        label="Altas del mes"
        sublabel={summary.reactivationsCount > 0 ? `+${summary.reactivationsCount} reactivaciones` : undefined}
        value={summary.admissionsCount}
      />
      <DataRow label="Bajas del mes" value={summary.withdrawalsCount} />
    </DataRowGroup>
  )
}

/**
 * Aptos físicos: vencidos y faltantes. `/socios` sin filtro propio todavía
 * (dev log): `MemberFilters` (S3/F2, `socios/page.tsx`) no tiene un parámetro
 * de estado de apto físico, así que el link cae al padrón sin filtrar.
 */
export function MedicalClearanceRows({ summary }: { summary: DashboardSummary }) {
  return (
    <DataRowGroup>
      <DataRow
        label="Aptos físicos vencidos"
        value={summary.expiredClearances}
        tone={summary.expiredClearances > 0 ? 'debt' : undefined}
        href="/socios"
      />
      <DataRow
        label="Aptos físicos faltantes"
        value={summary.missingClearances}
        tone={summary.missingClearances > 0 ? 'debt' : undefined}
        href="/socios"
      />
    </DataRowGroup>
  )
}

function categoryHref(row: DebtByCategoryRow): string | undefined {
  if (row.kind === 'category' && row.categoryId != null) return `/socios?categoryId=${row.categoryId}`
  if (row.kind === 'social') return '/socios?memberType=non_practicing'
  return undefined
}

function CategoryRow({ row }: { row: DebtByCategoryRow }) {
  return (
    <DataRow
      label={row.categoryName}
      sublabel={`${row.members} ${row.members === 1 ? 'socio' : 'socios'}${row.membersInDebt > 0 ? ` · ${row.membersInDebt} con deuda` : ''}`}
      value={<Amount cents={row.debtCents} />}
      tone={row.debtCents > 0 ? 'debt' : undefined}
      href={categoryHref(row)}
    />
  )
}

/**
 * Deuda por categoría (D32/D14): cada cargo se atribuye a la categoría
 * congelada en él, con "Cuota social" y "Saldo anterior" como filas
 * especiales — las tres suman la deuda total (route.md). Sin `moreRows`,
 * muestra `rows` entera; con `moreRows`, el llamador ya decidió qué queda
 * siempre visible (las especiales, típicamente) y qué cola larga va en un
 * `<details>` nativo (sin JS, sin modal) para no alargar el primer scroll —
 * la variante decide el corte, este componente solo lo dibuja.
 */
export function CategoryList({ rows, moreRows = [] }: { rows: DebtByCategoryRow[]; moreRows?: DebtByCategoryRow[] }) {
  const visible = rows
  const rest = moreRows

  return (
    <DataRowGroup>
      {visible.map((row) => (
        <CategoryRow key={`${row.kind}-${row.categoryId ?? 'x'}`} row={row} />
      ))}
      {rest.length > 0 ? (
        <details className="group/details">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-medium text-primary marker:content-none hover:underline">
            Ver las {rest.length} categorías restantes
            <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open/details:rotate-180" />
          </summary>
          <DataRowGroup>
            {rest.map((row) => (
              <CategoryRow key={`${row.kind}-${row.categoryId ?? 'x'}`} row={row} />
            ))}
          </DataRowGroup>
        </details>
      ) : null}
    </DataRowGroup>
  )
}
