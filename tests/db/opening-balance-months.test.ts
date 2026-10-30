import { describe, expect, it } from 'vitest'
import { splitOpeningTotal } from '@/views/payments/month-selection'
import type { ClientBase } from 'pg'
import { actAs, actAsSuperuser, createUserWithRole, expectQueryError, hasGrant, isDbAvailable, withRollback } from './helpers'
import {
  callBatch,
  countRows,
  createFakeMember,
  feeStatus,
  insertOpeningBalanceFee,
  monthAt,
  monthOptions,
  priceToday,
  setBillingStartOffset,
} from './payment-months-fixtures'

/**
 * Saldo anterior: UNA FILA POR MES (pipeline 2026-10-29-imputacion-libre-meses,
 * `20261029120000_payment_allocations.sql`). Reemplaza a la versión de 2026-10-24, que probaba el
 * saldo como un tramo (`from_period`/`to_period`) expandido por `payment_month_options`: ese modelo
 * lo reemplazó el usuario (meses sueltos, saldo anterior por mes). Qué se borró y por qué:
 *   - celdas "expandidas del tramo", `opening_from`, tramo en el lote, auditoría del tramo: ya no
 *     existen (el tramo no se carga más; lo cubre `payment-allocations.test.ts` para la forma vieja).
 *   - los CHECKs del tramo SIGUEN (filas viejas anuladas): se conservan abajo.
 * Todo es relativo a `club_today()` y corre en transacciones revertidas; datos inventados.
 */
const dbAvailable = await isDbAvailable()


async function asRole(client: ClientBase, role: 'editor' | 'consulta' | 'admin') {
  await actAsSuperuser(client)
  const { userId } = await createUserWithRole(client, role)
  await actAs(client, userId)
  return userId
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

  it('el índice único es por (socio, mes): el mismo mes dos veces choca, meses distintos conviven y una fila anulada libera el mes', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await preStart(client)
      const m1 = await monthAt(client, -1)
      const m2 = await monthAt(client, -2)
      const first = await insertOpeningBalanceFee(client, ids[0], price, m1)
      await insertOpeningBalanceFee(client, ids[0], price, m2) // otro mes: ok
      const dup = await expectQueryError(
        client,
        `insert into public.fees (member_id, kind, period, amount_cents) values ($1, 'opening_balance', $2, 100)`,
        [ids[0], m1],
      )
      expect(dup.code).toBe('23505')
      expect((dup as { constraint?: string }).constraint).toBe('fees_one_opening_balance')

      // Otro socio, mismo mes: no choca (el índice es por socio).
      const other = await createFakeMember(client, { label: 'Otro', joinedOn: '2025-01-15' })
      await insertOpeningBalanceFee(client, other, price, m1)

      // Anulada la fila, el mes queda libre (el índice es parcial: voided_at is null).
      await asRole(client, 'admin')
      await client.query(`update public.fees set void_reason = 'Carga equivocada' where id = $1`, [first])
      await insertOpeningBalanceFee(client, ids[0], price * 2, m1)
      expect(await countRows(client, 'fees', ids)).toBe(3)
    })
  })
})

