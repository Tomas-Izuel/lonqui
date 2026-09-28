'use client'

import { EllipsisVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { AppUserListItem } from '@/models/types'

const SELF_REASON = 'No podés hacerlo sobre tu propio usuario'

/**
 * Acciones por fila. Una alta incompleta solo ofrece "Completar alta" (los
 * demás campos son placeholders sin significado, spec B1); el resto ofrece
 * cambiar rol, restablecer contraseña y activar/desactivar, deshabilitadas
 * sobre la fila propia (el backend las rechaza igual: esto es UX, no la
 * defensa real).
 */
export function UserRowMenu({
  user,
  isSelf,
  onCompleteAlta,
  onChangeRole,
  onToggleActive,
  onResetPassword,
}: {
  user: AppUserListItem
  isSelf: boolean
  onCompleteAlta: () => void
  onChangeRole: () => void
  onToggleActive: () => void
  onResetPassword: () => void
}) {
  if (user.authStatus === 'incomplete') {
    // Sin override de alto: hereda el h-11 (44px) flat de `size="sm"` — antes
    // forzaba h-9 (36px), bajo el piso táctil.
    return (
      <Button type="button" variant="outline" size="sm" onClick={onCompleteAlta}>
        Completar alta
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Sin override de tamaño: hereda el size-11 (44px) flat de
            `size="icon"` — antes achicaba a size-8 (32px) desde `sm:`. */}
        <Button type="button" variant="ghost" size="icon" aria-label={`Acciones para ${user.displayName}`}>
          <EllipsisVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isSelf} title={isSelf ? SELF_REASON : undefined} onSelect={onChangeRole}>
          Cambiar rol
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isSelf} title={isSelf ? SELF_REASON : undefined} onSelect={onResetPassword}>
          Restablecer contraseña
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isSelf}
          title={isSelf ? SELF_REASON : undefined}
          variant={user.isActive ? 'destructive' : 'default'}
          onSelect={onToggleActive}
        >
          {user.isActive ? 'Desactivar' : 'Reactivar'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
