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
const { GroupPaymentForm } = await import('@/views/payments/group-payment-form')
import type { MemberAccount, PaymentMonthOption } from '@/models/types'

const P = 1_000_000

function opt(partial: Partial<PaymentMonthOption> & Pick<PaymentMonthOption, 'period' | 'kind'>): PaymentMonthOption {
  const amountCents = partial.amountCents ?? P
  const coveredCents = partial.coveredCents ?? 0
  return { memberId: 1, amountCents, coveredCents, pendingCents: amountCents - coveredCents, isCurrent: false, pricedAtToday: true, openingFrom: null, ...partial }
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

/**
 * Pipeline 2026-10-24-pago-por-meses-antes-del-inicio: la facturacion arranca en noviembre y hoy es octubre.
 * jul, ago, sep: previos · oct: previo Y actual · nov, dic: proyectados.
 */
const BEFORE_START: PaymentMonthOption[] = [
  opt({ period: '2026-07-01', kind: 'pre_system' }),
  opt({ period: '2026-08-01', kind: 'pre_system' }),
  opt({ period: '2026-09-01', kind: 'pre_system' }),
  opt({ period: '2026-10-01', kind: 'pre_system', isCurrent: true }),
  opt({ period: '2026-11-01', kind: 'projected' }),
  opt({ period: '2026-12-01', kind: 'projected' }),
]

describe('MonthStrip antes del inicio de la facturacion', () => {
  const pre = { open: true, startPeriod: '2026-11-01', overrideCents: null, onOverrideChange: () => {}, beforeStart: true }
  const render = (selection: { startIndex: number; endIndex: number } | null = { startIndex: 3, endIndex: 3 }) =>
    renderToStaticMarkup(createElement(MonthStrip, { options: BEFORE_START, selection, onTap: () => {}, preSystem: pre, coverage: null }))

  it('explica que las cuotas arrancan en el mes de inicio y que lo anterior es saldo anterior', () => {
    const html = render()
    expect(html).toContain('Las cuotas arrancan en noviembre 2026.')
    expect(html).toContain('saldo anterior')
  })

  it('no hay pliegue: ni el boton "¿Debe meses de antes de...?" ni aria-expanded', () => {
    const html = render()
    expect(html).not.toContain('¿Debe meses')
    expect(html).not.toContain('aria-expanded')
  })

  it('las 6 celdas se ven siempre (los previos no estan escondidos)', () => {
    expect(cells(render(null))).toHaveLength(6)
  })

  it('el mes actual (previo) dice "este mes" con ícono y para lectores de pantalla "este mes, antes del sistema"; los otros previos no', () => {
    const c = cells(render())
    expect(c[3].html).toContain('este mes')
    expect(c[3].html).toContain('<svg')
    expect(c[3].html).toContain('este mes, antes del sistema')
    expect(c[3].attrs).toContain('aria-pressed="true"')
    for (const i of [0, 1, 2]) {
      expect(c[i].html).not.toContain('este mes')
      expect(c[i].attrs).toContain('aria-pressed="false"')
    }
    // Sigue siendo celda previa: trazo punteado.
    expect(c[3].attrs).toContain('border-dashed')
  })

  it('sin beforeStart (despues del inicio) no aparece la linea explicativa', () => {
    const html = renderToStaticMarkup(
      createElement(MonthStrip, { options: BEFORE_START, selection: null, onTap: () => {}, preSystem: { ...pre, beforeStart: false, onToggle: () => {} }, coverage: null }),
    )
    expect(html).not.toContain('Las cuotas arrancan en')
  })
})

describe('PaymentForm antes del inicio de la facturacion', () => {
  const render = (member = MEMBER) =>
    renderToStaticMarkup(createElement(PaymentForm, { member, options: BEFORE_START, billingStarted: false, onDone: () => {} }))

  it('muestra la tira con los meses previos desde el primer render (sin tocar nada) y la linea explicativa', () => {
    const html = render()
    expect(cells(html)).toHaveLength(6)
    expect(html).toContain('Las cuotas arrancan en noviembre 2026.')
    expect(html).not.toContain('¿Debe meses')
    expect(html).not.toMatch(/<label[^>]*>Monto<\/label>/)
  })

  it('selecciona solo el mes actual: resumen "1 mes · octubre 2026" y boton con una cuota', () => {
    const html = render()
    const c = cells(html)
    expect(c.map((x) => x.attrs.includes('aria-pressed="true"'))).toEqual([false, false, false, true, false, false])
    expect(html).toMatch(/1 mes · octubre 2026/)
    expect(html).toMatch(/Registrar pago de \$\s?10\.000/)
  })

  it('socio de baja: misma seleccion inicial (el mes actual solo)', () => {
    const html = render({ ...MEMBER, status: 'inactive' as const })
    expect(html).toMatch(/1 mes · octubre 2026/)
    expect(html).toMatch(/Registrar pago de \$\s?10\.000/)
  })
})

/** Ronda 2: hoy octubre, inicio enero 2027. Los previos terminan en el mes actual. */
const FAR_START: PaymentMonthOption[] = [
  opt({ period: '2026-08-01', kind: 'pre_system' }),
  opt({ period: '2026-09-01', kind: 'pre_system' }),
  opt({ period: '2026-10-01', kind: 'pre_system', isCurrent: true }),
  opt({ period: '2027-01-01', kind: 'projected' }),
  opt({ period: '2027-02-01', kind: 'projected' }),
]

describe('antes del inicio, inicio a varios meses: el mes de inicio real viaja explicito', () => {
  it('PaymentForm con startPeriod = enero 2027: la linea dice enero (no noviembre, que seria ultimo previo + 1)', () => {
    const html = renderToStaticMarkup(createElement(PaymentForm, { member: MEMBER, options: FAR_START, startPeriod: '2027-01-01', billingStarted: false, onDone: () => {} }))
    expect(html).toContain('Las cuotas arrancan en enero 2027.')
    expect(html).not.toContain('Las cuotas arrancan en noviembre')
    expect(html).toMatch(/1 mes · octubre 2026/)
    expect(cells(html).map((x) => x.attrs.includes('aria-pressed="true"'))).toEqual([false, false, true, false, false])
  })

  it('sin startPeriod cae a la derivacion vieja (ultimo previo + 1): documentado, solo correcto con inicio al mes siguiente', () => {
    const html = renderToStaticMarkup(createElement(PaymentForm, { member: MEMBER, options: FAR_START, billingStarted: false, onDone: () => {} }))
    expect(html).toContain('Las cuotas arrancan en noviembre 2026.')
  })

  it('MonthStrip: hideBeforeStartNote oculta la linea pero deja las celdas', () => {
    const pre = { open: true, startPeriod: '2027-01-01', overrideCents: null, onOverrideChange: () => {}, beforeStart: true, hideBeforeStartNote: true }
    const html = renderToStaticMarkup(createElement(MonthStrip, { options: FAR_START, selection: null, onTap: () => {}, preSystem: pre, coverage: null }))
    expect(html).not.toContain('Las cuotas arrancan en')
    expect(cells(html)).toHaveLength(5)
  })
})

describe('GroupPaymentForm antes del inicio: la linea explicativa va UNA sola vez', () => {
  const group = { id: 1, name: null, payerContactName: null, payerContactPhone: null, notes: null, label: 'Grupo Inventado', members: [], missingResponsible: false }
  const members = [1, 2, 3].map((id) => ({ ...MEMBER, memberId: id, fullName: `Integrante ${id} Inventado`, isPaymentResponsible: id === 1 }))
  const monthOptions = Object.fromEntries(members.map((m) => [m.memberId, FAR_START.map((o) => ({ ...o, memberId: m.memberId }))]))
  const count = (html: string, text: string) => html.split(text).length - 1

  it('3 integrantes con startPeriod: la linea aparece una vez, con el inicio real, y cada integrante tiene su tira', () => {
    const html = renderToStaticMarkup(
      createElement(GroupPaymentForm, { members, monthOptions, familyGroup: group, startPeriod: '2027-01-01', onDone: () => {} }),
    )
    expect(count(html, 'Las cuotas arrancan en enero 2027.')).toBe(1)
    // En grupo la grilla arranca colapsada (N socios × grilla no entra en el sheet): una tira de resumen por integrante.
    expect(cells(html)).toHaveLength(0)
    expect(count(html, '>Cambiar<')).toBe(3)
    expect(count(html, '1 mes · octubre 2026')).toBe(3)
  })

  it('despues del inicio (sin celda previa actual) no hay linea', () => {
    const after = Object.fromEntries(members.map((m) => [m.memberId, OPTIONS.map((o) => ({ ...o, memberId: m.memberId }))]))
    const html = renderToStaticMarkup(
      createElement(GroupPaymentForm, { members, monthOptions: after, familyGroup: group, startPeriod: '2026-08-01', onDone: () => {} }),
    )
    expect(html).not.toContain('Las cuotas arrancan en')
  })
})

describe('PaymentForm', () => {
  // Grilla abierta (`billingStarted: false`): lo que se prueba acá es la tira. Colapsada, en su describe aparte.
  const render = (options: PaymentMonthOption[], member = MEMBER, billingStarted = false) =>
    renderToStaticMarkup(createElement(PaymentForm, { member, options, billingStarted, onDone: () => {} }))

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
    const html = renderToStaticMarkup(createElement(PaymentForm, { member: inactive, options, billingStarted: false, onDone: () => {} }))
    expect(html).toMatch(/Registrar pago de \$\s?20\.000/)
  })

  it('el derivado en 0 (todo marcado ya cubierto por saldo a favor) deshabilita el botón', () => {
    const covered = [opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true, coveredCents: P })]
    // Sin celdas elegibles no hay selección: modo "Otro monto" y monto vacío; no hay un pago de $0 enviable.
    const html = render(covered, { ...MEMBER, balanceCents: -P, debtStatus: 'up_to_date' })
    expect(html).not.toMatch(/Registrar pago de \$\s?0/)
  })
})
