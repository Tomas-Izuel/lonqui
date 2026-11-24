'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

export default function InviteByCategoryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="No pudimos cargar la lista"
      description="Revisá tu conexión e intentá de nuevo."
      action={
        <Button type="button" onClick={() => reset()}>
          Reintentar
        </Button>
      }
    />
  )
}
