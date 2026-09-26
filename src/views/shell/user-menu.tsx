'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown, KeyRound, LogOut } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RolePill } from '@/views/shared/status-pill'
import { signOut } from '@/controllers/auth.actions'
import type { AppRole } from '@/models/types'

/**
 * Nombre, rol, "Cambiar contraseña" (voluntario, vuelve a donde estaba) y
 * "Cerrar sesión" con confirmación breve (route.md). El diálogo de
 * confirmación vive FUERA del `DropdownMenuContent`: si quedara adentro, el
 * menú se desmonta al cerrarse y se lleva el diálogo con él antes de que se
 * pueda ver.
 */
export function UserMenu({ displayName, role }: { displayName: string; role: AppRole }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const currentPath = searchParams.size > 0 ? `${pathname}?${searchParams.toString()}` : pathname
  const initial = displayName.trim().charAt(0).toUpperCase() || '?'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Menú de usuario"
          className="flex h-11 items-center gap-2 rounded-lg px-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted"
        >
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {initial}
          </span>
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span className="max-w-32 truncate text-sm font-medium">{displayName}</span>
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-1.5 py-2">
            <span className="text-sm font-medium text-foreground">{displayName}</span>
            <RolePill role={role} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/cambiar-contrasena?next=${encodeURIComponent(currentPath)}`}>
              <KeyRound aria-hidden />
              Cambiar contraseña
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setConfirmOpen(true)
            }}
          >
            <LogOut aria-hidden />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar sesión?</AlertDialogTitle>
            <AlertDialogDescription>Vas a tener que volver a ingresar con tu email y tu contraseña.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={() => startTransition(() => signOut())}>
              {pending ? 'Saliendo…' : 'Cerrar sesión'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
