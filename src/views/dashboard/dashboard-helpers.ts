import type { BillingStatus, DashboardSummary, Permission } from '@/models/types'

/**
 * Aviso T1 ("No se generaron las cuotas de <mes>"): solo para quien puede
 * reintentar. Nunca un banner permanente — con `ok`/`not_due` no se muestra.
 */
export function shouldShowRunNotice(billing: BillingStatus, permissions: Permission[]): boolean {
  return permissions.includes('billing.configure') && (billing.currentPeriodRun === 'failed' || billing.currentPeriodRun === 'missing')
}

/**
 * % de lo cobrado en el mes contra el valor de las cuotas del mes — puede
 * pasar 100% (se cobran meses viejos con el pago de hoy). Null sin cuotas
 * generadas todavía (evita dividir por cero, no "Infinity%" ni "NaN%").
 */
export function collectionPct(summary: DashboardSummary): number | null {
  return summary.feesCents > 0 ? Math.round((summary.collectedCents / summary.feesCents) * 100) : null
}
