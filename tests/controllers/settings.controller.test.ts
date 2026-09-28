import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `settings.controller.ts`: `getSettingsPage` es una lectura combinada para
 * `/ajustes`. `(admin)/layout.tsx` ya bloquea la ruta a quien no es admin,
 * pero el controller vuelve a exigir el PERMISO `settings.manage`
 * (`requirePanelPermission`, que REDIRIGE, nunca tira: no hay try/catch acá).
 */

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

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

const { getSettingsPage } = await import('@/controllers/settings.controller')

beforeEach(() => {
  redirectMock.mockClear()
  requirePanelPermissionMock.mockReset()
  getSettingsMock.mockReset()
  listDisciplinesMock.mockReset()
  getFeePricesOverviewMock.mockReset()
  getBillingStatusMock.mockReset()
})

describe('getSettingsPage', () => {
  it('exige settings.manage; sin él, redirige (no tira)', async () => {
    requirePanelPermissionMock.mockImplementation(() => {
      throw new Error('REDIRECT:/')
    })
    await expect(getSettingsPage()).rejects.toThrow('REDIRECT:/')
    expect(requirePanelPermissionMock).toHaveBeenCalledWith('settings.manage')
    expect(getSettingsMock).not.toHaveBeenCalled()
  })

  it('con el permiso, compone settings + disciplinas (todas y solo activas) + feePrices + billing en paralelo', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'admin' })
    getSettingsMock.mockResolvedValue({ clubName: 'Club Naranja y Blanco', billingStartPeriod: '2026-09-01' })
    listDisciplinesMock
      .mockResolvedValueOnce([{ id: 1, name: 'Fútbol masculino', isActive: true, categories: [] }])
      .mockResolvedValueOnce([{ id: 1, name: 'Fútbol masculino', isActive: true, categories: [] }])
    getFeePricesOverviewMock.mockResolvedValue({ current: { default: null, byMemberType: [], byCategory: [] }, history: [] })
    getBillingStatusMock.mockResolvedValue({ active: true, startPeriod: '2026-09-01' })

    const page = await getSettingsPage()

    expect(page.settings.clubName).toBe('Club Naranja y Blanco')
    expect(listDisciplinesMock).toHaveBeenCalledWith({ includeInactive: true })
    expect(listDisciplinesMock).toHaveBeenCalledWith({ includeInactive: false })
    expect(page.feePrices.history).toEqual([])
    expect(page.billing.active).toBe(true)
  })
})
