import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env.server'
import type { Database } from './database.types'

/**
 * Cliente con la secret key: BYPASSEA RLS por completo.
 *
 * Solo para lo que no tiene un usuario detrás o lo que la Admin API exige:
 *   - crear e invitar usuarios de Auth desde /usuarios
 *   - jobs sin sesión
 *
 * **No se usa para escrituras del dominio.** La auditoría toma el actor de
 * `auth.uid()`, que con esta clave es `null`: un pago registrado por acá queda
 * sin autor. Si la sesión da `permission denied`, la pregunta es si ese rol
 * debería poder hacerlo, no cómo esquivar la RLS.
 *
 * Nunca en respuesta a algo que mandó el browser sin validar con Zod y sin
 * verificar el rol en el servidor.
 *
 * Singleton: con `persistSession: false` no guarda estado por request, así que
 * no hay nada que se pueda filtrar entre usuarios.
 */
let cached: ReturnType<typeof createSupabaseClient<Database>> | null = null

export function createAdminClient() {
  if (cached) return cached

  const env = serverEnv()
  cached = createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
