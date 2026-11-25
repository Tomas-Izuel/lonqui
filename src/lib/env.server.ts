import 'server-only'

import { z } from 'zod'

/**
 * Variables que NUNCA salen del servidor.
 *
 * El `import 'server-only'` es el punto de este archivo: si un Client Component
 * lo importa, **el build falla**. Un límite de módulo no se puede olvidar; un
 * `if (typeof window)` sí. Además el schema no viaja al bundle del browser, así
 * que ni los nombres de las variables secretas quedan expuestos.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.url(),

  /**
   * Origen de la app de socios (sin barra final). Con esto se arman los
   * enlaces de invitación e ingreso: `<origen>/entrar#t=<token>`.
   * Opcional A PROPÓSITO: si faltara en Vercel y fuera obligatoria, serverEnv()
   * tiraría en cada request y se caería el panel entero. Sin ella solo falla
   * emitir enlaces, con un mensaje claro (lo resuelve portal.controller).
   */
  // Vacía cuenta como ausente: `PORTAL_APP_URL=` en Vercel no puede tirar el panel.
  PORTAL_APP_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .url({ protocol: /^https?$/ })
      .transform((url) => url.replace(/\/+$/, ''))
      .optional(),
  ),

  /**
   * Resend. Opcionales: en la Fase 1 la app no manda mails propios (los de
   * Auth salen por el SMTP que se configura en Supabase, no desde acá). Quedan
   * declaradas para cuando un adapter las necesite.
   */
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  RESEND_FROM_NAME: z.string().default('Lonqui'),
})

let cached: z.infer<typeof serverSchema> | null = null

export function serverEnv() {
  if (cached) return cached

  const result = serverSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Variables de entorno inválidas:\n${missing}`)
  }

  cached = result.data
  return cached
}
