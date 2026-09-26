import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { AppRole } from '@/models/types'

export type OwnAppUserRow = {
  displayName: string
  role: AppRole
  isActive: boolean
  mustChangePassword: boolean
}

/**
 * La fila propia de app_users. La policy de SELECT la permite por auth.uid()
 * directo, sin pasar por has_role: un usuario con contraseña temporal
 * pendiente (rol efectivo null) igual puede leer su propio flag, que es lo que
 * el layout necesita para mandarlo a /cambiar-contrasena.
 */
export async function getOwnAppUser(userId: string): Promise<OwnAppUserRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('app_users')
    .select('display_name, role, is_active, must_change_password')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    displayName: data.display_name,
    role: data.role as AppRole,
    isActive: data.is_active,
    mustChangePassword: data.must_change_password,
  }
}
