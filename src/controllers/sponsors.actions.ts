'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/controllers/session.controller'
import { failure, invalid, success, type ActionResult } from '@/lib/action-result'
import { zodToApiError } from '@/lib/errors'
import {
  createSponsor as insertSponsor,
  createSponsorSchema,
  setSponsorActive as setSponsorActiveRow,
  setSponsorActiveSchema,
  updateSponsor as updateSponsorRow,
  updateSponsorSchema,
} from '@/models/sponsors.model'
import type { Sponsor } from '@/models/types'

/**
 * Server Actions de sponsors. Datos de contacto: nunca al log (la capa de
 * errores solo loguea el error de Postgres, no el input).
 */

export async function createSponsor(input: unknown): Promise<ActionResult<Sponsor>> {
  try {
    await requirePermission('income.register')
    const parsed = createSponsorSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const sponsor = await insertSponsor(parsed.data)
    revalidatePath('/caja', 'layout')
    return success(sponsor)
  } catch (err) {
    return failure(err, 'sponsors.createSponsor')
  }
}

export async function updateSponsor(id: number, input: unknown): Promise<ActionResult<Sponsor>> {
  try {
    await requirePermission('income.register')
    if (!Number.isInteger(id) || id <= 0) return invalid('El sponsor no es válido')
    const parsed = updateSponsorSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const sponsor = await updateSponsorRow(id, parsed.data)
    revalidatePath('/caja', 'layout')
    return success(sponsor)
  } catch (err) {
    return failure(err, 'sponsors.updateSponsor')
  }
}

/** Desactivar (con motivo) o reactivar: `sponsors.deactivate`, solo admin. */
export async function setSponsorActive(input: unknown): Promise<ActionResult<Sponsor>> {
  try {
    await requirePermission('sponsors.deactivate')
    const parsed = setSponsorActiveSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const sponsor = await setSponsorActiveRow(parsed.data.id, parsed.data.isActive, parsed.data.reason ?? null)
    revalidatePath('/caja', 'layout')
    return success(sponsor)
  } catch (err) {
    return failure(err, 'sponsors.setSponsorActive')
  }
}
