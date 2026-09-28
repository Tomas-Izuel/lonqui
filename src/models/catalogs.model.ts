import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import type { Category, Discipline, DisciplineWithCategories } from './types'

/**
 * Disciplinas y categorías: los datos que el club administra desde /ajustes
 * (CLAUDE.md: "son datos, no enums"). El padrón las consume para los selects
 * de alta/edición de un socio — por eso `listDisciplines` sin `includeInactive`
 * devuelve solo lo activo, que es lo único que un formulario nuevo puede
 * elegir.
 *
 * Nombres únicos case-insensitive: los índices `disciplines_name_key` y
 * `categories_name_key` son sobre `lower(btrim(name))` (S2). Acá se traduce la
 * violación (23505) a un error de negocio con el campo que la UI necesita.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const nameSchema = z
  .string()
  .trim()
  .min(2, 'El nombre tiene que tener al menos 2 caracteres')

export const createDisciplineSchema = z
  .object({
    name: nameSchema,
  })
  .strict()
export type CreateDisciplineInput = z.infer<typeof createDisciplineSchema>

export const updateDisciplineSchema = z
  .object({
    name: nameSchema,
  })
  .strict()
export type UpdateDisciplineInput = z.infer<typeof updateDisciplineSchema>

export const createCategorySchema = z
  .object({
    disciplineId: z.number().int().positive(),
    name: nameSchema,
  })
  .strict()
export type CreateCategoryInput = z.infer<typeof createCategorySchema>

export const updateCategorySchema = z
  .object({
    name: nameSchema,
  })
  .strict()
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>

export const reorderSchema = z
  .object({
    orderedIds: z.array(z.number().int().positive()).min(1),
  })
  .strict()
export type ReorderInput = z.infer<typeof reorderSchema>

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

type DisciplineRow = {
  id: number
  name: string
  is_active: boolean
  sort_order: number
}

type CategoryRow = DisciplineRow & { discipline_id: number }

function toDiscipline(row: DisciplineRow): Discipline {
  return { id: row.id, name: row.name, isActive: row.is_active, sortOrder: row.sort_order }
}

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    disciplineId: row.discipline_id,
    name: row.name,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }
}

function sortByOrderThenName<T extends { sortOrder: number; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
}

/**
 * Disciplinas con sus categorías anidadas, ordenadas por `sort_order, name`.
 *
 * `includeInactive` distingue las dos consultas del contrato: `/ajustes`
 * (`true`, ve y administra lo dado de baja) y los selects del padrón (`false`
 * por defecto, un alta nueva solo puede elegir entre lo activo). El filtro se
 * aplica en JS sobre una sola consulta con el embed de PostgREST: el volumen
 * (unas pocas decenas de categorías) no justifica dos round trips.
 */
export async function listDisciplines(options?: { includeInactive?: boolean }): Promise<DisciplineWithCategories[]> {
  const includeInactive = options?.includeInactive ?? false
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('disciplines')
    .select('id, name, is_active, sort_order, categories(id, discipline_id, name, is_active, sort_order)')

  if (error) throw error

  const disciplines = (data ?? [])
    .filter((row) => includeInactive || row.is_active)
    .map((row) => {
      const categories = sortByOrderThenName(
        (row.categories ?? [])
          .filter((category) => includeInactive || category.is_active)
          .map((category) => toCategory(category as CategoryRow)),
      )
      return { ...toDiscipline(row as DisciplineRow), categories }
    })

  return sortByOrderThenName(disciplines)
}

// -----------------------------------------------------------------------------
// Escrituras — disciplinas
// -----------------------------------------------------------------------------

/** `23505` de `disciplines_name_key`: ya existe una disciplina con ese nombre. */
function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505'
}

export async function createDiscipline(input: CreateDisciplineInput): Promise<Discipline> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('disciplines')
    .insert({ name: input.name })
    .select('id, name, is_active, sort_order')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError('Ya existe una disciplina con ese nombre', { field: 'name' })
    }
    throw error
  }

  return toDiscipline(data)
}

export async function updateDiscipline(id: number, patch: UpdateDisciplineInput): Promise<Discipline> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('disciplines')
    .update({ name: patch.name })
    .eq('id', id)
    .select('id, name, is_active, sort_order')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError('Ya existe una disciplina con ese nombre', { field: 'name' })
    }
    throw error
  }

  return toDiscipline(data)
}

export async function setDisciplineActive(id: number, isActive: boolean): Promise<Discipline> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('disciplines')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('id, name, is_active, sort_order')
    .single()

  if (error) throw error
  return toDiscipline(data)
}

/** Reordena asignando `sort_order` = posición en `orderedIds`. */
export async function reorderDisciplines(orderedIds: number[]): Promise<void> {
  const supabase = await createClient()
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('disciplines').update({ sort_order: index }).eq('id', id).then(({ error }) => {
        if (error) throw error
      }),
    ),
  )
}

// -----------------------------------------------------------------------------
// Escrituras — categorías
// -----------------------------------------------------------------------------

export async function createCategory(input: CreateCategoryInput): Promise<Category> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .insert({ discipline_id: input.disciplineId, name: input.name })
    .select('id, discipline_id, name, is_active, sort_order')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError('Ya existe una categoría con ese nombre', { field: 'name' })
    }
    throw error
  }

  return toCategory(data)
}

export async function updateCategory(id: number, patch: UpdateCategoryInput): Promise<Category> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .update({ name: patch.name })
    .eq('id', id)
    .select('id, discipline_id, name, is_active, sort_order')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError('Ya existe una categoría con ese nombre', { field: 'name' })
    }
    throw error
  }

  return toCategory(data)
}

/**
 * Da de alta o baja una categoría. Al desactivar, el conteo de socios activos
 * viaja en el resultado para que la UI avise ("hay 12 socios activos en esta
 * categoría"); la baja **no se impide** — es una decisión de la Comisión, no
 * del sistema (00-architecture.md §6.1, pregunta C6 pendiente).
 *
 * Revisión 3 (§13.2): `members.category_id` ya no existe (un socio puede
 * tener más de una categoría). El conteo es de INSCRIPCIONES ABIERTAS en
 * `member_categories` de socios activos, vía un embed `!inner` que filtra por
 * el `status` del socio embebido (mismo patrón que `searchMembers` de
 * `members.model.ts`: las dos condiciones —`category_id` y `status`— se
 * evalúan sobre la misma fila unida, no de forma independiente).
 */
export async function setCategoryActive(
  id: number,
  isActive: boolean,
): Promise<{ category: Category; activeMemberCount: number }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('categories')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('id, discipline_id, name, is_active, sort_order')
    .single()

  if (error) throw error
  const category = toCategory(data)

  if (isActive) {
    return { category, activeMemberCount: 0 }
  }

  const { count, error: countError } = await supabase
    .from('member_categories')
    .select('id, members!inner(status)', { count: 'exact', head: true })
    .eq('category_id', id)
    .is('left_on', null)
    .eq('members.status', 'active')

  if (countError) throw countError

  return { category, activeMemberCount: count ?? 0 }
}

/** Reordena las categorías de una disciplina. `orderedIds` tiene que ser de esa disciplina: no se valida acá (la UI arma la lista a partir de lo que ya trajo), pero el `.eq('discipline_id', ...)` evita tocar categorías de otra. */
export async function reorderCategories(disciplineId: number, orderedIds: number[]): Promise<void> {
  const supabase = await createClient()
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('categories')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('discipline_id', disciplineId)
        .then(({ error }) => {
          if (error) throw error
        }),
    ),
  )
}
