import { describe, expect, it } from 'vitest'
import type { ClientBase } from 'pg'
import { actAs, actAsSuperuser, createUserWithRole, isDbAvailable, withRollback } from './helpers'
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
} from './payment-months-fixtures'

/**
 * Pipeline 2026-10-24-pago-por-meses-antes-del-inicio, `20261024150000_payment_months_before_start.sql`:
 * con el inicio de la facturacion en el futuro la tira igual trae celdas (pre_system con el mes
 * actual adentro + projected desde el inicio). Todo relativo a `club_today()`.
 */
const dbAvailable = await isDbAvailable()

async function asEditor(client: ClientBase) {
  await actAsSuperuser(client)
  const { userId } = await createUserWithRole(client, 'editor')
  await actAs(client, userId)
  return userId
}

describe.skipIf(!dbAvailable)('payment_month_options: inicio de la facturacion en el futuro', () => {
  it('inicio = mes siguiente: 12 pre_system (inicio-12..inicio-1) con is_current solo en el mes actual, y projected desde el inicio hasta actual+6', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, 1)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      const price = await priceToday(client, memberId)
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      const pre = rows.filter((r) => r.kind === 'pre_system')
      const projected = rows.filter((r) => r.kind === 'projected')
      expect(rows).toHaveLength(pre.length + projected.length)

      expect(pre).toHaveLength(12)
      expect(pre[0].period).toBe(await monthAt(client, -11))
      expect(pre[11].period).toBe(await monthAt(client, 0)) // el mes actual es el ultimo previo
      expect(pre.every((r) => r.period < start)).toBe(true)
      expect(pre.filter((r) => r.isCurrent).map((r) => r.period)).toEqual([await monthAt(client, 0)])
      for (const r of pre) expect(r).toMatchObject({ amount: price, covered: 0, pending: price, pricedAtToday: true })

      // Desde el inicio (actual+1) hasta actual+6: 6 meses, ninguno marcado como actual.
      expect(projected.map((r) => r.period)).toEqual([
        await monthAt(client, 1), await monthAt(client, 2), await monthAt(client, 3),
        await monthAt(client, 4), await monthAt(client, 5), await monthAt(client, 6),
      ])
      for (const r of projected) expect(r).toMatchObject({ amount: price, isCurrent: false })
      // Orden: todo lo previo antes de lo proyectado, sin solaparse.
      expect(pre[11].period < projected[0].period).toBe(true)
    })
  })

  it('inicio a 3 meses: pre_system termina en el mes actual (no se ofrecen meses futuros como deuda) y los proyectados arrancan en el inicio', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, 3)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      const current = await monthAt(client, 0)
      const pre = rows.filter((r) => r.kind === 'pre_system')
      expect(pre).toHaveLength(12)
      expect(pre[0].period).toBe(await monthAt(client, -11))
      expect(pre[11]).toMatchObject({ period: current, isCurrent: true })
      expect(pre.filter((r) => r.isCurrent)).toHaveLength(1)
      const projected = rows.filter((r) => r.kind === 'projected')
      expect(projected[0].period).toBe(start)
      expect(projected.at(-1)!.period).toBe(await monthAt(client, 6))
      // Ningun mes entre el actual y el inicio (exclusive): ni previo ni proyectado.
      expect(rows.filter((r) => r.period > current && r.period < start)).toEqual([])
    })
  })

  it('inicio a 13 meses o mas: la ventana sigue siendo 12 celdas y termina en el mes actual con is_current; sin proyectados (el inicio queda mas alla de actual+6)', async () => {
    await withRollback(async (client) => {
      for (const offset of [13, 20]) {
        await setBillingStartOffset(client, offset)
        const memberId = await createFakeMember(client, { joinedOn: '2025-01-15', label: `Lejano${offset}` })
        await asEditor(client)
        const rows = await monthOptions(client, [memberId])
        const pre = rows.filter((r) => r.kind === 'pre_system')
        expect(pre, `offset ${offset}`).toHaveLength(12)
        expect(pre[11]).toMatchObject({ period: await monthAt(client, 0), isCurrent: true })
        expect(pre[0].period).toBe(await monthAt(client, -11))
        expect(rows.filter((r) => r.isCurrent)).toHaveLength(1)
        expect(rows.filter((r) => r.kind === 'projected')).toHaveLength(0)
      }
    })
  })

  it('despues del inicio (inicio pasado) pre_system sigue siendo inicio-12..inicio-1, sin is_current, y no cambia con la ronda 2', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, -2)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      await asEditor(client)
      const pre = (await monthOptions(client, [memberId])).filter((r) => r.kind === 'pre_system')
      expect(pre).toHaveLength(12)
      expect(pre[0].period).toBe(await monthAt(client, -14))
      expect(pre[11].period).toBe(await monthAt(client, -3))
      expect(pre.every((r) => r.period < start && !r.isCurrent)).toBe(true)
    })
  })

  it('socio con saldo anterior vigente y inicio futuro: no recibe pre_system', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 1)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      const price = await priceToday(client, memberId)
      await insertOpeningBalanceFee(client, memberId, price * 2)
      await asEditor(client)
      expect((await monthOptions(client, [memberId])).filter((r) => r.kind === 'pre_system')).toHaveLength(0)
    })
  })

  it('billing_start_period null: sigue sin devolver nada', async () => {
    await withRollback(async (client) => {
      const memberId = await createFakeMember(client)
      await setBillingStart(client, null)
      await asEditor(client)
      expect(await monthOptions(client, [memberId])).toEqual([])
    })
  })

  it('socio dado de baja con inicio futuro: pre_system si, projected no (sin adelantos)', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 1)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      await actAsSuperuser(client)
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason)
         values ($1, 'withdrawal', private.club_today(), 'Baja de prueba')`,
        [memberId],
      )
      await asEditor(client)
      const rows = await monthOptions(client, [memberId])
      expect(rows.filter((r) => r.kind === 'pre_system')).toHaveLength(12)
      expect(rows.filter((r) => r.kind === 'projected')).toHaveLength(0)
    })
  })

  it('sin valor vigente hoy pero con uno desde el mes de inicio: las celdas no quedan en $0, usan el del inicio', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, 1)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      await actAsSuperuser(client)
      // Se descartan todos los valores y queda uno que rige recien desde el inicio.
      // DDL transaccional: se deshace con el rollback.
      await client.query(`alter table public.fee_prices disable trigger fee_prices_no_change`)
      await client.query(`update public.fee_prices set valid_from = $1`, [await monthAt(client, 24)])
      const newPrice = 1_234_500
      await client.query(`insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', $1, $2)`, [newPrice, start])
      expect(await priceToday(client, memberId)).toBe(0) // precondicion: hoy no hay valor
      await asEditor(client)

      const rows = await monthOptions(client, [memberId])
      const pre = rows.filter((r) => r.kind === 'pre_system')
      expect(pre).toHaveLength(12)
      for (const r of pre) expect(r).toMatchObject({ amount: newPrice, pending: newPrice, pricedAtToday: true })
    })
  })

  it('despues del inicio la salida no cambia: ningun pre_system marca is_current y el mes actual es monthly', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, -1)
      const memberId = await createFakeMember(client, { joinedOn: '2025-01-15' })
      const price = await priceToday(client, memberId)
      await insertMonthlyFee(client, { memberId, period: await monthAt(client, 0), amountCents: price })
      await asEditor(client)
      const rows = await monthOptions(client, [memberId])
      expect(rows.filter((r) => r.kind === 'pre_system').every((r) => !r.isCurrent)).toBe(true)
      expect(rows.find((r) => r.period === (null as unknown as string))).toBeUndefined()
      expect(rows.filter((r) => r.isCurrent)).toHaveLength(1)
    })
  })
})

