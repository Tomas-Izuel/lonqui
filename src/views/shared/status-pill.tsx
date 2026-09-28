import { cn } from '@/lib/utils'
import type { AppRole, DebtStatus, MemberStatus } from '@/models/types'
import { appRoleLabels, debtStatusLabels, memberStatusLabels } from '@/views/shared/labels'

/**
 * Variantes de `StatusPill`. `credit` (saldo a favor) usa el verde de "al día"
 * con contorno en vez de fondo: no es deuda, pero tampoco es lo mismo que estar
 * justo al día, y nunca se muestra como un número negativo.
 */
export type StatusPillVariant = 'member-active' | 'member-inactive' | 'up-to-date' | 'in-debt' | 'credit'

const STYLES: Record<StatusPillVariant, string> = {
  'member-active': 'bg-status-up-to-date/10 text-status-up-to-date',
  'member-inactive': 'bg-status-inactive/10 text-status-inactive',
  'up-to-date': 'bg-status-up-to-date/10 text-status-up-to-date',
  'in-debt': 'bg-status-in-debt/10 text-status-in-debt',
  credit: 'border border-status-up-to-date/40 text-status-up-to-date',
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
        // `transition-colors`: un pago que se registra y cambia "Con deuda" →
        // "Al día" en el mismo `router.refresh()` se ve cambiar de color, no
        // saltar de golpe — el mismo criterio de "state" de C1, sin traer la
        // dependencia de `motion` para algo que una transición CSS resuelve.
        'inline-flex h-6 w-fit items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150',
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

const DEBT_VARIANTS: Record<DebtStatus, StatusPillVariant> = {
  up_to_date: 'up-to-date',
  in_debt: 'in-debt',
  credit: 'credit',
}

/** Estado de cuenta del socio: "Al día", "Con deuda" o "Saldo a favor". */
export function DebtStatusPill({ status, className }: { status: DebtStatus; className?: string }) {
  return (
    <StatusPill variant={DEBT_VARIANTS[status]} className={className}>
      {debtStatusLabels[status]}
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
