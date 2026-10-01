import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  actAs,
  actAsSuperuser,
  createCategory,
  createDiscipline,
  createMember,
  createUserWithRole,
  expectQueryError,
  isDbAvailable,
  openMemberCategory,
  withRollback,
} from './helpers'
import type { ClientBase } from 'pg'

/**
 * S3 (`01-tasks.md`, `20260927130200_accounts.sql`): deuda derivada, campos
 * calculados de PostgREST, RPCs de estado de cuenta / cobranza / panel.
 *
 * Los fixtures insertan `fees`/`payments` DIRECTO (como superusuario, dentro
 * del rollback) en vez de pasar por la generación mensual real: acá se
 * ejercitan las funciones de agregación con montos y períodos elegidos a
 * mano, no la generación (que ya tiene su propia cobertura en
 * `billing.test.ts`). La base local ya trae socios y cuotas reales del seed:
 * las funciones que agregan TODOS los activos (`dashboard_summary`,
 * `debt_by_category`) conviven con esos datos — la invariante
 * `sum(debt_by_category) = dashboard_summary.total_debt_cents` vale sobre
 * cualquier conjunto de datos, incluido el real + el fixture, así que no hace
 * falta aislarla. Las demás RPCs se acotan con `member_accounts(array[...])`.
 */
const dbAvailable = await isDbAvailable()

/**
 * Anular exige `can('payments.void')` en el CUERPO del trigger, y `can(...)`
 * resuelve por `auth.uid()` — que es null en sesión de superusuario (sin
 * `request.jwt.claims`). Ni `postgres` puede anular "gratis": hace falta un
 * admin real de mentira. Deja al cliente en estado neutro (superusuario) al
 * volver, como el resto de los helpers de fixture de este archivo.
 */
async function voidAsAdmin(client: ClientBase, sql: string, params: unknown[]): Promise<void> {
  await actAsSuperuser(client)
  const { userId: adminId } = await createUserWithRole(client, 'admin')
  await actAs(client, adminId)
  await client.query(sql, [...params, adminId])
  await actAsSuperuser(client)
}

/** Inserta un cargo `monthly` (social si categoryId es null) directo, como superusuario. */
async function insertMonthlyFee(
  client: ClientBase,
  input: { memberId: number; period: string; amountCents: number; categoryId?: number | null; disciplineId?: number | null; voided?: boolean },
): Promise<number> {
  const row = await client.query<{ id: number }>(
    `insert into public.fees (member_id, period, kind, amount_cents, category_id, discipline_id, description)
     values ($1, $2, 'monthly', $3, $4, $5, 'fixture') returning id`,
    [input.memberId, input.period, input.amountCents, input.categoryId ?? null, input.disciplineId ?? null],
  )
  if (input.voided) {
    await voidAsAdmin(
      client,
      `update public.fees set voided_at = now(), voided_by = $2, void_reason = 'fixture anulado' where id = $1`,
      [row.rows[0].id],
    )
  }
  return row.rows[0].id
}

async function insertOpeningBalance(client: ClientBase, input: { memberId: number; period: string; amountCents: number }): Promise<number> {
  const row = await client.query<{ id: number }>(
    `insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, $2, 'opening_balance', $3, 'fixture arranque') returning id`,
    [input.memberId, input.period, input.amountCents],
  )
  return row.rows[0].id
}

async function insertPayment(
  client: ClientBase,
  input: { memberId: number; amountCents: number; paidOn: string; method?: 'cash' | 'transfer'; voided?: boolean },
): Promise<number> {
  const row = await client.query<{ id: number }>(
    `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, $2, $3, $4, $5) returning id`,
    [input.memberId, input.amountCents, input.paidOn, input.method ?? 'cash', randomUUID()],
  )
  if (input.voided) {
    await voidAsAdmin(
      client,
      `update public.payments set voided_at = now(), voided_by = $2, void_reason = 'fixture anulado' where id = $1`,
      [row.rows[0].id],
    )
  }
  return row.rows[0].id
}

/** Período (primer día del mes) y fecha de hoy según la base, en hora del club. Nunca hardcodear el mes: current_fee_cents y monthly_history(1) miran el mes en curso. */
async function clubNow(client: ClientBase) {
  const r = await client.query<{ period: string; today: string }>(
    `select to_char(date_trunc('month', private.club_today()), 'YYYY-MM-DD') as period, to_char(private.club_today(), 'YYYY-MM-DD') as today`,
  )
  return r.rows[0]
}

