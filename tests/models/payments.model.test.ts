import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `payments.model.ts`: `registerPayment` (vía `register_payment_batch`, con el
 * saldo anterior por meses dentro del lote; idempotencia por `batch_id` en la RPC),
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

const BATCH = '11111111-1111-4111-8111-111111111111'
const VALID_BASE = { batchId: BATCH, paidOn: '2026-01-01', method: 'cash' as const }

describe('registerPaymentSchema: saldo anterior por meses y lote', () => {
  const ob = { fromPeriod: '2026-07-01', toPeriod: '2026-09-01', amountCents: 3_000_000 }

  it('acepta un ítem con saldo anterior y uno sin él', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      ...VALID_BASE,
      items: [
        { memberId: 1, amountCents: 4_000_000, openingBalance: ob },
        { memberId: 2, amountCents: 1_000_000 },
        { memberId: 3, amountCents: 1_000_000, openingBalance: null },
      ],
    })
    expect(result.success).toBe(true)
  })

  it.each([
    ['fromPeriod posterior a toPeriod', { ...ob, fromPeriod: '2026-09-01', toPeriod: '2026-07-01' }],
    ['período que no es día 1', { ...ob, fromPeriod: '2026-07-15' }],
    ['toPeriod que no es día 1', { ...ob, toPeriod: '2026-09-30' }],
    ['amountCents 0', { ...ob, amountCents: 0 }],
    ['amountCents negativo', { ...ob, amountCents: -1 }],
    ['amountCents con decimales (nunca floats)', { ...ob, amountCents: 1000.5 }],
    ['clave de más (strict)', { ...ob, description: 'colada desde el cliente' }],
  ])('rechaza openingBalance con %s', async (_label, openingBalance) => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({ ...VALID_BASE, items: [{ memberId: 1, amountCents: 100, openingBalance }] })
    expect(result.success).toBe(false)
  })

  it('fromPeriod igual a toPeriod (un solo mes previo): acepta', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      ...VALID_BASE,
      items: [{ memberId: 1, amountCents: 100, openingBalance: { ...ob, fromPeriod: '2026-09-01', toPeriod: '2026-09-01' } }],
    })
    expect(result.success).toBe(true)
  })

  it('dos ítems con el mismo memberId: rechaza con el mensaje en path items', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      ...VALID_BASE,
      items: [
        { memberId: 1, amountCents: 100 },
        { memberId: 1, amountCents: 200 },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.message === 'El mismo socio aparece dos veces en el lote')
      expect(issue?.path).toEqual(['items'])
    }
  })
})

