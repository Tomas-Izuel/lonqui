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

import { addMonths, previousPeriod, toPeriod } from '@/lib/dates'

beforeEach(() => {
  createClientMock.mockReset()
})

async function importModel() {
  return import('@/models/fee-prices.model')
}

// Un valor nuevo no puede aplicar desde un mes pasado: se deriva del reloj.
const CURRENT_PERIOD = toPeriod()
const BASE = {
  scope: 'default' as const,
  amountCents: 1_000_000,
  validFrom: CURRENT_PERIOD,
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
    const result = createFeePriceSchema.safeParse({ ...BASE, validFrom: `${CURRENT_PERIOD.slice(0, 8)}15` })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toBe('Tiene que ser el primer día de un mes')
  })

  it('validFrom el primer día del mes: acepta', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, validFrom: addMonths(CURRENT_PERIOD, 3) }).success).toBe(true)
  })

  it('validFrom del mes actual: acepta (frontera); del mes anterior: rechaza con mensaje claro en validFrom', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, validFrom: CURRENT_PERIOD }).success).toBe(true)
    const result = createFeePriceSchema.safeParse({ ...BASE, validFrom: previousPeriod(CURRENT_PERIOD) })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['validFrom'])
      expect(result.error.issues[0].message).toBe('Un valor de cuota nuevo aplica desde este mes o uno futuro')
    }
  })

  it('claves desconocidas: rechaza (.strict())', async () => {
    const { createFeePriceSchema } = await importModel()
    expect(createFeePriceSchema.safeParse({ ...BASE, extra: 1 }).success).toBe(false)
  })
})

describe('createFeePrice: traducción de errores del trigger/unique', () => {
  it('23505 ya no se traduce: sin índice único un 23505 es una falla inesperada y se relanza tal cual', async () => {
    const rawError = { code: '23505', message: 'duplicate key value violates unique constraint "otra_cosa"' }
    createClientMock.mockResolvedValue(makeInsertClient({ data: null, error: rawError }))
    const { createFeePrice } = await importModel()
    const { DomainError } = await import('@/lib/errors')
    const thrown = await createFeePrice(BASE).catch((e: unknown) => e)
    expect(thrown).toEqual(rawError)
    expect(thrown).not.toBeInstanceOf(DomainError)
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

describe('getFeePricesOverview: corrección de valores (mismo destino y mes, rige el id más alto)', () => {
  const row = (over: Record<string, unknown>) => ({
    scope: 'default',
    member_type: null,
    category_id: null,
    amount_cents: 1_000_000,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    categories: null,
    ...over,
  })

  // Misma forma que `listFeePrices`: `valid_from desc, id desc`.
  function mockRows(rows: unknown[]) {
    createClientMock.mockResolvedValue({
      from: () => ({
        select: () => ({ order: () => ({ order: () => ({ overrideTypes: () => Promise.resolve({ data: rows, error: null }) }) }) }),
      }),
    })
  }

  const FUTURE = `${new Date().getUTCFullYear() + 2}-03-01`
  const FUTURE_NEXT = `${new Date().getUTCFullYear() + 2}-04-01`
  const PAST = `${new Date().getUTCFullYear() - 1}-01-01`

  it('upcoming muestra UNA fila por destino y mes: la de mayor id, no la reemplazada', async () => {
    mockRows([
      row({ id: 9, amount_cents: 1_200_000, valid_from: FUTURE }), // corrección
      row({ id: 7, amount_cents: 12_000_000, valid_from: FUTURE }), // equivocada
      row({ id: 1, valid_from: PAST }),
    ])
    const { getFeePricesOverview } = await importModel()
    const overview = await getFeePricesOverview()
    expect(overview.upcoming.map((p) => p.id)).toEqual([9])
    expect(overview.upcoming[0].amountCents).toBe(1_200_000)
  })

  it('dos destinos distintos con el mismo mes NO se deduplican entre sí; el mismo destino en meses distintos tampoco', async () => {
    mockRows([
      row({ id: 5, scope: 'member_type', member_type: 'practicing', valid_from: FUTURE_NEXT }),
      row({ id: 4, valid_from: FUTURE_NEXT }),
      row({ id: 3, valid_from: FUTURE }),
      row({ id: 2, scope: 'category', category_id: 8, valid_from: FUTURE, categories: { name: 'Mayores' } }),
      row({ id: 1, valid_from: PAST }),
    ])
    const { getFeePricesOverview } = await importModel()
    const overview = await getFeePricesOverview()
    expect(overview.upcoming.map((p) => p.id).sort()).toEqual([2, 3, 4, 5])
  })

  it('history conserva todas las filas y marca supersededById solo en las reemplazadas', async () => {
    mockRows([
      row({ id: 9, valid_from: FUTURE }),
      row({ id: 7, valid_from: FUTURE }),
      row({ id: 6, valid_from: FUTURE }),
      row({ id: 1, valid_from: PAST }),
    ])
    const { getFeePricesOverview } = await importModel()
    const overview = await getFeePricesOverview()
    expect(overview.history.map((h) => [h.id, h.supersededById])).toEqual([
      [9, null],
      [7, 9],
      [6, 9],
      [1, null],
    ])
  })

  it('el vigente de un destino es el de mayor id si hay dos filas del mismo mes <= mes actual', async () => {
    mockRows([
      row({ id: 12, amount_cents: 1_100_000, valid_from: PAST }),
      row({ id: 11, amount_cents: 9_900_000, valid_from: PAST }),
    ])
    const { getFeePricesOverview } = await importModel()
    const overview = await getFeePricesOverview()
    expect(overview.current.default?.id).toBe(12)
    expect(overview.history.find((h) => h.id === 11)?.supersededById).toBe(12)
    expect(overview.upcoming).toEqual([])
  })
})
