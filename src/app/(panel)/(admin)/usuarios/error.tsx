'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="No pudimos cargar los usuarios"
      description="Puede ser un problema de conexión. Probá de nuevo."
      action={
        <Button type="button" onClick={() => reset()}>
          Reintentar
        </Button>
      }
    />
  )
}