describe('registerPayment: register_payment_batch (un solo camino de escritura)', () => {
  function rpcRows(rows: Array<{ member_id: number; payment_id: number; amount_cents: number; opening_balance_fee_id?: number | null; already_registered?: boolean }>) {
    return rows.map((r) => ({ opening_balance_fee_id: null, already_registered: false, ...r }))
  }

  it('llama a la RPC con el lote en snake_case y la descripción armada; sin saldo anterior manda opening_balance: null', async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: rpcRows([
        { member_id: 1, payment_id: 11, amount_cents: 4_000_000, opening_balance_fee_id: 77 },
        { member_id: 2, payment_id: 12, amount_cents: 500_000 },
      ]),
      error: null,
    }))
    createClientMock.mockResolvedValue({ rpc })

    const { registerPayment } = await importModel()
    await registerPayment({
      batchId: BATCH,
      paidOn: '2026-09-01',
      method: 'transfer',
      receiptPath: 'payment-receipts/1/x.png',
      notes: 'nota',
      items: [
        { memberId: 1, amountCents: 4_000_000, openingBalance: { fromPeriod: '2026-07-01', toPeriod: '2026-09-01', amountCents: 3_000_000 } },
        { memberId: 2, amountCents: 500_000 },
      ],
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('register_payment_batch')
    expect(args).toEqual({
      batch_id: BATCH,
      paid_on: '2026-09-01',
      method: 'transfer',
      receipt_storage_path: 'payment-receipts/1/x.png',
      notes: 'nota',
      items: [
        {
          member_id: 1,
          amount_cents: 4_000_000,
          opening_balance: {
            from_period: '2026-07-01',
            to_period: '2026-09-01',
            amount_cents: 3_000_000,
            description: 'Saldo anterior · julio a septiembre 2026',
          },
        },
        { member_id: 2, amount_cents: 500_000, opening_balance: null },
      ],
    })
  })

  it('mapea el retorno: ids, total en centavos enteros, ids de saldos anteriores sin nulos, alreadyRegistered=false', async () => {
    createClientMock.mockResolvedValue({
      rpc: async () => ({
        data: rpcRows([
          { member_id: 1, payment_id: 1, amount_cents: 1_000_000, opening_balance_fee_id: 5 },
          { member_id: 2, payment_id: 2, amount_cents: 500_000 },
        ]),
        error: null,
      }),
    })
    const { registerPayment } = await importModel()
    const result = await registerPayment({ ...VALID_BASE, items: [{ memberId: 1, amountCents: 1_000_000 }, { memberId: 2, amountCents: 500_000 }] })
    expect(result).toEqual({ paymentIds: [1, 2], totalCents: 1_500_000, alreadyRegistered: false, openingBalanceFeeIds: [5] })
  })

  it('reintento: la RPC devuelve already_registered y el modelo lo refleja (no es un error)', async () => {
    createClientMock.mockResolvedValue({
      rpc: async () => ({ data: rpcRows([{ member_id: 1, payment_id: 10, amount_cents: 1_000_000, already_registered: true }]), error: null }),
    })
    const { registerPayment } = await importModel()
    const result = await registerPayment({ ...VALID_BASE, items: [{ memberId: 1, amountCents: 1_000_000 }] })
    expect(result).toEqual({ paymentIds: [10], totalCents: 1_000_000, alreadyRegistered: true, openingBalanceFeeIds: [] })
  })

  it('data null sin error: resultado vacío, no un crash', async () => {
    createClientMock.mockResolvedValue({ rpc: async () => ({ data: null, error: null }) })
    const { registerPayment } = await importModel()
    const result = await registerPayment({ ...VALID_BASE, items: [{ memberId: 1, amountCents: 100 }] })
    expect(result).toEqual({ paymentIds: [], totalCents: 0, alreadyRegistered: false, openingBalanceFeeIds: [] })
  })

  async function failWith(error: { code: string; message: string }) {
    createClientMock.mockResolvedValue({ rpc: async () => ({ data: null, error }) })
    const { registerPayment } = await importModel()
    return registerPayment({ ...VALID_BASE, items: [{ memberId: 1, amountCents: 100 }] }).catch((e) => e)
  }

  it('FK de socio inexistente (23503): DomainError claro con field memberId', async () => {
    const { DomainError } = await import('@/lib/errors')
    const err = await failWith({ code: '23503', message: 'insert or update on table "payments" violates foreign key constraint "payments_member_id_fkey"' })
    expect(err).toBeInstanceOf(DomainError)
    expect(err.field).toBe('memberId')
    expect(err.message).not.toMatch(/constraint|payments_member_id_fkey/)
  })

  it('23505 fees_one_opening_balance: DomainError que habla de "saldo anterior vigente", sin el nombre del índice', async () => {
    const { DomainError } = await import('@/lib/errors')
    const err = await failWith({ code: '23505', message: 'duplicate key value violates unique constraint "fees_one_opening_balance"' })
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).toMatch(/saldo anterior vigente/)
    expect(err.message).not.toMatch(/fees_one_opening_balance|constraint/)
  })

  it('23514 con texto redactado por la base: DomainError con ese texto', async () => {
    const { DomainError } = await import('@/lib/errors')
    const err = await failWith({ code: '23514', message: 'El saldo anterior solo cubre meses anteriores a 10/2026' })
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).toBe('El saldo anterior solo cubre meses anteriores a 10/2026')
  })

  it('23514 con el mensaje crudo de un CHECK de Postgres: NO se muestra al usuario (no es DomainError)', async () => {
    const { DomainError } = await import('@/lib/errors')
    const err = await failWith({ code: '23514', message: 'new row for relation "fees" violates check constraint "fees_amount_cents_check"' })
    expect(err).not.toBeInstanceOf(DomainError)
  })

  it('42501: PermissionError', async () => {
    const { PermissionError } = await import('@/lib/errors')
    const err = await failWith({ code: '42501', message: 'No tenés permiso para registrar pagos' })
    expect(err).toBeInstanceOf(PermissionError)
  })

  it('fecha futura: el texto del guard se traduce al mensaje de interfaz con field paidOn', async () => {
    const { DomainError } = await import('@/lib/errors')
    const err = await failWith({ code: '23514', message: 'La fecha del pago no puede ser futura' })
    expect(err).toBeInstanceOf(DomainError)
    expect(err.field).toBe('paidOn')
  })

  it('un error desconocido (no de dominio) se relanza tal cual, sin mostrarse al usuario', async () => {
    const { DomainError } = await import('@/lib/errors')
    const err = await failWith({ code: '57014', message: 'canceling statement due to statement timeout' })
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
