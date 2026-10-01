import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actAs,
  actAsSuperuser,
  createAuthUser,
  createCategory,
  createDiscipline,
  createMember,
  createUserWithRole,
  expectQueryError,
  isDbAvailable,
  withRollback,
} from './helpers'

/**
 * Contrato entre la base REAL y los `translate*Error` de los modelos.
 *
 * Los modelos reconocen los CHECK/FK declarativos por el NOMBRE autogenerado
 * de la constraint (`members_dni_check`, ...). Si el nombre real es otro, el
 * `includes()` no matchea, el error se relanza crudo y el usuario ve un
 * genérico en vez de "El DNI tiene que tener 7 u 8 dígitos" bajo el campo.
 * Un mock no lo atrapa: acá se provoca la violación con el rol `admin` de
 * verdad (el mismo camino que PostgREST), se toma el error TAL CUAL lo
 * devuelve Postgres y se lo pasa por el modelo real.
 *
 * Todo dentro de BEGIN/ROLLBACK (helpers): no queda nada, ni en `audit_log`.
 */
const dbAvailable = await isDbAvailable()

// Cliente de Supabase falso que devuelve `error` en cualquier cadena que
// pase por una escritura (insert/update/rpc/upsert) y `{ data: null, error:
// null }` en las lecturas previas (p. ej. el chequeo de DNI de createMember).
let injectedError: unknown = null
const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'rpc'])

function node(isWrite: boolean): unknown {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: isWrite ? injectedError : null })
      }
      return () => node(isWrite || (typeof prop === 'string' && WRITE_METHODS.has(prop)))
    },
  })
}

// El cliente raíz NO puede ser el Proxy thenable: `await createClient()` lo
// resolvería como una promesa. Se expone un objeto plano con los puntos de entrada.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => node(false),
    rpc: () => node(true),
  }),
}))

type PgError = { message: string; code?: string }

/** Lo que PostgREST le entrega a supabase-js: code + message de Postgres, tal cual. */
function asPostgrestError(err: PgError) {
  return { code: err.code, message: err.message, details: '', hint: '' }
}

type Fixture = {
  client: Parameters<Parameters<typeof withRollback>[0]>[0]
  adminId: string
  memberId: number
}

/** Prepara admin + socio como superusuario y devuelve el cliente ya actuando como admin. */
async function asAdmin(client: Fixture['client']): Promise<Fixture> {
  const { userId } = await createUserWithRole(client, 'admin')
  await actAs(client, userId)
  const memberId = await createMember(client, { firstName: 'Fixture', lastName: 'Inventado' })
  return { client, adminId: userId, memberId }
}

/** Provoca `sql` en la base real y devuelve el error de Postgres. */
async function provoke(client: Fixture['client'], sql: string, params: unknown[] = []): Promise<PgError> {
  return expectQueryError(client, sql, params)
}

async function translated(err: PgError, run: () => Promise<unknown>) {
  injectedError = asPostgrestError(err)
  const { DomainError } = await import('@/lib/errors')
  const thrown = await run().then(
    () => {
      throw new Error('el modelo no lanzó')
    },
    (e) => e,
  )
  return { thrown, DomainError }
}

const NOT_RAW = /violates (check|foreign key|unique) constraint|new row for relation|null value in column/i

beforeEach(() => {
  injectedError = null
})

