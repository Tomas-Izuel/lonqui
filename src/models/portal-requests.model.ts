import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  chunk,
  getDefaultPhoneAreaCode,
  resolveActorNames,
  translatePortalRpcError,
} from '@/models/portal-accounts.model'
import { normalizePhoneToE164 } from '@/lib/phone'
import { deriveTokenState } from '@/models/portal-tokens.model'
import type {
  PortalAccessRequest,
  PortalCandidate,
  PortalCandidateReason,
  PortalRelationship,
  PortalRequestPrefill,
  PortalRequestStatus,
} from '@/models/types'

/**
 * Pedidos de acceso (`portal_access_requests`) y sus candidatos, vistos desde
 * Revisión (pipeline 2026-11-24-app-socios, S2; 00 §4.A.8 y §4.H).
 *
 * - Lectura por RLS (`portal.review`). Sin el permiso, todo vuelve vacío.
 * - Rechazar es la RPC `resolve_portal_request`. Invitar NO pasa por acá: es
 *   `create_portal_token(p_request_id)`, que deja el pedido en `invited`.
 * - Las sugerencias no se guardan: `portal_request_candidates` las calcula al
 *   abrir el pedido contra el padrón de ese momento.
 * - Nunca se loguea DNI, teléfono, email ni nombres: ids.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export const rejectPortalRequestSchema = z
  .object({
    requestId: z.number().int().positive(),
    note: z
      .string('Indicá el motivo del rechazo')
      .trim()
      .min(3, 'El motivo tiene que tener al menos 3 caracteres')
      .max(500, 'El motivo no puede tener más de 500 caracteres'),
  })
  .strict()
export type RejectPortalRequestInput = z.infer<typeof rejectPortalRequestSchema>

export const listPortalRequestsSchema = z
  .object({ status: z.enum(['pending', 'resolved']) })
  .strict()
export type ListPortalRequestsParams = z.infer<typeof listPortalRequestsSchema>

// -----------------------------------------------------------------------------
// Mapeo
// -----------------------------------------------------------------------------

type RequestRow = {
  id: number
  first_name: string
  last_name: string
  dni: string
  phone_raw: string
  phone_e164: string | null
  email: string | null
  message: string | null
  status: string
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
  resolution_note: string | null
  portal_access_request_people:
    | { id: number; first_name: string; last_name: string; dni: string | null; relationship: string }[]
    | null
}

const REQUEST_SELECT =
  'id, first_name, last_name, dni, phone_raw, phone_e164, email, message, status, created_at, resolved_at, resolved_by, resolution_note, ' +
  'portal_access_request_people(id, first_name, last_name, dni, relationship)'

// Pendientes: el que más espera, primero, y todos (una cola de club: decenas, no miles).
// Resueltos: solo los últimos 100 (contrato S2).
const PENDING_LIMIT = 500
const RESOLVED_LIMIT = 100

function mapRequest(
  row: RequestRow,
  names: Map<string, string>,
  invitationLive: boolean | null,
): PortalAccessRequest {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    dni: row.dni,
    phoneRaw: row.phone_raw,
    phoneE164: row.phone_e164,
    email: row.email,
    message: row.message,
    status: row.status as PortalRequestStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by ? (names.get(row.resolved_by) ?? null) : null,
    resolutionNote: row.resolution_note,
    invitationLive,
    people: (row.portal_access_request_people ?? [])
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((p) => ({
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        dni: p.dni,
        relationship: p.relationship as PortalRelationship,
      })),
  }
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

/**
 * Para cada pedido `invited`: ¿queda alguna invitación vigente (pendiente, no
 * vencida, no revocada, no bloqueada por DNI)? Un pedido invitado cuyos enlaces
 * ya murieron sin que nadie los canjeara necesita que Revisión haga algo
 * (reinvitar o rechazar): no puede quedar en el limbo de "Resueltos".
 * Un pedido sin ningún token cuenta como sin invitación vigente.
 */
async function invitationLiveByRequest(requestIds: readonly number[]): Promise<Map<number, boolean>> {
  const live = new Map<number, boolean>(requestIds.map((id) => [id, false]))
  if (requestIds.length === 0) return live

  const supabase = await createClient()
  const now = new Date()
  for (const part of chunk(requestIds)) {
    const { data, error } = await supabase
      .from('portal_access_tokens')
      .select('request_id, consumed_at, revoked_at, failed_checks, expires_at')
      .in('request_id', part)
      .limit(1000)
    if (error) throw error
    for (const t of data ?? []) {
      if (t.request_id !== null && deriveTokenState(t, now) === 'pending') live.set(t.request_id, true)
    }
  }
  return live
}

