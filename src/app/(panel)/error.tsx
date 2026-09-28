'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

/** Boundary de error para `/` (panel inicial). */
export default function HomeError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <ErrorState
        title="No pudimos cargar el inicio"
        description="Revisá tu conexión e intentá de nuevo."
        action={
          <Button type="button" onClick={() => reset()}>
            Reintentar
          </Button>
        }
      />
    </div>
  )
}
