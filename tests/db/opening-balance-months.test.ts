import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { splitOpeningTotal } from '@/views/payments/month-selection'
import type { ClientBase } from 'pg'
import { actAs, actAsSuperuser, createUserWithRole, expectQueryError, hasGrant, isDbAvailable, withRollback } from './helpers'
import {
  countRows,
  createFakeMember,
  insertOpeningBalanceFee,
  monthAt,
  monthOptions,
  priceToday,
  setBillingStartOffset,
  withdrawMember,
} from './payment-months-fixtures'

/**
 * Pipeline 2026-10-24-carga-inicial-meses, `20261024170000_opening_balance_months.sql`:
 * el saldo anterior guarda su tramo (from_period/to_period) y `payment_month_options` lo
 * expande en una celda por mes. Todo es relativo a `club_today()` y corre en transacciones
 * revertidas; datos inventados.
 */
const dbAvailable = await isDbAvailable()

type Span = { from_period: string; to_period: string; amount_cents: number; description?: string }
type BatchItem = { member_id: number; amount_cents: number; opening_balance?: Span | null }

async function asRole(client: ClientBase, role: 'editor' | 'consulta' | 'admin') {
  await actAsSuperuser(client)
  const { userId } = await createUserWithRole(client, role)
  await actAs(client, userId)
  return userId
}

