import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ClientBase } from 'pg'
import { actAs, actAsSuperuser, createFamilyGroup, createUserWithRole, expectQueryError, isDbAvailable, withRollback } from './helpers'
import {
  countRows,
  createFakeMember,
  insertMonthlyFee,
  insertOpeningBalanceFee,
  insertPayment,
  monthAt,
  monthOptions,
  priceToday,
  setBillingStart,
  setBillingStartOffset,
} from './payment-months-fixtures'

/**
 * Pipeline 2026-10-24-pago-por-meses, `20261024120000_payment_months.sql`:
 * `register_payment_batch` (saldo anterior + pagos, una transacción, idempotente por batch_id).
 */
const dbAvailable = await isDbAvailable()

type BatchItem = {
  member_id: number
  amount_cents: number
  opening_balance?: { from_period: string; to_period: string; amount_cents: number; description?: string } | null
}

async function asRole(client: ClientBase, role: 'editor' | 'consulta' | 'admin') {
  await actAsSuperuser(client)
  const { userId } = await createUserWithRole(client, role)
  await actAs(client, userId)
  return userId
}

async function callBatch(client: ClientBase, input: { batchId?: string; paidOn?: string; items: BatchItem[] | unknown }) {
  const paidOn = input.paidOn ?? (await client.query<{ d: string }>(`select private.club_today()::text as d`)).rows[0].d
  const r = await client.query<{
    member_id: string
    payment_id: string
    amount_cents: string
    opening_balance_fee_id: string | null
    already_registered: boolean
  }>(
    `select * from public.register_payment_batch($1::uuid, $2::date, 'cash', null, null, $3::jsonb)`,
    [input.batchId ?? randomUUID(), paidOn, JSON.stringify(input.items)],
  )
  return r.rows.map((row) => ({
    memberId: Number(row.member_id),
    paymentId: Number(row.payment_id),
    amountCents: Number(row.amount_cents),
    openingBalanceFeeId: row.opening_balance_fee_id === null ? null : Number(row.opening_balance_fee_id),
    alreadyRegistered: row.already_registered,
  }))
}

/** Escenario base: inicio = mes actual, socios con alta de 2025 (así tienen meses previos al sistema). */
async function scenario(client: ClientBase, members = 1) {
  const start = await setBillingStartOffset(client, 0)
  const ids: number[] = []
  for (let i = 0; i < members; i++) ids.push(await createFakeMember(client, { joinedOn: '2025-02-01', label: `Socio${i}` }))
  const price = await priceToday(client, ids[0])
  const jul = await monthAt(client, -3)
  const sep = await monthAt(client, -1)
  return { start, ids, price, from: jul, to: sep }
}

