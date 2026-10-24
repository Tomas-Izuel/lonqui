import { describe, expect, it } from 'vitest'
import type { ClientBase } from 'pg'
import { actAs, actAsSuperuser, createCategory, createDiscipline, createUserWithRole, expectQueryError, isDbAvailable, withRollback } from './helpers'
import {
  createFakeMember,
  insertMonthlyFee,
  insertOpeningBalanceFee,
  insertPayment,
  monthAt,
  monthOptions,
  priceToday,
  setBillingStart,
  setBillingStartOffset,
  withdrawMember,
} from './payment-months-fixtures'

/**
 * Pipeline 2026-10-24-pago-por-meses, `20261024120000_payment_months.sql`:
 * `payment_month_options` (las celdas de la tira de meses del formulario de pago).
 *
 * Todo relativo al mes actual de la base (C): ver `payment-months-fixtures.ts`.
 */
const dbAvailable = await isDbAvailable()

async function asEditor(client: ClientBase) {
  await actAsSuperuser(client)
  const { userId } = await createUserWithRole(client, 'editor')
  await actAs(client, userId)
  return userId
}

const kinds = (rows: { kind: string }[]) => rows.map((r) => r.kind)

describe.skipIf(!dbAvailable)('payment_month_options: sin facturación no hay tira', () => {
  it('sin billing_start_period: 0 filas (el formulario cae al campo de monto)', async () => {
    await withRollback(async (client) => {
      const memberId = await createFakeMember(client)
      await actAsSuperuser(client)
      await setBillingStart(client, null)
      await asEditor(client)
      expect(await monthOptions(client, [memberId])).toEqual([])
    })
  })

  it('con el inicio en un mes futuro: 0 filas', async () => {
    await withRollback(async (client) => {
      const memberId = await createFakeMember(client)
      await setBillingStartOffset(client, 1)
      await asEditor(client)
      expect(await monthOptions(client, [memberId])).toEqual([])
    })
  })
})

describe.skipIf(!dbAvailable)('payment_month_options: ventana adeudado + mes actual + 6 de adelanto', () => {
  it('pago parcial del mes viejo: parcial, el actual debe, 6 proyectados al valor de hoy y nada anterior al inicio', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, -1)
      const memberId = await createFakeMember(client) // alta DESPUÉS del inicio: sin pre_system
      const price = await priceToday(client, memberId)
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId, period: start, amountCents: price })
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price })
      await insertPayment(client, { memberId, amountCents: Math.floor(price * 0.4) })
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      const ahead: string[] = []
      for (const n of [1, 2, 3, 4, 5, 6]) ahead.push(await monthAt(client, n))
      expect(rows.map((r) => r.period)).toEqual([start, current, ...ahead])
      const [partial, due, ...projected] = rows
      expect(partial).toMatchObject({ kind: 'monthly', amount: price, covered: Math.floor(price * 0.4), pending: price - Math.floor(price * 0.4), isCurrent: false })
      expect(due).toMatchObject({ kind: 'monthly', covered: 0, pending: price, isCurrent: true })
      expect(projected).toHaveLength(6)
      for (const p of projected) {
        expect(p).toMatchObject({ kind: 'projected', amount: price, covered: 0, pending: price, pricedAtToday: true, isCurrent: false })
      }
      // Sin ningún período anterior al inicio de la facturación.
      expect(rows.every((r) => r.period >= start)).toBe(true)
    })
  })

  it('socio al día (mes actual ya pagado, sin saldo): la ventana arranca en el mes actual', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, -1)
      const memberId = await createFakeMember(client)
      const price = await priceToday(client, memberId)
      const start = await monthAt(client, -1)
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId, period: start, amountCents: price })
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price })
      await insertPayment(client, { memberId, amountCents: price * 2 })
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      expect(rows[0]).toMatchObject({ period: current, kind: 'monthly', pending: 0, isCurrent: true })
      // El mes viejo, ya pagado, no aparece.
      expect(rows.some((r) => r.period === start)).toBe(false)
    })
  })

  it('dos deportes en el mismo mes: UNA fila por mes con las cuotas sumadas', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      await actAsSuperuser(client)
      const memberId = await createFakeMember(client)
      const price = await priceToday(client, memberId)
      const d1 = await createDiscipline(client, { name: 'Deporte Uno Fixture' })
      const d2 = await createDiscipline(client, { name: 'Deporte Dos Fixture' })
      const c1 = await createCategory(client, { disciplineId: d1, name: 'Cat Uno' })
      const c2 = await createCategory(client, { disciplineId: d2, name: 'Cat Dos' })
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price, categoryId: c1, disciplineId: d1 })
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price, categoryId: c2, disciplineId: d2 })
      await asEditor(client)

      const rows = (await monthOptions(client, [memberId])).filter((r) => r.period === current)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ kind: 'monthly', amount: price * 2, covered: 0, pending: price * 2 })
    })
  })

  it('un pago que cubre una sola de las dos cuotas del mes deja la celda parcial por la diferencia', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client)
      const price = await priceToday(client, memberId)
      const d1 = await createDiscipline(client, { name: 'Deporte Tres Fixture' })
      const d2 = await createDiscipline(client, { name: 'Deporte Cuatro Fixture' })
      const c1 = await createCategory(client, { disciplineId: d1, name: 'Cat Tres' })
      const c2 = await createCategory(client, { disciplineId: d2, name: 'Cat Cuatro' })
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price, categoryId: c1, disciplineId: d1 })
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price, categoryId: c2, disciplineId: d2 })
      await insertPayment(client, { memberId, amountCents: price })
      await asEditor(client)

      const row = (await monthOptions(client, [memberId])).find((r) => r.period === current)
      expect(row).toMatchObject({ amount: price * 2, covered: price, pending: price })
    })
  })

  it('socio de baja con deuda: solo lo adeudado, sin meses de adelanto', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, -1)
      const memberId = await createFakeMember(client)
      const price = await priceToday(client, memberId)
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId, period: start, amountCents: price })
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price })
      await withdrawMember(client, memberId)
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      expect(rows.map((r) => r.period)).toEqual([start, current])
      expect(kinds(rows)).not.toContain('projected')
    })
  })
})

