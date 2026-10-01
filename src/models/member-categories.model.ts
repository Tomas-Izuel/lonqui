import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isRawPostgresMessage } from '@/models/pg-errors'
import { DomainError } from '@/lib/errors'
import { toClubDate } from '@/lib/dates'
import type { LeaveCategoryInput, MemberCategoryMembership, MemberCategoryRef, SetMemberCategoriesInput } from '@/models/types'

/**
 * Pertenencia a categorías (Revisión 3 del pipeline 2026-09-27, §13.2): un
 * socio puede jugar más de un deporte. Cada inscripción es una fila-intervalo
 * (`joined_on`/`left_on`) en `member_categories`; nada se borra, dejar un
 * deporte es cerrar la fila, nunca un `DELETE` ni un `UPDATE` de la categoría.
 *
 * `set_member_categories` (RPC `SECURITY INVOKER`, migración
 * `20260927125000_member_categories.sql`) es la única escritura en bloque:
 * cierra las inscripciones abiertas que no están en la lista nueva y abre las
 * que faltan, todo en una transacción, y valida "una categoría por deporte"
 * server-side — el mismo mensaje que acá se traduce a `DomainError`.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

/**
 * Estructura únicamente: existencia, actividad de la categoría y "una por
 * disciplina" los valida la base (el trigger de inserción y la RPC) — acá solo
 * se descarta lo que Zod puede saber sin consultar Postgres (ids repetidos,
 * formato de fecha). `members.actions.ts` corre además `assertCategorySelection`
 * antes del alta, para no crear un socio con una selección inválida.
 */
export const setMemberCategoriesSchema = z
  .object({
    memberId: z.number().int().positive(),
    categoryIds: z
      .array(
        z
          .number('Elegí una categoría de la lista')
          .int('Elegí una categoría de la lista')
          .positive('Elegí una categoría de la lista'),
      )
      .max(20, 'Demasiadas categorías: elegí hasta 20')
      .refine((ids) => new Set(ids).size === ids.length, 'Elegí cada categoría una sola vez'),
    effectiveOn: z.iso.date('La fecha no es válida').optional(),
  })
  .strict()
  .refine((data) => !data.effectiveOn || data.effectiveOn <= toClubDate(), {
    message: 'La fecha no puede ser futura',
    path: ['effectiveOn'],
  })

export const leaveCategorySchema = z
  .object({
    membershipId: z.number().int().positive(),
    leftOn: z.iso.date('La fecha no es válida'),
    reason: z.string().trim().max(500, 'El motivo no puede tener más de 500 caracteres').nullish(),
  })
  .strict()
  .refine((data) => data.leftOn <= toClubDate(), {
    message: 'La fecha no puede ser futura',
    path: ['leftOn'],
  })

export const changeCategorySchema = z
  .object({
    membershipId: z.number().int().positive(),
    newCategoryId: z
      .number('Elegí la categoría nueva')
      .int('Elegí la categoría nueva')
      .positive('Elegí la categoría nueva'),
    effectiveOn: z.iso.date('La fecha no es válida'),
  })
  .strict()
  .refine((data) => data.effectiveOn <= toClubDate(), {
    message: 'La fecha no puede ser futura',
    path: ['effectiveOn'],
  })
export type ChangeCategoryInput = z.infer<typeof changeCategorySchema>

// -----------------------------------------------------------------------------
// Traducción de errores de Postgres (RPC y triggers de `member_categories`)
// -----------------------------------------------------------------------------

const ONE_CATEGORY_PER_DISCIPLINE = 'Elegí una sola categoría por deporte'
const CATEGORY_INACTIVE_MARKER = 'La categoría está dada de baja'
const CATEGORY_MISSING_MARKER = 'La categoría no existe'
const ALREADY_ENROLLED_MARKER = 'Ya está inscripto en'
const LEFT_BEFORE_JOINED_CONSTRAINT = 'member_categories_left_after_joined'

/** Mensajes de `set_member_categories` y del trigger `member_categories_insert_guard`, siempre con `field: 'categoryIds'` (la selección en bloque). */
function translateSetCategoriesError(error: PostgrestError): unknown {
  if (error.code === '23514' && error.message.includes(ONE_CATEGORY_PER_DISCIPLINE)) {
    return new DomainError(ONE_CATEGORY_PER_DISCIPLINE, { field: 'categoryIds' })
  }
  if (error.code === '23514' && error.message.includes(CATEGORY_INACTIVE_MARKER)) {
    return new DomainError('Una de las categorías elegidas está dada de baja', { field: 'categoryIds' })
  }
  if (error.code === '23503' && error.message.includes(CATEGORY_MISSING_MARKER)) {
    return new DomainError('Una de las categorías elegidas no existe', { field: 'categoryIds' })
  }
  if (error.code === '23514' && error.message.includes('anterior a la fecha de alta')) {
    return new DomainError(error.message, { field: 'effectiveOn' })
  }
  if (error.code === '23514' && error.message.includes('futura')) {
    return new DomainError(error.message, { field: 'effectiveOn' })
  }
  if (error.code === '23514' && error.message.includes(ALREADY_ENROLLED_MARKER)) {
    return new DomainError(error.message, { field: 'categoryIds' })
  }
  if (error.code === '23503' && error.message.includes('El socio no existe')) {
    return new DomainError('El socio no existe', { status: 404 })
  }
  if (error.code === '42501') {
    return new DomainError('No tenés permiso para modificar socios')
  }
  return error
}

