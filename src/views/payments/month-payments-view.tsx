import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { Amount } from '@/views/shared/money'
import { MonthSelector } from '@/views/payments/month-selector'
import { MonthPaymentsList } from '@/views/payments/month-payments-list'
import type { MonthCollection, Page, PaymentListItem } from '@/models/types'

/** `/cobranza/pagos?mes=`. Cero data fetching: todo llega resuelto de la page. */
export function MonthPaymentsView({
  period,
  collection,
  page,
  canVoid,
}: {
  period: string
  collection: MonthCollection
  page: Page<PaymentListItem>
  canVoid: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Pagos del mes" />
      <MonthSelector period={period} basePath="/cobranza/pagos" />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Cobrado</span>
            <Amount cents={collection.collectedCents} className="text-lg font-semibold" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Efectivo</span>
            <Amount cents={collection.cashCents} className="font-medium" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Transferencia</span>
            <Amount cents={collection.transferCents} className="font-medium" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-muted-foreground">Cantidad</span>
            <span className="font-medium tabular-nums">{collection.paymentsCount}</span>
          </div>
        </div>
      </Panel>

      <MonthPaymentsList period={period} initialPage={page} canVoid={canVoid} />
    </div>
  )
}
