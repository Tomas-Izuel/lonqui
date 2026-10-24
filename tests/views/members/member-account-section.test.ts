import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Ficha: "Indicar desde cuándo debía" (pipeline 2026-10-24-pago-por-meses).
 * Render estático: el botón aparece o no según alta, saldo anterior vigente y
 * facturación; `OpeningBalanceMonths` en su estado inicial (sin fetch: los
 * efectos no corren en `renderToStaticMarkup`).
 */
vi.mock('@/controllers/payments.actions', () => ({ getPaymentMonthOptions: vi.fn(), createOpeningBalanceFromMonths: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/socios/1',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { MemberAccountSection } = await import('@/views/members/member-account-section')
const { OpeningBalanceMonths } = await import('@/views/members/opening-balance-months')
import type { BillingStatus, Fee, MemberAccount } from '@/models/types'

const ACCOUNT: MemberAccount = {
  memberId: 1,
  fullName: 'Fulano Inventado',
  status: 'active',
  memberType: 'non_practicing',
  categories: [],
  familyGroupId: null,
  isPaymentResponsible: false,
  chargedCents: 0,
  paidCents: 0,
  balanceCents: 0,
  monthsDue: 0,
  oldestDuePeriod: null,
  lastPaymentOn: null,
  lastPaymentCents: null,
  debtStatus: 'up_to_date',
  currentFeeCents: 1_000_000,
  currentFees: [],
  currentFeePeriod: '2026-10-01',
}

const BILLING = {
  active: true,
  startPeriod: '2026-10-01',
  currentPeriod: '2026-10-01',
  lastGeneratedPeriod: null,
  pendingPeriods: [],
  activeMembers: 1,
} as unknown as BillingStatus

const OPENING = { id: 4, memberId: 1, kind: 'opening_balance', amountCents: 3_000_000 } as Fee

function render(overrides: Partial<Parameters<typeof MemberAccountSection>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(MemberAccountSection, {
      memberId: 1,
      familyGroupId: null,
      joinedOn: '2025-03-10',
      account: ACCOUNT,
      openingBalance: null,
      billing: BILLING,
      canRegister: true,
      ...overrides,
    }),
  )
}

const CTA = 'Indicar desde cuándo debía'

describe('MemberAccountSection: "Indicar desde cuándo debía"', () => {
  it('sin saldo anterior, facturación activa y alta anterior al inicio: aparece', () => {
    expect(render()).toContain(CTA)
  })

  it('alta en el mismo mes del inicio: aparece (la cota es <=, igual que en la base)', () => {
    expect(render({ joinedOn: '2026-10-28' })).toContain(CTA)
  })

  it('alta posterior al mes de inicio: no aparece nada del saldo anterior', () => {
    const html = render({ joinedOn: '2026-11-02', billing: { ...BILLING, startPeriod: '2026-10-01', currentPeriod: '2026-11-01' } })
    expect(html).not.toContain(CTA)
    expect(html).not.toContain('saldo anterior')
  })

  it('con saldo anterior vigente: el texto "Ya tiene un saldo anterior" con su monto, sin el botón', () => {
    const html = render({ openingBalance: OPENING })
    expect(html).toContain('Ya tiene un saldo anterior cargado')
    expect(html).toMatch(/30\.000/)
    expect(html).not.toContain(CTA)
  })

  it('facturación inactiva o sin mes de inicio: no aparece', () => {
    expect(render({ billing: { ...BILLING, active: false } })).not.toContain(CTA)
    expect(render({ billing: { ...BILLING, startPeriod: null } })).not.toContain(CTA)
  })

  it('inicio en el futuro (todavía no empezó la facturación): no aparece', () => {
    expect(render({ billing: { ...BILLING, startPeriod: '2026-12-01', currentPeriod: '2026-10-01' } })).not.toContain(CTA)
  })

  it('sin payments.register (canRegister = false): no aparece, ni el saldo ya cargado', () => {
    expect(render({ canRegister: false })).not.toContain(CTA)
    expect(render({ canRegister: false, openingBalance: OPENING })).not.toContain('Ya tiene un saldo anterior')
  })

  it('ya no existe el formulario "Cargar saldo anterior" por monto', () => {
    expect(render()).not.toMatch(/Cargar saldo anterior/)
  })
})

describe('OpeningBalanceMonths', () => {
  it('arranca en estado de carga (sin fetch en el render) y ofrece cancelar sin haber cargado nada', () => {
    const html = renderToStaticMarkup(
      createElement(OpeningBalanceMonths, { memberId: 1, startPeriod: '2026-10-01', creditCents: 0, onCancel: () => {} }),
    )
    expect(html).not.toMatch(/Cargar saldo anterior de/)
    expect(html).not.toMatch(/aria-pressed/)
  })
})