describe.skipIf(!dbAvailable)('payment_month_options: saldo a favor aplicado a los proyectados', () => {
  it('1,5 cuotas de saldo a favor: el primer adelanto cubierto, el segundo a medias, el resto sin cubrir', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client)
      const price = await priceToday(client, memberId)
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price })
      // Paga la cuota actual + 1,5 cuotas de más.
      await insertPayment(client, { memberId, amountCents: Math.floor(price * 2.5) })
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      const byPeriod = new Map(rows.map((r) => [r.period, r]))
      expect(byPeriod.get(current)).toMatchObject({ kind: 'monthly', pending: 0, covered: price })
      const credit = Math.floor(price * 2.5) - price
      expect(byPeriod.get(await monthAt(client, 1))).toMatchObject({ kind: 'projected', amount: price, covered: price, pending: 0 })
      expect(byPeriod.get(await monthAt(client, 2))).toMatchObject({ kind: 'projected', covered: credit - price, pending: price - (credit - price) })
      expect(byPeriod.get(await monthAt(client, 3))).toMatchObject({ kind: 'projected', covered: 0, pending: price })
      // El crédito aplicado nunca supera el crédito real.
      const appliedToProjected = rows.filter((r) => r.kind === 'projected').reduce((acc, r) => acc + r.covered, 0)
      expect(appliedToProjected).toBe(credit)
    })
  })

  it('el saldo a favor se agota exactamente: un peso menos que una cuota deja la celda con 1 centavo pendiente, no cubierta', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client)
      const price = await priceToday(client, memberId)
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId, period: current, amountCents: price })
      await insertPayment(client, { memberId, amountCents: price + price - 1 })
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      expect(rows.find((r) => r.period === current)?.pending).toBe(0)
      expect(rows.find((r) => r.period === rows.find((x) => x.kind === 'projected')!.period)).toMatchObject({ covered: price - 1, pending: 1 })
    })
  })
})

describe.skipIf(!dbAvailable)('payment_month_options: valor programado en un mes futuro', () => {
  it('el proyectado desde el mes del nuevo valor trae ese monto y priced_at_today = false', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client)
      const price = await priceToday(client, memberId)
      const newPrice = price + 700_000
      const validFrom = await monthAt(client, 2)
      await actAsSuperuser(client)
      await client.query(`insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', $1, $2)`, [newPrice, validFrom])
      await asEditor(client)

      const byPeriod = new Map((await monthOptions(client, [memberId])).map((r) => [r.period, r]))
      expect(byPeriod.get(await monthAt(client, 1))).toMatchObject({ amount: price, pricedAtToday: true })
      for (const n of [2, 3, 4, 5, 6]) {
        expect(byPeriod.get(await monthAt(client, n))).toMatchObject({ kind: 'projected', amount: newPrice, pricedAtToday: false })
      }
    })
  })
})

