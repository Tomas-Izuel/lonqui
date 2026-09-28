import { describe, expect, it } from 'vitest'
import { formatAxisTick, shortMonth, dayOfMonth } from '@/views/shared/chart-format'

/**
 * `chart-format.ts` (re-exportado por `chart-kit.tsx`, C4): formateadores
 * puros de ejes de gráfico. `formatAxisTick` se afirma con `toContain`/
 * `not.toMatch` como el resto del repo hace con moneda formateada
 * (`tests/lib/money.test.ts`), no con el string exacto que arma `Intl`: lo
 * que importa es la notación compacta y sin espacio, no el glifo puntual que
 * decida esta versión de ICU.
 */
describe('formatAxisTick', () => {
  it('notación compacta con el símbolo de pesos, sin espacio entre símbolo y número', () => {
    const formatted = formatAxisTick(125_000_00) // $125.000
    expect(formatted).toContain('$')
    expect(formatted).not.toMatch(/\s/)
    expect(formatted).toMatch(/125\s*[kK]/)
  })

  it('millones se abrevian con M', () => {
    expect(formatAxisTick(1_300_000_00)).toMatch(/1[.,]?3\s*M/)
  })

  it('cero se muestra como $0, no como notación compacta vacía o NaN', () => {
    expect(formatAxisTick(0)).toBe('$0')
  })

  it('nunca imprime el código de moneda "ARS" (formato compacto, no el símbolo largo)', () => {
    expect(formatAxisTick(50_000_00)).not.toContain('ARS')
  })
})

describe('shortMonth', () => {
  it('"2026-09-01" → mes abreviado sin punto final', () => {
    const label = shortMonth('2026-09-01')
    expect(label).not.toContain('.')
    expect(label.toLowerCase()).toBe(label) // sin mayúscula inicial forzada
    expect(label.length).toBeGreaterThan(0)
  })

  it('enero y diciembre no se confunden entre sí ni con septiembre (round-trip básico del mes)', () => {
    const jan = shortMonth('2026-01-01')
    const dec = shortMonth('2026-12-01')
    const sep = shortMonth('2026-09-01')
    expect(new Set([jan, dec, sep]).size).toBe(3)
  })

  it('usa UTC explícito: el mes no cambia por la zona horaria del proceso que corre el test', () => {
    // "2026-09-01" a mediodía UTC nunca cruza a agosto ni a octubre en ningún
    // huso horario real (±14h como mucho). Si `shortMonth` alguna vez dejara
    // de fijar `timeZone: 'UTC'`, un runner en UTC-something podría mostrar
    // el mes anterior.
    expect(shortMonth('2026-09-01')).toBe(shortMonth('2026-09-30'))
  })
})

describe('dayOfMonth', () => {
  it('extrae el día sin cero a la izquierda', () => {
    expect(dayOfMonth('2026-09-01')).toBe('1')
    expect(dayOfMonth('2026-09-09')).toBe('9')
    expect(dayOfMonth('2026-09-14')).toBe('14')
    expect(dayOfMonth('2026-09-30')).toBe('30')
  })
})
