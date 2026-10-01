/**
 * Subida del comprobante de transferencia: mismo patrón de dos pasos que el
 * apto físico (D11, `medical-clearance-section.tsx`) — URL firmada, subida
 * directa del browser a Storage, y recién ahí el path viaja al servidor.
 * Nunca `server-only` (lo usan Client Components de `payment-form.tsx` y
 * `group-payment-form.tsx`).
 */

import { createClient } from '@/lib/supabase/client'
import { prepareReceiptUpload } from '@/controllers/payments.actions'

export const RECEIPT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const RECEIPT_MAX_SIZE_BYTES = 10 * 1024 * 1024
const COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024
const BUCKET = 'attachments'

export function validateReceiptFile(file: File): string | null {
  if (!RECEIPT_ALLOWED_MIME_TYPES.includes(file.type)) {
    return 'Subí un archivo PDF, JPG, PNG o WEBP'
  }
  if (file.size > RECEIPT_MAX_SIZE_BYTES) {
    return 'El archivo no puede pesar más de 10 MB'
  }
  return null
}

/** Reduce una imagen > 2 MB en el browser antes de subir. Un PDF pasa tal cual. */
export async function maybeCompressReceipt(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= COMPRESS_THRESHOLD_BYTES) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  if (!blob) return file
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
}

export type UploadedReceipt = { path: string; filename: string }

/**
 * Comprime, pide la URL firmada y sube. Un solo comprobante sirve para las N
 * filas de un lote de grupo (payments.model.ts, S2): se sube una vez, con el
 * primer socio del lote como dueño del path.
 */
export async function uploadReceipt(memberId: number, file: File): Promise<UploadedReceipt | { error: string }> {
  const processed = await maybeCompressReceipt(file)

  const prep = await prepareReceiptUpload({ memberId, mimeType: processed.type, sizeBytes: processed.size })
  if (!prep.ok) return { error: prep.error }

  const supabase = createClient()
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(prep.data.path, prep.data.token, processed)
  if (error) return { error: 'No pudimos subir el comprobante. Probá de nuevo.' }

  return { path: prep.data.path, filename: file.name }
}