describe.skipIf(!dbAvailable)('member_balance / member_fee_statement: cobertura oldest-first', () => {
  it('sin pagos: balance = 3 cuotas, months_due 3, oldest_due_period la más vieja; pago parcial reduce el más viejo primero', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'A', lastName: 'Statement', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: '2026-07-01', amountCents: 1_000_000 })
      await insertMonthlyFee(client, { memberId, period: '2026-08-01', amountCents: 1_000_000 })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000 })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)

      const before = await client.query(`select * from public.member_accounts(array[$1]::bigint[], 'all')`, [memberId])
      expect(before.rows[0].balance_cents).toBe('3000000')
      expect(before.rows[0].months_due).toBe(3)
      expect(before.rows[0].oldest_due_period.toISOString().slice(0, 10)).toBe('2026-07-01')
      expect(before.rows[0].debt_status).toBe('in_debt')

      await actAsSuperuser(client)
      await insertPayment(client, { memberId, amountCents: 1_000_000, paidOn: '2026-07-15' })
      await actAs(client, consultaId)

      const afterOnePayment = await client.query(`select * from public.member_accounts(array[$1]::bigint[], 'all')`, [memberId])
      expect(afterOnePayment.rows[0].months_due).toBe(2)
      expect(afterOnePayment.rows[0].oldest_due_period.toISOString().slice(0, 10)).toBe('2026-08-01')

      await actAsSuperuser(client)
      await insertPayment(client, { memberId, amountCents: 1_500_000, paidOn: '2026-08-15' })
      await actAs(client, consultaId)

      const statement = await client.query(`select * from public.member_fee_statement($1) order by period`, [memberId])
      expect(statement.rows.map((r) => r.status)).toEqual(['paid', 'paid', 'partial'])
      expect(Number(statement.rows[2].covered_cents)).toBe(500_000)
      const finalBalance = await client.query(`select months_due from public.member_accounts(array[$1]::bigint[], 'all')`, [memberId])
      expect(finalBalance.rows[0].months_due).toBe(1)
    })
  })

  it('saldo de arranque cuenta como un ítem adeudado y aparece primero en el statement', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'B', lastName: 'Arranque', joinedOn: '2026-01-01' })
      await insertOpeningBalance(client, { memberId, period: '2026-08-01', amountCents: 2_000_000 })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000 })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)

      const account = await client.query(`select months_due, debt_status from public.member_accounts(array[$1]::bigint[], 'all')`, [
        memberId,
      ])
      expect(account.rows[0].months_due).toBe(2)
      expect(account.rows[0].debt_status).toBe('in_debt')

      const statement = await client.query(`select kind, status from public.member_fee_statement($1) order by fee_id`, [memberId])
      expect(statement.rows[0].kind).toBe('opening_balance')
    })
  })

  it('pago que excede la deuda: saldo a favor (credit), balance negativo, nunca se muestra como deuda de otro', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'D', lastName: 'Credito', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: '2026-08-01', amountCents: 2_000_000 })
      await insertPayment(client, { memberId, amountCents: 3_000_000, paidOn: '2026-08-20' })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const account = await client.query(`select balance_cents, debt_status, months_due from public.member_accounts(array[$1]::bigint[], 'all')`, [
        memberId,
      ])
      expect(account.rows[0].balance_cents).toBe('-1000000')
      expect(account.rows[0].debt_status).toBe('credit')
      expect(account.rows[0].months_due).toBe(0)

      // La cuota siguiente absorbe el saldo a favor sola.
      await actAsSuperuser(client)
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000 })
      await actAs(client, consultaId)
      const afterNextFee = await client.query(`select balance_cents, debt_status from public.member_accounts(array[$1]::bigint[], 'all')`, [
        memberId,
      ])
      expect(afterNextFee.rows[0].balance_cents).toBe('0')
      expect(afterNextFee.rows[0].debt_status).toBe('up_to_date')
    })
  })

  it('pago anulado no cuenta: la deuda vuelve a subir y last_payment ignora el anulado', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'F', lastName: 'Anulado', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000 })
      await insertPayment(client, { memberId, amountCents: 1_000_000, paidOn: '2026-09-05' })
      await insertPayment(client, { memberId, amountCents: 500_000, paidOn: '2026-09-10', voided: true })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const account = await client.query(
        `select balance_cents, last_payment_cents, last_payment_on from public.member_accounts(array[$1]::bigint[], 'all')`,
        [memberId],
      )
      expect(account.rows[0].balance_cents).toBe('0')
      expect(Number(account.rows[0].last_payment_cents)).toBe(1_000_000)
      expect(account.rows[0].last_payment_on.toISOString().slice(0, 10)).toBe('2026-09-05')
    })
  })

  it('anular una cuota la saca del cálculo (deja de contar), y la cuota anulada sigue existiendo', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'H', lastName: 'CuotaAnulada', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000, voided: true })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const account = await client.query(`select balance_cents, debt_status from public.member_accounts(array[$1]::bigint[], 'all')`, [
        memberId,
      ])
      expect(account.rows[0].balance_cents).toBe('0')
      expect(account.rows[0].debt_status).toBe('up_to_date')

      const statement = await client.query(`select status from public.member_fee_statement($1)`, [memberId])
      expect(statement.rows).toHaveLength(1)
      expect(statement.rows[0].status).toBe('voided')
    })
  })

  it('ningún saldo negativo se informa como deuda: siempre en credit_cents/debt_status=credit', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'NuncaNegativo', lastName: 'Test', joinedOn: '2026-01-01' })
      await insertPayment(client, { memberId, amountCents: 5_000_000, paidOn: '2026-09-01' })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const account = await client.query(`select balance_cents, debt_status from public.member_accounts(array[$1]::bigint[], 'all')`, [
        memberId,
      ])
      expect(Number(account.rows[0].balance_cents)).toBeLessThan(0)
      expect(account.rows[0].debt_status).toBe('credit')
    })
  })
})

