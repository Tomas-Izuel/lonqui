import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Render estático (Node, sin DOM) de la carga inicial por meses (pipeline
 * 2026-10-24-carga-inicial-meses, 00-architecture §7.4): grilla colapsada vs
 * abierta, "Cambiar"/"Listo", "queda debiendo", avisos de saldo existente y la
 * ayuda de arrastre. La interacción real (punteros, scroll, touch) NO es
 * testeable sin DOM: queda en la verificación manual de §11.
 * Mocks en el borde: Server Actions, Supabase y toasts.
 */
vi.mock('@/controllers/payments.actions', () => ({ registerPayment: vi.fn(), prepareReceiptUpload: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { MonthStrip } = await import('@/views/payments/month-strip')
const { PaymentForm } = await import('@/views/payments/payment-form')
const { GroupPaymentForm } = await import('@/views/payments/group-payment-form')
const { effectiveOptions, openingScope } = await import('@/views/payments/month-selection')
import type { ISODate, MemberAccount, PaymentMonthOption } from '@/models/types'

const P = 1_000_000

function opt(partial: Partial<PaymentMonthOption> & Pick<PaymentMonthOption, 'period' | 'kind'>): PaymentMonthOption {
  const amountCents = partial.amountCents ?? P
  const coveredCents = partial.coveredCents ?? 0
  return { memberId: 1, amountCents, coveredCents, pendingCents: amountCents - coveredCents, isCurrent: false, pricedAtToday: true, openingFrom: null, ...partial }
}

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
  oldestDuePeriod: '2026-09-01',
  lastPaymentOn: null,
  lastPaymentCents: null,
  debtStatus: 'in_debt',
  currentFeeCents: P,
  currentFees: [],
  currentFeePeriod: '2026-10-01',
}

/** sep y oct debidas (monthly), nov adelanto. Después del inicio. */
const DUE_TWO: PaymentMonthOption[] = [
  opt({ period: '2026-09-01', kind: 'monthly' }),
  opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
  opt({ period: '2026-11-01', kind: 'projected' }),
]

/** Antes del inicio: ene..oct previos (oct = actual), nov y dic proyectados. */
const CARGA: PaymentMonthOption[] = [
  ...Array.from({ length: 10 }, (_, i) =>
    opt({ period: `2026-${String(i + 1).padStart(2, '0')}-01` as ISODate, kind: 'pre_system', isCurrent: i === 9 }),
  ),
  opt({ period: '2026-11-01', kind: 'projected' }),
  opt({ period: '2026-12-01', kind: 'projected' }),
]

const cells = (html: string) => [...html.matchAll(/<li[^>]*><button([^>]*)>([\s\S]*?)<\/button><\/li>/g)].map((m) => ({ attrs: m[1], html: m[2] }))
const count = (html: string, text: string) => html.split(text).length - 1
const normalize = (html: string) => html.replace(/&nbsp;| /g, ' ')

describe('PaymentForm: grilla colapsada vs abierta', () => {
  const render = (billingStarted: boolean, options = DUE_TWO) =>
    normalize(renderToStaticMarkup(createElement(PaymentForm, { member: MEMBER, options, billingStarted, onDone: () => {} })))

  it('después del inicio: colapsada. Sin celdas, con resumen "1 mes · septiembre 2026" y botón "Cambiar"', () => {
    const html = render(true)
    expect(cells(html)).toHaveLength(0)
    expect(html).toMatch(/<p role="status"[^>]*>1 mes · septiembre 2026<\/p>/)
    expect(html).toContain('>Cambiar<')
    expect(html).not.toContain('>Listo<')
  })

  it('"Cambiar" es accesible: aria-expanded="false", aria-controls apunta a un contenedor que existe, target de 44px', () => {
    const html = render(true)
    const button = html.match(/<button[^>]*aria-expanded="false"[^>]*>Cambiar<\/button>/)?.[0]
    expect(button).toBeDefined()
    const controls = button!.match(/aria-controls="([^"]+)"/)?.[1]
    expect(controls).toBeTruthy()
    expect(html).toContain(`id="${controls}"`)
    expect(button).toMatch(/min-h-11/)
    expect(button).toContain('type="button"')
  })

  it('antes del inicio: abierta. Celdas, "Listo" con aria-expanded="true" y sin "Cambiar"', () => {
    const html = render(false)
    expect(cells(html)).toHaveLength(3)
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*>Listo<\/button>/)
    expect(html).not.toContain('>Cambiar<')
  })

  it('colapsada deja visible la línea "Queda debiendo 1 mes · $10.000" (octubre sigue adeudado)', () => {
    const html = render(true)
    expect(html).toMatch(/Queda debiendo 1 mes · \$\s?10\.000/)
    expect(count(html, 'Queda debiendo')).toBe(1)
  })

  it('el pago de todo lo adeudado no deja la línea "Queda debiendo"', () => {
    const options = [opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }), opt({ period: '2026-11-01', kind: 'projected' })]
    expect(render(true, options)).not.toContain('Queda debiendo')
  })

  it('el formulario sigue siendo method="post" y el pie fijo se mantiene pegado abajo', () => {
    for (const started of [true, false]) {
      const html = render(started)
      expect(html).toMatch(/<form[^>]*method="post"/i)
      expect(html).toContain('sticky -bottom-4')
    }
  })

  it('el pie no repite el resumen de meses: "1 mes · septiembre 2026" aparece una sola vez', () => {
    expect(count(render(true), '1 mes · septiembre 2026')).toBe(1)
  })
})

