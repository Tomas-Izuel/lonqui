'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/controllers/session.controller'
import { failure, invalid, success, type ActionResult } from '@/lib/action-result'
import { DomainError, zodToApiError } from '@/lib/errors'
import {
  attachReceipt as attachReceiptRow,
  attachReceiptSchema,
  buildReceiptPath,
  getMonthPaymentsPage as getMonthPaymentsPageRows,
  getMonthPaymentsPageSchema,
  getPaymentFormDataSchema,
  getReceiptPath,
  getReceiptUrlSchema,
  prepareReceiptUploadSchema,
  registerPayment as insertPaymentBatch,
  registerPaymentSchema,
  voidPayment as voidPaymentRow,
  voidPaymentSchema,
} from '@/models/payments.model'
import { createOpeningBalanceSchema, createOpeningBalance as insertOpeningBalance, voidFeeSchema, voidFee as voidFeeRow } from '@/models/fees.model'
import { getMemberAccounts } from '@/models/accounts.model'
import { getFamilyGroup } from '@/models/family-groups.model'
import { getBillingStatus } from '@/models/billing.model'
import { createSignedUploadUrl, getSignedUrl, objectExists } from '@/services/storage.service'
import type { Page, PaymentFormData, PaymentListItem } from '@/models/types'

/**
 * Server Actions de pagos y cargos. Misma convención que `members.actions.ts`
 * (F1/F2 las consumen tal cual): `requirePermission(...)` primero (T12: por
 * permiso, nunca por rol), después `schema.safeParse`, después el modelo (que
 * traduce Postgres a `DomainError`), y `revalidatePath('/', 'layout')` en toda
 * escritura (T11) — el estado de cuenta se muestra en el padrón, la ficha, la
 * cobranza y el panel a la vez, así que revalidar una sola ruta se queda corto.
 */

// -----------------------------------------------------------------------------
// Registrar pagos
// -----------------------------------------------------------------------------

export async function registerPayment(
  input: unknown,
): Promise<ActionResult<{ paymentIds: number[]; totalCents: number; alreadyRegistered: boolean }>> {
  try {
    await requirePermission('payments.register')
    const parsed = registerPaymentSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    // Un cobro de grupo familiar: cada memberId de items tiene que ser un
    // integrante real del grupo (activo o no), nunca un id ajeno colado a mano.
    if (parsed.data.familyGroupId != null) {
      const group = await getFamilyGroup(parsed.data.familyGroupId)
      if (!group) throw new DomainError('El grupo familiar no existe', { field: 'familyGroupId' })

      const memberIds = new Set(group.members.map((member) => member.id))
      const outsider = parsed.data.items.find((item) => !memberIds.has(item.memberId))
      if (outsider) {
        throw new DomainError('Todos los pagos tienen que ser de integrantes del grupo familiar', {
          field: 'items',
        })
      }
    }

    // El comprobante se sube directo a Storage antes de este llamado: se
    // verifica que exista de verdad, no solo que el path tenga la forma
    // correcta (un path inventado a mano no pasa de acá).
    if (parsed.data.receiptPath && !(await objectExists(parsed.data.receiptPath))) {
      throw new DomainError('No encontramos el comprobante subido. Probá de nuevo.', { field: 'receiptPath' })
    }

    const result = await insertPaymentBatch(parsed.data)
    revalidatePath('/', 'layout')
    return success(result)
  } catch (err) {
    return failure(err, 'payments.registerPayment')
  }
}

export async function voidPayment(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('payments.void')
    const parsed = voidPaymentSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await voidPaymentRow(parsed.data.paymentId, parsed.data.reason)
    revalidatePath('/', 'layout')
    return success()
  } catch (err) {
    return failure(err, 'payments.voidPayment')
  }
}

// -----------------------------------------------------------------------------
// Comprobantes (mismo patrón de dos pasos que el apto físico, D11)
// -----------------------------------------------------------------------------

export async function prepareReceiptUpload(
  input: unknown,
): Promise<ActionResult<{ path: string; token: string; signedUrl: string }>> {
  try {
    await requirePermission('payments.register')
    const parsed = prepareReceiptUploadSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const path = buildReceiptPath(parsed.data.memberId, parsed.data.mimeType)
    const result = await createSignedUploadUrl(path)
    return success(result)
  } catch (err) {
    return failure(err, 'payments.prepareReceiptUpload')
  }
}

