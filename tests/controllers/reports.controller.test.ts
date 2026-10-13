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
const getCashMonthSummaryMock = vi.fn()
vi.mock('@/models/reports.model', () => ({
  getDashboardSummary: getDashboardSummaryMock,
  getMonthCollection: getMonthCollectionMock,
  getMonthlyHistory: getMonthlyHistoryMock,
  listDebtByCategory: listDebtByCategoryMock,
  listMemberAccounts: listMemberAccountsMock,
  listTopDebtors: listTopDebtorsMock,
  getDailyCollection: getDailyCollectionMock,
  getCashMonthSummary: getCashMonthSummaryMock,
}))

const { getDashboard, getCajaHub, getDebtListing, getUpToDateListing, getDebtByCategoryPage } = await import(
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
  getCashMonthSummaryMock.mockReset()
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

describe('getCajaHub', () => {
  it('exige payments.read + income.read + reports.read (los tres, todos juntos)', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    getCashMonthSummaryMock.mockResolvedValue({ period: '2026-09-01' })
    getDashboardSummaryMock.mockResolvedValue({ totalDebtCents: 0 })
    getBillingStatusMock.mockResolvedValue({ active: true })
    getDailyCollectionMock.mockResolvedValue([])
    await getCajaHub()
    expect(requirePanelPermissionMock).toHaveBeenCalledWith('payments.read', 'income.read', 'reports.read')
  })

  it('sin alguno de los permisos redirige y no toca la base', async () => {
    requirePanelPermissionMock.mockImplementation(() => {
      throw new Error('REDIRECT:/')
    })
    await expect(getCajaHub()).rejects.toThrow('REDIRECT:/')
    expect(getCashMonthSummaryMock).not.toHaveBeenCalled()
    expect(getDashboardSummaryMock).not.toHaveBeenCalled()
    expect(getBillingStatusMock).not.toHaveBeenCalled()
    expect(getDailyCollectionMock).not.toHaveBeenCalled()
  })

  it('devuelve { cash, summary, billing, daily }: la deuda sale de dashboard_summary, sin recalcular', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    getCashMonthSummaryMock.mockResolvedValue({ period: '2026-09-01', totalCents: 700 })
    getDashboardSummaryMock.mockResolvedValue({ totalDebtCents: 1234, membersInDebt: 3 })
    getBillingStatusMock.mockResolvedValue({ active: true, currentPeriodRun: 'ok' })
    getDailyCollectionMock.mockResolvedValue([{ day: '2026-09-01', collectedCents: 100, cumulativeCents: 100 }])
    const data = await getCajaHub()
    expect(data).toEqual({
      cash: { period: '2026-09-01', totalCents: 700 },
      summary: { totalDebtCents: 1234, membersInDebt: 3 },
      billing: { active: true, currentPeriodRun: 'ok' },
      daily: [{ day: '2026-09-01', collectedCents: 100, cumulativeCents: 100 }],
    })
  })

  it('pide las cuatro lecturas en paralelo (Promise.all), no en cascada', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    // Ninguna se resuelve hasta que el test lo decide: si alguna se pidiera
    // recién después de esperar a otra, su mock no habría sido invocado todavía.
    const resolvers: Array<(v: unknown) => void> = []
    for (const mock of [getCashMonthSummaryMock, getDashboardSummaryMock, getBillingStatusMock, getDailyCollectionMock]) {
      mock.mockReturnValue(new Promise((r) => resolvers.push(r)))
    }

    const pending = getCajaHub()
    await Promise.resolve()

    expect(getCashMonthSummaryMock).toHaveBeenCalled()
    expect(getDashboardSummaryMock).toHaveBeenCalled()
    expect(getBillingStatusMock).toHaveBeenCalled()
    expect(getDailyCollectionMock).toHaveBeenCalled()

    resolvers[0]({ period: 'c' })
    resolvers[1]({ period: 's' })
    resolvers[2]({ period: 'b' })
    resolvers[3]([])
    await expect(pending).resolves.toEqual({
      cash: { period: 'c' },
      summary: { period: 's' },
      billing: { period: 'b' },
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
