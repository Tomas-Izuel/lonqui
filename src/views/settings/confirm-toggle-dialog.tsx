'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * Confirmación simple (sin motivo) para activar/desactivar una disciplina o
 * categoría. `setDisciplineActive`/`setCategoryActive` no reciben motivo —a
 * diferencia de la baja de un socio (`ReasonDialog`, F1)— así que este es un
 * componente propio de `/ajustes`, no una variante de esa primitiva.
 *
 * Solo se usa para DESACTIVAR (route-ajustes.md: "sin confirmaciones para
 * renombrar; sí para desactivar"). Activar vuelve a llamar la acción directo,
 * sin pasar por acá.
 */
export function ConfirmToggleDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  actionLabel: string
  onConfirm: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={handleConfirm}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
