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
import { createDiscipline, updateDiscipline } from '@/controllers/settings.actions'
import type { Discipline } from '@/models/types'

// Mismo mínimo que `nameSchema` en `catalogs.model.ts`: valida el formato acá
// para no ir hasta el servidor solo para mostrar el mismo mensaje.
const disciplineSchema = z.object({
  name: z.string().trim().min(2, 'El nombre tiene que tener al menos 2 caracteres'),
})
type DisciplineValues = z.infer<typeof disciplineSchema>

export type DisciplineFormSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Presente = editar; ausente = crear. */
  discipline?: Discipline
}

/**
 * `ResponsiveSheet` (shared/responsive-sheet.tsx): sheet desde abajo en
 * móvil, diálogo centrado desde `md` — un sheet lateral con solo un campo se
 * veía raro en escritorio, mitad de la pantalla vacía (feedback directo de
 * Tomás). Controlado desde afuera (`open`/`onOpenChange`): cuando se abre
 * desde un ítem de `DropdownMenu` (editar), el menú se desmonta al cerrarse y
 * se llevaría un sheet/diálogo hijo con él (mismo problema que documentó F1
 * con el `AlertDialog` de "Cerrar sesión") — por eso vive como hermano, nunca
 * anidado en el menú.
 */
export function DisciplineFormSheet({ open, onOpenChange, discipline }: DisciplineFormSheetProps) {
  const isEdit = Boolean(discipline)
  const [pending, setPending] = useState(false)

  const form = useForm<DisciplineValues>({
    resolver: zodResolver(disciplineSchema),
    defaultValues: { name: discipline?.name ?? '' },
  })

  // Reabrir con datos frescos (por si se editó otra fila mientras tanto) y
  // limpiar al cerrar, sin arrastrar el valor anterior a la próxima apertura.
  useEffect(() => {
    if (open) form.reset({ name: discipline?.name ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir/cerrar, no en cada tecla
  }, [open, discipline])

  async function onValid(values: DisciplineValues) {
    setPending(true)
    try {
      const result = isEdit ? await updateDiscipline(discipline!.id, values) : await createDiscipline(values)
      if (!result.ok) {
        if (result.field === 'name') {
          form.setError('name', { message: result.error })
          form.setFocus('name')
        } else {
          toast.error(result.error)
        }
        return
      }
      toast.success(isEdit ? 'Disciplina actualizada' : 'Disciplina creada')
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title={isEdit ? 'Editar disciplina' : 'Nueva disciplina'}
      description={
        isEdit
          ? 'El cambio de nombre queda registrado en la auditoría.'
          : 'Después vas a poder agregarle categorías y ordenarla.'
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="h-11">
            Cancelar
          </Button>
          <Button type="submit" form="discipline-form" disabled={pending} className="h-11">
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="discipline-form" onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
        {/* Sin `autoFocus`: el sheet es mobile-first y forzar el teclado apenas
            sube la hoja es brusco en el celular (web-design-guidelines). Radix
            ya mueve el foco al contenido del Sheet al abrirse. */}
        <TextField control={form.control} name="name" label="Nombre" placeholder="Fútbol masculino" disabled={pending} />
      </form>
    </ResponsiveSheet>
  )
}
