import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `audit.model.ts`: `buildLabelDraft`/`finalizeLabel` (no exportadas) para
 * las CUATRO tablas nuevas del slice 2 (`payments`, `fees`, `fee_prices`,
 * `member_categories`) — pedido explícito de `02-development-backend-b2.md`
 * ("no hay un test de contenido de auditoría end-to-end en este pipeline
 * todavía"). Se ejercen a través de `getAuditPage` (la única función
 * exportada que las usa), mockeando el cliente de Supabase en el borde
 * externo con un builder encadenable genérico: cada tabla que consulta
 * (`audit_log`, `app_users`, `members`, `categories`, `disciplines`) devuelve
 * lo que el test necesita, sin implementar de verdad los filtros de
 * PostgREST (eso no es lo que este archivo prueba).
 */

type QueryResult<T> = { data: T[] | null; error: unknown }

/** Chain que ignora cualquier filtro (`eq`, `in`, `order`, `limit`, ...) y resuelve al `result` fijo cuando se hace `await`. */
function makeChain<T>(result: QueryResult<T>) {
  const chain: Record<string, unknown> = {}
  const pass = () => chain
  for (const method of ['select', 'eq', 'gte', 'lt', 'or', 'in', 'order', 'limit']) {
    chain[method] = pass
  }
  chain.then = (resolve: (value: QueryResult<T>) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

type Tables = {
  audit_log?: QueryResult<Record<string, unknown>>
  app_users?: QueryResult<{ user_id: string; display_name: string }>
  members?: QueryResult<{ id: number; first_name: string; last_name: string }>
  categories?: QueryResult<{ id: number; name: string }>
  disciplines?: QueryResult<{ id: number; name: string }>
  fees?: QueryResult<{ id: number; period: string; kind: string }>
  payments?: QueryResult<{ id: number; paid_on: string }>
}

function makeFakeClient(tables: Tables) {
  return {
    from: (table: string) => {
      const result = (tables as Record<string, QueryResult<unknown> | undefined>)[table]
      if (!result) throw new Error(`tabla inesperada en el fake client: ${table}`)
      return makeChain(result)
    },
  }
}

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const { getAuditPage } = await import('@/models/audit.model')

beforeEach(() => {
  createClientMock.mockReset()
})

/** Fila mínima de `audit_log` con las columnas `->>` que pide `LABEL_COLUMNS`, todas `null` salvo las que el test pisa. */
function auditRow(tableName: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    occurred_at: '2026-09-28T12:00:00Z',
    actor_id: null,
    actor_source: 'session',
    op: 'INSERT',
    table_name: tableName,
    record_id: '1',
    changed_fields: null,
    new_first_name: null,
    old_first_name: null,
    new_last_name: null,
    old_last_name: null,
    new_display_name: null,
    old_display_name: null,
    new_name: null,
    old_name: null,
    new_discipline_id: null,
    old_discipline_id: null,
    new_member_id: null,
    old_member_id: null,
    new_category_id: null,
    old_category_id: null,
    new_amount_cents: null,
    old_amount_cents: null,
    new_paid_on: null,
    old_paid_on: null,
    new_period: null,
    old_period: null,
    new_kind: null,
    old_kind: null,
    new_scope: null,
    old_scope: null,
    new_member_type: null,
    old_member_type: null,
    new_valid_from: null,
    old_valid_from: null,
    ...overrides,
  }
}

describe('audit.model.buildLabelDraft (vía getAuditPage): payments', () => {
  it('"Apellido, Nombre · $monto · fecha"', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: {
          data: [auditRow('payments', { new_member_id: '42', new_amount_cents: '150000', new_paid_on: '2026-09-15' })],
          error: null,
        },
        app_users: { data: [], error: null },
        members: { data: [{ id: 42, first_name: 'Ana', last_name: 'Test' }], error: null },
        categories: { data: [], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    const label = page.items[0].recordLabel
    expect(label).toContain('Test, Ana')
    expect(label).toContain('15/09/2026')
  })

  it('sin socio resuelto (no está en la página de members): label null, no un id crudo', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: { data: [auditRow('payments', { new_member_id: '999', new_amount_cents: '100000', new_paid_on: '2026-09-01' })], error: null },
        app_users: { data: [], error: null },
        members: { data: [], error: null },
        categories: { data: [], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toBeNull()
  })
})

describe('audit.model.buildLabelDraft (vía getAuditPage): fees', () => {
  it('opening_balance: "Apellido, Nombre · Saldo anterior al sistema" (sin monto ni período)', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: {
          data: [auditRow('fees', { new_member_id: '7', new_kind: 'opening_balance', new_period: '2026-08-01' })],
          error: null,
        },
        app_users: { data: [], error: null },
        members: { data: [{ id: 7, first_name: 'Bruno', last_name: 'Saldo' }], error: null },
        categories: { data: [], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toBe('Saldo, Bruno · Saldo anterior al sistema')
  })

  it('monthly con categoría: "Apellido, Nombre · Cuota <mes> · <categoría>"', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: {
          data: [
            auditRow('fees', { new_member_id: '8', new_kind: 'monthly', new_period: '2026-09-01', new_category_id: '5' }),
          ],
          error: null,
        },
        app_users: { data: [], error: null },
        members: { data: [{ id: 8, first_name: 'Carla', last_name: 'Cuota' }], error: null },
        categories: { data: [{ id: 5, name: '5ta' }], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toBe('Cuota, Carla · Cuota septiembre 2026 · 5ta')
  })

  it('monthly social (category_id null): "Apellido, Nombre · Cuota social <mes>"', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: {
          data: [auditRow('fees', { new_member_id: '9', new_kind: 'monthly', new_period: '2026-09-01', new_category_id: null })],
          error: null,
        },
        app_users: { data: [], error: null },
        members: { data: [{ id: 9, first_name: 'Dario', last_name: 'Social' }], error: null },
        categories: { data: [], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toBe('Social, Dario · Cuota social septiembre 2026')
  })
})

describe('audit.model.buildLabelDraft (vía getAuditPage): fee_prices', () => {
  it('scope=default: "Por defecto · $monto desde <mes>"', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: {
          data: [auditRow('fee_prices', { new_scope: 'default', new_amount_cents: '1000000', new_valid_from: '2026-09-01' })],
          error: null,
        },
        app_users: { data: [], error: null },
        members: { data: [], error: null },
        categories: { data: [], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    const label = page.items[0].recordLabel
    expect(label).toContain('Por defecto')
    expect(label).toContain('septiembre 2026')
  })

  it('scope=member_type practicing: "Practicantes · ..."', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: {
          data: [
            auditRow('fee_prices', {
              new_scope: 'member_type',
              new_member_type: 'practicing',
              new_amount_cents: '900000',
              new_valid_from: '2026-10-01',
            }),
          ],
          error: null,
        },
        app_users: { data: [], error: null },
        members: { data: [], error: null },
        categories: { data: [], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toContain('Practicantes')
  })

  it('scope=category: usa el nombre de la categoría resuelto', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: {
          data: [
            auditRow('fee_prices', {
              new_scope: 'category',
              new_category_id: '5',
              new_amount_cents: '1200000',
              new_valid_from: '2026-10-01',
            }),
          ],
          error: null,
        },
        app_users: { data: [], error: null },
        members: { data: [], error: null },
        categories: { data: [{ id: 5, name: '5ta' }], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toContain('5ta')
  })
})

describe('audit.model.buildLabelDraft (vía getAuditPage): member_categories', () => {
  it('"Apellido, Nombre · <categoría>"', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: { data: [auditRow('member_categories', { new_member_id: '11', new_category_id: '3' })], error: null },
        app_users: { data: [], error: null },
        members: { data: [{ id: 11, first_name: 'Elena', last_name: 'Deporte' }], error: null },
        categories: { data: [{ id: 3, name: 'Sub 18' }], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toBe('Deporte, Elena · Sub 18')
  })

  it('sin categoría resuelta: solo el nombre del socio', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: { data: [auditRow('member_categories', { new_member_id: '11', new_category_id: '999' })], error: null },
        app_users: { data: [], error: null },
        members: { data: [{ id: 11, first_name: 'Elena', last_name: 'Deporte' }], error: null },
        categories: { data: [], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].recordLabel).toBe('Deporte, Elena')
  })
})

