'use client'

import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { AmountField, DateField, TextareaField } from '@/views/shared/form-fields'
import { DebtStatusPill } from '@/views/shared/status-pill'
import { paymentMethodLabels } from '@/views/shared/labels'
import { toClubDate } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import { registerPayment } from '@/controllers/payments.actions'
import { accountLineText, categoriesLabel, currentFeeLabel } from '@/views/payments/account-format'
import { METHOD_ERROR_ID, PAYMENT_MIN_DATE, amountCentsSchema, methodSchema, notesSchema, paidOnSchema } from '@/views/payments/payment-schema'
import { ReceiptPicker } from '@/views/payments/receipt-picker'
import { uploadReceipt } from '@/views/payments/receipt-upload'
import { MonthEntry, creditOf, debtLine, entryDebtAfter, entryDerivedCents, entryEffectiveOptions, entryOpeningBalance, initialEntry, type EntryState } from '@/views/payments/month-entry'
import { coverLabel, coverageForAmount } from '@/views/payments/month-selection'
import { AlertCircle } from 'lucide-react'
import type { ISODate, MemberAccount, OpeningBalanceMonths, PaymentMonthOption } from '@/models/types'

const schema = z.object({
  amountCents: amountCentsSchema,
  paidOn: paidOnSchema,
  method: methodSchema,
  notes: notesSchema,
})

type FormValues = z.infer<typeof schema>

const KNOWN_FIELDS = ['amountCents', 'paidOn', 'method', 'notes'] as const
const PAYMENT_PATH_FIELDS = ['items', 'memberId']

function isKnownField(field: string | undefined): field is (typeof KNOWN_FIELDS)[number] {
  return (KNOWN_FIELDS as readonly string[]).includes(field ?? '')
}

