'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { CheckboxField, TextField } from '@/views/shared/form-fields'
import { createCashConcept, updateCashConcept } from '@/controllers/settings.actions'
import type { CashConcept } from '@/models/types'

// Espejo de `createCashConceptSchema` / `updateCashConceptSchema` (cash-concepts.model.ts).
const conceptSchema = z.object({
  name: z
    .string({ error: 'El nombre tiene que tener al menos 2 caracteres' })
    .trim()
    .min(2, 'El nombre tiene que tener al menos 2 caracteres')
    .max(120, 'El nombre no puede tener más de 120 caracteres'),
  requiresSponsor: z.boolean(),
})
type ConceptValues = z.infer<typeof conceptSchema>

/** Mismo patrón que `CategoryFormSheet`: sheet controlado desde afuera. */
export function IncomeConceptFormSheet({
  open,
  onOpenChange,
  concept,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Presente = editar; ausente = crear. */
  concept?: CashConcept
}) {
  const isEdit = Boolean(concept)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<ConceptValues>({
    resolver: zodResolver(conceptSchema),
    defaultValues: { name: concept?.name ?? '', requiresSponsor: concept?.requiresSponsor ?? false },
  })

  useEffect(() => {
    if (open) form.reset({ name: concept?.name ?? '', requiresSponsor: concept?.requiresSponsor ?? false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir/cerrar, no en cada tecla
  }, [open, concept])

  async function onValid(values: ConceptValues) {
    setPending(true)
    setFormError(null)
    try {
      const result = isEdit ? await updateCashConcept(concept!.id, values) : await createCashConcept(values)
      if (!result.ok) {
        if (result.field === 'name' || result.field === 'requiresSponsor') {
          form.setError(result.field, { message: result.error })
          form.setFocus(result.field)
        } else {
          setFormError(result.error)
        }
        return
      }
      toast.success(isEdit ? 'Concepto actualizado' : 'Concepto creado')
      onOpenChange(false)
    } catch {
      setFormError('No pudimos guardar el concepto. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setFormError(null)
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar concepto de ingreso' : 'Nuevo concepto de ingreso'}
      description={isEdit ? 'El cambio queda registrado en la auditoría.' : 'Aparece al registrar un ingreso.'}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="income-concept-form" className="h-11" disabled={pending}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form
        id="income-concept-form"
        onSubmit={form.handleSubmit(onValid)}
        noValidate
        method="post"
        className="flex flex-col gap-4"
      >
        <TextField control={form.control} name="name" label="Nombre" placeholder="Rifa" autoComplete="off" disabled={pending} />
        <CheckboxField
          control={form.control}
          name="requiresSponsor"
          label="Pide sponsor"
          description="Al elegir este concepto hay que indicar de qué sponsor es el ingreso."
          disabled={pending}
        />
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
      </form>
    </ResponsiveSheet>
  )
}
