import 'server-only'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getSession, requirePanelAccess, requirePanelPermission } from '@/controllers/session.controller'
import { serverEnv } from '@/lib/env.server'
import { DomainError } from '@/lib/errors'
import {
  buildPortalMessage,
  buildPortalUrl,
  buildWhatsAppUrl,
  phoneToWhatsAppDigits,
  pickWhatsAppPhone,
} from '@/lib/phone'
import {
  getAccountPhoneE164,
  getDefaultPhoneAreaCode,
  getFamilyGroupMemberIds,
  getGroupPhoneSources,
  getInvitePhoneSources,
  getMemberRef,
  listCategoryInviteTargets as listCategoryInviteTargetsRows,
  listLinkedAccounts,
} from '@/models/portal-accounts.model'
import {
  getNextPendingRequestId as getNextPendingRequestIdRow,
  countPendingPortalRequests as countPendingPortalRequestsRow,
  getPortalRequest,
  getRequestDeclaredPhone,
  getRequestPrefill,
  listPortalRequestCandidates,
  listPortalRequests as listPortalRequestsRows,
  listPortalRequestsSchema,
} from '@/models/portal-requests.model'
import {
  createPortalToken,
  listPortalTokens,
  type IssuePortalInviteInput,
  type IssuePortalLoginLinkInput,
} from '@/models/portal-tokens.model'
import type {
  IssuedPortalToken,
  Permission,
  PortalAccessOverview,
  PortalAccessRequest,
  PortalInviteTarget,
  PortalRequestDetail,
  PortalRequestPrefill,
} from '@/models/types'

/**
 * Lecturas del panel para la app de socios + la orquestación de emitir un
 * enlace (pipeline 2026-11-24-app-socios, S2). Las Server Actions viven en
 * `portal.actions.ts` y delegan acá.
 *
 * Todo con el cliente de sesión y guards por PERMISO, no por rol. La
 * autorización real son las RLS y las RPC (`private.can(...)` en el cuerpo).
 */

// -----------------------------------------------------------------------------
// Guards
// -----------------------------------------------------------------------------

/**
 * Para lecturas que sirven tanto a quien invita como a quien revisa: alcanza con
 * UNO de los permisos. Redirige igual que el resto de las lecturas del panel.
 */
async function requireAnyPanelPermission(...permissions: Permission[]): Promise<void> {
  const session = await requirePanelAccess()
  if (!permissions.some((p) => session.permissions.includes(p))) redirect('/')
}

const positiveInt = z.number().int().positive()

// -----------------------------------------------------------------------------
// Lecturas: Revisión
// -----------------------------------------------------------------------------

/** [portal.review] Pendientes (el más viejo primero) o resueltos (los últimos 100). */
export async function listPortalRequests(params: { status: 'pending' | 'resolved' }): Promise<PortalAccessRequest[]> {
  await requirePanelPermission('portal.review')
  const parsed = listPortalRequestsSchema.safeParse(params)
  if (!parsed.success) return []
  return listPortalRequestsRows(parsed.data)
}

/** [portal.review] El pedido con sus candidatos; `null` si no existe. */
export async function getPortalRequestDetail(requestId: number): Promise<PortalRequestDetail | null> {
  await requirePanelPermission('portal.review')
  if (!positiveInt.safeParse(requestId).success) return null

  const request = await getPortalRequest(requestId)
  if (!request) return null
  const candidates = await listPortalRequestCandidates(requestId)
  return { request, candidates }
}

/** [portal.review] El siguiente pendiente después de `afterRequestId`; `null` si la cola quedó vacía. */
export async function getNextPendingRequestId(afterRequestId: number | null): Promise<number | null> {
  await requirePanelPermission('portal.review')
  if (afterRequestId !== null && !positiveInt.safeParse(afterRequestId).success) return null
  return getNextPendingRequestIdRow(afterRequestId)
}

/**
 * Pendientes para el badge de la navegación. NO redirige: corre en el layout de
 * todas las pantallas y, sin permiso (o sin sesión), simplemente es 0.
 */
export async function countPendingPortalRequests(): Promise<number> {
  const session = await getSession()
  if (!session || session.mustChangePassword || !session.role) return 0
  if (!session.permissions.includes('portal.review')) return 0
  return countPendingPortalRequestsRow()
}

/** [portal.review] Datos para precargar `/socios/nuevo?pedido=<id>`; `null` si el pedido no existe. */
export async function getPortalRequestPrefill(requestId: number): Promise<PortalRequestPrefill | null> {
  await requirePanelPermission('portal.review')
  if (!positiveInt.safeParse(requestId).success) return null
  return getRequestPrefill(requestId)
}

// -----------------------------------------------------------------------------
// Lecturas: fichas
// -----------------------------------------------------------------------------

/**
 * [portal.invite | portal.review] Qué cuentas ven a este socio y qué enlaces
 * hay emitidos. Una cuenta lo ve por un vínculo directo o por un `family_scope`
 * sobre cualquier integrante de su grupo: las dos cuentan.
 */
export async function getMemberPortalAccess(memberId: number): Promise<PortalAccessOverview> {
  await requireAnyPanelPermission('portal.invite', 'portal.review')

  const member = await getMemberRef(memberId)
  if (!member) throw new DomainError('El socio no existe', { status: 404 })

  const memberIds = member.familyGroupId !== null ? await getFamilyGroupMemberIds(member.familyGroupId) : [memberId]
  // El socio siempre va, aunque la lectura del grupo no lo devuelva.
  const scopeIds = memberIds.includes(memberId) ? memberIds : [...memberIds, memberId]

  const [accounts, areaCode, phoneSources] = await Promise.all([
    listLinkedAccounts(scopeIds, memberId),
    getDefaultPhoneAreaCode(),
    getInvitePhoneSources(memberId, false),
  ])
  const tokens = await listPortalTokens({
    memberIds: scopeIds,
    inviteVisibleToMemberId: memberId,
    accountIds: accounts.map((a) => a.accountId),
  })

  return { accounts, tokens, hasPhoneOnFile: pickWhatsAppPhone(phoneSources, areaCode) !== null }
}

