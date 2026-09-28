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
import type { Payment } from '@/models/types'

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
