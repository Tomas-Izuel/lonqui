import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Render estático (Node, sin DOM) de la tira de meses y del formulario de pago
 * (pipeline 2026-10-24-pago-por-meses). Solo se prueba lo que sale en el HTML
 * inicial: la interacción (taps, "Otro monto") vive en `month-selection`, que
 * tiene sus unit tests. Mocks en el borde: Server Actions, Storage y toasts.
 */
vi.mock('@/controllers/payments.actions', () => ({ registerPayment: vi.fn(), prepareReceiptUpload: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { MonthStrip } = await import('@/views/payments/month-strip')
const { PaymentForm } = await import('@/views/payments/payment-form')
import type { MemberAccount, PaymentMonthOption } from '@/models/types'

const P = 1_000_000

function opt(partial: Partial<PaymentMonthOption> & Pick<PaymentMonthOption, 'period' | 'kind'>): PaymentMonthOption {
  const amountCents = partial.amountCents ?? P
  const coveredCents = partial.coveredCents ?? 0
  return { memberId: 1, amountCents, coveredCents, pendingCents: amountCents - coveredCents, isCurrent: false, pricedAtToday: true, ...partial }
}

/** ago debe · sep pagado · oct actual · nov adelanto al valor de hoy · dic adelanto con valor programado ($15.000) */
const OPTIONS: PaymentMonthOption[] = [
  opt({ period: '2026-08-01', kind: 'monthly' }),
  opt({ period: '2026-09-01', kind: 'monthly', coveredCents: P }),
  opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
  opt({ period: '2026-11-01', kind: 'projected' }),
  opt({ period: '2026-12-01', kind: 'projected', amountCents: 1_500_000, pricedAtToday: false }),
]

const MEMBER: MemberAccount = {
  memberId: 1,
  fullName: 'Fulano Inventado',
  status: 'active',
  memberType: 'non_practicing',
  categories: [],
  familyGroupId: null,
  isPaymentResponsible: false,
  chargedCents: 2 * P,
  paidCents: 0,
  balanceCents: 2 * P,
  monthsDue: 2,
  oldestDuePeriod: '2026-08-01',
  lastPaymentOn: null,
  lastPaymentCents: null,
  debtStatus: 'in_debt',
  currentFeeCents: P,
  currentFees: [],
  currentFeePeriod: '2026-10-01',
}

function strip(selection: { startIndex: number; endIndex: number } | null, extra?: Record<string, unknown>) {
  return renderToStaticMarkup(
    createElement(MonthStrip, { options: OPTIONS, selection, onTap: () => {}, preSystem: null, coverage: null, ...extra }),
  )
}

/** Los <button> de las celdas, como `{ attrs, html }`. */
function cells(html: string) {
  return [...html.matchAll(/<li[^>]*><button([^>]*)>([\s\S]*?)<\/button><\/li>/g)].map((m) => ({ attrs: m[1], html: m[2] }))
}

describe('MonthStrip', () => {
  it('aria-pressed="true" solo en las celdas marcadas; las no marcadas elegibles, "false"', () => {
    const c = cells(strip({ startIndex: 0, endIndex: 2 }))
    expect(c).toHaveLength(5)
    expect(c[0].attrs).toContain('aria-pressed="true"') // agosto
    expect(c[2].attrs).toContain('aria-pressed="true"') // octubre
    expect(c[3].attrs).toContain('aria-pressed="false"') // noviembre
  })

  it('la celda pagada (pendiente 0) va deshabilitada, sin aria-pressed, aunque caiga dentro del rango', () => {
    const c = cells(strip({ startIndex: 0, endIndex: 2 }))
    expect(c[1].attrs).toContain('disabled')
    expect(c[1].attrs).not.toContain('aria-pressed')
    expect(c[0].attrs).not.toContain('disabled')
  })

  it('sr-only con mes, año y estado de cada celda', () => {
    const html = strip({ startIndex: 0, endIndex: 0 })
    const sr = [...html.matchAll(/<span class="sr-only">([^<]*)<\/span>/g)].map((m) => m[1])
    expect(sr).toHaveLength(5)
    expect(sr[0]).toMatch(/agosto 2026/i)
    expect(sr[0]).toMatch(/debe/)
    expect(sr[0]).toMatch(/marcado/)
    expect(sr[1]).toMatch(/pagado/)
    expect(sr[1]).toMatch(/no se puede marcar/)
    expect(sr[2]).toMatch(/este mes/)
  })

  it('el estado no depende solo del color: cada celda tiene texto de estado visible', () => {
    const c = cells(strip(null))
    for (const cell of c) expect(cell.html).toMatch(/debe|pagado|este mes|adelanto/)
  })

  it('un adelanto con valor programado distinto al de hoy dice su monto; el que está al valor de hoy no', () => {
    const c = cells(strip(null))
    expect(c[4].html).toMatch(/adelanto · \$\s?15\.000/)
    expect(c[3].html).not.toMatch(/adelanto ·/)
    expect(c[3].html).toMatch(/adelanto/)
  })

  it('con un adelanto al valor de hoy marcado avisa "se cobran al valor de hoy"; sin adelantos marcados, no', () => {
    expect(strip({ startIndex: 0, endIndex: 3 })).toContain('Los meses de adelanto se cobran al valor de hoy.')
    expect(strip({ startIndex: 0, endIndex: 2 })).not.toContain('al valor de hoy')
  })

  it('"Otro monto": con coverage, las celdas cubiertas quedan marcadas y la parcial dice cuánto cubre', () => {
    const html = strip({ startIndex: 0, endIndex: 0 }, { coverage: { fullyCovered: [0], partial: { index: 2, cents: 400_000 } } })
    const c = cells(html)
    expect(c[0].attrs).toContain('aria-pressed="true"')
    expect(c[2].attrs).toContain('aria-pressed="true"')
    expect(html).toMatch(/cubre \$\s?4\.000 de \$\s?10\.000/)
  })

  it('el pliegue de "antes del sistema" solo aparece con preSystem y celdas pre_system; cerrado no las muestra', () => {
    const options = [opt({ period: '2026-09-01', kind: 'pre_system' }), ...OPTIONS]
    const pre = { open: false, onToggle: () => {}, startPeriod: '2026-10-01', overrideCents: null, onOverrideChange: () => {} }
    const closed = renderToStaticMarkup(createElement(MonthStrip, { options, selection: null, onTap: () => {}, preSystem: pre, coverage: null }))
    expect(closed).toContain('¿Debe meses de antes de octubre 2026?')
    expect(cells(closed)).toHaveLength(5)
    const open = renderToStaticMarkup(createElement(MonthStrip, { options, selection: null, onTap: () => {}, preSystem: { ...pre, open: true }, coverage: null }))
    expect(cells(open)).toHaveLength(6)
    expect(open).toContain('antes del sistema')
    const noFold = renderToStaticMarkup(createElement(MonthStrip, { options, selection: null, onTap: () => {}, preSystem: null, coverage: null }))
    expect(noFold).not.toContain('¿Debe meses')
  })
})

describe('PaymentForm', () => {
  const render = (options: PaymentMonthOption[], member = MEMBER) =>
    renderToStaticMarkup(createElement(PaymentForm, { member, options, onDone: () => {} }))

  it('sin opciones: campo de monto (como antes) y ninguna tira', () => {
    const html = render([])
    expect(html).toMatch(/<label[^>]*>Monto<\/label>/)
    expect(html).not.toContain('Otro monto')
    expect(cells(html)).toHaveLength(0)
  })

  it('con opciones: la tira, "Otro monto" y el resumen en el pie; el monto sale derivado de la selección inicial', () => {
    const html = render(OPTIONS)
    expect(cells(html)).toHaveLength(5)
    expect(html).toContain('Otro monto')
    // Primer mes sin pagar (agosto) marcado por defecto: "1 mes · agosto 2026".
    expect(html).toMatch(/1 mes · agosto 2026/)
    expect(cells(html)[0].attrs).toContain('aria-pressed="true"')
    expect(html).not.toMatch(/<label[^>]*>Monto<\/label>/)
  })

  it('el botón nombra el monto derivado', () => {
    const html = render(OPTIONS)
    expect(html).toMatch(/Registrar pago de \$\s?10\.000/)
  })

  it('el formulario es method="post" y nunca por GET', () => {
    for (const options of [[], OPTIONS]) {
      const forms = [...render(options).matchAll(/<form[^>]*>/g)].map((m) => m[0])
      expect(forms.length).toBeGreaterThan(0)
      for (const f of forms) expect(f).toMatch(/method="post"/i)
    }
  })

  it('no hay confirmación de sobrepago en el render ni en el código del formulario', async () => {
    const html = render(OPTIONS)
    expect(html).not.toMatch(/supera la deuda|sobrepago|Confirmar/i)
    const { readFileSync } = await import('node:fs')
    for (const file of ['payment-form.tsx', 'group-payment-form.tsx']) {
      const src = readFileSync(new URL(`../../../src/views/payments/${file}`, import.meta.url), 'utf8')
      expect(src, file).not.toMatch(/window\.confirm|needsOverpayConfirm/)
    }
  })

  it('opciones con socio de baja con deuda: marca toda la deuda y el botón nombra ese total', () => {
    const inactive = { ...MEMBER, status: 'inactive' as const }
    const options = [opt({ period: '2026-08-01', kind: 'monthly' }), opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true })]
    const html = renderToStaticMarkup(createElement(PaymentForm, { member: inactive, options, onDone: () => {} }))
    expect(html).toMatch(/Registrar pago de \$\s?20\.000/)
  })

  it('el derivado en 0 (todo marcado ya cubierto por saldo a favor) deshabilita el botón', () => {
    const covered = [opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true, coveredCents: P })]
    // Sin celdas elegibles no hay selección: modo "Otro monto" y monto vacío; no hay un pago de $0 enviable.
    const html = render(covered, { ...MEMBER, balanceCents: -P, debtStatus: 'up_to_date' })
    expect(html).not.toMatch(/Registrar pago de \$\s?0/)
  })
})
