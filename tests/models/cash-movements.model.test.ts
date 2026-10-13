import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, fakeSupabase, ok } from '../stubs/supabase-mock'

/**
 * `cash-movements.model.ts`: schema de registro (fecha en zona del club,
 * comprobante con prefijo propio), idempotencia por `batch_id`, traducción de
 * los mensajes que redacta la migración a `DomainError` con `field`, y las
 * lecturas (tope de 500, paginado para exportar sin el corte mudo de
 * `max_rows`). El cliente de Supabase se mockea en el borde externo; las
 * invariantes reales viven en `tests/db/cash.test.ts`.
 */

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const BATCH = '11111111-1111-4111-8111-111111111111'

async function importModel() {
  return import('@/models/cash-movements.model')
}
const { DomainError, PermissionError } = await import('@/lib/errors')

beforeEach(() => {
  createClientMock.mockReset()
})

const validInput = {
  batchId: BATCH,
  conceptId: 3,
  amountCents: 1_500_000,
  occurredOn: '2026-01-15',
  method: 'cash' as const,
}

describe('registerCashMovementSchema', () => {
  it('forma válida mínima y completa: acepta', async () => {
    const { registerCashMovementSchema } = await importModel()
    expect(registerCashMovementSchema.safeParse(validInput).success).toBe(true)
    expect(
      registerCashMovementSchema.safeParse({
        ...validInput,
        method: 'transfer',
        sponsorId: 7,
        description: '  Aporte de temporada  ',
        receiptPath: `cash-receipts/${BATCH}/abc.pdf`,
      }).success,
    ).toBe(true)
  })

  it('el detalle se recorta y el opcional puede ser null', async () => {
    const { registerCashMovementSchema } = await importModel()
    const parsed = registerCashMovementSchema.parse({ ...validInput, description: '  hola  ', sponsorId: null })
    expect(parsed.description).toBe('hola')
    expect(parsed.sponsorId).toBeNull()
  })

  it.each([
    ['monto cero', { amountCents: 0 }, 'amountCents'],
    ['monto negativo', { amountCents: -1 }, 'amountCents'],
    ['monto con decimales (centavos fraccionarios)', { amountCents: 100.5 }, 'amountCents'],
    ['concepto cero', { conceptId: 0 }, 'conceptId'],
    ['batchId que no es uuid', { batchId: 'no-es-uuid' }, 'batchId'],
    ['medio inválido', { method: 'cheque' }, 'method'],
    ['fecha inválida', { occurredOn: '2026-02-31' }, 'occurredOn'],
    ['comprobante de otro prefijo', { receiptPath: 'payment-receipts/1/a.pdf' }, 'receiptPath'],
    ['comprobante sin prefijo', { receiptPath: 'a.pdf' }, 'receiptPath'],
    ['detalle de 501 caracteres', { description: 'x'.repeat(501) }, 'description'],
  ])('%s: rechaza y el primer issue apunta al campo %s', async (_name, patch, field) => {
    const { registerCashMovementSchema } = await importModel()
    const result = registerCashMovementSchema.safeParse({ ...validInput, ...patch })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path[0]).toBe(field)
  })

  it('claves desconocidas (por ejemplo createdBy o direction): rechaza, nada se cuela', async () => {
    const { registerCashMovementSchema } = await importModel()
    expect(registerCashMovementSchema.safeParse({ ...validInput, createdBy: 'x' }).success).toBe(false)
    expect(registerCashMovementSchema.safeParse({ ...validInput, direction: 'expense' }).success).toBe(false)
  })

  it('fecha: hoy del club entra; mañana no (zona Buenos Aires, no UTC); antes de 2020 no; 1/1/2020 entra', async () => {
    const { registerCashMovementSchema } = await importModel()
    // 2026-03-01 02:30 UTC sigue siendo el 28/02 a las 23:30 en Buenos Aires.
    vi.useFakeTimers({ now: new Date('2026-03-01T02:30:00Z') })
    try {
      expect(registerCashMovementSchema.safeParse({ ...validInput, occurredOn: '2026-02-28' }).success).toBe(true)
      const tomorrow = registerCashMovementSchema.safeParse({ ...validInput, occurredOn: '2026-03-01' })
      expect(tomorrow.success).toBe(false)
      if (!tomorrow.success) {
        expect(tomorrow.error.issues[0].path).toEqual(['occurredOn'])
        expect(tomorrow.error.issues[0].message).toBe('La fecha del ingreso no puede ser futura')
      }
      expect(registerCashMovementSchema.safeParse({ ...validInput, occurredOn: '2019-12-31' }).success).toBe(false)
      expect(registerCashMovementSchema.safeParse({ ...validInput, occurredOn: '2020-01-01' }).success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('voidCashMovementSchema / prepareCashReceiptUploadSchema', () => {
  it('motivo: 3 caracteres (ya recortado) entra; 2 o solo espacios no', async () => {
    const { voidCashMovementSchema } = await importModel()
    expect(voidCashMovementSchema.safeParse({ movementId: 1, reason: ' abc ' }).success).toBe(true)
    expect(voidCashMovementSchema.safeParse({ movementId: 1, reason: 'ab' }).success).toBe(false)
    expect(voidCashMovementSchema.safeParse({ movementId: 1, reason: '    ' }).success).toBe(false)
    expect(voidCashMovementSchema.safeParse({ movementId: 1, reason: 'x'.repeat(501) }).success).toBe(false)
    expect(voidCashMovementSchema.safeParse({ movementId: 0, reason: 'abc' }).success).toBe(false)
  })

  it('subida de comprobante: MIME permitido y tamaño hasta 10 MB; 10 MB + 1, vacío o MIME ajeno rechazan', async () => {
    const { prepareCashReceiptUploadSchema, MAX_CASH_RECEIPT_SIZE_BYTES } = await importModel()
    const base = { batchId: BATCH, mimeType: 'application/pdf', sizeBytes: 1000 }
    expect(prepareCashReceiptUploadSchema.safeParse(base).success).toBe(true)
    expect(prepareCashReceiptUploadSchema.safeParse({ ...base, sizeBytes: MAX_CASH_RECEIPT_SIZE_BYTES }).success).toBe(true)
    expect(prepareCashReceiptUploadSchema.safeParse({ ...base, sizeBytes: MAX_CASH_RECEIPT_SIZE_BYTES + 1 }).success).toBe(false)
    expect(prepareCashReceiptUploadSchema.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false)
    expect(prepareCashReceiptUploadSchema.safeParse({ ...base, mimeType: 'application/zip' }).success).toBe(false)
  })
})

describe('buildCashReceiptPath', () => {
  it('cash-receipts/<batchId>/<uuid>.<ext> con la extensión del MIME y un uuid distinto cada vez', async () => {
    const { buildCashReceiptPath, CASH_RECEIPT_PATH_PREFIX } = await importModel()
    const a = buildCashReceiptPath(BATCH, 'image/webp')
    expect(a.startsWith(`${CASH_RECEIPT_PATH_PREFIX}${BATCH}/`)).toBe(true)
    expect(a.endsWith('.webp')).toBe(true)
    expect(buildCashReceiptPath(BATCH, 'image/webp')).not.toBe(a)
  })
})

describe('registerCashMovement', () => {
  it('éxito: manda direction income, batch_id y null para lo opcional vacío; devuelve id y monto de la fila', async () => {
    const fake = fakeSupabase({ from: { cash_movements: [ok({ id: 9, amount_cents: 1_500_000 })] } })
    createClientMock.mockResolvedValue(fake.client)
    const { registerCashMovement } = await importModel()

    const result = await registerCashMovement({ ...validInput, description: '' })

    expect(result).toEqual({ movementId: 9, amountCents: 1_500_000, alreadyRegistered: false })
    const insert = fake.opsOf('from:cash_movements').find(([m]) => m === 'insert')
    expect(insert?.[1][0]).toMatchObject({
      direction: 'income',
      concept_id: 3,
      sponsor_id: null,
      amount_cents: 1_500_000,
      occurred_on: '2026-01-15',
      method: 'cash',
      receipt_storage_path: null,
      receipt_filename: null,
      description: null,
      batch_id: BATCH,
    })
  })

  it('el comprobante guarda la ruta y como nombre solo el basename (no una URL)', async () => {
    const fake = fakeSupabase({ from: { cash_movements: [ok({ id: 1, amount_cents: 100 })] } })
    createClientMock.mockResolvedValue(fake.client)
    const { registerCashMovement } = await importModel()
    await registerCashMovement({ ...validInput, method: 'transfer', receiptPath: `cash-receipts/${BATCH}/abc.pdf` })
    const row = fake.opsOf('from:cash_movements').find(([m]) => m === 'insert')?.[1][0] as Record<string, unknown>
    expect(row.receipt_storage_path).toBe(`cash-receipts/${BATCH}/abc.pdf`)
    expect(row.receipt_filename).toBe('abc.pdf')
  })

  it('mismo batch_id (23505 sobre cash_movements_batch_id_key): éxito idempotente con la fila que ya existía', async () => {
    const fake = fakeSupabase({
      from: {
        cash_movements: [
          fail('23505', 'duplicate key value violates unique constraint "cash_movements_batch_id_key"'),
          ok({ id: 4, amount_cents: 1_500_000 }),
        ],
      },
    })
    createClientMock.mockResolvedValue(fake.client)
    const { registerCashMovement } = await importModel()

    const result = await registerCashMovement(validInput)

    expect(result).toEqual({ movementId: 4, amountCents: 1_500_000, alreadyRegistered: true })
    // Busca la fila existente por el MISMO batch_id (nunca regenera uno).
    const lookup = fake.opsOf('from:cash_movements', 1)
    expect(lookup).toContainEqual(['eq', ['batch_id', BATCH]])
  })

  it('comprobante de OTRO lote (cash-receipts/<otro batchId>/...): DomainError field receiptPath, sin insertar', async () => {
    const fake = fakeSupabase({ from: { cash_movements: [ok({ id: 1, amount_cents: 1 })] } })
    createClientMock.mockResolvedValue(fake.client)
    const { registerCashMovement } = await importModel()
    const other = '22222222-2222-4222-8222-222222222222'
    for (const receiptPath of [`cash-receipts/${other}/a.pdf`, 'cash-receipts/a.pdf', `cash-receipts/${BATCH}x/a.pdf`]) {
      const err = await registerCashMovement({ ...validInput, method: 'transfer', receiptPath }).catch((e) => e)
      expect(err, receiptPath).toBeInstanceOf(DomainError)
      expect(err.field).toBe('receiptPath')
    }
    expect(fake.count('from:cash_movements')).toBe(0)
  })

  it('un 23505 de OTRO índice no se confunde con "ya registrado": se relanza', async () => {
    const raw = fail('23505', 'duplicate key value violates unique constraint "otra_cosa_key"')
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [raw] } }).client)
    const { registerCashMovement } = await importModel()
    const err = await registerCashMovement(validInput).catch((e) => e)
    expect(err).not.toBeInstanceOf(DomainError)
    expect(err.code).toBe('23505')
  })

  it.each([
    ['23514', 'La fecha del ingreso no puede ser futura', 'occurredOn'],
    ['23514', 'La fecha del ingreso es demasiado vieja', 'occurredOn'],
    ['23514', 'El concepto está desactivado', 'conceptId'],
    ['23503', 'El concepto no existe', 'conceptId'],
    ['23514', 'El concepto no corresponde a este tipo de movimiento', 'conceptId'],
    ['23514', 'Elegí el sponsor', 'sponsorId'],
    ['23503', 'El sponsor no existe', 'sponsorId'],
    ['23514', 'El sponsor está desactivado', 'sponsorId'],
  ])('guard del INSERT (%s) "%s" -> DomainError con field %s y el mismo texto', async (code, message, field) => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [fail(code, message)] } }).client)
    const { registerCashMovement } = await importModel()
    const err = await registerCashMovement(validInput).catch((e) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).toBe(message)
    expect(err.field).toBe(field)
  })

  it('CHECK de monto y de ruta del comprobante: mensaje de dominio sin el nombre del constraint', async () => {
    const { registerCashMovement } = await importModel()

    createClientMock.mockResolvedValue(
      fakeSupabase({ from: { cash_movements: [fail('23514', 'new row for relation "cash_movements" violates check constraint "cash_movements_amount_cents_check"')] } }).client,
    )
    const amount = await registerCashMovement(validInput).catch((e) => e)
    expect(amount).toBeInstanceOf(DomainError)
    expect(amount.field).toBe('amountCents')
    expect(amount.message).not.toMatch(/constraint|cash_movements/)

    createClientMock.mockResolvedValue(
      fakeSupabase({ from: { cash_movements: [fail('23514', 'new row for relation "cash_movements" violates check constraint "cash_movements_receipt_storage_path_check"')] } }).client,
    )
    const receipt = await registerCashMovement(validInput).catch((e) => e)
    expect(receipt).toBeInstanceOf(DomainError)
    expect(receipt.field).toBe('receiptPath')
  })

  it('un error desconocido (timeout) se relanza crudo: el controller lo vuelve genérico', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [fail('57014', 'canceling statement due to statement timeout')] } }).client)
    const { registerCashMovement } = await importModel()
    const err = await registerCashMovement(validInput).catch((e) => e)
    expect(err).not.toBeInstanceOf(DomainError)
  })
})

