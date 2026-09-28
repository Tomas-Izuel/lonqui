import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `fee-prices.model.ts`: `createFeePriceSchema` (coherencia scope ↔
 * memberType/categoryId, mismo CHECK que `fee_prices_scope_shape`) y la
 * traducción de errores de Postgres (`translateFeePriceError`, no
 * exportada — se prueba a través de `createFeePrice`) mockeando el cliente de
 * Supabase en el borde externo.
 */

type QueryResult<T> = { data: T | null; error: { code?: string; message: string } | null }

/**
 * `createFeePrice` encadena `.insert(...).select(...).single().overrideTypes<...>()`:
 * `.single()` devuelve un builder (no una promesa todavía) del que se cuelga
 * `.overrideTypes()`, y ESE es el que finalmente se `await`ea. `.overrideTypes()`
 * es solo un cast de tipos en supabase-js real; acá se implementa como el
 * paso que resuelve la promesa.
 */
function makeInsertClient(result: QueryResult<unknown>) {
  return {
    from: (table: string) => {
      if (table !== 'fee_prices') throw new Error(`tabla inesperada: ${table}`)
      return {
        insert: () => ({
          select: () => ({
            single: () => ({
              overrideTypes: () => Promise.resolve(result),
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
  return import('@/models/fee-prices.model')
}

const BASE = {
  scope: 'default' as const,
  amountCents: 1_000_000,
  validFrom: '2026-10-01',
}

describe('createFeePriceSchema: coherencia scope <-> memberType/categoryId', () => {
  it('scope "default" sin memberType ni categoryId: acepta', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse(BASE).success).toBe(true)
  })

  it('scope "default" CON categoryId: rechaza con field categoryId', async () => {
    const { createFeePriceSchema } = await importModel()
    const result = createFeePriceSchema.safeParse({ ...BASE, categoryId: 1 })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'categoryId')).toBe(true)
  })

  it('scope "default" CON memberType: rechaza con field memberType', async () => {
    const { createFeePriceSchema } = await importModel()
    const result = createFeePriceSchema.safeParse({ ...BASE, scope: 'default', memberType: 'practicing' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'memberType')).toBe(true)
  })

  it('scope "category" sin categoryId: rechaza con field categoryId ("Elegí una categoría")', async () => {
    const { createFeePriceSchema } = await importModel()
    const result = createFeePriceSchema.safeParse({ ...BASE, scope: 'category' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'categoryId' && i.message === 'Elegí una categoría')).toBe(
        true,
      )
    }
  })

  it('scope "category" CON memberType además: rechaza con field memberType', async () => {
    const { createFeePriceSchema } = await importModel()
    const result = createFeePriceSchema.safeParse({ ...BASE, scope: 'category', categoryId: 5, memberType: 'practicing' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'memberType')).toBe(true)
  })

  it('scope "category" con solo categoryId: acepta', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, scope: 'category', categoryId: 5 }).success).toBe(true)
  })

  it('scope "member_type" sin memberType: rechaza con field memberType ("Elegí un tipo de socio")', async () => {
    const { createFeePriceSchema } = await importModel()
    const result = createFeePriceSchema.safeParse({ ...BASE, scope: 'member_type' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === 'memberType' && i.message === 'Elegí un tipo de socio'),
      ).toBe(true)
    }
  })

  it('scope "member_type" CON categoryId además: rechaza con field categoryId', async () => {
    const { createFeePriceSchema } = await importModel()
    const result = createFeePriceSchema.safeParse({ ...BASE, scope: 'member_type', memberType: 'practicing', categoryId: 3 })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'categoryId')).toBe(true)
  })

  it('scope "member_type" con solo memberType: acepta', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, scope: 'member_type', memberType: 'non_practicing' }).success).toBe(
      true,
    )
  })
})

describe('createFeePriceSchema: amountCents y validFrom', () => {
  it('amountCents no entero: rechaza', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, amountCents: 1000.5 }).success).toBe(false)
  })

  it('amountCents negativo: rechaza', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, amountCents: -1 }).success).toBe(false)
  })

  it('amountCents cero: acepta (una cuota bonificada, D17 no lo prohíbe)', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, amountCents: 0 }).success).toBe(true)
  })

  it('validFrom que no es el primer día del mes: rechaza ("Tiene que ser el primer día de un mes")', async () => {
    const { createFeePriceSchema } = await importModel()
    const result = createFeePriceSchema.safeParse({ ...BASE, validFrom: '2026-10-15' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toBe('Tiene que ser el primer día de un mes')
  })

  it('validFrom el primer día del mes: acepta', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, validFrom: '2027-01-01' }).success).toBe(true)
  })

  it('claves desconocidas: rechaza (.strict())', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, extra: 1 }).success).toBe(false)
  })
})

