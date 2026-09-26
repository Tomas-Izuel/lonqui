'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TextField, SelectField } from '@/views/shared/form-fields'
import { appRoleLabels, appRoleDescriptions } from '@/views/shared/labels'
import { completeUser } from '@/controllers/users.actions'
import type { AppRole, AppUserListItem } from '@/models/types'

const completeUserSchema = z.object({
  displayName: z.string().trim().min(2, 'El nombre tiene que tener al menos 2 caracteres'),
  role: z.enum(['admin', 'editor', 'consulta'], 'Elegí un rol'),
})

type CompleteUserValues = z.infer<typeof completeUserSchema>

const ROLE_OPTIONS: { value: AppRole; label: string }[] = (['admin', 'editor', 'consulta'] as const).map((role) => ({
  value: role,
  label: `${appRoleLabels[role]} — ${appRoleDescriptions[role]}`,
}))

/**
 * Termina una alta que quedó a mitad de camino (existe en Auth, no en
 * `app_users` — D8). El email no se vuelve a tipear: sale de la fila
 * `incomplete` que ya trajo `listUsers`. La temporal del intento anterior es
 * irrecuperable (nunca se persiste en ningún lado); esta acción genera una
 * nueva.
 */
export function CompleteUserDialog({
  user,
  open,
  onOpenChange,
  onCompleted,
}: {
  user: AppUserListItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCompleted: (password: string, displayName: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<CompleteUserValues>({
    resolver: zodResolver(completeUserSchema),
    defaultValues: { displayName: '', role: 'consulta' },
  })

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      form.reset()
      setFormError(null)
    }
  }

  async function onValid(values: CompleteUserValues) {
    if (!user) return
    setPending(true)
    setFormError(null)
    try {
      const result = await completeUser({ userId: user.userId, email: user.email, ...values })
      if (!result.ok) {
        if (result.field === 'displayName' || result.field === 'role') {
          form.setError(result.field, { message: result.error })
          form.setFocus(result.field)
        } else {
          setFormError(result.error)
        }
        return
      }
      onCompleted(result.data.temporaryPassword, values.displayName)
      handleOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open && user !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Completar alta{user ? ` de ${user.email}` : ''}</DialogTitle>
          <DialogDescription>
            El alta anterior quedó a mitad de camino. Se genera una contraseña temporal nueva.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onValid)} noValidate className="flex flex-col gap-4">
          <TextField control={form.control} name="displayName" label="Nombre y apellido" autoComplete="off" disabled={pending} autoFocus />
          <SelectField control={form.control} name="role" label="Rol" options={ROLE_OPTIONS} disabled={pending} placeholder="Elegí un rol" />

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {pending ? 'Completando…' : 'Completar alta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
