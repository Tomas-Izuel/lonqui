'use client'

import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { SelectField, AmountField } from '@/views/shared/form-fields'
import { feePriceScopeLabels, memberTypeLabels } from '@/views/shared/labels'
import { addMonths, formatPeriod, periodRange } from '@/lib/dates'
import { createFeePrice } from '@/controllers/billing.actions'
import type { BillingStatus, DisciplineWithCategories, FeePriceScope, MemberType } from '@/models/types'

/**
 * Mirror del schema de `fee-prices.model.ts:createFeePriceSchema` (mismo CHECK
 * `fee_prices_scope_shape`), reescrito acá porque un Client Component no
 * puede importar `@/models/*.model` (CLAUDE.md, lint de capas). `amountCents`
 * llega null mientras el campo está vacío o no se pudo parsear —lo resuelve
 * `AmountField`—, así que la obligatoriedad se chequea en el `superRefine`,
 * no con `z.number()` solo (rechazaría null con un mensaje de tipo, no el
 * texto que quiere el piso de calidad).
 */
const feePriceFormSchema = z
  .object({
    scope: z.enum(['default', 'member_type', 'category']),
    memberType: z.enum(['practicing', 'non_practicing']).or(z.literal('')),
    categoryId: z.string(),
    amountCents: z.number().int().nonnegative('El monto no puede ser negativo').nullable(),
    validFrom: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.amountCents == null) {
      ctx.addIssue({ code: 'custom', path: ['amountCents'], message: 'Ingresá un monto válido' })
    }
    if (!data.validFrom) {
      ctx.addIssue({ code: 'custom', path: ['validFrom'], message: 'Elegí un mes' })
    }
    if (data.scope === 'category' && !data.categoryId) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Elegí una categoría' })
    }
    if (data.scope === 'member_type' && !data.memberType) {
      ctx.addIssue({ code: 'custom', path: ['memberType'], message: 'Elegí un tipo de socio' })
    }
  })
type FeePriceFormValues = z.infer<typeof feePriceFormSchema>

const SCOPE_OPTIONS: { value: FeePriceScope; label: string }[] = [
  { value: 'default', label: feePriceScopeLabels.default },
  { value: 'member_type', label: feePriceScopeLabels.member_type },
  { value: 'category', label: feePriceScopeLabels.category },
]

const MEMBER_TYPE_OPTIONS: { value: MemberType; label: string }[] = [
  { value: 'practicing', label: memberTypeLabels.practicing },
  { value: 'non_practicing', label: memberTypeLabels.non_practicing },
]

/**
 * El mes actual entra a la lista solo si TODAVÍA no se generaron cuotas para
 * él (D19, `fee_prices_insert_guard`): `lastGeneratedPeriod` es el máximo
 * período con cuotas mensuales, así que si ya alcanzó o pasó el mes actual,
 * ese mes queda cerrado para un valor nuevo y arranca en el siguiente.
 */
function buildValidFromOptions(billing: BillingStatus): { value: string; label: string }[] {
  const currentMonthGenerated = billing.lastGeneratedPeriod !== null && billing.lastGeneratedPeriod >= billing.currentPeriod
  const from = currentMonthGenerated ? addMonths(billing.currentPeriod, 1) : billing.currentPeriod
  const to = addMonths(billing.currentPeriod, 12)
  return periodRange(from, to).map((period) => ({ value: period, label: formatPeriod(period) }))
}

export type NewFeePriceSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  billing: BillingStatus
  /** Solo disciplinas y categorías ACTIVAS: no tiene sentido fijar un precio nuevo para algo que el club ya dio de baja. */
  categoriesByDiscipline: DisciplineWithCategories[]
}

/**
 * "Nuevo valor" (route-ajustes.md, F4 de `01-tasks.md`): scope → campo
 * dependiente (tipo de socio o categoría) → monto → mes desde el que aplica.
 * Los valores de cuota son append-only (CLAUDE.md, "nada se borra"): esto
 * siempre INSERTA una fila nueva, nunca edita una existente — por eso el
 * sheet no tiene modo "editar" como `CategoryFormSheet`.
 */
export function NewFeePriceSheet({ open, onOpenChange, billing, categoriesByDiscipline }: NewFeePriceSheetProps) {
  const [pending, setPending] = useState(false)
  const validFromOptions = buildValidFromOptions(billing)

  const categoryOptions = categoriesByDiscipline.flatMap((discipline) =>
    discipline.categories.map((category) => ({
      value: String(category.id),
      label: `${discipline.name} · ${category.name}`,
    })),
  )

  const form = useForm<FeePriceFormValues>({
    resolver: zodResolver(feePriceFormSchema),
    defaultValues: {
      scope: 'default',
      memberType: '',
      categoryId: '',
      amountCents: null,
      validFrom: validFromOptions[0]?.value ?? '',
    },
  })

  function resetForm() {
    form.reset({
      scope: 'default',
      memberType: '',
      categoryId: '',
      amountCents: null,
      validFrom: validFromOptions[0]?.value ?? '',
    })
  }

  const scope = useWatch({ control: form.control, name: 'scope' })

  async function onValid(values: FeePriceFormValues) {
    setPending(true)
    try {
      const result = await createFeePrice({
        scope: values.scope,
        memberType: values.scope === 'member_type' ? (values.memberType || undefined) : undefined,
        categoryId: values.scope === 'category' ? Number(values.categoryId) : undefined,
        amountCents: values.amountCents!,
        validFrom: values.validFrom,
      })
      if (!result.ok) {
        if (result.field && result.field in values) {
          form.setError(result.field as keyof FeePriceFormValues, { message: result.error })
        } else {
          toast.error(result.error)
        }
        return
      }
      toast.success('Valor de cuota creado')
      onOpenChange(false)
      resetForm()
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) resetForm()
        onOpenChange(next)
      }}
      title="Nuevo valor de cuota"
      description="El valor más específico gana: por categoría sobre por tipo de socio, y por tipo de socio sobre el general."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="h-11">
            Cancelar
          </Button>
          <Button type="submit" form="fee-price-form" disabled={pending} className="h-11">
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="fee-price-form" onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
        <SelectField control={form.control} name="scope" label="Alcance" options={SCOPE_OPTIONS} disabled={pending} />

        {scope === 'member_type' ? (
          <SelectField
            control={form.control}
            name="memberType"
            label="Tipo de socio"
            options={MEMBER_TYPE_OPTIONS}
            disabled={pending}
          />
        ) : null}

        {scope === 'category' ? (
          <SelectField
            control={form.control}
            name="categoryId"
            label="Categoría"
            options={categoryOptions}
            description={categoryOptions.length === 0 ? 'Todavía no hay categorías activas.' : undefined}
            disabled={pending || categoryOptions.length === 0}
          />
        ) : null}

        <AmountField control={form.control} name="amountCents" label="Monto" disabled={pending} />

        <SelectField
          control={form.control}
          name="validFrom"
          label="Aplica desde"
          options={validFromOptions}
          disabled={pending}
        />
      </form>
    </ResponsiveSheet>
  )
}