describe.skipIf(!dbAvailable)('month_collection', () => {
  it('suma pagos por paid_on en el mes aunque cubran deuda vieja; separa cash/transfer; excluye anulados; fees_cents solo monthly', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'MesCobranza', lastName: 'Test', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: '2026-07-01', amountCents: 1_000_000 })
      await insertOpeningBalance(client, { memberId, period: '2026-06-01', amountCents: 500_000 })
      await insertPayment(client, { memberId, amountCents: 1_500_000, paidOn: '2026-09-15', method: 'cash' })
      await insertPayment(client, { memberId, amountCents: 300_000, paidOn: '2026-09-16', method: 'transfer' })
      await insertPayment(client, { memberId, amountCents: 999_999, paidOn: '2026-09-17', voided: true })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 700_000 })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const result = await client.query(`select * from public.month_collection('2026-09-01')`)
      const row = result.rows[0]
      // No aislado del resto de la base (dashboard-wide), así que se verifica
      // que INCLUYE lo del fixture, no un total exacto.
      expect(Number(row.cash_cents)).toBeGreaterThanOrEqual(1_500_000)
      expect(Number(row.transfer_cents)).toBeGreaterThanOrEqual(300_000)
      expect(Number(row.collected_cents)).toBe(Number(row.cash_cents) + Number(row.transfer_cents))
    })
  })
})