describe.skipIf(!dbAvailable)('guard del saldo anterior por mes: mensajes y período', () => {
  async function insertAs(client: ClientBase, memberId: number, period: string | null, amount = 100000, extra = '') {
    return expectQueryError(
      client,
      `insert into public.fees (member_id, kind, period, amount_cents ${extra ? ', ' + extra.split('=')[0] : ''})
       values ($1, 'opening_balance', $2, $3 ${extra ? ', ' + extra.split('=')[1] : ''})`,
      [memberId, period, amount],
    )
  }

  it('un mes >= inicio: "solo cubre meses anteriores a MM/YYYY" con el inicio real; inicio - 1 pasa', async () => {
    await withRollback(async (client) => {
      const { ids, start } = await preStart(client)
      await asRole(client, 'editor')
      const [y, mo] = start.split('-')
      for (const bad of [start, await monthAt(client, 2)]) {
        const err = await insertAs(client, ids[0], bad)
        expect(err.code, bad).toBe('23514')
        expect(err.message, bad).toBe(`El saldo anterior solo cubre meses anteriores a ${mo}/${y}`)
      }
      const lastOk = await monthAt(client, 0) // inicio - 1
      const ok = await client.query<{ id: string }>(
        `insert into public.fees (member_id, kind, period, amount_cents) values ($1, 'opening_balance', $2, 100000) returning id`,
        [ids[0], lastOk],
      )
      expect(await feeRow(client, Number(ok.rows[0].id))).toMatchObject({ period: lastOk, from_period: null, to_period: null })
    })
  })

  it('36 meses atrás entra, 37 no; día distinto de 1 y monto <= 0 se rechazan con texto legible (23514, no nombre de constraint)', async () => {
    await withRollback(async (client) => {
      const { ids, start } = await preStart(client)
      await asRole(client, 'editor')
      // inicio es mes+1: 36 meses antes del inicio = mes actual - 35
      const edge = await monthAt(client, -35)
      await client.query(`insert into public.fees (member_id, kind, period, amount_cents) values ($1, 'opening_balance', $2, 100000)`, [ids[0], edge])
      const tooOld = await insertAs(client, ids[0], await monthAt(client, -36))
      expect(tooOld.code).toBe('23514')
      expect(tooOld.message).toBe('El saldo anterior no puede ir más de 36 meses atrás')

      const notFirst = await insertAs(client, ids[0], (await monthAt(client, -3)).replace(/-01$/, '-15'))
      expect(notFirst.message).toBe('El mes del saldo anterior no es válido')

      for (const amount of [0, -5]) {
        const err = await insertAs(client, ids[0], await monthAt(client, -4), amount)
        expect(err.code, `monto ${amount}`).toBe('23514')
      }
      void start
    })
  })

  it('sin período (código viejo / seed) cae a inicio - 1; la descripción por defecto es "Saldo anterior · MM/YYYY" y una mandada se respeta', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await preStart(client, 2)
      await asRole(client, 'editor')
      const a = await client.query<{ id: string }>(
        `insert into public.fees (member_id, kind, amount_cents) values ($1, 'opening_balance', $2) returning id`,
        [ids[0], price],
      )
      const lastPeriod = await monthAt(client, 0)
      const [yy, mm] = lastPeriod.split('-')
      const row = await feeRow(client, Number(a.rows[0].id))
      expect(row.period).toBe(lastPeriod)
      await actAsSuperuser(client)
      const d = await client.query(`select description from public.fees where id = $1`, [a.rows[0].id])
      expect(d.rows[0].description).toBe(`Saldo anterior · ${mm}/${yy}`)

      await asRole(client, 'editor')
      const b = await client.query<{ description: string }>(
        `insert into public.fees (member_id, kind, period, amount_cents, description) values ($1, 'opening_balance', $2, $3, 'A mano') returning description`,
        [ids[1], await monthAt(client, -2), price],
      )
      expect(b.rows[0].description).toBe('A mano')
    })
  })

  it('el tramo ya no se carga: from_period/to_period dan 42501 al editor (sin grant de INSERT) y 23514 si llegan por un camino con grant', async () => {
    await withRollback(async (client) => {
      const { ids, from, to } = await preStart(client)
      await asRole(client, 'editor')
      const err = await expectQueryError(
        client,
        `insert into public.fees (member_id, kind, period, amount_cents, from_period, to_period) values ($1, 'opening_balance', $2, 100000, $3, $2)`,
        [ids[0], to, from],
      )
      expect(err.code).toBe('42501')

      // Como postgres el grant no frena: lo frena el guard con su texto.
      await actAsSuperuser(client)
      const guard = await expectQueryError(
        client,
        `insert into public.fees (member_id, kind, period, amount_cents, from_period, to_period) values ($1, 'opening_balance', $2, 100000, $3, $2)`,
        [ids[0], to, from],
      )
      expect(guard.code).toBe('23514')
      expect(guard.message).toBe('El saldo anterior se carga mes por mes. Recargá la página y volvé a intentar')
    })
  })

  it('un editor inserta N meses en UN insert (como PostgREST); consulta no puede (42501); si un mes falla no entra ninguno', async () => {
    await withRollback(async (client) => {
      const { ids, price, start } = await preStart(client)
      await asRole(client, 'editor')
      const ms = [await monthAt(client, -3), await monthAt(client, -2), await monthAt(client, -1)]
      await client.query(
        `insert into public.fees (member_id, kind, period, amount_cents)
         select $1, 'opening_balance', p::date, $3 from unnest($2::text[]) p`,
        [ids[0], ms, price],
      )
      expect(await countRows(client, 'fees', ids)).toBe(3)

      await asRole(client, 'editor')
      const bad = await expectQueryError(
        client,
        `insert into public.fees (member_id, kind, period, amount_cents)
         select $1, 'opening_balance', p::date, $3 from unnest($2::text[]) p`,
        [ids[0], [await monthAt(client, -4), start], price],
      )
      expect(bad.code).toBe('23514')
      expect(await countRows(client, 'fees', ids)).toBe(3) // el mes bueno de ese insert tampoco entró

      await asRole(client, 'consulta')
      const denied = await expectQueryError(
        client,
        `insert into public.fees (member_id, kind, period, amount_cents) values ($1, 'opening_balance', $2, 100)`,
        [ids[0], await monthAt(client, -8)],
      )
      expect(denied.code).toBe('42501')
    })
  })
})

