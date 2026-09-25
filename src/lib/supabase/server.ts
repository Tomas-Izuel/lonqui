import 'server-only'

import { cache } from 'react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env.server'
import type { Database } from './database.types'

/**
 * Cliente para Server Components, Server Actions y Route Handlers.
 * Actúa como el usuario logueado: RLS aplica y `auth.uid()` existe, que es de
 * donde la auditoría saca el actor. Es el cliente de TODO el panel.
 */
export async function createClient() {
  const cookieStore = await cookies()
  const env = serverEnv()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Los Server Components no pueden escribir cookies. El refresh de
            // sesión lo hace proxy.ts, así que ignorar acá es correcto.
          }
        },
      },
    },
  )
}

/**
 * El usuario de la sesión, UNA sola vez por request.
 *
 * `auth.getUser()` es un round trip HTTP al servidor de Auth, no una validación
 * local, y el rate limit es por proyecto. El layout, la page y cada chequeo de
 * rol lo pedirían de nuevo.
 *
 * `cache()` de React memoiza por request (no entre requests), que es
 * exactamente la vida útil de una sesión.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ?? null
})