describe.skipIf(!dbAvailable)('payment_month_options: pre_system (meses antes del sistema)', () => {
  it('alta anterior al inicio y sin saldo anterior: 12 filas inicio-12..inicio-1 a la cuota de hoy', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      const price = await priceToday(client, memberId)
      await asEditor(client)

      const pre = (await monthOptions(client, [memberId])).filter((r) => r.kind === 'pre_system')
      expect(pre).toHaveLength(12)
      expect(pre[0].period).toBe(await monthAt(client, -12))
      expect(pre[11].period).toBe(await monthAt(client, -1))
      expect(pre.every((r) => r.period < start)).toBe(true)
      for (const r of pre) {
        expect(r).toMatchObject({ amount: price, covered: 0, pending: price, isCurrent: false, pricedAtToday: true })
      }
    })
  })

  it('alta en el mismo mes del inicio: sí (la cota es <=); alta el mes siguiente: ninguna', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, -1)
      const sameMonth = await createFakeMember(client, { joinedOn: start })
      const nextMonth = await createFakeMember(client, { joinedOn: await monthAt(client, 0) })
      await asEditor(client)

      const rows = await monthOptions(client, [sameMonth, nextMonth])
      expect(rows.filter((r) => r.memberId === sameMonth && r.kind === 'pre_system')).toHaveLength(12)
      expect(rows.filter((r) => r.memberId === nextMonth && r.kind === 'pre_system')).toHaveLength(0)
    })
  })

  it('con saldo anterior vigente: ninguna fila pre_system; el saldo aparece primero con su pendiente', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      const price = await priceToday(client, memberId)
      await insertOpeningBalanceFee(client, memberId, price * 3)
      await insertPayment(client, { memberId, amountCents: Math.floor(price * 1.2) })
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      expect(kinds(rows)).not.toContain('pre_system')
      expect(rows[0]).toMatchObject({
        kind: 'opening_balance',
        period: await monthAt(client, -1),
        amount: price * 3,
        covered: Math.floor(price * 1.2),
        pending: price * 3 - Math.floor(price * 1.2),
      })
      expect(rows[0].period < start).toBe(true)
    })
  })

  it('saldo anterior cubierto del todo: no aparece (y tampoco vuelven los pre_system)', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      const price = await priceToday(client, memberId)
      await insertOpeningBalanceFee(client, memberId, price * 3)
      await insertPayment(client, { memberId, amountCents: price * 3 })
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      expect(kinds(rows)).not.toContain('opening_balance')
      expect(kinds(rows)).not.toContain('pre_system')
    })
  })

  it('con el saldo anterior ANULADO vuelven los pre_system y el saldo no cuenta', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      const price = await priceToday(client, memberId)
      const feeId = await insertOpeningBalanceFee(client, memberId, price * 3)
      await actAsSuperuser(client)
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      await client.query(`update public.fees set voided_at = now(), voided_by = $2, void_reason = 'cargado mal' where id = $1`, [feeId, adminId])
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      expect(kinds(rows)).not.toContain('opening_balance')
      expect(rows.filter((r) => r.kind === 'pre_system')).toHaveLength(12)
    })
  })
})

describe.skipIf(!dbAvailable)('payment_month_options: varios socios y permisos', () => {
  it('un grupo en UNA llamada: cada socio con sus filas, sin mezclar ni traer socios no pedidos', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, -1)
      const a = await createFakeMember(client)
      const b = await createFakeMember(client)
      const other = await createFakeMember(client)
      const price = await priceToday(client, a)
      const start = await monthAt(client, -1)
      await insertMonthlyFee(client, { memberId: a, period: start, amountCents: price })
      await insertMonthlyFee(client, { memberId: b, period: start, amountCents: price })
      await insertPayment(client, { memberId: b, amountCents: price })
      await asEditor(client)

      const rows = await monthOptions(client, [a, b])
      expect(new Set(rows.map((r) => r.memberId))).toEqual(new Set([a, b]))
      expect(rows.find((r) => r.memberId === a && r.period === start)?.pending).toBe(price)
      expect(rows.find((r) => r.memberId === b && r.period === start)).toBeUndefined() // b ya pagó ese mes
      expect(rows.some((r) => r.memberId === other)).toBe(false)
    })
  })

  it('consulta: insufficient_privilege (no tiene payments.register)', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client)
      await actAsSuperuser(client)
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      const err = await expectQueryError(client, `select * from public.payment_month_options($1::bigint[])`, [[memberId]])
      expect(err.code).toBe('42501')
    })
  })

  it('anon: no puede ejecutarla (ni por el rol ni por PUBLIC)', async () => {
    await withRollback(async (client) => {
      for (const fn of ['public.payment_month_options(bigint[])', 'public.register_payment_batch(uuid, date, text, text, text, jsonb)']) {
        const anon = await client.query(`select has_function_privilege('anon', $1, 'execute') as ok`, [fn])
        expect(anon.rows[0].ok, `${fn} no debe ser ejecutable por anon`).toBe(false)
        const pub = await client.query(
          `select exists (
             select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
           ) as ok`,
          [fn],
        )
        expect(pub.rows[0].ok, `${fn} no debe tener EXECUTE para PUBLIC`).toBe(false)
        const auth = await client.query(`select has_function_privilege('authenticated', $1, 'execute') as ok`, [fn])
        expect(auth.rows[0].ok).toBe(true)
      }
    })
  })

  it('las dos RPC públicas son SECURITY INVOKER: valen las policies y la auditoría de quien llama', async () => {
    await withRollback(async (client) => {
      const r = await client.query<{ proname: string; prosecdef: boolean }>(
        `select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname in ('payment_month_options','register_payment_batch')`,
      )
      expect(r.rows).toHaveLength(2)
      for (const row of r.rows) expect(row.prosecdef, row.proname).toBe(false)
    })
  })

  it('un user_metadata con role admin no habilita a un consulta', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const memberId = await createFakeMember(client)
      await actAsSuperuser(client)
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId, { extraClaims: { user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } })
      const err = await expectQueryError(client, `select * from public.payment_month_options($1::bigint[])`, [[memberId]])
      expect(err.code).toBe('42501')
    })
  })
})
