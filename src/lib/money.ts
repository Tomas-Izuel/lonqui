/**
 * Todo el dinero de la app son centavos enteros (bigint en Postgres, number
 * acá). Nunca float: 0.1 + 0.2 !== 0.3, y en una deuda acumulada de doce meses
 * eso es plata real que alguien le reclama a un socio.
 */

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER

export function assertCents(value: number, label = 'monto'): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE_CENTS) {
    throw new Error(`${label} inválido: se esperaban centavos enteros no negativos, llegó ${value}`)
  }
  return value
}

/** Centavos → "$ 10.000" (sin decimales: en ARS no se usan en la práctica). */
export function formatCentsCompact(cents: number, currency = 'ARS', locale = 'es-AR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

/**
 * Pesos que tipea un usuario ("10000", "10.000", "10.000,50") → centavos.
 *
 * El formato argentino usa el punto como separador de miles y la coma como
 * decimal, al revés que `Number()`: `Number("10.000")` da 10, no diez mil. Un
 * pago de $10.000 registrado como $10 es exactamente el tipo de error que
 * nadie ve hasta que el socio aparece "debiendo".
 */
export function parsePesosToCents(input: string): number | null {
  const normalized = input.trim().replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + assertCents(value), 0)
}
