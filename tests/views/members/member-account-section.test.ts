import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Ficha: "Indicar desde cuándo debía" (pipeline 2026-10-24-pago-por-meses).
 * Render estático: el botón aparece o no según alta, saldo anterior vigente y
 * facturación; `OpeningBalanceMonths` en su estado inicial (sin fetch: los
 * efectos no corren en `renderToStaticMarkup`).
 */
vi.mock('@/controllers/payments.actions', () => ({ getPaymentMonthOptions: vi.fn(), createOpeningBalanceMonths: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/socios/1',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { MemberAccountSection } = await import('@/views/members/member-account-section')
const { OpeningBalanceMonths } = await import('@/views/members/opening-balance-months')
import type { BillingStatus, Fee, FeeStatementLine, MemberAccount } from '@/models/types'

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

const fee = (id: number, period: string, amountCents = 1_000_000) => ({ id, memberId: 1, kind: 'opening_balance', period, amountCents }) as Fee
/** Saldo anterior de tres meses sueltos (con hueco): mar, abr y jun. */
const OPENING: Fee[] = [fee(4, '2026-03-01'), fee(5, '2026-04-01'), fee(6, '2026-06-01', 1_500_000)]
const line = (feeId: number, status: string) => ({ feeId, period: '2026-03-01', kind: 'opening_balance', status }) as unknown as FeeStatementLine

function render(overrides: Partial<Parameters<typeof MemberAccountSection>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(MemberAccountSection, {
      memberId: 1,
      familyGroupId: null,
      joinedOn: '2025-03-10',
      account: ACCOUNT,
      openingBalances: [],
      statement: [],
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

  it('con saldo anterior: "Saldo anterior · <meses con huecos> · $Σ · N meses pagos" y el botón pasa a "Agregar meses anteriores"', () => {
    const html = render({ openingBalances: OPENING, statement: [line(4, 'paid'), line(5, 'paid'), line(6, 'due')] }).replace(/&nbsp;|\u00a0/g, ' ')
    expect(html).toContain('Saldo anterior')
    expect(html).toContain('marzo, abril y junio 2026') // los huecos no se esconden
    expect(html).toMatch(/35\.000/) // 10.000 + 10.000 + 15.000
    expect(html).toContain('2 meses pagos')
    expect(html).toContain('Agregar meses anteriores')
    expect(html).not.toContain(CTA)
    expect(html).not.toContain('Ya tiene un saldo anterior cargado')
  })

  it('"1 mes pago" en singular y "0 meses pagos" cuando ninguno se cubrió', () => {
    expect(render({ openingBalances: OPENING, statement: [line(4, 'paid')] })).toContain('1 mes pago')
    expect(render({ openingBalances: OPENING, statement: [line(4, 'partial')] })).toContain('0 meses pagos')
  })

  it('un cargo pago que NO es saldo anterior no cuenta como "mes pago" del saldo', () => {
    const other = { feeId: 99, status: 'paid', kind: 'monthly', period: '2026-10-01' } as unknown as FeeStatementLine
    expect(render({ openingBalances: OPENING, statement: [other] })).toContain('0 meses pagos')
  })

  it('facturación inactiva o sin mes de inicio: no aparece', () => {
    expect(render({ billing: { ...BILLING, active: false } })).not.toContain(CTA)
    expect(render({ billing: { ...BILLING, startPeriod: null } })).not.toContain(CTA)
  })

  it('inicio en el futuro (todavía no empezó la facturación): SÍ aparece, el mes actual ya es "antes del sistema"', () => {
    expect(render({ billing: { ...BILLING, startPeriod: '2026-12-01', currentPeriod: '2026-10-01' } })).toContain(CTA)
  })

  it('inicio en el futuro pero sin payments.register o con saldo anterior vigente: igual no aparece el botón', () => {
    const future = { ...BILLING, startPeriod: '2026-12-01', currentPeriod: '2026-10-01' }
    expect(render({ billing: future, canRegister: false })).not.toContain(CTA)
    // con saldo anterior el botón existe pero con otro texto: "Indicar desde cuándo" ya no
    expect(render({ billing: future, openingBalances: OPENING })).not.toContain(CTA)
  })

  it('sin payments.register (canRegister = false): no aparece, ni el saldo ya cargado', () => {
    expect(render({ canRegister: false })).not.toContain(CTA)
    expect(render({ canRegister: false, openingBalances: OPENING })).not.toContain('Agregar meses anteriores')
  })

  it('ya no existe el formulario "Cargar saldo anterior" por monto', () => {
    expect(render()).not.toMatch(/Cargar saldo anterior/)
  })
})

describe('OpeningBalanceMonths', () => {
  it('arranca en estado de carga (sin fetch en el render) y ofrece cancelar sin haber cargado nada', () => {
    const html = renderToStaticMarkup(
      createElement(OpeningBalanceMonths, { memberId: 1, joinedOn: '2025-03-10', startPeriod: '2026-10-01', hasOpeningBalance: false, creditCents: 0, onCancel: () => {} }),
    )
    expect(html).not.toMatch(/Cargar saldo anterior de/)
    expect(html).not.toMatch(/aria-pressed/)
  })
})

describe('MemberPaymentsList: "Cubre…" y "Saldo a favor"', () => {
  const alloc = (period: string, amountCents = 1_000_000) => ({ feeId: Number(period.slice(5, 7)), period, kind: 'monthly', amountCents, source: 'marked' })
  const pay = (over: Record<string, unknown>) =>
    ({
      id: 1, memberId: 1, amountCents: 2_000_000, paidOn: '2026-09-15', method: 'cash', hasReceipt: false, receiptFilename: null,
      notes: null, batchId: 'b', createdByName: 'Persona Inventada', createdAt: '2026-09-15T00:00:00Z', voidedAt: null, voidReason: null,
      allocations: [], ...over,
    }) as never
  async function html(payments: unknown[]) {
    const { MemberPaymentsList } = await import('@/views/members/member-payments-list')
    return renderToStaticMarkup(createElement(MemberPaymentsList, { payments: payments as never, canVoid: false })).replace(/&nbsp;|\u00a0/g, ' ')
  }

  it('hasta 3 meses: "Cubre mayo y julio 2026" con los huecos a la vista', async () => {
    const out = await html([pay({ allocations: [alloc('2026-05-01'), alloc('2026-07-01')] })])
    expect(out).toContain('Cubre mayo y julio 2026')
    expect(out).not.toContain('Saldo a favor')
  })

  it('más de 3 meses corridos: "Cubre 5 meses · enero a mayo 2026"; con huecos: "entre enero y mayo 2026"', async () => {
    const run = ['01', '02', '03', '04', '05'].map((m) => alloc(`2026-${m}-01`))
    expect(await html([pay({ amountCents: 5_000_000, allocations: run })])).toContain('Cubre 5 meses · enero a mayo 2026')
    const gaps = ['01', '02', '04', '05'].map((m) => alloc(`2026-${m}-01`))
    expect(await html([pay({ amountCents: 4_000_000, allocations: gaps })])).toContain('Cubre 4 meses · entre enero y mayo 2026')
  })

  it('monto mayor a lo imputado: "Saldo a favor $X" (con y sin "Cubre…"); todo saldo a favor no tiene línea de cobertura', async () => {
    const withBoth = await html([pay({ amountCents: 3_000_000, allocations: [alloc('2026-05-01'), alloc('2026-06-01')] })])
    expect(withBoth).toContain('Cubre mayo a junio 2026') // contiguos: rango
    expect(withBoth.replace(/<[^>]+>/g, '')).toMatch(/Saldo a favor\s*\$\s?10\.000/)
    const onlyCredit = await html([pay({ amountCents: 1_000_000 })])
    expect(onlyCredit.replace(/<[^>]+>/g, '')).toMatch(/Saldo a favor\s*\$\s?10\.000/)
    expect(onlyCredit).not.toContain('Cubre')
  })

  it('un pago anulado va tachado y sin detalle de cobertura, con su motivo', async () => {
    const out = await html([pay({ voidedAt: '2026-09-20T00:00:00Z', voidReason: 'Cargado por error', allocations: [alloc('2026-05-01')] })])
    expect(out).toContain('<s ')
    expect(out).toContain('Anulado · Cargado por error')
    expect(out).not.toContain('Cubre')
    expect(out).not.toContain('Saldo a favor')
  })
})

describe('MemberFeeStatement: saldo anterior por mes', () => {
  it('"Saldo anterior · <mes>" (sin "hasta")', async () => {
    const { MemberFeeStatement } = await import('@/views/members/member-fee-statement')
    const l = { feeId: 1, period: '2026-03-01', kind: 'opening_balance', description: null, amountCents: 1_000_000, coveredCents: 0, categoryId: null, categoryName: null, disciplineName: null, status: 'due', voidedAt: null, voidReason: null }
    const out = renderToStaticMarkup(createElement(MemberFeeStatement, { statement: [l] as never, canVoid: false }))
    expect(out).toContain('Saldo anterior · marzo 2026')
    expect(out).not.toMatch(/hasta/)
    expect(out).not.toContain('Anular')
    expect(renderToStaticMarkup(createElement(MemberFeeStatement, { statement: [l] as never, canVoid: true }))).toContain('Anular')
  })
})
