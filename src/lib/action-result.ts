import { toApiError } from '@/lib/errors'

/**
 * Lo que devuelve toda Server Action. Sin `server-only`: el tipo lo importan
 * los Client Components para leer el resultado.
 *
 * `field` viene de `DomainError.field` o del primer issue de Zod, para pintar
 * el error debajo del campo que corresponde.
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; field?: string }

export function success<T>(data: T): ActionResult<T>
export function success(): ActionResult<void>
export function success<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data }
}

/**
 * Cualquier excepción → resultado seguro. Una `DomainError` pasa su mensaje;
 * cualquier otra cosa se loguea en el servidor y el usuario ve un genérico.
 *
 * Ojo: `redirect()` y `notFound()` de Next funcionan tirando una excepción.
 * Llamalos FUERA del try/catch que termina acá, o re-lanzalos con
 * `unstable_rethrow` antes de llamar a `failure`.
 */
export function failure(err: unknown, context: string): ActionResult<never> {
  const { body } = toApiError(err, context)
  return { ok: false, error: body.error, ...(body.field ? { field: body.field } : {}) }
}

/** Error de validación (ya traducido con `zodToApiError`) como resultado. */
export function invalid(error: string, field?: string): ActionResult<never> {
  return { ok: false, error, ...(field ? { field } : {}) }
}
