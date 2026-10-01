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
import { leaveCategory } from '@/controllers/members.actions'

const schema = z
  .object({
    leftOn: z.string().min(1, 'Elegí desde qué fecha deja el deporte'),
    reason: z.string().trim().max(500, 'El motivo no puede tener más de 500 caracteres'),
  })
  .refine((data) => data.leftOn <= toClubDate(), { message: 'La fecha no puede ser futura', path: ['leftOn'] })

type Values = z.infer<typeof schema>

/**
 * "Dar de baja de <categoría>" (00-architecture.md §13.6): motivo OPCIONAL,
 * a diferencia de `ReasonDialog` (motivo obligatorio, mínimo 3 caracteres) —
 * por eso no se reutiliza acá tal cual, aunque compone los mismos campos
 * (`DateField`/`TextareaField` de `views/shared/form-fields`) y el mismo
 * patrón de confirmación con consecuencia escrita. Candidato a promover a
 * `views/shared` con un `reasonRequired` si otra pantalla necesita lo mismo
 * (dev log).
 */
export function LeaveCategoryDialog({
  open,
  onOpenChange,
  membershipId,
  disciplineName,
  categoryName,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  membershipId: number
  disciplineName: string
  categoryName: string
  onDone: () => void
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur', reValidateMode: 'onChange', defaultValues: { leftOn: toClubDate(), reason: '' } })
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      form.reset()
      setFormError(null)
    }
  }

  async function handleConfirm(values: Values) {
    setPending(true)
    setFormError(null)
    try {
      const result = await leaveCategory({ membershipId, leftOn: values.leftOn, reason: values.reason.trim() || undefined })
      if (!result.ok) {
        if (result.field === 'reason' || result.field === 'leftOn') {
          form.setError(result.field, { message: result.error })
        } else {
          setFormError(result.error)
        }
        return
      }
      handleOpenChange(false)
      onDone()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Dar de baja de {disciplineName} · {categoryName}
          </DialogTitle>
          <DialogDescription>
            Deja de generar cuota de {disciplineName} desde el mes siguiente; la de este mes queda.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleConfirm)} method="post" className="flex flex-col gap-4">
          <DateField control={form.control} name="leftOn" label="Fecha" max={toClubDate()} disabled={pending} />
          <TextareaField control={form.control} name="reason" label="Motivo (opcional)" disabled={pending} />
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
              {pending ? 'Guardando…' : 'Dar de baja'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
