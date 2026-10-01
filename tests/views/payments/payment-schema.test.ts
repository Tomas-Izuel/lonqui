import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

/**
 * Los schemas del cliente (`payment-schema.ts`) espejan `registerPaymentSchema`
 * del servidor. Una vista no puede importar el modelo, así que los textos se
 * copian: lo que atrapa esto es la deriva. Si un mensaje cambia de un lado y
 * no del otro, el usuario ve dos textos distintos para el mismo error según
 * lo atrape el formulario o la action.
 */
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const client = await import('@/views/payments/payment-schema')
const { registerPaymentSchema, MIN_PAYMENT_DATE } = await import('@/models/payments.model')
const { toClubDate } = await import('@/lib/dates')

const BATCH_ID = '11111111-1111-4111-8111-111111111111'

function serverMessage(over: Record<string, unknown>, path: string): string | undefined {
  const result = registerPaymentSchema.safeParse({
    batchId: BATCH_ID,
    paidOn: '2026-01-15',
    method: 'cash',
    items: [{ memberId: 1, amountCents: 1000 }],
    ...over,
  })
  if (result.success) return undefined
  return result.error.issues.find((i) => i.path.join('.') === path)?.message
}

function clientMessage(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value)
  return result.success ? undefined : result.error.issues[0]?.message
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe('paidOnSchema (cliente) vs registerPaymentSchema (servidor)', () => {
  it('el piso es el mismo en los dos lados', () => {
    expect(client.PAYMENT_MIN_DATE).toBe(MIN_PAYMENT_DATE)
  })

  it('fecha futura: mismo mensaje, y mañana (hora del club) ya es futuro', () => {
    const tomorrow = shiftDays(toClubDate(), 1)
    const c = clientMessage(client.paidOnSchema, tomorrow)
    expect(c).toBeDefined()
    expect(c).toBe(serverMessage({ paidOn: tomorrow }, 'paidOn'))
  })

  it('hoy (hora del club) es válido en los dos lados', () => {
    const today = toClubDate()
    expect(clientMessage(client.paidOnSchema, today)).toBeUndefined()
    expect(serverMessage({ paidOn: today }, 'paidOn')).toBeUndefined()
  })

  it('antes de 2020: mismo mensaje; 2019-12-31 falla y 2020-01-01 pasa en los dos', () => {
    const c = clientMessage(client.paidOnSchema, '2019-12-31')
    expect(c).toBeDefined()
    expect(c).toBe(serverMessage({ paidOn: '2019-12-31' }, 'paidOn'))
    expect(clientMessage(client.paidOnSchema, '2020-01-01')).toBeUndefined()
    expect(serverMessage({ paidOn: '2020-01-01' }, 'paidOn')).toBeUndefined()
  })

  it('vacío o con formato roto: el cliente dice algo accionable (no el genérico de Zod)', () => {
    expect(clientMessage(client.paidOnSchema, '')).toBe('Elegí la fecha en que se cobró')
    expect(clientMessage(client.paidOnSchema, '15/01/2026')).toBe('La fecha no es válida')
    expect(serverMessage({ paidOn: '15/01/2026' }, 'paidOn')).toBe('La fecha no es válida')
  })
})

describe('amountCentsSchema (cliente) vs paymentItemSchema (servidor)', () => {
  const serverAmount = (amountCents: unknown) => serverMessage({ items: [{ memberId: 1, amountCents }] }, 'items.0.amountCents')

  it.each([0, -1, -100_000])('monto %s: "mayor a cero" en los dos lados', (amount) => {
    expect(clientMessage(client.amountCentsSchema, amount)).toBe(serverAmount(amount))
    expect(serverAmount(amount)).toBe('El monto tiene que ser mayor a cero')
  })

  it('sin monto: mismo mensaje ("Ingresá el monto")', () => {
    expect(clientMessage(client.amountCentsSchema, null)).toBe('Ingresá el monto')
    expect(serverAmount(undefined)).toBe('Ingresá el monto')
  })

  it('monto con decimales (centavos no enteros): mismo mensaje en los dos lados', () => {
    // Plata en centavos enteros, nunca float: el rechazo tiene que existir y decir lo mismo.
    expect(clientMessage(client.amountCentsSchema, 1000.5)).toBeDefined()
    expect(clientMessage(client.amountCentsSchema, 1000.5)).toBe(serverAmount(1000.5))
  })

  it('un monto entero positivo pasa', () => {
    expect(clientMessage(client.amountCentsSchema, 1)).toBeUndefined()
    expect(clientMessage(client.amountCentsSchema, 1_000_000)).toBeUndefined()
  })
})

describe('methodSchema y notesSchema (cliente) vs servidor', () => {
  it('medio de pago no elegido: mismo mensaje', () => {
    const c = clientMessage(client.methodSchema, undefined)
    expect(c).toBe('Elegí el medio de pago: efectivo o transferencia')
    expect(serverMessage({ method: undefined }, 'method')).toBe(c)
  })

  it('el medio acepta solo efectivo o transferencia', () => {
    expect(clientMessage(client.methodSchema, 'cash')).toBeUndefined()
    expect(clientMessage(client.methodSchema, 'transfer')).toBeUndefined()
    expect(clientMessage(client.methodSchema, 'cheque')).toBeDefined()
  })

  it('notas: 500 pasa, 501 falla con el mismo mensaje', () => {
    expect(clientMessage(client.notesSchema, 'a'.repeat(500))).toBeUndefined()
    const c = clientMessage(client.notesSchema, 'a'.repeat(501))
    expect(c).toBe(serverMessage({ notes: 'a'.repeat(501) }, 'notes'))
  })
})
