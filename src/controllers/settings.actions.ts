'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireRole, requirePermission } from '@/controllers/session.controller'
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
import {
  createCashConceptSchema,
  updateCashConceptSchema,
  createCashConcept as modelCreateCashConcept,
  updateCashConcept as modelUpdateCashConcept,
  setCashConceptActive as modelSetCashConceptActive,
  reorderCashConcepts as modelReorderCashConcepts,
} from '@/models/cash-concepts.model'
import { updateSettingsSchema, updateSettings as modelUpdateSettings } from '@/models/settings.model'
import type { CashConcept, Category, Discipline, Settings } from '@/models/types'

/**
 * Server Actions de /ajustes. `'use server'` en la primera línea (Next lo
 * exige para que un Client Component pueda importar este módulo).
 *
 * Todas: `requireRole('admin')` primero, Zod `.strict()` sobre la entrada (los
 * datos que manda el browser no se asumen bien formados aunque el formulario
 * ya haya validado), y `revalidatePath('/ajustes', 'layout')` en el camino feliz. El
 * catch de cada una traduce con `failure()`: una `DomainError` (por ejemplo,
 * el nombre duplicado que lanza el modelo por la unique violation) llega con
 * su mensaje y su `field`; cualquier otra cosa, genérico.
 *
 * `updateSettings` ya NO acepta `billingStartPeriod` (desde el pipeline
 * `2026-09-27-cuotas-pagos-panel`, D18): activar la facturación es
 * `activateBilling` en `billing.actions.ts`, con sus propias invariantes y su
 * propio permiso (`billing.configure`).
 */

const idSchema = z.number().int().positive()
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
    revalidatePath('/ajustes', 'layout')
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
    revalidatePath('/ajustes', 'layout')
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
    revalidatePath('/ajustes', 'layout')
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
    revalidatePath('/ajustes', 'layout')
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
    revalidatePath('/ajustes', 'layout')
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
    revalidatePath('/ajustes', 'layout')
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
    revalidatePath('/ajustes', 'layout')
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
    revalidatePath('/ajustes', 'layout')
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
    revalidatePath('/ajustes', 'layout')
    return success(settings)
  } catch (err) {
    return failure(err, 'settings.updateSettings')
  }
}

// -----------------------------------------------------------------------------
// Conceptos de caja (otros ingresos). Por PERMISO, no por rol (`settings.manage`).
// Revalidan /ajustes (donde se administran) y /caja entera (el formulario de
// ingreso y los filtros ofrecen los conceptos activos).
// -----------------------------------------------------------------------------

function revalidateConcepts() {
  revalidatePath('/ajustes', 'layout')
  revalidatePath('/caja', 'layout')
}

export async function createCashConcept(input: unknown): Promise<ActionResult<CashConcept>> {
  try {
    await requirePermission('settings.manage')
    const parsed = createCashConceptSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const concept = await modelCreateCashConcept(parsed.data)
    revalidateConcepts()
    return success(concept)
  } catch (err) {
    return failure(err, 'settings.createCashConcept')
  }
}

export async function updateCashConcept(id: number, input: unknown): Promise<ActionResult<CashConcept>> {
  try {
    await requirePermission('settings.manage')
    const parsedId = idSchema.safeParse(id)
    if (!parsedId.success) {
      const { body } = zodToApiError(parsedId.error)
      return invalid(body.error, body.field)
    }
    const parsed = updateCashConceptSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const concept = await modelUpdateCashConcept(parsedId.data, parsed.data)
    revalidateConcepts()
    return success(concept)
  } catch (err) {
    return failure(err, 'settings.updateCashConcept')
  }
}

export async function setCashConceptActive(id: number, isActive: boolean): Promise<ActionResult<CashConcept>> {
  try {
    await requirePermission('settings.manage')
    const parsed = activeToggleSchema.safeParse({ id, isActive })
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const concept = await modelSetCashConceptActive(parsed.data.id, parsed.data.isActive)
    revalidateConcepts()
    return success(concept)
  } catch (err) {
    return failure(err, 'settings.setCashConceptActive')
  }
}

export async function reorderCashConcepts(orderedIds: number[]): Promise<ActionResult<void>> {
  try {
    await requirePermission('settings.manage')
    const parsed = reorderSchema.safeParse({ orderedIds })
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    await modelReorderCashConcepts(parsed.data.orderedIds)
    revalidateConcepts()
    return success()
  } catch (err) {
    return failure(err, 'settings.reorderCashConcepts')
  }
}