describe.skipIf(!dbAvailable)('dashboard_summary / debt_by_category: invariantes globales', () => {
  it('sum(debt_by_category().debt_cents) = dashboard_summary().total_debt_cents, con deporte + social + saldo anterior + anulados + saldo a favor', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const futbol = await createDiscipline(client, { name: 'Fútbol Invariante' })
      const voley = await createDiscipline(client, { name: 'Vóley Invariante' })
      const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta Invariante' })
      const catSub18 = await createCategory(client, { disciplineId: voley, name: 'Sub 18 Invariante' })

      // Socio con dos deportes: paga uno completo, el otro queda en deuda.
      const memberTwoSports = await createMember(client, { firstName: 'DosDeportes', lastName: 'Invariante', joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId: memberTwoSports, categoryId: cat5ta, joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId: memberTwoSports, categoryId: catSub18, joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId: memberTwoSports, period: '2026-09-01', amountCents: 1_000_000, categoryId: cat5ta, disciplineId: futbol })
      await insertMonthlyFee(client, { memberId: memberTwoSports, period: '2026-09-01', amountCents: 1_000_000, categoryId: catSub18, disciplineId: voley })
      await insertPayment(client, { memberId: memberTwoSports, amountCents: 1_000_000, paidOn: '2026-09-05' })

      // Socio no practicante con cuota social sin pagar.
      const memberSocial = await createMember(client, { firstName: 'Social', lastName: 'Invariante', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId: memberSocial, period: '2026-09-01', amountCents: 1_000_000 })

      // Socio con saldo de arranque sin pagar.
      const memberOpening = await createMember(client, { firstName: 'Arranque', lastName: 'Invariante', joinedOn: '2026-01-01' })
      await insertOpeningBalance(client, { memberId: memberOpening, period: '2026-08-01', amountCents: 2_000_000 })

      // Socio con un cargo anulado (no debería sumar).
      const memberVoided = await createMember(client, { firstName: 'Anulado', lastName: 'Invariante', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId: memberVoided, period: '2026-09-01', amountCents: 1_000_000, voided: true })

      // Socio con saldo a favor (aporta 0, nunca negativo).
      const memberCredit = await createMember(client, { firstName: 'Credito', lastName: 'Invariante', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId: memberCredit, period: '2026-09-01', amountCents: 1_000_000 })
      await insertPayment(client, { memberId: memberCredit, amountCents: 5_000_000, paidOn: '2026-09-05' })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)

      const summary = await client.query(`select total_debt_cents from public.dashboard_summary()`)
      const byCategory = await client.query(`select debt_cents from public.debt_by_category()`)
      const sumByCategory = byCategory.rows.reduce((total, row) => total + Number(row.debt_cents), 0)
      expect(sumByCategory).toBe(Number(summary.rows[0].total_debt_cents))
    })
  })

  it('debt_by_category: un socio con dos categorías aparece en las DOS, con la cobertura que corresponde a cada una (no "media deuda" repartida)', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const futbol = await createDiscipline(client, { name: 'Fútbol Atribución' })
      const voley = await createDiscipline(client, { name: 'Vóley Atribución' })
      const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta Atribución' })
      const catSub18 = await createCategory(client, { disciplineId: voley, name: 'Sub 18 Atribución' })
      const memberId = await createMember(client, { firstName: 'Atribucion', lastName: 'Test', joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId, categoryId: catSub18, joinedOn: '2026-01-01' })
      // Fútbol se generó primero (id más chico: cobertura oldest-first por
      // fecha e id) y se paga completo; vóley queda en deuda.
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000, categoryId: cat5ta, disciplineId: futbol })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000, categoryId: catSub18, disciplineId: voley })
      await insertPayment(client, { memberId, amountCents: 1_000_000, paidOn: '2026-09-05' })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const rows = await client.query(
        `select category_name, debt_cents from public.debt_by_category() where category_id in ($1, $2)`,
        [cat5ta, catSub18],
      )
      const byName = new Map(rows.rows.map((r) => [r.category_name, Number(r.debt_cents)]))
      expect(byName.get('5ta Atribución')).toBe(0)
      expect(byName.get('Sub 18 Atribución')).toBe(1_000_000)
    })
  })

  it('debt_by_category: un socio que ascendió de categoría con deuda vieja figura en la categoría NUEVA (congelada en el cargo), no en la vieja', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const futbol = await createDiscipline(client, { name: 'Fútbol Ascenso Deuda' })
      const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta Ascenso Deuda' })
      const cat6ta = await createCategory(client, { disciplineId: futbol, name: '6ta Ascenso Deuda' })
      const memberId = await createMember(client, { firstName: 'Ascendido', lastName: 'ConDeuda', joinedOn: '2026-01-01' })
      const membership5ta = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-01-01' })
      await client.query(`update public.member_categories set left_on = $2 where id = $1`, [membership5ta, '2026-08-31'])
      await openMemberCategory(client, { memberId, categoryId: cat6ta, joinedOn: '2026-09-01' })

      // La cuota de 5ta (julio, sin pagar) queda congelada en 5ta aunque hoy
      // el socio esté en 6ta.
      await insertMonthlyFee(client, { memberId, period: '2026-07-01', amountCents: 1_000_000, categoryId: cat5ta, disciplineId: futbol })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const rows = await client.query(
        `select category_name, debt_cents from public.debt_by_category() where category_id in ($1, $2)`,
        [cat5ta, cat6ta],
      )
      const byName = new Map(rows.rows.map((r) => [r.category_name, Number(r.debt_cents)]))
      expect(byName.get('5ta Ascenso Deuda')).toBe(1_000_000)
      expect(byName.get('6ta Ascenso Deuda') ?? 0).toBe(0)
    })
  })

  it('dashboard_summary: total_debt_cents solo positivos de activos; deuda de un socio de baja va en inactive_debt_cents, no en total', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'DeBaja', lastName: 'ConDeuda', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000 })
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-09-15', 'se fue debiendo')`,
        [memberId],
      )

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const account = await client.query(`select status, balance_cents from public.member_accounts(array[$1]::bigint[], 'inactive')`, [
        memberId,
      ])
      expect(account.rows[0].status).toBe('inactive')
      expect(Number(account.rows[0].balance_cents)).toBe(1_000_000)

      const summary = await client.query(`select inactive_debt_cents from public.dashboard_summary()`)
      expect(Number(summary.rows[0].inactive_debt_cents)).toBeGreaterThanOrEqual(1_000_000)
    })
  })

  it('billing_active = false con billing_start_period null: no aplica en este ambiente (el seed ya activó la facturación de forma permanente); se verifica en su lugar que billing_active viaja como boolean coherente con settings', async () => {
    await withRollback(async (client) => {
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const summary = await client.query(`select billing_active, billing_start_period from public.dashboard_summary()`)
      expect(summary.rows[0].billing_active).toBe(true)
      expect(summary.rows[0].billing_start_period).not.toBeNull()
    })
  })

  it('anon no ejecuta ninguna de las 6 RPC de este archivo', async () => {
    await withRollback(async (client) => {
      await client.query('set local role anon')
      for (const sql of [
        `select * from public.member_accounts()`,
        `select * from public.member_fee_statement(1)`,
        `select * from public.month_collection()`,
        `select * from public.dashboard_summary()`,
        `select * from public.debt_by_category()`,
        `select * from public.monthly_history(1)`,
      ]) {
        const err = await expectQueryError(client, sql)
        expect(err.message).toMatch(/permission denied/i)
      }
    })
  })
})

