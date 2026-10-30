import { randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import { splitOpeningTotal } from '@/views/payments/month-selection'
import { actAs, actAsSuperuser, createCategory, createDiscipline, createFamilyGroup, createUserWithRole, expectQueryError, isDbAvailable, withRollback } from './helpers'
import {
  allocations,
  createFakeMember,
  feeStatus,
  insertLegacySpan,
  insertMonthlyFee,
  insertOpeningBalanceFee,
  monthAt,
  setBillingStartOffset,
} from './payment-months-fixtures'

/**
 * EL test del pipeline 2026-10-29-imputacion-libre-meses: la migración `20261029120000_payment_allocations`
 * corre contra producción, con datos reales de FORMA VIEJA (saldos anteriores con tramo, pagos como
 * pozo por socio). Acá se arma esa forma vieja y se corren, como `postgres`, las mismas funciones que
 * la migración, en el mismo orden: snapshot → migrate_opening_spans → backfill_allocations → verify.
 *
 * Mientras se arma el escenario y se corre la migración, el motor (los 3 triggers) está APAGADO con DDL
 * transaccional: la migración real los crea al final, después de convertir y backfillear. Se vuelven a
 * prender DESPUÉS de verificar (que es cuando existen en producción). Todo se deshace con el rollback.
 *
 * Datos inventados; todo relativo al mes actual del club. P = $10.000 en centavos.
 */
const dbAvailable = await isDbAvailable()
const P = 1_000_000
const SYSTEM_UUID = '00000000-0000-0000-0000-000000000000'
const VOID_REASON = 'Convertido a saldo anterior por mes (migración 20261029120000)'

async function engineOff(client: ClientBase) {
  await actAsSuperuser(client)
  for (const [table, trigger] of [
    ['payments', 'payments_allocate_on_insert'],
    ['fees', 'fees_apply_credit_on_insert'],
    ['fees', 'fees_apply_credit_on_void'],
    ['payments', 'payments_apply_credit_on_void'],
  ] as const) {
    await client.query(`alter table public.${table} disable trigger ${trigger}`)
  }
  // El dev stack puede traer imputaciones del motor nuevo; la migración real corre sobre una base SIN tabla.
  // Para que backfill_allocations (que solo corre si no hay ninguna) actúe, se despeja dentro de la transacción.
  await client.query(`alter table public.payment_allocations disable trigger payment_allocations_no_change`)
  await client.query(`delete from public.payment_allocations`)
}

async function engineOn(client: ClientBase) {
  await actAsSuperuser(client)
  for (const [table, trigger] of [
    ['payments', 'payments_allocate_on_insert'],
    ['fees', 'fees_apply_credit_on_insert'],
    ['fees', 'fees_apply_credit_on_void'],
    ['payments', 'payments_apply_credit_on_void'],
  ] as const) {
    await client.query(`alter table public.${table} enable trigger ${trigger}`)
  }
}

async function pay(client: ClientBase, memberId: number, amountCents: number, batchId: string = randomUUID()) {
  const r = await client.query<{ id: string }>(
    `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, $2, private.club_today(), 'cash', $3) returning id`,
    [memberId, amountCents, batchId],
  )
  return Number(r.rows[0].id)
}

async function voidPayment(client: ClientBase, paymentId: number) {
  const { userId } = await createUserWithRole(client, 'admin')
  await actAs(client, userId)
  await client.query(`update public.payments set void_reason = 'Pago equivocado de prueba' where id = $1`, [paymentId])
  await actAsSuperuser(client)
}

async function voidFee(client: ClientBase, feeId: number) {
  const { userId } = await createUserWithRole(client, 'admin')
  await actAs(client, userId)
  await client.query(`update public.fees set void_reason = 'Cuota cargada mal de prueba' where id = $1`, [feeId])
  await actAsSuperuser(client)
}

type Balance = { charged: number; paid: number; balance: number; lastOn: string | null; lastCents: number | null }

/** Lo que `private.member_balance` dice de TODOS los socios (incluidos los de la base de desarrollo). */
async function balances(client: ClientBase): Promise<Map<number, Balance>> {
  await actAsSuperuser(client)
  const r = await client.query(
    `select m.id, b.charged_cents, b.paid_cents, b.balance_cents, to_char(b.last_payment_on, 'YYYY-MM-DD') as last_on, b.last_payment_cents
     from public.members m cross join lateral private.member_balance(m.id) b order by m.id`,
  )
  return new Map(
    r.rows.map((x) => [
      Number(x.id),
      {
        charged: Number(x.charged_cents),
        paid: Number(x.paid_cents),
        balance: Number(x.balance_cents),
        lastOn: x.last_on,
        lastCents: x.last_payment_cents === null ? null : Number(x.last_payment_cents),
      },
    ]),
  )
}

type Scenario = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  g: number
  h1: number
  h2: number
  spanA: number
  spanH: number
  legacyB: number
  feeC: number
  feeF: { voided: number; kept: number }
  feeG: { first: number; second: number }
  cuotaB: number
  payments: { a1: number; a2: number; b: number; c: number; d: number; e: number; f: number; g: number; h1: number; h2: number }
  from: string
  to: string
  editorId: string
}

