import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signedOut, signInAs, type TestRole } from '../stubs/sessions'

/**
 * Actions de conceptos de caja en `settings.actions.ts`: van por PERMISO
 * (`settings.manage`, solo admin), no por rol. Revalidan /ajustes (donde se
 * administran) y /caja entera (el formulario de ingreso y los filtros ofrecen
 * los conceptos activos). Las demás actions de ajustes no se tocan acá.
 */

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))
const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const getCurrentUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: getCurrentUserMock }))
const getOwnAppUserMock = vi.fn()
const getOwnPermissionsMock = vi.fn()
vi.mock('@/models/session.model', () => ({ getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }))
const session = { getCurrentUser: getCurrentUserMock, getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }

const createMock = vi.fn()
const updateMock = vi.fn()
const setActiveMock = vi.fn()
const reorderMock = vi.fn()
vi.mock('@/models/cash-concepts.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/cash-concepts.model')>('@/models/cash-concepts.model')
  return { ...actual, createCashConcept: createMock, updateCashConcept: updateMock, setCashConceptActive: setActiveMock, reorderCashConcepts: reorderMock }
})
// Los otros modelos que importa settings.actions no se ejercitan acá.
// `reorderSchema` es de catalogs.model y lo comparten los conceptos: el real; las escrituras del catálogo, fuera.
vi.mock('@/models/catalogs.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/catalogs.model')>('@/models/catalogs.model')
  return { ...actual, reorderDisciplines: vi.fn() }
})
vi.mock('@/models/settings.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/settings.model')>('@/models/settings.model')
  return { ...actual, updateSettings: vi.fn() }
})

const actions = await import('@/controllers/settings.actions')
const { DomainError } = await import('@/lib/errors')

beforeEach(() => {
  for (const m of [revalidatePathMock, createMock, updateMock, setActiveMock, reorderMock]) m.mockReset()
  signInAs(session, 'admin')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const DENIED = { ok: false, error: 'No tenés permiso para hacer esto' }
const concept = { id: 1, direction: 'income', name: 'Rifa', requiresSponsor: false, isActive: true, sortOrder: 1 }

describe('permisos: solo settings.manage (admin)', () => {
  it.each([
    ['consulta', false],
    ['editor', false],
    ['admin', true],
  ] as Array<[TestRole, boolean]>)('rol %s: administra conceptos = %s', async (role, allowed) => {
    signInAs(session, role)
    createMock.mockResolvedValue(concept)
    updateMock.mockResolvedValue(concept)
    setActiveMock.mockResolvedValue(concept)
    reorderMock.mockResolvedValue(undefined)

    const results = [
      await actions.createCashConcept({ name: 'Rifa' }),
      await actions.updateCashConcept(1, { name: 'Rifa' }),
      await actions.setCashConceptActive(1, false),
      await actions.reorderCashConcepts([1, 2]),
    ]

    for (const r of results) expect(r.ok).toBe(allowed)
    if (!allowed) {
      for (const r of results) expect(r).toEqual(DENIED)
      for (const m of [createMock, updateMock, setActiveMock, reorderMock]) expect(m).not.toHaveBeenCalled()
      expect(revalidatePathMock).not.toHaveBeenCalled()
    }
  })

  it('sin sesión: denegado', async () => {
    signedOut(session)
    expect((await actions.createCashConcept({ name: 'Rifa' })).ok).toBe(false)
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('revalidación', () => {
  it.each([
    ['createCashConcept', () => actions.createCashConcept({ name: 'Rifa' })],
    ['updateCashConcept', () => actions.updateCashConcept(1, { name: 'Rifa' })],
    ['setCashConceptActive', () => actions.setCashConceptActive(1, true)],
    ['reorderCashConcepts', () => actions.reorderCashConcepts([2, 1])],
  ])('%s revalida /ajustes y /caja (layout) tras escribir', async (_name, run) => {
    for (const m of [createMock, updateMock, setActiveMock]) m.mockResolvedValue(concept)
    reorderMock.mockResolvedValue(undefined)
    await run()
    expect(revalidatePathMock).toHaveBeenCalledWith('/ajustes', 'layout')
    expect(revalidatePathMock).toHaveBeenCalledWith('/caja', 'layout')
  })

  it('si el modelo falla no se revalida nada', async () => {
    createMock.mockRejectedValue(new Error('boom'))
    await actions.createCashConcept({ name: 'Rifa' })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('validación y errores', () => {
  it('crear: nombre corto con field name; direction no se acepta desde el cliente', async () => {
    expect(await actions.createCashConcept({ name: 'a' })).toMatchObject({ ok: false, field: 'name' })
    expect((await actions.createCashConcept({ name: 'Rifa', direction: 'expense' })).ok).toBe(false)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('crear pasa el nombre recortado y requiresSponsor al modelo', async () => {
    createMock.mockResolvedValue(concept)
    await actions.createCashConcept({ name: '  Rifa  ', requiresSponsor: true })
    expect(createMock).toHaveBeenCalledWith({ name: 'Rifa', requiresSponsor: true })
  })

  it('nombre repetido: el mensaje del modelo llega con su field', async () => {
    createMock.mockRejectedValue(new DomainError('Ya existe un concepto con ese nombre', { field: 'name' }))
    expect(await actions.createCashConcept({ name: 'Sponsor' })).toEqual({ ok: false, error: 'Ya existe un concepto con ese nombre', field: 'name' })
  })

  it('actualizar: id inválido y nombre inválido se rechazan sin tocar el modelo', async () => {
    expect((await actions.updateCashConcept(0, { name: 'Rifa' })).ok).toBe(false)
    expect((await actions.updateCashConcept(1.5, { name: 'Rifa' })).ok).toBe(false)
    expect(await actions.updateCashConcept(1, { name: '' })).toMatchObject({ ok: false, field: 'name' })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('activar/desactivar: id inválido o isActive que no es booleano, rechazado', async () => {
    expect((await actions.setCashConceptActive(-1, true)).ok).toBe(false)
    expect((await actions.setCashConceptActive(1, 'si' as unknown as boolean)).ok).toBe(false)
    expect(setActiveMock).not.toHaveBeenCalled()
  })

  it('reordenar: lista vacía o con ids inválidos, rechazada', async () => {
    expect((await actions.reorderCashConcepts([])).ok).toBe(false)
    expect((await actions.reorderCashConcepts([1, -2])).ok).toBe(false)
    expect(reorderMock).not.toHaveBeenCalled()
  })

  it('un error interno de la base se vuelve genérico (no se filtra el nombre de la constraint)', async () => {
    createMock.mockRejectedValue({ code: '23514', message: 'violates check constraint "cash_concepts_name_check"' })
    const result = await actions.createCashConcept({ name: 'Rifa' })
    expect(result).toEqual({ ok: false, error: 'No pudimos completar la operación. Probá de nuevo en un momento.' })
  })
})
