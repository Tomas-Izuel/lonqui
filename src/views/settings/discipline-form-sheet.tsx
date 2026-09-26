'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
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
 * Sheet desde abajo en móvil (shadcn: `side="bottom"` por defecto en < sm vía
 * el propio componente, acá lo forzamos siempre porque en escritorio 240px+
 * de sidebar deja poco lugar para un panel lateral angosto y el patrón de
 * alta/edición corta ya es consistente en toda la app). Controlado desde
 * afuera (`open`/`onOpenChange`): cuando se abre desde un ítem de
 * `DropdownMenu` (editar), el menú se desmonta al cerrarse y se llevaría un
 * Sheet hijo con él (mismo problema que documentó F1 con el `AlertDialog` de
 * "Cerrar sesión") — por eso vive como hermano, nunca anidado en el menú.
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
    <Sheet open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Editar disciplina' : 'Nueva disciplina'}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? 'El cambio de nombre queda registrado en la auditoría.'
              : 'Después vas a poder agregarle categorías y ordenarla.'}
          </SheetDescription>
        </SheetHeader>
        <form
          id="discipline-form"
          onSubmit={form.handleSubmit(onValid)}
          noValidate
          className="flex flex-col gap-4 overflow-y-auto px-4 py-4"
        >
          {/* Sin `autoFocus`: el sheet es mobile-first y forzar el teclado apenas
              sube la hoja es brusco en el celular (web-design-guidelines). Radix
              ya mueve el foco al contenido del Sheet al abrirse. */}
          <TextField control={form.control} name="name" label="Nombre" placeholder="Fútbol masculino" disabled={pending} />
        </form>
        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="h-11">
            Cancelar
          </Button>
          <Button type="submit" form="discipline-form" disabled={pending} className="h-11">
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