describe.skipIf(!dbAvailable)('register_payment_batch: camino feliz', () => {
  it('editor, forma VIEJA (tramo): se expande a una fila por mes, created_by es el editor, la descripción la que vino y Σ = el total', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to, start } = await scenario(client, 2)
      const editorId = await asRole(client, 'editor')
      const batchId = randomUUID()
      const description = 'Saldo anterior · fixture'

      const result = await callBatch(client, {
        batchId,
        items: [
          { member_id: ids[0], amount_cents: price * 4, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3, description } },
          { member_id: ids[1], amount_cents: price, opening_balance: null },
        ] satisfies BatchItem[],
      })

      expect(result).toHaveLength(2)
      expect(result.every((r) => r.alreadyRegistered === false)).toBe(true)
      const first = result.find((r) => r.memberId === ids[0])!
      const second = result.find((r) => r.memberId === ids[1])!
      expect(first.openingBalanceFeeId).not.toBeNull()
      expect(second.openingBalanceFeeId).toBeNull()

      await actAsSuperuser(client)
      const fees = await client.query(
        `select kind, to_char(period, 'YYYY-MM-DD') as period, amount_cents, description, created_by, voided_at, from_period
         from public.fees where member_id = any($1::bigint[]) order by period`,
        [ids],
      )
      // Una fila por mes (jul..sep del escenario), todas del socio con saldo, ninguna con tramo.
      expect(fees.rows).toHaveLength(3)
      expect(fees.rows.every((f) => f.kind === 'opening_balance' && f.created_by === editorId && f.voided_at === null && f.from_period === null)).toBe(true)
      // La forma vieja expandida NO copia la descripción del tramo: cada mes queda con la del guard.
      for (const f of fees.rows) {
        const [y, mm] = String(f.period).split('-')
        expect(f.description).toBe(`Saldo anterior · ${mm}/${y}`)
      }
      expect(fees.rows.map((f) => f.period)).toEqual([from, await monthAt(client, -2), to])
      expect(fees.rows.reduce((a, f) => a + Number(f.amount_cents), 0)).toBe(price * 3)
      expect(fees.rows.every((f) => f.period < start)).toBe(true)

      const payments = await client.query(
        `select member_id, amount_cents, batch_id, created_by from public.payments where batch_id = $1 order by member_id`,
        [batchId],
      )
      expect(payments.rows).toHaveLength(2)
      expect(payments.rows.every((p) => p.created_by === editorId)).toBe(true)
      expect(payments.rows.map((p) => Number(p.amount_cents))).toEqual([price * 4, price])
    })
  })

  it('grupo con dos socios, cada uno con su propio saldo anterior: cada fee_id vuelve en la fila de SU socio', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 2)
      await asRole(client, 'editor')

      const result = await callBatch(client, {
        items: [
          { member_id: ids[0], amount_cents: price * 2, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } },
          { member_id: ids[1], amount_cents: price * 5, opening_balance: { from_period: to, to_period: to, amount_cents: price } },
        ] satisfies BatchItem[],
      })

      await actAsSuperuser(client)
      const fees = await client.query(`select id, member_id, amount_cents from public.fees where member_id = any($1::bigint[]) order by member_id, id`, [ids])
      // ids[0]: tramo de 3 meses -> 3 filas; ids[1]: un solo mes -> 1 fila. opening_balance_fee_id = la PRIMERA de cada socio.
      expect(fees.rows).toHaveLength(4)
      const feeOf = new Map<number, { id: number; amount: number }>()
      for (const f of fees.rows) {
        const prev = feeOf.get(Number(f.member_id))
        feeOf.set(Number(f.member_id), { id: prev?.id ?? Number(f.id), amount: (prev?.amount ?? 0) + Number(f.amount_cents) })
      }
      expect(feeOf.get(ids[0])!.amount).toBe(price * 3)
      expect(feeOf.get(ids[1])!.amount).toBe(price)
      for (const row of result) {
        expect(row.openingBalanceFeeId).toBe(feeOf.get(row.memberId)!.id)
      }
    })
  })

  it('auditoría: el lote deja INSERT de fees y payments con actor_id = el editor de la sesión', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      const editorId = await asRole(client, 'editor')
      const [row] = await callBatch(client, {
        items: [{ member_id: ids[0], amount_cents: price * 3, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } }] satisfies BatchItem[],
      })

      await actAsSuperuser(client)
      for (const [table, id] of [['fees', row.openingBalanceFeeId], ['payments', row.paymentId]] as const) {
        const audit = await client.query(
          `select actor_id, actor_source, op from public.audit_log where table_name = $1 and record_id = $2::text and op = 'INSERT'`,
          [table, String(id)],
        )
        expect(audit.rows, `auditoría de ${table}`).toHaveLength(1)
        expect(audit.rows[0]).toMatchObject({ actor_id: editorId, actor_source: 'session' })
      }
    })
  })
})

