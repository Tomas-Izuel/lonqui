import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Adapter sobre Supabase Storage, detrás de un puerto chico (subir, firmar,
 * comprobar existencia) para que B2 no dependa de la forma exacta de la API
 * de supabase-js en más de un lugar.
 *
 * SIEMPRE con el cliente de sesión (`lib/supabase/server.ts`), nunca
 * `createAdminClient()`: así las policies de `storage.objects` aplican con el
 * rol de quien sube, y el `owner` del objeto queda en quien lo subió.
 */

const BUCKET = 'attachments'

/**
 * URL de subida firmada para que el browser suba el archivo directo a
 * Storage (D11): un Server Action no puede recibir el archivo (el límite de
 * body de una función de Vercel es 4,5 MB). `createSignedUploadUrl` de
 * supabase-js no acepta un TTL por llamada — la vigencia del token de subida
 * es configuración del proyecto, no un parámetro de esta API (verificado en
 * Context7, `@supabase/storage-js`).
 */
export async function createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error) throw error
  return data
}

/** URL de lectura firmada, de vida corta (60 s para abrir un certificado, por contrato de B2). */
export async function getSignedUrl(path: string, ttlSeconds: number): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSeconds)
  if (error) throw error
  return data.signedUrl
}

/**
 * Si el objeto existe en el bucket. `exists()` de supabase-js ya devuelve
 * `false` (no tira) para 400/404; solo relanza errores de verdad (red, auth).
 * Con la RLS de `storage.objects`, un objeto fuera de lo que el rol activo
 * puede ver también resulta `false` acá, que es el comportamiento correcto.
 */
export async function objectExists(path: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.storage.from(BUCKET).exists(path)
  return data
}
