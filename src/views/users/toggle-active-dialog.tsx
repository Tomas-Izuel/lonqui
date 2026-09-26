'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { setUserActive } from '@/controllers/users.actions'
import type { AppUserListItem } from '@/models/types'

/**
 * Activar/desactivar con confirmación que nombra la consecuencia (brief
 * route-usuarios.md, texto literal para la baja: "Deja de poder entrar. Sus
 * registros y auditoría quedan"). Nunca "eliminar" — la persona sigue en el
 * padrón de usuarios y en la auditoría, solo pierde el acceso.
 */
export function ToggleActiveDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AppUserListItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextActive = user ? !user.isActive : false

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) setError(null)
  }

  async function handleConfirm() {
    if (!user) return
    setPending(true)
    setError(null)
    try {
      const result = await setUserActive({ userId: user.userId, isActive: nextActive })
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
          <DialogTitle>
            {nextActive ? 'Reactivar' : 'Desactivar'}
            {user ? ` a ${user.displayName}` : ''}
          </DialogTitle>
          <DialogDescription>
            {nextActive
              ? 'Va a poder entrar de nuevo con su contraseña actual.'
              : 'Deja de poder entrar. Sus registros y auditoría quedan.'}
          </DialogDescription>
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
          <Button type="button" variant={nextActive ? 'default' : 'destructive'} onClick={handleConfirm} disabled={pending}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? 'Guardando…' : nextActive ? 'Reactivar' : 'Desactivar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
