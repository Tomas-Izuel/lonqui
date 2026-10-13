'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { PhoneField, TextField, TextareaField } from '@/views/shared/form-fields'
import { createSponsor, updateSponsor } from '@/controllers/sponsors.actions'
import type { SponsorSummary } from '@/models/types'

// Espejo de `sponsors.model.ts`: mismos límites y mismos textos.
const sponsorSchema = z.object({
  name: z
    .string({ error: 'Ingresá el nombre del sponsor' })
    .trim()
    .min(2, 'El nombre tiene que tener al menos 2 caracteres')
    .max(120, 'El nombre no puede tener más de 120 caracteres'),
  contactName: z.string().trim().max(120, 'El contacto no puede tener más de 120 caracteres'),
  phone: z.string().trim().max(40, 'El teléfono no puede tener más de 40 caracteres'),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || z.email().safeParse(value).success, 'El email no es válido'),
  notes: z.string().trim().max(1000, 'Las notas no pueden tener más de 1000 caracteres'),
})
type SponsorValues = z.infer<typeof sponsorSchema>

const FIELDS = ['name', 'contactName', 'phone', 'email', 'notes'] as const

function valuesOf(sponsor?: SponsorSummary): SponsorValues {
  return {
    name: sponsor?.name ?? '',
    contactName: sponsor?.contactName ?? '',
    phone: sponsor?.phone ?? '',
    email: sponsor?.email ?? '',
    notes: sponsor?.notes ?? '',
  }
}

/**
 * Alta y edición de un sponsor. Solo el nombre es obligatorio. En edición no
 * toca el estado: desactivar/reactivar es otra acción (con motivo, solo
 * `sponsors.deactivate`).
 */
export function SponsorFormSheet({
  open,
  onOpenChange,
  sponsor,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Presente = editar; ausente = crear. */
  sponsor?: SponsorSummary
}) {
  const isEdit = Boolean(sponsor)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<SponsorValues>({ resolver: zodResolver(sponsorSchema), defaultValues: valuesOf(sponsor) })

  useEffect(() => {
    if (open) form.reset(valuesOf(sponsor))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir/cerrar, no en cada tecla
  }, [open, sponsor])

  async function onValid(values: SponsorValues) {
    setPending(true)
    setFormError(null)
    try {
      const result = isEdit ? await updateSponsor(sponsor!.id, values) : await createSponsor(values)
      if (!result.ok) {
        const field = FIELDS.find((f) => f === result.field)
        if (field) {
          form.setError(field, { message: result.error })
          form.setFocus(field)
        } else {
          setFormError(result.error)
        }
        return
      }
      toast.success(isEdit ? 'Sponsor actualizado' : 'Sponsor creado')
      onOpenChange(false)
    } catch {
      setFormError('No pudimos guardar el sponsor. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setFormError(null)
        onOpenChange(next)
      }}
      title={isEdit ? 'Editar sponsor' : 'Nuevo sponsor'}
      description={isEdit ? 'El cambio queda registrado en la auditoría.' : 'Solo el nombre es obligatorio.'}
      footer={
        <>
          <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="sponsor-form" className="h-11" disabled={pending}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <form id="sponsor-form" onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
        <TextField control={form.control} name="name" label="Nombre" autoComplete="off" disabled={pending} />
        <TextField control={form.control} name="contactName" label="Persona de contacto (opcional)" autoComplete="off" disabled={pending} />
        <PhoneField control={form.control} name="phone" label="Teléfono (opcional)" disabled={pending} />
        <TextField
          control={form.control}
          name="email"
          label="Email (opcional)"
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
        />
        <TextareaField control={form.control} name="notes" label="Notas (opcional)" disabled={pending} />
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}
      </form>
    </ResponsiveSheet>
  )
}
