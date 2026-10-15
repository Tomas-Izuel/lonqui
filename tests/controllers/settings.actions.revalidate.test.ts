import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signInAs } from '../stubs/sessions'

/**
 * Las actions de ajustes tienen que revalidar `('/ajustes', 'layout')`: con
 * `'layout'` se invalidan TODAS las pestañas hijas (/ajustes/cuotas|deportes|
 * caja|club). Con `revalidatePath('/ajustes')` a secas solo se invalidaba la
 * page `/ajustes`, que ahora es un redirect, y las pestañas mostrarían datos
 * viejos tras guardar.
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

const catalog = {
  createDiscipline: vi.fn(),
  updateDiscipline: vi.fn(),
  setDisciplineActive: vi.fn(),
  reorderDisciplines: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  setCategoryActive: vi.fn(),
  reorderCategories: vi.fn(),
}
vi.mock('@/models/catalogs.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/catalogs.model')>('@/models/catalogs.model')
  return { ...actual, ...catalog }
})
const updateSettingsMock = vi.fn()
vi.mock('@/models/settings.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/settings.model')>('@/models/settings.model')
  return { ...actual, updateSettings: updateSettingsMock }
})
const conceptModels = {
  createCashConcept: vi.fn(),
  updateCashConcept: vi.fn(),
  setCashConceptActive: vi.fn(),
  reorderCashConcepts: vi.fn(),
}
vi.mock('@/models/cash-concepts.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/cash-concepts.model')>('@/models/cash-concepts.model')
  return { ...actual, ...conceptModels }
})

const actions = await import('@/controllers/settings.actions')

beforeEach(() => {
  revalidatePathMock.mockReset()
  for (const m of [...Object.values(catalog), ...Object.values(conceptModels), updateSettingsMock]) m.mockReset().mockResolvedValue({})
  catalog.setCategoryActive.mockResolvedValue({ category: {}, activeMemberCount: 0 })
  signInAs(session, 'admin')
})
afterEach(() => vi.restoreAllMocks())

const cases: Array<[string, () => Promise<{ ok: boolean }>]> = [
  ['createDiscipline', () => actions.createDiscipline({ name: 'Disciplina de prueba' })],
  ['updateDiscipline', () => actions.updateDiscipline(1, { name: 'Disciplina de prueba' })],
  ['setDisciplineActive', () => actions.setDisciplineActive(1, false)],
  ['reorderDisciplines', () => actions.reorderDisciplines([1, 2])],
  ['createCategory', () => actions.createCategory({ disciplineId: 1, name: 'Categoría de prueba' })],
  ['updateCategory', () => actions.updateCategory(1, { name: 'Categoría de prueba' })],
  ['setCategoryActive', () => actions.setCategoryActive(1, false)],
  ['reorderCategories', () => actions.reorderCategories(1, [1, 2])],
  ['updateSettings', () => actions.updateSettings({ clubName: 'Club de prueba' })],
  ['createCashConcept', () => actions.createCashConcept({ name: 'Concepto de prueba' })],
  ['updateCashConcept', () => actions.updateCashConcept(1, { name: 'Concepto de prueba' })],
  ['setCashConceptActive', () => actions.setCashConceptActive(1, false)],
  ['reorderCashConcepts', () => actions.reorderCashConcepts([1, 2])],
]

describe("revalidatePath('/ajustes', 'layout') en el camino feliz", () => {
  it.each(cases)('%s', async (_name, run) => {
    const res = await run()
    expect(res.ok).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalledWith('/ajustes', 'layout')
    // Nunca la forma vieja: sin 'layout' no alcanza a las pestañas hijas.
    expect(revalidatePathMock.mock.calls.filter(([p, t]) => p === '/ajustes' && t === undefined)).toEqual([])
  })

  it('una validación fallida no revalida nada', async () => {
    const res = await actions.createDiscipline({ name: '' })
    expect(res.ok).toBe(false)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
