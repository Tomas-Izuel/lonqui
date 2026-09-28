import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type {
  AccountListFilters,
  CurrentFeeLine,
  DailyCollectionPoint,
  DashboardSummary,
  DebtByCategoryRow,
  DebtStatus,
  MemberAccount,
  MemberCategoryRef,
  MemberStatus,
  MemberType,
  MonthCollection,
  MonthlyHistoryPoint,
  Page,
} from './types'

/**
 * Lecturas agregadas para el panel inicial y la cobranza (`/`, `/cobranza`,
 * `/reportes`): `member_accounts` paginado, `dashboard_summary`,
 * `debt_by_category` y `monthly_history` (`20260927130200_accounts.sql`).
 *
 * Todas esas RPC son SECURITY INVOKER y chequean el permiso EN EL CUERPO
 * (`payments.read` o `reports.read`, §6.6/§6.7 del pipeline
 * `2026-09-27-cuotas-pagos-panel`): la RLS filtra igual, y el chequeo del
 * controller (antes de llegar acá) es la re-verificación que evita mostrar el
 * error de Postgres en vez de un 403 claro — el mismo motivo por el que
 * `audit.model.ts` no repite el chequeo de rol.
 *
 * Nada se suma en TypeScript: toda agregación ya viene resuelta de la base
 * (PostgREST corta en `max_rows` sin avisar, y una deuda total sumada acá
 * daría mal en silencio con más de 1000 filas).
 */

const ACCOUNTS_PAGE_SIZE = 200

// -----------------------------------------------------------------------------
// Filas crudas de las RPC (snake_case) → tipos del dominio
//
// El generador de tipos de Supabase no infiere la nulabilidad de las columnas
// de una función (a diferencia de una tabla): declara `number`/`string` sin
// `| null` donde la función SÍ puede devolver null (p. ej. `current_fee_cents`
// sin facturación activa, o `category_id` en las filas especiales de
// `debt_by_category`). Estos tipos documentan la nulabilidad REAL, verificada
// contra `20260927130200_accounts.sql`, y `.overrideTypes` se la impone a la
// respuesta de supabase-js en vez de confiar en el tipo generado.
// -----------------------------------------------------------------------------

type CategoryRefJson = {
  category_id: number
  category_name: string
  discipline_id: number
  discipline_name: string
}

type CurrentFeeLineJson = {
  category_id: number | null
  category_name: string
  discipline_name: string | null
  amount_cents: number
}

type MemberAccountRow = {
  member_id: number
  full_name: string
  status: string
  member_type: string
  categories: CategoryRefJson[] | null
  family_group_id: number | null
  is_payment_responsible: boolean
  charged_cents: number
  paid_cents: number
  balance_cents: number
  months_due: number
  oldest_due_period: string | null
  last_payment_on: string | null
  last_payment_cents: number | null
  debt_status: string
  current_fee_cents: number | null
  current_fees: CurrentFeeLineJson[] | null
  current_fee_period: string | null
}

type DashboardSummaryRow = {
  billing_active: boolean
  billing_start_period: string | null
  period: string
  active_members: number
  collected_cents: number
  cash_cents: number
  transfer_cents: number
  payments_count: number
  fees_cents: number
  fees_count: number
  total_debt_cents: number
  members_in_debt: number
  members_with_credit: number
  credit_cents: number
  inactive_debt_cents: number
  inactive_in_debt: number
  admissions_count: number
  reactivations_count: number
  withdrawals_count: number
  expired_clearances: number
  missing_clearances: number
  pending_periods: string[]
}

type DebtByCategoryRowRaw = {
  kind: string
  category_id: number | null
  category_name: string
  discipline_id: number | null
  discipline_name: string | null
  members: number
  members_in_debt: number
  debt_cents: number
  sort_order: number
}

type MonthlyHistoryRowRaw = {
  period: string
  collected_cents: number
  fees_cents: number
  debt_at_close_cents: number
}

type MonthCollectionRowRaw = {
  period: string
  collected_cents: number
  cash_cents: number
  transfer_cents: number
  payments_count: number
  fees_cents: number
  fees_count: number
}

type DailyCollectionRowRaw = {
  day: string
  collected_cents: number
  cumulative_cents: number
}

function mapCategoryRef(json: CategoryRefJson): MemberCategoryRef {
  return {
    categoryId: json.category_id,
    categoryName: json.category_name,
    disciplineId: json.discipline_id,
    disciplineName: json.discipline_name,
  }
}

function mapCurrentFeeLine(json: CurrentFeeLineJson): CurrentFeeLine {
  return {
    categoryId: json.category_id,
    categoryName: json.category_name,
    disciplineName: json.discipline_name,
    amountCents: json.amount_cents,
  }
}

