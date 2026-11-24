import { randomInt, randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
import { actAs, actAsSuperuser, createAuthUser, createFamilyGroup, createMember, createUserWithRole } from './helpers'

/**
 * Fixtures de la app de socios (S2): tokens, cuentas, vínculos y pedidos de acceso, armados con las RPC REALES
 * (las del panel como un usuario con rol, las de servicio como `service_role`) para que el fixture pase por las
 * mismas reglas que producción. Todo inventado; todo corre dentro de `withRollback`.
 */

/** DNI inventado de 8 dígitos (prefijo 99: no choca con DNI reales del desarrollo local). */
export function fakeDni(): string {
  return `99${String(randomInt(0, 1_000_000)).padStart(6, '0')}`
}

/** Teléfono AR inventado de 10 dígitos (área 351 + abonado), sin ceros ni 15. */
export function fakePhone(): string {
  return `351${String(randomInt(1_000_000, 10_000_000))}`
}

/** `service_role` como lo ve la base cuando la app de socios llama con la secret key: sin `sub` en los claims. */
export async function actAsServiceRole(client: ClientBase): Promise<void> {
  await client.query('set local role service_role')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })])
}

/** Usuario de Auth que NO es del panel (el socio-por-venir). */
export async function createPortalAuthUser(client: ClientBase): Promise<string> {
  const userId = randomUUID()
  await createAuthUser(client, { id: userId, email: `socio-${userId.slice(0, 8)}@lonqui.test` })
  return userId
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type IssueArgs = {
  purpose?: 'invite' | 'login'
  delivery?: 'whatsapp' | 'qr'
  memberId?: number | null
  familyScope?: boolean
  relationship?: 'self' | 'guardian' | null
  accountId?: string | null
  requestId?: number | null
  replacePending?: boolean
}

export type IssuedToken = { tokenId: number; token: string; expiresAt: Date }

/** SQL + parámetros de `create_portal_token` con los defaults del uso más común (una invitación de guardián por WhatsApp). */
export function createTokenCall(args: IssueArgs): { sql: string; params: unknown[] } {
  const purpose = args.purpose ?? 'invite'
  return {
    sql: `select token_id, token, expires_at from public.create_portal_token($1::text, $2::text, $3::bigint, $4::boolean, $5::text, $6::uuid, $7::bigint, $8::boolean)`,
    params: [
      purpose,
      args.delivery ?? 'whatsapp',
      args.memberId ?? null,
      args.familyScope ?? false,
      args.relationship === undefined ? (purpose === 'invite' ? 'guardian' : null) : args.relationship,
      args.accountId ?? null,
      args.requestId ?? null,
      args.replacePending ?? true,
    ],
  }
}

/** Emite un token como `actorUserId` (sesión real: `auth.uid()` = ese usuario). Vuelve a ser superusuario. */
export async function issueToken(client: ClientBase, actorUserId: string, args: IssueArgs = {}): Promise<IssuedToken> {
  const { sql, params } = createTokenCall(args)
  await actAs(client, actorUserId)
  const res = await client.query<{ token_id: string; token: string; expires_at: Date }>(sql, params)
  await actAsSuperuser(client)
  const row = res.rows[0]
  return { tokenId: Number(row.token_id), token: row.token, expiresAt: row.expires_at }
}

export type ConsumeOptions = {
  checkDni?: string | null
  firstName?: string | null
  lastName?: string | null
  personDni?: string | null
  phoneE164?: string | null
  termsAccepted?: boolean
}

export type ConsumeResult = { status: string; account_id: string | null }

export const CONSUME_SQL = `select status, account_id from public.portal_token_consume($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text, $8::boolean)`

export function consumeParams(token: string, userId: string, o: ConsumeOptions = {}): unknown[] {
  return [
    token,
    userId,
    o.checkDni ?? null,
    o.firstName === undefined ? 'Persona' : o.firstName,
    o.lastName === undefined ? 'Inventada' : o.lastName,
    o.personDni === undefined ? fakeDni() : o.personDni,
    o.phoneE164 ?? null,
    o.termsAccepted ?? true,
  ]
}

/** Consume como `service_role` (así lo llama /api/v1). Vuelve a ser superusuario. */
export async function consumeToken(client: ClientBase, token: string, userId: string, o: ConsumeOptions = {}): Promise<ConsumeResult> {
  await actAsServiceRole(client)
  const res = await client.query<ConsumeResult>(CONSUME_SQL, consumeParams(token, userId, o))
  await actAsSuperuser(client)
  return res.rows[0]
}

export type PeekResult = { status: string; token_id: string | null; purpose: string | null; account_id: string | null; family_scope: boolean | null }

/** Peek como `service_role`. Vuelve a ser superusuario. */
export async function peekToken(client: ClientBase, token: string, dni: string | null = null): Promise<PeekResult> {
  await actAsServiceRole(client)
  const res = await client.query<PeekResult>(`select * from public.portal_token_peek($1::text, $2::text)`, [token, dni])
  await actAsSuperuser(client)
  return res.rows[0]
}

export type RawTokenInput = {
  /** El valor en claro (el test lo conoce; la base solo recibe el SHA-256). */
  token: string
  createdBy: string
  memberId?: number | null
  accountId?: string | null
  purpose?: 'invite' | 'login'
  relationship?: 'self' | 'guardian' | null
  delivery?: 'whatsapp' | 'qr'
  requiresDniCheck?: boolean
  familyScope?: boolean
  failedChecks?: number
  /** Desplazamientos respecto de `now()` (la hora de la transacción): '-2 hours', '1 second'... */
  createdOffset?: string
  expiresOffset?: string
}

/**
 * Inserta un token con tiempos a medida (vencido, a un segundo de vencer) saltando `create_portal_token`: el guard de
 * UPDATE no deja tocar `expires_at`, pero un INSERT de superusuario sí. Devuelve el id.
 */
export async function insertRawToken(client: ClientBase, o: RawTokenInput): Promise<number> {
  const purpose = o.purpose ?? 'invite'
  const res = await client.query<{ id: string }>(
    `insert into public.portal_access_tokens
       (purpose, token_hash, member_id, account_id, family_scope, relationship, delivery, requires_dni_check,
        failed_checks, expires_at, created_by, created_at)
     values ($1, sha256(convert_to($2, 'UTF8')), $3, $4, $5, $6, $7, $8, $9,
             now() + $10::interval, $11, now() + $12::interval)
     returning id`,
    [
      purpose,
      o.token,
      o.memberId ?? null,
      o.accountId ?? null,
      o.familyScope ?? false,
      o.relationship === undefined ? (purpose === 'invite' ? 'guardian' : null) : o.relationship,
      o.delivery ?? 'whatsapp',
      o.requiresDniCheck ?? false,
      o.failedChecks ?? 0,
      o.expiresOffset ?? '1 hour',
      o.createdBy,
      o.createdOffset ?? '0 seconds',
    ],
  )
  return Number(res.rows[0].id)
}

export type TokenRow = {
  id: string
  purpose: string
  consumed_at: Date | null
  consumed_by: string | null
  revoked_at: Date | null
  revoked_by: string | null
  revoke_reason: string | null
  failed_checks: number
  requires_dni_check: boolean
  family_scope: boolean
  created_by: string
  ttl_seconds: number
}

/** Estado de un token leído como superusuario. `ttl_seconds` = vigencia (expires_at − created_at). */
export async function tokenRow(client: ClientBase, tokenId: number): Promise<TokenRow> {
  const res = await client.query<TokenRow>(
    `select id, purpose, consumed_at, consumed_by, revoked_at, revoked_by, revoke_reason, failed_checks,
            requires_dni_check, family_scope, created_by, extract(epoch from expires_at - created_at)::int as ttl_seconds
       from public.portal_access_tokens where id = $1`,
    [tokenId],
  )
  return res.rows[0]
}

// ---------------------------------------------------------------------------
// Cuentas y vínculos
// ---------------------------------------------------------------------------

export type LinkedAccount = { userId: string; dni: string; tokenId: number; linkId: number }

/**
 * Cuenta de la app nacida como nace en producción: un admin emite la invitación y el servicio la canjea. `delivery`
 * 'qr' por defecto: no pide verificación de DNI (la invitación se entregó cara a cara).
 */
export async function linkNewAccount(
  client: ClientBase,
  o: {
    adminId: string
    memberId: number
    relationship?: 'self' | 'guardian'
    familyScope?: boolean
    dni?: string
    delivery?: 'whatsapp' | 'qr'
    checkDni?: string | null
    userId?: string
  },
): Promise<LinkedAccount> {
  const userId = o.userId ?? (await createPortalAuthUser(client))
  const dni = o.dni ?? fakeDni()
  const issued = await issueToken(client, o.adminId, {
    memberId: o.memberId,
    delivery: o.delivery ?? 'qr',
    familyScope: o.familyScope ?? false,
    relationship: o.relationship ?? 'guardian',
    replacePending: false,
  })
  const consumed = await consumeToken(client, issued.token, userId, { personDni: dni, checkDni: o.checkDni ?? null })
  if (consumed.status !== 'ok') throw new Error(`linkNewAccount: el canje devolvió "${consumed.status}"`)
  const link = await client.query<{ id: string }>(
    `select id from public.portal_account_members where account_id = $1 and member_id = $2 and revoked_at is null`,
    [userId, o.memberId],
  )
  return { userId, dni, tokenId: issued.tokenId, linkId: Number(link.rows[0].id) }
}

/** Socios que ve la cuenta, tal cual los devuelve `portal_me()` con su sesión (ids ordenados). */
export async function visibleMemberIds(client: ClientBase, userId: string): Promise<number[]> {
  await actAs(client, userId)
  const res = await client.query<{ me: { members: Array<{ member_id: number }> } | null }>(`select public.portal_me() as me`)
  await actAsSuperuser(client)
  const me = res.rows[0].me
  return me ? me.members.map((m) => m.member_id).sort((a, b) => a - b) : []
}

// ---------------------------------------------------------------------------
// Pedidos de acceso
// ---------------------------------------------------------------------------

export type RequestPerson = { first_name: string; last_name: string; dni?: string | null; relationship: 'self' | 'guardian' }

export type SubmitOptions = {
  firstName?: string
  lastName?: string
  dni?: string
  phoneRaw?: string
  phoneE164?: string | null
  email?: string | null
  message?: string | null
  people?: RequestPerson[] | null
  clientKey?: string
}

export const SUBMIT_SQL = `select public.portal_submit_access_request($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::jsonb, $9::text) as accepted`

export function submitParams(o: SubmitOptions = {}): { dni: string; params: unknown[] } {
  const dni = o.dni ?? fakeDni()
  return {
    dni,
    params: [
      o.firstName ?? 'Solicitante',
      o.lastName ?? 'Inventada',
      dni,
      o.phoneRaw ?? '3511234567',
      o.phoneE164 ?? null,
      o.email ?? null,
      o.message ?? null,
      o.people === null
        ? null
        : JSON.stringify(o.people ?? [{ first_name: 'Hijo', last_name: 'Inventado', dni: null, relationship: 'guardian' }]),
      o.clientKey ?? `ip-${randomUUID()}`,
    ],
  }
}

/** Envía un pedido como `service_role` (así lo llama /api/v1). Devuelve si se aceptó y el id (null si se descartó). */
export async function submitRequest(client: ClientBase, o: SubmitOptions = {}): Promise<{ accepted: boolean; requestId: number | null; dni: string }> {
  const { dni, params } = submitParams(o)
  await actAsServiceRole(client)
  const res = await client.query<{ accepted: boolean }>(SUBMIT_SQL, params)
  await actAsSuperuser(client)
  const accepted = res.rows[0].accepted
  let requestId: number | null = null
  if (accepted) {
    const row = await client.query<{ id: string }>(`select id from public.portal_access_requests where dni = $1 order by id desc limit 1`, [dni])
    requestId = Number(row.rows[0].id)
  }
  return { accepted, requestId, dni }
}

export async function requestStatus(client: ClientBase, requestId: number): Promise<{ status: string; resolved_by: string | null; resolved_at: Date | null; resolution_note: string | null }> {
  const res = await client.query(`select status, resolved_by, resolved_at, resolution_note from public.portal_access_requests where id = $1`, [requestId])
  return res.rows[0]
}

// ---------------------------------------------------------------------------
// Mundo mínimo para los tests de S2
// ---------------------------------------------------------------------------

export type PortalWorld = {
  adminId: string
  editorId: string
  consultaId: string
  /** Usuario de Auth sin rol del panel ni cuenta de la app. */
  orphanId: string
  groupId: number
  /** Socio con DNI, en el grupo. */
  memberId: number
  memberDni: string
  /** Hermano: socio con DNI, en el mismo grupo. */
  siblingId: number
  siblingDni: string
  /** Socio con DNI y sin grupo. */
  soloId: number
  soloDni: string
  /** Socio sin DNI y sin grupo. */
  noDniId: number
}

/** Un usuario por rol del panel, un huérfano y cuatro socios (dos hermanos en un grupo, uno solo con DNI, uno sin DNI). */
export async function portalWorld(client: ClientBase): Promise<PortalWorld> {
  await actAsSuperuser(client)
  const admin = await createUserWithRole(client, 'admin')
  const editor = await createUserWithRole(client, 'editor')
  const consulta = await createUserWithRole(client, 'consulta')
  const orphanId = await createPortalAuthUser(client)
  const groupId = await createFamilyGroup(client, { name: 'Grupo Ficticio de Prueba' })
  const memberDni = fakeDni()
  const siblingDni = fakeDni()
  const soloDni = fakeDni()
  const memberId = await createMember(client, { firstName: 'Ana', lastName: 'Inventada', dni: memberDni, familyGroupId: groupId })
  const siblingId = await createMember(client, { firstName: 'Beto', lastName: 'Inventado', dni: siblingDni, familyGroupId: groupId })
  const soloId = await createMember(client, { firstName: 'Carla', lastName: 'Ficticia', dni: soloDni })
  const noDniId = await createMember(client, { firstName: 'Dario', lastName: 'Imaginario' })
  return {
    adminId: admin.userId,
    editorId: editor.userId,
    consultaId: consulta.userId,
    orphanId,
    groupId,
    memberId,
    memberDni,
    siblingId,
    siblingDni,
    soloId,
    soloDni,
    noDniId,
  }
}

// ---------------------------------------------------------------------------
// Auditoría y errores
// ---------------------------------------------------------------------------

export type AuditRow = {
  actor_id: string | null
  actor_source: string
  op: string
  changed_fields: string[] | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

/** Filas de auditoría de un registro, en orden. Se lee como superusuario. */
export async function auditRows(client: ClientBase, table: string, recordId: string | number): Promise<AuditRow[]> {
  const res = await client.query<AuditRow>(
    `select actor_id, actor_source, op, changed_fields, old_data, new_data from public.audit_log where table_name = $1 and record_id = $2 order by id`,
    [table, String(recordId)],
  )
  return res.rows
}

/** Compacta una auditoría a [op, actor, source] para comparar de un vistazo. */
export function auditTrail(rows: AuditRow[]): Array<[string, string | null, string]> {
  return rows.map((r) => [r.op, r.actor_id, r.actor_source])
}
