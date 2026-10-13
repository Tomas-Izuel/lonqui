import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, fakeSupabase, ok } from '../stubs/supabase-mock'

/**
 * `cash-concepts.model.ts`: los conceptos de caja son datos que administra el
 * club desde /ajustes. Nunca se borran; desactivar no se impide aunque tengan
 * movimientos. El nombre es único sin distinguir mayúsculas.
 */

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const { DomainError } = await import('@/lib/errors')
async function importModel() {
  return import('@/models/cash-concepts.model')
}
beforeEach(() => createClientMock.mockReset())

const conceptRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  direction: 'income',
  name: 'Sponsor',
  requires_sponsor: true,
  is_active: true,
  sort_order: 1,
  ...over,
})

describe('schemas', () => {
  it('nombre: se recorta, 2 a 120 caracteres; claves de más rechazan (direction no se manda)', async () => {
    const { createCashConceptSchema, updateCashConceptSchema } = await importModel()
    expect(createCashConceptSchema.parse({ name: '  Rifa  ' }).name).toBe('Rifa')
    expect(createCashConceptSchema.safeParse({ name: 'a' }).success).toBe(false)
    expect(createCashConceptSchema.safeParse({ name: ' a ' }).success).toBe(false)
    expect(createCashConceptSchema.safeParse({ name: 'x'.repeat(121) }).success).toBe(false)
    expect(createCashConceptSchema.safeParse({ name: 'x'.repeat(120) }).success).toBe(true)
    expect(createCashConceptSchema.safeParse({ name: 'Rifa', direction: 'expense' }).success).toBe(false)
    expect(updateCashConceptSchema.safeParse({ name: 'Rifa', isActive: false }).success).toBe(false)
  })
})

describe('listCashConcepts', () => {
  it('mapea a camelCase; por defecto solo activos, ordenados por sort_order y nombre', async () => {
    const fake = fakeSupabase({ from: { cash_concepts: [ok([conceptRow()])] } })
    createClientMock.mockResolvedValue(fake.client)
    const { listCashConcepts } = await importModel()

    const list = await listCashConcepts()

    expect(list).toEqual([{ id: 1, direction: 'income', name: 'Sponsor', requiresSponsor: true, isActive: true, sortOrder: 1 }])
    const ops = fake.opsOf('from:cash_concepts')
    expect(ops).toContainEqual(['eq', ['is_active', true]])
    expect(ops).toContainEqual(['order', ['sort_order', { ascending: true }]])
    expect(ops).toContainEqual(['order', ['name', { ascending: true }]])
  })

  it('includeInactive trae todos (ajustes y filtros necesitan los desactivados)', async () => {
    const fake = fakeSupabase({ from: { cash_concepts: [ok([conceptRow({ is_active: false })])] } })
    createClientMock.mockResolvedValue(fake.client)
    const { listCashConcepts } = await importModel()
    const list = await listCashConcepts({ includeInactive: true })
    expect(list[0].isActive).toBe(false)
    expect(fake.opsOf('from:cash_concepts').some(([m, a]) => m === 'eq' && a[0] === 'is_active')).toBe(false)
  })
})

describe('createCashConcept', () => {
  it('va al final: sort_order = max + 1; en un catálogo vacío arranca en 1', async () => {
    const { createCashConcept } = await importModel()

    const withLast = fakeSupabase({ from: { cash_concepts: [ok({ sort_order: 5 }), ok(conceptRow({ sort_order: 6 }))] } })
    createClientMock.mockResolvedValue(withLast.client)
    await createCashConcept({ name: 'Rifa', requiresSponsor: false })
    expect(withLast.opsOf('from:cash_concepts', 1).find(([m]) => m === 'insert')?.[1][0]).toEqual({ name: 'Rifa', requires_sponsor: false, sort_order: 6 })

    const empty = fakeSupabase({ from: { cash_concepts: [ok(null), ok(conceptRow())] } })
    createClientMock.mockResolvedValue(empty.client)
    await createCashConcept({ name: 'Rifa' })
    expect(empty.opsOf('from:cash_concepts', 1).find(([m]) => m === 'insert')?.[1][0]).toMatchObject({ requires_sponsor: false, sort_order: 1 })
  })

  it('nombre repetido (23505): DomainError con field name', async () => {
    createClientMock.mockResolvedValue(
      fakeSupabase({ from: { cash_concepts: [ok(null), fail('23505', 'duplicate key value violates unique constraint "cash_concepts_name_key"')] } }).client,
    )
    const { createCashConcept } = await importModel()
    const err = await createCashConcept({ name: 'sponsor' }).catch((e) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err).toMatchObject({ message: 'Ya existe un concepto con ese nombre', field: 'name' })
  })

  it('sin permiso (RLS 42501) se relanza crudo: el controller lo vuelve genérico, no filtra el motivo', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_concepts: [ok(null), fail('42501', 'permission denied')] } }).client)
    const { createCashConcept } = await importModel()
    const err = await createCashConcept({ name: 'Rifa' }).catch((e) => e)
    expect(err).not.toBeInstanceOf(DomainError)
  })
})

