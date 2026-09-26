import { cn } from '@/lib/utils'
import type { AppRole, MemberStatus } from '@/models/types'
import { appRoleLabels, memberStatusLabels } from '@/views/shared/labels'

/**
 * Variantes de `StatusPill`. `up-to-date` / `in-debt` llegan del todo en el
 * slice 2 (cuotas): el tipo ya las prepara para no romper el contrato cuando
 * F2/F3 las usen.
 */
export type StatusPillVariant = 'member-active' | 'member-inactive' | 'up-to-date' | 'in-debt'

const STYLES: Record<StatusPillVariant, string> = {
  'member-active': 'bg-status-up-to-date/10 text-status-up-to-date',
  'member-inactive': 'bg-status-inactive/10 text-status-inactive',
  'up-to-date': 'bg-status-up-to-date/10 text-status-up-to-date',
  'in-debt': 'bg-status-in-debt/10 text-status-in-debt',
}

/**
 * Estado con texto y color, nunca solo color (piso de calidad). El punto es
 * decorativo; el texto es lo que hace la afirmación.
 */
export function StatusPill({
  variant,
  children,
  className,
}: {
  variant: StatusPillVariant
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-fit items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        STYLES[variant],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  )
}

/** Atajo para `StatusPill` a partir del estado crudo del socio. */
export function MemberStatusPill({ status, className }: { status: MemberStatus; className?: string }) {
  return (
    <StatusPill variant={status === 'active' ? 'member-active' : 'member-inactive'} className={className}>
      {memberStatusLabels[status]}
    </StatusPill>
  )
}

const ROLE_STYLES: Record<AppRole, string> = {
  admin: 'bg-primary/10 text-primary',
  editor: 'bg-accent-foreground/8 text-foreground',
  consulta: 'bg-muted text-muted-foreground',
}

/** Rol interno, siempre con la etiqueta en español. */
export function RolePill({ role, className }: { role: AppRole; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-fit items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        ROLE_STYLES[role],
        className,
      )}
    >
      {appRoleLabels[role]}
    </span>
  )
}
