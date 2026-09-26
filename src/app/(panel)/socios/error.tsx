'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

/** Boundary de error para `/socios` y `/socios/nuevo` (Next hereda el más cercano). */
export default function SociosError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="No pudimos cargar el padrón"
      description="Revisá tu conexión e intentá de nuevo."
      action={
        <Button type="button" onClick={() => reset()}>
          Reintentar
        </Button>
      }
    />
  )
}
