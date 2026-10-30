import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `fees.model.ts`: `createOpeningBalanceMonths` (una fila por mes; traducción de
 * `fees_opening_balance_guard` y `fees_one_opening_balance`) y `voidFee` (D33/review B2: `.maybeSingle()`
 * con 0 filas ≠ error de Postgres, es "no existe o no tenés permiso" —
 * la policy de UPDATE de `fees` es SOLO `payments.void`, sin el OR con
 * `payments.register` que sí tiene `payments`). Cliente mockeado en el borde.
 */

type QueryResult<T> = { data: T | null; error: { code?: string; message: string } | null }

/** insert(payload).select(cols).order(...) como PostgREST: devuelve la promesa con `{ data, error }`. */
function makeInsertClient(result: QueryResult<unknown>, onInsert?: (payload: unknown) => void) {
  return {
    from: (table: string) => {
      if (table !== 'fees') throw new Error(`tabla inesperada: ${table}`)
      return {
        insert: (payload: unknown) => {
          onInsert?.(payload)
          return { select: () => ({ order: async () => result }) }
        },
      }
    },
  }
}

const feeRow = (id: number, period: string, amount = 1_000_000) => ({
  id,
  member_id: 1,
  period,
  kind: 'opening_balance',
  amount_cents: amount,
  description: `Saldo anterior · ${period.slice(5, 7)}/${period.slice(0, 4)}`,
  category_id: null,
  created_at: '2026-09-01T00:00:00Z',
  voided_at: null,
  void_reason: null,
})

function makeVoidClient(result: QueryResult<{ id: number }>) {
  return {
    from: (table: string) => {
      if (table !== 'fees') throw new Error(`tabla inesperada: ${table}`)
      return {
        update: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => result,
            }),
          }),
        }),
      }
    },
  }
}

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

beforeEach(() => {
  createClientMock.mockReset()
})

async function importModel() {
  return import('@/models/fees.model')
}

describe('createOpeningBalanceMonthsSchema', () => {
  const ok = { memberId: 1, months: [{ period: '2026-07-01', amountCents: 1_000_000 }] }

  it('acepta N meses con monto entero positivo', async () => {
    const { createOpeningBalanceMonthsSchema } = await importModel()
    expect(createOpeningBalanceMonthsSchema.safeParse(ok).success).toBe(true)
    expect(
      createOpeningBalanceMonthsSchema.safeParse({ memberId: 1, months: [ok.months[0], { period: '2026-08-01', amountCents: 1 }] }).success,
    ).toBe(true)
  })

  it.each([
    ['sin meses', { memberId: 1, months: [] }],
    ['período repetido', { memberId: 1, months: [ok.months[0], ok.months[0]] }],
    ['día distinto de 1', { memberId: 1, months: [{ period: '2026-07-10', amountCents: 1000 }] }],
    ['fecha inválida', { memberId: 1, months: [{ period: '2026-13-01', amountCents: 1000 }] }],
    ['monto 0', { memberId: 1, months: [{ period: '2026-07-01', amountCents: 0 }] }],
    ['monto negativo', { memberId: 1, months: [{ period: '2026-07-01', amountCents: -5 }] }],
    ['monto decimal (dinero en centavos enteros)', { memberId: 1, months: [{ period: '2026-07-01', amountCents: 10.5 }] }],
    ['memberId inválido', { ...ok, memberId: 0 }],
    ['clave de más en el mes (la descripción la pone la base)', { memberId: 1, months: [{ period: '2026-07-01', amountCents: 1000, description: 'x' }] }],
    ['clave de más (ya no hay tramo ni monto total)', { ...ok, amountCents: 5 }],
  ])('rechaza %s', async (_label, input) => {
    const { createOpeningBalanceMonthsSchema } = await importModel()
    expect(createOpeningBalanceMonthsSchema.safeParse(input).success).toBe(false)
  })

  it('el borde de 36 meses entra y 37 no', async () => {
    const { createOpeningBalanceMonthsSchema } = await importModel()
    const months = (n: number) => Array.from({ length: n }, (_, i) => ({ period: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, amountCents: 1000 }))
    expect(createOpeningBalanceMonthsSchema.safeParse({ memberId: 1, months: months(36) }).success).toBe(true)
    expect(createOpeningBalanceMonthsSchema.safeParse({ memberId: 1, months: months(37) }).success).toBe(false)
  })
})

describe('voidFeeSchema', () => {
  it('reason < 3 caracteres: rechaza', async () => {
    const { voidFeeSchema } = await importModel()
    expect(voidFeeSchema.safeParse({ feeId: 1, reason: 'ok' }).success).toBe(false)
  })
})