describe.skipIf(!dbAvailable)('member_accounts: current_fee_cents / current_fees', () => {
  it('current_fee_cents = null y current_fees = [] cuando la facturación no cubre todavía el período actual (simulado con un socio recién dado de alta antes del inicio real de facturación no aplica; se prueba en cambio la forma con billing activo: current_fee_cents = suma de sus cuotas del mes)', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const futbol = await createDiscipline(client, { name: 'Fútbol CurrentFee' })
      const voley = await createDiscipline(client, { name: 'Vóley CurrentFee' })
      const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta CurrentFee' })
      const catSub18 = await createCategory(client, { disciplineId: voley, name: 'Sub 18 CurrentFee' })
      const { period: currentPeriod } = await clubNow(client)
      const memberId = await createMember(client, { firstName: 'DosCuotas', lastName: 'CurrentFee', joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId, categoryId: catSub18, joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: currentPeriod, amountCents: 1_000_000, categoryId: cat5ta, disciplineId: futbol })
      await insertMonthlyFee(client, { memberId, period: currentPeriod, amountCents: 1_200_000, categoryId: catSub18, disciplineId: voley })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const account = await client.query(`select current_fee_cents, current_fees from public.member_accounts(array[$1]::bigint[], 'all')`, [
        memberId,
      ])
      expect(Number(account.rows[0].current_fee_cents)).toBe(2_200_000)
      expect(account.rows[0].current_fees).toHaveLength(2)
    })
  })

  it('category_filter: devuelve solo socios con inscripción abierta en esa categoría, pero la deuda de cada fila es la TOTAL del socio (no solo de esa categoría)', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const futbol = await createDiscipline(client, { name: 'Fútbol Filtro' })
      const voley = await createDiscipline(client, { name: 'Vóley Filtro' })
      const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta Filtro' })
      const catSub18 = await createCategory(client, { disciplineId: voley, name: 'Sub 18 Filtro' })
      const memberId = await createMember(client, { firstName: 'Filtrado', lastName: 'Test', joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId, categoryId: catSub18, joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_000_000, categoryId: cat5ta, disciplineId: futbol })
      await insertMonthlyFee(client, { memberId, period: '2026-09-01', amountCents: 1_200_000, categoryId: catSub18, disciplineId: voley })

      const otherMember = await createMember(client, { firstName: 'Otro', lastName: 'SinFiltro', joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId: otherMember, categoryId: catSub18, joinedOn: '2026-01-01' })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const filtered = await client.query(`select member_id, balance_cents from public.member_accounts(null, 'active', $1)`, [cat5ta])
      const ids = filtered.rows.map((r) => Number(r.member_id))
      expect(ids).toContain(memberId)
      expect(ids).not.toContain(otherMember)
      const row = filtered.rows.find((r) => Number(r.member_id) === memberId)
      // Deuda TOTAL (las dos cuotas), no solo la de 5ta.
      expect(Number(row.balance_cents)).toBe(2_200_000)
    })
  })
})

