'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DateField, TextareaField } from '@/views/shared/form-fields'
import { toClubDate } from '@/lib/dates'

const reasonSchema = z.object({
  effectiveOn: z
    .string()
    .min(1, 'Elegí la fecha en que ocurrió')
    .pipe(z.iso.date('La fecha no es válida'))
    .refine((d) => d <= toClubDate(), 'La fecha no puede ser futura'),
  // Mismos límites que `statusEventSchema`/`voidPaymentSchema` y el CHECK de la base.
  reason: z
    .string()
    .trim()
    .min(3, 'El motivo tiene que tener al menos 3 caracteres')
    .max(500, 'El motivo no puede tener más de 500 caracteres'),
})

export type ReasonDialogValues = z.infer<typeof reasonSchema>
export type ReasonDialogResult = { ok: true } | { ok: false; error: string; field?: string }

export type ReasonDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "Dar de baja a Juan Pérez", "Anular este pago". */
  title: string
  /** La consecuencia explícita: nunca "eliminar", siempre lo que pasa en los hechos. */
  consequence: string
  /** El botón nombra la acción: "Dar de baja", "Reactivar", "Anular pago". */
  actionLabel: string
  onConfirm: (values: ReasonDialogValues) => Promise<ReasonDialogResult>
  defaultEffectiveOn?: string
}

/**
 * Confirmación con motivo y fecha obligatorios. Es el único modal que el
 * piso de calidad permite sin condiciones: interrumpe a propósito porque la
 * acción tiene consecuencias que no se deshacen con un DELETE.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  consequence,
  actionLabel,
  onConfirm,
  defaultEffectiveOn,
}: ReasonDialogProps) {
  const form = useForm<ReasonDialogValues>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { effectiveOn: defaultEffectiveOn ?? toClubDate(), reason: '' },
  })
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      form.reset()
      setFormError(null)
    }
  }

  async function handleConfirm(values: ReasonDialogValues) {
    setPending(true)
    setFormError(null)
    try {
      const result = await onConfirm(values)
      if (!result.ok) {
        if (result.field === 'reason' || result.field === 'effectiveOn') {
          form.setError(result.field, { message: result.error })
          form.setFocus(result.field)
        } else {
          setFormError(result.error)
        }
        return
      }
      handleOpenChange(false)
    } catch {
      setFormError('No pudimos completar la operación. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{consequence}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleConfirm)} noValidate method="post" className="flex flex-col gap-4">
          <DateField control={form.control} name="effectiveOn" label="Fecha" max={toClubDate()} />
          <TextareaField control={form.control} name="reason" label="Motivo" placeholder="Contá brevemente el motivo" />
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {pending ? 'Guardando…' : actionLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