async function callBatch(client: ClientBase, items: BatchItem[], batchId: string = randomUUID()) {
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

/**
 * Escenario "carga inicial": el inicio es el mes que viene, así el mes actual todavía es
 * previo al sistema. Tramo de 10 meses que termina en el mes actual (el "enero..octubre" de
 * la carga histórica), con alta de 2025 para que el socio tenga previas.
 */
async function preStart(client: ClientBase, members = 1) {
  const start = await setBillingStartOffset(client, 1)
  const ids: number[] = []
  for (let i = 0; i < members; i++) ids.push(await createFakeMember(client, { joinedOn: '2025-01-15', label: `Socio${i}` }))
  const price = await priceToday(client, ids[0])
  const from = await monthAt(client, -9)
  const to = await monthAt(client, 0)
  return { start, ids, price, from, to }
}

async function feeRow(client: ClientBase, feeId: number) {
  await actAsSuperuser(client)
  const r = await client.query(
    `select kind, amount_cents, to_char(period, 'YYYY-MM-DD') as period,
            to_char(from_period, 'YYYY-MM-DD') as from_period, to_char(to_period, 'YYYY-MM-DD') as to_period
     from public.fees where id = $1`,
    [feeId],
  )
  return r.rows[0] as { kind: string; amount_cents: string; period: string; from_period: string | null; to_period: string | null }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe.skipIf(!dbAvailable)('fees.from_period/to_period: CHECKs (con el guard apagado, la red para PostgREST)', () => {
  /** Inserta una fila cruda como postgres con el trigger del guard apagado (DDL transaccional). */
  async function rawInsert(client: ClientBase, memberId: number, v: { kind?: string; period: string; from: string | null; to: string | null }) {
    return expectQueryError(
      client,
      `insert into public.fees (member_id, period, kind, amount_cents, description, from_period, to_period)
       values ($1, $2, $3, 100000, 'fixture', $4, $5)`,
      [memberId, v.period, v.kind ?? 'opening_balance', v.from, v.to],
    )
  }

  it('cada CHECK rechaza su caso: una sola mitad, día distinto de 1, desde > hasta, hasta > period, más de 36 meses, tramo en cuota mensual', async () => {
    await withRollback(async (client) => {
      const { ids } = await preStart(client)
      await actAsSuperuser(client)
      await client.query(`alter table public.fees disable trigger fees_opening_balance_guard`)
      const m = ids[0]
      const prev = await monthAt(client, -1) // period fijo = "inicio - 1" del escenario no aplica: se manda a mano
      const m3 = await monthAt(client, -3)
      const m2 = await monthAt(client, -2)
      const m37 = await monthAt(client, -37)

      expect((await rawInsert(client, m, { period: prev, from: m3, to: null })).message).toContain('fees_opening_span_shape')
      expect((await rawInsert(client, m, { period: prev, from: null, to: m3 })).message).toContain('fees_opening_span_shape')
      const notFirst = m3.replace(/-01$/, '-02')
      expect((await rawInsert(client, m, { period: prev, from: notFirst, to: m2 })).message).toContain('fees_opening_span_month_start')
      expect((await rawInsert(client, m, { period: prev, from: m3, to: m2.replace(/-01$/, '-15') })).message).toContain('fees_opening_span_month_start')
      expect((await rawInsert(client, m, { period: prev, from: m2, to: m3 })).message).toContain('fees_opening_span_order')
      // to_period > period (el "antes del inicio" que fija el guard)
      expect((await rawInsert(client, m, { period: m3, from: m3, to: m2 })).message).toContain('fees_opening_span_order')
      // 37 meses: un mes de más que el tope de 36
      expect((await rawInsert(client, m, { period: prev, from: m37, to: prev })).message).toContain('fees_opening_span_max')
      expect((await rawInsert(client, m, { kind: 'monthly', period: prev, from: m3, to: m2 })).message).toContain('fees_opening_span_kind')
    })
  })

  it('el borde de 36 meses entra y el código viejo (sin tramo) sigue insertando', async () => {
    await withRollback(async (client) => {
      const { ids } = await preStart(client)
      await actAsSuperuser(client)
      await client.query(`alter table public.fees disable trigger fees_opening_balance_guard`)
      const prev = await monthAt(client, -1)
      const m36 = await monthAt(client, -36)
      await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, description, from_period, to_period)
         values ($1, $2, 'opening_balance', 100000, 'fixture', $3, $2)`,
        [ids[0], prev, m36],
      )
      const other = await createFakeMember(client, { label: 'Viejo' })
      await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, $2, 'opening_balance', 100000, 'fixture')`,
        [other, prev],
      )
      expect(await countRows(client, 'fees', [ids[0], other])).toBe(2)
    })
  })

  it('un solo saldo vigente por socio sigue valiendo con tramo (fees_one_opening_balance)', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client)
      await asRole(client, 'editor')
      const span = { from_period: from, to_period: to, amount_cents: price * 10 }
      await callBatch(client, [{ member_id: ids[0], amount_cents: price, opening_balance: span }])
      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch(gen_random_uuid(), private.club_today(), 'cash', null, null, $1::jsonb)`,
        [JSON.stringify([{ member_id: ids[0], amount_cents: price, opening_balance: span }])],
      )
      expect(err.code).toBe('23505')
    })
  })
})

describe.skipIf(!dbAvailable)('guard del saldo anterior con tramo: mensajes y período', () => {
  async function insertAs(client: ClientBase, memberId: number, from: string | null, to: string | null) {
    return expectQueryError(
      client,
      `insert into public.fees (member_id, kind, amount_cents, description, from_period, to_period)
       values ($1, 'opening_balance', 100000, 'fixture', $2, $3)`,
      [memberId, from, to],
    )
  }

  it('tramos mal formados dan el texto amigable (check_violation), no el nombre de un constraint', async () => {
    await withRollback(async (client) => {
      const { ids, from, to } = await preStart(client)
      await asRole(client, 'editor')
      const m2 = await monthAt(client, -2)
      const m3 = await monthAt(client, -3)
      const m37 = await monthAt(client, -37)
      const cases: Array<[string | null, string | null]> = [
        [from, null], // una sola mitad
        [null, to],
        [m2, m3], // desde > hasta
        [m3.replace(/-01$/, '-05'), m2], // día distinto de 1
        [m37, await monthAt(client, -1)], // 37 meses
      ]
      for (const [f, t] of cases) {
        const err = await insertAs(client, ids[0], f, t)
        expect(err.code, `${f} → ${t}`).toBe('23514')
        expect(err.message, `${f} → ${t}`).toBe('Los meses del saldo anterior no son válidos')
      }
    })
  })

  it('hasta >= inicio: "solo cubre meses anteriores a MM/YYYY" con el inicio real; hasta = inicio - 1 pasa', async () => {
    await withRollback(async (client) => {
      const { ids, start } = await preStart(client)
      await asRole(client, 'editor')
      const m2 = await monthAt(client, -2)
      const [y, mo] = start.split('-')
      const err = await insertAs(client, ids[0], m2, start)
      expect(err.code).toBe('23514')
      expect(err.message).toBe(`El saldo anterior solo cubre meses anteriores a ${mo}/${y}`)

      const lastOk = await monthAt(client, 0) // inicio - 1
      const ok = await client.query<{ id: string }>(
        `insert into public.fees (member_id, kind, amount_cents, description, from_period, to_period)
         values ($1, 'opening_balance', 100000, 'fixture', $2, $3) returning id`,
        [ids[0], m2, lastOk],
      )
      const row = await feeRow(client, Number(ok.rows[0].id))
      // period lo fija la base (inicio - 1) y el tramo queda como vino
      expect(row).toMatchObject({ period: lastOk, from_period: m2, to_period: lastOk })
    })
  })

  it('un editor inserta el tramo por PostgREST directo (grant de insert por columna); sin tramo sigue andando', async () => {
    await withRollback(async (client) => {
      const { ids, from, to } = await preStart(client, 2)
      await asRole(client, 'editor')
      const a = await client.query<{ id: string }>(
        `insert into public.fees (member_id, kind, amount_cents, description, from_period, to_period)
         values ($1, 'opening_balance', 500000, 'fixture', $2, $3) returning id`,
        [ids[0], from, to],
      )
      const b = await client.query<{ id: string }>(
        `insert into public.fees (member_id, kind, amount_cents, description) values ($1, 'opening_balance', 500000, 'fixture') returning id`,
        [ids[1]],
      )
      expect(await feeRow(client, Number(a.rows[0].id))).toMatchObject({ from_period: from, to_period: to })
      expect(await feeRow(client, Number(b.rows[0].id))).toMatchObject({ from_period: null, to_period: null })
    })
  })

  it('consulta no puede insertar un saldo anterior con tramo', async () => {
    await withRollback(async (client) => {
      const { ids, from, to } = await preStart(client)
      await asRole(client, 'consulta')
      const err = await insertAs(client, ids[0], from, to)
      expect(err.code).toBe('42501')
    })
  })
})

describe.skipIf(!dbAvailable)('tramo: inmutable, sin delete, auditado', () => {
  it('from_period/to_period: sin grant de update ni siquiera para admin; el trigger los frena incluso como postgres; anular solo cambia la anulación', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client)
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 10 } }])
      const feeId = r.feeId!

      await asRole(client, 'admin')
      for (const col of ['from_period', 'to_period']) {
        const err = await expectQueryError(client, `update public.fees set ${col} = $2 where id = $1`, [feeId, from])
        expect(err.code, col).toBe('42501')
      }

      await actAsSuperuser(client)
      for (const col of ['from_period', 'to_period']) {
        const err = await expectQueryError(client, `update public.fees set ${col} = null where id = $1`, [feeId])
        expect(err.message, col).toBe(`La columna ${col} no se puede modificar`)
      }

      await asRole(client, 'admin')
      await client.query(`update public.fees set void_reason = 'Carga equivocada' where id = $1`, [feeId])
      expect(await feeRow(client, feeId)).toMatchObject({ from_period: from, to_period: to, amount_cents: String(price * 10) })
    })
  })

  it('authenticated: insert de las columnas nuevas sí, update no, y ningún delete sobre fees', async () => {
    await withRollback(async (client) => {
      const q = (priv: string, col: string) =>
        client.query<{ ok: boolean }>(`select has_column_privilege('authenticated', 'public.fees', $1, $2) as ok`, [col, priv])
      for (const col of ['from_period', 'to_period']) {
        expect((await q('INSERT', col)).rows[0].ok, `insert ${col}`).toBe(true)
        expect((await q('UPDATE', col)).rows[0].ok, `update ${col}`).toBe(false)
      }
      expect(await hasGrant(client, 'authenticated', 'fees', 'DELETE')).toBe(false)
      expect(await hasGrant(client, 'anon', 'fees', 'INSERT')).toBe(false)
    })
  })

  it('auditoría: la fila INSERT del saldo trae from_period/to_period en new_data y el actor es auth.uid() de quien lo cargó', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client)
      const editorId = await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 10 } }])

      await actAsSuperuser(client)
      const audit = await client.query(
        `select actor_id, actor_source, op, new_data from public.audit_log where table_name = 'fees' and record_id = $1`,
        [String(r.feeId)],
      )
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0]).toMatchObject({ actor_id: editorId, actor_source: 'session', op: 'INSERT' })
      expect(audit.rows[0].new_data).toMatchObject({ from_period: from, to_period: to, kind: 'opening_balance' })
    })
  })
})

describe.skipIf(!dbAvailable)('register_payment_batch con tramo', () => {
  it('guarda el tramo y el período = inicio - 1; reintento con el mismo batch_id es idempotente y devuelve el mismo saldo', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to, start } = await preStart(client)
      await asRole(client, 'editor')
      const batchId = randomUUID()
      const item: BatchItem = { member_id: ids[0], amount_cents: price * 3, opening_balance: { from_period: from, to_period: to, amount_cents: price * 10 } }
      const [first] = await callBatch(client, [item], batchId)
      expect(first.already).toBe(false)
      expect(first.feeId).not.toBeNull()

      const row = await feeRow(client, first.feeId!)
      expect(row).toMatchObject({ kind: 'opening_balance', from_period: from, to_period: to, amount_cents: String(price * 10) })
      expect(row.period < start).toBe(true)

      await asRole(client, 'editor')
      const [retry] = await callBatch(client, [item], batchId)
      expect(retry).toMatchObject({ already: true, feeId: first.feeId, paymentId: first.paymentId })
      expect(await countRows(client, 'fees', ids)).toBe(1)
      expect(await countRows(client, 'payments', ids)).toBe(1)
    })
  })

  it('tramo inválido dentro del lote: error y NADA queda (ni saldo ni pagos), también para el ítem anterior', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to, start } = await preStart(client, 2)
      await asRole(client, 'editor')
      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch(gen_random_uuid(), private.club_today(), 'cash', null, null, $1::jsonb)`,
        [
          JSON.stringify([
            { member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 10 } },
            { member_id: ids[1], amount_cents: price, opening_balance: { from_period: from, to_period: start, amount_cents: price } },
          ]),
        ],
      )
      expect(err.code).toBe('23514')
      expect(err.message).toMatch(/^El saldo anterior solo cubre meses anteriores a /)
      expect(await countRows(client, 'fees', ids)).toBe(0)
      expect(await countRows(client, 'payments', ids)).toBe(0)
    })
  })

  it('consulta (sin payments.register) es rechazada', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client)
      await asRole(client, 'consulta')
      const err = await expectQueryError(
        client,
        `select * from public.register_payment_batch(gen_random_uuid(), private.club_today(), 'cash', null, null, $1::jsonb)`,
        [JSON.stringify([{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price } }])],
      )
      expect(err.code).toBe('42501')
      expect(await countRows(client, 'fees', ids)).toBe(0)
    })
  })

  it('grupo: cada socio con su propio tramo; cada celda lleva el opening_from de SU saldo', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client, 2)
      const m5 = await monthAt(client, -5)
      await asRole(client, 'editor')
      await callBatch(client, [
        { member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 10 } },
        { member_id: ids[1], amount_cents: price, opening_balance: { from_period: m5, to_period: to, amount_cents: price * 6 } },
      ])
      const rows = await monthOptions(client, ids)
      const ob = (id: number) => rows.filter((r) => r.memberId === id && r.kind === 'opening_balance')
      expect(ob(ids[0])).toHaveLength(10)
      expect(ob(ids[1])).toHaveLength(6)
      expect(ob(ids[0]).every((r) => r.openingFrom === from)).toBe(true)
      expect(ob(ids[1]).every((r) => r.openingFrom === m5)).toBe(true)
      expect(ob(ids[1])[0].period).toBe(m5)
    })
  })
})

