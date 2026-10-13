'use client'

import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/views/shell/panel-session'
import { useOverlayParam, incomeOverlayValue } from '@/views/shared/overlay-params'

/**
 * Abre el overlay `?ingreso=` sin navegar. Se oculta solo si la sesión no
 * tiene `income.register` (UX: la defensa real es la Server Action y la RLS).
 * Con `sponsorId` abre con ese sponsor ya elegido.
 */
export function RegisterIncomeButton({
  label = 'Registrar otro ingreso',
  sponsorId,
  variant = 'default',
  disabled,
  className,
}: {
  label?: string
  sponsorId?: number
  variant?: 'default' | 'outline'
  disabled?: boolean
  className?: string
}) {
  const canRegister = useHasPermission('income.register')
  const { set } = useOverlayParam('ingreso')
  if (!canRegister) return null

  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled}
      className={className ?? 'h-11'}
      onClick={() => set(incomeOverlayValue({ mode: 'nuevo', sponsorId }))}
    >
      <Plus aria-hidden />
      {label}
    </Button>
  )
}