const TOTAL_A = 10_000_003 // no divisible por 10: el resto (3) cae en el último mes

/** Escenario A–H con la FORMA VIEJA. El motor tiene que estar apagado. */
async function oldShapeScenario(client: ClientBase): Promise<Scenario> {
  await setBillingStartOffset(client, 0)
  const from = await monthAt(client, -10)
  const to = await monthAt(client, -1)
  const cur = await monthAt(client, 0)
  const { userId: editorId } = await createUserWithRole(client, 'editor')
  const mk = (label: string, familyGroupId: number | null = null) => createFakeMember(client, { joinedOn: '2025-01-15', label, familyGroupId })

  // A: tramo de 10 meses (total no divisible), dos pagos que cubren 7,5 meses.
  const a = await mk('MigA')
  const spanA = await insertLegacySpan(client, a, from, to, TOTAL_A, { createdBy: editorId, createdAt: '2026-01-05T12:00:00Z' })
  const a1 = await pay(client, a, 3_000_000)
  const a2 = await pay(client, a, 4_500_000)

  // B: saldo viejo SIN tramo ($20.000) + la cuota del mes, un pago de $25.000.
  const b = await mk('MigB')
  const legacyB = await insertOpeningBalanceFee(client, b, 2 * P)
  const cuotaB = await insertMonthlyFee(client, { memberId: b, period: cur, amountCents: P })
  const pb = await pay(client, b, 2_500_000)

  // C: pago parcial de la única cuota.
  const c = await mk('MigC')
  const feeC = await insertMonthlyFee(client, { memberId: c, period: cur, amountCents: P })
  const pc = await pay(client, c, 400_000)

  // D: saldo a favor (pago mayor a los cargos).
  const d = await mk('MigD')
  await insertMonthlyFee(client, { memberId: d, period: cur, amountCents: P })
  const pd = await pay(client, d, 1_500_000)

  // E: pago anulado, sin imputaciones.
  const e = await mk('MigE')
  await insertMonthlyFee(client, { memberId: e, period: cur, amountCents: P })
  const pe = await pay(client, e, P)
  await voidPayment(client, pe)

  // F: cuota anulada + la siguiente; el pago cubre la siguiente.
  const f = await mk('MigF')
  const voided = await insertMonthlyFee(client, { memberId: f, period: await monthAt(client, -1), amountCents: P })
  const kept = await insertMonthlyFee(client, { memberId: f, period: cur, amountCents: P })
  await voidFee(client, voided)
  const pf = await pay(client, f, P)

  // G: dos deportes en el mismo mes (la social no existe: solo disciplinas); pago de una cuota y media.
  const g = await mk('MigG')
  const d1 = await createDiscipline(client, { name: `Migracion Alfa ${randomUUID().slice(0, 6)}` })
  const d2 = await createDiscipline(client, { name: `Migracion Beta ${randomUUID().slice(0, 6)}` })
  const c1 = await createCategory(client, { disciplineId: d1, name: 'Cat A' })
  const c2 = await createCategory(client, { disciplineId: d2, name: 'Cat B' })
  // Insertadas en orden inverso a propósito: el desempate es el discipline_id, no el id de la cuota.
  const second = await insertMonthlyFee(client, { memberId: g, period: cur, amountCents: P, categoryId: c2, disciplineId: d2 })
  const first = await insertMonthlyFee(client, { memberId: g, period: cur, amountCents: P, categoryId: c1, disciplineId: d1 })
  const pg = await pay(client, g, 1_500_000)

  // H: grupo familiar con un batch_id: uno con tramo, otro sin.
  const group = await createFamilyGroup(client)
  const h1 = await mk('MigH1', group)
  const h2 = await mk('MigH2', group)
  const spanH = await insertLegacySpan(client, h1, await monthAt(client, -3), to, 3 * P)
  await insertMonthlyFee(client, { memberId: h2, period: cur, amountCents: P })
  const batch = randomUUID()
  const ph1 = await pay(client, h1, 2 * P, batch)
  const ph2 = await pay(client, h2, P, batch)

  return {
    a, b, c, d, e, f, g, h1, h2, spanA, spanH, legacyB, feeC, feeF: { voided, kept }, feeG: { first, second }, cuotaB,
    payments: { a1, a2, b: pb, c: pc, d: pd, e: pe, f: pf, g: pg, h1: ph1, h2: ph2 },
    from, to, editorId,
  }
}

