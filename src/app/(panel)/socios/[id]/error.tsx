'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

/** Cubre `/socios/[id]` y `/socios/[id]/editar`. */
export default function MemberError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="No pudimos cargar la ficha"
      description="Revisá tu conexión e intentá de nuevo."
      action={
        <Button type="button" onClick={() => reset()}>
          Reintentar
        </Button>
      }
    />
  )
}