describe.skipIf(!dbAvailable)('register_payment_batch: atómico', () => {
  it('un ítem con monto 0 después de uno con saldo anterior: no queda ni el saldo ni ningún pago', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 3)
      await asRole(client, 'editor')

      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch($1::uuid, private.club_today(), 'cash', null, null, $2::jsonb)`,
        [
          randomUUID(),
          JSON.stringify([
            { member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } },
            { member_id: ids[1], amount_cents: price },
            { member_id: ids[2], amount_cents: 0 },
          ]),
        ],
      )
      expect(err.code).toBe('23514')
      expect(await countRows(client, 'fees', ids)).toBe(0)
      expect(await countRows(client, 'payments', ids)).toBe(0)
    })
  })

  it('si falla el INSERT de pagos (socio inexistente) NO queda el saldo anterior que ya se había insertado', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      await asRole(client, 'editor')

      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch($1::uuid, private.club_today(), 'cash', null, null, $2::jsonb)`,
        [
          randomUUID(),
          JSON.stringify([
            { member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } },
            { member_id: 2_000_000_000, amount_cents: price },
          ]),
        ],
      )
      expect(err.code).toBe('23503')
      expect(await countRows(client, 'fees', ids)).toBe(0)
      expect(await countRows(client, 'payments', ids)).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('register_payment_batch: idempotente por batch_id', () => {
  it('el reintento devuelve already_registered y no duplica ni el saldo anterior ni los pagos', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 2)
      await asRole(client, 'editor')
      const batchId = randomUUID()
      const items = [
        { member_id: ids[0], amount_cents: price * 4, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } },
        { member_id: ids[1], amount_cents: price },
      ] satisfies BatchItem[]

      const first = await callBatch(client, { batchId, items })
      const feesAfterFirst = await countRows(client, 'fees', ids)
      const paymentsAfterFirst = await countRows(client, 'payments', ids)
      expect(feesAfterFirst).toBe(3) // el tramo de 3 meses -> 3 filas
      expect(paymentsAfterFirst).toBe(2)

      const retry = await callBatch(client, { batchId, items })
      expect(retry.every((r) => r.alreadyRegistered)).toBe(true)
      expect(retry.map((r) => r.paymentId).sort()).toEqual(first.map((r) => r.paymentId).sort())
      expect(retry.map((r) => r.amountCents).sort()).toEqual(first.map((r) => r.amountCents).sort())
      // El reintento devuelve el saldo creado en el primer envío (no null) y no crea otro.
      const obOf = (rows: typeof first, memberId: number) => rows.find((r) => r.memberId === memberId)!.openingBalanceFeeId
      expect(obOf(first, ids[0])).not.toBeNull()
      expect(obOf(retry, ids[0])).toBe(obOf(first, ids[0]))
      expect(obOf(retry, ids[1])).toBeNull()
      expect(await countRows(client, 'fees', ids)).toBe(feesAfterFirst)
      expect(await countRows(client, 'payments', ids)).toBe(paymentsAfterFirst)
    })
  })

  it('el reintento no vuelve a chequear el saldo anterior: aunque ya exista uno vigente, devuelve el lote hecho (no un 23505)', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      await asRole(client, 'editor')
      const batchId = randomUUID()
      const items = [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 2 } }] satisfies BatchItem[]
      await callBatch(client, { batchId, items })
      const retry = await callBatch(client, { batchId, items })
      expect(retry).toHaveLength(1)
      expect(retry[0].alreadyRegistered).toBe(true)
    })
  })

  it('dos lotes DISTINTOS con saldo anterior para el mismo socio y los mismos meses (un saldo vigente por mes): el segundo choca con fees_one_opening_balance y no inserta nada', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      await asRole(client, 'editor')
      await callBatch(client, {
        items: [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 2 } }] satisfies BatchItem[],
      })
      const feesBefore = await countRows(client, 'fees', ids)
      const paymentsBefore = await countRows(client, 'payments', ids)
      await asRole(client, 'editor')

      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch($1::uuid, private.club_today(), 'cash', null, null, $2::jsonb)`,
        [randomUUID(), JSON.stringify([{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price } }])],
      )
      expect(err.code).toBe('23505')
      expect((err as { constraint?: string }).constraint).toBe('fees_one_opening_balance')
      expect(await countRows(client, 'fees', ids)).toBe(feesBefore)
      expect(await countRows(client, 'payments', ids)).toBe(paymentsBefore)
    })
  })
})

describe.skipIf(!dbAvailable)('register_payment_batch: validaciones', () => {
  async function rejects(client: ClientBase, ids: number[], items: unknown, message: RegExp | string, code = '23514', paidOn?: string) {
    // countRows vuelve a superusuario: cada intento arranca de nuevo como editor.
    await asRole(client, 'editor')
    const err = await expectQueryError(
      client,
      `select * from public.register_payment_batch($1::uuid, coalesce($3::date, private.club_today()), 'cash', null, null, $2::jsonb)`,
      [randomUUID(), JSON.stringify(items), paidOn ?? null],
    )
    expect(err.code).toBe(code)
    if (typeof message === 'string') expect(err.message).toBe(message)
    else expect(err.message).toMatch(message)
    expect(await countRows(client, 'fees', ids)).toBe(0)
    expect(await countRows(client, 'payments', ids)).toBe(0)
  }

  it('to_period igual al inicio de la facturación: rechazado (solo meses ANTERIORES)', async () => {
    await withRollback(async (client) => {
      const { ids, price, start, from } = await scenario(client, 1)
      await asRole(client, 'editor')
      await rejects(client, ids, [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: start, amount_cents: price } }], /solo cubre meses anteriores/)
    })
  })

  it('to_period posterior al inicio: rechazado; to_period = inicio - 1 (el límite): aceptado', async () => {
    await withRollback(async (client) => {
      const { ids, price, to, from } = await scenario(client, 1)
      await asRole(client, 'editor')
      const after = await monthAt(client, 1)
      await rejects(client, ids, [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: after, amount_cents: price } }], /solo cubre meses anteriores/)
      const ok = await callBatch(client, { items: [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: to, to_period: to, amount_cents: price } }] satisfies BatchItem[] })
      expect(ok[0].openingBalanceFeeId).not.toBeNull()
    })
  })

  it('from_period > to_period: rechazado', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      await asRole(client, 'editor')
      await rejects(client, ids, [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: to, to_period: from, amount_cents: price } }], 'Los meses del saldo anterior no son válidos')
    })
  })

  it('from_period o to_period que no son día 1: check_violation (PostgREST directo se saltea Zod)', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      const midMonth = (iso: string) => `${iso.slice(0, 8)}15`
      for (const ob of [
        { from_period: midMonth(from), to_period: to },
        { from_period: from, to_period: midMonth(to) },
      ]) {
        await rejects(client, ids, [{ member_id: ids[0], amount_cents: price, opening_balance: { ...ob, amount_cents: price } }], 'Los meses del saldo anterior no son válidos')
      }
    })
  })

  it('saldo anterior con monto 0 o negativo: rechazado', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      await asRole(client, 'editor')
      for (const amount of [0, -100]) {
        await rejects(client, ids, [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: amount } }], 'El saldo anterior tiene que ser mayor a cero')
      }
    })
  })

  it('saldo anterior sin facturación activa: "Primero activá las cuotas en Ajustes"', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      await setBillingStart(client, null)
      await asRole(client, 'editor')
      await rejects(client, ids, [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price } }], 'Primero activá las cuotas en Ajustes')
    })
  })

  it('paid_on futuro: el guard de pagos lo rechaza y no queda el saldo anterior', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      await asRole(client, 'editor')
      const tomorrow = (await client.query<{ d: string }>(`select (private.club_today() + 1)::text as d`)).rows[0].d
      await rejects(
        client,
        ids,
        [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price } }],
        'La fecha del pago no puede ser futura',
        '23514',
        tomorrow,
      )
    })
  })

  it('lote vacío, no-array o sin batch_id: rechazados con mensaje de dominio', async () => {
    await withRollback(async (client) => {
      const { ids } = await scenario(client, 1)
      await asRole(client, 'editor')
      await rejects(client, ids, [], 'Cargá al menos un pago')
      await rejects(client, ids, { member_id: ids[0] }, 'Cargá al menos un pago')
      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch(null, private.club_today(), 'cash', null, null, '[{"member_id": 1, "amount_cents": 100}]'::jsonb)`,
      )
      expect(err.code).toBe('23514')
    })
  })
})

