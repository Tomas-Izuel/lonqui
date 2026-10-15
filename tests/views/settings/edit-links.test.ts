import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Enlaces "Editar …" desde otros módulos hacia las pestañas de Ajustes: solo
 * con el flag (que la page deriva de `settings.manage`), nunca por defecto.
 * Es UX: la defensa real es el guard de la pestaña y RLS. Se renderiza a HTML
 * estático en Node; el hueco (vistas client que dependen de hooks del router
 * y del contexto de overlays) está anotado en 03-tests.md.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/caja',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const { DebtByCategoryView } = await import('@/views/payments/debt-by-category-view')
const { MonthPaymentsView } = await import('@/views/payments/month-payments-view')
const { EditInSettingsLink } = await import('@/views/shared/edit-in-settings-link')
const { OtherIncomeView } = await import('@/views/income/other-income-view')
const { PanelSessionProvider } = await import('@/views/shell/panel-session')
const { SETTINGS_LINKS } = await import('@/views/settings/settings-links')

const collection = {
  period: '2026-10-01',
  collectedCents: 0,
  cashCents: 0,
  transferCents: 0,
  paymentsCount: 0,
  feesCents: 0,
  feesCount: 0,
}

function debtView(canEditCategories?: boolean) {
  return renderToStaticMarkup(createElement(DebtByCategoryView, { rows: [], totalCents: 0, ...(canEditCategories === undefined ? {} : { canEditCategories }) }))
}
function monthView(canEditFee?: boolean) {
  return renderToStaticMarkup(
    createElement(MonthPaymentsView, {
      period: '2026-10-01',
      collection,
      page: { items: [], nextCursor: null },
      canVoid: false,
      ...(canEditFee === undefined ? {} : { canEditFee }),
    }),
  )
}
// `createElement` tipado exige `children` en props; acá van como tercer argumento (react/no-children-prop).
const h = createElement as unknown as (type: unknown, props: object, ...children: unknown[]) => ReturnType<typeof createElement>
const hasLink = (html: string, href: string) => html.includes(`href="${href}"`)

describe('/caja/por-categoria: "Editar categorías"', () => {
  it('con permiso: enlace a /ajustes/deportes', () => {
    const html = debtView(true)
    expect(hasLink(html, '/ajustes/deportes')).toBe(true)
    expect(html).toContain('Editar categorías')
  })
  it('sin permiso: ausente', () => {
    expect(hasLink(debtView(false), '/ajustes/deportes')).toBe(false)
    expect(debtView(false)).not.toContain('Editar categorías')
  })
  it('sin pasar el flag: ausente (el default es no mostrar)', () => {
    expect(hasLink(debtView(), '/ajustes/deportes')).toBe(false)
  })
})

describe('/caja/cuotas: "Cambiar valor de cuota"', () => {
  it('con permiso: enlace a /ajustes/cuotas', () => {
    const html = monthView(true)
    expect(hasLink(html, '/ajustes/cuotas')).toBe(true)
    expect(html).toContain('Cambiar valor de cuota')
  })
  it('sin permiso: ausente', () => {
    expect(hasLink(monthView(false), '/ajustes/cuotas')).toBe(false)
    expect(monthView(false)).not.toContain('Cambiar valor de cuota')
  })
  it('sin pasar el flag: ausente', () => {
    expect(hasLink(monthView(), '/ajustes/cuotas')).toBe(false)
  })
})

function incomeView(canEditConcepts?: boolean) {
  const view = createElement(OtherIncomeView, {
    period: '2026-10-01',
    movements: [],
    summary: { incomeCents: 0, feesCents: 0, otherCents: 0, byConcept: [] } as never,
    concepts: [],
    sponsors: [],
    truncated: false,
    canVoid: false,
    canExport: false,
    ...(canEditConcepts === undefined ? {} : { canEditConcepts }),
  })
  // Los botones de registrar leen permisos del contexto del AppShell.
  return renderToStaticMarkup(h(PanelSessionProvider, { permissions: ['income.read'] }, view))
}

describe('/caja/ingresos: "Editar conceptos"', () => {
  it('con permiso: enlace a /ajustes/caja', () => {
    const html = incomeView(true)
    expect(hasLink(html, '/ajustes/caja')).toBe(true)
    expect(html).toContain('Editar conceptos')
  })
  it('sin permiso o sin flag: ausente', () => {
    expect(hasLink(incomeView(false), '/ajustes/caja')).toBe(false)
    expect(hasLink(incomeView(), '/ajustes/caja')).toBe(false)
  })
})

describe('EditInSettingsLink', () => {
  const html = renderToStaticMarkup(h(EditInSettingsLink, { href: SETTINGS_LINKS.cash }, 'Editar conceptos'))
  it('es un <a> real al href dado, con el texto', () => {
    expect(html).toMatch(/^<a [^>]*href="\/ajustes\/caja"/)
    expect(html).toContain('Editar conceptos')
  })
  it('target táctil de 44px (min-h-11) e ícono oculto a lectores', () => {
    expect(html).toContain('min-h-11')
    expect(html).toContain('aria-hidden="true"')
  })
})