describe.skipIf(!dbAvailable)('register_payment_batch: pagar solo el mes actual antes del inicio', () => {
  it('saldo anterior de 1 mes (periodo = inicio-1) + pago por el mismo monto: la deuda queda en 0 y la tira ya no ofrece pre_system', async () => {
    await withRollback(async (client) => {
      const start = await setBillingStartOffset(client, 1)
      const memberId = await createFakeMember(client, { joinedOn: '2025-02-01' })
      const price = await priceToday(client, memberId)
      const current = await monthAt(client, 0)
      await actAsSuperuser(client)
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const r = await client.query<{ opening_balance_fee_id: string | null; already_registered: boolean }>(
        `select * from public.register_payment_batch(gen_random_uuid(), private.club_today(), 'cash', null, null, $1::jsonb)`,
        [JSON.stringify([{ member_id: memberId, amount_cents: price, opening_balance: { from_period: current, to_period: current, amount_cents: price } }])],
      )
      expect(r.rows[0].opening_balance_fee_id).not.toBeNull()

      await actAsSuperuser(client)
      const fee = await client.query<{ period: string; kind: string; amount_cents: string }>(
        `select to_char(period, 'YYYY-MM-DD') as period, kind, amount_cents from public.fees where member_id = $1`,
        [memberId],
      )
      expect(fee.rows).toHaveLength(1)
      expect(fee.rows[0]).toMatchObject({ kind: 'opening_balance', amount_cents: String(price) })
      // Lo fija el trigger: inicio - 1 (el mes actual, con inicio = mes siguiente).
      expect(fee.rows[0].period).toBe(await monthAt(client, 0))
      expect(start > fee.rows[0].period).toBe(true)

      await actAs(client, userId)
      const acc = await client.query(`select balance_cents, months_due from public.member_accounts(array[$1]::bigint[], 'all')`, [memberId])
      expect(Number(acc.rows[0].balance_cents)).toBe(0)
      expect(Number(acc.rows[0].months_due)).toBe(0)
    })
  })

  it('un peso menos que la cuota: la deuda es exactamente 1 centavo (no se redondea a pagado)', async () => {
    await withRollback(async (client) => {
      await setBillingStartOffset(client, 1)
      const memberId = await createFakeMember(client, { joinedOn: '2025-02-01' })
      const price = await priceToday(client, memberId)
      const current = await monthAt(client, 0)
      await actAsSuperuser(client)
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await client.query(
        `select * from public.register_payment_batch(gen_random_uuid(), private.club_today(), 'cash', null, null, $1::jsonb)`,
        [JSON.stringify([{ member_id: memberId, amount_cents: price - 1, opening_balance: { from_period: current, to_period: current, amount_cents: price } }])],
      )
      const acc = await client.query(`select balance_cents from public.member_accounts(array[$1]::bigint[], 'all')`, [memberId])
      expect(Number(acc.rows[0].balance_cents)).toBe(1)
      void insertPayment
    })
  })
})
