'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TextField } from '@/views/shared/form-fields'
import { updateSettings } from '@/controllers/settings.actions'
import type { Settings } from '@/models/types'

const clubSettingsSchema = z.object({
  clubName: z.string().trim().min(2, 'El nombre del club es demasiado corto'),
})
type ClubSettingsValues = z.infer<typeof clubSettingsSchema>

/**
 * Solo `clubName` es editable en este slice (spec F4: "sección Datos del
 * club con club_name"; valores de cuota llegan en el slice 2). El schema del
 * backend (`updateSettingsSchema`) exige `billingStartPeriod` en cada update
 * —no admite un patch parcial—, así que se reenvía tal cual vino de
 * `settings`, sin exponer un control para editarlo: no hay nada de cuotas
 * que mostrar todavía y esto evita inventar un botón sin función.
 */
export function ClubSettingsForm({ settings }: { settings: Settings }) {
  const [pending, setPending] = useState(false)
  const form = useForm<ClubSettingsValues>({
    resolver: zodResolver(clubSettingsSchema),
    defaultValues: { clubName: settings.clubName },
  })

  async function onValid(values: ClubSettingsValues) {
    setPending(true)
    try {
      const result = await updateSettings({ clubName: values.clubName, billingStartPeriod: settings.billingStartPeriod })
      if (!result.ok) {
        if (result.field === 'clubName') {
          form.setError('clubName', { message: result.error })
          form.setFocus('clubName')
        } else {
          toast.error(result.error)
        }
        return
      }
      toast.success('Datos del club actualizados')
      form.reset(values)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onValid)} noValidate className="flex flex-col gap-4 sm:max-w-sm">
      <TextField control={form.control} name="clubName" label="Nombre del club" disabled={pending} />
      <Button type="submit" disabled={pending || !form.formState.isDirty} className="h-11 w-fit">
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {pending ? 'Guardando…' : 'Guardar cambios'}
      </Button>
    </form>
  )
}
