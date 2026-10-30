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
  return { memberId: 1, amountCents, coveredCents, pendingCents: amountCents - coveredCents, isCurrent: false, pricedAtToday: true, beforeJoined: false, ...partial }
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

// Reemplaza "avisos de saldo anterior existente": con el saldo por MES ya no hay un tramo único que avisar
// ("arranca en enero", "anulalo y volvé a cargarlo") ni un aviso de "ya tiene saldo". Cada mes de saldo es una
// celda de su mes; los previos sin fila siguen ofreciéndose y se pueden agregar.
describe('saldo anterior por mes en el formulario de pago', () => {
  const render = (options: PaymentMonthOption[], billingStarted: boolean) =>
    normalize(renderToStaticMarkup(createElement(PaymentForm, { member: MEMBER, options, billingStarted, onDone: () => {} })))
  const perMonth = [
    opt({ period: '2026-03-01', kind: 'opening_balance' }),
    opt({ period: '2026-04-01', kind: 'opening_balance' }),
    opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
  ]

  it('cada mes de saldo se ve como un mes adeudado ("debe"), sin avisos de tramo ni de "ya tiene un saldo"', () => {
    const html = render(perMonth, false)
    const c = cells(html)
    expect(c[0].html).toMatch(/debe/)
    expect(c[1].html).toMatch(/debe/)
    for (const gone of ['arranca en', 'anularlo desde la ficha', 'ya tiene un saldo anterior', 'Saldo anterior ·']) expect(html).not.toContain(gone)
  })

  it('un mes de saldo suelto se marca solo (conjunto), sin arrastrar a los otros', () => {
    const html = normalize(
      renderToStaticMarkup(createElement(MonthStrip, { options: perMonth, selection: [1], onTap: () => {}, preSystem: null, coverage: null })),
    )
    expect(cells(html).map((x) => x.attrs.includes('aria-pressed="true"'))).toEqual([false, true, false])
  })
})

describe('MonthStrip con tramo: "queda debiendo", total rotulado y ayuda de arrastre', () => {
  const selection = [0, 1, 2, 3, 4, 5]
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
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
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
    expect(html).toContain('Tocá cada mes que pagó, o arrastrá.')
    expect(html).toContain('Tocá cada mes que pagó, o mantené apretado y arrastrá.')
    expect(html).not.toContain('primer y el último mes')
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

  it('la ayuda de arrastre ya no depende de que haya celdas previas: con onRange aparece siempre (la grilla es de meses sueltos)', () => {
    const html = renderToStaticMarkup(
      createElement(MonthStrip, { options: DUE_TWO, selection: [0], onTap: () => {}, onRange: () => {}, preSystem: null, coverage: null }),
    )
    expect(html).toContain('Tocá cada mes que pagó, o arrastrá.')
  })

  it('con un saldo a favor que cubre ene y feb: marcadas se pueden desmarcar (tocables, "cubierto"); sin marcar quedan deshabilitadas', () => {
    const credit = { creditCents: 2 * P }
    const effCredit = effectiveOptions(CARGA, selection, credit)
    const mk = (sel: number[]) =>
      cells(
        normalize(
          renderToStaticMarkup(createElement(MonthStrip, { options: effCredit, selection: sel, onTap: () => {}, preSystem: pre({ scope: openingScope(CARGA, selection, credit, { payment: true }) }), coverage: null })),
        ),
      )
    const marked = mk(selection)
    expect(marked[0].html).toContain('cubierto')
    expect(marked[0].attrs).not.toContain('disabled')
    expect(marked[0].attrs).toContain('aria-pressed="true"')
    const unmarked = mk([2, 3, 4, 5])
    expect(unmarked[0].attrs).toContain('disabled')
    expect(unmarked[0].attrs).not.toContain('aria-pressed')
    expect(unmarked[2].attrs).toContain('aria-pressed="true"')
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
