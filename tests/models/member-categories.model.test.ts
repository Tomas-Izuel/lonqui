import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `member-categories.model.ts` (Revisión 3, §13.2): `assertCategorySelection`
 * (chequeo previo al alta, antes de insertar el socio), `setMemberCategories`/
 * `closeMembership`/`changeCategory` traduciendo la RPC `set_member_categories`
 * y el trigger de cierre. Cliente mockeado en el borde externo.
 */

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

beforeEach(() => {
  createClientMock.mockReset()
})

async function importModel() {
  return import('@/models/member-categories.model')
}

describe('assertCategorySelection', () => {
  it('array vacío: no consulta nada, devuelve sin más (no practicante es válido)', async () => {
    const fromSpy = vi.fn()
    createClientMock.mockResolvedValue({ from: fromSpy })
    const { assertCategorySelection } = await importModel()
    await expect(assertCategorySelection({ from: fromSpy } as never, [])).resolves.toBeUndefined()
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('una categoría que no existe entre las devueltas -> DomainError "Una de las categorías elegidas no existe"', async () => {
    const supabase = { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) }
    const { assertCategorySelection } = await importModel()
    await expect(assertCategorySelection(supabase as never, [999])).rejects.toMatchObject({
      message: 'Una de las categorías elegidas no existe',
      field: 'categoryIds',
    })
  })

  it('una categoría inactiva -> DomainError "Una de las categorías elegidas está dada de baja"', async () => {
    const supabase = { from: () => ({ select: () => ({ in: async () => ({ data: [{ id: 5, discipline_id: 1, is_active: false }], error: null }) }) }) }
    const { assertCategorySelection } = await importModel()
    await expect(assertCategorySelection(supabase as never, [5])).rejects.toMatchObject({
      message: 'Una de las categorías elegidas está dada de baja',
      field: 'categoryIds',
    })
  })

  it('dos categorías de la MISMA disciplina -> DomainError "Elegí una sola categoría por deporte"', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [
              { id: 5, discipline_id: 1, is_active: true },
              { id: 6, discipline_id: 1, is_active: true },
            ],
            error: null,
          }),
        }),
      }),
    }
    const { assertCategorySelection } = await importModel()
    await expect(assertCategorySelection(supabase as never, [5, 6])).rejects.toMatchObject({
      message: 'Elegí una sola categoría por deporte',
      field: 'categoryIds',
    })
  })

  it('categorías activas de disciplinas distintas: pasa sin tirar', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [
              { id: 5, discipline_id: 1, is_active: true },
              { id: 12, discipline_id: 3, is_active: true },
            ],
            error: null,
          }),
        }),
      }),
    }
    const { assertCategorySelection } = await importModel()
    await expect(assertCategorySelection(supabase as never, [5, 12])).resolves.toBeUndefined()
  })
})

describe('setMemberCategories: traducción de set_member_categories', () => {
  function makeRpcClient(result: { data: null; error: { code?: string; message: string } | null }) {
    return { rpc: async () => result }
  }

  it('trigger: una sola categoría por deporte -> DomainError field categoryIds', async () => {
    createClientMock.mockResolvedValue(makeRpcClient({ data: null, error: { code: '23514', message: 'Elegí una sola categoría por deporte' } }))
    const { setMemberCategories } = await importModel()
    await expect(setMemberCategories({ memberId: 1, categoryIds: [5, 6] })).rejects.toMatchObject({
      message: 'Elegí una sola categoría por deporte',
      field: 'categoryIds',
    })
  })

  it('trigger: categoría inactiva -> DomainError "Una de las categorías elegidas está dada de baja"', async () => {
    createClientMock.mockResolvedValue(makeRpcClient({ data: null, error: { code: '23514', message: 'La categoría está dada de baja' } }))
    const { setMemberCategories } = await importModel()
    await expect(setMemberCategories({ memberId: 1, categoryIds: [5] })).rejects.toMatchObject({
      message: 'Una de las categorías elegidas está dada de baja',
      field: 'categoryIds',
    })
  })

  it('FK: categoría inexistente -> DomainError "Una de las categorías elegidas no existe"', async () => {
    createClientMock.mockResolvedValue(makeRpcClient({ data: null, error: { code: '23503', message: 'La categoría no existe' } }))
    const { setMemberCategories } = await importModel()
    await expect(setMemberCategories({ memberId: 1, categoryIds: [999] })).rejects.toMatchObject({
      message: 'Una de las categorías elegidas no existe',
      field: 'categoryIds',
    })
  })

  it('fecha futura -> DomainError field effectiveOn', async () => {
    createClientMock.mockResolvedValue(makeRpcClient({ data: null, error: { code: '23514', message: 'La fecha no puede ser futura' } }))
    const { setMemberCategories } = await importModel()
    await expect(setMemberCategories({ memberId: 1, categoryIds: [5], effectiveOn: '2099-01-01' })).rejects.toMatchObject({
      message: 'La fecha no puede ser futura',
      field: 'effectiveOn',
    })
  })

  it('42501 (sin permiso) -> DomainError "No tenés permiso para modificar socios"', async () => {
    createClientMock.mockResolvedValue(makeRpcClient({ data: null, error: { code: '42501', message: 'insufficient_privilege' } }))
    const { setMemberCategories } = await importModel()
    await expect(setMemberCategories({ memberId: 1, categoryIds: [5] })).rejects.toMatchObject({
      message: 'No tenés permiso para modificar socios',
    })
  })

  it('éxito: no tira nada', async () => {
    createClientMock.mockResolvedValue(makeRpcClient({ data: null, error: null }))
    const { setMemberCategories } = await importModel()
    await expect(setMemberCategories({ memberId: 1, categoryIds: [5] })).resolves.toBeUndefined()
  })
})

