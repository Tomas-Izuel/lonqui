import { describe, expect, it } from 'vitest'
import { staggerDelay, STAGGER } from '@/views/shared/motion'

/**
 * `motion.ts` (C1): solo se prueba `staggerDelay`, la única función pura del
 * archivo (todo lo demás son hooks que dependen de `useReducedMotion`/efectos
 * y no valen la pena mockear sin DOM). El techo importa: sin él, una lista
 * larga hace esperar cada vez más a la última fila, en vez de que las filas
 * de más entren juntas.
 */
describe('staggerDelay', () => {
  it('crece linealmente con el índice antes del techo', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(1)).toBeCloseTo(STAGGER.step)
    expect(staggerDelay(3)).toBeCloseTo(STAGGER.step * 3)
  })

  it('en el índice del techo, el delay es exactamente maxItems * step', () => {
    expect(staggerDelay(STAGGER.maxItems)).toBeCloseTo(STAGGER.step * STAGGER.maxItems)
  })

  it('más allá del techo, el delay NO sigue creciendo: se achata en el mismo valor del techo', () => {
    const atCap = staggerDelay(STAGGER.maxItems)
    expect(staggerDelay(STAGGER.maxItems + 1)).toBeCloseTo(atCap)
    expect(staggerDelay(1000)).toBeCloseTo(atCap)
  })
})
