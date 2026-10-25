'use client'

import { useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/components/ui/field'
import { AmountField, DateField, TextareaField } from '@/views/shared/form-fields'
import { paymentMethodLabels, memberStatusLabels } from '@/views/shared/labels'
import { toClubDate } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import { registerPayment } from '@/controllers/payments.actions'
import { accountLineText } from '@/views/payments/account-format'
import {
  AMOUNT_POSITIVE_MESSAGE,
  METHOD_ERROR_ID,
  AMOUNT_REQUIRED_MESSAGE,
  PAYMENT_MIN_DATE,
  methodSchema,
  notesSchema,
  paidOnSchema,
} from '@/views/payments/payment-schema'
import { ReceiptPicker } from '@/views/payments/receipt-picker'
import { uploadReceipt } from '@/views/payments/receipt-upload'
import { MonthEntry, creditOf, entryDerivedCents, entryOpeningBalance, initialEntry, type EntryState } from '@/views/payments/month-entry'
import { BeforeStartNote } from '@/views/payments/month-strip'
import { isBeforeStart } from '@/views/payments/month-selection'
import type { FamilyGroupSummary, ISODate, MemberAccount, PaymentMonthOption } from '@/models/types'

const rowSchema = z.object({
  memberId: z.number(),
  fullName: z.string(),
  status: z.enum(['active', 'inactive']),
  checked: z.boolean(),
  // Solo se exige monto en las filas tildadas (superRefine abajo): una fila
  // destildada puede quedar vacía sin molestar.
  amountCents: z.number().nullable(),
})

const schema = z
  .object({
    paidOn: paidOnSchema,
    method: methodSchema,
    notes: notesSchema,
    rows: z.array(rowSchema),
  })
  .superRefine((data, ctx) => {
    const checkedRows = data.rows.filter((row) => row.checked)
    if (checkedRows.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Tildá al menos un integrante para registrar el pago', path: ['rows'] })
      return
    }
    data.rows.forEach((row, rowIndex) => {
      if (!row.checked) return
      if (row.amountCents == null) {
        ctx.addIssue({ code: 'custom', message: AMOUNT_REQUIRED_MESSAGE, path: ['rows', rowIndex, 'amountCents'] })
      } else if (!Number.isInteger(row.amountCents) || row.amountCents <= 0) {
        ctx.addIssue({ code: 'custom', message: AMOUNT_POSITIVE_MESSAGE, path: ['rows', rowIndex, 'amountCents'] })
      }
    })
  })

type FormValues = z.infer<typeof schema>

/**
 * Pago de grupo familiar (`?pagar=grupo:<id>`, overlay global de cobranza):
 * un integrante por fila,
 * cuota precargada editable, UN solo `batchId` para todo el lote (T2, D22) —
 * el índice único `(batch_id, member_id)` en `payments` es lo que hace que un
 * doble toque reintente el mismo lote en vez de duplicar filas.
 */
export function GroupPaymentForm({
  members,
  monthOptions,
  familyGroup,
  startPeriod,
  onDone,
  onSuccess,
}: {
  members: MemberAccount[]
  /** Celdas por socio; sin entrada o vacío = ese integrante carga el monto a mano. */
  monthOptions: Record<number, PaymentMonthOption[]>
  familyGroup: FamilyGroupSummary
  /** Primer mes de la facturación (`billing.startPeriod`), para la tira de meses previos. */
  startPeriod?: ISODate | null
  /**
   * La facturación ya arrancó. En grupo la grilla de cada integrante arranca cerrada
   * siempre (N grillas no entran en el sheet); se acepta por contrato con el pago individual.
   */
  billingStarted?: boolean
  /** Qué pasa después de un registro exitoso (ver el comentario en `PaymentForm`). */
  onDone: () => void
  /** Avisa el total del lote justo antes de `onDone` (ver `PaymentForm`). */
  onSuccess?: (amountCents: number, label?: string) => void
}) {
  const [batchId] = useState(() => crypto.randomUUID())
  const [file, setFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [uploadStage, setUploadStage] = useState<'idle' | 'uploading'>('idle')

  // Un estado de entrada por integrante: la tira, el pliegue "desde cuándo" y
  // "Otro monto" son independientes entre hermanos.
  const [entries, setEntries] = useState<Record<number, EntryState>>(() =>
    Object.fromEntries(
      members.filter((m) => (monthOptions[m.memberId] ?? []).length > 0).map((m) => [m.memberId, initialEntry(monthOptions[m.memberId], m.status, { expanded: false })]),
    ),
  )

  function defaultRowAmount(m: MemberAccount): number | null {
    const options = monthOptions[m.memberId] ?? []
    if (options.length > 0) {
      const entry = entries[m.memberId] ?? initialEntry(options, m.status, { expanded: false })
      return entry.custom ? null : entryDerivedCents(options, entry, creditOf(m.balanceCents))
    }
    return m.status === 'inactive' && m.debtStatus === 'in_debt' ? m.balanceCents : (m.currentFeeCents ?? null)
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      paidOn: toClubDate(),
      method: 'cash',
      notes: '',
      rows: members.map((m) => ({
        memberId: m.memberId,
        fullName: m.fullName,
        status: m.status,
        checked: m.status === 'active',
        amountCents: defaultRowAmount(m),
      })),
    },
  })

  const { fields } = useFieldArray({ control: form.control, name: 'rows' })
  const method = useWatch({ control: form.control, name: 'method' })
  const rows = useWatch({ control: form.control, name: 'rows' })
  const pending = form.formState.isSubmitting

  const totalCents = rows.filter((row) => row.checked).reduce((total, row) => total + (row.amountCents ?? 0), 0)
  const anyInvalidOverride = rows.some((row) => row.checked && entries[row.memberId]?.overrideInvalid)
  const checkedCount = rows.filter((row) => row.checked).length
  const accountByMemberId = new Map(members.map((m) => [m.memberId, m]))
  const rowsErrorRaw = form.formState.errors.rows?.message
  const rowsError = typeof rowsErrorRaw === 'string' ? rowsErrorRaw : undefined

  async function onValid(values: FormValues) {
    const checkedRows = values.rows.filter((row) => row.checked)

    // Sin confirmación bloqueante de sobrepago (brief 2026-10-24): cada fila
    // avisa en línea si queda saldo a favor.
    setFormError(null)
    setReceiptError(null)

    let receiptPath: string | null = null
    if (values.method === 'transfer' && file) {
      setUploadStage('uploading')
      // El comprobante se sube a nombre del primer integrante del lote: un
      // solo archivo cubre las N filas (payments.model.ts, S2).
      const uploaded = await uploadReceipt(checkedRows[0].memberId, file)
      setUploadStage('idle')
      if ('error' in uploaded) {
        setReceiptError(uploaded.error)
        return
      }
      receiptPath = uploaded.path
    }

    const items = checkedRows.map((row) => {
      const options = monthOptions[row.memberId] ?? []
      const entry = entries[row.memberId]
      return {
        memberId: row.memberId,
        amountCents: row.amountCents as number,
        openingBalance: options.length > 0 && entry ? entryOpeningBalance(options, entry) : null,
      }
    })

    const result = await registerPayment({
      batchId,
      paidOn: values.paidOn,
      method: values.method,
      items,
      notes: values.notes.trim() || null,
      receiptPath,
      familyGroupId: familyGroup.id,
    })

    if (!result.ok) {
      // Cada error del servidor cae debajo del control que lo causó; sin campo
      // reconocible, queda el mensaje del formulario.
      if (result.field === 'paidOn' || result.field === 'method' || result.field === 'notes') {
        form.setError(result.field, { message: result.error })
        form.setFocus(result.field)
      } else if (result.field === 'receiptPath') {
        setReceiptError(result.error)
      } else if (result.field === 'items' || result.field === 'amountCents' || result.field === 'familyGroupId') {
        form.setError('rows', { message: result.error })
      } else {
        setFormError(result.error)
      }
      return
    }

    if (result.data.alreadyRegistered) {
      toast.success('El pago ya estaba registrado')
      const withOpening = items.filter((item) => item.openingBalance).length
      if (withOpening > result.data.openingBalanceFeeIds.length) {
        toast.warning('Algún saldo anterior no se cargó. Indicá desde cuándo debía desde la ficha del socio.')
      }
      onSuccess?.(result.data.totalCents)
    } else {
      toast.success(`Pago registrado para ${checkedRows.length} ${checkedRows.length === 1 ? 'integrante' : 'integrantes'}.`)
      onSuccess?.(totalCents)
    }
    onDone()
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <div className="flex flex-col gap-1 pb-4">
        <p className="text-lg font-semibold text-balance">{familyGroup.label}</p>
        <p className="text-sm text-muted-foreground">Grupo familiar</p>
      </div>

      <div className="border-t border-border pt-4">
        <form id="group-payment-form" onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
          <p className="text-sm font-medium">Integrantes</p>
          {startPeriod && Object.values(monthOptions).some(isBeforeStart) ? <BeforeStartNote startPeriod={startPeriod} /> : null}
          <ul className="flex flex-col divide-y divide-border">
            {fields.map((field, index) => {
              const account = accountByMemberId.get(field.memberId)
              const options = monthOptions[field.memberId] ?? []
              const entry = entries[field.memberId]
              return (
                <li key={field.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  {/* `field.memberId`, no `field.id`: el id que genera
                      `useFieldArray` no es estable entre el render del
                      servidor y la hidratación del cliente, y usarlo en un
                      atributo `id`/`htmlFor` (a diferencia de la `key` de la
                      lista, que nunca llega al DOM) produce un mismatch de
                      hidratación — se vio en la verificación con Playwright. */}
                  <Label htmlFor={`row-${field.memberId}-checked`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 font-normal">
                    <Checkbox
                      id={`row-${field.memberId}-checked`}
                      checked={rows[index]?.checked ?? false}
                      onCheckedChange={(checked) => form.setValue(`rows.${index}.checked`, checked === true, { shouldValidate: true })}
                      disabled={pending}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{field.fullName}</span>
                      <span className="text-xs text-muted-foreground">
                        {field.status === 'inactive' ? `${memberStatusLabels.inactive} · ` : ''}
                        {account ? accountLineText(account) : ''}
                      </span>
                    </span>
                  </Label>
                  {rows[index]?.checked ? (
                    options.length > 0 && entry ? (
                      <MonthEntry
                        options={options}
                        entry={entry}
                        onEntryChange={(next) => setEntries((prev) => ({ ...prev, [field.memberId]: next }))}
                        control={form.control}
                        amountName={`rows.${index}.amountCents`}
                        onAmountChange={(cents) => form.setValue(`rows.${index}.amountCents`, cents, { shouldValidate: form.formState.isSubmitted })}
                        creditCents={creditOf(account?.balanceCents ?? 0)}
                        error={form.formState.errors.rows?.[index]?.amountCents?.message}
                        variant="compact"
                        startPeriod={startPeriod}
                        hideBeforeStartNote={startPeriod != null}
                        disabled={pending}
                        amountLabel={`Otro monto de ${field.fullName}`}
                      />
                    ) : (
                      <AmountField control={form.control} name={`rows.${index}.amountCents`} label="Monto" disabled={pending} />
                    )
                  ) : null}
                </li>
              )
            })}
          </ul>
          {rowsError ? <FieldError role="alert">{rowsError}</FieldError> : null}

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

          <TextareaField control={form.control} name="notes" label="Notas (opcional)" disabled={pending} />

          <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-2 flex flex-col gap-2 border-t border-border bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <p role="status" className="flex justify-between text-sm text-muted-foreground">
              <span>{checkedCount === 1 ? '1 integrante' : `${checkedCount} integrantes`}</span>
              <span className="tabular-nums">Total {formatCentsCompact(totalCents)}</span>
            </p>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={pending || anyInvalidOverride} className="h-11 w-full">
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {uploadStage === 'uploading' ? 'Subiendo comprobante…' : `Registrar pago de ${formatCentsCompact(totalCents)}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