describe.skipIf(!dbAvailable)('members: CHECK/FK declarativos -> DomainError con field', () => {
  const baseInsert = (col: string, val: unknown) =>
    `insert into public.members (first_name, last_name, joined_on, ${col}) values ('Ana', 'Inventada', '2026-01-01', $1)`

  const cases: Array<{ name: string; sql: string; params: unknown[]; constraint: string; field: string; message: string }> = [
    {
      name: 'dni con menos de 7 dígitos',
      sql: baseInsert('dni', null),
      params: ['123'],
      constraint: 'members_dni_check',
      field: 'dni',
      message: 'El DNI tiene que tener 7 u 8 dígitos',
    },
    {
      name: 'dni con letras',
      sql: baseInsert('dni', null),
      params: ['12ab5678'],
      constraint: 'members_dni_check',
      field: 'dni',
      message: 'El DNI tiene que tener 7 u 8 dígitos',
    },
    {
      // La base solo exige minúsculas (el formato lo valida Zod): es lo que puede violar PostgREST directo.
      name: 'email con mayúsculas',
      sql: baseInsert('email', null),
      params: ['Mayus@Lonqui.Test'],
      constraint: 'members_email_check',
      field: 'email',
      message: 'El email no es válido',
    },
    {
      name: 'grupo familiar inexistente',
      sql: baseInsert('family_group_id', null),
      params: [999_999_999],
      constraint: 'members_family_group_id_fkey',
      field: 'familyGroupId',
      message: 'Ese grupo familiar no existe',
    },
  ]

  for (const c of cases) {
    it(`createMember: ${c.name} (${c.constraint})`, async () => {
      await withRollback(async (client) => {
        await asAdmin(client)
        const err = await provoke(client, c.sql, c.params)
        // El nombre real de la constraint es el que el modelo busca.
        expect(err.message).toContain(c.constraint)

        const { createMember: createMemberModel } = await import('@/models/members.model')
        const { thrown, DomainError } = await translated(err, () =>
          createMemberModel({ firstName: 'Ana', lastName: 'Inventada', joinedOn: '2026-01-01', categoryIds: [] } as never),
        )
        expect(thrown).toBeInstanceOf(DomainError)
        expect(thrown.field).toBe(c.field)
        expect(thrown.message).toBe(c.message)
        expect(thrown.message).not.toMatch(NOT_RAW)
      })
    })
  }

  for (const [col, field, message] of [
    ['first_name', 'firstName', 'El nombre es obligatorio'],
    ['last_name', 'lastName', 'El apellido es obligatorio'],
  ] as const) {
    it(`${col} vacío o de solo espacios -> members_${col}_check -> field ${field}`, async () => {
      await withRollback(async (client) => {
        await asAdmin(client)
        const other = col === 'first_name' ? 'last_name' : 'first_name'
        for (const blank of ['', '   ']) {
          const err = await provoke(
            client,
            `insert into public.members (${col}, ${other}, joined_on) values ($1, 'Inventado', '2026-01-01')`,
            [blank],
          )
          expect(err.message).toContain(`members_${col}_check`)

          const { createMember: createMemberModel } = await import('@/models/members.model')
          const { thrown, DomainError } = await translated(err, () =>
            createMemberModel({ firstName: 'x', lastName: 'y', joinedOn: '2026-01-01', categoryIds: [] } as never),
          )
          expect(thrown).toBeInstanceOf(DomainError)
          expect(thrown.field).toBe(field)
          expect(thrown.message).toBe(message)
        }
      })
    })
  }

  it('updateMember: el mismo CHECK de DNI llega traducido desde el UPDATE', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      const err = await provoke(client, `update public.members set dni = '12' where id = $1`, [memberId])
      expect(err.message).toContain('members_dni_check')

      const { updateMember } = await import('@/models/members.model')
      const { thrown, DomainError } = await translated(err, () => updateMember(memberId, { dni: '12' } as never))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('dni')
    })
  })
})