/** Mensajes de `member_categories_update_guard` (cerrar una inscripción). */
function translateCloseError(error: PostgrestError): unknown {
  if (error.code === '23514' && error.message.includes(LEFT_BEFORE_JOINED_CONSTRAINT)) {
    return new DomainError('La fecha de salida no puede ser anterior a la de ingreso a la categoría', {
      field: 'leftOn',
    })
  }
  // Mensajes de los triggers (ya redactados para el usuario), nunca el texto crudo de una constraint.
  if (error.code === '23514' && !isRawPostgresMessage(error.message)) {
    return new DomainError(error.message, { field: 'leftOn' })
  }
  return error
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

type MembershipRow = {
  id: number
  joined_on: string
  left_on: string | null
  left_reason: string | null
  left_by: string | null
  categories: { id: number; name: string; discipline_id: number; disciplines: { name: string } | null } | null
}

const MEMBERSHIP_SELECT =
  'id, joined_on, left_on, left_reason, left_by, categories(id, name, discipline_id, disciplines(name))'

/**
 * Toda la historia del socio en `member_categories` (abiertas y cerradas),
 * de la más nueva a la más vieja. Resuelve `leftByName` contra `app_users` en
 * una sola consulta extra, nunca una por fila (mismo patrón que
 * `getMemberStatusHistory` de `members.model.ts`).
 */
export async function listMemberships(memberId: number): Promise<MemberCategoryMembership[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('member_categories')
    .select(MEMBERSHIP_SELECT)
    .eq('member_id', memberId)
    .order('joined_on', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as unknown as MembershipRow[]
  const actorIds = Array.from(new Set(rows.map((r) => r.left_by).filter((id): id is string => id != null)))

  const nameByActor = new Map<string, string>()
  if (actorIds.length > 0) {
    // Solo lo que la RLS de app_users deja ver a este usuario (Minor del
    // slice 1, mismo criterio que la historia de alta/baja).
    const { data: actors, error: actorsError } = await supabase
      .from('app_users')
      .select('user_id, display_name')
      .in('user_id', actorIds)
    if (actorsError) throw actorsError
    for (const actor of actors ?? []) nameByActor.set(actor.user_id, actor.display_name)
  }

  return rows.map((r) => ({
    id: r.id,
    categoryId: r.categories?.id ?? 0,
    categoryName: r.categories?.name ?? '',
    disciplineId: r.categories?.discipline_id ?? 0,
    disciplineName: r.categories?.disciplines?.name ?? '',
    joinedOn: r.joined_on,
    leftOn: r.left_on,
    leftReason: r.left_reason,
    leftByName: r.left_by ? (nameByActor.get(r.left_by) ?? null) : null,
  }))
}

/** Las abiertas de `listMemberships`, ya con la forma reducida de `MemberCategoryRef` para `MemberDetail.categories`. */
export function openMemberships(history: MemberCategoryMembership[]): MemberCategoryRef[] {
  return history
    .filter((m) => m.leftOn === null)
    .map((m) => ({
      categoryId: m.categoryId,
      categoryName: m.categoryName,
      disciplineId: m.disciplineId,
      disciplineName: m.disciplineName,
    }))
}

// -----------------------------------------------------------------------------
// Validación previa (alta): no crear un socio con una selección inválida
// -----------------------------------------------------------------------------

type CategoryRow = { id: number; discipline_id: number; is_active: boolean }

/**
 * Chequeo previo al alta (03-review.md, mismo espíritu que `memberDniExists`):
 * la RPC ya valida existencia, actividad y "una por disciplina", pero un socio
 * recién insertado con una selección inválida quedaría cargado sin deportes y
 * con un `DomainError` confuso ("se cargó pero no sus deportes"). Acá se corta
 * ANTES del insert, con el mismo texto que traduce `translateSetCategoriesError`
 * para las dos formas de fallar en la edición.
 */
export async function assertCategorySelection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryIds: number[],
): Promise<void> {
  if (categoryIds.length === 0) return

  const { data, error } = await supabase
    .from('categories')
    .select('id, discipline_id, is_active')
    .in('id', categoryIds)
  if (error) throw error

  const byId = new Map((data ?? []).map((c: CategoryRow) => [c.id, c]))
  for (const id of categoryIds) {
    const category = byId.get(id)
    if (!category) throw new DomainError('Una de las categorías elegidas no existe', { field: 'categoryIds' })
    if (!category.is_active) {
      throw new DomainError('Una de las categorías elegidas está dada de baja', { field: 'categoryIds' })
    }
  }

  const disciplineIds = categoryIds.map((id) => byId.get(id)!.discipline_id)
  if (new Set(disciplineIds).size !== disciplineIds.length) {
    throw new DomainError(ONE_CATEGORY_PER_DISCIPLINE, { field: 'categoryIds' })
  }
}

// -----------------------------------------------------------------------------
// Escrituras
// -----------------------------------------------------------------------------

/**
 * Cambio en bloque (alta y edición, `set_member_categories`): cierra lo que no
 * está en `categoryIds` y abre lo que falta, con `effectiveOn` (default hoy en
 * la base). La alta la llama con `effectiveOn = joinedOn` del socio; la
 * edición, con "a partir de" (hoy por default).
 */
export async function setMemberCategories(input: SetMemberCategoriesInput): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.rpc('set_member_categories', {
    target_member_id: input.memberId,
    category_ids: input.categoryIds,
    effective_on: input.effectiveOn ?? undefined,
  })
  if (error) throw translateSetCategoriesError(error)
}