describe.skipIf(!dbAvailable)('saldo anterior por mes: inmutable, sin delete, auditado', () => {
  it('period/amount/from_period/to_period no se modifican (ni como admin ni como postgres); anular solo cambia la anulación', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await preStart(client)
      const m = await monthAt(client, -2)
      const feeId = await insertOpeningBalanceFee(client, ids[0], price, m)

      await asRole(client, 'admin')
      for (const col of ['period', 'amount_cents', 'from_period', 'to_period']) {
        const err = await expectQueryError(client, `update public.fees set ${col} = ${col} where id = $1`, [feeId])
        expect(err.code, `admin ${col}`).toBe('42501')
      }
      await actAsSuperuser(client)
      const mov = await expectQueryError(client, `update public.fees set period = $2 where id = $1`, [feeId, await monthAt(client, -3)])
      expect(mov.message).toMatch(/no se puede modificar/)
      const amt = await expectQueryError(client, `update public.fees set amount_cents = amount_cents + 1 where id = $1`, [feeId])
      expect(amt.message).toMatch(/no se puede modificar/)

      await asRole(client, 'admin')
      await client.query(`update public.fees set void_reason = 'Carga equivocada' where id = $1`, [feeId])
      expect(await feeRow(client, feeId)).toMatchObject({ period: m, amount_cents: String(price) })
    })
  })

  it('grants de columna: authenticated inserta period, NO from_period/to_period; no actualiza ninguna de las tres; ningún delete en fees', async () => {
    await withRollback(async (client) => {
      const q = (priv: string, col: string) =>
        client.query<{ ok: boolean }>(`select has_column_privilege('authenticated', 'public.fees', $1, $2) as ok`, [col, priv])
      expect((await q('INSERT', 'period')).rows[0].ok).toBe(true)
      for (const col of ['from_period', 'to_period']) {
        expect((await q('INSERT', col)).rows[0].ok, `insert ${col}`).toBe(false)
      }
      for (const col of ['period', 'from_period', 'to_period']) {
        expect((await q('UPDATE', col)).rows[0].ok, `update ${col}`).toBe(false)
      }
      expect(await hasGrant(client, 'authenticated', 'fees', 'DELETE')).toBe(false)
      expect(await hasGrant(client, 'anon', 'fees', 'INSERT')).toBe(false)
    })
  })

  it('auditoría: cada mes cargado deja su INSERT con el period real y actor = auth.uid() de quien lo cargó', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await preStart(client)
      const editorId = await asRole(client, 'editor')
      const ms = [await monthAt(client, -2), await monthAt(client, -1)]
      const r = await client.query<{ id: string }>(
        `insert into public.fees (member_id, kind, period, amount_cents) select $1, 'opening_balance', p::date, $3 from unnest($2::text[]) p returning id`,
        [ids[0], ms, price],
      )
      await actAsSuperuser(client)
      const audit = await client.query(
        `select record_id, actor_id, actor_source, op, new_data from public.audit_log
         where table_name = 'fees' and record_id = any($1::text[]) order by record_id`,
        [r.rows.map((x) => x.id)],
      )
      expect(audit.rows).toHaveLength(2)
      for (const row of audit.rows) {
        expect(row).toMatchObject({ actor_id: editorId, actor_source: 'session', op: 'INSERT' })
        expect(row.new_data).toMatchObject({ kind: 'opening_balance' })
        expect(row.new_data.from_period ?? null).toBeNull()
      }
      expect(audit.rows.map((x) => String(x.new_data.period).slice(0, 10)).sort()).toEqual(ms)
    })
  })
})