describe('audit.model: actorName resuelto por rol (sin nombres crudos si la RLS de app_users no deja ver)', () => {
  it('con actor_id y sin fila visible en app_users, actorName queda null (no rompe)', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient({
        audit_log: {
          data: [auditRow('payments', { actor_id: 'uuid-sin-nombre', new_member_id: '1', new_amount_cents: '100000', new_paid_on: '2026-09-01' })],
          error: null,
        },
        app_users: { data: [], error: null },
        members: { data: [{ id: 1, first_name: 'Fer', last_name: 'Pago' }], error: null },
        categories: { data: [], error: null },
        disciplines: { data: [], error: null },
      }),
    )

    const page = await getAuditPage({})
    expect(page.items[0].actorName).toBeNull()
    expect(page.items[0].actorId).toBe('uuid-sin-nombre')
  })
})

describe('audit.model.buildLabelDraft (vía getAuditPage): payment_allocations', () => {
  /** El formateador de montos usa un espacio de no separación después del $. */
  const norm = (label: string | null) => (label ?? '').replace(/\u00a0/g, ' ')
  const tables = (over: Tables = {}): Tables => ({
    app_users: { data: [], error: null },
    members: { data: [{ id: 42, first_name: 'Ana', last_name: 'Nombre Secreto' }], error: null },
    categories: { data: [], error: null },
    disciplines: { data: [], error: null },
    ...over,
  })
  const allocRow = (over: Record<string, unknown> = {}) =>
    auditRow('payment_allocations', { new_fee_id: '10', new_payment_id: '20', new_amount_cents: '150000', ...over })

  it('"imputación de $X a cuota del mes MM/YYYY del pago del DD/MM/YYYY", sin nombre de socio', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient(
        tables({
          audit_log: { data: [allocRow()], error: null },
          fees: { data: [{ id: 10, period: '2026-05-01', kind: 'monthly' }], error: null },
          payments: { data: [{ id: 20, paid_on: '2026-09-15' }], error: null },
        }),
      ),
    )
    const page = await getAuditPage({})
    const label = norm(page.items[0].recordLabel)
    expect(label).toContain('imputación de $ 1.500')
    expect(label).toContain('cuota del mes 05/2026')
    expect(label).toContain('pago del 15/09/2026')
    // Datos personales: el vínculo es pago ↔ cuota, el nombre del socio no entra.
    expect(label).not.toMatch(/Nombre Secreto|Ana/)
  })

  it('una cuota de saldo anterior se rotula "a saldo anterior MM/YYYY"', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient(
        tables({
          audit_log: { data: [allocRow()], error: null },
          fees: { data: [{ id: 10, period: '2026-03-01', kind: 'opening_balance' }], error: null },
          payments: { data: [{ id: 20, paid_on: '2026-09-15' }], error: null },
        }),
      ),
    )
    const page = await getAuditPage({})
    expect(norm(page.items[0].recordLabel)).toBe('imputación de $ 1.500 a saldo anterior 03/2026 del pago del 15/09/2026')
  })

  it('lo que no se pudo resolver (RLS o fila inexistente) se omite: nunca un id crudo', async () => {
    createClientMock.mockResolvedValue(
      makeFakeClient(
        tables({
          audit_log: { data: [allocRow()], error: null },
          fees: { data: [], error: null },
          payments: { data: [], error: null },
        }),
      ),
    )
    const page = await getAuditPage({})
    expect(norm(page.items[0].recordLabel)).toBe('imputación de $ 1.500')
    expect(page.items[0].recordLabel).not.toMatch(/\b10\b|\b20\b/)
  })

  it('resuelve cuotas y pagos en UNA consulta batch por tabla (sin N+1), con N imputaciones en la página', async () => {
    const fromSpy = vi.fn()
    const base = makeFakeClient(
      tables({
        audit_log: {
          data: [allocRow({ id: 1 }), allocRow({ id: 2, new_fee_id: '11' }), allocRow({ id: 3, new_fee_id: '12', new_payment_id: '21' })],
          error: null,
        },
        fees: { data: [{ id: 10, period: '2026-05-01', kind: 'monthly' }, { id: 11, period: '2026-06-01', kind: 'monthly' }, { id: 12, period: '2026-07-01', kind: 'monthly' }], error: null },
        payments: { data: [{ id: 20, paid_on: '2026-09-15' }, { id: 21, paid_on: '2026-09-16' }], error: null },
      }),
    )
    createClientMock.mockResolvedValue({ from: (t: string) => (fromSpy(t), base.from(t)) })
    const page = await getAuditPage({})
    const calls = fromSpy.mock.calls.map((c) => c[0] as string)
    expect(calls.filter((t) => t === 'fees')).toHaveLength(1)
    expect(calls.filter((t) => t === 'payments')).toHaveLength(1)
    expect(page.items.map((i) => norm(i.recordLabel))).toEqual([
      'imputación de $ 1.500 a cuota del mes 05/2026 del pago del 15/09/2026',
      'imputación de $ 1.500 a cuota del mes 06/2026 del pago del 15/09/2026',
      'imputación de $ 1.500 a cuota del mes 07/2026 del pago del 16/09/2026',
    ])
  })
})
