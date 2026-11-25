'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/controllers/session.controller'
import { issueInvite, issueLoginLink } from '@/controllers/portal.controller'
import { failure, invalid, success, type ActionResult } from '@/lib/action-result'
import { zodToApiError } from '@/lib/errors'
import { log } from '@/lib/log'
import {
  revokePortalLink as revokePortalLinkRow,
  revokePortalLinkSchema,
  setPortalAccountStatus as setPortalAccountStatusRow,
  setPortalAccountStatusSchema,
  type RevokePortalLinkInput,
  type SetPortalAccountStatusInput,
} from '@/models/portal-accounts.model'
import {
  getNextPendingRequestId,
  rejectPortalRequest as rejectPortalRequestRow,
  rejectPortalRequestSchema,
  type RejectPortalRequestInput,
} from '@/models/portal-requests.model'
import {
  getPortalTokenState as getPortalTokenStateRow,
  issuePortalInviteSchema,
  issuePortalLoginLinkSchema,
  portalTokenIdSchema,
  revokePortalToken as revokePortalTokenRow,
  revokePortalTokenSchema,
  type IssuePortalInviteInput,
  type IssuePortalLoginLinkInput,
  type RevokePortalTokenInput,
} from '@/models/portal-tokens.model'
import type { IssuedPortalToken, PortalTokenState } from '@/models/types'

/**
 * Server Actions de la app de socios (pipeline 2026-11-24-app-socios, S2).
 * Misma convención que `members.actions.ts`: reciben un objeto plano (tipado como
 * pide el contrato; igual se re-valida con Zod, porque el tipo no existe en
 * runtime) y devuelven `ActionResult<T>`; el guard de PERMISO va primero, después Zod,
 * después el modelo (que traduce los errores de las RPC) y por último
 * `revalidatePath`.
 *
 * El token en claro vive SOLO en el `ActionResult` de las dos acciones que
 * emiten: no se loguea, no entra en `revalidatePath` ni en ninguna caché. Los
 * errores se loguean con `failure(err, contexto)` y nunca llevan el token.
 */

/** Las fichas (socio y grupo) y Revisión muestran enlaces y cuentas: se refrescan juntas. */
function revalidatePortalViews(options?: { requests?: boolean }): void {
  revalidatePath('/socios', 'layout')
  // El badge de pendientes vive en la navegación del panel, por encima de /socios.
  if (options?.requests) revalidatePath('/', 'layout')
}

/**
 * Invitación a la app, por WhatsApp o QR. Con `requestId` (Revisión) además
 * exige `portal.review`: el pedido es un dato de Revisión, y quien solo invita
 * no tiene por qué resolverlo.
 */
export async function issuePortalInvite(input: IssuePortalInviteInput): Promise<ActionResult<IssuedPortalToken>> {
  try {
    await requirePermission('portal.invite')
    const parsed = issuePortalInviteSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }
    if (parsed.data.requestId !== undefined) await requirePermission('portal.review')

    const issued = await issueInvite(parsed.data)
    revalidatePortalViews({ requests: parsed.data.requestId !== undefined })
    return success(issued)
  } catch (err) {
    return failure(err, 'portal.issuePortalInvite')
  }
}

/** Enlace de ingreso para una cuenta que ya existe. SOLO Administrador: quien lo emite puede abrirlo. */
export async function issuePortalLoginLink(input: IssuePortalLoginLinkInput): Promise<ActionResult<IssuedPortalToken>> {
  try {
    await requirePermission('portal.login_link')
    const parsed = issuePortalLoginLinkSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const issued = await issueLoginLink(parsed.data)
    revalidatePortalViews()
    return success(issued)
  } catch (err) {
    return failure(err, 'portal.issuePortalLoginLink')
  }
}

/**
 * Estado de un enlace, para el "usada" en vivo del QR (polling desde el
 * cliente). Es una lectura y por eso NO revalida nada. Un id que no existe (o
 * que la RLS no deja ver) es un error de dominio, no un estado inventado.
 */
export async function getPortalTokenState(input: { tokenId: number }): Promise<ActionResult<{ state: PortalTokenState }>> {
  try {
    await requirePermission('portal.invite')
    const parsed = portalTokenIdSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const state = await getPortalTokenStateRow(parsed.data.tokenId)
    if (state === null) return invalid('El enlace no existe')
    return success({ state })
  } catch (err) {
    return failure(err, 'portal.getPortalTokenState')
  }
}

/**
 * Revoca un enlace vivo (motivo obligatorio). La RPC decide el permiso fino:
 * `portal.invite` para una invitación, `portal.login_link` (solo admin) para un
 * enlace de ingreso.
 */
export async function revokePortalToken(input: RevokePortalTokenInput): Promise<ActionResult<void>> {
  try {
    await requirePermission('portal.invite')
    const parsed = revokePortalTokenSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await revokePortalTokenRow(parsed.data)
    revalidatePortalViews()
    return success()
  } catch (err) {
    return failure(err, 'portal.revokePortalToken')
  }
}

/** Rechaza un pedido con motivo y devuelve el siguiente pendiente para seguir despachando. */
export async function rejectPortalRequest(input: RejectPortalRequestInput): Promise<ActionResult<{ nextRequestId: number | null }>> {
  try {
    await requirePermission('portal.review')
    const parsed = rejectPortalRequestSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await rejectPortalRequestRow(parsed.data)
    // El rechazo ya está hecho: si falla solo la lectura del siguiente, no se
    // devuelve error (reintentar daría "El pedido ya está resuelto"). Sin siguiente, la vista vuelve a la lista.
    const nextRequestId = await getNextPendingRequestId(parsed.data.requestId).catch((err: unknown) => {
      log.error('portal.rejectPortalRequest', 'no se pudo leer el siguiente pendiente', err)
      return null
    })
    revalidatePortalViews({ requests: true })
    return success({ nextRequestId })
  } catch (err) {
    return failure(err, 'portal.rejectPortalRequest')
  }
}

/** Revoca un vínculo cuenta-socio (motivo obligatorio). Corta el acceso al instante. */
export async function revokePortalLink(input: RevokePortalLinkInput): Promise<ActionResult<void>> {
  try {
    await requirePermission('portal.review')
    const parsed = revokePortalLinkSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await revokePortalLinkRow(parsed.data)
    revalidatePortalViews()
    return success()
  } catch (err) {
    return failure(err, 'portal.revokePortalLink')
  }
}

/** Bloquea o desbloquea una cuenta (motivo obligatorio). */
export async function setPortalAccountStatus(input: SetPortalAccountStatusInput): Promise<ActionResult<void>> {
  try {
    await requirePermission('portal.review')
    const parsed = setPortalAccountStatusSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await setPortalAccountStatusRow(parsed.data)
    revalidatePortalViews()
    return success()
  } catch (err) {
    return failure(err, 'portal.setPortalAccountStatus')
  }
}
