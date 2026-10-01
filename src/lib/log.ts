import 'server-only'

/**
 * Log estructurado del servidor. En producción, una línea de JSON por evento
 * (lo que saben parsear los drains de Vercel); en desarrollo, legible.
 *
 * **Nunca datos personales**: ni DNI, ni nombre completo, ni domicilio, ni
 * teléfono, ni email. El sistema guarda datos de menores (Ley 25.326) y un log
 * es un lugar donde los datos viven para siempre y con más lectores de los que
 * uno cree. Se loguean ids.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = {
  memberId?: number | null
  userId?: string | null
  /** Para correlacionar todo lo que pasó en un mismo request. */
  requestId?: string | null
  [key: string]: unknown
}

/**
 * supabase-js devuelve `PostgrestError` como objeto plano (no `Error`), y
 * `String(obj)` da "[object Object]". Se loguea siempre `code` y `hint`.
 *
 * `details` queda afuera a propósito: en una violación de unique trae el valor
 * ("Key (dni)=(12345678) already exists"), o sea datos personales.
 *
 * `message` se loguea solo si el `code` es de integridad (`23xxx`: trae el
 * nombre de la constraint, no valores), de privilegios/sintaxis (`42xxx`) o de
 * PostgREST (`PGRST`). En otros códigos, sobre todo la clase 22 (datos mal
 * formados), el propio mensaje incluye el valor ofensor ("invalid input syntax
 * for type date: <lo que tipeó el usuario>"), así que se descarta.
 */
const SAFE_MESSAGE_CODE = /^(23|42|PGRST)/

function serializeNonError(error: unknown): Record<string, unknown> {
  if (typeof error === 'object' && error !== null) {
    const { code, message, hint } = error as Record<string, unknown>
    if (typeof code === 'string' || typeof message === 'string') {
      const messageIsSafe = typeof code === 'string' && SAFE_MESSAGE_CODE.test(code)
      return {
        ...(typeof code === 'string' && { code }),
        ...(messageIsSafe && typeof message === 'string' && { message }),
        ...(typeof hint === 'string' && hint !== '' && { hint }),
      }
    }
  }
  return { value: String(error) }
}

const isProduction = process.env.NODE_ENV === 'production'

function emit(level: Level, context: string, message: string, fields?: LogFields, error?: unknown) {
  const extras: Record<string, unknown> = { ...(fields ?? {}) }

  if (error !== undefined) {
    extras.error =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : serializeNonError(error)
  }

  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log

  if (isProduction) {
    sink(JSON.stringify({ level, context, message, ...extras }))
    return
  }

  const hasExtras = Object.keys(extras).length > 0
  sink(`[${context}] ${message}`, ...(hasExtras ? [extras] : []))
}

export const log = {
  debug: (context: string, message: string, fields?: LogFields) => emit('debug', context, message, fields),
  info: (context: string, message: string, fields?: LogFields) => emit('info', context, message, fields),
  warn: (context: string, message: string, fields?: LogFields) => emit('warn', context, message, fields),
  /** El error va aparte para que siempre salga con su stack. */
  error: (context: string, message: string, error?: unknown, fields?: LogFields) =>
    emit('error', context, message, fields, error),
}
