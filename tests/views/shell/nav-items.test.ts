import { describe, expect, it } from 'vitest'
import { getMobileNav, getNavItems } from '@/views/shell/nav-items'

/**
 * `nav-items.ts`: el pipeline 2026-09-28-ui-expresiva proponía "Inicio
 * debería liderar" (C6), pero el Addendum del hilo principal lo revierte
 * EXPLÍCITAMENTE — Socios > Cobranza > Inicio es un pedido fechado de Tomás,
 * no una observación del pipeline, y "C6 NO se aplica" (`01-tasks.md`). Este
 * test fija el orden para que un futuro "prolijamos la nav" no lo revierta
 * sin querer.
 */
describe('getNavItems: orden fijo (Socios > Cobranza > Inicio), NO reordenado por este pipeline', () => {
  it('admin: Socios, Cobranza e Inicio primero, en ese orden, antes que las secciones solo-admin', () => {
    const hrefs = getNavItems('admin').map((item) => item.href)
    expect(hrefs.slice(0, 3)).toEqual(['/socios', '/caja', '/'])
  })

  it('consulta/editor (sin secciones solo-admin): exactamente Socios, Cobranza, Inicio', () => {
    expect(getNavItems('consulta').map((item) => item.href)).toEqual(['/socios', '/caja', '/'])
    expect(getNavItems('editor').map((item) => item.href)).toEqual(['/socios', '/caja', '/'])
  })

  it('admin ve además Usuarios, Ajustes y Auditoría, en ese orden, al final', () => {
    const hrefs = getNavItems('admin').map((item) => item.href)
    expect(hrefs).toEqual(['/socios', '/caja', '/', '/usuarios', '/ajustes', '/auditoria'])
  })
})

describe('getMobileNav: overflow y orden creciente hacia la derecha, sin tocar el algoritmo por el reorden', () => {
  it('consulta (3 destinos, entran todos): visible de menos a más importante, Socios al extremo derecho, sin overflow', () => {
    const nav = getMobileNav('consulta')
    expect(nav.overflow).toEqual([])
    expect(nav.visible.map((item) => item.href)).toEqual(['/', '/caja', '/socios'])
  })

  it('admin (6 destinos, no entran en 5 espacios): Socios sigue siendo el más importante (extremo derecho) y va en "visible", nunca en overflow', () => {
    const nav = getMobileNav('admin')
    expect(nav.visible.at(-1)?.href).toBe('/socios')
    expect(nav.overflow.some((item) => item.href === '/socios')).toBe(false)
    // Los menos importantes (Ajustes, Auditoría) son los que se van a "Más".
    expect(nav.overflow.map((item) => item.href)).toEqual(['/ajustes', '/auditoria'])
  })
})

describe('Caja reemplaza a Cobranza en la navegación (pipeline 2026-10-13)', () => {
  it('el segundo destino se llama "Caja" y apunta a /caja, para todos los roles', () => {
    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const second = getNavItems(role)[1]
      expect(second.label).toBe('Caja')
      expect(second.href).toBe('/caja')
    }
  })

  it('ya no queda ningún destino "Cobranza" ni apuntando a /cobranza (ni en escritorio ni en el celular)', () => {
    for (const role of ['admin', 'editor', 'consulta'] as const) {
      const all = [...getNavItems(role), ...getMobileNav(role).visible, ...getMobileNav(role).overflow]
      for (const item of all) {
        expect(item.label).not.toMatch(/cobranza/i)
        expect(item.href).not.toMatch(/cobranza/)
      }
    }
  })

  it('Caja es visible para los tres roles (la ven hasta quienes solo leen)', () => {
    for (const role of ['admin', 'editor', 'consulta'] as const) {
      expect(getNavItems(role).some((item) => item.href === '/caja')).toBe(true)
      const mobile = getMobileNav(role)
      expect([...mobile.visible, ...mobile.overflow].some((item) => item.href === '/caja')).toBe(true)
    }
  })
})
