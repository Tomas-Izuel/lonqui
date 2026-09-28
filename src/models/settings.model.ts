import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { Settings } from './types'

/**
 * `settings` es un singleton (`id = 1`, insertado por la migración): no hay
 * `create`, solo lectura y `update`. El SELECT lo permite cualquier rol activo
 * (RLS, `00-architecture.md` §6.5); el UPDATE lo restringe la policy a admin,
 * así que el modelo no repite el chequeo — si llega acá sin ser admin, Postgres
 * devuelve `permission denied` y el controller ya filtró con `requireRole`.
 *
 * `billingStartPeriod` NO se toca acá desde el pipeline
 * `2026-09-27-cuotas-pagos-panel` (D18): activar la facturación es una
 * decisión con más invariantes que un `UPDATE` de texto (el trigger
 * `settings_billing_guard` exige un valor de cuota por defecto, que no haya
 * cuotas generadas, etc.) y dispara la primera generación — vive en
 * `billing.model.ts:activateBilling`, detrás de `billing.configure`. Un
 * `unrecognized_keys` acá para quien todavía lo mande es la señal correcta.
 */

export const updateSettingsSchema = z
  .object({
    clubName: z.string().trim().min(2, 'El nombre del club es demasiado corto'),
  })
  .strict()
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>

export async function getSettings(): Promise<Settings> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('settings').select('club_name, billing_start_period').eq('id', 1).single()

  if (error) throw error

  return { clubName: data.club_name, billingStartPeriod: data.billing_start_period }
}

export async function updateSettings(patch: UpdateSettingsInput): Promise<Settings> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('settings')
    .update({ club_name: patch.clubName })
    .eq('id', 1)
    .select('club_name, billing_start_period')
    .single()

  if (error) throw error

  return { clubName: data.club_name, billingStartPeriod: data.billing_start_period }
}
