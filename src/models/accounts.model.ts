import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { listPaymentsForMember } from '@/models/payments.model'
import { FEE_SELECT, mapFeeRow, type FeeRow } from '@/models/fees.model'
import type {
  CurrentFeeLine,
  DebtStatus,
  Fee,
  FeeStatementLine,
  FeeStatementStatus,
  MemberAccount,
  MemberAccountDetail,
  MemberCategoryRef,
  MemberStatus,
  MemberType,
  Payment,
} from '@/models/types'

/**
 * Estado de cuenta: deuda derivada, nunca guardada (CLAUDE.md). Este modelo
 * NO calcula nada — todo el balance forward y la cobertura oldest-first
 * viven en las RPC de `20260927130200_accounts.sql`
 * (`private.member_balance`, `private.member_fee_coverage`,
 * `member_accounts`, `member_fee_statement`); acá solo se llama, se mapea a
 * camelCase y se resuelven los nombres que la RPC no trae (categoría del
 * statement).
 *
 * B3 (padrón/ficha) y B4 (listados/panel) importan las firmas de este
 * archivo tal cual: `getMemberAccount`/`getMemberAccounts` para "dame la
 * cuenta de estos socios puntuales" (ficha, precarga del pago de grupo);
 * B4 arma sus propios listados agregados llamando `member_accounts`
 * directamente (con `order`/`range`, que esta capa no expone) desde
 * `reports.model.ts`.
 */

// -----------------------------------------------------------------------------
// Mapeo de `member_accounts`
// -----------------------------------------------------------------------------

type MemberAccountRow = {
  member_id: number
  full_name: string
  status: string
  member_type: string
  categories: { category_id: number; category_name: string; discipline_id: number; discipline_name: string }[] | null
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
  current_fees: { category_id: number | null; category_name: string; discipline_name: string | null; amount_cents: number }[] | null
  current_fee_period: string | null
}

function mapCategoryRef(entry: {
  category_id: number
  category_name: string
  discipline_id: number
  discipline_name: string
}): MemberCategoryRef {
  return {
    categoryId: entry.category_id,
    categoryName: entry.category_name,
    disciplineId: entry.discipline_id,
    disciplineName: entry.discipline_name,
  }
}

