'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

/** Boundary de error de Revisión (lista y detalle). */
export default function ReviewError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="No pudimos cargar Revisión"
      description="Revisá tu conexión e intentá de nuevo."
      action={
        <Button type="button" onClick={() => reset()}>
          Reintentar
        </Button>
      }
    />
  )
}
