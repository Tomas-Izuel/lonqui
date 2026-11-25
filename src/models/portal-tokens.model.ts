import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  chunk,
  resolveActorNames,
  translatePortalRpcError,
} from '@/models/portal-accounts.model'
import type {
  PortalRelationship,
  PortalTokenDelivery,
  PortalTokenPurpose,
  PortalTokenState,
  PortalTokenSummary,
} from '@/models/types'

/**
 * Invitaciones y enlaces de ingreso (`portal_access_tokens`), vistos desde el
 * panel (pipeline 2026-11-24-app-socios, S2; 00 §4.A.2).
 *
 * - Se emiten y se revocan SOLO por RPC (`create_portal_token`,
 *   `revoke_portal_token`): la tabla no admite escritura directa.
 * - El token en CLARO sale una vez, en la respuesta de `create_portal_token`, y
 *   esta capa lo devuelve sin guardarlo ni loguearlo. En la base queda el SHA-256.
 * - Las lecturas jamás piden `token_hash`.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const DELIVERY = z.enum(['whatsapp', 'qr'] satisfies PortalTokenDelivery[], 'Elegí cómo entregar el enlace')
const RELATIONSHIP = z.enum(['self', 'guardian'] satisfies PortalRelationship[], 'Indicá la relación con el socio')

export const issuePortalInviteSchema = z
  .object({
    memberId: z.number('Elegí un socio').int('Elegí un socio').positive('Elegí un socio'),
    familyScope: z.boolean(),
    relationship: RELATIONSHIP,
    delivery: DELIVERY,
    requestId: z.number().int().positive().optional(),
    /** Default true. false = invitar a OTRA persona sobre el mismo socio (madre y padre). */
    replacePending: z.boolean().optional(),
    /** Solo con `requestId`: mandar al teléfono que declaró la persona en vez del del padrón. */
    sendToDeclaredPhone: z.boolean().optional(),
  })
  .strict()
  .refine((data) => !data.sendToDeclaredPhone || data.requestId !== undefined, {
    message: 'Solo se puede usar el teléfono declarado cuando la invitación sale de un pedido',
    path: ['sendToDeclaredPhone'],
  })
export type IssuePortalInviteInput = z.infer<typeof issuePortalInviteSchema>

export const issuePortalLoginLinkSchema = z
  .object({
    accountId: z.guid('La cuenta no es válida'),
    delivery: DELIVERY,
  })
  .strict()
export type IssuePortalLoginLinkInput = z.infer<typeof issuePortalLoginLinkSchema>

export const portalTokenIdSchema = z.object({ tokenId: z.number().int().positive() }).strict()

export const revokePortalTokenSchema = z
  .object({
    tokenId: z.number().int().positive(),
    reason: z
      .string('Indicá el motivo')
      .trim()
      .min(3, 'El motivo tiene que tener al menos 3 caracteres')
      .max(500, 'El motivo no puede tener más de 500 caracteres'),
  })
  .strict()
export type RevokePortalTokenInput = z.infer<typeof revokePortalTokenSchema>

// -----------------------------------------------------------------------------
// Estado derivado
// -----------------------------------------------------------------------------

/** Cinco verificaciones de DNI fallidas bloquean el token (`portal_token_peek`). */
export const MAX_FAILED_CHECKS = 5

type TokenStateFields = {
  consumed_at: string | null
  revoked_at: string | null
  failed_checks: number
  expires_at: string
}

/**
 * consumido > revocado > bloqueado (5 DNI fallidos) > vencido > pendiente.
 * Pura: el reloj entra por parámetro para poder probar el borde de `expires_at`
 * (vence EN ese instante, igual que `expires_at > now()` en SQL).
 */
export function deriveTokenState(row: TokenStateFields, now: Date = new Date()): PortalTokenState {
  if (row.consumed_at) return 'consumed'
  if (row.revoked_at) return 'revoked'
  if (row.failed_checks >= MAX_FAILED_CHECKS) return 'locked'
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'pending'
}

// -----------------------------------------------------------------------------
// Emisión y revocación (RPC)
// -----------------------------------------------------------------------------

export type CreatedPortalToken = {
  tokenId: number
  /** En CLARO. Existe solo acá y en la respuesta de la action: no se guarda ni se loguea. */
  token: string
  expiresAt: string
}

export type CreatePortalTokenArgs =
  | {
      purpose: 'invite'
      delivery: PortalTokenDelivery
      memberId: number
      familyScope: boolean
      relationship: PortalRelationship
      requestId?: number
      replacePending: boolean
    }
  | { purpose: 'login'; delivery: PortalTokenDelivery; accountId: string }

