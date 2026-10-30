import { randomUUID } from 'node:crypto'
import { Client, type ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import { splitOpeningTotal } from '@/views/payments/month-selection'
import {
  actAs,
  actAsSuperuser,
  createAuthUser,
  createCategory,
  createDiscipline,
  createFamilyGroup,
  createUserWithRole,
  expectQueryError,
  hasGrant,
  isDbAvailable,
  openMemberCategory,
  withRollback,
} from './helpers'
import {
  allocations,
  callBatch,
  createFakeMember,
  feeStatus,
  insertMonthlyFee,
  insertOpeningBalanceFee,
  insertPayment,
  monthAt,
  monthOptions,
  paymentCredit,
  setBillingStartOffset,
} from './payment-months-fixtures'

/**
 * Imputación explícita por cuota (pipeline 2026-10-29-imputacion-libre-meses,
 * `20261029120000_payment_allocations.sql`). Un pago cubre cuotas con `payment_allocations`; la deuda
 * y el saldo a favor salen de `fee_status` / `payment_credit`. Todo es relativo al mes actual del
 * club, en transacciones revertidas, con datos inventados. P = $10.000 en centavos.
 */
const dbAvailable = await isDbAvailable()
const P = 1_000_000

async function asRole(client: ClientBase, role: 'editor' | 'consulta' | 'admin') {
  await actAsSuperuser(client)
  const { userId } = await createUserWithRole(client, role)
  await actAs(client, userId)
  return userId
}

/** Inicio de facturación = mes actual, un socio (o más) con alta de 2025. */
async function setup(client: ClientBase, members = 1) {
  await setBillingStartOffset(client, 0)
  const ids: number[] = []
  for (let i = 0; i < members; i++) ids.push(await createFakeMember(client, { joinedOn: '2025-01-15', label: `Socio${i}` }))
  return ids
}

/** Cuotas mensuales en los offsets dados (mes actual = 0), cada una de `amount`. */
async function monthlyFees(client: ClientBase, memberId: number, offsets: number[], amount = P) {
  const out: Record<number, number> = {}
  for (const o of offsets) out[o] = await insertMonthlyFee(client, { memberId, period: await monthAt(client, o), amountCents: amount })
  return out
}

async function byPeriod(client: ClientBase, memberId: number) {
  const rows = await feeStatus(client, memberId)
  return new Map(rows.map((r) => [r.period, r]))
}

/**
 * Invariante de todo el sistema: nunca conviven deuda y saldo a favor en un mismo socio, y la deuda
 * derivada de las vistas (Σ pending − Σ credit) es el saldo de `member_balance` (cargos − pagos).
 */
async function expectInvariant(client: ClientBase, memberIds: number[]) {
  await actAsSuperuser(client)
  const both = await client.query(
    `select m.id from public.members m
     where (select coalesce(sum(pending_cents), 0) from public.fee_status where member_id = m.id) > 0
       and (select coalesce(sum(credit_cents), 0) from public.payment_credit where member_id = m.id) > 0`,
  )
  expect(both.rows, 'socios con deuda Y saldo a favor a la vez').toEqual([])
  for (const id of memberIds) {
    const r = await client.query<{ pending: string; credit: string; balance: string }>(
      `select (select coalesce(sum(pending_cents), 0) from public.fee_status where member_id = $1) as pending,
              (select coalesce(sum(credit_cents), 0) from public.payment_credit where member_id = $1) as credit,
              (select balance_cents from private.member_balance($1)) as balance`,
      [id],
    )
    expect(Number(r.rows[0].pending) - Number(r.rows[0].credit), `balance del socio ${id}`).toBe(Number(r.rows[0].balance))
  }
}

async function accountOf(client: ClientBase, memberId: number) {
  const r = await client.query(
    `select balance_cents, months_due, to_char(oldest_due_period, 'YYYY-MM-DD') as oldest from public.member_accounts(array[$1]::bigint[], 'all')`,
    [memberId],
  )
  return { balance: Number(r.rows[0].balance_cents), monthsDue: Number(r.rows[0].months_due), oldest: r.rows[0].oldest as string | null }
}

/** Anula una cuota como admin (el guard de `fees` pone voided_by/at). */
async function voidFeeAsAdmin(client: ClientBase, feeId: number) {
  await asRole(client, 'admin')
  await client.query(`update public.fees set void_reason = 'Carga equivocada de prueba' where id = $1`, [feeId])
}

async function voidPaymentAsAdmin(client: ClientBase, paymentId: number) {
  // Como lo hace el modelo (voidPayment): SOLO void_reason; el guard BEFORE pone voided_at/voided_by.
  await asRole(client, 'admin')
  await client.query(`update public.payments set void_reason = 'Pago equivocado de prueba' where id = $1`, [paymentId])
}

describe.skipIf(!dbAvailable)('imputación: meses sueltos, monto y orden', () => {
  it('1. meses sueltos: marcar may y jul por 2 cuotas deja esos dos pagos y el resto adeudado, en todas las lecturas', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const debtBefore = await debtOfSocial(client) // la base trae seed: se mide la diferencia que aporta este socio
      await monthlyFees(client, m, [0, 1, 2, 3, 4, 5, 6])
      const [m0, m1, m2, m3, m4, m5, m6] = await Promise.all([0, 1, 2, 3, 4, 5, 6].map((o) => monthAt(client, o)))
      await actAsSuperuser(client)
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P * 2, marked_periods: [m0, m2] }])

      const st = await byPeriod(client, m)
      expect(st.get(m0)?.status).toBe('paid')
      expect(st.get(m2)?.status).toBe('paid')
      for (const p of [m1, m3, m4, m5, m6]) expect(st.get(p)?.status, p).toBe('due')

      const al = await allocations(client, r.paymentId)
      expect(al.map((a) => [a.period, a.amount, a.source])).toEqual([[m0, P, 'marked'], [m2, P, 'marked']])

      await asRole(client, 'editor')
      expect(await accountOf(client, m)).toEqual({ balance: 5 * P, monthsDue: 5, oldest: m1 })

      // La tira: la ventana arranca en la primera adeudada (jun), m2 pago ahí adentro, el resto adeudado.
      const opts = await monthOptions(client, [m])
      const cell = (p: string) => opts.find((o) => o.period === p)
      expect(cell(m2)).toMatchObject({ kind: 'monthly', pending: 0, covered: P })
      for (const p of [m1, m3, m4, m5, m6]) expect(cell(p)).toMatchObject({ pending: P, covered: 0 })
      expect(cell(m0)?.pending ?? 0).toBe(0) // un mes pago ANTES de la primera adeudada no se ofrece

      const stmt = await client.query(`select to_char(period, 'YYYY-MM-DD') as period, status from public.member_fee_statement($1)`, [m])
      const sOf = new Map(stmt.rows.map((x) => [x.period, x.status]))
      expect(sOf.get(m0)).toBe('paid')
      expect(sOf.get(m2)).toBe('paid')
      expect(sOf.get(m1)).not.toBe('paid')

      // Agregado por categoría: este socio aporta 5 cuotas a la deuda "social" (diferencial, la base trae seed).
      await asRole(client, 'admin')
      expect((await debtOfSocial(client)) - debtBefore).toBe(5 * P)
      await expectInvariant(client, [m])
    })
  })

  async function debtOfSocial(client: ClientBase): Promise<number> {
    const prev = await client.query<{ role: string; claims: string | null }>(`select current_user as role, current_setting('request.jwt.claims', true) as claims`)
    await actAsSuperuser(client)
    const { userId } = await createUserWithRole(client, 'admin')
    await actAs(client, userId)
    const r = await client.query(`select coalesce(sum(debt_cents), 0)::bigint as d from public.debt_by_category() where kind = 'social'`)
    await actAsSuperuser(client)
    if (prev.rows[0].role !== 'postgres') {
      await client.query(`set local role ${prev.rows[0].role}`)
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [prev.rows[0].claims ?? ''])
    }
    return Number(r.rows[0].d)
  }

  it('2. monto que no alcanza: marcados may, jun, jul con 2,5 cuotas → may y jun pagas, jul parcial, todo "marked"', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      await monthlyFees(client, m, [0, 1, 2, 3])
      const [m0, m1, m2] = await Promise.all([0, 1, 2].map((o) => monthAt(client, o)))
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P * 2 + P / 2, marked_periods: [m0, m1, m2] }])
      const st = await byPeriod(client, m)
      expect([m0, m1, m2].map((p) => st.get(p)?.status)).toEqual(['paid', 'paid', 'partial'])
      expect(st.get(m2)?.paid).toBe(P / 2)
      const al = await allocations(client, r.paymentId)
      expect(al).toHaveLength(3)
      expect(al.every((a) => a.source === 'marked')).toBe(true)
      expect(al.some((a) => a.source === 'oldest_first')).toBe(false)
      await expectInvariant(client, [m])
    })
  })

  it('3. un monto mayor a lo marcado: lo marcado primero, el resto al más viejo (y el parcial al siguiente)', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      await monthlyFees(client, m, [0, 1, 2, 3, 4, 5, 6])
      const [m0, m1, m2] = await Promise.all([0, 1, 2].map((o) => monthAt(client, o)))
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P * 2 + P / 2, marked_periods: [m2] }])
      const al = await allocations(client, r.paymentId)
      expect(al.map((a) => [a.period, a.amount, a.source])).toEqual([
        [m2, P, 'marked'],
        [m0, P, 'oldest_first'],
        [m1, P / 2, 'oldest_first'],
      ])
      const st = await byPeriod(client, m)
      expect(st.get(m1)?.status).toBe('partial')
      expect(await paymentCredit(client, m)).toBe(0)
      await expectInvariant(client, [m])
    })
  })

  it('4. sin marcados (null y payload viejo sin las claves nuevas): todo al más viejo, igual que el balance forward de siempre', async () => {
    await withRollback(async (client) => {
      const [a, b] = await setup(client, 2)
      await monthlyFees(client, a, [0, 1, 2, 3])
      await monthlyFees(client, b, [0, 1, 2, 3])
      const [m0, m1, m2] = await Promise.all([0, 1, 2].map((o) => monthAt(client, o)))
      await asRole(client, 'editor')
      const res = await callBatch(client, [
        { member_id: a, amount_cents: P * 2, marked_periods: null },
        { member_id: b, amount_cents: P * 2 } as never, // payload viejo: ni marked_periods ni opening_months
      ])
      for (const [memberId, row] of [[a, res[0]], [b, res[1]]] as const) {
        const al = await allocations(client, row.paymentId)
        expect(al.map((x) => [x.period, x.source])).toEqual([[m0, 'oldest_first'], [m1, 'oldest_first']])
        const st = await byPeriod(client, memberId)
        expect(st.get(m2)?.status).toBe('due')
      }
      // Un marked_periods vacío viaja igual de inocuo.
      await asRole(client, 'editor')
      const [e] = await callBatch(client, [{ member_id: a, amount_cents: P, marked_periods: [] }])
      expect((await allocations(client, e.paymentId))[0]).toMatchObject({ period: m2, source: 'oldest_first' })
      await expectInvariant(client, [a, b])
    })
  })

  it('5. adelanto = crédito: pagar todo y una cuota de más no imputa nada extra; el crédito es 1 cuota y el balance es −1 cuota', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      await monthlyFees(client, m, [0, 1])
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P * 3 }])
      expect(await allocations(client, r.paymentId)).toHaveLength(2)
      expect(await paymentCredit(client, m)).toBe(P)
      await asRole(client, 'editor')
      expect((await accountOf(client, m)).balance).toBe(-P)
      // El primer proyectado (mes 2) aparece cubierto por ese crédito.
      const proj = (await monthOptions(client, [m])).filter((o) => o.kind === 'projected')
      expect(proj[0]).toMatchObject({ covered: P, pending: 0 })
      expect(proj[1]).toMatchObject({ covered: 0 })
      await expectInvariant(client, [m])
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: el motor reacciona a cuotas nuevas y anuladas', () => {
  it('6. el generador absorbe el saldo a favor: la cuota nueva nace pagada con una imputación credit del pago más viejo', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const cur = await monthAt(client, 0)
      const price = (await client.query<{ p: string }>(`select private.member_fee_price_at($1, $2::date) as p`, [m, cur])).rows[0].p
      const pay = await insertPayment(client, { memberId: m, amountCents: Number(price) }) // sin cuotas: todo crédito
      expect(await paymentCredit(client, m)).toBe(Number(price))
      expect(await allocations(client, pay)).toEqual([])

      await actAsSuperuser(client)
      await client.query(`select private.generate_monthly_fees($1::date)`, [cur])
      const al = await allocations(client, pay)
      expect(al).toHaveLength(1)
      expect(al[0]).toMatchObject({ period: cur, amount: Number(price), source: 'credit' })
      expect((await byPeriod(client, m)).get(cur)?.status).toBe('paid')
      expect(await paymentCredit(client, m)).toBe(0)
      await expectInvariant(client, [m])
    })
  })

  it('6b. generar sin crédito no imputa nada (billing.test cubre la idempotencia; acá, que no se inventa plata)', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const cur = await monthAt(client, 0)
      await actAsSuperuser(client)
      await client.query(`select private.generate_monthly_fees($1::date)`, [cur])
      const st = await byPeriod(client, m)
      expect(st.get(cur)?.status).toBe('due')
      const n = await client.query(`select count(*)::int as n from public.payment_allocations a join public.payments p on p.id = a.payment_id where p.member_id = $1`, [m])
      expect(n.rows[0].n).toBe(0)
    })
  })

  it('6c. con dos deportes y 1,5 cuotas de crédito: la cuota del discipline_id menor primero (orden estable), la otra parcial', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const cur = await monthAt(client, 0)
      await actAsSuperuser(client)
      const d1 = await createDiscipline(client, { name: 'Disciplina Alfa Imputacion' })
      const d2 = await createDiscipline(client, { name: 'Disciplina Beta Imputacion' })
      const c1 = await createCategory(client, { disciplineId: d1, name: 'Cat Alfa' })
      const c2 = await createCategory(client, { disciplineId: d2, name: 'Cat Beta' })
      await openMemberCategory(client, { memberId: m, categoryId: c1, joinedOn: '2025-01-15' })
      await openMemberCategory(client, { memberId: m, categoryId: c2, joinedOn: '2025-01-15' })
      const price = Number((await client.query<{ p: string }>(`select private.member_fee_price_at($1, $2::date) as p`, [m, cur])).rows[0].p)
      expect(price).toBeGreaterThan(0)
      // Pago de 1,5 cuotas de UNA disciplina: hay dos cuotas del mes (una por deporte), cada una de `unit`.
      await client.query(`select private.generate_monthly_fees($1::date)`, [cur])
      const feesOfMonth = (await feeStatus(client, m)).filter((f) => f.period === cur)
      expect(feesOfMonth).toHaveLength(2)
      // Las cuotas ya existen (generadas sin crédito): se ve el pago DESPUÉS con la imputación más vieja.
      const unit = feesOfMonth[0].amount
      const pay = await insertPayment(client, { memberId: m, amountCents: unit + unit / 2 })
      const al = await allocations(client, pay)
      const first = feesOfMonth.find((f) => f.feeId === al[0].feeId)!
      const dOf = await client.query<{ id: string; discipline_id: string }>(`select id, discipline_id from public.fees where id = any($1::bigint[])`, [feesOfMonth.map((f) => f.feeId)])
      const disc = new Map(dOf.rows.map((r) => [Number(r.id), Number(r.discipline_id)]))
      expect(disc.get(first.feeId)).toBe(Math.min(...dOf.rows.map((r) => Number(r.discipline_id))))
      expect(al[0].amount).toBe(unit)
      expect(al[1].amount).toBe(unit / 2)
      await expectInvariant(client, [m])
    })
  })

  it('6d. generar dos veces el mismo mes con crédito: una sola imputación credit (el índice único de cuotas manda y no se reimputa)', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const cur = await monthAt(client, 0)
      const price = Number((await client.query<{ p: string }>(`select private.member_fee_price_at($1, $2::date) as p`, [m, cur])).rows[0].p)
      const pay = await insertPayment(client, { memberId: m, amountCents: price * 2 })
      await actAsSuperuser(client)
      await client.query(`select private.generate_monthly_fees($1::date)`, [cur])
      await client.query(`select private.generate_monthly_fees($1::date)`, [cur])
      expect((await allocations(client, pay)).map((a) => [a.period, a.source])).toEqual([[cur, 'credit']])
      expect(await paymentCredit(client, m)).toBe(price) // sobra 1 cuota de crédito, sin duplicar nada
    })
  })

  it('7. anular una cuota con imputaciones: su plata vuelve a crédito y se reimputa; las filas viejas quedan y se audita con el actor', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const fees = await monthlyFees(client, m, [0, 1, 2])
      const [m0, m1, m2] = await Promise.all([0, 1, 2].map((o) => monthAt(client, o)))
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P + P / 2, marked_periods: [m2] }]) // ago marcado P, jun parcial P/2
      expect((await allocations(client, r.paymentId)).map((a) => [a.period, a.amount, a.source])).toEqual([[m2, P, 'marked'], [m0, P / 2, 'oldest_first']])
      const before = (await allocations(client, r.paymentId)).length

      const adminId = await asRole(client, 'admin')
      await client.query(`update public.fees set void_reason = 'Cuota duplicada' where id = $1`, [fees[2]])
      const al = await allocations(client, r.paymentId)
      // Las viejas siguen (aunque la de la cuota anulada quede inerte) y se suman las nuevas.
      expect(al.length).toBeGreaterThan(before)
      const credits = al.filter((a) => a.source === 'credit')
      expect(credits.map((a) => [a.period, a.amount])).toEqual([[m0, P / 2], [m1, P / 2]])
      // (X, jun) tiene dos filas: la parcial original y la de crédito (sin índice único a propósito).
      expect(al.filter((a) => a.period === m0)).toHaveLength(2)

      const st = await byPeriod(client, m)
      expect(st.get(m0)?.status).toBe('paid')
      expect(st.get(m1)?.status).toBe('partial')
      expect(st.has(m2)).toBe(false) // la anulada ya no está en fee_status
      expect(await paymentCredit(client, m)).toBe(0)

      await actAsSuperuser(client)
      const audit = await client.query(
        `select actor_id, new_data ->> 'source' as source from public.audit_log
         where table_name = 'payment_allocations' and record_id = any($1::text[])`,
        [credits.map((c) => String(c.id))],
      )
      expect(audit.rows).toHaveLength(2)
      expect(audit.rows.every((a) => a.actor_id === adminId && a.source === 'credit')).toBe(true)
      await expectInvariant(client, [m])
    })
  })

  it('8. anular un pago: sus imputaciones quedan (inertes), la deuda vuelve, no figura en payment_credit y otro pago cubre de nuevo', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      await monthlyFees(client, m, [0, 1])
      const [m0, m1] = await Promise.all([0, 1].map((o) => monthAt(client, o)))
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P * 2 }])
      const n = (await allocations(client, r.paymentId)).length
      expect(n).toBe(2)

      await voidPaymentAsAdmin(client, r.paymentId)
      expect((await allocations(client, r.paymentId)).length).toBe(n)
      const st = await byPeriod(client, m)
      expect([m0, m1].map((p) => st.get(p)?.status)).toEqual(['due', 'due'])
      await actAsSuperuser(client)
      const credit = await client.query(`select 1 from public.payment_credit where payment_id = $1`, [r.paymentId])
      expect(credit.rowCount).toBe(0)

      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: m, amount_cents: P * 2 }])
      const after = await byPeriod(client, m)
      expect([m0, m1].map((p) => after.get(p)?.status)).toEqual(['paid', 'paid'])
      await expectInvariant(client, [m])
    })
  })

  it('9. nunca conviven deuda y crédito: tras una secuencia de pagos, anulaciones y cuotas nuevas el invariante vale en cada paso', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const fees = await monthlyFees(client, m, [0, 1, 2])
      await expectInvariant(client, [m])
      await asRole(client, 'editor')
      const [p1] = await callBatch(client, [{ member_id: m, amount_cents: P * 4 }]) // 3 cuotas + 1 de crédito
      await expectInvariant(client, [m])
      await monthlyFees(client, m, [3, 4]) // el crédito paga la 4.ª y deja la 5.ª en deuda
      await expectInvariant(client, [m])
      await voidFeeAsAdmin(client, fees[1])
      await expectInvariant(client, [m])
      await voidPaymentAsAdmin(client, p1.paymentId)
      await expectInvariant(client, [m])
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: anular un pago libera su plata (B2 del review)', () => {
  it('anular P1 cuando otro pago P2 del mismo socio tiene crédito: el crédito de P2 cubre la cuota que liberó P1; el invariante vale', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const f = await monthlyFees(client, m, [0])
      const m0 = await monthAt(client, 0)
      await asRole(client, 'editor')
      const [p1] = await callBatch(client, [{ member_id: m, amount_cents: P }]) // paga la cuota
      await asRole(client, 'editor')
      const [p2] = await callBatch(client, [{ member_id: m, amount_cents: P }]) // todo crédito
      expect(await paymentCredit(client, m)).toBe(P)
      await expectInvariant(client, [m])

      await voidPaymentAsAdmin(client, p1.paymentId)
      const al = await allocations(client, p2.paymentId)
      expect(al.map((a) => [a.feeId, a.period, a.amount, a.source])).toEqual([[f[0], m0, P, 'credit']])
      expect((await byPeriod(client, m)).get(m0)?.status).toBe('paid')
      expect(await paymentCredit(client, m)).toBe(0)
      await expectInvariant(client, [m])
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: el guard de payment_allocations', () => {
  /** Apaga el motor (DDL transaccional) para armar imputaciones a mano, como lo haría cualquier camino que no sea el motor. */
  async function withoutEngine(client: ClientBase) {
    await actAsSuperuser(client)
    await client.query(`alter table public.payments disable trigger payments_allocate_on_insert`)
    await client.query(`alter table public.fees disable trigger fees_apply_credit_on_insert`)
    await client.query(`alter table public.fees disable trigger fees_apply_credit_on_void`)
  }

  const ins = (client: ClientBase, paymentId: number, feeId: number, amount: number) =>
    expectQueryError(client, `insert into public.payment_allocations (payment_id, fee_id, amount_cents, source) values ($1, $2, $3, 'marked')`, [paymentId, feeId, amount])

  it('10. rechaza cuota anulada, pago anulado, socios distintos, exceso por cuota, exceso por pago y dos filas del mismo INSERT que juntas pasan la cuota', async () => {
    await withRollback(async (client) => {
      const [a, b] = await setup(client, 2)
      await withoutEngine(client)
      const fa = await monthlyFees(client, a, [0, 1])
      const fb = await monthlyFees(client, b, [0])
      const pay1 = await insertPayment(client, { memberId: a, amountCents: P })
      const pay2 = await insertPayment(client, { memberId: a, amountCents: P })

      // socios distintos
      let err = await ins(client, pay1, fb[0], P)
      expect(err.code).toBe('23514')
      expect(err.message).toBe('El pago y la cuota son de socios distintos')

      // exceso por cuota: pay1 cubre la cuota 0 entera, pay2 no puede sumarle un centavo
      await client.query(`insert into public.payment_allocations (payment_id, fee_id, amount_cents, source) values ($1, $2, $3, 'marked')`, [pay1, fa[0], P])
      err = await ins(client, pay2, fa[0], 1)
      expect(err.code).toBe('23514')
      expect(err.message).toMatch(/^La cuota de \d\d\/\d{4} ya está paga/)

      // exceso por pago: pay1 ya gastó P
      err = await ins(client, pay1, fa[1], 1)
      expect(err.code).toBe('23514')
      expect(err.message).toBe('Lo imputado supera el monto del pago')

      // dos filas del MISMO insert que juntas superan la cuota 1 (el guard ve la primera al evaluar la segunda)
      err = await expectQueryError(
        client,
        `insert into public.payment_allocations (payment_id, fee_id, amount_cents, source) values ($1, $2, $3, 'marked'), ($4, $2, $3, 'marked')`,
        [pay2, fa[1], P, pay1],
      )
      expect(err.code).toBe('23514')

      // cuota anulada
      await voidFeeAsAdmin(client, fa[1])
      await actAsSuperuser(client)
      err = await ins(client, pay2, fa[1], 1)
      expect(err.message).toBe('Una cuota anulada no recibe imputaciones')

      // pago anulado
      await voidPaymentAsAdmin(client, pay2)
      await actAsSuperuser(client)
      err = await ins(client, pay2, fb[0], 1)
      expect(err.message).toBe('Un pago anulado no se imputa')
    })
  })

  it('10b. cuota o pago inexistentes: foreign_key_violation con texto, no un error crudo', async () => {
    await withRollback(async (client) => {
      const [a] = await setup(client)
      await withoutEngine(client)
      const f = await monthlyFees(client, a, [0])
      const pay = await insertPayment(client, { memberId: a, amountCents: P })
      expect((await ins(client, 2_000_000_000, f[0], 1)).message).toBe('El pago no existe')
      expect((await ins(client, pay, 2_000_000_000, 1)).message).toBe('La cuota no existe')
    })
  })

  it('10c. amount_cents > 0 y source con valores cerrados (CHECK)', async () => {
    await withRollback(async (client) => {
      const [a] = await setup(client)
      await withoutEngine(client)
      const f = await monthlyFees(client, a, [0])
      const pay = await insertPayment(client, { memberId: a, amountCents: P })
      expect((await ins(client, pay, f[0], 0)).message).toMatch(/payment_allocations_amount_cents_check/)
      const badSource = await expectQueryError(client, `insert into public.payment_allocations (payment_id, fee_id, amount_cents, source) values ($1, $2, 1, 'manual')`, [pay, f[0]])
      expect(badSource.message).toMatch(/payment_allocations_source_check/)
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: marcados ya pagos y carga inicial en el lote', () => {
  it('11. un mes marcado que ya está pago se saltea sin error: la plata va al siguiente marcado', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      await monthlyFees(client, m, [0, 1, 2])
      const [m0, m1, m2] = await Promise.all([0, 1, 2].map((o) => monthAt(client, o)))
      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: m, amount_cents: P, marked_periods: [m0] }]) // may ya paga
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P, marked_periods: [m0, m2] }])
      const al = await allocations(client, r.paymentId)
      expect(al.map((a) => [a.period, a.amount, a.source])).toEqual([[m2, P, 'marked']])
      expect((await byPeriod(client, m)).get(m1)?.status).toBe('due')
      await expectInvariant(client, [m])
    })
  })

  it('12. saldo anterior por mes en el lote: una fila por mes con su período real y descripción por defecto; mar y may pagos, abr y jun adeudados; reintento por batch_id', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const [p4, p3, p2, p1] = await Promise.all([-4, -3, -2, -1].map((o) => monthAt(client, o)))
      await asRole(client, 'editor')
      const batchId = randomUUID()
      const item = {
        member_id: m,
        amount_cents: P * 2,
        marked_periods: [p4, p2],
        opening_months: [p4, p3, p2, p1].map((period) => ({ period, amount_cents: P })),
      }
      const [first] = await callBatch(client, [item], batchId)
      await actAsSuperuser(client)
      const rows = await client.query(
        `select id, to_char(period, 'YYYY-MM-DD') as period, description, from_period, amount_cents from public.fees where member_id = $1 and kind = 'opening_balance' order by period`,
        [m],
      )
      expect(rows.rows.map((r) => r.period)).toEqual([p4, p3, p2, p1])
      expect(rows.rows.every((r) => r.from_period === null && Number(r.amount_cents) === P)).toBe(true)
      for (const r of rows.rows) {
        const [y, mm] = r.period.split('-')
        expect(r.description).toBe(`Saldo anterior · ${mm}/${y}`)
      }
      expect(first.feeId).toBe(Number(rows.rows[0].id)) // opening_balance_fee_id = la primera

      const st = await byPeriod(client, m)
      expect([p4, p3, p2, p1].map((p) => st.get(p)?.status)).toEqual(['paid', 'due', 'paid', 'due'])

      await asRole(client, 'editor')
      const [retry] = await callBatch(client, [item], batchId)
      expect(retry).toMatchObject({ already: true, feeId: first.feeId, paymentId: first.paymentId })
      await actAsSuperuser(client)
      expect((await client.query(`select count(*)::int as n from public.fees where member_id = $1`, [m])).rows[0].n).toBe(4)
      await expectInvariant(client, [m])
    })
  })

  it('12b. crédito previo 1 cuota + el mismo lote: el crédito cubre el mes más viejo (credit), el marcado a ese mes se saltea y va al siguiente marcado y después al más viejo', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const [p4, p3, p2, p1] = await Promise.all([-4, -3, -2, -1].map((o) => monthAt(client, o)))
      const oldPay = await insertPayment(client, { memberId: m, amountCents: P }) // crédito puro: no hay cuotas
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [
        { member_id: m, amount_cents: P * 2, marked_periods: [p4, p2], opening_months: [p4, p3, p2, p1].map((period) => ({ period, amount_cents: P })) },
      ])
      const old = await allocations(client, oldPay)
      expect(old.map((a) => [a.period, a.amount, a.source])).toEqual([[p4, P, 'credit']])
      const al = await allocations(client, r.paymentId)
      // p4 ya estaba cubierto: el marcado se saltea; marca p2; el resto del pago va al más viejo (p3).
      expect(al.map((a) => [a.period, a.amount, a.source])).toEqual([[p2, P, 'marked'], [p3, P, 'oldest_first']])
      const st = await byPeriod(client, m)
      expect([p4, p3, p2, p1].map((p) => st.get(p)?.status)).toEqual(['paid', 'paid', 'paid', 'due'])
      await expectInvariant(client, [m])
    })
  })

  it('13. payload viejo opening_balance {from,to,amount}: se expande a N filas con split_opening_total (paridad con splitOpeningTotal TS); el pago cubre del más viejo; opening_months gana si vienen los dos', async () => {
    await withRollback(async (client) => {
      const cases: Array<[number, number]> = [[10_000_001, 3], [8_555_555, 10], [999, 1], [5, 3]]
      await setBillingStartOffset(client, 0)
      for (const [total, n] of cases) {
        const m = await createFakeMember(client, { joinedOn: '2025-01-15', label: `Viejo${n}` })
        const from = await monthAt(client, -n)
        const to = await monthAt(client, -1)
        await asRole(client, 'editor')
        await callBatch(client, [{ member_id: m, amount_cents: 1, opening_balance: { from_period: from, to_period: to, amount_cents: total } }])
        const st = (await feeStatus(client, m)).filter((f) => f.kind === 'opening_balance')
        expect(st).toHaveLength(n)
        expect(st.map((f) => f.amount), `total ${total} / ${n}`).toEqual(splitOpeningTotal(total, n))
        expect(st[0].paid).toBe(1) // el centavo del pago cubre desde el más viejo
        expect(st[0].period).toBe(from)
      }

      const m = await createFakeMember(client, { joinedOn: '2025-01-15', label: 'Mezcla' })
      const p3 = await monthAt(client, -3)
      const p1 = await monthAt(client, -1)
      await asRole(client, 'editor')
      await callBatch(client, [
        {
          member_id: m,
          amount_cents: 1,
          opening_months: [{ period: p3, amount_cents: 500 }],
          opening_balance: { from_period: await monthAt(client, -6), to_period: p1, amount_cents: 99_999 },
        },
      ])
      const mixed = (await feeStatus(client, m)).filter((f) => f.kind === 'opening_balance')
      expect(mixed.map((f) => [f.period, f.amount])).toEqual([[p3, 500]])
    })
  })

  it('13b. validaciones del lote nuevo: >36 meses, repetidos, día != 1, mes >= inicio, monto <= 0, marcados repetidos o fuera de forma; nada queda', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const start = await monthAt(client, 0)
      const p1 = await monthAt(client, -1)
      const p2 = await monthAt(client, -2)
      const reject = async (item: Record<string, unknown>, message: RegExp) => {
        await asRole(client, 'editor')
        const err = await expectQueryError(
          client,
          `select * from public.register_payment_batch(gen_random_uuid(), private.club_today(), 'cash', null, null, $1::jsonb)`,
          [JSON.stringify([{ member_id: m, amount_cents: P, ...item }])],
        )
        expect(err.code).toBe('23514')
        expect(err.message).toMatch(message)
      }
      await reject({ opening_months: [{ period: p1, amount_cents: P }, { period: p1, amount_cents: P }] }, /Los meses del saldo anterior no son válidos/)
      await reject({ opening_months: [{ period: p1.replace(/-01$/, '-15'), amount_cents: P }] }, /anteriores a/)
      await reject({ opening_months: [{ period: start, amount_cents: P }] }, /solo cubre meses anteriores a/)
      await reject({ opening_months: [{ period: p1, amount_cents: 0 }] }, /mayor a cero/)
      await reject({ opening_months: [] }, /Los meses del saldo anterior no son válidos/)
      await reject({ marked_periods: [p1, p1] }, /Los meses marcados no son válidos/)
      await reject({ marked_periods: [p1.replace(/-01$/, '-09')] }, /Los meses marcados no son válidos/)
      await reject({ marked_periods: 'enero' }, /Los meses marcados no son válidos/)
      const many = Array.from({ length: 37 }, (_, i) => ({ period: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, amount_cents: P }))
      await reject({ opening_months: many }, /Los meses del saldo anterior no son válidos/)
      void p2
      await actAsSuperuser(client)
      expect((await client.query(`select count(*)::int as n from public.fees where member_id = $1`, [m])).rows[0].n).toBe(0)
      expect((await client.query(`select count(*)::int as n from public.payments where member_id = $1`, [m])).rows[0].n).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: saldo anterior desde la ficha y before_joined', () => {
  it('14. ficha: N filas como editor entran; más de 36 meses atrás y mes >= inicio se rechazan; el mismo mes dos veces es 23505; agregar meses más atrás después sirve y deja de ofrecerlos como pre_system', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const p1 = await monthAt(client, -1)
      const p2 = await monthAt(client, -2)
      const p3 = await monthAt(client, -3)
      await asRole(client, 'editor')
      await client.query(
        `insert into public.fees (member_id, kind, period, amount_cents) select $1, 'opening_balance', p::date, $3 from unnest($2::text[]) p`,
        [m, [p1, p2], P],
      )
      const dup = await expectQueryError(
        client,
        `insert into public.fees (member_id, kind, period, amount_cents) values ($1, 'opening_balance', $2, 1)`,
        [m, p2],
      )
      expect(dup.code).toBe('23505')
      expect((dup as { constraint?: string }).constraint).toBe('fees_one_opening_balance')

      const asSpan = await expectQueryError(
        client,
        `insert into public.fees (member_id, kind, period, amount_cents, from_period) values ($1, 'opening_balance', $2, 1, $2)`,
        [m, p3],
      )
      expect(asSpan.code).toBe('42501')

      const rows0 = await monthOptions(client, [m])
      expect(rows0.filter((r) => r.kind === 'pre_system').map((r) => r.period)).not.toContain(p3 + 'x')
      expect(rows0.filter((r) => r.kind === 'pre_system').map((r) => r.period)).toContain(p3)

      // "Agregar meses más atrás": otro insert, un mes más antiguo.
      await asRole(client, 'editor')
      await client.query(`insert into public.fees (member_id, kind, period, amount_cents) values ($1, 'opening_balance', $2, $3)`, [m, p3, P])
      const rows1 = await monthOptions(client, [m])
      expect(rows1.filter((r) => r.kind === 'pre_system').map((r) => r.period)).not.toContain(p3)
      expect(rows1.filter((r) => r.kind === 'opening_balance').map((r) => r.period)).toEqual([p3, p2, p1])
    })
  })

  it('15. before_joined: con alta en el 5.º mes de la ventana, los 4 pre_system anteriores traen true y el resto false; con alta anterior a la ventana todas false; solo pre_system y solo meses sin saldo', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      // Ventana de pre_system: -12..-1. Alta en -8 (5.º mes) → -12..-9 son anteriores al alta.
      const late = await createFakeMember(client, { joinedOn: await monthAt(client, -8), label: 'Alta tardia' })
      const early = await createFakeMember(client, { joinedOn: '2020-01-15', label: 'Alta antigua' })
      await asRole(client, 'editor')
      const rows = await monthOptions(client, [late, early])
      const preLate = rows.filter((r) => r.memberId === late && r.kind === 'pre_system')
      expect(preLate).toHaveLength(12)
      expect(preLate.filter((r) => r.beforeJoined)).toHaveLength(4)
      expect(preLate.slice(0, 4).every((r) => r.beforeJoined)).toBe(true)
      expect(preLate.slice(4).every((r) => !r.beforeJoined)).toBe(true)
      expect(rows.filter((r) => r.memberId === early && r.kind === 'pre_system').every((r) => !r.beforeJoined)).toBe(true)
      // before_joined solo significa algo en pre_system.
      expect(rows.filter((r) => r.kind !== 'pre_system').every((r) => !r.beforeJoined)).toBe(true)

      // Con una fila de saldo en el mes -10, ese mes ya no es pre_system (ni antes ni después del alta).
      await insertOpeningBalanceFee(client, late, P, await monthAt(client, -10))
      await asRole(client, 'editor')
      const again = (await monthOptions(client, [late])).filter((r) => r.kind === 'pre_system')
      expect(again).toHaveLength(11)
      expect(again.map((r) => r.period)).not.toContain(await monthAt(client, -10))
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: tabla inmutable, sin borrado y auditada', () => {
  it('16. UPDATE, DELETE y TRUNCATE rechazados para admin (sin grant) y para postgres (forbid_change); triggers "always"; grants mínimos', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      await monthlyFees(client, m, [0])
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P }])
      const [al] = await allocations(client, r.paymentId)

      await asRole(client, 'admin')
      for (const sql of [
        `update public.payment_allocations set amount_cents = 1 where id = $1`,
        `delete from public.payment_allocations where id = $1`,
      ]) {
        expect((await expectQueryError(client, sql, [al.id])).code, sql).toBe('42501')
      }
      expect((await expectQueryError(client, `truncate public.payment_allocations`)).code).toBe('42501')

      await actAsSuperuser(client)
      for (const sql of [
        `update public.payment_allocations set amount_cents = 1 where id = $1`,
        `delete from public.payment_allocations where id = $1`,
      ]) {
        const err = await expectQueryError(client, sql, [al.id])
        expect(err.message, sql).toBe('Los registros de payment_allocations no se modifican ni se borran')
      }
      const tr = await expectQueryError(client, `truncate public.payment_allocations`)
      expect(tr.message).toBe('Los registros de payment_allocations no se modifican ni se borran')

      // "enable always": siguen disparando aunque alguien con permiso ponga session_replication_role = replica.
      const t = await client.query<{ tgname: string; tgenabled: string }>(
        `select tgname, tgenabled from pg_trigger where tgrelid = 'public.payment_allocations'::regclass and tgname in ('payment_allocations_no_change', 'payment_allocations_no_truncate')`,
      )
      expect(t.rows).toHaveLength(2)
      expect(t.rows.every((x) => x.tgenabled === 'A')).toBe(true)

      const priv = async (role: string, p: string) =>
        (await client.query<{ ok: boolean }>(`select has_table_privilege($1, 'public.payment_allocations', $2) as ok`, [role, p])).rows[0].ok
      for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(await priv('authenticated', p), `authenticated ${p}`).toBe(false)
        expect(await priv('anon', p), `anon ${p}`).toBe(false)
      }
      expect(await priv('service_role', 'SELECT')).toBe(true)
      for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(await priv('service_role', p), `service_role ${p}`).toBe(false)
      expect(await hasGrant(client, 'authenticated', 'payment_allocations', 'DELETE')).toBe(false)
    })
  })

  it('16b. authenticated no inserta imputaciones a mano ni siquiera siendo admin: solo las escribe el motor', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      const f = await monthlyFees(client, m, [0])
      const pay = await insertPayment(client, { memberId: m, amountCents: P })
      await asRole(client, 'admin')
      const err = await expectQueryError(client, `insert into public.payment_allocations (payment_id, fee_id, amount_cents, source) values ($1, $2, 1, 'marked')`, [pay, f[0]])
      expect(err.code).toBe('42501')
    })
  })

  it('16c. cada imputación del lote deja su fila de auditoría con actor = el editor que cargó el pago', async () => {
    await withRollback(async (client) => {
      const [m] = await setup(client)
      await monthlyFees(client, m, [0, 1, 2])
      const editorId = await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: m, amount_cents: P * 2 + 1 }])
      const al = await allocations(client, r.paymentId)
      expect(al).toHaveLength(3)
      await actAsSuperuser(client)
      const audit = await client.query(
        `select record_id, actor_id, actor_source, op, new_data from public.audit_log where table_name = 'payment_allocations' and record_id = any($1::text[])`,
        [al.map((a) => String(a.id))],
      )
      expect(audit.rows).toHaveLength(3)
      for (const a of audit.rows) {
        expect(a).toMatchObject({ actor_id: editorId, actor_source: 'session', op: 'INSERT' })
        expect(a.new_data).toMatchObject({ payment_id: r.paymentId })
      }
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: grants y lockdown', () => {
  it('17. el motor, el guard, los triggers y las funciones de migración no son ejecutables por nadie de la API; split_opening_total sí por authenticated', async () => {
    await withRollback(async (client) => {
      const locked = [
        'private.apply_credit(bigint, text)',
        'private.allocate_marked(bigint, date[])',
        'private.payment_allocations_insert_guard()',
        'private.payments_allocate_on_insert()',
        'private.fees_apply_credit_on_insert()',
        'private.fees_apply_credit_on_void()',
        'private.payments_apply_credit_on_void()',
        'private.migrate_opening_spans()',
        'private.backfill_allocations()',
        'private.allocation_migration_snapshot()',
        'private.allocation_migration_verify()',
      ]
      for (const fn of locked) {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          const r = await client.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])
          expect(r.rows[0].ok, `${role} ejecuta ${fn}`).toBe(false)
        }
        // PUBLIC (grantee 0) tampoco.
        const pub = await client.query<{ n: number }>(
          `select count(*)::int as n from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'`,
          [fn],
        )
        expect(pub.rows[0].n, `PUBLIC ejecuta ${fn}`).toBe(0)
      }
      for (const [role, expected] of [['authenticated', true], ['anon', false]] as const) {
        const r = await client.query<{ ok: boolean }>(`select has_function_privilege($1, 'private.split_opening_total(bigint, integer)', 'execute') as ok`, [role])
        expect(r.rows[0].ok, role).toBe(expected)
      }
    })
  })

  it('17b. las vistas son security_invoker; consulta lee (payments.read), un usuario sin rol ve 0 filas y anon no puede ni leer', async () => {
    await withRollback(async (client) => {
      for (const v of ['fee_status', 'payment_credit']) {
        const r = await client.query<{ opts: string[] | null }>(`select reloptions as opts from pg_class where oid = $1::regclass`, [`public.${v}`])
        expect(r.rows[0].opts, v).toContain('security_invoker=true')
      }
      const [m] = await setup(client)
      await monthlyFees(client, m, [0])
      await insertPayment(client, { memberId: m, amountCents: P * 2 })

      await asRole(client, 'consulta')
      const seen = await client.query(`select 1 from public.fee_status where member_id = $1`, [m])
      expect(seen.rowCount).toBeGreaterThan(0)
      const seenCredit = await client.query(`select 1 from public.payment_credit where member_id = $1`, [m])
      expect(seenCredit.rowCount).toBeGreaterThan(0)

      // Autenticado pero sin fila en app_users (sin permisos): RLS devuelve vacío, no un error.
      await actAsSuperuser(client)
      const ghost = randomUUID()
      await createAuthUser(client, { id: ghost, email: `ghost-${ghost.slice(0, 8)}@lonqui.test` })
      await actAs(client, ghost)
      expect((await client.query(`select 1 from public.fee_status where member_id = $1`, [m])).rowCount).toBe(0)
      expect((await client.query(`select 1 from public.payment_credit where member_id = $1`, [m])).rowCount).toBe(0)
      expect((await client.query(`select 1 from public.payment_allocations`)).rowCount).toBe(0)

      await actAsSuperuser(client)
      await actAs(client, ghost, { pgRole: 'anon' })
      for (const t of ['fee_status', 'payment_credit', 'payment_allocations']) {
        expect((await expectQueryError(client, `select 1 from public.${t}`)).code, t).toBe('42501')
      }
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: grupo familiar con un solo lote', () => {
  it('cada socio del grupo recibe sus propios marcados y su propio saldo anterior, sin cruzar imputaciones', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      await actAsSuperuser(client)
      const group = await createFamilyGroup(client)
      const a = await createFakeMember(client, { joinedOn: '2025-01-15', familyGroupId: group, label: 'GrupoA' })
      const b = await createFakeMember(client, { joinedOn: '2025-01-15', familyGroupId: group, label: 'GrupoB' })
      await monthlyFees(client, a, [0, 1])
      await monthlyFees(client, b, [0, 1])
      const [m0, m1] = await Promise.all([0, 1].map((o) => monthAt(client, o)))
      const p1 = await monthAt(client, -1)
      await asRole(client, 'editor')
      const rows = await callBatch(client, [
        { member_id: a, amount_cents: P, marked_periods: [m1] },
        { member_id: b, amount_cents: P * 2, opening_months: [{ period: p1, amount_cents: P }] },
      ])
      const ra = rows.find((r) => r.memberId === a)!
      const rb = rows.find((r) => r.memberId === b)!
      expect((await allocations(client, ra.paymentId)).map((x) => [x.period, x.source])).toEqual([[m1, 'marked']])
      expect((await allocations(client, rb.paymentId)).map((x) => [x.period, x.source])).toEqual([[p1, 'oldest_first'], [m0, 'oldest_first']])
      expect(ra.feeId).toBeNull()
      expect(rb.feeId).not.toBeNull()
      await expectInvariant(client, [a, b])
    })
  })
})

