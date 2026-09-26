'use client'

import { useTransition } from 'react'
import { Loader2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { signOut } from '@/controllers/auth.actions'

/**
 * Botón de "Cerrar sesión" de tamaño completo, para pantallas sin `AppShell`
 * (la vista de "sin acceso"). Dentro del menú de usuario va como
 * `DropdownMenuItem`, no como este botón — ver `UserMenu`.
 */
export function SignOutButton({
  variant = 'outline',
  className,
  children = 'Cerrar sesión',
}: {
  variant?: React.ComponentProps<typeof Button>['variant']
  className?: string
  children?: React.ReactNode
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Button type="button" variant={variant} disabled={pending} className={className} onClick={() => startTransition(() => signOut())}>
      {pending ? <Loader2 aria-hidden className="animate-spin" /> : <LogOut aria-hidden />}
      {children}
    </Button>
  )
}
