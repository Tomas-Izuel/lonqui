'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DateField, SelectField } from '@/views/shared/form-fields'
import { toClubDate } from '@/lib/dates'
import { changeCategory } from '@/controllers/members.actions'
import type { Category } from '@/models/types'

const schema = z
  .object({
    newCategoryId: z.string().min(1, 'Elegí la categoría a la que pasa'),
    effectiveOn: z.string().min(1, 'Elegí desde qué fecha rige el cambio'),
  })
  .refine((data) => data.effectiveOn <= toClubDate(), { message: 'La fecha no puede ser futura', path: ['effectiveOn'] })

type Values = z.infer<typeof schema>

/**
 * "Cambiar de categoría" (el ascenso 5ta → 6ta, §13.6): cierra la
 * inscripción actual y abre la nueva EN LA MISMA disciplina. Sin cuota
 * extra (§13.4, punto 4: subir de categoría dentro del mismo deporte no
 * genera una segunda cuota del mes).
 */
export function ChangeCategoryDialog({
  open,
  onOpenChange,
  membershipId,
  disciplineName,
  currentCategoryName,
  otherCategories,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  membershipId: number
  disciplineName: string
  currentCategoryName: string
  otherCategories: Category[]
  onDone: () => void
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur', reValidateMode: 'onChange', defaultValues: { newCategoryId: '', effectiveOn: toClubDate() } })
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
      const result = await changeCategory({
        membershipId,
        newCategoryId: Number(values.newCategoryId),
        effectiveOn: values.effectiveOn,
      })
      if (!result.ok) {
        if (result.field === 'newCategoryId' || result.field === 'effectiveOn') {
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
          <DialogTitle>Cambiar de categoría en {disciplineName}</DialogTitle>
          <DialogDescription>
            Deja {currentCategoryName} y pasa a la nueva categoría desde la fecha elegida. No genera una cuota extra este mes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleConfirm)} method="post" className="flex flex-col gap-4">
          <SelectField
            control={form.control}
            name="newCategoryId"
            label="Nueva categoría"
            placeholder="Elegí una categoría"
            disabled={pending}
            options={otherCategories.map((c) => ({ value: String(c.id), label: c.name }))}
          />
          <DateField control={form.control} name="effectiveOn" label="A partir de" max={toClubDate()} disabled={pending} />
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
              {pending ? 'Guardando…' : 'Cambiar de categoría'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
