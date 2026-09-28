'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { TextField } from '@/views/shared/form-fields'
import { createCategory, updateCategory } from '@/controllers/settings.actions'
import type { Category } from '@/models/types'

const categorySchema = z.object({
  name: z.string().trim().min(2, 'El nombre tiene que tener al menos 2 caracteres'),
})
type CategoryValues = z.infer<typeof categorySchema>

export type CategoryFormSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  disciplineId: number
  disciplineName: string
  /** Presente = editar; ausente = crear dentro de `disciplineId`. */
  category?: Category
}

/** Mismo patrón que `DisciplineFormSheet`: sheet desde abajo, controlado desde afuera. */
export function CategoryFormSheet({ open, onOpenChange, disciplineId, disciplineName, category }: CategoryFormSheetProps) {
  const isEdit = Boolean(category)
  const [pending, setPending] = useState(false)

  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: category?.name ?? '' },
  })

  useEffect(() => {
    if (open) form.reset({ name: category?.name ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir/cerrar, no en cada tecla
  }, [open, category])

  async function onValid(values: CategoryValues) {
    setPending(true)
    try {
      const result = isEdit
        ? await updateCategory(category!.id, values)
        : await createCategory({ disciplineId, name: values.name })
      if (!result.ok) {
        if (result.field === 'name') {
          form.setError('name', { message: result.error })
          form.setFocus('name')
        } else {
          toast.error(result.error)
        }
        return
      }
      toast.success(isEdit ? 'Categoría actualizada' : 'Categoría creada')
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title={isEdit ? 'Editar categoría' : 'Nueva categoría'}
      description={
        isEdit ? `Categoría de ${disciplineName}. El cambio queda registrado en la auditoría.` : `Se crea dentro de ${disciplineName}.`
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="h-11">
            Cancelar
          </Button>
          <Button type="submit" form="category-form" disabled={pending} className="h-11">
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
        {/* Sin `autoFocus`: el sheet es mobile-first y forzar el teclado apenas
            sube la hoja es brusco en el celular (web-design-guidelines). Radix
            ya mueve el foco al contenido del Sheet al abrirse. */}
        <TextField control={form.control} name="name" label="Nombre" placeholder="5ta" disabled={pending} />
      </form>
    </ResponsiveSheet>
  )
}
