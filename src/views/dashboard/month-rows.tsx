import { Amount } from '@/views/shared/money'
import { DataRow, DataRowGroup } from '@/views/dashboard/data-row'
import type { DashboardSummary } from '@/models/types'

/**
 * Detalle de "Este mes": efectivo vs. transferencia. "Cobrado en <mes>",
 * "Cuotas de <mes>" y el % ya se muestran arriba, en `MoneyHeadline`
 * (variante A) o `MoneySummaryStrip` (B y C) — repetirlos acá sería la
 * misma cifra dos veces en la misma pantalla (revisión del coordinador,
 * 2026-09-28: "la plata va primero", que exigió mover esas filas arriba).
 */
export function MonthDetailRows({ summary }: { summary: DashboardSummary }) {
  return (
    <DataRowGroup>
      <DataRow label="Efectivo" value={<Amount cents={summary.cashCents} />} />
      <DataRow label="Transferencia" value={<Amount cents={summary.transferCents} />} />
      <DataRow label="Cantidad de pagos" value={summary.paymentsCount} />
    </DataRowGroup>
  )
}