describe.skipIf(!dbAvailable)('register_payment_batch: saldo anterior por mes', () => {
  it('opening_months crea una fila por mes (sin tramo, descripción por defecto) y el pago cubre del más viejo; consulta es rechazada', async () => {
    await withRollback(async (client) => {
      const { ids, price } = await preStart(client)
      const ms = [await monthAt(client, -3), await monthAt(client, -2), await monthAt(client, -1)]
      await asRole(client, 'consulta')
      const denied = await expectQueryError(
        client,
        `select * from public.register_payment_batch(gen_random_uuid(), private.club_today(), 'cash', null, null, $1::jsonb)`,
        [JSON.stringify([{ member_id: ids[0], amount_cents: price, opening_months: ms.map((period) => ({ period, amount_cents: price })) }])],
      )
      expect(denied.code).toBe('42501')

      await asRole(client, 'editor')
      await callBatch(client, [{ member_id: ids[0], amount_cents: price * 2, opening_months: ms.map((period) => ({ period, amount_cents: price })) }])
      const st = await feeStatus(client, ids[0])
      const ob = st.filter((r) => r.kind === 'opening_balance')
      expect(ob.map((r) => r.period)).toEqual(ms)
      expect(ob.map((r) => r.status)).toEqual(['paid', 'paid', 'due'])
    })
  })
})

describe.skipIf(!dbAvailable)('payment_month_options: saldo anterior por mes', () => {
  it('cada fila de saldo es UNA celda opening_balance de su mes (sin tramo); los otros meses previos siguen como pre_system', async () => {
    await withRollback(async (client) => {
      const { ids, price, start } = await preStart(client)
      const m = await monthAt(client, -2)
      await insertOpeningBalanceFee(client, ids[0], price * 4 + 1, m)
      await asRole(client, 'editor')
      const rows = await monthOptions(client, ids)
      const ob = rows.filter((r) => r.kind === 'opening_balance')
      expect(ob).toHaveLength(1)
      expect(ob[0]).toMatchObject({ period: m, amount: price * 4 + 1, covered: 0, pending: price * 4 + 1 })
      expect(ob[0].period < start).toBe(true)
      expect(rows.filter((r) => r.kind === 'pre_system').map((r) => r.period)).not.toContain(m)
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

describe.skipIf(!dbAvailable)('grants y paridad de las funciones tocadas', () => {
  it('solo authenticated ejecuta payment_month_options y register_payment_batch (service_role no, a propósito: son RPC de sesión); anon y public no', async () => {
    await withRollback(async (client) => {
      for (const fn of ['public.payment_month_options(bigint[])', 'public.register_payment_batch(uuid, date, text, text, text, jsonb)']) {
        for (const [role, expected] of [['authenticated', true], ['service_role', false], ['anon', false]] as const) {
          const r = await client.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])
          expect(r.rows[0].ok, `${role} ${fn}`).toBe(expected)
        }
      }
    })
  })

  it('paridad TS/SQL: splitOpeningTotal (TS) da exactamente private.split_opening_total (SQL) para varios (total, n), y Σ = total', async () => {
    await withRollback(async (client) => {
      const cases: Array<[number, number]> = [
        [10_000_000, 3], [8_555_555, 10], [1_000_001, 10], [777_777, 7], [5, 3], [123_456_789, 36], [999, 1], [3_000_000, 2], [1, 36], [0, 4],
      ]
      for (const [total, n] of cases) {
        const r = await client.query<{ parts: string[] }>(`select private.split_opening_total($1::bigint, $2::int) as parts`, [total, n])
        const sql = r.rows[0].parts.map(Number)
        expect(sql, `total ${total} en ${n}`).toEqual(splitOpeningTotal(total, n))
        expect(sum(sql)).toBe(total)
      }
      const empty = await client.query<{ parts: string[] }>(`select private.split_opening_total(100, 0) as parts`)
      expect(empty.rows[0].parts).toEqual([])
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
