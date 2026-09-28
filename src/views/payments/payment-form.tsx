'use client'

import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AmountField, DateField, TextareaField } from '@/views/shared/form-fields'
import { DebtStatusPill } from '@/views/shared/status-pill'
import { paymentMethodLabels } from '@/views/shared/labels'
import { toClubDate } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import { registerPayment } from '@/controllers/payments.actions'
import { accountLineText, categoriesLabel, currentFeeLabel } from '@/views/payments/account-format'
import { ReceiptPicker } from '@/views/payments/receipt-picker'
import { uploadReceipt } from '@/views/payments/receipt-upload'
import type { MemberAccount, PaymentMethod } from '@/models/types'

const schema = z
  .object({
    amountCents: z.number().nullable(),
    paidOn: z.string().min(1, 'Elegí una fecha'),
    method: z.enum(['cash', 'transfer'] satisfies PaymentMethod[]),
    notes: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.amountCents == null || data.amountCents <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Ingresá un monto mayor a cero', path: ['amountCents'] })
    }
  })

type FormValues = z.infer<typeof schema>

const KNOWN_FIELDS = ['amountCents', 'paidOn', 'method', 'notes'] as const

function isKnownField(field: string | undefined): field is (typeof KNOWN_FIELDS)[number] {
  return (KNOWN_FIELDS as readonly string[]).includes(field ?? '')
}

/** "Pago registrado" + cómo queda la cuenta, para el toast al volver (route-cobranza.md). */
function resultingAccountMessage(member: MemberAccount, amountCents: number): string {
  const newBalance = member.balanceCents - amountCents
  if (newBalance < 0) return `Pago registrado. Queda saldo a favor de ${formatCentsCompact(-newBalance)}.`
  if (newBalance === 0) return 'Pago registrado. La cuenta quedó al día.'
  return `Pago registrado. Todavía debe ${formatCentsCompact(newBalance)}.`
}

/**
 * Registrar pago de UN socio (`?pagar=socio:<id>`, overlay global de
 * cobranza). El pago de grupo
 * familiar es `GroupPaymentForm`, un formulario distinto (lote de N filas):
 * comparten el "look" pero no la forma de los datos, así que no vale la pena
 * forzar una sola implementación genérica (se probó y quedaba más difícil de
 * leer que dos componentes chicos).
 *
 * `onDone` decide qué pasa después de un registro exitoso: lo llama
 * `RegisterPaymentSheetBody` (overlay global de cobranza, pipeline
 * 2026-09-28-ui-expresiva) para cerrar el sheet y refrescar — el formulario
 * no sabe ni le importa qué hace. `onSuccess`, opcional, avisa el monto justo
 * ANTES de `onDone`: es lo que le permite a `RegisterPaymentSheetBody` mostrar
 * el momento autorado (check + monto) sin que este componente conozca nada de
 * esa animación.
 */