/** Ids de los pedidos `invited` (la cola es de un club: decenas, no miles). */
async function listInvitedRequestIds(): Promise<number[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('portal_access_requests')
    .select('id')
    .eq('status', 'invited')
    .order('id', { ascending: true })
    .limit(PENDING_LIMIT)
  if (error) throw error
  return (data ?? []).map((r) => r.id)
}

/** Ids de los pedidos `invited` sin ninguna invitación vigente: vuelven a la cola. */
async function listLapsedInvitedRequestIds(): Promise<number[]> {
  const invited = await listInvitedRequestIds()
  const live = await invitationLiveByRequest(invited)
  return invited.filter((id) => live.get(id) === false)
}

/**
 * `pending`: la cola de Revisión, el más viejo primero. Son los `pending` MÁS
 * los `invited` cuyas invitaciones ya vencieron o se revocaron sin canjearse
 * (`invitationLive === false`): hay que reinvitar o rechazar.
 * `resolved`: lo que salió de la cola (invitado con enlace vigente, completado
 * o rechazado), los últimos 100 por fecha de resolución.
 */
export async function listPortalRequests(params: ListPortalRequestsParams): Promise<PortalAccessRequest[]> {
  const supabase = await createClient()

  if (params.status === 'pending') {
    const lapsedIds = await listLapsedInvitedRequestIds()
    const [{ data: pendingRows, error }, lapsedRows] = await Promise.all([
      supabase
        .from('portal_access_requests')
        .select(REQUEST_SELECT)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(PENDING_LIMIT),
      lapsedIds.length === 0
        ? Promise.resolve({ data: [] as unknown[], error: null })
        : supabase.from('portal_access_requests').select(REQUEST_SELECT).in('id', lapsedIds.slice(0, PENDING_LIMIT)),
    ])
    if (error) throw error
    if (lapsedRows.error) throw lapsedRows.error

    const rows = [...((pendingRows ?? []) as unknown as RequestRow[]), ...((lapsedRows.data ?? []) as RequestRow[])]
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)
    const names = await resolveActorNames(rows.map((r) => r.resolved_by))
    return rows.map((r) => mapRequest(r, names, r.status === 'invited' ? false : null))
  }

  // Se piden de más porque los `invited` sin enlace vigente salen de acá (están en Pendientes).
  const { data, error } = await supabase
    .from('portal_access_requests')
    .select(REQUEST_SELECT)
    .neq('status', 'pending')
    .order('resolved_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(RESOLVED_LIMIT * 2)
  if (error) throw error

  const rows = (data ?? []) as unknown as RequestRow[]
  const live = await invitationLiveByRequest(rows.filter((r) => r.status === 'invited').map((r) => r.id))
  const kept = rows.filter((r) => r.status !== 'invited' || live.get(r.id) === true).slice(0, RESOLVED_LIMIT)
  const names = await resolveActorNames(kept.map((r) => r.resolved_by))
  return kept.map((r) => mapRequest(r, names, r.status === 'invited' ? true : null))
}

export async function getPortalRequest(requestId: number): Promise<PortalAccessRequest | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('portal_access_requests')
    .select(REQUEST_SELECT)
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as RequestRow
  const names = await resolveActorNames([row.resolved_by])
  const invitationLive =
    row.status === 'invited' ? ((await invitationLiveByRequest([row.id])).get(row.id) ?? false) : null
  return mapRequest(row, names, invitationLive)
}

const CANDIDATE_REASONS: ReadonlySet<string> = new Set(['dni', 'phone', 'payer_phone', 'email', 'name'])

/**
 * Candidatos del pedido: la RPC (`portal_request_candidates`, hasta 5 por
 * persona, mejor puntaje primero) más el nombre de cada socio, en UNA consulta
 * extra para todos. El `memberName` es "Apellido, Nombre".
 */
