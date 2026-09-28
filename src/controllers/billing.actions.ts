'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/controllers/session.controller'
import { success, failure, invalid, type ActionResult } from '@/lib/action-result'
import { zodToApiError } from '@/lib/errors'
import { createFeePriceSchema, createFeePrice as modelCreateFeePrice } from '@/models/fee-prices.model'
import {
  activateBilling as modelActivateBilling,
  generatePendingFees as modelGeneratePendingFees,
  PartialBillingActivationError,
} from '@/models/billing.model'
import type { FeePrice } from '@/models/types'

/**
 * Server Actions de facturación: valores de cuota y activación/generación de
 * cuotas (`/ajustes`). `'use server'` en la primera línea.
 *
 * Todas: `requirePermission('billing.configure')` primero (T12/D20: por
 * permiso, no por rol — hoy solo `admin` lo tiene), Zod `.strict()` sobre la
 * entrada, y `revalidatePath('/', 'layout')` en el camino feliz (T11: una
 * cuota generada o un valor nuevo puede cambiar lo que muestran `/`,
 * `/socios`, `/cobranza` y `/ajustes` a la vez, así que se invalida el árbol
 * entero en vez de listar cada ruta).
 */

const activateBillingSchema = z
  .object({
    startPeriod: z.iso.date().refine((value) => value.endsWith('-01'), {
      message: 'Tiene que ser el primer día de un mes',
    }),
  })
  .strict()

export async function createFeePrice(input: unknown): Promise<ActionResult<FeePrice>> {
  try {
    await requirePermission('billing.configure')
    const parsed = createFeePriceSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const feePrice = await modelCreateFeePrice(parsed.data)
    revalidatePath('/', 'layout')
    return success(feePrice)
  } catch (err) {
    return failure(err, 'billing.createFeePrice')
  }
}

/**
 * Activa la facturación desde `startPeriod` (D18). Si el mes elegido es el
 * actual, genera de una las cuotas pendientes y `generated` cuenta cuántas;
 * si es futuro, las genera el cron el día 1 y `generated` queda en 0.
 */
export async function activateBilling(input: unknown): Promise<ActionResult<{ generated: number }>> {
  try {
    await requirePermission('billing.configure')
    const parsed = activateBillingSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const result = await modelActivateBilling(parsed.data.startPeriod)
    revalidatePath('/', 'layout')
    return success(result)
  } catch (err) {
    // La activación en sí quedó hecha aunque la generación posterior haya
    // fallado (03-review.md, MINOR 3): revalida igual para que `/ajustes`
    // deje de mostrar "Activar cuotas" y pase a ofrecer "Reintentar".
    if (err instanceof PartialBillingActivationError) {
      revalidatePath('/', 'layout')
    }
    return failure(err, 'billing.activateBilling')
  }
}

/** "Generar cuotas ahora" / "Reintentar". Corre todos los períodos pendientes hasta el actual. */
export async function generatePendingFees(): Promise<ActionResult<{ generated: number }>> {
  try {
    await requirePermission('billing.configure')
    const generated = await modelGeneratePendingFees()
    revalidatePath('/', 'layout')
    return success({ generated })
  } catch (err) {
    return failure(err, 'billing.generatePendingFees')
  }
}