/**
 * "Dar de baja de <categoría>" desde la ficha: UPDATE de `left_on`/`left_reason`
 * de una inscripción abierta puntual (no toca las demás). `.is('left_on',
 * null)` en el `where` más `.select().maybeSingle()` distinguen "no existe o
 * ya está cerrada" (0 filas) de un cierre real, sin depender del mensaje del
 * trigger para ese caso (Minor 11 del review, mismo patrón que `updateMember`).
 * Devuelve el `memberId` para que la action revalide su ficha.
 */
export async function closeMembership(input: LeaveCategoryInput): Promise<{ memberId: number }> {
  const supabase = await createClient()

  const reason = input.reason?.trim() || null
  const { data, error } = await supabase
    .from('member_categories')
    .update({ left_on: input.leftOn, left_reason: reason })
    .eq('id', input.membershipId)
    .is('left_on', null)
    .select('member_id')
    .maybeSingle()

  if (error) throw translateCloseError(error)
  if (!data) throw new DomainError('Esa inscripción no existe o ya está cerrada')
  return { memberId: data.member_id }
}

/**
 * "Cambiar de categoría" (el ascenso 5ta → 6ta): cierra la inscripción actual
 * y abre `newCategoryId` en la misma disciplina y la misma fecha, con
 * `set_member_categories` reemplazando esa entrada en la lista de abiertas —
 * el mismo camino que la edición en bloque, no un UPDATE directo de
 * `category_id` (la columna es inmutable).
 */
export async function changeCategory(input: ChangeCategoryInput): Promise<{ memberId: number }> {
  const supabase = await createClient()

  const { data: membership, error } = await supabase
    .from('member_categories')
    .select('member_id, category_id, left_on, categories(discipline_id)')
    .eq('id', input.membershipId)
    .maybeSingle()
  if (error) throw error
  if (!membership || membership.left_on !== null) {
    throw new DomainError('Esa inscripción no existe o ya está cerrada')
  }

  await assertCategorySelection(supabase, [input.newCategoryId])

  const oldDisciplineId = (membership.categories as unknown as { discipline_id: number } | null)?.discipline_id ?? null
  if (oldDisciplineId != null) {
    const { data: newCategory, error: newCategoryError } = await supabase
      .from('categories')
      .select('discipline_id')
      .eq('id', input.newCategoryId)
      .maybeSingle()
    if (newCategoryError) throw newCategoryError
    if (newCategory && newCategory.discipline_id !== oldDisciplineId) {
      throw new DomainError('Elegí una categoría del mismo deporte', { field: 'newCategoryId' })
    }
  }

  const { data: open, error: openError } = await supabase
    .from('member_categories')
    .select('category_id')
    .eq('member_id', membership.member_id)
    .is('left_on', null)
  if (openError) throw openError

  // Reemplaza puntualmente la categoría de ESTA inscripción por la nueva; el
  // resto de las disciplinas abiertas del socio queda intacto.
  const finalIds = (open ?? []).map((r) => r.category_id).filter((categoryId) => categoryId !== membership.category_id)
  finalIds.push(input.newCategoryId)

  await setMemberCategories({ memberId: membership.member_id, categoryIds: finalIds, effectiveOn: input.effectiveOn })
  return { memberId: membership.member_id }
}
