import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `payments.controller.ts`: única lectura, la carga inicial (SSR) de los
 * pagos del mes para `/cobranza/pagos`. El "Ver más" es la Server Action
 * `loadMoreMonthPayments` (`payments.actions.test.ts`), que re-verifica con
 * `requirePermission` porque un redirect dentro de una action se tragaría
 * como error (mismo patrón que `getPadron` vs. `loadMoreMembers`).
 */

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`)
})
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const requirePanelPermissionMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({ requirePanelPermission: requirePanelPermissionMock }))

const getMonthPaymentsPageRowsMock = vi.fn()
vi.mock('@/models/payments.model', () => ({ getMonthPaymentsPage: getMonthPaymentsPageRowsMock }))

const { getMonthPaymentsPage } = await import('@/controllers/payments.controller')

beforeEach(() => {
  redirectMock.mockClear()
  requirePanelPermissionMock.mockReset()
  getMonthPaymentsPageRowsMock.mockReset()
})

describe('getMonthPaymentsPage', () => {
  it('exige payments.read; sin él, redirige (no tira)', async () => {
    requirePanelPermissionMock.mockImplementation(() => {
      throw new Error('REDIRECT:/')
    })
    await expect(getMonthPaymentsPage('2026-09-01')).rejects.toThrow('REDIRECT:/')
    expect(getMonthPaymentsPageRowsMock).not.toHaveBeenCalled()
  })

  it('pide la primera página (cursor null) del período pedido', async () => {
    requirePanelPermissionMock.mockResolvedValue({ role: 'consulta' })
    getMonthPaymentsPageRowsMock.mockResolvedValue({ items: [], nextCursor: null })

    const page = await getMonthPaymentsPage('2026-09-01')

    expect(getMonthPaymentsPageRowsMock).toHaveBeenCalledWith('2026-09-01', null)
    expect(page).toEqual({ items: [], nextCursor: null })
  })
})
