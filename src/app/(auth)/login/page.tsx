import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getSession } from '@/controllers/session.controller'
import { LoginForm } from '@/views/auth/login-form'

export const metadata: Metadata = { title: 'Ingresar — Club Naranja y Blanco' }

/** `next` nunca es una URL absoluta: solo rutas relativas internas (D8, B1). */
function sanitizeNext(next: string | undefined): string | undefined {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return undefined
  return next
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const safeNext = sanitizeNext(next)

  // Ya logueado: no tiene sentido mostrar el login de nuevo.
  const session = await getSession()
  if (session) {
    if (session.mustChangePassword) redirect('/cambiar-contrasena')
    redirect(safeNext ?? '/')
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-xl font-semibold">Ingresar</h1>
      <LoginForm next={safeNext} />
    </div>
  )
}