export function PaymentForm({
  member,
  onDone,
  onSuccess,
}: {
  member: MemberAccount
  onDone: () => void
  onSuccess?: (amountCents: number) => void
}) {
  const [batchId] = useState(() => crypto.randomUUID())
  const [file, setFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [needsOverpayConfirm, setNeedsOverpayConfirm] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [uploadStage, setUploadStage] = useState<'idle' | 'uploading'>('idle')

  const precargaLabel = currentFeeLabel(member)
  const isInactiveWithDebt = member.status === 'inactive' && member.debtStatus === 'in_debt'
  const defaultAmount = isInactiveWithDebt ? member.balanceCents : (member.currentFeeCents ?? null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amountCents: defaultAmount, paidOn: toClubDate(), method: 'cash', notes: '' },
  })

  const amountCents = useWatch({ control: form.control, name: 'amountCents' })
  const method = useWatch({ control: form.control, name: 'method' })
  const pending = form.formState.isSubmitting

  function setAmount(cents: number) {
    form.setValue('amountCents', cents, { shouldValidate: true })
    setNeedsOverpayConfirm(false)
  }

  const chips: { label: string; cents: number }[] = []
  if (member.currentFeeCents != null && member.currentFeeCents > 0) {
    chips.push({ label: '1 mes', cents: member.currentFeeCents })
    chips.push({ label: '2 meses', cents: member.currentFeeCents * 2 })
    chips.push({ label: '3 meses', cents: member.currentFeeCents * 3 })
  }
  // Solo si la deuda total es MAYOR a un mes (D12-C): con exactamente un mes
  // de deuda, "Toda la deuda" y el chip "1 mes" son el mismo monto — mostrar
  // los dos duplica la opción en la pantalla de cobro más usada del sistema.
  if (member.debtStatus === 'in_debt' && member.balanceCents > (member.currentFeeCents ?? 0)) {
    chips.push({ label: `Toda la deuda (${formatCentsCompact(member.balanceCents)})`, cents: member.balanceCents })
  }

  async function onValid(values: FormValues) {
    const cents = values.amountCents as number

    // Confirmación cuando el pago excede la deuda (route-cobranza.md): solo
    // tiene sentido si TODAVÍA debe algo — pagar por adelantado con los chips
    // "2/3 meses" es un flujo esperado (D13) y no interrumpe.
    if (member.debtStatus === 'in_debt' && cents > member.balanceCents && !needsOverpayConfirm) {
      setNeedsOverpayConfirm(true)
      return
    }

    setFormError(null)
    let receiptPath: string | null = null

    if (values.method === 'transfer' && file) {
      setUploadStage('uploading')
      const uploaded = await uploadReceipt(member.memberId, file)
      setUploadStage('idle')
      if ('error' in uploaded) {
        setFormError(uploaded.error)
        return
      }
      receiptPath = uploaded.path
    }

    const result = await registerPayment({
      batchId,
      paidOn: values.paidOn,
      method: values.method,
      items: [{ memberId: member.memberId, amountCents: cents }],
      notes: values.notes.trim() || null,
      receiptPath,
      familyGroupId: null,
    })

    if (!result.ok) {
      if (isKnownField(result.field)) {
        form.setError(result.field, { message: result.error })
      } else {
        setFormError(result.error)
      }
      return
    }

    toast.success(result.data.alreadyRegistered ? 'El pago ya estaba registrado' : resultingAccountMessage(member, cents))
    onSuccess?.(cents)
    onDone()
  }

  // La pill repite el mismo texto que `accountLineText` exactamente cuando
  // está al día ("Al día" al lado de "Al día"): se muestra solo cuando dice
  // algo que la línea de cuenta no dice (deuda con monto y meses, saldo a
  // favor), nunca como decoración redundante del mismo estado.
  const showDebtPill = member.debtStatus !== 'up_to_date'

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <div className="flex flex-col gap-1.5 pb-4">
        <p className="text-lg font-semibold text-balance">{member.fullName}</p>
        <p className="text-sm text-muted-foreground">{categoriesLabel(member.categories)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {showDebtPill ? <DebtStatusPill status={member.debtStatus} /> : null}
          <span className="text-sm">{accountLineText(member)}</span>
        </div>
        {precargaLabel ? <p className="text-sm text-muted-foreground">{precargaLabel}</p> : null}
      </div>

      <div className="border-t border-border pt-4">
        <form
          id="payment-form"
          onSubmit={form.handleSubmit(onValid)}
          noValidate
          method="post"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <AmountField control={form.control} name="amountCents" label="Monto" autoFocus />
            {chips.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <Button key={chip.label} type="button" variant="outline" size="sm" disabled={pending} onClick={() => setAmount(chip.cents)}>
                    {chip.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          <DateField control={form.control} name="paidOn" label="Fecha" max={toClubDate()} min="2020-01-01" disabled={pending} />

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Medio de pago</span>
            <div className="flex gap-2">
              {(['cash', 'transfer'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={method === value ? 'default' : 'outline'}
                  disabled={pending}
                  className="h-12 flex-1"
                  aria-pressed={method === value}
                  onClick={() => form.setValue('method', value, { shouldValidate: true })}
                >
                  {paymentMethodLabels[value]}
                </Button>
              ))}
            </div>
          </div>

          {method === 'transfer' ? <ReceiptPicker file={file} onChange={setFile} disabled={pending} /> : null}

          {notesOpen ? (
            <TextareaField control={form.control} name="notes" label="Notas" placeholder="Opcional" disabled={pending} />
          ) : (
            <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setNotesOpen(true)}>
              Agregar nota
            </Button>
          )}

          {needsOverpayConfirm ? (
            <div className="flex flex-col gap-2 rounded-lg border border-status-in-debt/30 bg-status-in-debt/5 p-3">
              <p className="text-sm">
                El pago supera la deuda actual ({formatCentsCompact(member.balanceCents)}). Va a quedar un saldo a favor de{' '}
                {formatCentsCompact((amountCents ?? 0) - member.balanceCents)}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" form="payment-form" disabled={pending} className="h-11">
                  Sí, registrar igual
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={() => setNeedsOverpayConfirm(false)}>
                  Ajustar el monto
                </Button>
              </div>
            </div>
          ) : null}

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          {!needsOverpayConfirm ? (
            <Button type="submit" disabled={pending} className="h-11 w-full">
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {uploadStage === 'uploading'
                ? 'Subiendo comprobante…'
                : `Registrar pago${amountCents ? ` de ${formatCentsCompact(amountCents)}` : ''}`}
            </Button>
          ) : null}
        </form>
      </div>
    </div>
  )
}