describe('voidCashMovement', () => {
  it('manda solo el motivo (voided_at/voided_by los fija el guard, no el cliente)', async () => {
    const fake = fakeSupabase({ from: { cash_movements: [ok({ id: 5 })] } })
    createClientMock.mockResolvedValue(fake.client)
    const { voidCashMovement } = await importModel()
    await voidCashMovement(5, 'Cargado dos veces')
    const update = fake.opsOf('from:cash_movements').find(([m]) => m === 'update')
    expect(update?.[1][0]).toEqual({ void_reason: 'Cargado dos veces' })
    expect(fake.opsOf('from:cash_movements')).toContainEqual(['eq', ['id', 5]])
  })

  it('0 filas (no existe o no lo ve): DomainError 404', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [ok(null)] } }).client)
    const { voidCashMovement } = await importModel()
    await expect(voidCashMovement(99, 'motivo')).rejects.toMatchObject({ message: 'El ingreso no existe', status: 404 })
  })

  it('ya anulado -> DomainError con el texto del guard', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [fail('23514', 'Este ingreso ya está anulado')] } }).client)
    const { voidCashMovement } = await importModel()
    await expect(voidCashMovement(1, 'motivo')).rejects.toMatchObject({ message: 'Este ingreso ya está anulado' })
  })

  it('motivo corto que llega a la base: DomainError con field reason', async () => {
    const { voidCashMovement } = await importModel()
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [fail('23514', 'Para anular un ingreso hace falta un motivo')] } }).client)
    await expect(voidCashMovement(1, 'ab')).rejects.toMatchObject({ field: 'reason' })
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [fail('23514', 'violates check constraint "cash_movements_void_triad"')] } }).client)
    await expect(voidCashMovement(1, 'ab')).rejects.toMatchObject({ field: 'reason' })
  })

  it('42501 (sin income.void) -> PermissionError 403', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [fail('42501', 'No tenés permiso para anular ingresos')] } }).client)
    const { voidCashMovement } = await importModel()
    const err = await voidCashMovement(1, 'motivo').catch((e) => e)
    expect(err).toBeInstanceOf(PermissionError)
    expect(err.status).toBe(403)
  })
})