describe.skipIf(!dbAvailable)('payment_month_options: saldo anterior mes por mes', () => {
  it('carga inicial completa: ene–mar histórico → celdas reales pagas/adeudadas; segundo pago abr–jun deja jul..oct adeudadas', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client)
      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: ids[0], amount_cents: price * 3, opening_balance: { from_period: from, to_period: to, amount_cents: price * 10 } }])

      let rows = await monthOptions(client, ids)
      let ob = rows.filter((r) => r.kind === 'opening_balance')
      expect(ob).toHaveLength(10)
      expect(ob.map((r) => r.period)).toEqual(await Promise.all([-9, -8, -7, -6, -5, -4, -3, -2, -1, 0].map((o) => monthAt(client, o))))
      expect(ob.every((r) => r.openingFrom === from && r.amount === price)).toBe(true)
      expect(ob.slice(0, 3).every((r) => r.covered === price && r.pending === 0)).toBe(true)
      expect(ob.slice(3).every((r) => r.covered === 0 && r.pending === price)).toBe(true)
      // El tramo no deja pre_system duplicando esos meses
      expect(rows.filter((r) => r.kind === 'pre_system')).toHaveLength(0)

      // Segundo pago histórico (abril–junio): el saldo ya existe, sin opening_balance nuevo
      await callBatch(client, [{ member_id: ids[0], amount_cents: price * 3 }])
      rows = await monthOptions(client, ids)
      ob = rows.filter((r) => r.kind === 'opening_balance')
      expect(ob).toHaveLength(10)
      expect(ob.slice(0, 6).every((r) => r.pending === 0)).toBe(true)
      expect(ob.slice(6).map((r) => r.pending)).toEqual([price, price, price, price])
    })
  })

  it('total no múltiplo: $100.000 en 3 meses → el resto cae en el último mes y Σ celdas = total', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await preStart(client)
      const from = await monthAt(client, -2)
      const to = await monthAt(client, 0)
      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: ids[0], amount_cents: 50_000_00, opening_balance: { from_period: from, to_period: to, amount_cents: 100_000_00 } }])
      void price
      const ob = (await monthOptions(client, ids)).filter((r) => r.kind === 'opening_balance')
      expect(ob.map((r) => r.amount)).toEqual([3_333_333, 3_333_333, 3_333_334].map((x) => x))
      expect(sum(ob.map((r) => r.amount))).toBe(100_000_00)
      // cobertura parcial: 50.000 cubre el 1.º entero (3.333.333)... y el 2.º hasta agotarse
      expect(ob.map((r) => r.covered)).toEqual([3_333_333, 1_666_667, 0])
      expect(sum(ob.map((r) => r.covered))).toBe(50_000_00)
      expect(ob.every((r) => r.pending === r.amount - r.covered)).toBe(true)
    })
  })

  it('total corregido a mano (≠ n × cuota): Σ celdas = total y las n-1 primeras son iguales', async () => {
    await withRollback(async (client) => {
      const { ids, from, to } = await preStart(client)
      const total = 8_555_555
      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: ids[0], amount_cents: 1000, opening_balance: { from_period: from, to_period: to, amount_cents: total } }])
      const ob = (await monthOptions(client, ids)).filter((r) => r.kind === 'opening_balance')
      expect(ob).toHaveLength(10)
      expect(sum(ob.map((r) => r.amount))).toBe(total)
      expect(new Set(ob.slice(0, 9).map((r) => r.amount)).size).toBe(1)
      expect(ob[9].amount).toBe(total - 9 * Math.floor(total / 10))
    })
  })

  it('un mes de tramo con el total chico: n=1 devuelve una celda con todo el monto', async () => {
    await withRollback(async (client) => {
      const { ids, to } = await preStart(client)
      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: ids[0], amount_cents: 777, opening_balance: { from_period: to, to_period: to, amount_cents: 12_345 } }])
      const ob = (await monthOptions(client, ids)).filter((r) => r.kind === 'opening_balance')
      expect(ob).toHaveLength(1)
      expect(ob[0]).toMatchObject({ amount: 12_345, covered: 777, openingFrom: to })
    })
  })

  it('un peso menos que todo el saldo: la última celda queda con 1 centavo pendiente; todo el saldo: ninguna', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client, 2)
      await asRole(client, 'editor')
      const total = price * 10
      await callBatch(client, [
        { member_id: ids[0], amount_cents: total - 1, opening_balance: { from_period: from, to_period: to, amount_cents: total } },
        { member_id: ids[1], amount_cents: total, opening_balance: { from_period: from, to_period: to, amount_cents: total } },
      ])
      const rows = await monthOptions(client, ids)
      const a = rows.filter((r) => r.memberId === ids[0] && r.kind === 'opening_balance')
      const b = rows.filter((r) => r.memberId === ids[1] && r.kind === 'opening_balance')
      expect(sum(a.map((r) => r.pending))).toBe(1)
      expect(a[9].pending).toBe(1)
      expect(sum(b.map((r) => r.pending))).toBe(0)
    })
  })

  it('fila vieja sin tramo: una sola celda "opening_balance" con opening_from NULL y el total entero', async () => {
    await withRollback(async (client) => {
      const { ids, price, start } = await preStart(client)
      await insertOpeningBalanceFee(client, ids[0], price * 4)
      await asRole(client, 'editor')
      const rows = await monthOptions(client, ids)
      const ob = rows.filter((r) => r.kind === 'opening_balance')
      expect(ob).toHaveLength(1)
      expect(ob[0]).toMatchObject({ amount: price * 4, covered: 0, pending: price * 4, openingFrom: null })
      expect(ob[0].period < start).toBe(true)
      // tampoco ofrece pre_system (tiene saldo vigente)
      expect(rows.filter((r) => r.kind === 'pre_system')).toHaveLength(0)
      // el resto de las filas no inventa opening_from
      expect(rows.filter((r) => r.kind !== 'opening_balance').every((r) => r.openingFrom === null)).toBe(true)
    })
  })

  it('saldo anulado: vuelven las pre_system y los pagos quedan como saldo a favor sobre las proyectadas', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client)
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: ids[0], amount_cents: price * 3, opening_balance: { from_period: from, to_period: to, amount_cents: price * 10 } }])

      await asRole(client, 'admin')
      await client.query(`update public.fees set void_reason = 'Carga equivocada' where id = $1`, [r.feeId])

      const rows = await monthOptions(client, ids)
      expect(rows.filter((x) => x.kind === 'opening_balance')).toHaveLength(0)
      expect(rows.filter((x) => x.kind === 'pre_system')).toHaveLength(12)
      const projected = rows.filter((x) => x.kind === 'projected')
      expect(projected.slice(0, 3).every((x) => x.covered === x.amount && x.pending === 0)).toBe(true)
      expect(projected.slice(3).every((x) => x.covered === 0)).toBe(true)
      // la fila anulada sigue existiendo
      expect(await countRows(client, 'fees', ids)).toBe(1)
    })
  })

  it('antes del inicio se ven las celdas pagas; después del inicio solo desde la primera adeudada', async () => {
    await withRollback(async (client) => {
      // después del inicio: inicio = mes actual, tramo -9..-1, pagan los 3 primeros
      await setBillingStartOffset(client, 0)
      const ids = [await createFakeMember(client, { joinedOn: '2025-01-15' })]
      const price = await priceToday(client, ids[0])
      const from = await monthAt(client, -9)
      const to = await monthAt(client, -1)
      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: ids[0], amount_cents: price * 3, opening_balance: { from_period: from, to_period: to, amount_cents: price * 9 } }])
      const ob = (await monthOptions(client, ids)).filter((r) => r.kind === 'opening_balance')
      expect(ob.map((r) => r.period)).toEqual(await Promise.all([-6, -5, -4, -3, -2, -1].map((o) => monthAt(client, o))))
      expect(ob.every((r) => r.pending === price && r.openingFrom === from)).toBe(true)
    })
  })

  it('después del inicio con todo pago: no queda ninguna celda del saldo', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 0)
      const ids = [await createFakeMember(client, { joinedOn: '2025-01-15' })]
      const price = await priceToday(client, ids[0])
      const from = await monthAt(client, -3)
      const to = await monthAt(client, -1)
      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: ids[0], amount_cents: price * 3, opening_balance: { from_period: from, to_period: to, amount_cents: price * 3 } }])
      const rows = await monthOptions(client, ids)
      expect(rows.filter((r) => r.kind === 'opening_balance')).toHaveLength(0)
    })
  })

  it('socio dado de baja conserva las celdas de su saldo y no recibe proyectadas; alta posterior al inicio sin previas no ve ni pre_system', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client)
      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: ids[0], amount_cents: price, opening_balance: { from_period: from, to_period: to, amount_cents: price * 10 } }])
      await withdrawMember(client, ids[0])
      await asRole(client, 'editor')
      const rows = await monthOptions(client, ids)
      expect(rows.filter((r) => r.kind === 'opening_balance')).toHaveLength(10)
      expect(rows.filter((r) => r.kind === 'projected')).toHaveLength(0)

      await setBillingStartOffset(client, -2)
      const late = await createFakeMember(client, { label: 'Reciente' }) // alta este mes, después del inicio
      await asRole(client, 'editor')
      const lateRows = await monthOptions(client, [late])
      expect(lateRows.filter((r) => r.kind === 'pre_system' || r.kind === 'opening_balance')).toHaveLength(0)
    })
  })

  it('la deuda sigue derivada: Σ monto de celdas = fees.amount_cents, Σ cubierto = pagos, y member_accounts da total − pagos', async () => {
    await withRollback(async (client) => {
      const { ids, price, from, to } = await preStart(client)
      const total = price * 10 + 7 // no múltiplo a propósito
      const paid = price * 3 + 5
      await asRole(client, 'editor')
      const [r] = await callBatch(client, [{ member_id: ids[0], amount_cents: paid, opening_balance: { from_period: from, to_period: to, amount_cents: total } }])

      const ob = (await monthOptions(client, ids)).filter((x) => x.kind === 'opening_balance')
      const fee = await feeRow(client, r.feeId!)
      expect(sum(ob.map((x) => x.amount))).toBe(Number(fee.amount_cents))
      expect(sum(ob.map((x) => x.covered))).toBe(paid)

      await asRole(client, 'editor')
      const acc = await client.query(
        `select charged_cents, paid_cents, balance_cents from public.member_accounts(array[$1]::bigint[], 'all')`,
        [ids[0]],
      )
      expect(Number(acc.rows[0].charged_cents)).toBe(total)
      expect(Number(acc.rows[0].paid_cents)).toBe(paid)
      expect(Number(acc.rows[0].balance_cents)).toBe(total - paid)
    })
  })

  it('consulta no puede llamar a la RPC (payments.register)', async () => {
    await withRollback(async (client) => {
      const { ids } = await preStart(client)
      await asRole(client, 'consulta')
      const err = await expectQueryError(client, `select * from public.payment_month_options($1::bigint[])`, [ids])
      expect(err.code).toBe('42501')
    })
  })
})

