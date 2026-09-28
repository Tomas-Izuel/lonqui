'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { DebtStatusPill } from '@/views/shared/status-pill'
import { Amount } from '@/views/shared/money'
import { DateText } from '@/views/shared/date-text'
import { AmountField, TextareaField } from '@/views/shared/form-fields'
import { createOpeningBalance } from '@/controllers/payments.actions'
import { accountLineText } from '@/views/payments/account-format'
import type { BillingStatus, Fee, MemberAccount } from '@/models/types'

/**
 * `amountCents` llega `null` mientras el campo está vacío o no se pudo
 * parsear (lo resuelve `AmountField`), así que la obligatoriedad se chequea
 * en `superRefine` y no con `z.number()` solo — mismo patrón que
 * `new-fee-price-sheet.tsx` y `payment-form.tsx` (F1/F4, no se toca acá).
 */
const openingBalanceSchema = z
  .object({
    amountCents: z.number().nullable(),
    description: z.string().trim().max(500),
  })
  .superRefine((data, ctx) => {
    if (data.amountCents == null || data.amountCents <= 0) {
      ctx.addIssue({ code: 'custom', message: 'El saldo anterior tiene que ser mayor a cero', path: ['amountCents'] })
    }
  })
type OpeningBalanceValues = z.infer<typeof openingBalanceSchema>

/**
 * Sección de cuenta, arriba del todo de la ficha (§13.6): estado + último
 * pago + accesos a `/cobranza/nuevo` (Registrar pago / Pago del grupo, ese
 * formulario lo construye F1 en paralelo) + "Cargar saldo anterior" cuando
 * no hay uno vigente y la facturación está activa. Con facturación
 * inactiva: una sola línea que lo explica, sin ceros que puedan asustar
 * (un "Debe $0 · 0 meses" se lee como una deuda real).
 */
export function MemberAccountSection({
  memberId,
  familyGroupId,
  account,
  openingBalance,
  billing,
  canRegister,
}: {
  memberId: number
  familyGroupId: number | null
  account: MemberAccount
  openingBalance: Fee | null
  billing: BillingStatus
  canRegister: boolean
}) {
  const router = useRouter()
  const [showOpeningForm, setShowOpeningForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<OpeningBalanceValues>({
    resolver: zodResolver(openingBalanceSchema),
    defaultValues: { amountCents: null, description: '' },
  })

  const pending = form.formState.isSubmitting
  const volver = `/socios/${memberId}`

  async function onValid(values: OpeningBalanceValues) {
    setFormError(null)
    const result = await createOpeningBalance({
      memberId,
      amountCents: values.amountCents!,
      description: values.description.trim() || undefined,
    })
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    toast.success('Saldo anterior cargado')
    setShowOpeningForm(false)
    form.reset()
    router.refresh()
  }

  return (
    <Panel title="Cuenta">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DebtStatusPill status={account.debtStatus} />
          {/* Mismo texto que `PaymentForm`/`GroupPaymentForm` (F1, `account-format.ts`):
              una sola fuente para "Debe $X · N meses" / "Al día" / "Saldo a
              favor $X" / "Dado de baja · debe $X" en toda la app. */}
          <p className="text-sm">{accountLineText(account)}</p>
        </div>

        {account.lastPaymentOn ? (
          <p className="text-sm text-muted-foreground">
            Último pago: <Amount cents={account.lastPaymentCents ?? 0} /> el <DateText date={account.lastPaymentOn} />
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no registró ningún pago.</p>
        )}

        {!billing.active ? <p className="text-sm text-muted-foreground">La facturación de cuotas todavía no está activada.</p> : null}

        {canRegister ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild className="h-11">
              <Link href={`/cobranza/nuevo?socio=${memberId}&volver=${volver}`}>Registrar pago</Link>
            </Button>
            {familyGroupId != null ? (
              <Button asChild variant="outline" className="h-11">
                <Link href={`/cobranza/nuevo?grupo=${familyGroupId}&socio=${memberId}&volver=${volver}`}>Pago del grupo</Link>
              </Button>
            ) : null}
          </div>
        ) : null}

        {canRegister && billing.active ? (
          openingBalance == null ? (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              {!showOpeningForm ? (
                <Button type="button" variant="outline" className="h-11 w-fit" onClick={() => setShowOpeningForm(true)}>
                  Cargar saldo anterior
                </Button>
              ) : (
                <form onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-3">
                  <AmountField control={form.control} name="amountCents" label="Saldo anterior" disabled={pending} />
                  <TextareaField
                    control={form.control}
                    name="description"
                    label="Descripción (opcional)"
                    placeholder="Ej. saldo de la planilla 2025"
                    disabled={pending}
                  />
                  {formError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {formError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={pending} className="h-11">
                      {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
                      {pending ? 'Guardando…' : 'Cargar saldo anterior'}
                    </Button>
                    <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={() => setShowOpeningForm(false)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <p className="border-t border-border pt-3 text-sm text-muted-foreground">
              Ya tiene un saldo anterior cargado: <Amount cents={openingBalance.amountCents} />.
            </p>
          )
        ) : null}
      </div>
    </Panel>
  )
}