function mapMemberAccountRow(row: MemberAccountRow): MemberAccount {
  return {
    memberId: row.member_id,
    fullName: row.full_name,
    status: row.status as MemberStatus,
    memberType: row.member_type as MemberType,
    categories: (row.categories ?? []).map(mapCategoryRef),
    familyGroupId: row.family_group_id,
    isPaymentResponsible: row.is_payment_responsible,
    chargedCents: row.charged_cents,
    paidCents: row.paid_cents,
    balanceCents: row.balance_cents,
    monthsDue: row.months_due,
    oldestDuePeriod: row.oldest_due_period,
    lastPaymentOn: row.last_payment_on,
    lastPaymentCents: row.last_payment_cents,
    debtStatus: row.debt_status as DebtStatus,
    currentFeeCents: row.current_fee_cents,
    currentFees: (row.current_fees ?? []).map(mapCurrentFeeLine),
    currentFeePeriod: row.current_fee_period,
  }
}

function mapDashboardSummary(row: DashboardSummaryRow): DashboardSummary {
  return {
    billingActive: row.billing_active,
    billingStartPeriod: row.billing_start_period,
    period: row.period,
    activeMembers: row.active_members,
    collectedCents: row.collected_cents,
    cashCents: row.cash_cents,
    transferCents: row.transfer_cents,
    paymentsCount: row.payments_count,
    feesCents: row.fees_cents,
    feesCount: row.fees_count,
    totalDebtCents: row.total_debt_cents,
    membersInDebt: row.members_in_debt,
    membersWithCredit: row.members_with_credit,
    creditCents: row.credit_cents,
    inactiveDebtCents: row.inactive_debt_cents,
    inactiveInDebt: row.inactive_in_debt,
    admissionsCount: row.admissions_count,
    reactivationsCount: row.reactivations_count,
    withdrawalsCount: row.withdrawals_count,
    expiredClearances: row.expired_clearances,
    missingClearances: row.missing_clearances,
    pendingPeriods: row.pending_periods,
  }
}

function mapDebtByCategoryRow(row: DebtByCategoryRowRaw): DebtByCategoryRow {
  return {
    kind: row.kind as DebtByCategoryRow['kind'],
    categoryId: row.category_id,
    categoryName: row.category_name,
    disciplineId: row.discipline_id,
    disciplineName: row.discipline_name,
    members: row.members,
    membersInDebt: row.members_in_debt,
    debtCents: row.debt_cents,
  }
}

function mapMonthlyHistoryRow(row: MonthlyHistoryRowRaw): MonthlyHistoryPoint {
  return {
    period: row.period,
    collectedCents: row.collected_cents,
    feesCents: row.fees_cents,
    debtAtCloseCents: row.debt_at_close_cents,
  }
}

function mapMonthCollection(row: MonthCollectionRowRaw): MonthCollection {
  return {
    period: row.period,
    collectedCents: row.collected_cents,
    cashCents: row.cash_cents,
    transferCents: row.transfer_cents,
    paymentsCount: row.payments_count,
    feesCents: row.fees_cents,
    feesCount: row.fees_count,
  }
}

function mapDailyCollectionPoint(row: DailyCollectionRowRaw): DailyCollectionPoint {
  return {
    day: row.day,
    collectedCents: row.collected_cents,
    cumulativeCents: row.cumulative_cents,
  }
}

// -----------------------------------------------------------------------------
// Paginación de `member_accounts`: offset opaco en base64url.
//
// No es keyset (a diferencia de `audit.model.ts`): el orden pedido por la
// spec (`months_due desc, balance_cents desc, full_name`) no tiene una
// columna final que desempate de forma estable — dos socios pueden compartir
// apellido, monto y meses adeudados exactos. Con ~250 socios y páginas de 200
// el costo de un OFFSET es irrelevante.
// -----------------------------------------------------------------------------

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

/** Cursor inválido, corrupto o de un deploy viejo → primera página, nunca un error. */
function decodeOffsetCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0
  try {
    const offset = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
    return Number.isInteger(offset) && offset >= 0 ? offset : 0
  } catch {
    return 0
  }
}

/**
 * Filtros del "cargar más" de `/cobranza` (con deuda, al día), validados en
 * el borde de `loadMoreMemberAccounts` (`reports.actions.ts`) — mismo motivo
 * que `loadMoreMembersSchema` en `members.model.ts`: ese Server Action lo
 * llama un Client Component, así que el input es de un cliente que puede
 * mandar cualquier cosa, a diferencia de `getDebtListing`/`getUpToDateListing`
 * (Server Components, filtros ya tipados desde la page).
 */
export const loadMoreMemberAccountsSchema = z
  .object({
    debt: z.enum(['any', 'up_to_date', 'in_debt', 'credit'] satisfies (DebtStatus | 'any')[]).optional(),
    categoryId: z.number().int().positive().optional(),
    status: z.enum(['active', 'inactive', 'all'] satisfies (MemberStatus | 'all')[]).optional(),
    cursor: z.string().min(1, 'Cursor inválido').optional(),
  })
  .strict()
export type LoadMoreMemberAccountsInput = z.infer<typeof loadMoreMemberAccountsSchema>

/**
 * `member_accounts` paginado (páginas fijas de 200, nunca un pedido sin
 * `range`): alimenta los listados "con deuda" / "al día" de `/cobranza`.
 * `categoryId` filtra por inscripción ABIERTA (§13.5 de `00-architecture.md`);
 * la deuda que se muestra sigue siendo la TOTAL del socio, no solo la de esa
 * categoría — a la persona se le reclama todo, la atribución por cargo es
 * solo para el KPI de `debt_by_category`.
 */
