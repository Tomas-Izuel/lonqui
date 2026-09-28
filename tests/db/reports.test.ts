import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ClientBase } from 'pg'
import {
  actAs,
  actAsSuperuser,
  createMember,
  createUserWithRole,
  expectQueryError,
  isDbAvailable,
  withRollback,
} from './helpers'

/**
 * `public.daily_collection` (`20260928120000_daily_collection.sql`,
 * addendum de `01-tasks.md`, agregado de alcance 1): ritmo de cobranza del
 * mes para el área acumulada de `/cobranza`. Una fila por día, cortando en
 * `private.club_today()` en el mes en curso (los días que no pasaron no son
 * "cero cobrado": directamente no están), pero completa para un mes pasado.
 *
 * Los fixtures de "excluye anulados"/"acumulado" usan un mes bien viejo
 * (junio de 2021) para no chocar con los ~12 meses de datos de demo que trae
 * `seed-demo.sql` (`current_period - 11 months` hasta el mes actual): así se
 * puede afirmar un monto EXACTO en vez de "incluye al menos".
 */
const dbAvailable = await isDbAvailable()

/**
 * `pg` parsea las columnas `date` (OID 1082) como `Date` de JS, construido a
 * partir de los componentes año/mes/día en el huso horario LOCAL del proceso
 * (paquete `postgres-date`) — nunca en UTC. `.getDate()`/`.getMonth()`/
 * `.getFullYear()` (los getters locales, no los `UTC*`) son los que
 * reconstruyen el mismo día calendario sin importar en qué huso corra este
 * proceso de test.
 */
function localISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function insertPayment(
  client: ClientBase,
  input: { memberId: number; amountCents: number; paidOn: string; voided?: boolean },
): Promise<number> {
  const row = await client.query<{ id: number }>(
    `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, $2, $3, 'cash', $4) returning id`,
    [input.memberId, input.amountCents, input.paidOn, randomUUID()],
  )
  if (input.voided) {
    await actAsSuperuser(client)
    const { userId: adminId } = await createUserWithRole(client, 'admin')
    await actAs(client, adminId)
    await client.query(
      `update public.payments set voided_at = now(), voided_by = $2, void_reason = 'fixture anulado' where id = $1`,
      [row.rows[0].id, adminId],
    )
    await actAsSuperuser(client)
  }
  return row.rows[0].id
}

describe.skipIf(!dbAvailable)('public.daily_collection: permisos', () => {
  it('anon no puede ejecutar la función (sin EXECUTE, ni siquiera llega a chequear payments.read)', async () => {
    await withRollback(async (client) => {
      await client.query('set local role anon')
      const err = await expectQueryError(client, `select * from public.daily_collection()`)
      expect(err.message).toMatch(/permission denied/i)
    })
  })

  it('un rol con payments.read (los 3 roles hoy) sí puede ejecutarla', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      await expect(client.query(`select * from public.daily_collection()`)).resolves.toBeDefined()
    })
  })
})

describe.skipIf(!dbAvailable)('public.daily_collection: rango de días', () => {
  it('mes en curso: una fila por día desde el 1 hasta HOY (hora argentina), nunca más allá', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const today = await client.query<{ today: Date }>('select private.club_today() as today')
      const todayDate = today.rows[0].today
      const expectedDays = todayDate.getDate()
      const expectedFirstDay = `${localISODate(todayDate).slice(0, 8)}01`

      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      const result = await client.query<{ day: Date }>(`select day from public.daily_collection() order by day`)

      expect(result.rows).toHaveLength(expectedDays)
      expect(localISODate(result.rows[0].day)).toBe(expectedFirstDay)
      expect(localISODate(result.rows.at(-1)!.day)).toBe(localISODate(todayDate))
    })
  })

  it('mes pasado: el mes COMPLETO, aunque hoy ya haya pasado (junio de 2021 tiene 30 días)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      const result = await client.query<{ day: Date }>(
        `select day from public.daily_collection('2021-06-01') order by day`,
      )
      expect(result.rows).toHaveLength(30)
      expect(localISODate(result.rows[0].day)).toBe('2021-06-01')
      expect(localISODate(result.rows.at(-1)!.day)).toBe('2021-06-30')
    })
  })
})

describe.skipIf(!dbAvailable)('public.daily_collection: montos', () => {
  it('excluye pagos anulados del día (mes viejo, aislado del resto de la base)', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'RitmoDiario', lastName: 'Test', joinedOn: '2021-01-01' })
      await insertPayment(client, { memberId, amountCents: 500_000, paidOn: '2021-06-15' })
      await insertPayment(client, { memberId, amountCents: 9_999_000, paidOn: '2021-06-15', voided: true })

      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      const result = await client.query<{ collected_cents: string }>(
        `select collected_cents from public.daily_collection('2021-06-01') where day = '2021-06-15'`,
      )
      // Exacto: el monto anulado (casi 20x mayor) NO debería sumarse.
      expect(Number(result.rows[0].collected_cents)).toBe(500_000)
    })
  })

  it('días sin pagos aparecen en cero, no ausentes (la curva acumulada no puede tener huecos)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      const result = await client.query<{ day: string; collected_cents: string }>(
        `select day, collected_cents from public.daily_collection('2021-06-01') where day = '2021-06-02'`,
      )
      expect(result.rows).toHaveLength(1)
      expect(Number(result.rows[0].collected_cents)).toBe(0)
    })
  })

  it('cumulative_cents es EXACTAMENTE la suma corrida de collected_cents (nunca reconstruida en TS)', async () => {
    await withRollback(async (client) => {
      await actAsSuperuser(client)
      const memberId = await createMember(client, { firstName: 'Acumulado', lastName: 'Test', joinedOn: '2021-01-01' })
      await insertPayment(client, { memberId, amountCents: 111_100, paidOn: '2021-06-05' })
      await insertPayment(client, { memberId, amountCents: 222_200, paidOn: '2021-06-10' })
      await insertPayment(client, { memberId, amountCents: 333_300, paidOn: '2021-06-20' })

      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      const result = await client.query<{ day: string; collected_cents: string; cumulative_cents: string }>(
        `select day, collected_cents, cumulative_cents from public.daily_collection('2021-06-01') order by day`,
      )

      let runningSum = 0
      for (const row of result.rows) {
        runningSum += Number(row.collected_cents)
        expect(Number(row.cumulative_cents)).toBe(runningSum)
      }
      // El acumulado del último día del mes es la suma total de collected_cents.
      expect(Number(result.rows.at(-1)!.cumulative_cents)).toBe(111_100 + 222_200 + 333_300)
    })
  })
})
