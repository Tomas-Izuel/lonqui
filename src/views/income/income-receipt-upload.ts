/**
 * Subida del comprobante de un ingreso: mismo patrón de dos pasos que el de
 * pagos (`views/payments/receipt-upload.ts`) — URL firmada, subida directa del
 * browser a Storage, y recién ahí el path viaja al servidor. La ruta la arma
 * el servidor con el `batchId` del formulario (`cash-receipts/<batchId>/…`):
 * nunca se construye una URL de Storage acá.
 */

import { createClient } from '@/lib/supabase/client'
import { prepareCashReceiptUpload } from '@/controllers/income.actions'
import { maybeCompressReceipt } from '@/views/payments/receipt-upload'

const BUCKET = 'attachments'

export type UploadedCashReceipt = { path: string; filename: string }

export async function uploadCashReceipt(batchId: string, file: File): Promise<UploadedCashReceipt | { error: string }> {
  const processed = await maybeCompressReceipt(file)

  const prep = await prepareCashReceiptUpload({ batchId, mimeType: processed.type, sizeBytes: processed.size })
  if (!prep.ok) return { error: prep.error }

  const supabase = createClient()
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(prep.data.path, prep.data.token, processed)
  if (error) return { error: 'No pudimos subir el comprobante. Probá de nuevo.' }

  return { path: prep.data.path, filename: file.name }
}
