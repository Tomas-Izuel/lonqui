'use client'

import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DateField, SelectField } from '@/views/shared/form-fields'
import { toClubDate } from '@/lib/dates'
import { setMemberCategories } from '@/controllers/members.actions'
import type { DisciplineWithCategories } from '@/models/types'

const schema = z
  .object({
    disciplineId: z.string().min(1, 'Elegí el deporte que va a practicar'),
    categoryId: z.string().min(1, 'Elegí la categoría del deporte'),
    effectiveOn: z.string().min(1, 'Elegí desde qué fecha empieza'),
  })
  .refine((data) => data.effectiveOn <= toClubDate(), { message: 'La fecha no puede ser futura', path: ['effectiveOn'] })

type Values = z.infer<typeof schema>

/**
 * "Agregar deporte" (§13.6): un socio puede jugar más de un deporte a la
 * vez. Solo ofrece disciplinas SIN inscripción abierta (`availableDisciplines`,
 * ya filtradas por el llamador) — agregar una categoría de un deporte donde
 * ya juega es "cambiar de categoría", una acción distinta.
 */
export function AddCategoryDialog({
  open,
  onOpenChange,
  memberId,
  openCategoryIds,
  availableDisciplines,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  memberId: number
  openCategoryIds: number[]
  availableDisciplines: DisciplineWithCategories[]
  onDone: () => void
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { disciplineId: '', categoryId: '', effectiveOn: toClubDate() },
  })
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const disciplineId = useWatch({ control: form.control, name: 'disciplineId' })
  const selectedDiscipline = availableDisciplines.find((d) => String(d.id) === disciplineId)
  const categoryOptions = (selectedDiscipline?.categories ?? []).map((c) => ({ value: String(c.id), label: c.name }))

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
      const result = await setMemberCategories({
        memberId,
        categoryIds: [...openCategoryIds, Number(values.categoryId)],
        effectiveOn: values.effectiveOn,
      })
      if (!result.ok) {
        if (result.field === 'categoryIds' || result.field === 'effectiveOn') {
          form.setError(result.field === 'categoryIds' ? 'categoryId' : 'effectiveOn', { message: result.error })
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
          <DialogTitle>Agregar deporte</DialogTitle>
          <DialogDescription>
            {selectedDiscipline ? `Empieza a pagar ${selectedDiscipline.name} desde este mes.` : 'Elegí el deporte y la categoría.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleConfirm)} method="post" className="flex flex-col gap-4">
          <SelectField
            control={form.control}
            name="disciplineId"
            label="Disciplina"
            placeholder="Elegí una disciplina"
            disabled={pending}
            options={availableDisciplines.map((d) => ({ value: String(d.id), label: d.name }))}
          />
          <SelectField
            control={form.control}
            name="categoryId"
            label="Categoría"
            placeholder={disciplineId ? 'Elegí una categoría' : 'Elegí primero la disciplina'}
            disabled={pending || !disciplineId}
            options={categoryOptions}
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
              {pending ? 'Guardando…' : 'Agregar deporte'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
