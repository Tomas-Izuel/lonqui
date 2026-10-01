import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `payments.model.ts`: `registerPayment` (una sola sentencia con N filas,
 * detección de `(batch_id, member_id)` como éxito idempotente),
 * `voidPayment`/`attachReceipt` (traducción de `payments_update_guard`),
 * `buildReceiptPath`, y el keyset de `getMonthPaymentsPage`. Cliente mockeado
 * en el borde externo.
 */

type QueryResult<T> = { data: T | null; error: { code?: string; message: string } | null }

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

beforeEach(() => {
  createClientMock.mockReset()
})

async function importModel() {
  return import('@/models/payments.model')
}

describe('buildReceiptPath', () => {
  it('tiene la forma payment-receipts/<memberId>/<uuid>.<ext>, con la extensión del MIME', async () => {
    const { buildReceiptPath, RECEIPT_PATH_PREFIX } = await importModel()
    const path = buildReceiptPath(42, 'image/png')
    expect(path.startsWith(`${RECEIPT_PATH_PREFIX}42/`)).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
  })

  it('cada llamada genera un uuid distinto (no reutiliza rutas)', async () => {
    const { buildReceiptPath } = await importModel()
    expect(buildReceiptPath(1, 'application/pdf')).not.toBe(buildReceiptPath(1, 'application/pdf'))
  })
})

describe('registerPaymentSchema', () => {
  it('batchId no-uuid: rechaza', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      batchId: 'no-es-un-uuid',
      paidOn: '2026-01-01',
      method: 'cash',
      items: [{ memberId: 1, amountCents: 100 }],
    })
    expect(result.success).toBe(false)
  })

  it('paidOn futura (zona club): rechaza con field paidOn', async () => {
    const { registerPaymentSchema } = await importModel()
    const farFuture = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    const result = registerPaymentSchema.safeParse({
      batchId: '11111111-1111-4111-8111-111111111111',
      paidOn: farFuture,
      method: 'cash',
      items: [{ memberId: 1, amountCents: 100 }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'paidOn')).toBe(true)
  })

  it('items vacío: rechaza', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      batchId: '11111111-1111-4111-8111-111111111111',
      paidOn: '2026-01-01',
      method: 'cash',
      items: [],
    })
    expect(result.success).toBe(false)
  })

  it('amountCents de un item <= 0: rechaza', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      batchId: '11111111-1111-4111-8111-111111111111',
      paidOn: '2026-01-01',
      method: 'cash',
      items: [{ memberId: 1, amountCents: 0 }],
    })
    expect(result.success).toBe(false)
  })

  it('receiptPath sin el prefijo payment-receipts/: rechaza', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      batchId: '11111111-1111-4111-8111-111111111111',
      paidOn: '2026-01-01',
      method: 'cash',
      items: [{ memberId: 1, amountCents: 100 }],
      receiptPath: 'medical-clearances/1/x.png',
    })
    expect(result.success).toBe(false)
  })

  it('forma válida completa: acepta', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      batchId: '11111111-1111-4111-8111-111111111111',
      paidOn: '2026-01-01',
      method: 'transfer',
      items: [{ memberId: 1, amountCents: 1_000_000 }],
      receiptPath: 'payment-receipts/1/abc.png',
      notes: 'nota',
      familyGroupId: 3,
    })
    expect(result.success).toBe(true)
  })
})