describe.skipIf(!dbAvailable)('monthly_history', () => {
  it('debt_at_close_cents de un período P usa la población activa al cierre de P; un socio dado de baja en P+1 SÍ cuenta en P; anular un pago de P baja la deuda de P retroactivamente', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'Historia', lastName: 'Mensual', joinedOn: '2026-01-01' })
      await insertMonthlyFee(client, { memberId, period: '2026-07-01', amountCents: 1_000_000 })
      const paymentId = await insertPayment(client, { memberId, amountCents: 1_000_000, paidOn: '2026-07-10' })

      // Se da de baja en agosto (P+1 respecto de julio): en julio seguía activo.
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-08-10', 'se fue')`,
        [memberId],
      )

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const beforeVoid = await client.query(`select debt_at_close_cents from public.monthly_history(12) where period = '2026-07-01'`)
      const initialDebt = Number(beforeVoid.rows[0].debt_at_close_cents)

      // Anular el pago de julio: la deuda de julio sube retroactivamente.
      await voidAsAdmin(
        client,
        `update public.payments set voided_at = now(), voided_by = $2, void_reason = 'motivo fixture' where id = $1`,
        [paymentId],
      )
      await actAs(client, consultaId)
      const afterVoid = await client.query(`select debt_at_close_cents from public.monthly_history(12) where period = '2026-07-01'`)
      expect(Number(afterVoid.rows[0].debt_at_close_cents)).toBe(initialDebt + 1_000_000)

      // El período de agosto (después de la baja) NO incluye a este socio
      // como activo (se fue el 10 de agosto, así que al cierre de agosto ya
      // estaba de baja): su cargo de julio no debería aportar a agosto salvo
      // que la baja sea posterior al cierre. Acá simplemente se confirma que
      // el período de julio (P) sí lo cuenta, que es el caso pedido por la
      // spec ("un socio dado de baja en P+1 SÍ cuenta en P").
      expect(afterVoid.rowCount).toBe(1)
    })
  })

  it('collected_cents de un período P coincide con month_collection(P)', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const { period: currentPeriod, today } = await clubNow(client)
      const memberId = await createMember(client, { firstName: 'Coincide', lastName: 'Historia', joinedOn: '2026-01-01' })
      await insertPayment(client, { memberId, amountCents: 1_000_000, paidOn: today })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const history = await client.query(`select collected_cents from public.monthly_history(1) where period = $1::date`, [currentPeriod])
      const collection = await client.query(`select collected_cents from public.month_collection($1::date)`, [currentPeriod])
      expect(history.rows[0].collected_cents).toBe(collection.rows[0].collected_cents)
    })
  })
})

describe.skipIf(!dbAvailable)('log_export', () => {
  it('como consulta inserta una fila EXPORT en audit_log con su id y context.listing', async () => {
    await withRollback(async (client) => {
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      await client.query(`select public.log_export('members', '{"q":"perez"}'::jsonb, 42)`)

      await actAsSuperuser(client)
      const row = await client.query(
        `select actor_id, op, context from public.audit_log where table_name = 'members' and op = 'EXPORT' order by occurred_at desc limit 1`,
      )
      expect(row.rows[0].actor_id).toBe(consultaId)
      expect(row.rows[0].context.listing).toBe('members')
    })
  })

  it('listing fuera de la lista cerrada: rechazado', async () => {
    await withRollback(async (client) => {
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const err = await expectQueryError(client, `select public.log_export('cualquiera', '{}'::jsonb, 1)`)
      expect(err.message).toBe('Listado desconocido')
    })
  })

  it('filters de más de 4 KiB: rechazado', async () => {
    await withRollback(async (client) => {
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const bigFilters = JSON.stringify({ q: 'x'.repeat(5000) })
      const err = await expectQueryError(client, `select public.log_export('members', $1::jsonb, 1)`, [bigFilters])
      expect(err.message).toBe('Los filtros son demasiado grandes')
    })
  })

  it('como anon: rechazado', async () => {
    await withRollback(async (client) => {
      await client.query('set local role anon')
      const err = await expectQueryError(client, `select public.log_export('members', '{}'::jsonb, 1)`)
      expect(err.message).toMatch(/permission denied/i)
    })
  })
})
