import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `reports.controller.ts`: lecturas del panel inicial y la cobranza. Ningún
 * controller de este archivo escribe. Cada función re-verifica el permiso
 * ANTES de tocar la base (T12), aunque las RPC ya lo hagan en el cuerpo:
 * `requirePanelPermission` REDIRIGE (no hay try/catch, se deja propagar).
 */

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const requirePanelPermissionMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({ requirePanelPermission: requirePanelPermissionMock }))

const getBillingStatusMock = vi.fn()
vi.mock('@/models/billing.model', () => ({ getBillingStatus: getBillingStatusMock }))

const getDashboardSummaryMock = vi.fn()
const getMonthCollectionMock = vi.fn()
const getMonthlyHistoryMock = vi.fn()
const listDebtByCategoryMock = vi.fn()
const listMemberAccountsMock = vi.fn()
const listTopDebtorsMock = vi.fn()
const getDailyCollectionMock = vi.fn()
vi.mock('@/models/reports.model', () => ({
  getDashboardSummary: getDashboardSummaryMock,
  getMonthCollection: getMonthCollectionMock,
  getMonthlyHistory: getMonthlyHistoryMock,
  listDebtByCategory: listDebtByCategoryMock,
  listMemberAccounts: listMemberAccountsMock,
  listTopDebtors: listTopDebtorsMock,
  getDailyCollection: getDailyCollectionMock,
}))

const { getDashboard, getCobranzaHub, getDebtListing, getUpToDateListing, getDebtByCategoryPage } = await import(
  '@/controllers/reports.controller'
)

beforeEach(() => {
  redirectMock.mockClear()
  requirePanelPermissionMock.mockReset()
  getBillingStatusMock.mockReset()
  getDashboardSummaryMock.mockReset()
  getMonthCollectionMock.mockReset()
  getMonthlyHistoryMock.mockReset()
  listDebtByCategoryMock.mockReset()
  listMemberAccountsMock.mockReset()
  listTopDebtorsMock.mockReset()
  getDailyCollectionMock.mockReset()
})

describe('getDashboard', () => {
  it('exige reports.read; sin él, redirige', async () => {
    requirePanelPermissionMock.mockImplementation(() => {
      throw new Error('REDIRECT:/')
    })
    await expect(getDashboard()).rejects.toThrow('REDIRECT:/')
    expect(getDashboardSummaryMock).not.toHaveBeenCalled()
  })

  it('compone las cuatro lecturas + billing en paralelo, top 5 con el límite fijo', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    getDashboardSummaryMock.mockResolvedValue({ totalDebtCents: 1000 })
    listTopDebtorsMock.mockResolvedValue([])
    listDebtByCategoryMock.mockResolvedValue([])
    getMonthlyHistoryMock.mockResolvedValue([])
    getBillingStatusMock.mockResolvedValue({ active: true })

    const data = await getDashboard()

    expect(listTopDebtorsMock).toHaveBeenCalledWith(5)
    expect(getMonthlyHistoryMock).toHaveBeenCalledWith(12)
    expect(data).toEqual({
      summary: { totalDebtCents: 1000 },
      topDebtors: [],
      byCategory: [],
      history: [],
      billing: { active: true },
    })
  })
})

