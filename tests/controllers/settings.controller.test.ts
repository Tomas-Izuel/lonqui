import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `settings.controller.ts`: `/ajustes` son cuatro pestañas con su propia page;
 * cada una tiene su lectura y carga SOLO lo suyo. Todas exigen el PERMISO
 * `settings.manage` (`requirePanelPermission`, que REDIRIGE, nunca tira) ANTES
 * de tocar un modelo: el layout `(admin)` no se re-ejecuta al navegar del lado
 * del cliente, así que este guard es el que cuenta.
 */

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))

const requirePanelPermissionMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({ requirePanelPermission: requirePanelPermissionMock }))

const getSettingsMock = vi.fn()
vi.mock('@/models/settings.model', () => ({ getSettings: getSettingsMock }))
const listDisciplinesMock = vi.fn()
vi.mock('@/models/catalogs.model', () => ({ listDisciplines: listDisciplinesMock }))
const getFeePricesOverviewMock = vi.fn()
vi.mock('@/models/fee-prices.model', () => ({ getFeePricesOverview: getFeePricesOverviewMock }))
const getBillingStatusMock = vi.fn()
vi.mock('@/models/billing.model', () => ({ getBillingStatus: getBillingStatusMock }))
const listCashConceptsMock = vi.fn()
vi.mock('@/models/cash-concepts.model', () => ({ listCashConcepts: listCashConceptsMock }))

const controller = await import('@/controllers/settings.controller')

const models = [getSettingsMock, listDisciplinesMock, getFeePricesOverviewMock, getBillingStatusMock, listCashConceptsMock]

beforeEach(() => {
  for (const m of [requirePanelPermissionMock, ...models]) m.mockReset()
  requirePanelPermissionMock.mockResolvedValue({ role: 'admin' })
})

const reads = {
  getAjustesCuotasData: controller.getAjustesCuotasData,
  getAjustesDeportesData: controller.getAjustesDeportesData,
  getAjustesCajaData: controller.getAjustesCajaData,
  getAjustesClubData: controller.getAjustesClubData,
}

describe('cada pestaña exige settings.manage antes de leer nada', () => {
  it.each(Object.entries(reads))('%s: sin el permiso redirige y no toca ningún modelo', async (_name, read) => {
    requirePanelPermissionMock.mockImplementation(() => {
      throw new Error('REDIRECT:/')
    })
    await expect(read()).rejects.toThrow('REDIRECT:/')
    expect(requirePanelPermissionMock).toHaveBeenCalledWith('settings.manage')
    for (const m of models) expect(m).not.toHaveBeenCalled()
  })

  it.each(Object.entries(reads))('%s: con el permiso lo pide exactamente una vez, por permiso y no por rol', async (_name, read) => {
    listDisciplinesMock.mockResolvedValue([])
    await read().catch(() => {})
    expect(requirePanelPermissionMock).toHaveBeenCalledTimes(1)
    expect(requirePanelPermissionMock).toHaveBeenCalledWith('settings.manage')
  })
})

describe('getAjustesCuotasData', () => {
  it('compone valores, facturación y disciplinas (todas para etiquetar, solo activas para "Nuevo valor")', async () => {
    const all = [{ id: 1, name: 'A', isActive: false, categories: [] }]
    const active = [{ id: 2, name: 'B', isActive: true, categories: [] }]
    listDisciplinesMock.mockImplementation(async (o: { includeInactive: boolean }) => (o.includeInactive ? all : active))
    getFeePricesOverviewMock.mockResolvedValue({ current: { default: null, byMemberType: [], byCategory: [] }, history: [] })
    getBillingStatusMock.mockResolvedValue({ active: true, startPeriod: '2026-09-01' })

    const data = await controller.getAjustesCuotasData()

    expect(data.disciplines).toBe(all)
    expect(data.categoriesByDiscipline).toBe(active)
    expect(data.feePrices.history).toEqual([])
    expect(data.billing.active).toBe(true)
  })

  it('no carga lo de otras pestañas (conceptos, datos del club)', async () => {
    listDisciplinesMock.mockResolvedValue([])
    await controller.getAjustesCuotasData()
    expect(listCashConceptsMock).not.toHaveBeenCalled()
    expect(getSettingsMock).not.toHaveBeenCalled()
  })
})

describe('getAjustesDeportesData', () => {
  it('trae TODAS las disciplinas, incluidas las inactivas, y nada más', async () => {
    const all = [{ id: 1, name: 'A', isActive: false, categories: [] }]
    listDisciplinesMock.mockResolvedValue(all)
    const data = await controller.getAjustesDeportesData()
    expect(data).toEqual({ disciplines: all })
    expect(listDisciplinesMock).toHaveBeenCalledTimes(1)
    expect(listDisciplinesMock).toHaveBeenCalledWith({ includeInactive: true })
    for (const m of [getSettingsMock, getFeePricesOverviewMock, getBillingStatusMock, listCashConceptsMock]) expect(m).not.toHaveBeenCalled()
  })
})

describe('getAjustesCajaData', () => {
  it('trae TODOS los conceptos, incluidos los desactivados (acá se administra el catálogo)', async () => {
    listCashConceptsMock.mockResolvedValue([{ id: 1, name: 'Sponsor', isActive: false }])
    const data = await controller.getAjustesCajaData()
    expect(listCashConceptsMock).toHaveBeenCalledWith({ includeInactive: true })
    expect(data).toEqual({ incomeConcepts: [{ id: 1, name: 'Sponsor', isActive: false }] })
    for (const m of [getSettingsMock, listDisciplinesMock, getFeePricesOverviewMock, getBillingStatusMock]) expect(m).not.toHaveBeenCalled()
  })
})

describe('getAjustesClubData', () => {
  it('trae solo los datos del club', async () => {
    getSettingsMock.mockResolvedValue({ clubName: 'Club de prueba', billingStartPeriod: null })
    const data = await controller.getAjustesClubData()
    expect(data).toEqual({ settings: { clubName: 'Club de prueba', billingStartPeriod: null } })
    for (const m of [listDisciplinesMock, getFeePricesOverviewMock, getBillingStatusMock, listCashConceptsMock]) expect(m).not.toHaveBeenCalled()
  })
})

describe('contrato: la lectura combinada vieja no existe', () => {
  it('getSettingsPage fue reemplazado por las cuatro lecturas', () => {
    expect('getSettingsPage' in controller).toBe(false)
  })
})
