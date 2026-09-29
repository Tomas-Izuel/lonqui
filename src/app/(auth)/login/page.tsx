import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/controllers/session.controller'
import { LoginForm } from '@/views/auth/login-form'
import { isInternalRedirectPath } from '@/lib/safe-redirect'

export const metadata: Metadata = { title: 'Ingresar — Lonqui' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  // Única fuente de validación de `next` (03-review.md, blocker 1): el viejo
  // `startsWith('/') && !startsWith('//')` dejaba pasar `/\evil.com`.
  const safeNext = isInternalRedirectPath(next) ? next : undefined

  // Ya logueado: no tiene sentido mostrar el login de nuevo.
  const session = await getSession()
  if (session) {
    if (session.mustChangePassword) redirect('/cambiar-contrasena')
    redirect(safeNext ?? '/')
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold text-balance">Ingresá a la gestión del club</h1>
      <LoginForm next={safeNext} />
    </div>
  )
}