describe('createFeePrice: traducción de errores del trigger/unique', () => {
  it('23505 (duplicado exacto de scope/target/validFrom) -> DomainError field validFrom', async () => {
    createClientMock.mockResolvedValue(
      makeInsertClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "fee_prices_unique_target"' } }),
    )
    const { createFeePrice } = await importModel()
    await expect(createFeePrice(BASE)).rejects.toMatchObject({
      message: 'Ya hay un valor para ese alcance desde ese mes',
      field: 'validFrom',
    })
  })

  it('23514 (fee_prices_insert_guard: mes pasado o ya generado) -> DomainError con el mensaje del trigger, field validFrom', async () => {
    const triggerMessage = 'Las cuotas de octubre 2026 ya se generaron con otro valor; el nuevo aplica desde noviembre 2026'
    createClientMock.mockResolvedValue(makeInsertClient({ data: null, error: { code: '23514', message: triggerMessage } }))
    const { createFeePrice } = await importModel()
    await expect(createFeePrice(BASE)).rejects.toMatchObject({ message: triggerMessage, field: 'validFrom' })
  })

  it('23503 (FK a categories inexistente) -> DomainError field categoryId', async () => {
    createClientMock.mockResolvedValue(
      makeInsertClient({ data: null, error: { code: '23503', message: 'insert or update on table "fee_prices" violates foreign key constraint' } }),
    )
    const { createFeePrice } = await importModel()
    await expect(createFeePrice({ ...BASE, scope: 'category', categoryId: 999 })).rejects.toMatchObject({
      message: 'Esa categoría no existe',
      field: 'categoryId',
    })
  })

  it('un error no reconocido se relanza tal cual', async () => {
    const rawError = { code: '42501', message: 'permission denied for table fee_prices' }
    createClientMock.mockResolvedValue(makeInsertClient({ data: null, error: rawError }))
    const { createFeePrice } = await importModel()
    await expect(createFeePrice(BASE)).rejects.toEqual(rawError)
  })

  it('éxito: mapea la fila a FeePrice, con categoryName desde el embed', async () => {
    createClientMock.mockResolvedValue(
      makeInsertClient({
        data: {
          id: 1,
          scope: 'category',
          member_type: null,
          category_id: 5,
          amount_cents: 1_200_000,
          valid_from: '2026-10-01',
          notes: null,
          created_at: '2026-09-27T00:00:00Z',
          categories: { name: '5ta' },
        },
        error: null,
      }),
    )
    const { createFeePrice } = await importModel()
    const result = await createFeePrice({ ...BASE, scope: 'category', categoryId: 5, amountCents: 1_200_000 })
    expect(result).toMatchObject({ id: 1, scope: 'category', categoryId: 5, categoryName: '5ta', amountCents: 1_200_000 })
  })
})

describe('getFeePricesOverview: vigente por scope vs. próximos', () => {
  it('separa vigentes (validFrom <= mes actual) de próximos, y el default vigente es el de mayor validFrom', async () => {
    const currentYear = new Date().getUTCFullYear()
    const pastPeriod = `${currentYear - 1}-01-01`
    const futurePeriod = `${currentYear + 1}-01-01`

    createClientMock.mockResolvedValue({
      from: () => ({
        select: () => ({
          order: () => ({
            order: () => ({
              overrideTypes: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 2,
                      scope: 'default',
                      member_type: null,
                      category_id: null,
                      amount_cents: 1_200_000,
                      valid_from: futurePeriod,
                      notes: null,
                      created_at: '2026-01-01T00:00:00Z',
                      categories: null,
                    },
                    {
                      id: 1,
                      scope: 'default',
                      member_type: null,
                      category_id: null,
                      amount_cents: 1_000_000,
                      valid_from: pastPeriod,
                      notes: null,
                      created_at: '2025-01-01T00:00:00Z',
                      categories: null,
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    })

    const { getFeePricesOverview } = await importModel()
    const overview = await getFeePricesOverview()

    expect(overview.current.default?.id).toBe(1)
    expect(overview.upcoming.map((p) => p.id)).toEqual([2])
    expect(overview.history.map((p) => p.id)).toEqual([2, 1])
  })
})