describe('registerPayment: una sola sentencia, N filas', () => {
  it('éxito: paymentIds y totalCents (suma de centavos, nunca floats) desde la fila insertada', async () => {
    const insertSpy = vi.fn((_rows: unknown[]) => ({
      select: async () => ({ data: [{ id: 1, amount_cents: 1_000_000 }, { id: 2, amount_cents: 500_000 }], error: null }),
    }))
    createClientMock.mockResolvedValue({ from: () => ({ insert: insertSpy }) })

    const { registerPayment } = await importModel()
    const result = await registerPayment({
      batchId: '11111111-1111-4111-8111-111111111111',
      paidOn: '2026-09-01',
      method: 'cash',
      items: [
        { memberId: 1, amountCents: 1_000_000 },
        { memberId: 2, amountCents: 500_000 },
      ],
    })

    expect(result).toEqual({ paymentIds: [1, 2], totalCents: 1_500_000, alreadyRegistered: false })
    // Una sola llamada a insert con las N filas juntas (no N inserts sueltos).
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(insertSpy.mock.calls[0][0]).toHaveLength(2)
  })

  it('reintento con el mismo (batch_id, member_id): unique violation se traduce a alreadyRegistered=true, recuperando lo ya cargado', async () => {
    const existingRows = [{ id: 10, amount_cents: 1_000_000 }]
    // El modelo llama from('payments') una SEGUNDA vez para recuperar lo
    // existente (select().eq()) tras el 23505 del insert.
    const from = vi.fn((table: string) => {
      if (table !== 'payments') throw new Error('tabla inesperada')
      return {
        insert: () => ({
          select: async () => ({
            data: null,
            error: { code: '23505', message: 'duplicate key value violates unique constraint "payments_batch_member_key"' },
          }),
        }),
        select: () => ({ eq: async () => ({ data: existingRows, error: null }) }),
      }
    })
    createClientMock.mockResolvedValue({ from })

    const { registerPayment } = await importModel()
    const result = await registerPayment({
      batchId: '22222222-2222-4222-8222-222222222222',
      paidOn: '2026-09-01',
      method: 'cash',
      items: [{ memberId: 1, amountCents: 1_000_000 }],
    })

    expect(result).toEqual({ paymentIds: [10], totalCents: 1_000_000, alreadyRegistered: true })
  })

  it('FK de socio inexistente (23503): DomainError claro con field memberId', async () => {
    const rawError = { code: '23503', message: 'insert or update on table "payments" violates foreign key constraint "payments_member_id_fkey"' }
    createClientMock.mockResolvedValue({ from: () => ({ insert: () => ({ select: async () => ({ data: null, error: rawError }) }) }) })
    const { registerPayment } = await importModel()
    const { DomainError } = await import('@/lib/errors')
    const err = await registerPayment({ batchId: '33333333-3333-4333-8333-333333333333', paidOn: '2026-09-01', method: 'cash', items: [{ memberId: 999, amountCents: 100 }] }).catch((e) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err.field).toBe('memberId')
    expect(err.message).not.toMatch(/constraint|payments_member_id_fkey/)
  })

  it('un error desconocido (no de dominio) se relanza tal cual, sin mostrarse al usuario', async () => {
    const rawError = { code: '57014', message: 'canceling statement due to statement timeout' }
    createClientMock.mockResolvedValue({ from: () => ({ insert: () => ({ select: async () => ({ data: null, error: rawError }) }) }) })
    const { registerPayment } = await importModel()
    const { DomainError } = await import('@/lib/errors')
    const err = await registerPayment({ batchId: '44444444-4444-4444-8444-444444444444', paidOn: '2026-09-01', method: 'cash', items: [{ memberId: 1, amountCents: 100 }] }).catch((e) => e)
    expect(err).not.toBeInstanceOf(DomainError)
  })
})

