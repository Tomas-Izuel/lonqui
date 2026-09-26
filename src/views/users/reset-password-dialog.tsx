'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { resetUserPassword } from '@/controllers/users.actions'
import type { AppUserListItem } from '@/models/types'

/**
 * "Restablecer contraseña" con confirmación que nombra la consecuencia
 * (texto pedido explícitamente por el coordinador). Nunca sobre uno mismo:
 * `UserRowMenu` deshabilita la fila propia, y `resetUserPassword` la rechaza
 * igual (regla de UX en la action, no un trigger — ver dev log de B1).
 */
export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
  onReset,
}: {
  user: AppUserListItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onReset: (password: string, displayName: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setError(null)
  }

  async function handleConfirm() {
    if (!user) return
    setPending(true)
    setError(null)
    try {
      const result = await resetUserPassword({ userId: user.userId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onReset(result.data.temporaryPassword, user.displayName)
      handleOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open && user !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restablecer la contraseña{user ? ` de ${user.displayName}` : ''}</DialogTitle>
          <DialogDescription>La contraseña actual deja de servir y va a tener que cambiarla al entrar.</DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={pending}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Restableciendo…' : 'Restablecer contraseña'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