describe('getCobranzaHub', () => {
  it('exige payments.read (no reports.read)', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    getMonthCollectionMock.mockResolvedValue({ period: '2026-09-01' })
    getBillingStatusMock.mockResolvedValue({ active: true })
    getDailyCollectionMock.mockResolvedValue([])
    await getCobranzaHub()
    expect(requirePanelPermissionMock).toHaveBeenCalledWith('payments.read')
  })

  it('devuelve collection + billing + daily (ritmo de cobranza del mes, addendum B1)', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    getMonthCollectionMock.mockResolvedValue({ period: '2026-09-01', collectedCents: 500 })
    getBillingStatusMock.mockResolvedValue({ active: true, currentPeriodRun: 'ok' })
    getDailyCollectionMock.mockResolvedValue([{ day: '2026-09-01', collectedCents: 100, cumulativeCents: 100 }])
    const data = await getCobranzaHub()
    expect(data).toEqual({
      collection: { period: '2026-09-01', collectedCents: 500 },
      billing: { active: true, currentPeriodRun: 'ok' },
      daily: [{ day: '2026-09-01', collectedCents: 100, cumulativeCents: 100 }],
    })
  })

  it('pide daily en paralelo con collection/billing (Promise.all), no en cascada', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    // Ninguna de las tres se resuelve hasta que este test lo decide: si
    // `getDailyCollection` se llamara recién DESPUÉS de esperar a las otras
    // dos (cascada en vez de `Promise.all`), `getDailyCollectionMock` todavía
    // no habría sido invocada en este punto.
    let resolveCollection: (v: unknown) => void = () => {}
    let resolveBilling: (v: unknown) => void = () => {}
    let resolveDaily: (v: unknown) => void = () => {}
    getMonthCollectionMock.mockReturnValue(new Promise((r) => (resolveCollection = r)))
    getBillingStatusMock.mockReturnValue(new Promise((r) => (resolveBilling = r)))
    getDailyCollectionMock.mockReturnValue(new Promise((r) => (resolveDaily = r)))

    const pending = getCobranzaHub()
    await Promise.resolve() // deja correr los microtasks hasta el primer punto de espera real

    expect(getMonthCollectionMock).toHaveBeenCalled()
    expect(getBillingStatusMock).toHaveBeenCalled()
    expect(getDailyCollectionMock).toHaveBeenCalled()

    resolveCollection({ period: '2026-09-01' })
    resolveBilling({ active: true })
    resolveDaily([])
    await expect(pending).resolves.toEqual({
      collection: { period: '2026-09-01' },
      billing: { active: true },
      daily: [],
    })
  })
})

describe('getDebtListing / getUpToDateListing', () => {
  it('getDebtListing exige payments.read y fuerza debt=in_debt sin importar lo que venga en filters', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    listMemberAccountsMock.mockResolvedValue({ items: [], nextCursor: null })
    await getDebtListing({ categoryId: 5 })
    expect(requirePanelPermissionMock).toHaveBeenCalledWith('payments.read')
    expect(listMemberAccountsMock).toHaveBeenCalledWith({ categoryId: 5, debt: 'in_debt' })
  })

  it('getUpToDateListing fuerza debt=up_to_date', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    listMemberAccountsMock.mockResolvedValue({ items: [], nextCursor: null })
    await getUpToDateListing()
    expect(listMemberAccountsMock).toHaveBeenCalledWith({ debt: 'up_to_date' })
  })
})

describe('getDebtByCategoryPage', () => {
  it('exige payments.read', async () => {
    requirePanelPermissionMock.mockImplementation(() => {
      throw new Error('REDIRECT:/')
    })
    await expect(getDebtByCategoryPage()).rejects.toThrow('REDIRECT:/')
  })

  it('totalCents sale de dashboard_summary.total_debt_cents, NUNCA de sumar las filas en TS', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    // A propósito: la suma "real" de las filas (10 + 20 = 30) es DISTINTA del
    // total que manda el resumen (999999). Si el controller alguna vez
    // empezara a sumar `rows` con `reduce`/`sumCents` en vez de tomar el
    // campo de `dashboard_summary`, este test detecta la regresión.
    listDebtByCategoryMock.mockResolvedValue([
      { categoryId: 1, debtCents: 10 },
      { categoryId: 2, debtCents: 20 },
    ])
    getDashboardSummaryMock.mockResolvedValue({ totalDebtCents: 999_999 })

    const page = await getDebtByCategoryPage()

    expect(page.totalCents).toBe(999_999)
    expect(page.rows).toHaveLength(2)
  })
})
