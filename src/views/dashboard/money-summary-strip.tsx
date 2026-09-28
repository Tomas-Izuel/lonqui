import Link from 'next/link'
import { Amount } from '@/views/shared/money'
import { collectionPct } from '@/views/dashboard/dashboard-helpers'
import { formatPeriod } from '@/lib/dates'
import type { DashboardSummary } from '@/models/types'

/**
 * Versión compacta de la plata de arriba (variantes B y C, cuyo protagonista
 * es otra cosa — la lista de pendientes o la evolución). El piso es el
 * mismo en las 3 variantes: "en el primer viewport tienen que verse al
 * menos la deuda total y lo cobrado en el mes, y su relación con las cuotas"
 * (revisión del coordinador). Acá va en una sola línea que envuelve, sin
 * competir en tamaño con el protagonista de la variante.
 */
export function MoneySummaryStrip({ summary }: { summary: DashboardSummary }) {
  const period = formatPeriod(summary.period)
  const pct = collectionPct(summary)

  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-sm">
      <Link href="/cobranza/deuda" className="flex items-baseline gap-1.5 hover:underline">
        <span className="text-muted-foreground">Deuda total</span>
        <Amount cents={summary.totalDebtCents} className="font-semibold text-status-in-debt" />
      </Link>
      <Link href={`/cobranza/pagos?mes=${summary.period}`} className="flex flex-wrap items-baseline gap-1.5 hover:underline">
        <span className="text-muted-foreground">Cobrado en {period}</span>
        <Amount cents={summary.collectedCents} className="font-semibold" />
        <span className="text-muted-foreground">
          de <Amount cents={summary.feesCents} /> en cuotas
          {pct != null ? ` (${pct}%)` : ''}
        </span>
      </Link>
    </div>
  )
}