/**
 * `create_portal_token`: el permiso (`portal.invite` o `portal.login_link`), las
 * vigencias (QR 15 min, ingreso 30 min, invitación 72 h) y la revocación del
 * pendiente las resuelve la RPC. Acá solo se arma la llamada.
 */
export async function createPortalToken(args: CreatePortalTokenArgs): Promise<CreatedPortalToken> {
  const supabase = await createClient()

  const params =
    args.purpose === 'invite'
      ? {
          p_purpose: 'invite',
          p_delivery: args.delivery,
          p_member_id: args.memberId,
          p_family_scope: args.familyScope,
          p_relationship: args.relationship,
          p_request_id: args.requestId,
          p_replace_pending: args.replacePending,
        }
      : { p_purpose: 'login', p_delivery: args.delivery, p_account_id: args.accountId }

  const { data, error } = await supabase.rpc('create_portal_token', params)
  if (error) throw translatePortalRpcError(error)

  const row = data?.[0]
  if (!row) throw new Error('create_portal_token no devolvió el enlace')
  return { tokenId: row.token_id, token: row.token, expiresAt: row.expires_at }
}

export async function revokePortalToken(input: RevokePortalTokenInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('revoke_portal_token', { p_token_id: input.tokenId, p_reason: input.reason })
  if (error) throw translatePortalRpcError(error)
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

/** Estado actual de un token, o `null` si no existe (o la RLS no lo deja ver). Para el "usada" en vivo del QR. */
export async function getPortalTokenState(tokenId: number): Promise<PortalTokenState | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('portal_access_tokens')
    .select('consumed_at, revoked_at, failed_checks, expires_at')
    .eq('id', tokenId)
    .maybeSingle()
  if (error) throw error
  return data ? deriveTokenState(data) : null
}

type TokenRow = {
  id: number
  purpose: string
  delivery: string
  family_scope: boolean
  relationship: string | null
  member_id: number | null
  account_id: string | null
  created_at: string
  created_by: string
  expires_at: string
  consumed_at: string | null
  revoked_at: string | null
  failed_checks: number
}

const TOKEN_SELECT =
  'id, purpose, delivery, family_scope, relationship, member_id, account_id, created_at, created_by, expires_at, consumed_at, revoked_at, failed_checks'

// Lo que muestra la ficha: lo reciente. Las listas del portal son chicas (un
// club de ~250 socios), pero se acota explícito para no depender del `max_rows`.
const TOKENS_LIMIT = 100

/**
 * Invitaciones de los socios dados y enlaces de ingreso de las cuentas dadas,
 * con los vigentes primero y después del más nuevo al más viejo.
 *
 * `inviteVisibleToMemberId`: ficha de UN socio. Cuenta una invitación anclada a
 * él, o una con `family_scope` anclada a un hermano (al canjearla, lo vería).
 * `null` en la ficha del grupo: todas las del grupo.
 */
export async function listPortalTokens(params: {
  memberIds: readonly number[]
  inviteVisibleToMemberId: number | null
  accountIds: readonly string[]
}): Promise<PortalTokenSummary[]> {
  const supabase = await createClient()
  const rows: TokenRow[] = []

  for (const part of chunk(params.memberIds)) {
    const { data, error } = await supabase
      .from('portal_access_tokens')
      .select(TOKEN_SELECT)
      .eq('purpose', 'invite')
      .in('member_id', part)
      .order('created_at', { ascending: false })
      .limit(TOKENS_LIMIT)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as TokenRow[]))
  }
  for (const part of chunk(params.accountIds)) {
    const { data, error } = await supabase
      .from('portal_access_tokens')
      .select(TOKEN_SELECT)
      .eq('purpose', 'login')
      .in('account_id', part)
      .order('created_at', { ascending: false })
      .limit(TOKENS_LIMIT)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as TokenRow[]))
  }

  const visible = rows.filter(
    (t) =>
      t.purpose === 'login' ||
      params.inviteVisibleToMemberId === null ||
      t.member_id === params.inviteVisibleToMemberId ||
      t.family_scope,
  )

  const names = await resolveActorNames(visible.map((t) => t.created_by))
  const now = new Date()

  return visible
    .map((t) => ({
      id: t.id,
      purpose: t.purpose as PortalTokenPurpose,
      delivery: t.delivery as PortalTokenDelivery,
      familyScope: t.family_scope,
      relationship: t.relationship as PortalRelationship | null,
      state: deriveTokenState(t, now),
      createdAt: t.created_at,
      createdByName: names.get(t.created_by) ?? null,
      expiresAt: t.expires_at,
      consumedAt: t.consumed_at,
    }))
    .sort((a, b) => {
      const live = Number(b.state === 'pending') - Number(a.state === 'pending')
      return live !== 0 ? live : b.createdAt.localeCompare(a.createdAt) || b.id - a.id
    })
    .slice(0, TOKENS_LIMIT)
}