/** [portal.invite | portal.review] Cuentas y enlaces de todo el grupo familiar. */
export async function getFamilyGroupPortalAccess(familyGroupId: number): Promise<PortalAccessOverview> {
  await requireAnyPanelPermission('portal.invite', 'portal.review')
  if (!positiveInt.safeParse(familyGroupId).success) {
    throw new DomainError('El grupo familiar no existe', { status: 404 })
  }

  const memberIds = await getFamilyGroupMemberIds(familyGroupId)
  const [accounts, areaCode, phoneSources] = await Promise.all([
    listLinkedAccounts(memberIds, null),
    getDefaultPhoneAreaCode(),
    getGroupPhoneSources(familyGroupId),
  ])
  const tokens = await listPortalTokens({
    memberIds,
    inviteVisibleToMemberId: null,
    accountIds: accounts.map((a) => a.accountId),
  })

  return { accounts, tokens, hasPhoneOnFile: pickWhatsAppPhone(phoneSources, areaCode) !== null }
}

/** [portal.invite] Grupos (o socios sin grupo) activos de la categoría que ninguna cuenta activa ve todavía. */
export async function listCategoryInviteTargets(categoryId: number): Promise<PortalInviteTarget[]> {
  await requirePanelPermission('portal.invite')
  if (!positiveInt.safeParse(categoryId).success) return []
  return listCategoryInviteTargetsRows(categoryId)
}

// -----------------------------------------------------------------------------
// Emisión (la usan las Server Actions, ya con permiso verificado y entrada validada)
// -----------------------------------------------------------------------------

/**
 * Origen de la app de socios: `serverEnv().PORTAL_APP_URL` (opcional en el
 * schema, para que su ausencia en el deploy no tire el panel entero). Solo
 * emitir un enlace depende de ella: sin la variable es un error de dominio
 * claro, no una falla genérica.
 */
function portalAppOrigin(): string {
  const origin = serverEnv().PORTAL_APP_URL
  if (!origin) {
    throw new DomainError('La app de socios todavía no está configurada (falta PORTAL_APP_URL).')
  }
  return origin
}

/** Teléfono (E.164) al que mandar la invitación, ya resuelto por la regla del contrato. */
async function resolveInvitePhone(input: IssuePortalInviteInput): Promise<string | null> {
  if (input.sendToDeclaredPhone && input.requestId !== undefined) {
    return getRequestDeclaredPhone(input.requestId)
  }
  const [sources, areaCode] = await Promise.all([
    getInvitePhoneSources(input.memberId, input.familyScope),
    getDefaultPhoneAreaCode(),
  ])
  return pickWhatsAppPhone(sources, areaCode)
}

const NO_WHATSAPP_PHONE = 'No hay un teléfono cargado para mandar por WhatsApp. Usá el QR o cargá el teléfono.'

/**
 * Dígitos de `wa.me` del teléfono resuelto, o `DomainError`. Se llama ANTES de
 * `createPortalToken`: emitir con `replacePending` revoca la invitación viva, y
 * una emisión que después no se puede entregar la habría anulado para nada.
 */
function requireWhatsAppDigits(phoneE164: string | null): string {
  const digits = phoneToWhatsAppDigits(phoneE164)
  if (!digits) throw new DomainError(NO_WHATSAPP_PHONE)
  return digits
}

/**
 * Emite una invitación. El origen y el teléfono (si es por WhatsApp) se
 * resuelven ANTES de crear el token: si falta alguno no se crea NI se revoca
 * nada. El token en claro vive solo en el valor de retorno; nada de acá lo
 * loguea ni lo cachea.
 */
export async function issueInvite(input: IssuePortalInviteInput): Promise<IssuedPortalToken> {
  const origin = portalAppOrigin()
  const digits = input.delivery === 'whatsapp' ? requireWhatsAppDigits(await resolveInvitePhone(input)) : null

  const created = await createPortalToken({
    purpose: 'invite',
    delivery: input.delivery,
    memberId: input.memberId,
    familyScope: input.familyScope,
    relationship: input.relationship,
    requestId: input.requestId,
    replacePending: input.replacePending ?? true,
  })

  const url = buildPortalUrl(origin, created.token)
  return {
    tokenId: created.tokenId,
    url,
    expiresAt: created.expiresAt,
    whatsappUrl: digits ? buildWhatsAppUrl(digits, buildPortalMessage('invite', url)) : null,
  }
}

/** Emite un enlace de ingreso para una cuenta (solo Administrador: lo exige la action y la RPC). */
export async function issueLoginLink(input: IssuePortalLoginLinkInput): Promise<IssuedPortalToken> {
  const origin = portalAppOrigin()
  const digits =
    input.delivery === 'whatsapp' ? requireWhatsAppDigits(await getAccountPhoneE164(input.accountId)) : null

  const created = await createPortalToken({ purpose: 'login', delivery: input.delivery, accountId: input.accountId })

  const url = buildPortalUrl(origin, created.token)
  return {
    tokenId: created.tokenId,
    url,
    expiresAt: created.expiresAt,
    whatsappUrl: digits ? buildWhatsAppUrl(digits, buildPortalMessage('login', url)) : null,
  }
}
