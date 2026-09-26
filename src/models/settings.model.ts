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
 */

export const updateSettingsSchema = z
  .object({
    clubName: z.string().trim().min(2, 'El nombre del club es demasiado corto'),
    // Primer día de mes o null (todavía no se activaron las cuotas). La misma
    // regla está en el CHECK de la migración; validarla acá evita un viaje a
    // Postgres solo para mostrar el mismo mensaje.
    billingStartPeriod: z.iso
      .date()
      .nullable()
      .refine((value) => value === null || value.endsWith('-01'), {
        message: 'Tiene que ser el primer día de un mes',
      }),
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
    .update({ club_name: patch.clubName, billing_start_period: patch.billingStartPeriod })
    .eq('id', 1)
    .select('club_name, billing_start_period')
    .single()

  if (error) throw error

  return { clubName: data.club_name, billingStartPeriod: data.billing_start_period }
}
