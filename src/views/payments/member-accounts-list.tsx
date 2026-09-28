'use client'

import { useState } from 'react'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { Pagination } from '@/views/shared/pagination'
import { EmptyState } from '@/views/shared/states'
import { Amount } from '@/views/shared/money'
import { DebtStatusPill } from '@/views/shared/status-pill'
import { accountLineText, categoriesLabel, type ListingVariant } from '@/views/payments/account-format'
import { loadMoreMemberAccounts } from '@/controllers/reports.actions'
import type { AccountListFilters, MemberAccount, Page } from '@/models/types'

/**
 * "Ver más" acumulado en el cliente (mismo patrón que `MemberList`/
 * `AuditList`/`MonthPaymentsList`): `loadMoreMemberAccounts` (B4, Server
 * Action nueva post-entrega) es la única forma de pedir más de 200 socios de
 * un bucket, ya que `listMemberAccounts` pagina en páginas fijas de 200
 * (`ACCOUNTS_PAGE_SIZE`). `filters` NUNCA lleva `cursor` (lo agrega este
 * componente en cada pedido); el padre (`MemberAccountsListingView`) le pone
 * una `key` derivada de los filtros para remontarlo con estado fresco cuando
 * cambia un filtro real.
 */
export function MemberAccountsList({
  variant,
  initialPage,
  filters,
  emptyTitle,
  emptyDescription,
}: {
  variant: ListingVariant
  initialPage: Page<MemberAccount>
  filters: Pick<AccountListFilters, 'categoryId' | 'status'>
  emptyTitle: string
  emptyDescription: string
}) {
  const [state, setState] = useState<{ items: MemberAccount[]; nextCursor: string | null }>({
    items: initialPage.items,
    nextCursor: initialPage.nextCursor,
  })
  const [loadError, setLoadError] = useState<string | null>(null)

  async function handleLoadMore(cursor: string) {
    setLoadError(null)
    const result = await loadMoreMemberAccounts({
      debt: variant,
      categoryId: filters.categoryId,
      status: filters.status,
      cursor,
    })
    if (!result.ok) {
      setLoadError(result.error)
      return
    }
    setState((prev) => ({ items: [...prev.items, ...result.data.items], nextCursor: result.data.nextCursor }))
  }

  // En `/cobranza/al-dia` (variant "up_to_date") conviven socios al día y con
  // saldo a favor: la fila mobile ya distingue con `DebtStatusPill` (ver
  // `renderRow` abajo). La tabla de escritorio tenía las mismas columnas para
  // los dos listados y perdía esa distinción (review MINOR 6) — acá se agrega
  // el mismo pill como columna, en vez de "Meses" (que en este listado siempre
  // es 0/"—", no aporta).
  const columns: DataListColumn<MemberAccount>[] =
    variant === 'up_to_date'
      ? [
          { key: 'name', header: 'Apellido, Nombre', render: (m) => m.fullName },
          { key: 'categories', header: 'Categorías', render: (m) => categoriesLabel(m.categories) },
          { key: 'status', header: 'Estado', render: (m) => <DebtStatusPill status={m.debtStatus} /> },
          {
            key: 'amount',
            header: 'Saldo',
            numeric: true,
            render: (m) => <Amount cents={Math.abs(m.balanceCents)} className={m.debtStatus === 'credit' ? 'text-status-up-to-date' : undefined} />,
          },
        ]
      : [
          { key: 'name', header: 'Apellido, Nombre', render: (m) => m.fullName },
          { key: 'categories', header: 'Categorías', render: (m) => categoriesLabel(m.categories) },
          { key: 'months', header: 'Meses', numeric: true, render: (m) => (m.monthsDue > 0 ? m.monthsDue : '—') },
          { key: 'amount', header: 'Monto', numeric: true, render: (m) => <Amount cents={Math.abs(m.balanceCents)} /> },
        ]

  function renderRow(member: MemberAccount): DataListRow {
    return {
      title: member.fullName,
      subtitle: categoriesLabel(member.categories),
      meta:
        variant === 'up_to_date' ? (
          <>
            <DebtStatusPill status={member.debtStatus} />
            {member.debtStatus === 'credit' ? <span className="text-sm">{accountLineText(member)}</span> : null}
          </>
        ) : (
          <span className="text-sm tabular-nums">
            {member.monthsDue === 1 ? '1 mes' : `${member.monthsDue} meses`} · <Amount cents={member.balanceCents} />
          </span>
        ),
      href: `/socios/${member.memberId}`,
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DataList
        items={state.items}
        getKey={(m) => m.memberId}
        columns={columns}
        renderRow={renderRow}
        emptyState={<EmptyState title={emptyTitle} description={emptyDescription} />}
      />
      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : null}
      <Pagination nextCursor={state.nextCursor} onLoadMore={handleLoadMore} />
    </div>
  )
}