describe('updateCashConcept / setCashConceptActive / reorderCashConcepts', () => {
  it('update: requiresSponsor undefined no se manda (no se pisa); definido sí', async () => {
    const { updateCashConcept } = await importModel()
    const a = fakeSupabase({ from: { cash_concepts: [ok(conceptRow())] } })
    createClientMock.mockResolvedValue(a.client)
    await updateCashConcept(1, { name: 'Nuevo' })
    expect(a.opsOf('from:cash_concepts').find(([m]) => m === 'update')?.[1][0]).toEqual({ name: 'Nuevo' })

    const b = fakeSupabase({ from: { cash_concepts: [ok(conceptRow())] } })
    createClientMock.mockResolvedValue(b.client)
    await updateCashConcept(1, { name: 'Nuevo', requiresSponsor: false })
    expect(b.opsOf('from:cash_concepts').find(([m]) => m === 'update')?.[1][0]).toEqual({ name: 'Nuevo', requires_sponsor: false })
  })

  it('update con nombre repetido o nombre corto en la base: mensaje de dominio con field name', async () => {
    const { updateCashConcept } = await importModel()
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_concepts: [fail('23505', 'duplicate')] } }).client)
    await expect(updateCashConcept(1, { name: 'Dup' })).rejects.toMatchObject({ field: 'name', message: 'Ya existe un concepto con ese nombre' })
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_concepts: [fail('23514', 'violates check constraint "cash_concepts_name_check"')] } }).client)
    await expect(updateCashConcept(1, { name: 'Dup' })).rejects.toMatchObject({ field: 'name' })
  })

  it('setCashConceptActive: solo toca is_active (el sponsor requerido y el orden no cambian), sin contar movimientos', async () => {
    const fake = fakeSupabase({ from: { cash_concepts: [ok(conceptRow({ is_active: false }))] } })
    createClientMock.mockResolvedValue(fake.client)
    const { setCashConceptActive } = await importModel()
    const result = await setCashConceptActive(1, false)
    expect(result.isActive).toBe(false)
    expect(fake.opsOf('from:cash_concepts').find(([m]) => m === 'update')?.[1][0]).toEqual({ is_active: false })
    expect(fake.count('from:cash_movements')).toBe(0)
  })

  it('reorder: sort_order = posición en la lista recibida', async () => {
    const fake = fakeSupabase({ from: { cash_concepts: [ok([{ id: 1 }])] } })
    createClientMock.mockResolvedValue(fake.client)
    const { reorderCashConcepts } = await importModel()
    await reorderCashConcepts([30, 10, 20])
    const updates = [0, 1, 2].map((i) => fake.opsOf('from:cash_concepts', i))
    expect(updates.map((ops) => ops.find(([m]) => m === 'update')?.[1][0])).toEqual([{ sort_order: 0 }, { sort_order: 1 }, { sort_order: 2 }])
    expect(updates.map((ops) => ops.find(([m]) => m === 'eq')?.[1][1])).toEqual([30, 10, 20])
  })

  it('reorder: un update que afecta 0 filas (id inexistente o RLS) tira 404, no "guarda" en silencio', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_concepts: [ok([])] } }).client)
    const { reorderCashConcepts } = await importModel()
    await expect(reorderCashConcepts([1, 2])).rejects.toMatchObject({ message: 'El concepto no existe', status: 404 })
  })

  it('update y setActive: concepto inexistente (0 filas) -> DomainError 404', async () => {
    const { updateCashConcept, setCashConceptActive } = await importModel()
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_concepts: [ok(null)] } }).client)
    await expect(updateCashConcept(99, { name: 'Rifa' })).rejects.toMatchObject({ message: 'El concepto no existe', status: 404 })
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_concepts: [ok(null)] } }).client)
    await expect(setCashConceptActive(99, false)).rejects.toMatchObject({ message: 'El concepto no existe', status: 404 })
  })

  it('reorder: si una actualización falla, el error se propaga (no queda "guardado" a medias en silencio)', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_concepts: [fail('42501', 'permission denied')] } }).client)
    const { reorderCashConcepts } = await importModel()
    await expect(reorderCashConcepts([1, 2])).rejects.toMatchObject({ code: '42501' })
  })
})
