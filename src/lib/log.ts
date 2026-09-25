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

const isProduction = process.env.NODE_ENV === 'production'

function emit(level: Level, context: string, message: string, fields?: LogFields, error?: unknown) {
  const extras: Record<string, unknown> = { ...(fields ?? {}) }

  if (error !== undefined) {
    extras.error =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { value: String(error) }
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
