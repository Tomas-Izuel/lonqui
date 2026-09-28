import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount } from '@/views/shared/money'
import { formatPeriod } from '@/lib/dates'
import type { MonthlyHistoryPoint } from '@/models/types'

/** El cuerpo de la tabla, sin el `sr-only` que lo envuelve. */
function HistoryTableBody({ points }: { points: MonthlyHistoryPoint[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Mes</TableHead>
          <TableHead className="text-right tabular-nums">Cobrado</TableHead>
          <TableHead className="text-right tabular-nums">Deuda al cierre</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {points.map((p) => (
          <TableRow key={p.period}>
            <TableCell className="capitalize">{formatPeriod(p.period)}</TableCell>
            <TableCell className="text-right tabular-nums">
              <Amount cents={p.collectedCents} />
            </TableCell>
            <TableCell className="text-right tabular-nums text-status-in-debt">
              <Amount cents={p.debtAtCloseCents} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * Equivalente accesible del gráfico (spec F3), SIEMPRE en el DOM pero
 * visualmente oculta: quien usa lector de pantalla llega al mismo dato exacto
 * sin depender del SVG.
 */
export function HistoryTableHidden({ points }: { points: MonthlyHistoryPoint[] }) {
  return (
    <div className="sr-only">
      <HistoryTableBody points={points} />
    </div>
  )
}
