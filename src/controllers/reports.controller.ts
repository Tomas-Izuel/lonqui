import 'server-only'

import { requirePanelPermission } from '@/controllers/session.controller'
// B1 (en paralelo, ver 02-development-backend-b4.md): billing.model.ts expone
// `getBillingStatus`, que no exige permiso propio (la spec de B1 dice
// explícitamente "getBillingStatus no exige permiso: la usan /socios,
// /caja y el panel"). Si el nombre final difiere, el typecheck lo marca
// acá cuando B1 aterrice.
import { getBillingStatus } from '@/models/billing.model'
import {
  getCashMonthSummary,
  getDailyCollection,
  getDashboardSummary,
  getMonthlyHistory,
  listDebtByCategory,
  listMemberAccounts,
  listTopDebtors,
} from '@/models/reports.model'
import type {
  AccountListFilters,
  BillingStatus,
  CashMonthSummary,
  DailyCollectionPoint,
  DashboardData,
  DashboardSummary,
  DebtByCategoryRow,
  MemberAccount,
  Page,
} from '@/models/types'

/**
 * Lecturas del panel inicial y de la cobranza (`/`, `/caja`, `/reportes`).
 * Ningún controller de este archivo escribe: eso vive en B1 (facturación) y B2
 * (pagos y cuenta). Cada función vuelve a chequear el permiso ANTES de tocar
 * la base (T12), aunque las RPC de `reports.model.ts` ya lo hagan en el
 * cuerpo: sin este chequeo acá, un `consulta` sin `payments.read` (hoy no
 * existe, pero el catálogo de permisos es de a uno por vez) vería el error de
 * Postgres en vez de la página "sin acceso" del panel.
 */

const TOP_DEBTORS_LIMIT = 5

/**
 * Panel inicial: cualquier rol con `reports.read`. Con facturación inactiva
 * no tira: `dashboard_summary` y el resto de las RPC ya devuelven
 * `billingActive: false` y montos/listas en cero (spec B4), así que no hace
 * falta un camino especial acá — la vista es la que decide qué avisar.
 */
export async function getDashboard(): Promise<DashboardData> {
  await requirePanelPermission('reports.read')

  const [summary, topDebtors, byCategory, history, billing] = await Promise.all([
    getDashboardSummary(),
    listTopDebtors(TOP_DEBTORS_LIMIT),
    listDebtByCategory(),
    getMonthlyHistory(12),
    getBillingStatus(),
  ])

  return { summary, topDebtors, byCategory, history, billing }
}

export type CajaHubData = {
  /** Cuotas + otros ingresos del mes actual, con desglose por concepto. */
  cash: CashMonthSummary
  /** `dashboard_summary`: de acá salen `membersInDebt` y `totalDebtCents`; no se recalculan. */
  summary: DashboardSummary
  billing: BillingStatus
  /** Ritmo día a día de la COBRANZA de cuotas del mes actual (el área acumulada no incluye otros ingresos). */
  daily: DailyCollectionPoint[]
}

/**
 * Cabecera de `/caja`. `requirePanelPermission` exige TODOS los permisos
 * listados: son los que chequea `cash_month_summary` (payments.read +
 * income.read) más `reports.read` del `dashboard_summary`. Hoy los tres roles
 * los tienen juntos; si un rol configurable futuro tiene solo algunos, esta
 * pantalla le queda cerrada (redirige) en vez de mostrarle el error de una RPC.
 */
export async function getCajaHub(): Promise<CajaHubData> {
  await requirePanelPermission('payments.read', 'income.read', 'reports.read')

  const [cash, summary, billing, daily] = await Promise.all([
    getCashMonthSummary(),
    getDashboardSummary(),
    getBillingStatus(),
    getDailyCollection(),
  ])
  return { cash, summary, billing, daily }
}

/** Listado "con deuda" de `/caja`: mismos filtros que el padrón, forzando `debt: 'in_debt'`. */
export async function getDebtListing(filters: Omit<AccountListFilters, 'debt'> = {}): Promise<Page<MemberAccount>> {
  await requirePanelPermission('payments.read')
  return listMemberAccounts({ ...filters, debt: 'in_debt' })
}

/** Listado "al día" de `/caja`. */
export async function getUpToDateListing(
  filters: Omit<AccountListFilters, 'debt'> = {},
): Promise<Page<MemberAccount>> {
  await requirePanelPermission('payments.read')
  return listMemberAccounts({ ...filters, debt: 'up_to_date' })
}

export type DebtByCategoryPage = {
  rows: DebtByCategoryRow[]
  totalCents: number
}

/**
 * `/caja/por-categoria`. `totalCents` sale de `dashboard_summary.
 * total_debt_cents`, NUNCA de sumar `rows` en TypeScript (spec B4): así la
 * vista puede afirmar "coincide con la deuda total" sin que una fila fuera de
 * rango o un redondeo lo desmienta.
 */
export async function getDebtByCategoryPage(): Promise<DebtByCategoryPage> {
  await requirePanelPermission('payments.read')

  const [rows, summary] = await Promise.all([listDebtByCategory(), getDashboardSummary()])
  return { rows, totalCents: summary.totalDebtCents }
}
