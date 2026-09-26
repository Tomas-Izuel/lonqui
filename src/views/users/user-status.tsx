import { KeyRound, UserRoundX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StatusPill } from '@/views/shared/status-pill'
import type { AppUserListItem } from '@/models/types'

/**
 * Los 4 estados visibles del padrón de usuarios (spec F3: activo, desactivado,
 * debe cambiar la contraseña, alta incompleta). `StatusPill` (F1) solo trae
 * variantes pensadas para socios/deuda (`member-active` etc.): las reuso para
 * activo/desactivado porque el color (verde/gris) es el mismo concepto, pero
 * "alta incompleta" y "debe cambiar contraseña" no son estados excluyentes de
 * un socio, así que se componen con `Badge` (shadcn) en vez de pedirle a F1
 * dos variantes nuevas para un solo uso. Si en otro slice hace falta lo mismo
 * en otra vista, vale la pena subir esto a `views/shared/status-pill.tsx`.
 */
export function UserStatusBadges({ user }: { user: AppUserListItem }) {
  if (user.authStatus === 'incomplete') {
    return (
      <Badge variant="destructive" className="gap-1">
        <UserRoundX aria-hidden className="size-3" />
        Alta incompleta
      </Badge>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusPill variant={user.isActive ? 'member-active' : 'member-inactive'}>
        {user.isActive ? 'Activo' : 'Desactivado'}
      </StatusPill>
      {user.mustChangePassword ? (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <KeyRound aria-hidden className="size-3" />
          Debe cambiar la contraseña
        </Badge>
      ) : null}
    </div>
  )
}
