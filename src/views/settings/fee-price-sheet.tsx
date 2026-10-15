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
import { addMonths, formatPeriod, periodRange, toPeriod } from '@/lib/dates'
import { createFeePrice } from '@/controllers/billing.actions'
import { formatCentsCompact } from '@/lib/money'
import type {
  BillingStatus,
  DisciplineWithCategories,
  FeePrice,
  FeePriceHistoryEntry,
  FeePriceScope,
  MemberType,
} from '@/models/types'

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
    scope: z.enum(['default', 'member_type', 'category'], { error: 'Elegí a quién aplica el valor' }),
    memberType: z.enum(['practicing', 'non_practicing']).or(z.literal('')),
    categoryId: z.string(),
    amountCents: z
      .number({ error: 'Ingresá el monto' })
      .int('El monto tiene que ser un número entero de centavos')
      // Mismo texto que el servidor. 0 es válido (cuota bonificada): el CHECK es >= 0.
      .nonnegative('El monto no puede ser negativo')
      .nullable(),
    validFrom: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.amountCents == null) {
      ctx.addIssue({ code: 'custom', path: ['amountCents'], message: 'Ingresá el monto' })
    }
    if (!data.validFrom) {
      ctx.addIssue({ code: 'custom', path: ['validFrom'], message: 'Elegí el mes desde el que aplica' })
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.validFrom) || !data.validFrom.endsWith('-01')) {
      ctx.addIssue({ code: 'custom', path: ['validFrom'], message: 'Tiene que ser el primer día de un mes' })
    } else if (data.validFrom < toPeriod()) {
      // Un mes ya cerrado está congelado en las cuotas: mismo texto que el servidor.
      ctx.addIssue({
        code: 'custom',
        path: ['validFrom'],
        message: 'Un valor de cuota nuevo aplica desde este mes o uno futuro',
      })
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

type Target = { scope: FeePriceScope; memberType: MemberType | null; categoryId: number | null }

/** Un valor "es del mismo destino" si coincide el alcance y lo que ese alcance fija. */
function sameTarget(a: Target, b: Target): boolean {
  if (a.scope !== b.scope) return false
  if (a.scope === 'member_type') return a.memberType === b.memberType
  if (a.scope === 'category') return a.categoryId === b.categoryId
  return true
}

/** El valor que rige para el destino en `period`: mayor `validFrom <= period` entre las filas que no quedaron reemplazadas. */
function effectivePrice(history: FeePriceHistoryEntry[], target: Target, period: string): FeePriceHistoryEntry | null {
  let best: FeePriceHistoryEntry | null = null
  for (const row of history) {
    if (row.supersededById !== null || row.validFrom > period || !sameTarget(row, target)) continue
    if (!best || row.validFrom > best.validFrom || (row.validFrom === best.validFrom && row.id > best.id)) best = row
  }
  return best
}

type CommonProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  billing: BillingStatus
  /** Para el aviso "Reemplaza el valor…" y el guard de "mismo valor". */
  history: FeePriceHistoryEntry[]
}

export type FeePriceSheetProps =
  | (CommonProps & {
      mode: 'new'
      /** Solo disciplinas y categorías ACTIVAS: no tiene sentido fijar un precio nuevo para algo que el club ya dio de baja. */
      categoriesByDiscipline: DisciplineWithCategories[]
    })
  | (CommonProps & {
      mode: 'change'
      /** La fila que se corrige. El destino (alcance, tipo, categoría) queda fijo. */
      price: FeePrice
      /** Etiqueta legible del destino, la misma de la fila. */
      label: string
    })

/**
 * "Nuevo valor" y "Cambiar" de la sección de valores de cuota. Los valores
 * son append-only (CLAUDE.md, "nada se borra"): los dos modos INSERTAN una
 * fila nueva con `createFeePrice`, nunca editan una existente. Una
 * corrección del mismo mes la deja como "Reemplazado" en la historia.
 *
 * En modo `change` el destino es fijo y el monto viene precargado con el de
 * la fila (decisión de Tomás): se edita encima. Quien monta este sheet por
 * fila debe darle un `key` distinto por fila para que el formulario arranque
 * con sus valores.
 */