describe.skipIf(!dbAvailable)('register_payment_batch: permisos', () => {
  it('consulta: insufficient_privilege y no queda nada', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      await asRole(client, 'consulta')
      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch($1::uuid, private.club_today(), 'cash', null, null, $2::jsonb)`,
        [randomUUID(), JSON.stringify([{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price } }])],
      )
      expect(err.code).toBe('42501')
      expect(await countRows(client, 'fees', ids)).toBe(0)
      expect(await countRows(client, 'payments', ids)).toBe(0)
    })
  })

  it('consulta con user_metadata role=admin: tampoco (el rol sale de app_users, no del JWT)', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await scenario(client, 1)
      await actAsSuperuser(client)
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId, { extraClaims: { user_metadata: { role: 'admin' } } })
      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch($1::uuid, private.club_today(), 'cash', null, null, $2::jsonb)`,
        [randomUUID(), JSON.stringify([{ member_id: ids[0], amount_cents: price }])],
      )
      expect(err.code).toBe('42501')
    })
  })

  it('anon: sin EXECUTE (permission denied)', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await scenario(client, 1)
      await actAsSuperuser(client)
      await client.query('set local role anon')
      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch($1::uuid, current_date, 'cash', null, null, $2::jsonb)`,
        [randomUUID(), JSON.stringify([{ member_id: ids[0], amount_cents: price }])],
      )
      expect(err.message).toMatch(/permission denied/i)
    })
  })

  it('un socio nuevo de un editor: no puede colar created_by ajeno (no es una clave del jsonb)', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await scenario(client, 1)
      const editorId = await asRole(client, 'editor')
      await actAsSuperuser(client)
      const { userId: otherId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      await callBatch(client, { items: [{ member_id: ids[0], amount_cents: price, created_by: otherId }] })
      await actAsSuperuser(client)
      const r = await client.query(`select created_by from public.payments where member_id = $1`, [ids[0]])
      expect(r.rows[0].created_by).toBe(editorId)
    })
  })
})

describe.skipIf(!dbAvailable)('deuda derivada tras crear el saldo anterior (balance forward)', () => {
  const accountOf = async (client: ClientBase, memberId: number) => {
    // can(...) resuelve por auth.uid(): ni postgres lee estados de cuenta sin sesión.
    await asRole(client, 'editor')
    const r = await client.query(`select balance_cents, months_due from public.member_accounts(array[$1]::bigint[], 'all')`, [memberId])
    return { balance: Number(r.rows[0].balance_cents), monthsDue: Number(r.rows[0].months_due) }
  }

  it('saldo a favor previo (pagó de más) + saldo anterior cargado DESPUÉS: la deuda es la cuota del mes que el saldo viejo se comió, no un saldo a favor fantasma', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId: ids[0], period: current, amountCents: price })
      await insertPayment(client, { memberId: ids[0], amountCents: price * 3 })
      // Antes: cuota del mes pagada y 2 cuotas de saldo a favor.
      expect(await accountOf(client, ids[0])).toEqual({ balance: -(price * 2), monthsDue: 0 })

      await asRole(client, 'editor')
      await callBatch(client, {
        items: [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } }] satisfies BatchItem[],
      })

      // Cargos: 3P (saldo) + P (mes) = 4P; pagos: 3P + P = 4P. Saldo exacto 0, sin deuda.
      expect(await accountOf(client, ids[0])).toEqual({ balance: 0, monthsDue: 0 })
    })
  })

  it('saldo anterior cargado con menos plata que el crédito previo + pago insuficiente: la deuda restante es exacta y los meses adeudados cuadran', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId: ids[0], period: current, amountCents: price })
      await insertPayment(client, { memberId: ids[0], amountCents: price * 2 }) // cubre el mes + 1 de crédito

      await asRole(client, 'editor')
      await callBatch(client, {
        items: [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } }] satisfies BatchItem[],
      })

      // Cargos 4P, pagos 3P: debe exactamente 1P.
      const acc = await accountOf(client, ids[0])
      expect(acc.balance).toBe(price)
      expect(acc.monthsDue).toBeGreaterThanOrEqual(1)
    })
  })

  /**
   * El caso del bloqueante del review: crédito previo (pagó 3 cuotas antes de que existieran
   * cargos), el mes actual generado y cubierto, y dos proyectados cubiertos. El saldo anterior
   * es el cargo MÁS VIEJO: se come el crédito primero y la cobertura de los proyectados
   * retrocede. Lo que muestra `payment_month_options` después del lote es lo que la UI promete.
   */
  async function creditScenario(client: ClientBase) {
    const { ids, price, from, to } = await scenario(client, 1)
    const memberId = ids[0]
    const current = await monthAt(client, 0)
    await insertMonthlyFee(client, { memberId, period: current, amountCents: price })
    await insertPayment(client, { memberId, amountCents: price * 3 }) // oct pago + nov y dic cubiertos por crédito
    await asRole(client, 'editor')
    const before = await monthOptions(client, [memberId])
    expect(before.find((r) => r.period === current)).toMatchObject({ pending: 0 })
    return { memberId, price, from, to, current }
  }

  async function coveredPeriods(client: ClientBase, memberId: number) {
    await asRole(client, 'editor')
    const rows = await monthOptions(client, [memberId])
    return rows.filter((r) => r.kind === 'projected' && r.pending === 0).map((r) => r.period)
  }

  it('saldo anterior jul-sep de 3 cuotas + pago de 4: la cobertura llega hasta el 3er mes después del actual (todo cubierto, sin contar el crédito dos veces)', async () => {
    await withRollback(async (client) => {
      const { memberId, price, from, to } = await creditScenario(client)
      await callBatch(client, {
        items: [{ member_id: memberId, amount_cents: price * 4, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } }] satisfies BatchItem[],
      })
      // Cargos: 3P (saldo) + P (mes actual) = 4P. Pagos: 3P + 4P = 7P. Crédito restante: 3P.
      const covered = await coveredPeriods(client, memberId)
      expect(covered).toEqual([await monthAt(client, 1), await monthAt(client, 2), await monthAt(client, 3)])
      const rows = await monthOptions(client, [memberId])
      const current = await monthAt(client, 0)
      expect(rows.find((r) => r.period === current)).toMatchObject({ kind: 'monthly', pending: 0 })
      // El 4° proyectado ya no está cubierto: un peso de más sería doble cuenta.
      expect(rows.find((r) => r.period === rows.filter((x) => x.kind === 'projected')[3].period)).toMatchObject({ covered: 0, pending: price })
    })
  })

  it('contraste: con un pago de 2 cuotas la cobertura llega SOLO hasta el mes siguiente (el número que promete la UI)', async () => {
    await withRollback(async (client) => {
      const { memberId, price, from, to } = await creditScenario(client)
      await callBatch(client, {
        items: [{ member_id: memberId, amount_cents: price * 2, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } }] satisfies BatchItem[],
      })
      // Pagos 5P contra cargos 4P: sobra 1P = un solo proyectado.
      expect(await coveredPeriods(client, memberId)).toEqual([await monthAt(client, 1)])
    })
  })

  it('un peso menos que el pago que cubre el mes siguiente: ese proyectado queda parcial, no cubierto', async () => {
    await withRollback(async (client) => {
      const { memberId, price, from, to } = await creditScenario(client)
      await callBatch(client, {
        items: [{ member_id: memberId, amount_cents: price * 2 - 1, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } }] satisfies BatchItem[],
      })
      expect(await coveredPeriods(client, memberId)).toEqual([])
      const rows = await monthOptions(client, [memberId])
      const first = rows.find((r) => r.kind === 'projected')!
      expect(first).toMatchObject({ covered: price - 1, pending: 1 })
    })
  })

  it('después del lote, la tira del socio no ofrece como pre_system los meses que el lote cargó (solo los otros 9) y no hay saldo a favor aplicado a proyectados de más', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await scenario(client, 1)
      const current = await monthAt(client, 0)
      await insertMonthlyFee(client, { memberId: ids[0], period: current, amountCents: price })
      await asRole(client, 'editor')
      await callBatch(client, {
        items: [{ member_id: ids[0], amount_cents: price * 4, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } }] satisfies BatchItem[],
      })
      const rows = await monthOptions(client, [ids[0]])
      const pre = rows.filter((r) => r.kind === 'pre_system').map((r) => r.period)
      expect(pre).toHaveLength(9) // 12 previos - los 3 meses (jul..sep) que ahora tienen fila de saldo
      expect(pre).not.toContain(from)
      expect(pre).not.toContain(to)
      // 4P pagadas contra 3P de saldo + P del mes: todo cubierto, nada de crédito.
      expect(rows.find((r) => r.period === current)).toMatchObject({ kind: 'monthly', pending: 0 })
      expect(rows.filter((r) => r.kind === 'projected').every((r) => r.covered === 0)).toBe(true)
    })
  })

  it('saldo anterior ya existente + grupo (createFamilyGroup): los fixtures de grupo conviven sin cruzar socios', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      await actAsSuperuser(client)
      const groupId = await createFamilyGroup(client)
      const a = await createFakeMember(client, { joinedOn: '2025-02-01', familyGroupId: groupId })
      const b = await createFakeMember(client, { joinedOn: '2025-02-01', familyGroupId: groupId })
      const price = await priceToday(client, a)
      await insertOpeningBalanceFee(client, a, price * 2)
      await asRole(client, 'editor')
      const rows = await monthOptions(client, [a, b])
      // a tiene saldo SOLO en inicio-1: ese mes ya no se ofrece como pre_system, los otros 11 sí.
      const preA = rows.filter((r) => r.memberId === a && r.kind === 'pre_system').map((r) => r.period)
      expect(preA).toHaveLength(11)
      expect(preA).not.toContain(await monthAt(client, -1))
      expect(rows.filter((r) => r.memberId === b).filter((r) => r.kind === 'pre_system')).toHaveLength(12)
    })
  })
})
