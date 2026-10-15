import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonthSelector } from '@/views/payments/month-selector'

/**
 * Bug: el selector armaba `?mes=YYYY-MM-01` y las pages solo aceptan
 * `YYYY-MM`, así que siempre caían al mes actual. Se renderiza a HTML estático
 * (Node, sin jsdom) y se leen los href reales.
 */
function hrefs(period: string, basePath = '/caja/cuotas') {
  const html = renderToStaticMarkup(createElement(MonthSelector, { period, basePath }))
  const find = (label: string) => new RegExp(`aria-label="${label}"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*aria-label="${label}"`).exec(html)
  const pick = (label: string) => {
    const m = find(label)
    return m ? (m[1] ?? m[2]) : null
  }
  return { previous: pick('Mes anterior'), next: pick('Mes siguiente') }
}

describe('MonthSelector: links ?mes=YYYY-MM', () => {
  it('desde octubre 2026: anterior = 2026-09, siguiente = 2026-11', () => {
    expect(hrefs('2026-10-01')).toEqual({ previous: '/caja/cuotas?mes=2026-09', next: '/caja/cuotas?mes=2026-11' })
  })

  it('enero 2026 -> anterior cruza el año: 2025-12', () => {
    expect(hrefs('2026-01-01').previous).toBe('/caja/cuotas?mes=2025-12')
  })

  it('diciembre 2025 -> siguiente cruza el año: 2026-01', () => {
    expect(hrefs('2025-12-01').next).toBe('/caja/cuotas?mes=2026-01')
  })

  it('ningún link lleva el día (-01): las pages lo rechazarían', () => {
    const { previous, next } = hrefs('2026-10-01', '/caja/ingresos')
    expect(previous).toBe('/caja/ingresos?mes=2026-09')
    expect(next).toBe('/caja/ingresos?mes=2026-11')
    expect(previous).not.toMatch(/-\d{2}-\d{2}$/)
  })
})