describe('closeMembership: D33 (mismo patrón que voidFee) — 0 filas es "no existe o ya está cerrada"', () => {
  function makeCloseClient(result: { data: { member_id: number } | null; error: { code?: string; message: string } | null }) {
    return {
      from: () => ({
        update: () => ({
          eq: () => ({
            is: () => ({
              select: () => ({
                maybeSingle: async () => result,
              }),
            }),
          }),
        }),
      }),
    }
  }

  it('0 filas afectadas (inexistente o ya cerrada) -> DomainError genérico', async () => {
    createClientMock.mockResolvedValue(makeCloseClient({ data: null, error: null }))
    const { closeMembership } = await importModel()
    await expect(closeMembership({ membershipId: 999, leftOn: '2026-09-01' })).rejects.toMatchObject({
      message: 'Esa inscripción no existe o ya está cerrada',
    })
  })

  it('éxito: devuelve memberId de la fila cerrada', async () => {
    createClientMock.mockResolvedValue(makeCloseClient({ data: { member_id: 5 }, error: null }))
    const { closeMembership } = await importModel()
    await expect(closeMembership({ membershipId: 1, leftOn: '2026-09-01' })).resolves.toEqual({ memberId: 5 })
  })

  it('error del trigger (fecha) -> DomainError field leftOn', async () => {
    createClientMock.mockResolvedValue(makeCloseClient({ data: null, error: { code: '23514', message: 'La fecha no puede ser futura' } }))
    const { closeMembership } = await importModel()
    await expect(closeMembership({ membershipId: 1, leftOn: '2099-01-01' })).rejects.toMatchObject({
      message: 'La fecha no puede ser futura',
      field: 'leftOn',
    })
  })
})

describe('changeCategory: rechaza una categoría de OTRA disciplina', () => {
  it('la nueva categoría es de una disciplina distinta a la inscripción actual -> DomainError field newCategoryId', async () => {
    createClientMock.mockResolvedValue({
      from: (table: string) => {
        if (table === 'member_categories') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { member_id: 5, category_id: 8, left_on: null, categories: { discipline_id: 2 } },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'categories') {
          return {
            select: () => ({
              // `assertCategorySelection` usa `.in()`; el fetch puntual de la
              // categoría nueva (para comparar disciplinas) usa `.eq()`.
              in: async () => ({ data: [{ id: 12, discipline_id: 3, is_active: true }], error: null }),
              eq: () => ({ maybeSingle: async () => ({ data: { discipline_id: 3 }, error: null }) }),
            }),
          }
        }
        throw new Error(`tabla inesperada: ${table}`)
      },
    })
    const { changeCategory } = await importModel()
    await expect(changeCategory({ membershipId: 1, newCategoryId: 12, effectiveOn: '2026-09-01' })).rejects.toMatchObject({
      message: 'Elegí una categoría del mismo deporte',
      field: 'newCategoryId',
    })
  })

  it('inscripción ya cerrada: DomainError genérico, ni siquiera llega a validar la categoría nueva', async () => {
    createClientMock.mockResolvedValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { member_id: 5, category_id: 8, left_on: '2026-08-01', categories: null }, error: null }) }) }) }),
    })
    const { changeCategory } = await importModel()
    await expect(changeCategory({ membershipId: 1, newCategoryId: 12, effectiveOn: '2026-09-01' })).rejects.toMatchObject({
      message: 'Esa inscripción no existe o ya está cerrada',
    })
  })
})