describe('createOpeningBalanceMonths', () => {
  it('UN insert de N filas con solo member_id, kind, period y amount_cents (sin description ni tramo: la base los pone); devuelve las filas mapeadas', async () => {
    let sent: unknown
    createClientMock.mockResolvedValue(
      makeInsertClient({ data: [feeRow(10, '2026-07-01'), feeRow(11, '2026-08-01')], error: null }, (p) => (sent = p)),
    )
    const { createOpeningBalanceMonths } = await importModel()
    const fees = await createOpeningBalanceMonths({
      memberId: 1,
      months: [
        { period: '2026-07-01', amountCents: 1_000_000 },
        { period: '2026-08-01', amountCents: 1_000_001 },
      ],
    })
    expect(sent).toEqual([
      { member_id: 1, kind: 'opening_balance', period: '2026-07-01', amount_cents: 1_000_000 },
      { member_id: 1, kind: 'opening_balance', period: '2026-08-01', amount_cents: 1_000_001 },
    ])
    for (const row of sent as Record<string, unknown>[]) {
      expect(row).not.toHaveProperty('description')
      expect(row).not.toHaveProperty('from_period')
      expect(row).not.toHaveProperty('to_period')
    }
    expect(fees.map((f) => [f.id, f.period])).toEqual([[10, '2026-07-01'], [11, '2026-08-01']])
    expect(fees[0]).toMatchObject({ kind: 'opening_balance', categoryName: null, disciplineName: null })
  })

  it('23505 de fees_one_opening_balance (ya hay saldo en uno de esos meses) -> DomainError con el texto nuevo y field months', async () => {
    createClientMock.mockResolvedValue(
      makeInsertClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "fees_one_opening_balance"' } }),
    )
    const { createOpeningBalanceMonths } = await importModel()
    await expect(createOpeningBalanceMonths({ memberId: 1, months: [{ period: '2026-07-01', amountCents: 1000 }] })).rejects.toMatchObject({
      message: 'Ya hay un saldo anterior cargado para uno de esos meses',
      field: 'months',
    })
  })

  it('un 23505 de OTRA constraint no se disfraza de "ya hay un saldo": se relanza tal cual', async () => {
    const raw = { code: '23505', message: 'duplicate key value violates unique constraint "otra_cosa"' }
    createClientMock.mockResolvedValue(makeInsertClient({ data: null, error: raw }))
    const { createOpeningBalanceMonths } = await importModel()
    await expect(createOpeningBalanceMonths({ memberId: 1, months: [{ period: '2026-07-01', amountCents: 1000 }] })).rejects.toEqual(raw)
  })

  it.each([
    ['facturación inactiva', 'Primero activá las cuotas en Ajustes'],
    ['mes >= inicio', 'El saldo anterior solo cubre meses anteriores a 10/2026'],
    ['más de 36 meses', 'El saldo anterior no puede ir más de 36 meses atrás'],
    ['monto <= 0', 'El saldo anterior tiene que ser mayor a cero'],
  ])('check_violation del guard (%s) -> DomainError con ese mismo mensaje, legible y atado a months', async (_label, message) => {
    createClientMock.mockResolvedValue(makeInsertClient({ data: null, error: { code: '23514', message } }))
    const { createOpeningBalanceMonths } = await importModel()
    await expect(createOpeningBalanceMonths({ memberId: 1, months: [{ period: '2026-07-01', amountCents: 1000 }] })).rejects.toMatchObject({
      message,
      field: 'months',
    })
  })

  it('un CHECK del tramo (fila vieja) salta como red de seguridad: el usuario ve el texto legible, nunca el nombre del constraint', async () => {
    const raw = { code: '23514', message: 'new row for relation "fees" violates check constraint "fees_opening_span_shape"' }
    createClientMock.mockResolvedValue(makeInsertClient({ data: null, error: raw }))
    const { createOpeningBalanceMonths } = await importModel()
    await expect(createOpeningBalanceMonths({ memberId: 1, months: [{ period: '2026-07-01', amountCents: 1000 }] })).rejects.toMatchObject({
      message: 'Los meses del saldo anterior no son válidos',
      field: 'months',
    })
  })

  it('sin filas devueltas (data null) → lista vacía, no revienta', async () => {
    createClientMock.mockResolvedValue(makeInsertClient({ data: null, error: null }))
    const { createOpeningBalanceMonths } = await importModel()
    await expect(createOpeningBalanceMonths({ memberId: 1, months: [{ period: '2026-07-01', amountCents: 1000 }] })).resolves.toEqual([])
  })
})

describe('voidFee: D33 — 0 filas (policy solo payments.void) es un caso de negocio, no un error de Postgres', () => {
  it('0 filas afectadas (editor sin payments.void, o id inexistente) -> DomainError explícito', async () => {
    createClientMock.mockResolvedValue(makeVoidClient({ data: null, error: null }))
    const { voidFee } = await importModel()
    await expect(voidFee(999, 'motivo válido')).rejects.toMatchObject({
      message: 'No se pudo anular el cargo: no existe o no tenés permiso',
    })
  })

  it('ya anulado (trigger) -> DomainError con el mensaje exacto del trigger', async () => {
    createClientMock.mockResolvedValue(makeVoidClient({ data: null, error: { code: '23514', message: 'Este cargo ya está anulado' } }))
    const { voidFee } = await importModel()
    await expect(voidFee(1, 'motivo válido')).rejects.toMatchObject({ message: 'Este cargo ya está anulado' })
  })

  it('éxito: 1 fila afectada, no tira nada', async () => {
    createClientMock.mockResolvedValue(makeVoidClient({ data: { id: 1 }, error: null }))
    const { voidFee } = await importModel()
    await expect(voidFee(1, 'motivo válido')).resolves.toBeUndefined()
  })

  it('un error de Postgres no relacionado con la anulación (23514 de otro CHECK) se relanza tal cual, no se confunde con "ya anulado"', async () => {
    const rawError = { code: '23514', message: 'otro CHECK cualquiera' }
    createClientMock.mockResolvedValue(makeVoidClient({ data: null, error: rawError }))
    const { voidFee } = await importModel()
    await expect(voidFee(1, 'motivo válido')).rejects.toEqual(rawError)
  })
})