/** Adjunta un comprobante a un pago que ya se registró sin uno (el otro camino es mandarlo en `registerPayment`). */
export async function attachReceipt(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('payments.register')
    const parsed = attachReceiptSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    if (!(await objectExists(parsed.data.path))) {
      throw new DomainError('No encontramos el comprobante subido. Probá de nuevo.')
    }

    await attachReceiptRow(parsed.data.paymentId, parsed.data.path, parsed.data.filename ?? null)
    revalidatePath('/', 'layout')
    return success()
  } catch (err) {
    return failure(err, 'payments.attachReceipt')
  }
}

/** URL firmada de 60 s para ver/descargar un comprobante. Null si el pago no tiene uno cargado. */
export async function getReceiptUrlAction(input: unknown): Promise<ActionResult<{ url: string | null }>> {
  try {
    await requirePermission('payments.read')
    const parsed = getReceiptUrlSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const path = await getReceiptPath(parsed.data.paymentId)
    if (!path) return success({ url: null })

    const url = await getSignedUrl(path, 60)
    return success({ url })
  } catch (err) {
    return failure(err, 'payments.getReceiptUrlAction')
  }
}

// -----------------------------------------------------------------------------
// Saldo de arranque y anulación de cargos
// -----------------------------------------------------------------------------

export async function createOpeningBalance(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    await requirePermission('payments.register')
    const parsed = createOpeningBalanceSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const fee = await insertOpeningBalance(parsed.data)
    revalidatePath('/', 'layout')
    return success({ id: fee.id })
  } catch (err) {
    return failure(err, 'payments.createOpeningBalance')
  }
}

/**
 * Anula un cargo. Solo `admin` (`payments.void`): la policy de UPDATE de
 * `fees` es estricta (D33, review B2) y `voidFee` (modelo) ya traduce un
 * UPDATE de 0 filas a un mensaje explícito en vez de un éxito mudo.
 */
export async function voidFee(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('payments.void')
    const parsed = voidFeeSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await voidFeeRow(parsed.data.feeId, parsed.data.reason)
    revalidatePath('/', 'layout')
    return success()
  } catch (err) {
    return failure(err, 'payments.voidFee')
  }
}

// -----------------------------------------------------------------------------
// Datos para abrir el formulario de pago
// -----------------------------------------------------------------------------

/**
 * Lo que necesita el formulario de pago: la cuenta de un socio o de todo un
 * grupo familiar (siempre en una sola RPC vía `accounts.model`, nunca N), más
 * el estado de la facturación (para precargar el mes y avisar si no está
 * activa). Con los dos campos, `familyGroupId` decide quiénes aparecen y
 * `memberId` solo el orden (el socio desde el que se abrió el formulario va
 * primero).
 */
export async function getPaymentFormData(input: unknown): Promise<ActionResult<PaymentFormData>> {
  try {
    await requirePermission('payments.register')
    const parsed = getPaymentFormDataSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const billing = await getBillingStatus()

    if (parsed.data.familyGroupId != null) {
      const group = await getFamilyGroup(parsed.data.familyGroupId)
      if (!group) throw new DomainError('El grupo familiar no existe', { field: 'familyGroupId' })

      const accounts = await getMemberAccounts(group.members.map((member) => member.id))
      const sourceMemberId = parsed.data.memberId
      const ordered =
        sourceMemberId != null
          ? [...accounts].sort((a, b) =>
              a.memberId === sourceMemberId ? -1 : b.memberId === sourceMemberId ? 1 : 0,
            )
          : accounts

      return success({ members: ordered, familyGroup: group, billing })
    }

    const accounts = await getMemberAccounts([parsed.data.memberId as number])
    if (accounts.length === 0) {
      throw new DomainError('El socio no existe', { field: 'memberId' })
    }

    return success({ members: accounts, familyGroup: null, billing })
  } catch (err) {
    return failure(err, 'payments.getPaymentFormData')
  }
}

// -----------------------------------------------------------------------------
// "Ver más" de los pagos del mes (mismo patrón que `loadMoreMembers`)
// -----------------------------------------------------------------------------

export async function loadMoreMonthPayments(input: unknown): Promise<ActionResult<Page<PaymentListItem>>> {
  try {
    await requirePermission('payments.read')
    const parsed = getMonthPaymentsPageSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const page = await getMonthPaymentsPageRows(parsed.data.period, parsed.data.cursor ?? null)
    return success(page)
  } catch (err) {
    return failure(err, 'payments.loadMoreMonthPayments')
  }
}
