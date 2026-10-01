'use client'

import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { SelectField } from '@/views/shared/form-fields'
import { addMonths, formatPeriod, periodRange, toPeriod } from '@/lib/dates'
import { activateBilling } from '@/controllers/billing.actions'
import type { BillingStatus } from '@/models/types'

// Espeja `activateBillingSchema` (billing.actions.ts): fecha ISO que cae en
// día 1. Las opciones del selector ya son todas días 1, pero el valor viaja
// como string libre, así que se valida igual.
const activateFormSchema = z.object({
  startPeriod: z
    .string({ error: 'Elegí el mes de inicio' })
    .min(1, 'Elegí el mes de inicio')
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Elegí el mes de inicio')
    .refine((value) => value.endsWith('-01'), 'Tiene que ser el primer día de un mes')
    // Mismo texto y mismo reloj que `activateBillingSchema` y `settings_billing_guard`.
    .refine(
      (value) => !value.endsWith('-01') || value >= toPeriod(),
      'El mes de inicio tiene que ser este mes o uno futuro; la deuda anterior se carga como saldo de arranque',
    ),
})
type ActivateFormValues = z.infer<typeof activateFormSchema>

export type ActivateBillingSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  billing: BillingStatus
}

/**
 * "Activar cuotas" (D18, route-ajustes.md): elige el mes de inicio (el actual
 * o uno futuro) y confirma. `billing_start_period` se fija UNA sola vez —el
 * trigger `settings_billing_guard` rechaza volverlo a `null` o cambiarlo con
 * cuotas ya generadas—, así que este sheet no tiene modo "editar".
 */
export function ActivateBillingSheet({ open, onOpenChange, billing }: ActivateBillingSheetProps) {
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const monthOptions = periodRange(billing.currentPeriod, addMonths(billing.currentPeriod, 12)).map((period) => ({
    value: period,
    label: formatPeriod(period),
  }))

  const form = useForm<ActivateFormValues>({
    resolver: zodResolver(activateFormSchema),
    defaultValues: { startPeriod: billing.currentPeriod },
  })

  const startPeriod = useWatch({ control: form.control, name: 'startPeriod' })
  const isCurrentMonth = startPeriod === billing.currentPeriod

  async function onValid(values: ActivateFormValues) {
    setPending(true)
    setFormError(null)
    try {
      const result = await activateBilling(values)
      if (!result.ok) {
        if (result.field === 'startPeriod') {
          form.setError('startPeriod', { message: result.error })
        } else {
          setFormError(result.error)
        }
        return
      }

      const { generated } = result.data
      if (generated > 0) {
        toast.success(`Cuotas activadas. Se generaron ${generated} ${generated === 1 ? 'cuota' : 'cuotas'} de ${formatPeriod(values.startPeriod)}.`)
      } else if (values.startPeriod > billing.currentPeriod) {
        toast.success(`Cuotas activadas desde ${formatPeriod(values.startPeriod)}. Se generan solas ese mes.`)
      } else {
        toast.success('Cuotas activadas. No había cuotas pendientes para generar.')
      }
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) {
          form.reset({ startPeriod: billing.currentPeriod })
          setFormError(null)
        }
        onOpenChange(next)
      }}
      title="Activar cuotas"
      description="Desde el mes que elijas, cada socio activo recibe su cuota mensual automáticamente."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="h-11">
            Cancelar
          </Button>
          <Button type="submit" form="activate-billing-form" disabled={pending} className="h-11">
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Activando…' : 'Activar cuotas'}
          </Button>
        </>
      }
    >
      <form
        id="activate-billing-form"
        onSubmit={form.handleSubmit(onValid)}
        noValidate
        method="post"
        className="flex flex-col gap-4"
      >
        <SelectField control={form.control} name="startPeriod" label="Mes de inicio" options={monthOptions} disabled={pending} />

        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <p>
            {isCurrentMonth
              ? `Se van a generar ahora las cuotas de ${formatPeriod(startPeriod)} para los ${billing.activeMembers} socios activos, según el valor de cada categoría.`
              : `Las cuotas de ${formatPeriod(startPeriod)} se generan solas ese día 1. Hoy hay ${billing.activeMembers} socios activos (puede cambiar para esa fecha).`}
          </p>
          <p className="font-medium text-foreground">El valor de ese mes no se puede cambiar después.</p>
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