export async function listMemberAccounts(filters: AccountListFilters = {}): Promise<Page<MemberAccount>> {
  const supabase = await createClient()
  const limit = ACCOUNTS_PAGE_SIZE
  const offset = decodeOffsetCursor(filters.cursor)

  let query = supabase.rpc('member_accounts', {
    status_filter: filters.status ?? 'active',
    category_filter: filters.categoryId,
  })

  // "Al día" incluye saldo a favor (D-hallazgo F1, 2026-09-28): un socio que
  // pagó de más no le debe nada al club, así que no puede quedar afuera del
  // listado "al día" ni de ningún otro por no calzar el enum exacto. `debt:
  // 'in_debt'` (deuda) y `debt: 'credit'` (si algún listado futuro lo pide
  // explícito) siguen siendo filtros estrictos de un solo valor.
  if (filters.debt === 'up_to_date') {
    query = query.in('debt_status', ['up_to_date', 'credit'])
  } else if (filters.debt && filters.debt !== 'any') {
    query = query.eq('debt_status', filters.debt)
  }

  // Pide una fila de más para saber si hay próxima página sin un segundo
  // round trip: `range` es inclusive, así que (offset, offset + limit) trae
  // limit + 1 filas.
  const { data, error } = await query
    .order('months_due', { ascending: false })
    .order('balance_cents', { ascending: false })
    .order('full_name', { ascending: true })
    .range(offset, offset + limit)
    .overrideTypes<MemberAccountRow[], { merge: false }>()

  if (error) throw error

  const rows = data ?? []
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  return {
    items: pageRows.map(mapMemberAccountRow),
    nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
  }
}

/** Los `limit` socios activos con más deuda, para el panel inicial. */
export async function listTopDebtors(limit: number): Promise<MemberAccount[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .rpc('member_accounts', { status_filter: 'active' })
    .eq('debt_status', 'in_debt')
    .order('months_due', { ascending: false })
    .order('balance_cents', { ascending: false })
    .order('full_name', { ascending: true })
    .range(0, limit - 1)
    .overrideTypes<MemberAccountRow[], { merge: false }>()

  if (error) throw error
  return (data ?? []).map(mapMemberAccountRow)
}

/** Una fila con los indicadores del panel inicial y de la cobranza del mes. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('dashboard_summary')
    .single()
    .overrideTypes<DashboardSummaryRow, { merge: false }>()

  if (error) throw error
  return mapDashboardSummary(data)
}

/**
 * Deuda de los socios activos atribuida cargo por cargo a la categoría
 * CONGELADA en el cargo (D31/D32, decidido por Tomás): la suma de
 * `debtCents` de todas las filas es la deuda total (`dashboard_summary.
 * total_debt_cents`). Ordenado por disciplina/categoría, con "Cuota social" y
 * "Saldo anterior al sistema" al final — el orden ya lo fija `sort_order` en
 * la base; se repite acá para no depender de un plan de ejecución implícito.
 */
export async function listDebtByCategory(): Promise<DebtByCategoryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('debt_by_category')
    .order('sort_order', { ascending: true })
    .overrideTypes<DebtByCategoryRowRaw[], { merge: false }>()

  if (error) throw error
  return (data ?? []).map(mapDebtByCategoryRow)
}

/** Los últimos `months` períodos (incluido el actual), para el gráfico del panel. */
export async function getMonthlyHistory(months = 12): Promise<MonthlyHistoryPoint[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('monthly_history', { months })
    .order('period', { ascending: true })
    .overrideTypes<MonthlyHistoryRowRaw[], { merge: false }>()

  if (error) throw error
  return (data ?? []).map(mapMonthlyHistoryRow)
}

/** Lo cobrado en `targetPeriod` (el mes actual del club si se omite): pagos por `paid_on`, aunque cubran deuda vieja. */
export async function getMonthCollection(targetPeriod?: string): Promise<MonthCollection> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('month_collection', targetPeriod ? { target_period: targetPeriod } : {})
    .single()
    .overrideTypes<MonthCollectionRowRaw, { merge: false }>()

  if (error) throw error
  return mapMonthCollection(data)
}

/**
 * Ritmo día a día de `targetPeriod` (el mes actual del club si se omite),
 * para el área acumulada de `/cobranza` (pipeline `2026-09-28-ui-expresiva`,
 * `daily_collection`). Una fila por día hasta hoy (o hasta fin de mes si el
 * período pedido ya cerró); `cumulativeCents` viene acumulado desde la base,
 * nunca sumado acá.
 */
export async function getDailyCollection(targetPeriod?: string): Promise<DailyCollectionPoint[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('daily_collection', targetPeriod ? { target_period: targetPeriod } : {})
    .order('day', { ascending: true })
    .overrideTypes<DailyCollectionRowRaw[], { merge: false }>()

  if (error) throw error
  return (data ?? []).map(mapDailyCollectionPoint)
}
