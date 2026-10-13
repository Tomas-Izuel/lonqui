import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { ExportListing } from '@/models/types'

/**
 * Audita una exportación a CSV (el momento en que datos personales salen del
 * sistema). La RPC `log_export` valida el permiso y la lista cerrada, y
 * toma el actor de `auth.uid()`: por eso va con el cliente de sesión. Si
 * falla, tira: el llamador NO debe entregar el archivo.
 */
export async function logExport(
  listing: ExportListing,
  filters: Record<string, unknown>,
  rowCount: number,
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('log_export', {
    listing,
    filters: JSON.parse(JSON.stringify(filters)),
    row_count: rowCount,
  })
  if (error) throw error
}
