import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { AuditEntry, AuditEntryDetail, AuditFilters, AuditOp, AuditActorSource, Page } from './types'

/**
 * Lectura del registro de auditoría (`audit_log`, S1: append-only, sin grants
 * de escritura para nadie — este modelo nunca inserta).
 *
 * El rol se verifica en `audit.controller.ts`, **antes** de llamar acá: la
 * policy de SELECT ya restringe a `admin`, pero un modelo que confía solo en
 * RLS le devolvería una página vacía a un `editor` que llegó por error, y eso
 * se lee como "no hay auditoría" en vez de "no tenés acceso". Este archivo no
 * repite el chequeo.
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

// -----------------------------------------------------------------------------
// Zona horaria del club para los filtros de fecha
// -----------------------------------------------------------------------------

// Argentina no tiene horario de verano desde 2009: el offset respecto de UTC
// es fijo (-03:00), así que convertir un `date` de filtro a un instante UTC no
// necesita el motor de zonas horarias de Intl. `CLUB_TIME_ZONE` (lib/dates.ts)
// documenta la misma zona para el resto del sistema.
const CLUB_UTC_OFFSET = '-03:00'

/** Medianoche de ese día en la zona del club, como instante UTC. */
function clubDayStartUtc(date: string): string {
  return new Date(`${date}T00:00:00${CLUB_UTC_OFFSET}`).toISOString()
}

/** Medianoche del día SIGUIENTE en la zona del club: el límite exclusivo que hace que `to` incluya el día entero. */
function clubDayEndExclusiveUtc(date: string): string {
  const start = new Date(`${date}T00:00:00${CLUB_UTC_OFFSET}`)
  start.setUTCDate(start.getUTCDate() + 1)
  return start.toISOString()
}

// -----------------------------------------------------------------------------
// Cursor keyset: (occurred_at desc, id desc)
// -----------------------------------------------------------------------------

function encodeCursor(occurredAt: string, id: number): string {
  return Buffer.from(`${occurredAt}|${id}`, 'utf8').toString('base64url')
}

/** `null` si el cursor no tiene la forma esperada: se ignora en vez de romper la página (pudo quedar viejo tras un deploy). */
function decodeCursor(cursor: string): { occurredAt: string; id: number } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const separatorIndex = raw.lastIndexOf('|')
    if (separatorIndex === -1) return null

    const occurredAt = raw.slice(0, separatorIndex)
    const id = Number(raw.slice(separatorIndex + 1))
    if (!occurredAt || !Number.isInteger(id)) return null

    return { occurredAt, id }
  } catch {
    return null
  }
}

// -----------------------------------------------------------------------------
// Resolución de actorName
// -----------------------------------------------------------------------------

/**
 * Nombre de cada actor, resuelto con una query propia a `app_users` — no se
 * depende de `app-users.model.ts` (lo posee B1) para no acoplar dos slices en
 * paralelo. El admin que llega hasta acá puede leer cualquier fila de
 * `app_users` (RLS: `auth.uid() = user_id OR is_admin()`), así que la consulta
 * trae todos los ids de la página en una sola vuelta.
 */
async function resolveActorNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(actorIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('app_users').select('user_id, display_name').in('user_id', ids)
  if (error) throw error

  return new Map((data ?? []).map((row) => [row.user_id, row.display_name]))
}

// -----------------------------------------------------------------------------
// Fila cruda
// -----------------------------------------------------------------------------

type AuditRow = {
  id: number
  occurred_at: string
  actor_id: string | null
  actor_source: string
  op: string
  table_name: string
  record_id: string | null
  changed_fields: string[] | null
}

function toEntry(row: AuditRow, actorName: string | null): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    actorName,
    actorSource: row.actor_source as AuditActorSource,
    op: row.op as AuditOp,
    tableName: row.table_name,
    recordId: row.record_id,
    changedFields: row.changed_fields,
  }
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

/**
 * Página del registro de auditoría, keyset por `(occurred_at desc, id desc)`
 * (mismo orden que el índice `audit_log_keyset_idx` de S1). No trae
 * `old_data`/`new_data`: eso viaja solo en `getAuditEntry`, para no mover jsonb
 * de más en un listado.
 */
export async function getAuditPage(filters: AuditFilters): Promise<Page<AuditEntry>> {
  const supabase = await createClient()
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  let query = supabase
    .from('audit_log')
    .select('id, occurred_at, actor_id, actor_source, op, table_name, record_id, changed_fields')

  if (filters.tableName) query = query.eq('table_name', filters.tableName)
  if (filters.actorId) query = query.eq('actor_id', filters.actorId)
  if (filters.recordId) query = query.eq('record_id', filters.recordId)
  if (filters.from) query = query.gte('occurred_at', clubDayStartUtc(filters.from))
  if (filters.to) query = query.lt('occurred_at', clubDayEndExclusiveUtc(filters.to))

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null
  if (cursor) {
    // occurred_at estrictamente anterior, o igual con id estrictamente menor:
    // el mismo criterio que ORDER BY (occurred_at desc, id desc).
    query = query.or(
      `occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.lt.${cursor.id})`,
    )
  }

  // Pide uno de más para saber si hay próxima página sin un segundo round trip.
  const { data, error } = await query
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (error) throw error

  const rows = (data ?? []) as AuditRow[]
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  const actorNames = await resolveActorNames(
    supabase,
    pageRows.map((row) => row.actor_id),
  )

  const items = pageRows.map((row) => toEntry(row, row.actor_id ? (actorNames.get(row.actor_id) ?? null) : null))
  const last = pageRows.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.occurred_at, last.id) : null

  return { items, nextCursor }
}

/** Detalle de una fila, con `old_data`/`new_data`/`context` completos. */
export async function getAuditEntry(id: number): Promise<AuditEntryDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, occurred_at, actor_id, actor_source, op, table_name, record_id, changed_fields, old_data, new_data, context')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const actorNames = await resolveActorNames(supabase, [data.actor_id])
  const entry = toEntry(data as AuditRow, data.actor_id ? (actorNames.get(data.actor_id) ?? null) : null)

  return {
    ...entry,
    oldData: data.old_data as Record<string, unknown> | null,
    newData: data.new_data as Record<string, unknown> | null,
    context: data.context as Record<string, unknown> | null,
  }
}