describe('voidPayment / attachReceipt: traducción de payments_update_guard', () => {
  function makeUpdateClient(result: QueryResult<{ id: number }>) {
    return { from: () => ({ update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => result }) }) }) }) }
  }

  it('voidPayment: id inexistente (0 filas) -> DomainError 404', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ data: null, error: null }))
    const { voidPayment } = await importModel()
    await expect(voidPayment(999, 'motivo válido')).rejects.toMatchObject({ message: 'El pago no existe', status: 404 })
  })

  it('voidPayment: ya anulado (trigger) -> DomainError "Este pago ya está anulado"', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ data: null, error: { code: '23514', message: 'Este pago ya está anulado' } }))
    const { voidPayment } = await importModel()
    await expect(voidPayment(1, 'motivo válido')).rejects.toMatchObject({ message: 'Este pago ya está anulado' })
  })

  it('attachReceipt: comprobante ya cargado -> DomainError "El comprobante ya está cargado y no se reemplaza"', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ data: null, error: { code: '23514', message: 'El comprobante ya está cargado y no se reemplaza' } }))
    const { attachReceipt } = await importModel()
    await expect(attachReceipt(1, 'payment-receipts/1/x.png', 'x.png')).rejects.toMatchObject({
      message: 'El comprobante ya está cargado y no se reemplaza',
    })
  })

  it('attachReceipt: pago anulado -> DomainError "Un pago anulado no lleva comprobante"', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ data: null, error: { code: '23514', message: 'Un pago anulado no lleva comprobante' } }))
    const { attachReceipt } = await importModel()
    await expect(attachReceipt(1, 'payment-receipts/1/x.png', 'x.png')).rejects.toMatchObject({
      message: 'Un pago anulado no lleva comprobante',
    })
  })

  it('attachReceipt: éxito, no tira nada', async () => {
    createClientMock.mockResolvedValue(makeUpdateClient({ data: { id: 1 }, error: null }))
    const { attachReceipt } = await importModel()
    await expect(attachReceipt(1, 'payment-receipts/1/x.png', 'x.png')).resolves.toBeUndefined()
  })
})

describe('getMonthPaymentsPage: keyset (paid_on desc, id desc) y tope de página', () => {
  it('con más filas que el límite, corta y arma un nextCursor a partir de la última fila de la página', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: 51 - i,
      member_id: 1,
      amount_cents: 100,
      paid_on: '2026-09-15',
      method: 'cash',
      receipt_storage_path: null,
      receipt_filename: null,
      notes: null,
      batch_id: '11111111-1111-4111-8111-111111111111',
      created_by: null,
      created_at: '2026-09-15T00:00:00Z',
      voided_at: null,
      voided_by: null,
      void_reason: null,
      members: { first_name: 'Ana', last_name: 'Test' },
    }))

    const query: Record<string, unknown> = {
      gte: () => query,
      lte: () => query,
      or: () => query,
      order: () => query,
      limit: async () => ({ data: rows, error: null }),
    }
    createClientMock.mockResolvedValue({ from: () => ({ select: () => query }) })

    const { getMonthPaymentsPage } = await importModel()
    const page = await getMonthPaymentsPage('2026-09-01')

    expect(page.items).toHaveLength(50)
    expect(page.nextCursor).not.toBeNull()
    expect(page.items[0].memberFullName).toBe('Test, Ana')
    expect(page.items.every((item) => item.voided === false)).toBe(true)
  })

  it('sin filas de más: nextCursor null', async () => {
    const query: Record<string, unknown> = {
      gte: () => query,
      lte: () => query,
      or: () => query,
      order: () => query,
      limit: async () => ({ data: [], error: null }),
    }
    createClientMock.mockResolvedValue({ from: () => ({ select: () => query }) })

    const { getMonthPaymentsPage } = await importModel()
    const page = await getMonthPaymentsPage('2026-09-01')
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it('un pago anulado en la página se marca voided:true', async () => {
    const rows = [
      {
        id: 1,
        member_id: 1,
        amount_cents: 100,
        paid_on: '2026-09-15',
        method: 'cash',
        receipt_storage_path: null,
        receipt_filename: null,
        notes: null,
        batch_id: '11111111-1111-4111-8111-111111111111',
        created_by: null,
        created_at: '2026-09-15T00:00:00Z',
        voided_at: '2026-09-16T00:00:00Z',
        voided_by: null,
        void_reason: 'Cargado por error',
        members: { first_name: 'Ana', last_name: 'Test' },
      },
    ]
    const query: Record<string, unknown> = {
      gte: () => query,
      lte: () => query,
      or: () => query,
      order: () => query,
      limit: async () => ({ data: rows, error: null }),
    }
    createClientMock.mockResolvedValue({ from: () => ({ select: () => query }) })

    const { getMonthPaymentsPage } = await importModel()
    const page = await getMonthPaymentsPage('2026-09-01')
    expect(page.items[0].voided).toBe(true)
  })
})