describe.skipIf(!dbAvailable)('grants de las funciones tocadas', () => {
  it('solo authenticated ejecuta payment_month_options y register_payment_batch (service_role no, a propósito: son RPC de sesión, como member_accounts); anon y public no', async () => {
    await withRollback(async (client) => {
      for (const fn of ['public.payment_month_options(bigint[])', 'public.register_payment_batch(uuid, date, text, text, text, jsonb)']) {
        for (const [role, expected] of [['authenticated', true], ['service_role', false], ['anon', false]] as const) {
          const r = await client.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])
          expect(r.rows[0].ok, `${role} ${fn}`).toBe(expected)
        }
      }
    })
  })

  it('paridad TS/SQL: splitOpeningTotal da exactamente el reparto por celda de payment_month_options (varios total, n)', async () => {
    await withRollback(async (client) => {
      const cases: Array<[number, number]> = [
        [10_000_000, 3],
        [8_555_555, 10],
        [1_000_001, 10],
        [777_777, 7],
        [5, 3],
        [123_456_789, 36],
        [999, 1],
        [3_000_000, 2],
      ]
      const { ids } = await preStart(client, cases.length)
      const items: BatchItem[] = []
      for (const [i, [total, n]] of cases.entries()) {
        const from = await monthAt(client, -(n - 1))
        const to = await monthAt(client, 0)
        items.push({ member_id: ids[i], amount_cents: 1000, opening_balance: { from_period: from, to_period: to, amount_cents: total } })
      }
      await asRole(client, 'editor')
      await callBatch(client, items)
      const rows = await monthOptions(client, ids)
      for (const [i, [total, n]] of cases.entries()) {
        const sql = rows.filter((r) => r.memberId === ids[i] && r.kind === 'opening_balance').map((r) => r.amount)
        expect(sql, `total ${total} en ${n}`).toEqual(splitOpeningTotal(total, n))
      }
    })
  })

  it('el guard del saldo sigue SECURITY DEFINER con search_path vacío y sin execute para anon', async () => {
    await withRollback(async (client) => {
      const r = await client.query<{ secdef: boolean; cfg: string[] | null; anon: boolean }>(
        `select prosecdef as secdef, proconfig as cfg,
                has_function_privilege('anon', 'private.fees_opening_balance_guard()', 'execute') as anon
         from pg_proc where oid = 'private.fees_opening_balance_guard()'::regprocedure`,
      )
      expect(r.rows[0].secdef).toBe(true)
      expect(r.rows[0].cfg).toContain('search_path=""')
      expect(r.rows[0].anon).toBe(false)
    })
  })
})