export function FeePriceSheet(props: FeePriceSheetProps) {
  const { open, onOpenChange, billing, history, mode } = props
  const changePrice = props.mode === 'change' ? props.price : null
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const validFromOptions = buildValidFromOptions(billing)

  const categoryOptions =
    props.mode === 'new'
      ? props.categoriesByDiscipline.flatMap((discipline) =>
          discipline.categories.map((category) => ({
            value: String(category.id),
            label: `${discipline.name} · ${category.name}`,
          })),
        )
      : []

  // Fila programada: su propio mes es el default (un mes futuro siempre está en la lista).
  const defaultValidFrom =
    changePrice && changePrice.validFrom > billing.currentPeriod && validFromOptions.some((o) => o.value === changePrice.validFrom)
      ? changePrice.validFrom
      : (validFromOptions[0]?.value ?? '')

  const initialValues: FeePriceFormValues = {
    scope: changePrice?.scope ?? 'default',
    memberType: changePrice?.memberType ?? '',
    categoryId: changePrice?.categoryId != null ? String(changePrice.categoryId) : '',
    amountCents: changePrice?.amountCents ?? null,
    validFrom: defaultValidFrom,
  }

  const form = useForm<FeePriceFormValues>({
    resolver: zodResolver(feePriceFormSchema),
    defaultValues: initialValues,
  })

  function resetForm() {
    setFormError(null)
    form.reset(initialValues)
  }

  const [scope, memberType, categoryId, validFrom, amountCents] = useWatch({
    control: form.control,
    name: ['scope', 'memberType', 'categoryId', 'validFrom', 'amountCents'],
  })

  const target: Target = {
    scope,
    memberType: scope === 'member_type' && memberType ? memberType : null,
    categoryId: scope === 'category' && categoryId ? Number(categoryId) : null,
  }
  const replaced = validFrom
    ? history.find((row) => row.supersededById === null && row.validFrom === validFrom && sameTarget(row, target))
    : undefined

  async function onValid(values: FeePriceFormValues) {
    const effective = effectivePrice(
      history,
      {
        scope: values.scope,
        memberType: values.scope === 'member_type' && values.memberType ? values.memberType : null,
        categoryId: values.scope === 'category' && values.categoryId ? Number(values.categoryId) : null,
      },
      values.validFrom,
    )
    if (effective && effective.amountCents === values.amountCents) {
      form.setError('amountCents', { message: 'Es el mismo valor que ya tiene para ese mes' })
      return
    }
    setPending(true)
    setFormError(null)
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
          setFormError(result.error)
        }
        return
      }
      toast.success(mode === 'change' ? 'Valor de cuota actualizado' : 'Valor de cuota creado')
      onOpenChange(false)
      resetForm()
    } finally {
      setPending(false)
    }
  }

  const isChange = props.mode === 'change'

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) resetForm()
        onOpenChange(next)
      }}
      title={isChange ? 'Cambiar valor de cuota' : 'Nuevo valor de cuota'}
      description={
        isChange
          ? props.label
          : 'El valor más específico gana: por categoría sobre por tipo de socio, y por tipo de socio sobre el general.'
      }
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
        {changePrice ? (
          <p className="text-sm text-muted-foreground">
            {changePrice.validFrom <= billing.currentPeriod ? 'Hoy' : 'Programado'}:{' '}
            <span className="font-medium tabular-nums text-foreground">{formatCentsCompact(changePrice.amountCents)}</span>{' '}
            desde {formatPeriod(changePrice.validFrom)}
          </p>
        ) : (
          <>
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
          </>
        )}

        <AmountField control={form.control} name="amountCents" label="Monto" disabled={pending} autoFocus={isChange} />

        <div className="flex flex-col gap-2">
          <SelectField
            control={form.control}
            name="validFrom"
            label="Aplica desde"
            options={validFromOptions}
            disabled={pending}
          />
          {validFrom ? (
            <p className="text-sm text-muted-foreground">
              Se usa en las cuotas que se generen desde {formatPeriod(validFrom)}. Las cuotas ya generadas no cambian, estén
              pagadas o adeudadas.
            </p>
          ) : null}
          {replaced && replaced.amountCents !== amountCents ? (
            <p className="text-sm font-medium">
              Reemplaza el valor de {formatCentsCompact(replaced.amountCents)} programado para {formatPeriod(replaced.validFrom)}.
            </p>
          ) : null}
        </div>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
      </form>
    </ResponsiveSheet>
  )
}
