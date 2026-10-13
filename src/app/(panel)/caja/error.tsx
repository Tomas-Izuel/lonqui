'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

/** Boundary de error para `/caja` y sus listados (Next hereda el más cercano). */
export default function CajaError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="No pudimos cargar la caja"
      description="Revisá tu conexión e intentá de nuevo."
      action={
        <Button type="button" onClick={() => reset()}>
          Reintentar
        </Button>
      }
    />
  )
}
