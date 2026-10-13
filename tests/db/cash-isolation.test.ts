import { randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import { actAs, actAsSuperuser, createMember, createUserWithRole, isDbAvailable, withRollback } from './helpers'

/**
 * INVARIANTE CENTRAL de la caja de otros ingresos: registrar o anular un
 * ingreso que no es cuota NO puede mover ni un centavo de la deuda, el estado
 * de cuenta ni la cobranza de cuotas. Se prueba tomando una "foto" literal
 * (`to_json` fila por fila) de todas las funciones de deuda y cobranza antes
 * y después, y exigiendo que sean idénticas. Si alguien en el futuro suma
 * `cash_movements` a una de esas funciones, esta foto cambia.
 *
 * Contraparte (para que la foto no sea trivialmente igual porque el
 * movimiento no hizo nada): `cash_month_summary` SÍ tiene que cambiar.
 */
const dbAvailable = await isDbAvailable()

async function snapshot(client: ClientBase, memberId: number): Promise<Record<string, unknown[]>> {
  const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows.map((r) => r.j)
  return {
    month_collection_current: await q(`select to_json(t) as j from public.month_collection(null) t`),
    month_collection_prev: await q(`select to_json(t) as j from public.month_collection((date_trunc('month', private.club_today()) - interval '1 month')::date) t`),
    month_collection_2025_03: await q(`select to_json(t) as j from public.month_collection('2025-03-01') t`),
    daily_collection_current: await q(`select to_json(t) as j from public.daily_collection(null) t order by t.day`),
    daily_collection_2025_03: await q(`select to_json(t) as j from public.daily_collection('2025-03-01') t order by t.day`),
    dashboard_summary: await q(`select to_json(t) as j from public.dashboard_summary() t`),
    debt_by_category: await q(`select to_json(t) as j from public.debt_by_category() t`),
    monthly_history: await q(`select to_json(t) as j from public.monthly_history(12) t order by t.period`),
    member_accounts_active: await q(`select to_json(t) as j from public.member_accounts(null, 'active') t order by t.member_id`),
    member_accounts_all: await q(`select to_json(t) as j from public.member_accounts(null, 'all') t order by t.member_id`),
    member_fee_statement: await q(`select to_json(t) as j from public.member_fee_statement($1) t order by t.fee_id`, [memberId]),
    member_computed_fields: await q(
      `select json_build_object(
         'id', m.id,
         'balance', public.member_balance_cents(m),
         'status', public.member_debt_status(m),
         'months_due', public.member_months_due(m)
       ) as j
       from public.members m order by m.id`,
    ),
  }
}

describe.skipIf(!dbAvailable)('Invariante: los otros ingresos no tocan la deuda ni la cobranza de cuotas', () => {
  it('foto de las funciones de deuda/cobranza idéntica antes y después de registrar y anular movimientos', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: editorId } = await createUserWithRole(client, 'editor')

      // Un socio con cargos y un pago parcial: la foto tiene deuda de verdad.
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'Prueba', lastName: 'Caja', joinedOn: '2026-01-01' })
      await client.query(`insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, '2026-01-01', 'monthly', 1000000, 'fixture')`, [memberId])
      await client.query(`insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, '2026-02-01', 'monthly', 1000000, 'fixture')`, [memberId])
      await client.query(`insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1500000, private.club_today(), 'cash', $2)`, [
        memberId,
        randomUUID(),
      ])
      const concept = await client.query<{ id: string }>(`insert into public.cash_concepts (name) values ($1) returning id`, [`Concepto ${randomUUID().slice(0, 8)}`])
      const conceptId = Number(concept.rows[0].id)
      const sponsor = await client.query<{ id: string }>(`insert into public.sponsors (name) values ($1) returning id`, [`Sponsor ${randomUUID().slice(0, 8)}`])
      const sponsorId = Number(sponsor.rows[0].id)

      await actAs(client, adminId)
      const summaryBefore = (await client.query(`select * from public.cash_month_summary('2025-03-01')`)).rows[0]
      const before = await snapshot(client, memberId)

      // La foto no es vacía: tiene al socio de este test y deuda real.
      expect((before.member_accounts_all as Array<{ member_id: number }>).some((r) => r.member_id === memberId)).toBe(true)
      expect(before.member_fee_statement.length).toBeGreaterThanOrEqual(2)

      // Registrar: efectivo y transferencia, hoy, mes pasado y marzo 2025, con y sin sponsor.
      await actAs(client, editorId)
      const ids: number[] = []
      const cases: Array<{ amount: number; method: string; on: string | null; sponsor: number | null }> = [
        { amount: 1_000_000, method: 'cash', on: null, sponsor: null },
        { amount: 2_500_000, method: 'transfer', on: null, sponsor: sponsorId },
        { amount: 777_700, method: 'cash', on: '2025-03-15', sponsor: sponsorId },
        { amount: 1, method: 'transfer', on: '2025-03-31', sponsor: null },
        { amount: 9_999_999_999, method: 'cash', on: '2025-03-01', sponsor: null },
      ]
      for (const c of cases) {
        const r = await client.query<{ id: string }>(
          `insert into public.cash_movements (concept_id, sponsor_id, amount_cents, occurred_on, method, batch_id)
           values ($1, $2, $3, coalesce($4::date, private.club_today()), $5, $6) returning id`,
          [conceptId, c.sponsor, c.amount, c.on, c.method, randomUUID()],
        )
        ids.push(Number(r.rows[0].id))
      }

      await actAs(client, adminId)
      const afterRegister = await snapshot(client, memberId)
      expect(afterRegister).toEqual(before)

      // Contraparte: el resumen de caja SÍ vio los movimientos de marzo 2025.
      const summaryMid = (await client.query(`select * from public.cash_month_summary('2025-03-01')`)).rows[0]
      expect(Number(summaryMid.other_income_cents) - Number(summaryBefore.other_income_cents)).toBe(777_700 + 1 + 9_999_999_999)

      // Anular dos (uno de hoy, uno de marzo): tampoco mueve nada de la deuda.
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Error de carga' where id = any($1::bigint[])`, [[ids[0], ids[4]]])
      const afterVoid = await snapshot(client, memberId)
      expect(afterVoid).toEqual(before)

      const summaryAfter = (await client.query(`select * from public.cash_month_summary('2025-03-01')`)).rows[0]
      expect(Number(summaryAfter.other_income_cents) - Number(summaryBefore.other_income_cents)).toBe(777_700 + 1)
    })
  })

  it('un ingreso gigante de otros ingresos no cambia "cobrado en cuotas" ni la deuda total del panel', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAsSuperuser(client)
      const concept = await client.query<{ id: string }>(`insert into public.cash_concepts (name) values ($1) returning id`, [`Concepto ${randomUUID().slice(0, 8)}`])

      await actAs(client, adminId)
      const dash = async () => (await client.query(`select to_json(t) as j from public.dashboard_summary() t`)).rows[0].j
      const mc = async () => (await client.query(`select to_json(t) as j from public.month_collection(null) t`)).rows[0].j
      const beforeDash = await dash()
      const beforeMc = await mc()

      await client.query(
        `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 99999999999, 'transfer', $2)`,
        [concept.rows[0].id, randomUUID()],
      )

      expect(await dash()).toEqual(beforeDash)
      expect(await mc()).toEqual(beforeMc)
      const s = (await client.query(`select * from public.cash_month_summary(null)`)).rows[0]
      expect(Number(s.fees_collected_cents)).toBe(Number(beforeMc.collected_cents))
    })
  })
})
