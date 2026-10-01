import { describe, expect, it, vi } from 'vitest'

/**
 * `validateReceiptFile` (cliente) tiene que rechazar lo mismo que
 * `prepareReceiptUploadSchema` (servidor) y decirlo igual. Se mockean los
 * bordes que `receipt-upload.ts` importa (la Server Action y el cliente de
 * Supabase del browser): lo que se prueba es la validación pura.
 */
vi.mock('@/controllers/payments.actions', () => ({ prepareReceiptUpload: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const { validateReceiptFile, RECEIPT_MAX_SIZE_BYTES, RECEIPT_ALLOWED_MIME_TYPES } = await import('@/views/payments/receipt-upload')
const { prepareReceiptUploadSchema, MAX_RECEIPT_SIZE_BYTES } = await import('@/models/payments.model')

const fakeFile = (type: string, size: number) => ({ type, size }) as File

function serverMessage(mimeType: string, sizeBytes: number): string | undefined {
  const result = prepareReceiptUploadSchema.safeParse({ memberId: 1, mimeType, sizeBytes })
  return result.success ? undefined : result.error.issues[0]?.message
}

describe('validateReceiptFile vs prepareReceiptUploadSchema', () => {
  it('mismos límites y mismos tipos que el servidor', () => {
    expect(RECEIPT_MAX_SIZE_BYTES).toBe(MAX_RECEIPT_SIZE_BYTES)
    for (const mime of RECEIPT_ALLOWED_MIME_TYPES) expect(serverMessage(mime, 1000)).toBeUndefined()
  })

  it('frontera de tamaño: exactamente 10 MiB pasa en los dos lados, un byte más falla en los dos', () => {
    expect(validateReceiptFile(fakeFile('application/pdf', RECEIPT_MAX_SIZE_BYTES))).toBeNull()
    expect(serverMessage('application/pdf', RECEIPT_MAX_SIZE_BYTES)).toBeUndefined()
    expect(validateReceiptFile(fakeFile('application/pdf', RECEIPT_MAX_SIZE_BYTES + 1))).not.toBeNull()
    expect(serverMessage('application/pdf', RECEIPT_MAX_SIZE_BYTES + 1)).toBeDefined()
  })

  it('tipo no admitido: se rechaza en los dos lados con el MISMO texto', () => {
    const c = validateReceiptFile(fakeFile('application/zip', 100))
    expect(c).not.toBeNull()
    expect(c).toBe(serverMessage('application/zip', 100))
  })

  it('archivo demasiado grande: el MISMO texto en los dos lados', () => {
    const c = validateReceiptFile(fakeFile('image/png', RECEIPT_MAX_SIZE_BYTES + 1))
    expect(c).toBe(serverMessage('image/png', RECEIPT_MAX_SIZE_BYTES + 1))
  })
})
