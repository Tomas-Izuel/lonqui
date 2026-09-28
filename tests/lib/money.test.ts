import { describe, expect, it } from 'vitest'
import { assertCents, formatCentsCompact, parsePesosToCents, sumCents } from '@/lib/money'

/**
 * Todo el dinero es centavos enteros. El bug que estos tests atajan es
 * literalmente "un pago de $10.000 registrado como $10": `Number("10.000")`
 * da 10 (JS lee el punto como decimal), al revés del formato argentino.
 */
describe('parsePesosToCents', () => {
  it('"10000" (sin separadores) son 1.000.000 centavos', () => {
    expect(parsePesosToCents('10000')).toBe(1_000_000)
  })

  it('"10.000" (punto de miles argentino) NO es diez, son 1.000.000 centavos', () => {
    expect(parsePesosToCents('10.000')).toBe(1_000_000)
  })

  it('"10.000,50" (coma decimal) son 1.000.050 centavos', () => {
    expect(parsePesosToCents('10.000,50')).toBe(1_000_050)
  })

  it('un decimal de un solo dígito se completa a centavos: "10,5" -> 1050', () => {
    expect(parsePesosToCents('10,5')).toBe(1050)
  })

  it('acepta el símbolo $ y espacios sueltos', () => {
    expect(parsePesosToCents('$ 30.000')).toBe(3_000_000)
  })

  it('un pago que cubre varios meses de cuota ($30.000 con cuota de $10.000) dan un múltiplo exacto', () => {
    const paymentCents = parsePesosToCents('30.000')
    const feeCents = parsePesosToCents('10.000')
    expect(paymentCents).not.toBeNull()
    expect(feeCents).not.toBeNull()
    expect((paymentCents as number) % (feeCents as number)).toBe(0)
  })

  it('rechaza más de dos decimales', () => {
    expect(parsePesosToCents('10,123')).toBeNull()
  })

  it('rechaza texto que no es un número', () => {
    expect(parsePesosToCents('diez mil')).toBeNull()
    expect(parsePesosToCents('')).toBeNull()
    expect(parsePesosToCents('-100')).toBeNull()
  })

  it('"0" es un monto válido (cero centavos), no un error', () => {
    expect(parsePesosToCents('0')).toBe(0)
  })
})

describe('assertCents', () => {
  it('acepta un entero no negativo', () => {
    expect(assertCents(1_000_000)).toBe(1_000_000)
  })

  it('rechaza un float: la plata nunca es de coma flotante', () => {
    expect(() => assertCents(10.5)).toThrow()
  })

  it('rechaza negativos', () => {
    expect(() => assertCents(-1)).toThrow()
  })
})

describe('sumCents', () => {
  it('suma exacta sin arrastrar error de punto flotante', () => {
    // 0.1 + 0.2 !== 0.3 en float; en centavos enteros no hay ese problema.
    const values = Array.from({ length: 10 }, () => 10_007)
    expect(sumCents(values)).toBe(100_070)
  })

  it('con una lista vacía da 0', () => {
    expect(sumCents([])).toBe(0)
  })

  it('propaga el error de un valor inválido en la lista (no lo ignora en silencio)', () => {
    expect(() => sumCents([100, -5, 200])).toThrow()
  })
})

describe('formatCentsCompact', () => {
  it('se muestra sin decimales (en ARS no se usan en la práctica)', () => {
    const formatted = formatCentsCompact(1_000_000)
    expect(formatted).not.toMatch(/[.,]\d{2}\s*$/)
    // El símbolo de pesos y el valor entero tienen que estar presentes.
    expect(formatted).toContain('10.000')
  })
})