async function runMigration(client: ClientBase) {
  await actAsSuperuser(client)
  await client.query(`select private.allocation_migration_snapshot()`)
  const converted = Number((await client.query<{ n: number }>(`select private.migrate_opening_spans() as n`)).rows[0].n)
  const backfilled = Number((await client.query<{ n: number }>(`select private.backfill_allocations() as n`)).rows[0].n)
  return { converted, backfilled }
}

describe.skipIf(!dbAvailable)('migración payment_allocations sobre datos de forma vieja', () => {
  it('escenario A–H: convierte tramos, backfillea y verifica; el saldo de todos los socios queda idéntico', async () => {
    await withRollback(async (client) => {
      await engineOff(client)
      const s = await oldShapeScenario(client)
      const before = await balances(client)
      const globalPaidBefore = Number((await client.query(`select coalesce(sum(amount_cents), 0)::bigint as t from public.payments where voided_at is null`)).rows[0].t)

      const { converted, backfilled } = await runMigration(client)
      expect(converted, 'tramos convertidos (A y el de H1)').toBe(2)
      expect(backfilled).toBeGreaterThan(0)
      // La verificación de la migración no tira.
      await client.query(`select private.allocation_migration_verify()`)

      // ---- member_balance idéntica antes/después (cargos, pagos, saldo, último pago) para TODOS los socios.
      const after = await balances(client)
      expect(after.size).toBe(before.size)
      for (const [id, b] of before) expect(after.get(id), `socio ${id}`).toEqual(b)

      // ---- A: 10 filas por mes, la vieja anulada con motivo fijo y actor sistema, resto en el último mes.
      const aFees = (await feeStatus(client, s.a)).filter((x) => x.kind === 'opening_balance')
      expect(aFees).toHaveLength(10)
      const months = await Promise.all(Array.from({ length: 10 }, (_, i) => monthAt(client, i - 10)))
      expect(aFees.map((x) => x.period)).toEqual(months)
      expect(aFees.map((x) => x.amount)).toEqual(splitOpeningTotal(TOTAL_A, 10))
      expect(aFees.reduce((acc, x) => acc + x.amount, 0)).toBe(TOTAL_A)
      expect(aFees[9].amount).toBe(1_000_003)
      expect(aFees.map((x) => x.status)).toEqual([...Array(7).fill('paid'), 'partial', 'due', 'due'])
      expect(aFees[7].paid).toBe(500_000)

      const old = await client.query(
        `select voided_at, voided_by, void_reason, from_period is not null as has_span from public.fees where id = $1`,
        [s.spanA],
      )
      expect(old.rows[0].voided_at).not.toBeNull()
      expect(old.rows[0].voided_by).toBe(SYSTEM_UUID)
      expect(old.rows[0].void_reason).toBe(VOID_REASON)
      expect(old.rows[0].has_span).toBe(true) // la historia conserva su tramo

      const created = await client.query(
        `select created_by, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as created_at, description, from_period, to_period
         from public.fees where member_id = $1 and kind = 'opening_balance' and voided_at is null`,
        [s.a],
      )
      expect(created.rows).toHaveLength(10)
      for (const row of created.rows) {
        expect(row.created_by).toBe(s.editorId) // created_by/created_at de la fila original
        expect(row.created_at).toBe('2026-01-05T12:00')
        expect(row.from_period).toBeNull()
        expect(row.to_period).toBeNull()
        expect(row.description).toMatch(/^Saldo anterior · \d\d\/\d{4}$/)
      }

      // ---- B: la fila sin tramo NO cambia (mismo id, vigente); saldo pago, cuota parcial.
      const legacy = await client.query(`select voided_at, period from public.fees where id = $1`, [s.legacyB])
      expect(legacy.rows[0].voided_at).toBeNull()
      const bSt = await feeStatus(client, s.b)
      expect(bSt.find((x) => x.feeId === s.legacyB)).toMatchObject({ status: 'paid', paid: 2 * P })
      expect(bSt.find((x) => x.feeId === s.cuotaB)).toMatchObject({ status: 'partial', paid: 500_000 })

      // ---- C: parcial. D: crédito y nada de más.
      expect((await feeStatus(client, s.c)).find((x) => x.feeId === s.feeC)).toMatchObject({ status: 'partial', paid: 400_000 })
      expect((await allocations(client, s.payments.d)).reduce((acc, x) => acc + x.amount, 0)).toBe(P)
      expect((await allocations(client, s.payments.d)).every((x) => x.source === 'backfill')).toBe(true)
      const credit = await client.query(`select credit_cents from public.payment_credit where payment_id = $1`, [s.payments.d])
      expect(Number(credit.rows[0].credit_cents)).toBe(500_000)

      // ---- E: pago anulado sin imputaciones.
      expect(await allocations(client, s.payments.e)).toEqual([])

      // ---- F: nada imputado a la cuota anulada; el pago cubre la siguiente.
      const alF = await allocations(client, s.payments.f)
      expect(alF.map((x) => x.feeId)).toEqual([s.feeF.kept])
      expect((await feeStatus(client, s.f)).find((x) => x.feeId === s.feeF.kept)?.status).toBe('paid')

      // ---- G: la cuota del discipline_id menor primero.
      const alG = await allocations(client, s.payments.g)
      expect(alG.map((x) => [x.feeId, x.amount])).toEqual([[s.feeG.first, P], [s.feeG.second, 500_000]])

      // ---- H: cada integrante con lo suyo.
      const h1 = (await feeStatus(client, s.h1)).filter((x) => x.kind === 'opening_balance')
      expect(h1).toHaveLength(3)
      expect(h1.every((x) => x.amount === P)).toBe(true)
      expect(h1.map((x) => x.status)).toEqual(['paid', 'paid', 'due']) // su pago de 2 cuotas, solo en lo suyo
      expect((await feeStatus(client, s.h2)).map((x) => x.status)).toEqual(['paid']) // el pago de h2 no se mezcla con el de h1
      expect((await allocations(client, s.payments.h2)).map((x) => x.amount)).toEqual([P])

      // ---- Globales: Σ imputado + Σ crédito = Σ pagos vigentes; nada apunta a algo anulado; ningún pago pasa su monto.
      const g = await client.query(
        `select (select coalesce(sum(amount_cents), 0) from public.payment_allocations) as allocated,
                (select coalesce(sum(credit_cents), 0) from public.payment_credit) as credit,
                (select count(*) from public.payment_allocations a join public.payments p on p.id = a.payment_id join public.fees f on f.id = a.fee_id
                  where p.voided_at is not null or f.voided_at is not null) as inert,
                (select count(*) from (select p.id from public.payments p join public.payment_allocations a on a.payment_id = p.id group by p.id, p.amount_cents having sum(a.amount_cents) > p.amount_cents) x) as over`,
      )
      expect(Number(g.rows[0].allocated) + Number(g.rows[0].credit)).toBe(globalPaidBefore)
      expect(Number(g.rows[0].inert)).toBe(0)
      expect(Number(g.rows[0].over)).toBe(0)

      // ---- Auditoría: una fila UPDATE por tramo anulado y una INSERT por mes nuevo, actor 'system'.
      const upd = await client.query(
        `select record_id, actor_source, actor_id from public.audit_log where table_name = 'fees' and op = 'UPDATE' and record_id = any($1::text[])`,
        [[String(s.spanA), String(s.spanH)]],
      )
      expect(upd.rows).toHaveLength(2)
      expect(upd.rows.every((x) => x.actor_source === 'system' && x.actor_id === null)).toBe(true)
      const newFeeIds = (
        await client.query<{ id: string }>(
          `select id from public.fees where member_id = any($1::bigint[]) and kind = 'opening_balance' and voided_at is null`,
          [[s.a, s.h1]],
        )
      ).rows.map((x) => x.id)
      expect(newFeeIds).toHaveLength(13) // 10 de A + 3 de H1
      const ins = await client.query(
        `select actor_source from public.audit_log where table_name = 'fees' and op = 'INSERT' and record_id = any($1::text[])`,
        [newFeeIds],
      )
      expect(ins.rows).toHaveLength(13)
      expect(ins.rows.every((x) => x.actor_source === 'system')).toBe(true)

      // ---- Idempotencia: correrlas de nuevo devuelve 0 y no cambia nada.
      const feesN = (await client.query(`select count(*)::int as n from public.fees`)).rows[0].n
      const allocN = (await client.query(`select count(*)::int as n from public.payment_allocations`)).rows[0].n
      const again = await client.query<{ a: number; b: number }>(`select private.migrate_opening_spans() as a, private.backfill_allocations() as b`)
      expect(again.rows[0]).toEqual({ a: 0, b: 0 })
      expect((await client.query(`select count(*)::int as n from public.fees`)).rows[0].n).toBe(feesN)
      expect((await client.query(`select count(*)::int as n from public.payment_allocations`)).rows[0].n).toBe(allocN)
      const afterAgain = await balances(client)
      for (const [id, b] of before) expect(afterAgain.get(id), `socio ${id} tras re-correr`).toEqual(b)

      // ---- Con el motor ya prendido (como queda en producción) la historia migrada no se mueve:
      // un pago nuevo marcado de A cubre lo marcado, y el invariante deuda/crédito sigue valiendo.
      await engineOn(client)
      await pay(client, s.a, P)
      const both = await client.query(
        `select m.id from public.members m
         where (select coalesce(sum(pending_cents), 0) from public.fee_status where member_id = m.id) > 0
           and (select coalesce(sum(credit_cents), 0) from public.payment_credit where member_id = m.id) > 0`,
      )
      expect(both.rows).toEqual([])
    })
  })

  it('la cobertura por mes de cada tramo coincide con lo que mostraba payment_month_options antes: pago parcial que corta a mitad de un mes', async () => {
    await withRollback(async (client) => {
      await engineOff(client)
      await setBillingStartOffset(client, 0)
      const m = await createFakeMember(client, { joinedOn: '2025-01-15', label: 'MigCelda' })
      // Tramo de 3 meses, total 100.000 (no divisible por 3): 3.333.333 / 3.333.333 / 3.333.334; pago de 50.000.
      await insertLegacySpan(client, m, await monthAt(client, -3), await monthAt(client, -1), 10_000_000)
      await pay(client, m, 5_000_000)
      await runMigration(client)
      await client.query(`select private.allocation_migration_verify()`)
      const st = (await feeStatus(client, m)).filter((x) => x.kind === 'opening_balance')
      expect(st.map((x) => x.amount)).toEqual([3_333_333, 3_333_333, 3_333_334])
      expect(st.map((x) => x.paid)).toEqual([3_333_333, 1_666_667, 0])
      expect(st.map((x) => x.status)).toEqual(['paid', 'partial', 'due'])
    })
  })

  it('socios y datos que ya estaban en la base (sin tramos) no cambian: la verificación pasa y las imputaciones son todas "backfill"', async () => {
    await withRollback(async (client) => {
      await engineOff(client)
      const before = await balances(client)
      const { converted } = await runMigration(client)
      expect(converted).toBe(0) // la base ya migrada no tiene tramos vigentes
      await client.query(`select private.allocation_migration_verify()`)
      const src = await client.query(`select distinct source from public.payment_allocations`)
      expect(src.rows.every((x) => x.source === 'backfill')).toBe(true)
      const after = await balances(client)
      for (const [id, b] of before) expect(after.get(id), `socio ${id}`).toEqual(b)
    })
  })
})

