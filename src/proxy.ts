import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * En Next.js 16 el middleware se llama Proxy. Su único trabajo acá es refrescar
 * la sesión de Supabase para que las cookies no venzan mientras se navega.
 *
 * NO autoriza nada. La autorización real vive en las RLS de Postgres y se
 * verifica de nuevo en cada page y Server Action. Un proxy es un chequeo
 * optimista: nunca la única defensa.
 *
 * No importa `env.server.ts` a propósito: trae `server-only`, y no está
 * garantizado que el target de build de Proxy herede la condición
 * `react-server`. Si no la hereda, tira en cold start y se cae el sitio entero.
 */
function requiredEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Proxy: falta la variable de entorno ${name}. Sin ella no se puede refrescar la sesión.`)
  }
  return value
}

export async function proxy(request: NextRequest) {
  // `(panel)/layout.tsx` necesita el pathname pedido para armar
  // `/login?next=<ruta>` (D10), y un Server Component no tiene forma nativa
  // de leerlo (Next: "Layouts do not access pathname"). Es metadata, no una
  // decisión de autorización: viaja como header, la decisión sigue en
  // session.controller.ts.
  request.headers.set('x-pathname', request.nextUrl.pathname + request.nextUrl.search)

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // getClaims() valida la firma del JWT localmente, sin el round trip de
  // getUser(). Es lo recomendado para el proxy.
  await supabase.auth.getClaims()

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)'],
}
