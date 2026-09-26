'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { appRoleLabels, appRoleDescriptions } from '@/views/shared/labels'
import { changeUserRole } from '@/controllers/users.actions'
import type { AppRole, AppUserListItem } from '@/models/types'

const ROLES: readonly AppRole[] = ['admin', 'editor', 'consulta']

/**
 * Cambiar rol pide confirmación que nombra la consecuencia (brief
 * route-usuarios.md): se explica qué va a poder hacer la persona con el rol
 * elegido antes de confirmar, no después. El propio usuario nunca llega acá
 * (`UserRowMenu` deshabilita la fila); el backend lo rechaza igual
 * (`app_users_guard`, traducido a `DomainError` por `updateAppUser`).
 */
export function ChangeRoleDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AppUserListItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [role, setRole] = useState<AppRole>(user?.role ?? 'consulta')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reinicia el rol elegido cuando cambia la fila objetivo: ajuste durante el
  // render, mismo patrón que `SearchInput` (evita el `useEffect` de
  // sincronización y el warning de "cascading renders").
  const [trackedUserId, setTrackedUserId] = useState(user?.userId)
  if (user && user.userId !== trackedUserId) {
    setTrackedUserId(user.userId)
    setRole(user.role)
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setError(null)
  }

  async function handleConfirm() {
    if (!user) return
    setPending(true)
    setError(null)
    try {
      const result = await changeUserRole({ userId: user.userId, role })
      if (!result.ok) {
        setError(result.error)
        return
      }
      handleOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open && user !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar el rol{user ? ` de ${user.displayName}` : ''}</DialogTitle>
          <DialogDescription>
            Va a tener los permisos de {appRoleLabels[role]}: {appRoleDescriptions[role].toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        <Select value={role} onValueChange={(value) => setRole(value as AppRole)} disabled={pending}>
          <SelectTrigger className="w-full" aria-label="Rol">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {appRoleLabels[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={pending || role === user?.role}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : 'Cambiar rol'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
