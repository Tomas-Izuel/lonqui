'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/controllers/session.controller'
import { success, failure, invalid, type ActionResult } from '@/lib/action-result'
import { zodToApiError } from '@/lib/errors'
import {
  createDisciplineSchema,
  updateDisciplineSchema,
  createCategorySchema,
  updateCategorySchema,
  reorderSchema,
  createDiscipline as modelCreateDiscipline,
  updateDiscipline as modelUpdateDiscipline,
  setDisciplineActive as modelSetDisciplineActive,
  reorderDisciplines as modelReorderDisciplines,
  createCategory as modelCreateCategory,
  updateCategory as modelUpdateCategory,
  setCategoryActive as modelSetCategoryActive,
  reorderCategories as modelReorderCategories,
} from '@/models/catalogs.model'
import { updateSettingsSchema, updateSettings as modelUpdateSettings } from '@/models/settings.model'
import type { Category, Discipline, Settings } from '@/models/types'

/**
 * Server Actions de /ajustes. `'use server'` en la primera línea (Next lo
 * exige para que un Client Component pueda importar este módulo).
 *
 * Todas: `requireRole('admin')` primero, Zod `.strict()` sobre la entrada (los
 * datos que manda el browser no se asumen bien formados aunque el formulario
 * ya haya validado), y `revalidatePath('/ajustes')` en el camino feliz. El
 * catch de cada una traduce con `failure()`: una `DomainError` (por ejemplo,
 * el nombre duplicado que lanza el modelo por la unique violation) llega con
 * su mensaje y su `field`; cualquier otra cosa, genérico.
 *
 * `updateSettings` ya NO acepta `billingStartPeriod` (desde el pipeline
 * `2026-09-27-cuotas-pagos-panel`, D18): activar la facturación es
 * `activateBilling` en `billing.actions.ts`, con sus propias invariantes y su
 * propio permiso (`billing.configure`).
 */

const activeToggleSchema = z.object({ id: z.number().int().positive(), isActive: z.boolean() }).strict()
const categoryReorderSchema = z
  .object({ disciplineId: z.number().int().positive(), orderedIds: z.array(z.number().int().positive()).min(1) })
  .strict()

export async function createDiscipline(input: unknown): Promise<ActionResult<Discipline>> {
  try {
    await requireRole('admin')
    const parsed = createDisciplineSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const discipline = await modelCreateDiscipline(parsed.data)
    revalidatePath('/ajustes')
    return success(discipline)
  } catch (err) {
    return failure(err, 'settings.createDiscipline')
  }
}

export async function updateDiscipline(id: number, input: unknown): Promise<ActionResult<Discipline>> {
  try {
    await requireRole('admin')
    const parsed = updateDisciplineSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const discipline = await modelUpdateDiscipline(id, parsed.data)
    revalidatePath('/ajustes')
    return success(discipline)
  } catch (err) {
    return failure(err, 'settings.updateDiscipline')
  }
}

export async function setDisciplineActive(id: number, isActive: boolean): Promise<ActionResult<Discipline>> {
  try {
    await requireRole('admin')
    const parsed = activeToggleSchema.safeParse({ id, isActive })
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const discipline = await modelSetDisciplineActive(parsed.data.id, parsed.data.isActive)
    revalidatePath('/ajustes')
    return success(discipline)
  } catch (err) {
    return failure(err, 'settings.setDisciplineActive')
  }
}

export async function reorderDisciplines(orderedIds: number[]): Promise<ActionResult<void>> {
  try {
    await requireRole('admin')
    const parsed = reorderSchema.safeParse({ orderedIds })
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await modelReorderDisciplines(parsed.data.orderedIds)
    revalidatePath('/ajustes')
    return success()
  } catch (err) {
    return failure(err, 'settings.reorderDisciplines')
  }
}

export async function createCategory(input: unknown): Promise<ActionResult<Category>> {
  try {
    await requireRole('admin')
    const parsed = createCategorySchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const category = await modelCreateCategory(parsed.data)
    revalidatePath('/ajustes')
    return success(category)
  } catch (err) {
    return failure(err, 'settings.createCategory')
  }
}

export async function updateCategory(id: number, input: unknown): Promise<ActionResult<Category>> {
  try {
    await requireRole('admin')
    const parsed = updateCategorySchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const category = await modelUpdateCategory(id, parsed.data)
    revalidatePath('/ajustes')
    return success(category)
  } catch (err) {
    return failure(err, 'settings.updateCategory')
  }
}

export async function setCategoryActive(
  id: number,
  isActive: boolean,
): Promise<ActionResult<{ category: Category; activeMemberCount: number }>> {
  try {
    await requireRole('admin')
    const parsed = activeToggleSchema.safeParse({ id, isActive })
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const result = await modelSetCategoryActive(parsed.data.id, parsed.data.isActive)
    revalidatePath('/ajustes')
    return success(result)
  } catch (err) {
    return failure(err, 'settings.setCategoryActive')
  }
}

export async function reorderCategories(disciplineId: number, orderedIds: number[]): Promise<ActionResult<void>> {
  try {
    await requireRole('admin')
    const parsed = categoryReorderSchema.safeParse({ disciplineId, orderedIds })
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await modelReorderCategories(parsed.data.disciplineId, parsed.data.orderedIds)
    revalidatePath('/ajustes')
    return success()
  } catch (err) {
    return failure(err, 'settings.reorderCategories')
  }
}

export async function updateSettings(input: unknown): Promise<ActionResult<Settings>> {
  try {
    await requireRole('admin')
    const parsed = updateSettingsSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const settings = await modelUpdateSettings(parsed.data)
    revalidatePath('/ajustes')
    return success(settings)
  } catch (err) {
    return failure(err, 'settings.updateSettings')
  }
}
