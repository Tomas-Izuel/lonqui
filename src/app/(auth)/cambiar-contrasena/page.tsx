import type { Metadata } from 'next'
import { requireSession } from '@/controllers/session.controller'
import { ChangePasswordForm } from '@/views/auth/change-password-form'
import { isInternalRedirectPath } from '@/lib/safe-redirect'

export const metadata: Metadata = { title: 'Cambiar contraseña — Lonqui' }

export default async function CambiarContrasenaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Sin sesión, `requireSession()` ya manda a `/login` (sin `next`: esta
  // página no es un destino que valga la pena recordar).
  const session = await requireSession()
  const mustChangePassword = session.mustChangePassword
  const mode = mustChangePassword ? 'mandatory' : 'voluntary'

  // En modo obligatorio no hay "volver a donde estaba": nadie puede salir de
  // acá hasta cambiar la contraseña, así que `next` ni se lee (refuerzo del
  // 2026-09-25). Solo el modo voluntario, que sí vuelve a la ruta pedida.
  let next: string | undefined
  if (mode === 'voluntary') {
    const params = await searchParams
    next = isInternalRedirectPath(params.next) ? params.next : undefined
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold text-balance">Cambiar contraseña</h1>
      <ChangePasswordForm mode={mode} next={next} />
    </div>
  )
}
