/**
 * Dos clases de error, y la diferencia importa en el borde.
 *
 * `DomainError` es una condición de negocio que el usuario tiene que ver: "ya
 * hay un socio con ese DNI", "ese pago ya está anulado". Su mensaje es parte de
 * la interfaz.
 *
 * Cualquier otro error es un fallo nuestro —Postgres, red, un bug— y su
 * mensaje NO se muestra: se loguea en el servidor y el usuario recibe algo
 * genérico. Un `catch` que devuelve `err.message` sin distinguir termina
 * mostrando el detalle de una constraint de Postgres.
 */

import { log } from '@/lib/log'

export class DomainError extends Error {
  readonly status: number
  /** Campo del formulario al que corresponde, si aplica. */
  readonly field?: string

  constructor(message: string, options?: { status?: number; field?: string }) {
    super(message)
    this.name = 'DomainError'
    this.status = options?.status ?? 400
    this.field = options?.field
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError
}

export type ApiErrorBody = {
  error: string
  field?: string
}

export type ApiErrorResult = {
  body: ApiErrorBody
  status: number
}

const GENERIC = 'No pudimos completar la operación. Probá de nuevo en un momento.'

/**
 * Traduce cualquier excepción a una respuesta segura. `context` va al log del
 * servidor para rastrear el fallo real sin que el usuario vea nada de eso.
 */
export function toApiError(err: unknown, context: string): ApiErrorResult {
  if (isDomainError(err)) {
    return { body: { error: err.message, ...(err.field ? { field: err.field } : {}) }, status: err.status }
  }

  log.error(context, 'error interno', err)
  return { body: { error: GENERIC }, status: 500 }
}

type ZodLikeIssue = {
  code: string
  message: string
  path: readonly PropertyKey[]
  /** Solo lo trae el issue `unrecognized_keys`. Va al LOG, nunca a la respuesta. */
  keys?: readonly string[]
}
type ZodLike = { issues: readonly ZodLikeIssue[] }

/**
 * Mensaje de validación seguro a partir de un ZodError.
 *
 * Devuelve el primer mensaje y el campo, **nunca** el array de issues: eso
 * expone rutas internas y, con `.strict()`, el nombre de la clave rechazada.
 * Una clave desconocida ni se nombra: un formulario legítimo no la produce, así
 * que el detalle solo le sirve a quien está sondeando.
 */
export function zodToApiError(input: ZodLike | readonly ZodLikeIssue[]): ApiErrorResult {
  // Discriminar por la propiedad y no con `Array.isArray`: sobre una union con
  // `readonly T[]` este último narrowea a `any[]` y contagia `any`.
  const issues: readonly ZodLikeIssue[] = 'issues' in input ? input.issues : input
  const first = issues[0]
  if (!first) return { body: { error: 'Revisá los datos ingresados' }, status: 400 }

  if (first.code === 'unrecognized_keys') {
    log.error('validation', 'payload con claves desconocidas', undefined, {
      code: first.code,
      keys: first.keys ?? [],
    })
    return { body: { error: 'Los datos llegaron con un formato inválido' }, status: 400 }
  }

  const field = first.path.filter((p): p is string => typeof p === 'string').at(-1)
  return {
    body: { error: first.message, ...(typeof field === 'string' ? { field } : {}) },
    status: 400,
  }
}
