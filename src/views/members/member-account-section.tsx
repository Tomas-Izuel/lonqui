'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { Amount } from '@/views/shared/money'
import { AmountField, TextareaField } from '@/views/shared/form-fields'
import { useOverlayParam, paymentOverlayValue } from '@/views/shared/overlay-params'
import { MemberAccountAnswer } from '@/views/members/member-account-answer'
import { createOpeningBalance } from '@/controllers/payments.actions'
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
    description: z.string().trim().max(500, 'La descripción no puede tener más de 500 caracteres'),
  })
  .superRefine((data, ctx) => {
    if (data.amountCents == null) {
      ctx.addIssue({ code: 'custom', message: 'Ingresá el monto del saldo anterior', path: ['amountCents'] })
    } else if (data.amountCents <= 0) {
      ctx.addIssue({ code: 'custom', message: 'El saldo anterior tiene que ser mayor a cero', path: ['amountCents'] })
    }
  })
type OpeningBalanceValues = z.infer<typeof openingBalanceSchema>

/**
 * Sección de cuenta, arriba del todo de la ficha (§13.6) — LA respuesta del
 * producto ("¿debe? ¿desde cuándo? ¿cuánto?"), por eso `MemberAccountAnswer`
 * (screenshot review, ronda 2) lleva el tratamiento más grande de toda la
 * ficha, antes de cualquier otro dato. Debajo: "Registrar pago" / "Pago del
 * grupo" (pipeline 2026-09-28-ui-expresiva, D1: abren el overlay de cobranza
 * sobre esta misma página con `useOverlayParam('pagar')`, nunca navegan a
 * `/cobranza/nuevo`) + "Cargar saldo anterior" cuando no hay uno vigente y la
 * facturación está activa.
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
  const paymentOverlay = useOverlayParam('pagar')
  const [showOpeningForm, setShowOpeningForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<OpeningBalanceValues>({
    resolver: zodResolver(openingBalanceSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { amountCents: null, description: '' },
  })

  const pending = form.formState.isSubmitting

  async function onValid(values: OpeningBalanceValues) {
    setFormError(null)
    const result = await createOpeningBalance({
      memberId,
      amountCents: values.amountCents!,
      description: values.description.trim() || undefined,
    })
    if (!result.ok) {
      if (result.field === 'amountCents' || result.field === 'description') {
        form.setError(result.field, { message: result.error })
      } else {
        setFormError(result.error)
      }
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
        {/* `variant="plain"` (code-review, ronda 3): ya estamos dentro de
            `Panel title="Cuenta"` — la tarjeta propia de `MemberAccountAnswer`
            se leía como una tarjeta anidada dentro de otra. */}
        <MemberAccountAnswer account={account} variant="plain" />

        {!billing.active ? <p className="text-sm text-muted-foreground">La facturación de cuotas todavía no está activada.</p> : null}

        {canRegister ? (
          <div className="flex flex-wrap gap-2">
            {/* Overlay sobre la página actual (D1, pipeline 2026-09-28): nunca
                se navega a /cobranza/nuevo, que ahora es solo un redirect fino
                para links viejos guardados. */}
            <Button type="button" className="h-11" onClick={() => paymentOverlay.set(paymentOverlayValue({ mode: 'socio', memberId }))}>
              Registrar pago
            </Button>
            {familyGroupId != null ? (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => paymentOverlay.set(paymentOverlayValue({ mode: 'grupo', familyGroupId }))}
              >
                Pago del grupo
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
