'use client'

import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AmountField, DateField, TextareaField } from '@/views/shared/form-fields'
import { paymentMethodLabels } from '@/views/shared/labels'
import { ReceiptPicker } from '@/views/payments/receipt-picker'
import { ChoiceGroup } from '@/views/income/choice-group'
import { SponsorCombobox } from '@/views/income/sponsor-combobox'
import { uploadCashReceipt } from '@/views/income/income-receipt-upload'
import {
  CONCEPT_ERROR_ID,
  INCOME_MIN_DATE,
  METHOD_ERROR_ID,
  buildIncomeSchema,
  isIncomeKnownField,
  type IncomeFormValues,
} from '@/views/income/income-schema'
import { registerCashMovement } from '@/controllers/income.actions'
import { toClubDate } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import type { IncomeFormData, SponsorOption } from '@/models/types'

const SPONSOR_ERROR_ID = 'income-sponsor-error'
const METHOD_OPTIONS = (['cash', 'transfer'] as const).map((value) => ({ value, label: paymentMethodLabels[value] }))

/**
 * Registrar otro ingreso (`?ingreso=nuevo|sponsor:<id>`). Una columna, en el
 * orden en que se piensa: Concepto → (Sponsor, si el concepto lo pide) →
 * Monto → Fecha → Medio → Comprobante → Detalle. Si el concepto no pide
 * sponsor, el campo es opcional y baja después de la fecha, para que el
 * ingreso más común (una venta, una rifa) no pase por un buscador que no usa.
 *
 * `batchId` nace con el formulario y viaja en cada intento: un doble toque o
 * un reintento tras un corte de señal no duplica (índice único en la base).
 * `alreadyRegistered` es un éxito, no un error.
 */
export function IncomeForm({
  data,
  initialSponsorId,
  onSuccess,
}: {
  data: IncomeFormData
  /** `?ingreso=sponsor:<id>`: llega elegido, con el primer concepto que pide sponsor. */
  initialSponsorId?: number
  onSuccess: (amountCents: number) => void
}) {
  const [batchId] = useState(() => crypto.randomUUID())
  const [sponsors, setSponsors] = useState<SponsorOption[]>(data.sponsors)
  const [file, setFile] = useState<File | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [uploadStage, setUploadStage] = useState<'idle' | 'uploading'>('idle')
  // Un reintento (error del servidor tras subir) no vuelve a subir el mismo archivo.
  const [uploaded, setUploaded] = useState<{ file: File; path: string } | null>(null)

  const schema = useMemo(() => buildIncomeSchema(data.concepts), [data.concepts])

  const presetSponsor = initialSponsorId != null && data.sponsors.some((s) => s.id === initialSponsorId)
  const presetConcept = presetSponsor ? (data.concepts.find((c) => c.requiresSponsor) ?? null) : null

  const form = useForm<IncomeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      conceptId: presetConcept?.id ?? null,
      sponsorId: presetSponsor ? (initialSponsorId ?? null) : null,
      amountCents: null,
      occurredOn: toClubDate(),
      method: 'cash',
      description: '',
    },
  })

  const conceptId = useWatch({ control: form.control, name: 'conceptId' })
  const sponsorId = useWatch({ control: form.control, name: 'sponsorId' })
  const amountCents = useWatch({ control: form.control, name: 'amountCents' })
  const method = useWatch({ control: form.control, name: 'method' })
  const pending = form.formState.isSubmitting
  const errors = form.formState.errors

  const requiresSponsor = data.concepts.find((c) => c.id === conceptId)?.requiresSponsor ?? false

  async function onValid(values: IncomeFormValues) {
    const cents = values.amountCents as number
    setFormError(null)
    setReceiptError(null)
    let receiptPath: string | null = null

    if (values.method === 'transfer' && file) {
      if (uploaded?.file === file) {
        receiptPath = uploaded.path
      } else {
        setUploadStage('uploading')
        const result = await uploadCashReceipt(batchId, file)
        setUploadStage('idle')
        if ('error' in result) {
          // Debajo del selector de comprobante, que es el control que lo causó.
          setReceiptError(result.error)
          return
        }
        setUploaded({ file, path: result.path })
        receiptPath = result.path
      }
    }

    const response = await registerCashMovement({
      batchId,
      conceptId: values.conceptId,
      sponsorId: values.sponsorId,
      amountCents: cents,
      occurredOn: values.occurredOn,
      method: values.method,
      receiptPath,
      description: values.description.trim() || null,
    })

    if (!response.ok) {
      if (isIncomeKnownField(response.field)) {
        form.setError(response.field, { message: response.error })
        // Los grupos de botones y el combobox no son un input: no hay campo al que mandar el foco.
        if (response.field !== 'conceptId' && response.field !== 'method' && response.field !== 'sponsorId') {
          form.setFocus(response.field)
        }
      } else if (response.field === 'receiptPath') {
        setReceiptError(response.error)
      } else {
        setFormError(response.error)
      }
      return
    }

    toast.success(
      response.data.alreadyRegistered ? 'El ingreso ya estaba registrado' : `Ingreso registrado · ${formatCentsCompact(cents)}`,
    )
    onSuccess(cents)
  }

  const sponsorField = (
    <SponsorCombobox
      value={sponsorId}
      onChange={(next) => {
        form.setValue('sponsorId', next, { shouldValidate: form.formState.isSubmitted })
      }}
      options={sponsors}
      onCreated={(created) => setSponsors((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'es')))}
      required={requiresSponsor}
      error={errors.sponsorId?.message}
      errorId={SPONSOR_ERROR_ID}
      disabled={pending}
    />
  )

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col">
      <form onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
        <ChoiceGroup
          label="Concepto"
          autoFocus
          options={data.concepts.map((c) => ({ value: c.id, label: c.name }))}
          value={conceptId}
          onChange={(next) => {
            form.setValue('conceptId', next, { shouldValidate: true })
            form.clearErrors('sponsorId')
          }}
          disabled={pending}
          error={errors.conceptId?.message}
          errorId={CONCEPT_ERROR_ID}
        />

        {requiresSponsor ? sponsorField : null}

        <AmountField control={form.control} name="amountCents" label="Monto" disabled={pending} />

        <DateField control={form.control} name="occurredOn" label="Fecha" max={toClubDate()} min={INCOME_MIN_DATE} disabled={pending} />

        {requiresSponsor ? null : sponsorField}

        <ChoiceGroup
          label="Medio"
          options={METHOD_OPTIONS}
          value={method}
          onChange={(next) => form.setValue('method', next, { shouldValidate: true })}
          disabled={pending}
          error={errors.method?.message}
          errorId={METHOD_ERROR_ID}
        />

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

        <TextareaField
          control={form.control}
          name="description"
          label="Detalle (opcional)"
          placeholder="Ej. 20 camisetas 5ta"
          disabled={pending}
        />

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="h-12 w-full">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {uploadStage === 'uploading'
            ? 'Subiendo comprobante…'
            : `Registrar ingreso${amountCents ? ` de ${formatCentsCompact(amountCents)}` : ''}`}
        </Button>
      </form>
    </div>
  )
}
