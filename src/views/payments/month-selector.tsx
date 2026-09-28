import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addMonths, formatPeriod } from '@/lib/dates'

/** Selector de mes anterior/siguiente: el estado vive en `?mes=` (URL), como todo filtro del panel. */
export function MonthSelector({ period, basePath }: { period: string; basePath: string }) {
  const previous = addMonths(period, -1)
  const next = addMonths(period, 1)

  return (
    <div className="flex items-center justify-between gap-2">
      <Button asChild variant="outline" size="icon" aria-label="Mes anterior">
        <Link href={`${basePath}?mes=${previous}`}>
          <ChevronLeft aria-hidden />
        </Link>
      </Button>
      <span className="text-base font-semibold">{formatPeriod(period)}</span>
      <Button asChild variant="outline" size="icon" aria-label="Mes siguiente">
        <Link href={`${basePath}?mes=${next}`}>
          <ChevronRight aria-hidden />
        </Link>
      </Button>
    </div>
  )
}
