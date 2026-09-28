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
    expect(hrefs.slice(0, 3)).toEqual(['/socios', '/cobranza', '/'])
  })

  it('consulta/editor (sin secciones solo-admin): exactamente Socios, Cobranza, Inicio', () => {
    expect(getNavItems('consulta').map((item) => item.href)).toEqual(['/socios', '/cobranza', '/'])
    expect(getNavItems('editor').map((item) => item.href)).toEqual(['/socios', '/cobranza', '/'])
  })

  it('admin ve además Usuarios, Ajustes y Auditoría, en ese orden, al final', () => {
    const hrefs = getNavItems('admin').map((item) => item.href)
    expect(hrefs).toEqual(['/socios', '/cobranza', '/', '/usuarios', '/ajustes', '/auditoria'])
  })
})

describe('getMobileNav: overflow y orden creciente hacia la derecha, sin tocar el algoritmo por el reorden', () => {
  it('consulta (3 destinos, entran todos): visible de menos a más importante, Socios al extremo derecho, sin overflow', () => {
    const nav = getMobileNav('consulta')
    expect(nav.overflow).toEqual([])
    expect(nav.visible.map((item) => item.href)).toEqual(['/', '/cobranza', '/socios'])
  })

  it('admin (6 destinos, no entran en 5 espacios): Socios sigue siendo el más importante (extremo derecho) y va en "visible", nunca en overflow', () => {
    const nav = getMobileNav('admin')
    expect(nav.visible.at(-1)?.href).toBe('/socios')
    expect(nav.overflow.some((item) => item.href === '/socios')).toBe(false)
    // Los menos importantes (Ajustes, Auditoría) son los que se van a "Más".
    expect(nav.overflow.map((item) => item.href)).toEqual(['/ajustes', '/auditoria'])
  })
})
