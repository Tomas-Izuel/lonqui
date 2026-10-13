'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/controllers/session.controller'
import { failure, invalid, success, type ActionResult } from '@/lib/action-result'
import { DomainError, zodToApiError } from '@/lib/errors'
import {
  buildCashReceiptPath,
  getCashReceiptPath,
  getCashReceiptUrlSchema,
  prepareCashReceiptUploadSchema,
  registerCashMovement as insertCashMovement,
  registerCashMovementSchema,
  voidCashMovement as voidCashMovementRow,
  voidCashMovementSchema,
} from '@/models/cash-movements.model'
import { listCashConcepts } from '@/models/cash-concepts.model'
import { listSponsorOptions } from '@/models/sponsors.model'
import { createSignedUploadUrl, getSignedUrl, objectExists } from '@/services/storage.service'
import type { IncomeFormData } from '@/models/types'

/**
 * Server Actions de otros ingresos. Mismo orden que `payments.actions.ts`:
 * permiso primero (por permiso, nunca por rol), después Zod, después el
 * modelo (que traduce Postgres a `DomainError`). Toda escritura revalida
 * `/caja`: el resumen del mes, la lista y la ficha del sponsor cambian juntos.
 */

export async function registerCashMovement(
  input: unknown,
): Promise<ActionResult<{ movementId: number; amountCents: number; alreadyRegistered: boolean }>> {
  try {
    await requirePermission('income.register')
    const parsed = registerCashMovementSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    // El comprobante se sube directo a Storage antes de este llamado: se
    // verifica que exista de verdad, no solo que el path tenga la forma.
    if (parsed.data.receiptPath && !(await objectExists(parsed.data.receiptPath))) {
      throw new DomainError('No encontramos el comprobante subido. Probá de nuevo.', { field: 'receiptPath' })
    }

    const result = await insertCashMovement(parsed.data)
    revalidatePath('/caja', 'layout')
    return success(result)
  } catch (err) {
    return failure(err, 'income.registerCashMovement')
  }
}

/** Solo `admin` (`income.void`): un ingreso mal cargado se anula con motivo, nunca se edita ni se borra. */
export async function voidCashMovement(input: unknown): Promise<ActionResult<void>> {
  try {
    await requirePermission('income.void')
    const parsed = voidCashMovementSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await voidCashMovementRow(parsed.data.movementId, parsed.data.reason)
    revalidatePath('/caja', 'layout')
    return success()
  } catch (err) {
    return failure(err, 'income.voidCashMovement')
  }
}

/** Paso 1 de la subida del comprobante: la ruta se arma acá, el browser sube directo a Storage. */
export async function prepareCashReceiptUpload(
  input: unknown,
): Promise<ActionResult<{ path: string; token: string; signedUrl: string }>> {
  try {
    await requirePermission('income.register')
    const parsed = prepareCashReceiptUploadSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const path = buildCashReceiptPath(parsed.data.batchId, parsed.data.mimeType)
    return success(await createSignedUploadUrl(path))
  } catch (err) {
    return failure(err, 'income.prepareCashReceiptUpload')
  }
}

/** URL firmada de 60 s. Null si el ingreso no tiene comprobante (o no existe). */
export async function getCashReceiptUrlAction(input: unknown): Promise<ActionResult<{ url: string | null }>> {
  try {
    await requirePermission('income.read')
    const parsed = getCashReceiptUrlSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const path = await getCashReceiptPath(parsed.data.movementId)
    if (!path) return success({ url: null })
    return success({ url: await getSignedUrl(path, 60) })
  } catch (err) {
    return failure(err, 'income.getCashReceiptUrlAction')
  }
}

/** Lo que necesita el formulario: solo conceptos y sponsors activos. */
export async function getIncomeFormData(): Promise<ActionResult<IncomeFormData>> {
  try {
    await requirePermission('income.register')
    const [concepts, sponsors] = await Promise.all([listCashConcepts(), listSponsorOptions()])
    return success({ concepts, sponsors })
  } catch (err) {
    return failure(err, 'income.getIncomeFormData')
  }
}