describe.skipIf(!dbAvailable)('baja/reactivación: motivo corto', () => {
  it('member_status_events_reason_check: motivo de 2 caracteres -> field reason', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      const err = await provoke(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason)
         values ($1, 'withdrawal', '2026-02-01', 'ab')`,
        [memberId],
      )
      expect(err.code).toBe('23514')
      expect(err.message).toContain('member_status_events_reason_check')

      const { insertStatusEvent } = await import('@/models/members.model')
      const { thrown, DomainError } = await translated(err, () =>
        insertStatusEvent({ memberId, eventType: 'withdrawal', effectiveOn: '2026-02-01', reason: 'ab' } as never),
      )
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('reason')
      expect(thrown.message).toBe('El motivo tiene que tener al menos 3 caracteres')
    })
  })
})

describe.skipIf(!dbAvailable)('fee_prices: CHECK declarativos -> DomainError', () => {
  const cases: Array<{ name: string; sql: string; constraintOrMessage: RegExp; field: string; amount?: number }> = [
    {
      name: 'monto negativo',
      sql: `insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', -1, '2099-01-01')`,
      constraintOrMessage: /fee_prices_amount_cents_check/,
      field: 'amountCents',
    },
    {
      name: 'valid_from que no es día 1',
      sql: `insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 1000, '2099-01-15')`,
      constraintOrMessage: /fee_prices_valid_from_check/,
      field: 'validFrom',
    },
    {
      name: 'default con tipo de socio (scope_shape)',
      sql: `insert into public.fee_prices (scope, member_type, amount_cents, valid_from) values ('default', 'practicing', 1000, '2099-01-01')`,
      constraintOrMessage: /fee_prices_scope_shape/,
      field: 'scope',
    },
  ]

  for (const c of cases) {
    it(`createFeePrice: ${c.name}`, async () => {
      await withRollback(async (client) => {
        await asAdmin(client)
        const err = await provoke(client, c.sql)
        expect(err.code).toBe('23514')
        expect(err.message).toMatch(c.constraintOrMessage)

        const { createFeePrice } = await import('@/models/fee-prices.model')
        const { thrown, DomainError } = await translated(err, () =>
          createFeePrice({ scope: 'default', amountCents: 1000, validFrom: '2099-01-01' } as never),
        )
        expect(thrown).toBeInstanceOf(DomainError)
        expect(thrown.field).toBe(c.field)
        expect(thrown.message).not.toMatch(NOT_RAW)
      })
    })
  }

  it('categoría inexistente (FK) -> field categoryId', async () => {
    await withRollback(async (client) => {
      await asAdmin(client)
      const err = await provoke(
        client,
        `insert into public.fee_prices (scope, category_id, amount_cents, valid_from) values ('category', 999999999, 1000, '2099-01-01')`,
      )
      expect(err.code).toBe('23503')
      const { createFeePrice } = await import('@/models/fee-prices.model')
      const { thrown, DomainError } = await translated(err, () =>
        createFeePrice({ scope: 'category', categoryId: 999999999, amountCents: 1000, validFrom: '2099-01-01' } as never),
      )
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('categoryId')
    })
  })

  it('valor duplicado para el mismo alcance y mes (23505) -> field validFrom', async () => {
    await withRollback(async (client) => {
      await asAdmin(client)
      const sql = `insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 1000, '2099-01-01')`
      await client.query(sql)
      const err = await provoke(client, sql)
      expect(err.code).toBe('23505')
      const { createFeePrice } = await import('@/models/fee-prices.model')
      const { thrown } = await translated(err, () =>
        createFeePrice({ scope: 'default', amountCents: 1000, validFrom: '2099-01-01' } as never),
      )
      expect(thrown.field).toBe('validFrom')
    })
  })
})

