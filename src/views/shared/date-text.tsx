import { formatDate, formatDateTime, formatPeriod } from '@/lib/dates'
import { cn } from '@/lib/utils'

/** Una fecha (`date` de Postgres) formateada "25/09/2026", tabular. */
export function DateText({ date, className }: { date: string; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatDate(date)}</span>
}

/** Un instante (`timestamptz`) formateado "25/09/2026 14:30" en la zona del club, tabular. */
export function DateTimeText({ instant, className }: { instant: string; className?: string }) {
  return <span className={cn('tabular-nums', className)}>{formatDateTime(instant)}</span>
}

/** Un período (`YYYY-MM-01`) como "septiembre 2026". */
export function PeriodText({ period, className }: { period: string; className?: string }) {
  return <span className={className}>{formatPeriod(period)}</span>
}
