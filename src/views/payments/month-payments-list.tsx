'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { Pagination } from '@/views/shared/pagination'
import { EmptyState } from '@/views/shared/states'
import { Amount } from '@/views/shared/money'
import { DateText } from '@/views/shared/date-text'
import { ReasonDialog, type ReasonDialogResult, type ReasonDialogValues } from '@/views/shared/reason-dialog'
import { paymentMethodLabels } from '@/views/shared/labels'
import { formatPeriod } from '@/lib/dates'
import { getReceiptUrlAction, loadMoreMonthPayments, voidPayment } from '@/controllers/payments.actions'
import type { Page, PaymentListItem } from '@/models/types'

/**
 * Lista de `/cobranza/pagos`. "Ver más" acumula en el cliente (mismo patrón
 * que `MemberList`/`AuditList`); "Ver comprobante" firma la URL recién al
 * tocar (mismo patrón que `MedicalClearanceSection.handleViewClearance`, con
 * el mismo cuidado del bloqueador de popups); "Anular" solo si `canVoid`
 * (`payments.void`, T12 — nunca por rol).
 */
export function MonthPaymentsList({
  period,
  initialPage,
  canVoid,
}: {
  period: string
  initialPage: Page<PaymentListItem>
  canVoid: boolean
}) {
  const [state, setState] = useState<{ items: PaymentListItem[]; nextCursor: string | null }>({
    items: initialPage.items,
    nextCursor: initialPage.nextCursor,
  })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<PaymentListItem | null>(null)
  const [openingReceiptId, setOpeningReceiptId] = useState<number | null>(null)

  async function handleLoadMore(cursor: string) {
    setLoadError(null)
    const result = await loadMoreMonthPayments({ period, cursor })
    if (!result.ok) {
      setLoadError(result.error)
      return
    }
    setState((prev) => ({ items: [...prev.items, ...result.data.items], nextCursor: result.data.nextCursor }))
  }

  async function handleViewReceipt(paymentId: number) {
    setOpeningReceiptId(paymentId)
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null

    try {
      const result = await getReceiptUrlAction({ paymentId })
      if (!result.ok) {
        popup?.close()
        toast.error(result.error)
        return
      }
      if (!result.data.url) {
        popup?.close()
        toast.error('Este pago no tiene comprobante cargado')
        return
      }
      if (popup) {
        popup.location.href = result.data.url
      } else {
        window.location.href = result.data.url
      }
    } catch {
      popup?.close()
      toast.error('No pudimos abrir el comprobante. Probá de nuevo.')
    } finally {
      setOpeningReceiptId(null)
    }
  }

  async function handleVoidConfirm(values: ReasonDialogValues): Promise<ReasonDialogResult> {
    if (!voidTarget) return { ok: false, error: 'No encontramos el pago' }
    const result = await voidPayment({ paymentId: voidTarget.id, reason: values.reason })
    if (!result.ok) return { ok: false, error: result.error, field: result.field }

    setState((prev) => ({
      ...prev,
      items: prev.items.map((p) => (p.id === voidTarget.id ? { ...p, voided: true, voidReason: values.reason } : p)),
    }))
    toast.success('Pago anulado')
    return { ok: true }
  }

  const columns: DataListColumn<PaymentListItem>[] = [
    { key: 'date', header: 'Fecha', render: (p) => <DateText date={p.paidOn} /> },
    { key: 'member', header: 'Socio', render: (p) => p.memberFullName },
    {
      key: 'amount',
      header: 'Monto',
      numeric: true,
      render: (p) => <Amount cents={p.amountCents} className={p.voided ? 'text-muted-foreground line-through' : undefined} />,
    },
    { key: 'method', header: 'Medio', render: (p) => paymentMethodLabels[p.method] },
    { key: 'createdBy', header: 'Cargó', render: (p) => p.createdByName ?? '—' },
  ]

  function renderRow(payment: PaymentListItem): DataListRow {
    const hasMenu = payment.hasReceipt || (canVoid && !payment.voided)
    return {
      title: payment.memberFullName,
      subtitle: (
        <span className="flex flex-wrap items-center gap-2">
          <DateText date={payment.paidOn} />
          <span>{paymentMethodLabels[payment.method]}</span>
        </span>
      ),
      meta: (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <Amount cents={payment.amountCents} className={payment.voided ? 'text-muted-foreground line-through' : 'font-medium'} />
          {payment.voided ? (
            <s className="text-xs text-muted-foreground">Anulado{payment.voidReason ? `: ${payment.voidReason}` : ''}</s>
          ) : null}
        </span>
      ),
      actions: hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Más acciones" disabled={openingReceiptId === payment.id}>
              {openingReceiptId === payment.id ? <Loader2 aria-hidden className="animate-spin" /> : <MoreVertical aria-hidden />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {payment.hasReceipt ? (
              <DropdownMenuItem onSelect={() => handleViewReceipt(payment.id)}>Ver comprobante</DropdownMenuItem>
            ) : null}
            {canVoid && !payment.voided ? (
              <DropdownMenuItem variant="destructive" onSelect={() => setVoidTarget(payment)}>
                Anular pago
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : undefined,
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DataList
        items={state.items}
        getKey={(p) => p.id}
        columns={columns}
        renderRow={renderRow}
        emptyState={
          <EmptyState
            title="Todavía no se registraron pagos"
            description={`No hay pagos cargados en ${formatPeriod(period)}.`}
          />
        }
      />
      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : null}
      <Pagination nextCursor={state.nextCursor} onLoadMore={handleLoadMore} />

      {voidTarget ? (
        <ReasonDialog
          open={Boolean(voidTarget)}
          onOpenChange={(open) => {
            if (!open) setVoidTarget(null)
          }}
          title={`Anular el pago de ${voidTarget.memberFullName}`}
          consequence="Deja de contar para la deuda del socio y para la cobranza de este mes. Queda registrado, tachado, con el motivo."
          actionLabel="Anular pago"
          onConfirm={handleVoidConfirm}
        />
      ) : null}
    </div>
  )
}
