import { randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
import { actAsSuperuser, createMember } from './helpers'

/**
 * Fixtures compartidos de `payment-month-options.test.ts` y
 * `register-payment-batch.test.ts` (pipeline 2026-10-24-pago-por-meses).
 *
 * Todo es RELATIVO al mes actual de la base (`club_today()`), nunca un mes
 * hardcodeado: la base local corre con el reloj real, y el mes en curso cambia.
 * Todo corre dentro de `withRollback`, así que ni `settings` ni `fees` quedan
 * tocados.
 */

/** Primer día del mes `offset` meses desde el mes actual del club (`YYYY-MM-DD`). */
export async function monthAt(client: ClientBase, offset: number): Promise<string> {
  const r = await client.query<{ m: string }>(
    `select to_char((date_trunc('month', private.club_today()) + make_interval(months => $1::int))::date, 'YYYY-MM-DD') as m`,
    [offset],
  )
  return r.rows[0].m
}

/**
 * Fija `settings.billing_start_period` salteando su guard (que prohíbe mover el
 * inicio al pasado o con cuotas generadas). `postgres` no es superusuario en
 * Supabase, así que no hay `session_replication_role`: se apaga el trigger con
 * DDL, que es transaccional y se deshace con el rollback.
 */
export async function setBillingStart(client: ClientBase, startPeriod: string | null): Promise<void> {
  await actAsSuperuser(client)
  await client.query(`alter table public.settings disable trigger settings_billing_guard`)
  await client.query(`update public.settings set billing_start_period = $1 where id = 1`, [startPeriod])
}

export async function setBillingStartOffset(client: ClientBase, offset: number): Promise<string> {
  const period = await monthAt(client, offset)
  await setBillingStart(client, period)
  return period
}

/** Socio activo, social (sin categorías). `joinedOn` por defecto: el mes actual, o sea DESPUÉS de un inicio pasado. */
export async function createFakeMember(
  client: ClientBase,
  input?: { joinedOn?: string; label?: string; familyGroupId?: number | null },
): Promise<number> {
  await actAsSuperuser(client)
  const joinedOn = input?.joinedOn ?? (await monthAt(client, 0))
  return createMember(client, {
    firstName: input?.label ?? 'Fulano',
    lastName: 'Inventado',
    joinedOn,
    familyGroupId: input?.familyGroupId ?? null,
  })
}

/** Baja efectiva hoy (evento de egreso; el trigger pasa el socio a inactive). */
export async function withdrawMember(client: ClientBase, memberId: number): Promise<void> {
  await actAsSuperuser(client)
  await client.query(
    `insert into public.member_status_events (member_id, event_type, effective_on, reason)
     values ($1, 'withdrawal', private.club_today(), 'Baja de prueba')`,
    [memberId],
  )
}

/** Precio de la cuota social de hoy para el socio, tal como lo ve la RPC. */
export async function priceToday(client: ClientBase, memberId: number): Promise<number> {
  const r = await client.query<{ p: string }>(
    `select private.member_fee_price_at($1, date_trunc('month', private.club_today())::date) as p`,
    [memberId],
  )
  return Number(r.rows[0].p)
}

export async function insertMonthlyFee(
  client: ClientBase,
  input: { memberId: number; period: string; amountCents: number; categoryId?: number | null; disciplineId?: number | null },
): Promise<number> {
  await actAsSuperuser(client)
  const r = await client.query<{ id: string }>(
    `insert into public.fees (member_id, period, kind, amount_cents, category_id, discipline_id, description)
     values ($1, $2, 'monthly', $3, $4, $5, 'fixture') returning id`,
    [input.memberId, input.period, input.amountCents, input.categoryId ?? null, input.disciplineId ?? null],
  )
  return Number(r.rows[0].id)
}

export async function insertOpeningBalanceFee(client: ClientBase, memberId: number, amountCents: number): Promise<number> {
  await actAsSuperuser(client)
  // El trigger fija el período (inicio - 1): se manda uno cualquiera válido.
  const r = await client.query<{ id: string }>(
    `insert into public.fees (member_id, period, kind, amount_cents, description)
     values ($1, '2000-01-01', 'opening_balance', $2, 'fixture arranque') returning id`,
    [memberId, amountCents],
  )
  return Number(r.rows[0].id)
}

export async function insertPayment(
  client: ClientBase,
  input: { memberId: number; amountCents: number },
): Promise<number> {
  await actAsSuperuser(client)
  const r = await client.query<{ id: string }>(
    `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id)
     values ($1, $2, private.club_today(), 'cash', $3) returning id`,
    [input.memberId, input.amountCents, randomUUID()],
  )
  return Number(r.rows[0].id)
}

export type MonthRow = {
  member_id: string
  period: string
  kind: string
  amount_cents: string
  covered_cents: string
  pending_cents: string
  is_current: boolean
  priced_at_today: boolean
}

export type MonthRowNum = {
  memberId: number
  period: string
  kind: string
  amount: number
  covered: number
  pending: number
  isCurrent: boolean
  pricedAtToday: boolean
}

/** `payment_month_options` con fechas como `YYYY-MM-DD` y bigints como number. Corre con el rol actual de la sesión. */
export async function monthOptions(client: ClientBase, memberIds: number[]): Promise<MonthRowNum[]> {
  const r = await client.query<MonthRow>(
    `select member_id, to_char(period, 'YYYY-MM-DD') as period, kind, amount_cents, covered_cents, pending_cents, is_current, priced_at_today
     from public.payment_month_options($1::bigint[]) order by member_id, period`,
    [memberIds],
  )
  return r.rows.map((row) => ({
    memberId: Number(row.member_id),
    period: row.period,
    kind: row.kind,
    amount: Number(row.amount_cents),
    covered: Number(row.covered_cents),
    pending: Number(row.pending_cents),
    isCurrent: row.is_current,
    pricedAtToday: row.priced_at_today,
  }))
}

/** Cuenta filas salteando RLS y DEJA la sesión como estaba (rol y claims), para seguir actuando como el mismo usuario. */
export async function countRows(client: ClientBase, table: 'fees' | 'payments', memberIds: number[]): Promise<number> {
  const prev = await client.query<{ role: string; claims: string | null }>(
    `select current_user as role, current_setting('request.jwt.claims', true) as claims`,
  )
  await actAsSuperuser(client)
  const r = await client.query<{ n: number }>(`select count(*)::int as n from public.${table} where member_id = any($1::bigint[])`, [memberIds])
  if (prev.rows[0].role !== 'postgres') {
    await client.query(`set local role ${prev.rows[0].role}`)
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [prev.rows[0].claims ?? ''])
  }
  return r.rows[0].n
}
