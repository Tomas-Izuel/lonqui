import { describe, expect, it, vi } from 'vitest'

/**
 * `income-schema.ts` espeja `registerCashMovementSchema` del servidor (una
 * vista no puede importar el modelo): lo que atrapa esto es la deriva de
 * textos y reglas entre el formulario y la action, igual que con pagos. Más el
 * comportamiento propio del formulario: el sponsor es obligatorio SOLO si el
 * concepto elegido lo pide.
 */
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const client = await import('@/views/income/income-schema')
const { registerCashMovementSchema, MIN_CASH_DATE } = await import('@/models/cash-movements.model')
const { toClubDate } = await import('@/lib/dates')

const BATCH = '11111111-1111-4111-8111-111111111111'

function serverMessage(over: Record<string, unknown>, path: string): string | undefined {
  const result = registerCashMovementSchema.safeParse({
    batchId: BATCH,
    conceptId: 1,
    amountCents: 1000,
    occurredOn: '2026-01-15',
    method: 'cash',
    ...over,
  })
  if (result.success) return undefined
  return result.error.issues.find((i) => i.path.join('.') === path)?.message
}

const concepts = [
  { id: 1, direction: 'income' as const, name: 'Donación', requiresSponsor: false, isActive: true, sortOrder: 1 },
  { id: 2, direction: 'income' as const, name: 'Sponsor', requiresSponsor: true, isActive: true, sortOrder: 2 },
]
const schema = client.buildIncomeSchema(concepts)
const base = { conceptId: 1, sponsorId: null, amountCents: 1000, occurredOn: '2026-01-15', method: 'cash', description: '' }

function clientMessage(over: Record<string, unknown>, path: string): string | undefined {
  const result = schema.safeParse({ ...base, ...over })
  if (result.success) return undefined
  return result.error.issues.find((i) => i.path.join('.') === path)?.message
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('el formulario y el servidor dicen lo mismo (deriva de textos)', () => {
  it('constantes compartidas', () => {
    expect(client.INCOME_MIN_DATE).toBe(MIN_CASH_DATE)
  })

  it('fecha futura: mismo mensaje y mismo borde (mañana del club no, hoy sí)', () => {
    const today = toClubDate()
    expect(clientMessage({ occurredOn: today }, 'occurredOn')).toBeUndefined()
    expect(serverMessage({ occurredOn: today }, 'occurredOn')).toBeUndefined()
    const tomorrow = shiftDays(today, 1)
    expect(clientMessage({ occurredOn: tomorrow }, 'occurredOn')).toBe('La fecha del ingreso no puede ser futura')
    expect(serverMessage({ occurredOn: tomorrow }, 'occurredOn')).toBe(clientMessage({ occurredOn: tomorrow }, 'occurredOn'))
  })

  it('fecha anterior a 2020: mismo mensaje; 1/1/2020 entra en ambos', () => {
    expect(clientMessage({ occurredOn: '2019-12-31' }, 'occurredOn')).toBe(serverMessage({ occurredOn: '2019-12-31' }, 'occurredOn'))
    expect(clientMessage({ occurredOn: '2020-01-01' }, 'occurredOn')).toBeUndefined()
    expect(serverMessage({ occurredOn: '2020-01-01' }, 'occurredOn')).toBeUndefined()
  })

  it('monto cero o negativo: mismo mensaje', () => {
    for (const amountCents of [0, -100]) {
      expect(clientMessage({ amountCents }, 'amountCents')).toBe('El monto tiene que ser mayor a cero')
      expect(serverMessage({ amountCents }, 'amountCents')).toBe('El monto tiene que ser mayor a cero')
    }
  })

  it('monto con centavos fraccionarios: mismo mensaje; 1 centavo entra en ambos', () => {
    expect(clientMessage({ amountCents: 10.5 }, 'amountCents')).toBe('El monto no es válido')
    expect(serverMessage({ amountCents: 10.5 }, 'amountCents')).toBe('El monto no es válido')
    expect(clientMessage({ amountCents: 1 }, 'amountCents')).toBeUndefined()
    expect(serverMessage({ amountCents: 1 }, 'amountCents')).toBeUndefined()
  })

  it('detalle de 501 caracteres: mismo mensaje; 500 entra', () => {
    const long = 'x'.repeat(501)
    expect(clientMessage({ description: long }, 'description')).toBe('El detalle no puede tener más de 500 caracteres')
    expect(serverMessage({ description: long }, 'description')).toBe('El detalle no puede tener más de 500 caracteres')
    expect(clientMessage({ description: 'x'.repeat(500) }, 'description')).toBeUndefined()
  })

  it('medio inválido: mismo mensaje', () => {
    expect(clientMessage({ method: 'cheque' }, 'method')).toBe('Elegí el medio: efectivo o transferencia')
    expect(serverMessage({ method: 'cheque' }, 'method')).toBe('Elegí el medio: efectivo o transferencia')
  })

  it('sin concepto elegido: mismo mensaje', () => {
    expect(clientMessage({ conceptId: null }, 'conceptId')).toBe('Elegí el concepto')
    expect(serverMessage({ conceptId: 0 }, 'conceptId')).toBe('Elegí el concepto')
  })
})

describe('sponsor obligatorio solo si el concepto lo pide', () => {
  it('concepto que pide sponsor, sin sponsor: error en sponsorId', () => {
    expect(clientMessage({ conceptId: 2, sponsorId: null }, 'sponsorId')).toBe('Elegí el sponsor de este ingreso')
  })

  it('concepto que pide sponsor, con sponsor: válido', () => {
    expect(schema.safeParse({ ...base, conceptId: 2, sponsorId: 9 }).success).toBe(true)
  })

  it('concepto que NO lo pide: con o sin sponsor es válido (opcional)', () => {
    expect(schema.safeParse({ ...base, conceptId: 1, sponsorId: null }).success).toBe(true)
    expect(schema.safeParse({ ...base, conceptId: 1, sponsorId: 9 }).success).toBe(true)
  })

  it('sin conceptos cargados el schema no inventa una exigencia de sponsor', () => {
    const empty = client.buildIncomeSchema([])
    const result = empty.safeParse({ ...base, conceptId: 2, sponsorId: null })
    expect(result.success).toBe(true)
  })

  it('el monto vacío (null del campo) pide "Ingresá el monto"', () => {
    expect(clientMessage({ amountCents: null }, 'amountCents')).toBe('Ingresá el monto')
  })
})

describe('isIncomeKnownField', () => {
  it('reconoce los campos del formulario (para pintar el error de la action bajo su campo) y nada más', () => {
    for (const field of client.INCOME_KNOWN_FIELDS) expect(client.isIncomeKnownField(field)).toBe(true)
    expect(client.isIncomeKnownField('receiptPath')).toBe(false)
    expect(client.isIncomeKnownField('batchId')).toBe(false)
    expect(client.isIncomeKnownField(undefined)).toBe(false)
  })
})