export async function listPortalRequestCandidates(requestId: number): Promise<PortalCandidate[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('portal_request_candidates', { p_request_id: requestId })
  if (error) throw translatePortalRpcError(error)

  const rows = data ?? []
  if (rows.length === 0) return []

  const memberIds = Array.from(new Set(rows.map((r) => r.member_id)))
  const nameById = new Map<number, string>()
  for (const part of chunk(memberIds)) {
    const { data: members, error: membersError } = await supabase
      .from('members')
      .select('id, first_name, last_name')
      .in('id', part)
    if (membersError) throw membersError
    for (const m of members ?? []) nameById.set(m.id, `${m.last_name}, ${m.first_name}`)
  }

  return rows.map((r) => ({
    personId: r.person_id,
    memberId: r.member_id,
    memberName: nameById.get(r.member_id) ?? '',
    score: r.score,
    reasons: r.reasons.filter((reason): reason is PortalCandidateReason => CANDIDATE_REASONS.has(reason)),
    familyGroupId: r.family_group_id,
    hasAccount: r.has_account,
  }))
}

/**
 * El pendiente que sigue a `afterRequestId` en el orden de la cola (más viejo
 * primero; el id es identity, así que crece con el tiempo). La cola son los
 * `pending` y los `invited` sin invitación vigente. Si no queda ninguno más
 * nuevo, vuelve al más viejo que no sea ese. `null` = cola vacía.
 */
export async function getNextPendingRequestId(afterRequestId: number | null): Promise<number | null> {
  const ids = await listQueueRequestIds()
  const rest = afterRequestId === null ? ids : ids.filter((id) => id !== afterRequestId)
  if (afterRequestId !== null) {
    const next = rest.find((id) => id > afterRequestId)
    if (next !== undefined) return next
  }
  return rest[0] ?? null
}

/** Ids de la cola de Revisión (pending + invited sin enlace vigente), de menor a mayor. */
async function listQueueRequestIds(): Promise<number[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('portal_access_requests')
    .select('id')
    .eq('status', 'pending')
    .order('id', { ascending: true })
    .limit(PENDING_LIMIT)
  if (error) throw error

  const lapsed = await listLapsedInvitedRequestIds()
  return [...(data ?? []).map((r) => r.id), ...lapsed].sort((a, b) => a - b)
}

/** Tamaño de la cola de Revisión (badge de la navegación). La RLS devuelve 0 sin `portal.review`. */
export async function countPendingPortalRequests(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('portal_access_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return (count ?? 0) + (await listLapsedInvitedRequestIds()).length
}

/**
 * Teléfono E.164 que declaró la persona, para "mandar al teléfono declarado".
 * Prefiere el normalizado que guardó la app de socios; si no lo trae, normaliza
 * el crudo con el código de área del club. `null` si no hay forma de resolverlo
 * sin adivinar (la invitación igual sale, pero sin botón de WhatsApp).
 */
export async function getRequestDeclaredPhone(requestId: number): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('portal_access_requests')
    .select('phone_raw, phone_e164')
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  if (data.phone_e164) return data.phone_e164
  return normalizePhoneToE164(data.phone_raw, await getDefaultPhoneAreaCode())
}

/**
 * Datos para precargar la ficha de ingreso (`/socios/nuevo?pedido=<id>`).
 * Si entre las personas declaradas hay una `self`, esa persona ES quien pide:
 * se precarga con lo que cargó al pedir. Si pidió solo para sus hijos, la ficha
 * es la del primero que declaró (nombre y DNI de esa persona) y el teléfono y el
 * email son los de contacto del pedido. Sin personas declaradas, quien pide.
 * Solo precarga: el que carga revisa y guarda con las reglas de siempre.
 */
export async function getRequestPrefill(requestId: number): Promise<PortalRequestPrefill | null> {
  const request = await getPortalRequest(requestId)
  if (!request) return null

  const self = request.people.find((p) => p.relationship === 'self')
  const person = self ? null : (request.people[0] ?? null)

  return {
    requestId: request.id,
    firstName: person ? person.firstName : request.firstName,
    lastName: person ? person.lastName : request.lastName,
    dni: person ? person.dni : request.dni,
    phone: request.phoneRaw,
    email: request.email,
  }
}

// -----------------------------------------------------------------------------
// Escrituras (RPC)
// -----------------------------------------------------------------------------

/** Rechaza el pedido con motivo (`resolve_portal_request`, `p_status = 'rejected'`). Un pedido ya resuelto no se rechaza. */
export async function rejectPortalRequest(input: RejectPortalRequestInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('resolve_portal_request', {
    p_request_id: input.requestId,
    p_status: 'rejected',
    p_note: input.note,
  })
  if (error) throw translatePortalRpcError(error)
}
