import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `fees.model.ts`: `createOpeningBalance` (traducción de
 * `fees_opening_balance_guard`) y `voidFee` (D33/review B2: `.maybeSingle()`
 * con 0 filas ≠ error de Postgres, es "no existe o no tenés permiso" —
 * la policy de UPDATE de `fees` es SOLO `payments.void`, sin el OR con
 * `payments.register` que sí tiene `payments`). Cliente mockeado en el borde.
 */

type QueryResult<T> = { data: T | null; error: { code?: string; message: string } | null }

function makeInsertClient(result: QueryResult<unknown>) {
  return {
    from: (table: string) => {
      if (table !== 'fees') throw new Error(`tabla inesperada: ${table}`)
      return { insert: () => ({ select: () => ({ single: async () => result }) }) }
    },
  }
}

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

describe('createOpeningBalanceSchema', () => {
  it('amountCents <= 0 rechaza con field amountCents', async () => {
    const { createOpeningBalanceSchema } = await importModel()
    const result = createOpeningBalanceSchema.safeParse({ memberId: 1, amountCents: 0 })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'amountCents')).toBe(true)
  })

  it('amountCents entero positivo, sin description: acepta', async () => {
    const { createOpeningBalanceSchema } = await importModel()
    expect(createOpeningBalanceSchema.safeParse({ memberId: 1, amountCents: 2_000_000 }).success).toBe(true)
  })
})

describe('voidFeeSchema', () => {
  it('reason < 3 caracteres: rechaza', async () => {
    const { voidFeeSchema } = await importModel()
    expect(voidFeeSchema.safeParse({ feeId: 1, reason: 'ok' }).success).toBe(false)
  })
})

describe('createOpeningBalance: traducción de fees_opening_balance_guard', () => {
  it('unique violation (ya tiene un saldo vigente) -> DomainError sin field', async () => {
    createClientMock.mockResolvedValue(
      makeInsertClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "fees_one_opening_balance"' } }),
    )
    const { createOpeningBalance } = await importModel()
    await expect(createOpeningBalance({ memberId: 1, amountCents: 1_000_000 })).rejects.toMatchObject({
      message: 'Ya tiene un saldo anterior vigente. Anulalo antes de cargar uno nuevo.',
    })
  })

  it('facturación inactiva (mensaje del trigger) -> DomainError con ese mismo mensaje', async () => {
    createClientMock.mockResolvedValue(
      makeInsertClient({ data: null, error: { code: '23514', message: 'Primero activá las cuotas en Ajustes' } }),
    )
    const { createOpeningBalance } = await importModel()
    await expect(createOpeningBalance({ memberId: 1, amountCents: 1_000_000 })).rejects.toMatchObject({
      message: 'Primero activá las cuotas en Ajustes',
    })
  })

  it('monto <= 0 rechazado por el trigger (defensa en profundidad) -> DomainError field amountCents', async () => {
    createClientMock.mockResolvedValue(
      makeInsertClient({ data: null, error: { code: '23514', message: 'El saldo anterior tiene que ser mayor a cero' } }),
    )
    const { createOpeningBalance } = await importModel()
    await expect(createOpeningBalance({ memberId: 1, amountCents: 1_000_000 })).rejects.toMatchObject({
      message: 'El saldo anterior tiene que ser mayor a cero',
      field: 'amountCents',
    })
  })

  it('éxito: mapea la fila, categoryName/disciplineName siempre null (el arranque nunca tiene categoría)', async () => {
    createClientMock.mockResolvedValue(
      makeInsertClient({
        data: {
          id: 10,
          member_id: 1,
          period: '2026-08-01',
          kind: 'opening_balance',
          amount_cents: 2_000_000,
          description: 'Saldo anterior al sistema',
          category_id: null,
          created_at: '2026-09-01T00:00:00Z',
          voided_at: null,
          void_reason: null,
        },
        error: null,
      }),
    )
    const { createOpeningBalance } = await importModel()
    const fee = await createOpeningBalance({ memberId: 1, amountCents: 2_000_000 })
    expect(fee).toMatchObject({ id: 10, kind: 'opening_balance', amountCents: 2_000_000, categoryName: null, disciplineName: null })
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