/** "Pago registrado" + cómo queda la cuenta, para el toast al volver (route-caja.md). */
function resultingAccountMessage(member: MemberAccount, amountCents: number, openingBalance: OpeningBalanceMonths | null): string {
  // El saldo anterior que se crea en el mismo envío suma deuda antes de que el pago la cubra.
  const newBalance = member.balanceCents + (openingBalance?.amountCents ?? 0) - amountCents
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
  options,
  startPeriod,
  billingStarted,
  onDone,
  onSuccess,
}: {
  member: MemberAccount
  /** Celdas de la tira. Vacío (cuotas sin activar, baja al día) = el formulario de monto de siempre. */
  options: PaymentMonthOption[]
  /** Primer mes de la facturación (`billing.startPeriod`), para la tira de meses previos. */
  startPeriod?: ISODate | null
  /** La facturación ya arrancó. Antes del inicio todo es carga inicial: la grilla de meses abre abierta. */
  billingStarted: boolean
  onDone: () => void
  /** Avisa monto y, si hubo meses, "Cubre ago–oct" (o "Pago a cuenta") justo antes de `onDone`. */
  onSuccess?: (amountCents: number, label?: string) => void
}) {
  const [batchId] = useState(() => crypto.randomUUID())
  const [file, setFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)
  const [uploadStage, setUploadStage] = useState<'idle' | 'uploading'>('idle')

  const precargaLabel = currentFeeLabel(member)
  const isInactiveWithDebt = member.status === 'inactive' && member.debtStatus === 'in_debt'
  const hasStrip = options.length > 0
  const creditCents = creditOf(member.balanceCents)
  const [entry, setEntry] = useState<EntryState>(() => initialEntry(options, member.status, { expanded: !billingStarted }))
  const defaultAmount = hasStrip
    ? entry.custom
      ? null
      : entryDerivedCents(options, entry, creditCents)
    : isInactiveWithDebt
      ? member.balanceCents
      : (member.currentFeeCents ?? null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amountCents: defaultAmount, paidOn: toClubDate(), method: 'cash', notes: '' },
  })

  const amountCents = useWatch({ control: form.control, name: 'amountCents' })
  const method = useWatch({ control: form.control, name: 'method' })
  const pending = form.formState.isSubmitting
  // En modo meses un derivado de $0 (el saldo a favor ya cubre lo marcado) no es un pago.
  // El resumen de lo marcado vive arriba, junto a "Cambiar": el pie solo suma lo que
  // conviene tener a la vista justo antes de confirmar.
  let footerLine: string | null = null
  if (hasStrip && entry.custom) {
    const left = coverageForAmount(options, entry.selection, amountCents ?? 0, { openingBalanceOverrideCents: entry.overrideCents, creditCents }).leftoverCents
    footerLine = left > 0 ? `Pago a cuenta · queda saldo a favor de ${formatCentsCompact(left)}` : 'Pago a cuenta'
  }
  const debtAfter = hasStrip ? entryDebtAfter(options, entry, creditCents) : { months: 0, cents: 0 }
  const blocked = hasStrip && (entry.overrideInvalid || (!entry.custom && entryDerivedCents(options, entry, creditCents) <= 0))

  async function onValid(values: FormValues) {
    const cents = values.amountCents as number

    // Sin confirmación bloqueante de sobrepago (brief 2026-10-24): marcar un
    // adelanto es explícito y "Otro monto" avisa en línea si queda saldo a favor.
    setFormError(null)
    setReceiptError(null)
    let receiptPath: string | null = null

    if (values.method === 'transfer' && file) {
      setUploadStage('uploading')
      const uploaded = await uploadReceipt(member.memberId, file)
      setUploadStage('idle')
      if ('error' in uploaded) {
        // Debajo del selector de comprobante, que es el control que lo causó.
        setReceiptError(uploaded.error)
        return
      }
      receiptPath = uploaded.path
    }

    const openingBalance = hasStrip ? entryOpeningBalance(options, entry) : null
    const result = await registerPayment({
      batchId,
      paidOn: values.paidOn,
      method: values.method,
      items: [{ memberId: member.memberId, amountCents: cents, openingBalance }],
      notes: values.notes.trim() || null,
      receiptPath,
      familyGroupId: null,
    })

    if (!result.ok) {
      if (isKnownField(result.field)) {
        if (result.field === 'notes') setNotesOpen(true)
        form.setError(result.field, { message: result.error })
        form.setFocus(result.field)
      } else if (result.field === 'receiptPath') {
        setReceiptError(result.error)
      } else if (result.field && PAYMENT_PATH_FIELDS.includes(result.field) && (!hasStrip || entry.custom)) {
        // Un error de `items` es el monto: el único ítem de este formulario.
        form.setError('amountCents', { message: result.error })
      } else {
        setFormError(result.error)
      }
      return
    }

    if (result.data.alreadyRegistered) {
      // Un reintento no toca nada: lo que vale es lo que quedó registrado la primera vez, no lo que tiene el formulario ahora.
      toast.success('El pago ya estaba registrado')
      if (openingBalance && result.data.openingBalanceFeeIds.length === 0) {
        toast.warning('El saldo anterior no se cargó. Indicá desde cuándo debía desde la ficha del socio.')
      }
      onSuccess?.(result.data.totalCents)
    } else {
      toast.success(resultingAccountMessage(member, cents, openingBalance))
      const months = hasStrip && !entry.custom ? coverLabel(entryEffectiveOptions(options, entry, creditCents), entry.selection) : ''
      onSuccess?.(cents, hasStrip ? (months ? `Cubre ${months}` : 'Pago a cuenta') : undefined)
    }
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
          {hasStrip ? (
            <MonthEntry
              options={options}
              entry={entry}
              onEntryChange={setEntry}
              control={form.control}
              amountName="amountCents"
              onAmountChange={(cents) => form.setValue('amountCents', cents, { shouldValidate: form.formState.isSubmitted })}
              creditCents={creditCents}
              error={form.formState.errors.amountCents?.message}
              disabled={pending}
              showTotal={false}
              showDebtLine={false}
              startPeriod={startPeriod}
            />
          ) : (
            <AmountField control={form.control} name="amountCents" label="Monto" autoFocus />
          )}

          <DateField control={form.control} name="paidOn" label="Fecha" max={toClubDate()} min={PAYMENT_MIN_DATE} disabled={pending} />

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
                  aria-describedby={form.formState.errors.method ? METHOD_ERROR_ID : undefined}
                  onClick={() => form.setValue('method', value, { shouldValidate: true })}
                >
                  {paymentMethodLabels[value]}
                </Button>
              ))}
            </div>
            {form.formState.errors.method ? (
              <FieldError id={METHOD_ERROR_ID} role="alert">
                {form.formState.errors.method.message}
              </FieldError>
            ) : null}
          </div>

          {method === 'transfer' ? (
            <ReceiptPicker
              file={file}
              onChange={(next) => {
                setReceiptError(null)
                setFile(next)
              }}
              error={receiptError}
              disabled={pending}
            />
          ) : null}

          {notesOpen ? (
            <TextareaField control={form.control} name="notes" label="Notas" placeholder="Opcional" disabled={pending} />
          ) : (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 w-fit" onClick={() => setNotesOpen(true)}>
              Agregar nota
            </Button>
          )}

          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-2 flex flex-col gap-2 border-t border-border bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {footerLine ? (
              <p role="status" className="text-sm text-muted-foreground tabular-nums">
                {footerLine}
              </p>
            ) : null}
            {debtAfter.months > 0 ? (
              <p className="flex items-start gap-1.5 text-sm font-medium tabular-nums">
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-in-debt" />
                {debtLine(debtAfter)}
              </p>
            ) : null}
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={pending || blocked} className="h-11 w-full">
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {uploadStage === 'uploading'
                ? 'Subiendo comprobante…'
                : `Registrar pago${amountCents ? ` de ${formatCentsCompact(amountCents)}` : ''}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
