import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { Amount } from '@/views/shared/money'
import { EmptyState } from '@/views/shared/states'
import { CobranzaTabs } from '@/views/payments/cobranza-tabs'
import { CategoryDebtChart } from '@/views/payments/category-debt-chart'
import { categoryRowLabel } from '@/views/payments/account-format'
import type { DebtByCategoryRow } from '@/models/types'

/**
 * `/cobranza/por-categoria` (§13.5 de `00-architecture.md`): la deuda se
 * atribuye cargo por cargo a la categoría CONGELADA en el cargo (D32), así
 * que el total al pie —que viene de `dashboard_summary`, NUNCA sumado acá—
 * coincide con la deuda total del panel. `CategoryDebtChart` (`variant=
 * "full"`, dataviz: magnitud → barra) va arriba como la lectura rápida de
 * "quién debe más"; la `DataList` de siempre queda como la tabla accesible
 * equivalente, con TODAS las filas (incluidas las de deuda cero).
 */
export function DebtByCategoryView({ rows, totalCents }: { rows: DebtByCategoryRow[]; totalCents: number }) {
  const columns: DataListColumn<DebtByCategoryRow>[] = [
    { key: 'label', header: 'Categoría', render: (r) => categoryRowLabel(r) },
    { key: 'members', header: 'Socios', numeric: true, render: (r) => r.members },
    { key: 'inDebt', header: 'Con deuda', numeric: true, render: (r) => r.membersInDebt },
    { key: 'debt', header: 'Deuda', numeric: true, render: (r) => <Amount cents={r.debtCents} /> },
  ]

  function renderRow(row: DebtByCategoryRow): DataListRow {
    return {
      title: categoryRowLabel(row),
      subtitle: `${row.members} ${row.members === 1 ? 'socio' : 'socios'} · ${row.membersInDebt} con deuda`,
      meta: <Amount cents={row.debtCents} className="font-medium" />,
      href: row.kind === 'category' && row.categoryId != null ? `/cobranza/deuda?categoriaId=${row.categoryId}` : undefined,
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Deuda por categoría" description="La deuda de cada categoría, atribuida cargo por cargo." />
      <CobranzaTabs />
      <CategoryDebtChart rows={rows} variant="full" />
      <DataList
        items={rows}
        getKey={(r) => `${r.kind}-${r.categoryId ?? 'none'}`}
        columns={columns}
        renderRow={renderRow}
        emptyState={<EmptyState title="Todavía no hay categorías con cuotas generadas" />}
      />
      <Panel>
        <div className="flex items-center justify-between text-sm font-medium">
          <span>Deuda total</span>
          <Amount cents={totalCents} className="text-base" />
        </div>
      </Panel>
    </div>
  )
}
