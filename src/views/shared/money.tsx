import { formatCentsCompact } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Un monto en centavos, siempre con numerales tabulares (piso de calidad:
 * "montos con numerales tabulares"). Cero data fetching: recibe los centavos
 * ya resueltos.
 */
export function Amount({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatCentsCompact(cents)}</span>
}
