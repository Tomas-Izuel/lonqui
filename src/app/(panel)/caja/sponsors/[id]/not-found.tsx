import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/views/shared/states'

export default function SponsorNotFound() {
  return (
    <EmptyState
      title="Este sponsor no existe"
      description="El link puede estar mal escrito, o el sponsor puede no estar en el catálogo."
      action={
        <Button asChild variant="outline" className="h-11">
          <Link href="/caja/sponsors">Volver a sponsors</Link>
        </Button>
      }
    />
  )
}
