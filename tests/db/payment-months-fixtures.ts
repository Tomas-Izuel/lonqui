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

/**
 * Una fila de saldo anterior. `period` es el mes real (desde 20261029120000 el saldo es una
 * fila por mes y el guard ya no lo pisa); sin `period` manda `null` y el guard cae al "inicio - 1"
 * de compat (lo que hacía el código viejo / el seed).
 */
export async function insertOpeningBalanceFee(
  client: ClientBase,
  memberId: number,
  amountCents: number,
  period: string | null = null,
): Promise<number> {
  await actAsSuperuser(client)
  const r = await client.query<{ id: string }>(
    `insert into public.fees (member_id, period, kind, amount_cents, description)
     values ($1, $2, 'opening_balance', $3, 'fixture arranque') returning id`,
    [memberId, period, amountCents],
  )
  return Number(r.rows[0].id)
}

/** N filas de saldo anterior (una por mes) en UN insert, como lo hace el lote / la ficha. Devuelve los ids en orden de mes. */
export async function insertOpeningMonths(
  client: ClientBase,
  memberId: number,
  months: { period: string; amountCents: number }[],
): Promise<number[]> {
  await actAsSuperuser(client)
  const r = await client.query<{ id: string }>(
    `insert into public.fees (member_id, kind, period, amount_cents)
     select $1, 'opening_balance', (m ->> 'period')::date, (m ->> 'amountCents')::bigint
     from jsonb_array_elements($2::jsonb) m
     returning id`,
    [memberId, JSON.stringify(months)],
  )
  return r.rows.map((row) => Number(row.id)).sort((a, b) => a - b)
}

/**
 * SOLO para el test de migración: un saldo anterior con la FORMA VIEJA (un tramo en
 * from_period/to_period, period = inicio - 1). El guard nuevo lo rechaza, así que se apaga con DDL
 * transaccional (se deshace con el rollback) y se vuelve a prender.
 */
export async function insertLegacySpan(
  client: ClientBase,
  memberId: number,
  from: string,
  to: string,
  amountCents: number,
  opts?: { createdBy?: string | null; createdAt?: string },
): Promise<number> {
  await actAsSuperuser(client)
  const start = await client.query<{ p: string }>(
    `select to_char(billing_start_period - interval '1 month', 'YYYY-MM-DD') as p from public.settings where id = 1`,
  )
  await client.query(`alter table public.fees disable trigger fees_opening_balance_guard`)
  try {
    const r = await client.query<{ id: string }>(
      `insert into public.fees (member_id, period, kind, amount_cents, description, from_period, to_period, created_by, created_at)
       values ($1, $2, 'opening_balance', $3, 'fixture tramo viejo', $4, $5, $6, coalesce($7::timestamptz, now())) returning id`,
      [memberId, start.rows[0].p, amountCents, from, to, opts?.createdBy ?? null, opts?.createdAt ?? null],
    )
    return Number(r.rows[0].id)
  } finally {
    await client.query(`alter table public.fees enable trigger fees_opening_balance_guard`)
  }
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
  before_joined: boolean
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
  /** Solo las `pre_system`: el mes es anterior al mes de alta del socio. */
  beforeJoined: boolean
}

/** `payment_month_options` con fechas como `YYYY-MM-DD` y bigints como number. Corre con el rol actual de la sesión. */
export async function monthOptions(client: ClientBase, memberIds: number[]): Promise<MonthRowNum[]> {
  const r = await client.query<MonthRow>(
    `select member_id, to_char(period, 'YYYY-MM-DD') as period, kind, amount_cents, covered_cents, pending_cents, is_current, priced_at_today, before_joined
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
    beforeJoined: row.before_joined,
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

export type FeeStatusRow = { feeId: number; period: string; kind: string; amount: number; paid: number; pending: number; status: string }

/** `fee_status` de un socio, como `postgres` (deja la sesión como estaba), por período y id. */
export async function feeStatus(client: ClientBase, memberId: number): Promise<FeeStatusRow[]> {
  const prev = await keepSession(client)
  const r = await client.query(
    `select fee_id, to_char(period, 'YYYY-MM-DD') as period, kind, amount_cents, paid_cents, pending_cents, status
     from public.fee_status where member_id = $1 order by period, fee_id`,
    [memberId],
  )
  await prev()
  return r.rows.map((x) => ({
    feeId: Number(x.fee_id),
    period: x.period,
    kind: x.kind,
    amount: Number(x.amount_cents),
    paid: Number(x.paid_cents),
    pending: Number(x.pending_cents),
    status: x.status,
  }))
}

/** Saldo a favor (Σ credit_cents de `payment_credit`) de un socio. */
export async function paymentCredit(client: ClientBase, memberId: number): Promise<number> {
  const prev = await keepSession(client)
  const r = await client.query(`select coalesce(sum(credit_cents), 0)::bigint as c from public.payment_credit where member_id = $1`, [memberId])
  await prev()
  return Number(r.rows[0].c)
}

export type AllocationRow = { id: number; paymentId: number; feeId: number; amount: number; source: string; period: string }

/** Imputaciones de un pago (o de todos los de un socio con `byMember`), en orden de inserción. */
export async function allocations(client: ClientBase, paymentId: number): Promise<AllocationRow[]> {
  const prev = await keepSession(client)
  const r = await client.query(
    `select a.id, a.payment_id, a.fee_id, a.amount_cents, a.source, to_char(f.period, 'YYYY-MM-DD') as period
     from public.payment_allocations a join public.fees f on f.id = a.fee_id
     where a.payment_id = $1 order by a.id`,
    [paymentId],
  )
  await prev()
  return r.rows.map((x) => ({
    id: Number(x.id),
    paymentId: Number(x.payment_id),
    feeId: Number(x.fee_id),
    amount: Number(x.amount_cents),
    source: x.source,
    period: x.period,
  }))
}

/** Pasa a `postgres` y devuelve cómo volver al rol/claims que había. */
async function keepSession(client: ClientBase): Promise<() => Promise<void>> {
  const prev = await client.query<{ role: string; claims: string | null }>(
    `select current_user as role, current_setting('request.jwt.claims', true) as claims`,
  )
  await actAsSuperuser(client)
  return async () => {
    if (prev.rows[0].role !== 'postgres') {
      await client.query(`set local role ${prev.rows[0].role}`)
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [prev.rows[0].claims ?? ''])
    }
  }
}

export type BatchItem = {
  member_id: number
  amount_cents: number
  marked_periods?: string[] | null
  opening_months?: { period: string; amount_cents: number; description?: string }[] | null
  /** Forma vieja (tramo): la RPC la expande a N filas. */
  opening_balance?: { from_period: string; to_period: string; amount_cents: number; description?: string } | null
}

/** `register_payment_batch` con el rol actual de la sesión. */
export async function callBatch(client: ClientBase, items: BatchItem[], batchId: string = randomUUID()) {
  const r = await client.query<{
    member_id: string
    payment_id: string
    opening_balance_fee_id: string | null
    already_registered: boolean
  }>(
    `select * from public.register_payment_batch($1::uuid, private.club_today(), 'cash', null, null, $2::jsonb)`,
    [batchId, JSON.stringify(items)],
  )
  return r.rows.map((row) => ({
    memberId: Number(row.member_id),
    paymentId: Number(row.payment_id),
    feeId: row.opening_balance_fee_id === null ? null : Number(row.opening_balance_fee_id),
    already: row.already_registered,
  }))
}