describe('lecturas', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 1,
    direction: 'income',
    concept_id: 3,
    sponsor_id: 7,
    amount_cents: 2_500_000,
    occurred_on: '2026-09-15',
    method: 'transfer',
    receipt_storage_path: 'cash-receipts/x/y.pdf',
    receipt_filename: 'y.pdf',
    description: 'Aporte',
    batch_id: BATCH,
    created_by: 'user-1',
    created_at: '2026-09-15T12:00:00Z',
    voided_at: null,
    void_reason: null,
    cash_concepts: { name: 'Sponsor' },
    sponsors: { name: 'Corralón Inventado' },
    ...over,
  })

  it('listCashMovements: mapea la fila (hasReceipt, voided, nombres) sin exponer la ruta del comprobante', async () => {
    const fake = fakeSupabase({
      from: {
        cash_movements: [ok([row(), row({ id: 2, voided_at: '2026-09-16T00:00:00Z', void_reason: 'Cargado dos veces', receipt_storage_path: null, receipt_filename: null, sponsor_id: null, sponsors: null, created_by: null })])],
        app_users: [ok([{ user_id: 'user-1', display_name: 'Persona Inventada' }])],
      },
    })
    createClientMock.mockResolvedValue(fake.client)
    const { listCashMovements } = await importModel()

    const list = await listCashMovements({ period: '2026-09-01' })

    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ conceptName: 'Sponsor', sponsorName: 'Corralón Inventado', hasReceipt: true, voided: false, createdByName: 'Persona Inventada', amountCents: 2_500_000 })
    expect(list[1]).toMatchObject({ voided: true, voidReason: 'Cargado dos veces', hasReceipt: false, sponsorName: null, createdByName: null })
    // La ruta de Storage nunca sale del modelo hacia la vista.
    expect(JSON.stringify(list)).not.toContain('cash-receipts/')
  })

  it('listCashMovements: rango del mes completo, tope de 500 y filtros opcionales; nombres de quien cargó en UNA consulta (sin N+1)', async () => {
    const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]
    const fake = fakeSupabase({ from: { cash_movements: [ok(rows)], app_users: [ok([])] } })
    createClientMock.mockResolvedValue(fake.client)
    const { listCashMovements, CASH_MOVEMENTS_LIST_LIMIT } = await importModel()

    await listCashMovements({ period: '2026-02-01', conceptId: 3, sponsorId: 7 })

    const ops = fake.opsOf('from:cash_movements')
    expect(ops).toContainEqual(['gte', ['occurred_on', '2026-02-01']])
    expect(ops).toContainEqual(['lte', ['occurred_on', '2026-02-28']])
    expect(ops).toContainEqual(['eq', ['concept_id', 3]])
    expect(ops).toContainEqual(['eq', ['sponsor_id', 7]])
    // Pide uno de más para que el controller sepa si hubo truncado sin ambigüedad.
    expect(ops).toContainEqual(['limit', [501]])
    expect(CASH_MOVEMENTS_LIST_LIMIT).toBe(500)
    expect(fake.count('from:app_users')).toBe(1)
  })

  it('listCashMovements: sin filtros no manda eq de concepto ni de sponsor', async () => {
    const fake = fakeSupabase({ from: { cash_movements: [ok([])] } })
    createClientMock.mockResolvedValue(fake.client)
    const { listCashMovements } = await importModel()
    await listCashMovements({ period: '2024-02-01' })
    const ops = fake.opsOf('from:cash_movements')
    expect(ops.some(([m, a]) => m === 'eq' && (a[0] === 'concept_id' || a[0] === 'sponsor_id'))).toBe(false)
    // Bisiesto: el borde del mes es el 29.
    expect(ops).toContainEqual(['lte', ['occurred_on', '2024-02-29']])
  })

  it('un error de la consulta se propaga (no se traga como lista vacía)', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [fail('42501', 'permission denied')] } }).client)
    const { listCashMovements } = await importModel()
    await expect(listCashMovements({ period: '2026-09-01' })).rejects.toMatchObject({ code: '42501' })
  })

  it('listAllCashMovements: pagina de a 1000 hasta agotar (no se queda en el corte mudo de max_rows)', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => row({ id: from + i, created_by: null }))
    const fake = fakeSupabase({
      from: { cash_movements: [ok(page(1, 1000)), ok(page(1001, 1000)), ok(page(2001, 250))] },
    })
    createClientMock.mockResolvedValue(fake.client)
    const { listAllCashMovements } = await importModel()

    const all = await listAllCashMovements({ period: '2026-09-01' })

    expect(all).toHaveLength(2250)
    expect(fake.count('from:cash_movements')).toBe(3)
    expect(fake.opsOf('from:cash_movements', 0)).toContainEqual(['range', [0, 999]])
    expect(fake.opsOf('from:cash_movements', 1)).toContainEqual(['range', [1000, 1999]])
    expect(fake.opsOf('from:cash_movements', 2)).toContainEqual(['range', [2000, 2999]])
  })

  it('listAllCashMovements: una página exacta de 1000 pide la siguiente (podría haber más) y termina con una vacía', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row({ id: i + 1, created_by: null }))
    const fake = fakeSupabase({ from: { cash_movements: [ok(full), ok([])] } })
    createClientMock.mockResolvedValue(fake.client)
    const { listAllCashMovements } = await importModel()
    const all = await listAllCashMovements({ period: '2026-09-01' })
    expect(all).toHaveLength(1000)
    expect(fake.count('from:cash_movements')).toBe(2)
  })

  it('listAllCashMovements: al llegar al techo de 20.000 filas TIRA un DomainError (no corta en silencio)', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row({ id: i + 1, created_by: null }))
    const fake = fakeSupabase({ from: { cash_movements: [ok(full)], app_users: [ok([])] } })
    createClientMock.mockResolvedValue(fake.client)
    const { listAllCashMovements } = await importModel()
    const err = await listAllCashMovements({ period: '2026-09-01' }).catch((e) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).toMatch(/demasiados ingresos/)
    expect(fake.count('from:cash_movements')).toBe(20)
  })

  it('listAllCashMovements: justo por debajo del techo (19.999 filas) exporta todo sin error', async () => {
    const pages = Array.from({ length: 19 }, (_, p) => ok(Array.from({ length: 1000 }, (_, i) => row({ id: p * 1000 + i, created_by: null }))))
    pages.push(ok(Array.from({ length: 999 }, (_, i) => row({ id: 19000 + i, created_by: null }))))
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: pages, app_users: [ok([])] } }).client)
    const { listAllCashMovements } = await importModel()
    expect(await listAllCashMovements({ period: '2026-09-01' })).toHaveLength(19_999)
  })

  it('getCashReceiptPath: devuelve la ruta, o null si no hay comprobante o el ingreso no existe', async () => {
    const { getCashReceiptPath } = await importModel()
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [ok({ receipt_storage_path: 'cash-receipts/a/b.pdf' })] } }).client)
    expect(await getCashReceiptPath(1)).toBe('cash-receipts/a/b.pdf')
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [ok({ receipt_storage_path: null })] } }).client)
    expect(await getCashReceiptPath(1)).toBeNull()
    createClientMock.mockResolvedValue(fakeSupabase({ from: { cash_movements: [ok(null)] } }).client)
    expect(await getCashReceiptPath(1)).toBeNull()
  })

  it('listSponsorMovements: del sponsor pedido, incluidos anulados, más nuevo primero', async () => {
    const fake = fakeSupabase({ from: { cash_movements: [ok([row()])], app_users: [ok([])] } })
    createClientMock.mockResolvedValue(fake.client)
    const { listSponsorMovements } = await importModel()
    await listSponsorMovements(7)
    const ops = fake.opsOf('from:cash_movements')
    expect(ops).toContainEqual(['eq', ['sponsor_id', 7]])
    expect(ops).toContainEqual(['order', ['occurred_on', { ascending: false }]])
    // No filtra anulados.
    expect(ops.some(([m, a]) => (m === 'is' || m === 'eq') && a[0] === 'voided_at')).toBe(false)
  })
})