describe.skipIf(!dbAvailable)('migración: la verificación ABORTA si algo no cuadra', () => {
  async function migrated(client: ClientBase) {
    await engineOff(client)
    await setBillingStartOffset(client, 0)
    const m = await createFakeMember(client, { joinedOn: '2025-01-15', label: 'MigAborta' })
    await insertLegacySpan(client, m, await monthAt(client, -4), await monthAt(client, -1), 4 * P)
    const p = await pay(client, m, 2_500_000)
    await runMigration(client)
    return { m, p }
  }

  it('una imputación de más entre backfill y verify: raise exception con el id del socio, nunca con su nombre', async () => {
    await withRollback(async (client) => {
      const { m } = await migrated(client)
      // Una fila extra, como postgres y con el guard apagado: el mes 4 (sin pagar) aparece con 1 centavo cubierto.
      await client.query(`alter table public.payment_allocations disable trigger payment_allocations_insert_guard`)
      const due = (await feeStatus(client, m)).filter((x) => x.status === 'due')[0]
      const payId = (await client.query<{ id: string }>(`select id from public.payments where member_id = $1`, [m])).rows[0].id
      await client.query(`insert into public.payment_allocations (payment_id, fee_id, amount_cents, source) values ($1, $2, 100, 'backfill')`, [payId, due.feeId])

      const err = await expectQueryError(client, `select private.allocation_migration_verify()`)
      expect(err.message).toMatch(/^Migración de imputaciones:/)
      expect(err.message).toContain(String(m))
      expect(err.message).not.toMatch(/MigAborta|Inventado/)
    })
  })

  it('una imputación que falta (la historia se alteró): también aborta', async () => {
    await withRollback(async (client) => {
      const { m, p } = await migrated(client)
      const [first] = await allocations(client, p)
      await client.query(`alter table public.payment_allocations disable trigger payment_allocations_no_change`)
      await client.query(`delete from public.payment_allocations where id = $1`, [first.id])
      const err = await expectQueryError(client, `select private.allocation_migration_verify()`)
      expect(err.message).toMatch(/^Migración de imputaciones:/)
      expect(err.message).toContain(String(m))
    })
  })

  it('un cargo vigente que se agrega entre migrate y verify: aborta por saldo distinto', async () => {
    await withRollback(async (client) => {
      const { m } = await migrated(client)
      await insertMonthlyFee(client, { memberId: m, period: await monthAt(client, 0), amountCents: P })
      const err = await expectQueryError(client, `select private.allocation_migration_verify()`)
      expect(err.message).toMatch(/^Migración de imputaciones:/)
      expect(err.message).toContain(String(m))
    })
  })

  it('un pago vigente de más imputado sobre su monto (check por pago): aborta', async () => {
    await withRollback(async (client) => {
      const { p } = await migrated(client)
      await client.query(`alter table public.payment_allocations disable trigger payment_allocations_insert_guard`)
      const fee = (await client.query<{ id: string }>(
        `select f.id from public.fees f join public.payments p on p.member_id = f.member_id where p.id = $1 and f.voided_at is null order by f.period desc limit 1`,
        [p],
      )).rows[0].id
      await client.query(`insert into public.payment_allocations (payment_id, fee_id, amount_cents, source) values ($1, $2, 10000000, 'backfill')`, [p, fee])
      const err = await expectQueryError(client, `select private.allocation_migration_verify()`)
      expect(err.message).toMatch(/^Migración de imputaciones:/)
    })
  })

  it('el verify limpia sus tablas temporales al pasar, y el snapshot las puede recrear (idempotente)', async () => {
    await withRollback(async (client) => {
      await migrated(client)
      await client.query(`select private.allocation_migration_verify()`)
      const gone = await client.query(`select to_regclass('pg_temp.mig_fees') as t`)
      expect(gone.rows[0].t).toBeNull()
      await client.query(`select private.allocation_migration_snapshot()`)
      await client.query(`select private.allocation_migration_snapshot()`)
      expect((await client.query(`select to_regclass('pg_temp.mig_fees') as t`)).rows[0].t).not.toBeNull()
    })
  })
})
