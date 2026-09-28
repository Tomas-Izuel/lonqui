import { Check, CircleDashed, AlertCircle, Ban, Circle, type LucideIcon } from 'lucide-react'
import { addMonths, formatPeriod } from '@/lib/dates'
import { shortMonth } from '@/views/shared/chart-format'
import { Panel } from '@/views/shared/panel'
import { cn } from '@/lib/utils'
import type { FeeStatementLine, ISODate } from '@/models/types'

type PeriodCellStatus = 'paid' | 'partial' | 'due' | 'voided' | 'none'

const STATUS_LABEL: Record<PeriodCellStatus, string> = {
  paid: 'Pagado',
  partial: 'Parcial',
  due: 'Adeudado',
  voided: 'Anulado',
  none: 'Sin cargo',
}

/** Mismo criterio de color que `MemberFeeStatement` (up-to-date/in-debt/muted): nunca un color por categoría. */
const STATUS_TEXT_CLASS: Record<PeriodCellStatus, string> = {
  paid: 'text-status-up-to-date',
  partial: 'text-status-in-debt',
  due: 'text-status-in-debt',
  voided: 'text-muted-foreground',
  none: 'text-muted-foreground',
}

/**
 * Una forma por estado, no solo un color (screenshot review, ronda 2: a
 * 390px, 12 celdas con la palabra completa quedaban apretadas y envolvían
 * mal). El ícono es la segunda señal, independiente del color — alguien con
 * daltonismo todavía distingue "pagado" de "adeudado" por la forma.
 */
const STATUS_ICON: Record<PeriodCellStatus, LucideIcon> = {
  paid: Check,
  partial: CircleDashed,
  due: AlertCircle,
  voided: Ban,
  none: Circle,
}

/**
 * Un período puede tener más de una línea (una cuota por deporte): se
 * mira solo las no anuladas. Todas pagas → pagado; alguna parcial → parcial
 * (nunca se pierde el matiz agrupando con "adeudado"); si no, adeudado. Sin
 * ninguna línea no anulada (todas anuladas) → anulado; sin ninguna línea → sin
 * cargo (el período todavía no se generó, o es anterior al alta del socio).
 */
function periodStatus(lines: FeeStatementLine[]): PeriodCellStatus {
  if (lines.length === 0) return 'none'
  const active = lines.filter((line) => !line.voidedAt)
  if (active.length === 0) return 'voided'
  if (active.every((line) => line.status === 'paid')) return 'paid'
  if (active.some((line) => line.status === 'partial')) return 'partial'
  return 'due'
}

/**
 * Tira de los últimos 12 meses, arriba de "Cuotas"/"Pagos" en la pestaña
 * Movimientos (addendum del hilo principal, pipeline 2026-09-28): responde
 * "¿desde cuándo?" de un vistazo, sin leer el detalle línea por línea.
 * Deriva de `statement` (ya cargado por la ficha, `getMemberPage`) — ninguna
 * consulta nueva. `currentPeriod` es `billing.currentPeriod`, ya calculado en
 * el servidor con la hora del club (nunca `new Date()` en el cliente).
 *
 * Nunca solo color (piso de calidad): cada celda es una inicial de mes + un
 * ícono distinto por estado (nunca el mismo ícono con otro color) + un
 * `title` nativo y un texto `sr-only` con la fecha y el estado completos —
 * un lector de pantalla escucha "septiembre 2026: adeudado", nunca solo una
 * letra. Una sola fila de 12 celdas angostas en vez de 6×2 (screenshot
 * review, ronda 2: la palabra completa por celda no entraba a 390px sin
 * envolver mal) — nunca scroll horizontal, las 12 caben angostas.
 */
export function MemberPeriodStrip({ statement, currentPeriod }: { statement: FeeStatementLine[]; currentPeriod: ISODate }) {
  const periods: ISODate[] = []
  for (let i = 11; i >= 0; i--) periods.push(addMonths(currentPeriod, -i))

  const byPeriod = new Map<ISODate, FeeStatementLine[]>()
  for (const line of statement) {
    const list = byPeriod.get(line.period)
    if (list) list.push(line)
    else byPeriod.set(line.period, [line])
  }

  return (
    <Panel title="Últimos 12 meses">
      <ul className="grid grid-cols-12 gap-1">
        {periods.map((period) => {
          const status = periodStatus(byPeriod.get(period) ?? [])
          const Icon = STATUS_ICON[status]
          const fullLabel = `${formatPeriod(period)}: ${STATUS_LABEL[status]}`
          return (
            <li key={period} className="min-w-0">
              <div title={fullLabel} className="flex flex-col items-center gap-1 py-1">
                <Icon aria-hidden className={cn('size-3.5 shrink-0', STATUS_TEXT_CLASS[status])} />
                <span aria-hidden className={cn('text-xs leading-none font-semibold capitalize', STATUS_TEXT_CLASS[status])}>
                  {shortMonth(period).slice(0, 1)}
                </span>
                <span className="sr-only">{fullLabel}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
