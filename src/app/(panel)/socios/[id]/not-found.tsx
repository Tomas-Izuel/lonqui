import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'

/** Cubre `/socios/[id]` y `/socios/[id]/editar` (Next hereda el `not-found.tsx` más cercano). */
export default function MemberNotFound() {
  return (
    <EmptyState
      title="Esta ficha no existe"
      description="El link puede estar mal escrito, o el socio puede no existir en el padrón."
      action={
        <Button asChild variant="outline">
          <Link href="/socios">Volver al padrón</Link>
        </Button>
      }
    />
  )
}