describe('avisos de saldo anterior existente (solo con la grilla abierta)', () => {
  const withSpan = [
    opt({ period: '2026-03-01', kind: 'opening_balance', openingFrom: '2026-01-01' as ISODate }),
    opt({ period: '2026-04-01', kind: 'opening_balance', openingFrom: '2026-01-01' as ISODate }),
    opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
  ]
  const legacy = [opt({ period: '2026-09-01', kind: 'opening_balance', amountCents: 3 * P }), opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true })]
  const render = (options: PaymentMonthOption[], billingStarted: boolean) =>
    normalize(renderToStaticMarkup(createElement(PaymentForm, { member: MEMBER, options, billingStarted, onDone: () => {} })))

  it('con tramo: dice desde qué mes arranca y que hay que anularlo para indicar meses anteriores', () => {
    const html = render(withSpan, false)
    expect(html).toContain('El saldo anterior de este socio arranca en enero 2026.')
    expect(html).toContain('un administrador tiene que anularlo desde la ficha y volver a cargarlo')
    expect(html).not.toContain('ya tiene un saldo anterior cargado')
  })

  it('legacy (sin tramo): el aviso de siempre, sin mes de arranque', () => {
    const html = render(legacy, false)
    expect(html).toContain('Este socio ya tiene un saldo anterior cargado.')
    expect(html).not.toContain('arranca en')
  })

  it('colapsada no se muestra ningún aviso', () => {
    for (const options of [withSpan, legacy]) {
      const html = render(options, true)
      expect(html).not.toContain('saldo anterior de este socio')
      expect(html).not.toContain('ya tiene un saldo anterior')
    }
  })

  it('sin saldo existente no hay aviso', () => {
    expect(render(DUE_TWO, false)).not.toContain('saldo anterior')
  })

  it('las celdas del saldo con tramo se ven como meses ("debe"), la legacy como "Saldo anterior · $X"', () => {
    const spanCells = cells(render(withSpan, false))
    expect(spanCells[0].html).toMatch(/debe/)
    expect(spanCells[0].html).not.toContain('Saldo anterior')
    const legacyCells = cells(render(legacy, false))
    expect(legacyCells[0].html).toMatch(/Saldo anterior · \$\s?30\.000/)
  })
})

