'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { DateText } from '@/views/shared/date-text'
import { Amount } from '@/views/shared/money'
import { ReasonDialog, type ReasonDialogResult, type ReasonDialogValues } from '@/views/shared/reason-dialog'
import { paymentMethodLabels } from '@/views/shared/labels'
import { getReceiptUrlAction, voidPayment } from '@/controllers/payments.actions'
import { periodListLabel, periodRangeLabel } from '@/lib/dates'
import type { Payment } from '@/models/types'

const monthIndex = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7))

/**
 * "Cubre may y jul 2026" (hasta 3 meses); con más, un resumen que no esconde
 * los huecos: "Cubre 5 meses · enero a mayo 2026" si son corridos, "entre
 * enero y mayo 2026" si no. Sin imputaciones (todo saldo a favor) no hay línea.
 */
function coverText(payment: Payment): string | null {
  const periods = [...new Set(payment.allocations.map((a) => a.period.slice(0, 7) + '-01'))].sort()
  if (periods.length === 0) return null
  if (periods.length <= 3) return `Cubre ${periodListLabel(periods)}`
  const first = periods[0]
  const last = periods[periods.length - 1]
  const contiguous = monthIndex(last) - monthIndex(first) === periods.length - 1
  const span = periodRangeLabel(first, last)
  return contiguous ? `Cubre ${periods.length} meses · ${span}` : `Cubre ${periods.length} meses · entre ${span.replace(' a ', ' y ')}`
}

/** Lo que el pago no imputó a ninguna cuota: queda a favor del socio. */
function creditCents(payment: Payment): number {
  return payment.amountCents - payment.allocations.reduce((total, a) => total + a.amountCents, 0)
}

/**
 * Panel "Pagos" de la ficha (§13.6): fecha, monto, medio, quién los cargó,
 * comprobante bajo demanda (misma firma bajo demanda que el apto físico —
 * nunca una URL de Storage armada a mano) y "Anular" solo con
 * `payments.void`. Un pago anulado NUNCA desaparece: queda tachado con el
 * motivo (piso de calidad: nada se borra, la UI nunca dice que se borró).
 */
export function MemberPaymentsList({ payments, canVoid }: { payments: Payment[]; canVoid: boolean }) {
  const router = useRouter()
  const [voidingId, setVoidingId] = useState<number | null>(null)
  const [receiptLoadingId, setReceiptLoadingId] = useState<number | null>(null)
  const [receiptError, setReceiptError] = useState<string | null>(null)

  async function handleViewReceipt(paymentId: number) {
    setReceiptError(null)
    setReceiptLoadingId(paymentId)
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null
    try {
      const result = await getReceiptUrlAction({ paymentId })
      if (!result.ok || !result.data.url) {
        popup?.close()
        setReceiptError(result.ok ? 'Este pago no tiene comprobante.' : result.error)
        return
      }
      if (popup) popup.location.href = result.data.url
      else window.location.href = result.data.url
    } finally {
      setReceiptLoadingId(null)
    }
  }

  async function handleVoidConfirm(paymentId: number, values: ReasonDialogValues): Promise<ReasonDialogResult> {
    const result = await voidPayment({ paymentId, reason: values.reason })
    if (!result.ok) return { ok: false, error: result.error, field: result.field }
    toast.success('Pago anulado')
    router.refresh()
    return { ok: true }
  }

  return (
    <Panel title="Pagos">
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no se registraron pagos.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {[...payments]
            .sort((a, b) => (a.paidOn < b.paidOn ? 1 : a.paidOn > b.paidOn ? -1 : b.id - a.id))
            .map((payment) => (
              <li key={payment.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <DateText date={payment.paidOn} className="font-medium" />
                    {payment.voidedAt ? (
                      <s className="text-muted-foreground">
                        <Amount cents={payment.amountCents} />
                      </s>
                    ) : (
                      <Amount cents={payment.amountCents} className="font-medium" />
                    )}
                    <span className="text-sm text-muted-foreground">{paymentMethodLabels[payment.method]}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {payment.hasReceipt ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11"
                        disabled={receiptLoadingId === payment.id}
                        onClick={() => handleViewReceipt(payment.id)}
                      >
                        {receiptLoadingId === payment.id ? <Loader2 aria-hidden className="animate-spin" /> : null}
                        Ver comprobante
                      </Button>
                    ) : null}
                    {canVoid && !payment.voidedAt ? (
                      <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => setVoidingId(payment.id)}>
                        Anular pago
                      </Button>
                    ) : null}
                  </div>
                </div>
                {!payment.voidedAt ? <PaymentCoverage payment={payment} /> : null}
                <p className="text-xs text-muted-foreground">{payment.createdByName ?? 'Sistema'}</p>
                {payment.voidedAt ? (
                  <p className="text-sm text-status-in-debt">Anulado{payment.voidReason ? ` · ${payment.voidReason}` : ''}</p>
                ) : null}
              </li>
            ))}
        </ul>
      )}

      {receiptError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {receiptError}
        </p>
      ) : null}

      {voidingId != null ? (
        <ReasonDialog
          open={voidingId != null}
          onOpenChange={(v) => !v && setVoidingId(null)}
          title="Anular pago"
          consequence="El pago deja de contar para la deuda del socio. Queda registrado, tachado y con el motivo."
          actionLabel="Anular pago"
          onConfirm={(values) => handleVoidConfirm(voidingId, values)}
        />
      ) : null}
    </Panel>
  )
}

function PaymentCoverage({ payment }: { payment: Payment }) {
  const cover = coverText(payment)
  const credit = creditCents(payment)
  if (!cover && credit <= 0) return null
  return (
    <p className="text-sm text-muted-foreground">
      {cover}
      {cover && credit > 0 ? ' · ' : null}
      {credit > 0 ? (
        <span>
          Saldo a favor <Amount cents={credit} />
        </span>
      ) : null}
    </p>
  )
}
