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

describe('registerPaymentSchema: meses marcados, saldo anterior por mes y lote', () => {
  const om = [
    { period: '2026-07-01', amountCents: 1_000_000 },
    { period: '2026-08-01', amountCents: 1_000_000 },
  ]
  const item = (extra: Record<string, unknown>) => ({ ...VALID_BASE, items: [{ memberId: 1, amountCents: 100, ...extra }] })

  it('acepta un ítem con meses marcados y saldo anterior por mes, uno solo con marcados y uno sin nada (null o ausente)', async () => {
    const { registerPaymentSchema } = await importModel()
    const result = registerPaymentSchema.safeParse({
      ...VALID_BASE,
      items: [
        { memberId: 1, amountCents: 4_000_000, markedPeriods: ['2026-07-01', '2026-09-01'], openingMonths: om },
        { memberId: 2, amountCents: 1_000_000, markedPeriods: ['2026-10-01'] },
        { memberId: 3, amountCents: 1_000_000, markedPeriods: null, openingMonths: null },
        { memberId: 4, amountCents: 1_000_000 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it.each([
    ['markedPeriods repetidos', { markedPeriods: ['2026-07-01', '2026-07-01'] }],
    ['markedPeriods con un día distinto de 1', { markedPeriods: ['2026-07-15'] }],
    ['markedPeriods con una fecha inválida', { markedPeriods: ['2026-13-01'] }],
    ['markedPeriods que no son fechas', { markedPeriods: ['julio'] }],
    ['más de 60 markedPeriods', { markedPeriods: Array.from({ length: 61 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`) }],
    ['openingMonths repetidos', { openingMonths: [om[0], om[0]] }],
    ['openingMonths con día distinto de 1', { openingMonths: [{ period: '2026-07-10', amountCents: 1000 }] }],
    ['openingMonths con monto 0', { openingMonths: [{ period: '2026-07-01', amountCents: 0 }] }],
    ['openingMonths con monto negativo', { openingMonths: [{ period: '2026-07-01', amountCents: -1 }] }],
    ['openingMonths con decimales (nunca floats)', { openingMonths: [{ period: '2026-07-01', amountCents: 1000.5 }] }],
    ['más de 36 openingMonths', { openingMonths: Array.from({ length: 37 }, (_, i) => ({ period: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, amountCents: 1000 })) }],
    ['clave de más en un mes (strict)', { openingMonths: [{ period: '2026-07-01', amountCents: 1000, description: 'colada desde el cliente' }] }],
    ['la forma vieja openingBalance (tramo): el cliente ya no la manda', { openingBalance: { fromPeriod: '2026-07-01', toPeriod: '2026-09-01', amountCents: 3_000_000 } }],
  ])('rechaza %s', async (_label, extra) => {
    const { registerPaymentSchema } = await importModel()
    expect(registerPaymentSchema.safeParse(item(extra)).success).toBe(false)
  })

  it('los bordes entran: 60 meses marcados y 36 de saldo anterior', async () => {
    const { registerPaymentSchema } = await importModel()
    const periods = (n: number) => Array.from({ length: n }, (_, i) => `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`)
    expect(registerPaymentSchema.safeParse(item({ markedPeriods: periods(60) })).success).toBe(true)
    expect(registerPaymentSchema.safeParse(item({ openingMonths: periods(36).map((period) => ({ period, amountCents: 1000 })) })).success).toBe(true)
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

  it('llama a la RPC con el lote en snake_case: marked_periods y opening_months (por mes); sin nada manda null/null; NUNCA opening_balance', async () => {
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
        {
          memberId: 1,
          amountCents: 4_000_000,
          markedPeriods: ['2026-07-01', '2026-09-01'],
          openingMonths: [
            { period: '2026-07-01', amountCents: 1_000_000 },
            { period: '2026-08-01', amountCents: 1_000_001 },
          ],
        },
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
          marked_periods: ['2026-07-01', '2026-09-01'],
          opening_months: [
            { period: '2026-07-01', amount_cents: 1_000_000 },
            { period: '2026-08-01', amount_cents: 1_000_001 },
          ],
        },
        { member_id: 2, amount_cents: 500_000, marked_periods: null, opening_months: null },
      ],
    })
    for (const it of (args as { items: Record<string, unknown>[] }).items) expect(it).not.toHaveProperty('opening_balance')
  })

  it('un array vacío viaja como null (con opening_months = [] la base diría "no son válidos")', async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: rpcRows([{ member_id: 1, payment_id: 1, amount_cents: 100 }]), error: null }))
    createClientMock.mockResolvedValue({ rpc })
    const { registerPayment } = await importModel()
    await registerPayment({ ...VALID_BASE, items: [{ memberId: 1, amountCents: 100, markedPeriods: [], openingMonths: [] }] })
    const items = (rpc.mock.calls[0][1] as { items: Record<string, unknown>[] }).items
    expect(items[0]).toEqual({ member_id: 1, amount_cents: 100, marked_periods: null, opening_months: null })
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

  it('23505 fees_one_opening_balance: DomainError "ya hay un saldo anterior cargado para uno de esos meses" en field items, sin el nombre del índice', async () => {
    const { DomainError } = await import('@/lib/errors')
    const err = await failWith({ code: '23505', message: 'duplicate key value violates unique constraint "fees_one_opening_balance"' })
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).toBe('Ya hay un saldo anterior cargado para uno de esos meses')
    expect(err.field).toBe('items')
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

  it.each([
    ['La cuota de 05/2026 ya está paga, o le falta menos de lo imputado'],
    ['Lo imputado supera el monto del pago'],
    ['Los meses marcados no son válidos'],
    ['Los meses del saldo anterior no son válidos'],
    ['El saldo anterior no puede ir más de 36 meses atrás'],
  ])('mensaje nuevo de imputación %j: DomainError literal en field items (no un 500 genérico)', async (message) => {
    const { DomainError } = await import('@/lib/errors')
    const err = await failWith({ code: '23514', message })
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).toBe(message)
    expect(err.field).toBe('items')
  })

  it('solo el texto EXACTO "El monto tiene que ser mayor a cero" se ata al monto; otro "mayor a cero" (saldo anterior) va a items', async () => {
    const err = await failWith({ code: '23514', message: 'El monto tiene que ser mayor a cero' })
    expect(err.field).toBe('amountCents')
    const other = await failWith({ code: '23514', message: 'El saldo anterior solo cubre meses anteriores a 10/2026 y cada mes tiene que ser mayor a cero' })
    expect(other.field).toBe('items')
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

describe('payments: imputaciones del embed (Cubre… / Saldo a favor)', () => {
  const baseRow = {
    member_id: 5,
    amount_cents: 3_000_000,
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
  }
  const alloc = (feeId: number, period: string, cents: number, source = 'marked', voidedAt: string | null = null, kind = 'monthly') => ({
    fee_id: feeId,
    amount_cents: cents,
    source,
    fee: { period, kind, voided_at: voidedAt },
  })

  function listClient(rows: unknown[], selectSpy?: (cols: string) => void) {
    const chain: Record<string, unknown> = {}
    let orders = 0
    chain.select = (cols: string) => (selectSpy?.(cols), chain)
    chain.eq = () => chain
    chain.order = () => (++orders < 2 ? chain : Promise.resolve({ data: rows, error: null }))
    return { from: () => chain }
  }

  it('el embed pide payment_allocations con la cuota (período, tipo, anulada)', async () => {
    let cols = ''
    createClientMock.mockResolvedValue(listClient([], (c) => (cols = c)))
    const { listPaymentsForMember } = await importModel()
    await listPaymentsForMember(5)
    expect(cols).toContain('payment_allocations(fee_id, amount_cents, source, fee:fees(period, kind, voided_at))')
  })

  it('mapea las imputaciones ordenadas por período y feeId; descarta las de cuotas anuladas', async () => {
    const rows = [
      {
        id: 1,
        ...baseRow,
        payment_allocations: [
          alloc(30, '2026-07-01', 1_000_000),
          alloc(10, '2026-05-01', 1_000_000, 'oldest_first'),
          alloc(20, '2026-06-01', 500_000, 'credit', '2026-09-20T00:00:00Z'), // cuota anulada: no cuenta
          alloc(11, '2026-05-01', 1, 'credit'), // mismo período: desempata por feeId
          alloc(40, '2026-03-01', 7, 'backfill', null, 'opening_balance'),
        ],
      },
    ]
    createClientMock.mockResolvedValue(listClient(rows))
    const { listPaymentsForMember } = await importModel()
    const [payment] = await listPaymentsForMember(5)
    expect(payment.allocations.map((a) => [a.feeId, a.period, a.amountCents, a.source, a.kind])).toEqual([
      [40, '2026-03-01', 7, 'backfill', 'opening_balance'],
      [10, '2026-05-01', 1_000_000, 'oldest_first', 'monthly'],
      [11, '2026-05-01', 1, 'credit', 'monthly'],
      [30, '2026-07-01', 1_000_000, 'marked', 'monthly'],
    ])
  })

  it('un pago anulado no muestra imputaciones (su plata dejó de cubrir cuotas)', async () => {
    const rows = [{ id: 1, ...baseRow, voided_at: '2026-09-16T00:00:00Z', void_reason: 'x', payment_allocations: [alloc(10, '2026-05-01', 1_000_000)] }]
    createClientMock.mockResolvedValue(listClient(rows))
    const { listPaymentsForMember } = await importModel()
    const [payment] = await listPaymentsForMember(5)
    expect(payment.allocations).toEqual([])
  })

  it('sin payment_allocations (null o ausente) → [] y no rompe; una imputación con la cuota null (RLS) se descarta', async () => {
    const rows = [
      { id: 1, ...baseRow, payment_allocations: null },
      { id: 2, ...baseRow },
      { id: 3, ...baseRow, payment_allocations: [{ fee_id: 9, amount_cents: 5, source: 'marked', fee: null }] },
    ]
    createClientMock.mockResolvedValue(listClient(rows))
    const { listPaymentsForMember } = await importModel()
    const result = await listPaymentsForMember(5)
    expect(result.map((p) => p.allocations)).toEqual([[], [], []])
  })

  it('getMonthPaymentsPage también trae las imputaciones (embed y mapeo)', async () => {
    const rows = [{ id: 1, ...baseRow, members: { first_name: 'Ana', last_name: 'Test' }, payment_allocations: [alloc(10, '2026-05-01', 1_000_000)] }]
    let cols = ''
    const query: Record<string, unknown> = { gte: () => query, lte: () => query, or: () => query, order: () => query, limit: async () => ({ data: rows, error: null }) }
    createClientMock.mockResolvedValue({ from: () => ({ select: (c: string) => ((cols = c), query) }) })
    const { getMonthPaymentsPage } = await importModel()
    const page = await getMonthPaymentsPage('2026-09-01')
    expect(cols).toContain('payment_allocations(')
    expect(page.items[0].allocations).toEqual([{ feeId: 10, period: '2026-05-01', kind: 'monthly', amountCents: 1_000_000, source: 'marked' }])
  })
})

describe('payments: ventana de despliegue (PGRST200 al embeber payment_allocations)', () => {
  const row = {
    id: 1, member_id: 5, amount_cents: 100, paid_on: '2026-09-15', method: 'cash', receipt_storage_path: null, receipt_filename: null,
    notes: null, batch_id: '11111111-1111-4111-8111-111111111111', created_by: null, created_at: '2026-09-15T00:00:00Z',
    voided_at: null, voided_by: null, void_reason: null,
  }
  const pgrst200 = { code: 'PGRST200', message: 'Could not find a relationship between payments and payment_allocations' }

  /** `select(cols)` que falla con `firstError` si pide el embed y devuelve `rows` si no. */
  function client(selects: string[], firstError: unknown, rows: unknown[], tail: 'list' | 'month') {
    return {
      from: () => ({
        select: (cols: string) => {
          selects.push(cols)
          const result = cols.includes('payment_allocations') ? { data: null, error: firstError } : { data: rows, error: null }
          const chain: Record<string, unknown> = {}
          let orders = 0
          chain.eq = () => chain
          chain.gte = () => chain
          chain.lte = () => chain
          chain.or = () => chain
          chain.order = () => (tail === 'list' && ++orders >= 2 ? Promise.resolve(result) : chain)
          chain.limit = async () => result
          return chain
        },
      }),
    }
  }

  it('listPaymentsForMember: reintenta SIN el embed y devuelve los pagos con allocations []', async () => {
    const selects: string[] = []
    createClientMock.mockResolvedValue(client(selects, pgrst200, [row], 'list'))
    const { listPaymentsForMember } = await importModel()
    const result = await listPaymentsForMember(5)
    expect(selects).toHaveLength(2)
    expect(selects[0]).toContain('payment_allocations(')
    expect(selects[1]).not.toContain('payment_allocations')
    expect(result).toHaveLength(1)
    expect(result[0].allocations).toEqual([])
  })

  it('getMonthPaymentsPage: lo mismo, con el nombre del socio', async () => {
    const selects: string[] = []
    createClientMock.mockResolvedValue(client(selects, pgrst200, [{ ...row, members: { first_name: 'Ana', last_name: 'Test' } }], 'month'))
    const { getMonthPaymentsPage } = await importModel()
    const page = await getMonthPaymentsPage('2026-09-01')
    expect(selects).toHaveLength(2)
    expect(selects[1]).not.toContain('payment_allocations')
    expect(page.items[0].allocations).toEqual([])
    expect(page.items[0].memberFullName).toBe('Test, Ana')
  })

  it('cualquier OTRO error (ej. 42501) NO dispara el reintento: se relanza', async () => {
    const selects: string[] = []
    const denied = { code: '42501', message: 'permission denied' }
    createClientMock.mockResolvedValue(client(selects, denied, [row], 'list'))
    const { listPaymentsForMember } = await importModel()
    await expect(listPaymentsForMember(5)).rejects.toEqual(denied)
    expect(selects).toHaveLength(1)
  })
})
