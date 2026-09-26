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
import { createUser } from '@/controllers/users.actions'
import type { AppRole } from '@/models/types'

// Esquema local: `app-users.model.ts` (donde vive `createAppUserSchema`) tiene
// `import 'server-only'` y no se puede importar desde un Client Component.
// Mismo patrón que `LoginForm` (F1): valida formato acá, la autoridad real
// sigue siendo el `.safeParse()` de la action.
const createUserSchema = z.object({
  email: z.email('Ingresá un email válido'),
  displayName: z.string().trim().min(2, 'El nombre tiene que tener al menos 2 caracteres'),
  role: z.enum(['admin', 'editor', 'consulta'], 'Elegí un rol'),
})

type CreateUserValues = z.infer<typeof createUserSchema>

const ROLE_OPTIONS: { value: AppRole; label: string }[] = (['admin', 'editor', 'consulta'] as const).map((role) => ({
  value: role,
  label: `${appRoleLabels[role]} — ${appRoleDescriptions[role]}`,
}))

export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (password: string, displayName: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', displayName: '', role: 'consulta' },
  })

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) {
      form.reset()
      setFormError(null)
    }
  }

  async function onValid(values: CreateUserValues) {
    setPending(true)
    setFormError(null)
    try {
      const result = await createUser(values)
      if (!result.ok) {
        if (result.field === 'email' || result.field === 'displayName' || result.field === 'role') {
          form.setError(result.field, { message: result.error })
          form.setFocus(result.field)
        } else {
          setFormError(result.error)
        }
        return
      }
      onCreated(result.data.temporaryPassword, values.displayName)
      handleOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo usuario</DialogTitle>
          <DialogDescription>
            El sistema genera una contraseña temporal; pasásela a la persona, le va a pedir cambiarla al entrar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onValid)} noValidate className="flex flex-col gap-4">
          <TextField
            control={form.control}
            name="email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            autoFocus
          />
          <TextField control={form.control} name="displayName" label="Nombre y apellido" autoComplete="off" disabled={pending} />
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
              {pending ? 'Creando…' : 'Crear usuario'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