describe('MonthStrip con tramo: "queda debiendo", total rotulado y ayuda de arrastre', () => {
  const selection = { startIndex: 0, endIndex: 5 }
  const ctx = { creditCents: 0 }
  const eff = effectiveOptions(CARGA, selection, ctx)
  const pre = (extra: Record<string, unknown> = {}) => ({
    open: true,
    startPeriod: '2026-11-01' as ISODate,
    overrideCents: null,
    onOverrideChange: () => {},
    beforeStart: true,
    hideBeforeStartNote: true,
    scope: openingScope(CARGA, selection, ctx, { payment: true }),
    ...extra,
  })
  const render = (extra: { onRange?: () => void; preSystem?: ReturnType<typeof pre> | null } = {}) =>
    normalize(
      renderToStaticMarkup(
        createElement(MonthStrip, { options: eff, selection, onTap: () => {}, preSystem: pre(), coverage: null, ...extra }),
      ),
    )

  it('ene–jun marcadas: jul..oct dicen "queda debiendo" con texto visible y para lectores de pantalla', () => {
    const c = cells(render())
    expect(c).toHaveLength(12)
    for (const i of [6, 7, 8, 9]) {
      expect(c[i].html).toContain('queda debiendo')
      expect(c[i].attrs).toContain('aria-pressed="false"')
    }
    for (const i of [0, 1, 2, 3, 4, 5]) {
      expect(c[i].html).not.toContain('queda debiendo')
      expect(c[i].attrs).toContain('aria-pressed="true"')
    }
    // Lector de pantalla: el mismo estado, no solo el color.
    expect(render()).toMatch(/julio 2026: queda debiendo/)
  })

  it('"queda debiendo" lleva ícono (no solo color)', () => {
    const c = cells(render())
    expect(c[6].html).toContain('<svg')
    expect(c[6].html).toMatch(/text-status-in-debt/)
  })

  it('el total se rotula con su alcance y la pista de pagó / queda debiendo', () => {
    const html = render()
    expect(html).toContain('Total de la deuda desde enero 2026 (10 meses)')
    expect(html).toMatch(/Pagó 6 meses · \$\s?60\.000\. Queda debiendo 4 meses · \$\s?40\.000\./)
    expect(html).toContain('Si debía otro valor, corregí el total.')
  })

  it('el campo del total arranca en la suma de las celdas (10 × $10.000)', () => {
    expect(render()).toMatch(/value="100\.000"/)
  })

  it('todo el tramo marcado: la pista no dice "Queda debiendo"', () => {
    const all = { startIndex: 0, endIndex: 9 }
    const scope = openingScope(CARGA, all, ctx, { payment: true })
    const html = normalize(
      renderToStaticMarkup(
        createElement(MonthStrip, {
          options: effectiveOptions(CARGA, all, ctx),
          selection: all,
          onTap: () => {},
          preSystem: pre({ scope }),
          coverage: null,
        }),
      ),
    )
    expect(html).toMatch(/Pagó 10 meses/)
    expect(html).not.toContain('Queda debiendo')
    expect(html).not.toContain('queda debiendo')
  })

  it('en la ficha (payment false) la pista no dice "Pagó"', () => {
    const scope = openingScope(CARGA, selection, ctx, { payment: false })
    const html = render({ preSystem: pre({ scope }) })
    expect(html).toContain('Total de la deuda desde enero 2026 (10 meses)')
    expect(html).not.toContain('Pagó')
    expect(html).toMatch(/10 meses a la cuota de hoy\./)
  })

  it('ayuda de arrastre: con onRange y celdas previas abiertas aparece, en las dos variantes (mouse y dedo)', () => {
    const html = render({ onRange: () => {} })
    expect(html).toContain('Tocá el primer y el último mes, o arrastrá.')
    expect(html).toContain('Tocá el primer y el último mes, o mantené apretado y arrastrá.')
    expect(html).toContain('pointer-coarse:hidden')
  })

  it('sin onRange (la ficha) no hay ayuda de arrastre ni clases de arrastre', () => {
    const html = render()
    expect(html).not.toContain('arrastr')
    expect(html).not.toContain('touch-pan-y')
    expect(html).not.toContain('touch-callout')
  })

  it('con onRange la grilla bloquea la selección de texto y el gesto de pantalla del dedo', () => {
    const html = render({ onRange: () => {} })
    expect(html).toContain('[-webkit-touch-callout:none]')
    expect(html).toContain('touch-pan-y')
  })

  it('tira deshabilitada: no hay arrastre aunque haya onRange', () => {
    const html = normalize(
      renderToStaticMarkup(createElement(MonthStrip, { options: eff, selection, onTap: () => {}, onRange: () => {}, preSystem: pre(), coverage: null, disabled: true })),
    )
    expect(html).not.toContain('arrastr')
  })

  it('sin celdas previas no hay ayuda de arrastre', () => {
    const html = renderToStaticMarkup(
      createElement(MonthStrip, { options: DUE_TWO, selection: { startIndex: 0, endIndex: 0 }, onTap: () => {}, onRange: () => {}, preSystem: null, coverage: null }),
    )
    expect(html).not.toContain('arrastr')
  })

  it('con un saldo a favor que cubre ene y feb, esas celdas ya no se marcan: van como "cubierto" y deshabilitadas', () => {
    const credit = { creditCents: 2 * P }
    const effCredit = effectiveOptions(CARGA, selection, credit)
    const html = normalize(
      renderToStaticMarkup(createElement(MonthStrip, { options: effCredit, selection, onTap: () => {}, preSystem: pre({ scope: openingScope(CARGA, selection, credit, { payment: true }) }), coverage: null })),
    )
    const c = cells(html)
    expect(c[0].attrs).toContain('disabled')
    expect(c[0].html).toContain('cubierto')
    expect(c[1].attrs).toContain('disabled')
    expect(c[2].attrs).toContain('aria-pressed="true"')
  })
})

describe('GroupPaymentForm: colapsado por defecto, con resumen y "Cambiar" por integrante', () => {
  const group = { id: 1, name: null, payerContactName: null, payerContactPhone: null, notes: null, label: 'Grupo Inventado', members: [], missingResponsible: false }
  const members = [1, 2].map((id) => ({ ...MEMBER, memberId: id, fullName: `Integrante ${id} Inventado`, isPaymentResponsible: id === 1 }))
  const monthOptions = Object.fromEntries(members.map((m) => [m.memberId, DUE_TWO.map((o) => ({ ...o, memberId: m.memberId }))]))

  it('sin celdas, un "Cambiar" con aria-expanded="false" por integrante y la deuda restante de cada uno', () => {
    const html = normalize(renderToStaticMarkup(createElement(GroupPaymentForm, { members, monthOptions, familyGroup: group, onDone: () => {} })))
    expect(cells(html)).toHaveLength(0)
    expect(count(html, '>Cambiar<')).toBe(2)
    expect(count(html, 'aria-expanded="false"')).toBe(2)
    expect(count(html, 'Queda debiendo 1 mes')).toBe(2)
  })

  it('el formulario de grupo sigue siendo method="post"', () => {
    const html = renderToStaticMarkup(createElement(GroupPaymentForm, { members, monthOptions, familyGroup: group, onDone: () => {} }))
    expect(html).toMatch(/<form[^>]*method="post"/i)
  })
})