describe.skipIf(!dbAvailable)('imputación: concurrencia', () => {
  it('18. dos lotes que marcan el mismo mes del mismo socio, a la vez: los dos registran, el mes queda pago UNA vez y el segundo pago va "oldest_first" a otro mes', async () => {
    const url = process.env.LONQUI_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    const setup = new Client({ connectionString: url })
    await setup.connect()
    const editorId = randomUUID()
    const tag = `Carrera ${randomUUID().slice(0, 8)}`
    let memberId = 0
    try {
      // Fixtures COMMITEADOS (la carrera es entre transacciones reales); se limpian en el finally.
      await createUserWithRole(setup, 'editor', { userId: editorId })
      const r = await setup.query<{ id: string }>(
        `insert into public.members (first_name, last_name, joined_on) values ($1, 'Inventado', '2025-01-15') returning id`,
        [tag],
      )
      memberId = Number(r.rows[0].id)
      const m0 = (await setup.query<{ m: string }>(`select to_char(date_trunc('month', private.club_today()), 'YYYY-MM-DD') as m`)).rows[0].m
      const m1 = (await setup.query<{ m: string }>(`select to_char(date_trunc('month', private.club_today()) + interval '1 month', 'YYYY-MM-DD') as m`)).rows[0].m
      for (const p of [m0, m1]) {
        await setup.query(`insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, $2, 'monthly', $3, 'fixture carrera')`, [memberId, p, P])
      }

      const attempt = async () => {
        const c = new Client({ connectionString: url })
        await c.connect()
        try {
          await c.query('begin')
          await c.query(`set local role authenticated`)
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: editorId, role: 'authenticated', aud: 'authenticated' })])
          await c.query(
            `select * from public.register_payment_batch(gen_random_uuid(), private.club_today(), 'cash', null, null, $1::jsonb)`,
            [JSON.stringify([{ member_id: memberId, amount_cents: P, marked_periods: [m0] }])],
          )
          await c.query('commit')
          return 'ok' as const
        } catch (err) {
          await c.query('rollback').catch(() => {})
          return (err as { code?: string; message?: string }).message ?? 'error'
        } finally {
          await c.end()
        }
      }

      const results = await Promise.all([attempt(), attempt()])
      expect(results, 'los dos lotes registran').toEqual(['ok', 'ok'])

      const st = await setup.query(
        `select to_char(period, 'YYYY-MM-DD') as period, status, paid_cents, amount_cents from public.fee_status where member_id = $1 order by period`,
        [memberId],
      )
      expect(st.rows.map((x) => [x.period, x.status])).toEqual([[m0, 'paid'], [m1, 'paid']])
      // Nunca más de lo que vale la cuota (el guard + el lock lo garantizan).
      expect(st.rows.every((x) => Number(x.paid_cents) <= Number(x.amount_cents))).toBe(true)
      const al = await setup.query(
        `select to_char(f.period, 'YYYY-MM-DD') as period, a.source from public.payment_allocations a join public.fees f on f.id = a.fee_id
         join public.payments p on p.id = a.payment_id where p.member_id = $1 order by a.id`,
        [memberId],
      )
      const sources = new Map<string, string[]>()
      for (const row of al.rows) sources.set(row.period, [...(sources.get(row.period) ?? []), row.source])
      expect(sources.get(m0)).toEqual(['marked']) // marcado UNA sola vez
      expect(sources.get(m1)).toEqual(['oldest_first']) // el segundo pago no pudo con m0: fue al otro mes
    } finally {
      // Nada se borra desde la app; los fixtures commiteados de este test sí se limpian como postgres.
      // Las imputaciones tienen un trigger "always": se apaga un instante (DDL) y se vuelve a prender.
      try {
        await setup.query(`alter table public.payment_allocations disable trigger payment_allocations_no_change`)
        await setup.query(`delete from public.payment_allocations where payment_id in (select id from public.payments where member_id = $1)`, [memberId])
        await setup.query(`delete from public.payments where member_id = $1`, [memberId])
        await setup.query(`delete from public.fees where member_id = $1`, [memberId])
      } finally {
        await setup.query(`alter table public.payment_allocations enable always trigger payment_allocations_no_change`)
      }
      // El alta dejó un evento de ingreso en member_status_events (append-only): mismo truco de DDL, siempre re-armado.
      if (memberId) {
        try {
          await setup.query(`alter table public.member_status_events disable trigger member_status_events_no_change`)
          await setup.query(`delete from public.member_status_events where member_id = $1`, [memberId])
          await setup.query(`delete from public.members where id = $1`, [memberId])
        } finally {
          await setup.query(`alter table public.member_status_events enable trigger member_status_events_no_change`)
        }
      }
      await setup.query(`delete from public.app_users where user_id = $1`, [editorId]).catch(() => {})
      await setup.query(`delete from auth.users where id = $1`, [editorId]).catch(() => {})
      await setup.end()
    }
  })
})