describe.skipIf(!dbAvailable)('payments: CHECK, trigger de fecha y FK -> DomainError', () => {
  const insertPayment = (amount: number, paidOn: string, memberExpr = '$1') =>
    `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id)
     values (${memberExpr}, ${amount}, '${paidOn}', 'cash', gen_random_uuid())`

  async function register(memberId: number, over: Record<string, unknown> = {}) {
    const { registerPayment } = await import('@/models/payments.model')
    return registerPayment({
      batchId: randomUUID(),
      paidOn: '2026-01-15',
      method: 'cash',
      items: [{ memberId, amountCents: 1000 }],
      ...over,
    } as never)
  }

  it('monto 0 -> payments_amount_cents_check -> field amountCents', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      const err = await provoke(client, insertPayment(0, '2026-01-15'), [memberId])
      expect(err.message).toContain('payments_amount_cents_check')
      const { thrown, DomainError } = await translated(err, () => register(memberId))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('amountCents')
      expect(thrown.message).toBe('El monto tiene que ser mayor a cero')
    })
  })

  it('payments_paid_on_guard: pago antes de 2020 -> field paidOn, mensaje legible', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      // Un día antes del piso y el 31/12/2019 a mitad de camino: la frontera.
      const err = await provoke(client, insertPayment(1000, '2019-12-31'), [memberId])
      expect(err.code).toBe('23514')
      const { thrown, DomainError } = await translated(err, () => register(memberId, { paidOn: '2019-12-31' }))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('paidOn')
      expect(thrown.message).not.toMatch(NOT_RAW)
    })
  })

  it('payments_paid_on_guard: el 2020-01-01 exacto SÍ entra (frontera inclusiva)', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      await expect(client.query(insertPayment(1000, '2020-01-01'), [memberId])).resolves.toBeDefined()
    })
  })

  it('pago con fecha futura -> field paidOn', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      const err = await provoke(client, insertPayment(1000, '2099-01-01'), [memberId])
      expect(err.code).toBe('23514')
      const { thrown, DomainError } = await translated(err, () => register(memberId, { paidOn: '2099-01-01' }))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('paidOn')
    })
  })

  it('socio inexistente (FK) -> field memberId', async () => {
    await withRollback(async (client) => {
      await asAdmin(client)
      const err = await provoke(client, insertPayment(1000, '2026-01-15', '999999999'))
      expect(err.code).toBe('23503')
      const { thrown, DomainError } = await translated(err, () => register(999_999_999))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('memberId')
      expect(thrown.message).not.toMatch(NOT_RAW)
    })
  })

  it('anular con motivo corto: nunca sale texto crudo de Postgres', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      const { rows } = await client.query<{ id: string }>(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id)
         values ($1, 1000, '2026-01-15', 'cash', gen_random_uuid()) returning id`,
        [memberId],
      )
      const err = await provoke(client, `update public.payments set void_reason = 'ab' where id = $1`, [rows[0].id])
      expect(err.message).toContain('payments_void_triad')
      const { voidPayment } = await import('@/models/payments.model')
      const { thrown, DomainError } = await translated(err, () => voidPayment(Number(rows[0].id), 'ab'))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('reason')
      expect(thrown.message).not.toMatch(NOT_RAW)
    })
  })
})

describe.skipIf(!dbAvailable)('fees: saldo de arranque y anulación -> DomainError', () => {
  it('anular un cargo con motivo corto: DomainError con field reason', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      await actAsSuperuser(client)
      const { rows } = await client.query<{ id: string }>(
        `insert into public.fees (member_id, period, kind, amount_cents) values ($1, '2026-01-01', 'monthly', 1000) returning id`,
        [memberId],
      )
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const err = await provoke(client, `update public.fees set void_reason = 'ab' where id = $1`, [rows[0].id])
      expect(err.code).toBe('23514')
      const { voidFee } = await import('@/models/fees.model')
      const { thrown, DomainError } = await translated(err, () => voidFee(Number(rows[0].id), 'ab'))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('reason')
      expect(thrown.message).not.toMatch(NOT_RAW)
    })
  })

  it('fees_amount_cents_check: monto negativo -> field amountCents (saldo de arranque)', async () => {
    await withRollback(async (client) => {
      const { memberId } = await asAdmin(client)
      await actAsSuperuser(client)
      const err = await provoke(
        client,
        `insert into public.fees (member_id, period, kind, amount_cents) values ($1, '2026-01-01', 'opening_balance', -5)`,
        [memberId],
      )
      expect(err.code).toBe('23514')
      const { createOpeningBalance } = await import('@/models/fees.model')
      const { thrown, DomainError } = await translated(err, () =>
        createOpeningBalance({ memberId, amountCents: 100 } as never),
      )
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('amountCents')
      expect(thrown.message).not.toMatch(NOT_RAW)
    })
  })
})

describe.skipIf(!dbAvailable)('app_users: CHECK declarativos -> DomainError', () => {
  async function newAuthUser(client: Fixture['client']) {
    await actAsSuperuser(client)
    const id = randomUUID()
    await createAuthUser(client, { id, email: `x-${id.slice(0, 8)}@lonqui.test` })
    return id
  }

  it('nombre de 1 caracter (app_users_display_name_check) -> field displayName', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const target = await newAuthUser(client)
      await actAs(client, adminId)
      const err = await provoke(
        client,
        `insert into public.app_users (user_id, email, display_name, role, created_by) values ($1, $2, 'a', 'consulta', $3)`,
        [target, 'ok@lonqui.test', adminId],
      )
      expect(err.message).toContain('app_users_display_name_check')
      const { upsertAppUser } = await import('@/models/app-users.model')
      const { thrown, DomainError } = await translated(err, () =>
        upsertAppUser({ userId: target, email: 'ok@lonqui.test', displayName: 'a', role: 'consulta', createdBy: adminId }),
      )
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('displayName')
    })
  })

  it('rol inventado (app_users_role_check) -> field role', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const target = await newAuthUser(client)
      await actAs(client, adminId)
      const err = await provoke(
        client,
        `insert into public.app_users (user_id, email, display_name, role, created_by) values ($1, $2, 'Alguien', 'superadmin', $3)`,
        [target, 'ok2@lonqui.test', adminId],
      )
      expect(err.message).toContain('app_users_role_check')
      const { upsertAppUser } = await import('@/models/app-users.model')
      const { thrown, DomainError } = await translated(err, () =>
        upsertAppUser({ userId: target, email: 'ok2@lonqui.test', displayName: 'Alguien', role: 'consulta', createdBy: adminId }),
      )
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('role')
    })
  })

  it('email con mayúsculas (app_users_email_check) -> field email', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const target = await newAuthUser(client)
      await actAs(client, adminId)
      const err = await provoke(
        client,
        `insert into public.app_users (user_id, email, display_name, role, created_by) values ($1, 'MAYUS@lonqui.test', 'Alguien', 'consulta', $2)`,
        [target, adminId],
      )
      expect(err.message).toContain('app_users_email_check')
      const { upsertAppUser } = await import('@/models/app-users.model')
      const { thrown, DomainError } = await translated(err, () =>
        upsertAppUser({ userId: target, email: 'MAYUS@lonqui.test', displayName: 'Alguien', role: 'consulta', createdBy: adminId }),
      )
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('email')
    })
  })
})

describe.skipIf(!dbAvailable)('catálogos: nombre corto y FK de disciplina -> DomainError', () => {
  it('disciplines_name_check: nombre de 1 caracter -> field name', async () => {
    await withRollback(async (client) => {
      await asAdmin(client)
      const err = await provoke(client, `insert into public.disciplines (name) values ('a')`)
      expect(err.code).toBe('23514')
      expect(err.message).toMatch(/_name_check/)
      const { createDiscipline: createDisciplineModel } = await import('@/models/catalogs.model')
      const { thrown, DomainError } = await translated(err, () => createDisciplineModel({ name: 'a' } as never))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('name')
    })
  })

  it('categories_name_check: nombre de 1 caracter -> field name', async () => {
    await withRollback(async (client) => {
      await asAdmin(client)
      const disciplineId = await createDiscipline(client, { name: 'Disciplina Inventada' })
      const err = await provoke(client, `insert into public.categories (discipline_id, name) values ($1, 'a')`, [disciplineId])
      expect(err.code).toBe('23514')
      expect(err.message).toMatch(/_name_check/)
      const { updateCategory } = await import('@/models/catalogs.model')
      const categoryId = await createCategory(client, { disciplineId, name: 'Categoria Inventada' })
      const { thrown, DomainError } = await translated(err, () => updateCategory(categoryId, { name: 'a' } as never))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('name')
    })
  })

  it('categoría en una disciplina inexistente (FK) -> field disciplineId', async () => {
    await withRollback(async (client) => {
      await asAdmin(client)
      const err = await provoke(client, `insert into public.categories (discipline_id, name) values (999999999, 'Inventada')`)
      expect(err.code).toBe('23503')
      const { createCategory: createCategoryModel } = await import('@/models/catalogs.model')
      const { thrown, DomainError } = await translated(err, () =>
        createCategoryModel({ disciplineId: 999999999, name: 'Inventada' } as never),
      )
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('disciplineId')
    })
  })
})

describe.skipIf(!dbAvailable)('settings: mes de inicio de facturación', () => {
  it('billing_start_period que no es día 1 -> DomainError con field startPeriod', async () => {
    await withRollback(async (client) => {
      await asAdmin(client)
      const err = await provoke(client, `update public.settings set billing_start_period = '2099-01-15' where id = 1`)
      expect(err.code).toBe('23514')
      const { activateBilling } = await import('@/models/billing.model')
      const { thrown, DomainError } = await translated(err, () => activateBilling('2099-01-15'))
      expect(thrown).toBeInstanceOf(DomainError)
      expect(thrown.field).toBe('startPeriod')
      expect(thrown.message).not.toMatch(NOT_RAW)
    })
  })

  it('la constraint real se llama settings_billing_start_period_check (el modelo la busca por sufijo)', async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query(
        `select conname from pg_constraint where conrelid = 'public.settings'::regclass and contype = 'c'`,
      )
      expect(rows.map((r) => r.conname)).toContain('settings_billing_start_period_check')
    })
  })
})
