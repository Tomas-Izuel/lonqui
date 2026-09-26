import { UserX } from 'lucide-react'
import { ClubMark } from '@/views/shell/club-mark'
import { SignOutButton } from '@/views/shell/sign-out-button'

/**
 * Sesión válida pero sin rol activo en `app_users` (desactivado, o nunca
 * tuvo fila). Pantalla completa, SIN `AppShell`: no hay nada que navegar.
 */
export function NoAccessState() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <ClubMark size="lg" />
      <div className="flex max-w-sm flex-col items-center gap-3">
        <UserX aria-hidden className="size-8 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Tu usuario no tiene acceso</p>
          <p className="text-sm text-muted-foreground">
            Tu cuenta no tiene un rol activo en el sistema. Hablá con un administrador del club para que te lo asigne.
          </p>
        </div>
      </div>
      <SignOutButton />
    </main>
  )
}