function mapCurrentFeeLine(entry: {
  category_id: number | null
  category_name: string
  discipline_name: string | null
  amount_cents: number
}): CurrentFeeLine {
  return {
    categoryId: entry.category_id,
    categoryName: entry.category_name,
    disciplineName: entry.discipline_name,
    amountCents: entry.amount_cents,
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

// -----------------------------------------------------------------------------
// Cuentas puntuales (ficha, precarga del pago)
// -----------------------------------------------------------------------------

/**
 * La cuenta de UN socio, sin importar su estado (`status_filter: 'all'`): la
 * ficha muestra el estado de cuenta también de un socio dado de baja con
 * deuda pendiente.
 */
export async function getMemberAccount(memberId: number): Promise<MemberAccount | null> {
  const accounts = await getMemberAccounts([memberId])
  return accounts[0] ?? null
}

/**
 * La cuenta de varios socios puntuales EN UNA SOLA RPC (nunca N): la
 * precarga del pago de un grupo familiar trae a todos sus integrantes,
 * activos e inactivos, de una vez.
 */
export async function getMemberAccounts(memberIds: number[]): Promise<MemberAccount[]> {
  if (memberIds.length === 0) return []

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('member_accounts', {
    member_ids: memberIds,
    status_filter: 'all',
  })
  if (error) throw error

  return ((data ?? []) as unknown as MemberAccountRow[]).map(mapMemberAccountRow)
}

// -----------------------------------------------------------------------------
// Statement (meses adeudados de la ficha)
// -----------------------------------------------------------------------------

type FeeStatementRow = {
  fee_id: number
  period: string
  kind: string
  description: string | null
  amount_cents: number
  covered_cents: number
  category_id: number | null
  discipline_id: number | null
  status: string
  voided_at: string | null
  void_reason: string | null
}

type CategoryLabel = { name: string; disciplineName: string | null }
type CategoryLabelRow = { id: number; name: string; disciplines: { name: string } | null }

/**
 * Nombre de categoría Y de su disciplina para los `category_id` presentes en
 * el statement, en una sola consulta batch (embed de PostgREST
 * `categories → disciplines`, mismo patrón que `members.model.ts`): la RPC
 * `member_fee_statement` solo trae `category_id`/`discipline_id`, nunca
 * nombres (verificado contra la base real).
 *
 * BUG (reportado por F2, 2026-09-28): la primera versión de este archivo
 * dejaba `disciplineName` hardcodeado en `null` para toda fila, incluidas
 * las cuotas por deporte. `categoryName` sí se resolvía (esta función ya
 * hacía esa consulta), pero solo traía `name`, sin la disciplina.
 */
async function resolveCategoryLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryIds: readonly (number | null)[],
): Promise<Map<number, CategoryLabel>> {
  const ids = [...new Set(categoryIds.filter((id): id is number => id !== null))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('categories').select('id, name, disciplines(name)').in('id', ids)
  if (error) throw error

  return new Map(
    ((data ?? []) as unknown as CategoryLabelRow[]).map((row) => [
      row.id,
      { name: row.name, disciplineName: row.disciplines?.name ?? null },
    ]),
  )
}

function mapStatementRow(row: FeeStatementRow, categoryLabels: Map<number, CategoryLabel>): FeeStatementLine {
  const label = row.category_id !== null ? categoryLabels.get(row.category_id) : undefined
  return {
    feeId: row.fee_id,
    period: row.period,
    kind: row.kind as Fee['kind'],
    description: row.description,
    amountCents: row.amount_cents,
    coveredCents: row.covered_cents,
    categoryId: row.category_id,
    // Null en la cuota social y en el saldo anterior (D31): la vista lo
    // distingue por `kind`/`categoryId`, no por un texto fijo acá.
    categoryName: label?.name ?? null,
    disciplineName: label?.disciplineName ?? null,
    status: row.status as FeeStatementStatus,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  }
}

/** Cada cargo del socio con cuánto lo cubren sus pagos, del más viejo al más nuevo: los "meses adeudados" de la ficha. */
export async function getFeeStatement(memberId: number): Promise<FeeStatementLine[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('member_fee_statement', { target_member_id: memberId })
  if (error) throw error

  const rows = (data ?? []) as unknown as FeeStatementRow[]
  const categoryLabels = await resolveCategoryLabels(
    supabase,
    rows.map((row) => row.category_id),
  )

  return rows.map((row) => mapStatementRow(row, categoryLabels))
}

// -----------------------------------------------------------------------------
// Detalle completo (cuenta + statement + pagos + saldo de arranque)
// -----------------------------------------------------------------------------

/** El saldo de arranque VIGENTE (no anulado) del socio, o null si nunca tuvo o el que tenía se anuló. */
async function getOpeningBalance(memberId: number): Promise<Fee | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fees')
    .select(FEE_SELECT)
    .eq('member_id', memberId)
    .eq('kind', 'opening_balance')
    .is('voided_at', null)
    .maybeSingle()
  if (error) throw error

  return data ? mapFeeRow(data as FeeRow) : null
}

/**
 * Ficha completa del estado de cuenta: cuenta, statement, TODOS los pagos
 * (incluidos anulados: es un registro, no solo lo vigente) y el saldo de
 * arranque vigente. Asume que quien llama ya verificó `payments.read`
 * (`MemberPageData.account` es `null` sin ese permiso, D. de B3) — acá no se
 * repite el chequeo porque las cuatro consultas ya lo hacen en su cuerpo
 * (`private.require_permission`) y fallarían igual si no lo tuviera.
 */
export async function getMemberAccountDetail(memberId: number): Promise<MemberAccountDetail> {
  const account = await getMemberAccount(memberId)
  if (!account) {
    throw new DomainError('El socio no existe', { status: 404 })
  }

  const [statement, payments, openingBalance] = await Promise.all([
    getFeeStatement(memberId),
    listPaymentsForMember(memberId),
    getOpeningBalance(memberId),
  ])

  return { account, statement, payments: payments as Payment[], openingBalance }
}
