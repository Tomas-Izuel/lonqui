import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * `SectionTabs` es client (usa `usePathname`), pero renderiza a HTML estático
 * en Node mockeando la ruta: se lee `aria-current` real. Las pestañas de
 * Ajustes y de Caja son envoltorios, así que se prueban por acá.
 */

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

const { SectionTabs } = await import('@/views/shared/section-tabs')
const { CajaTabs } = await import('@/views/payments/caja-tabs')
const { SettingsTabs } = await import('@/views/settings/settings-tabs')
const { SETTINGS_LINKS } = await import('@/views/settings/settings-links')

beforeEach(() => {
  pathname = '/'
})

/** Devuelve { href: aria-current activo? } de cada <a>. */
function tabs(html: string) {
  const out: Record<string, boolean> = {}
  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const tag = m[0]
    const href = /href="([^"]+)"/.exec(tag)![1]
    out[href] = /aria-current="page"/.test(tag)
  }
  return out
}
const activeOf = (t: Record<string, boolean>) => Object.keys(t).filter((k) => t[k])

describe('SectionTabs: activa exacta y por prefijo', () => {
  const list = [
    { href: '/x', label: 'Uno' },
    { href: '/x/lista', label: 'Dos', matchPrefixes: ['/x/lista', '/x/sub'] },
  ]
  const render = () => tabs(renderToStaticMarkup(createElement(SectionTabs, { tabs: list, label: 'Prueba', indicatorId: 'ind' })))

  it('ruta exacta activa su pestaña', () => {
    pathname = '/x'
    expect(activeOf(render())).toEqual(['/x'])
  })

  it('sin matchPrefixes, una subruta NO activa la pestaña (solo exacta)', () => {
    pathname = '/x/otra'
    expect(activeOf(render())).toEqual([])
  })

  it('una subruta bajo matchPrefixes activa la pestaña dueña', () => {
    pathname = '/x/sub/12'
    expect(activeOf(render())).toEqual(['/x/lista'])
  })

  it('ruta ajena: ninguna activa', () => {
    pathname = '/otra'
    expect(activeOf(render())).toEqual([])
  })

  it('el nav lleva el aria-label recibido', () => {
    expect(renderToStaticMarkup(createElement(SectionTabs, { tabs: list, label: 'Secciones de prueba', indicatorId: 'ind' }))).toContain(
      'aria-label="Secciones de prueba"',
    )
  })
})

describe('CajaTabs: 6 rutas', () => {
  const render = () => tabs(renderToStaticMarkup(createElement(CajaTabs)))

  it('mantiene sus seis rutas, en orden', () => {
    expect(Object.keys(render())).toEqual(['/caja', '/caja/cuotas', '/caja/ingresos', '/caja/deuda', '/caja/al-dia', '/caja/por-categoria'])
  })

  it.each([
    ['/caja', '/caja'],
    ['/caja/cuotas', '/caja/cuotas'],
    ['/caja/ingresos', '/caja/ingresos'],
    ['/caja/sponsors', '/caja/ingresos'],
    ['/caja/sponsors/7', '/caja/ingresos'],
    ['/caja/deuda', '/caja/deuda'],
    ['/caja/al-dia', '/caja/al-dia'],
    ['/caja/por-categoria', '/caja/por-categoria'],
  ])('en %s solo está activa %s', (path, expected) => {
    pathname = path
    expect(activeOf(render())).toEqual([expected])
  })

  it('"Resumen" (/caja) no se enciende en las subrutas', () => {
    pathname = '/caja/cuotas'
    expect(render()['/caja']).toBe(false)
  })
})

describe('SettingsTabs: 4 pestañas de Ajustes', () => {
  const render = () => renderToStaticMarkup(createElement(SettingsTabs))

  it('las cuatro rutas, en orden, con el aria-label acordado', () => {
    const html = render()
    expect(Object.keys(tabs(html))).toEqual(['/ajustes/cuotas', '/ajustes/deportes', '/ajustes/caja', '/ajustes/club'])
    expect(html).toContain('aria-label="Secciones de ajustes"')
  })

  it.each(['/ajustes/cuotas', '/ajustes/deportes', '/ajustes/caja', '/ajustes/club'])('en %s solo esa está activa', (path) => {
    pathname = path
    expect(activeOf(tabs(render()))).toEqual([path])
  })

  it('SETTINGS_LINKS apunta a las mismas 4 rutas que las pestañas (si renombran una, un enlace queda roto)', () => {
    expect(SETTINGS_LINKS).toEqual({ fees: '/ajustes/cuotas', sports: '/ajustes/deportes', cash: '/ajustes/caja', club: '/ajustes/club' })
    expect(Object.keys(tabs(render())).sort()).toEqual(Object.values(SETTINGS_LINKS).sort())
  })
})
