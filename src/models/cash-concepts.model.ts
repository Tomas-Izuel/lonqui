import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import type { CashConcept, CashDirection } from './types'

/**
 * Conceptos de caja (`cash_concepts`): datos que el club administra desde
 * /ajustes, no enums. Hoy solo de ingreso (`direction = 'income'`).
 *
 * El permiso (`settings.manage`) lo exige la action antes de llegar acá y la
 * RLS es la barrera real. Un concepto nunca se borra: se desactiva, y
 * desactivar NO se impide aunque tenga movimientos (los movimientos viejos
 * conservan su concepto; solo deja de ofrecerse en el formulario).
 *
 * Nombre único por sentido y case-insensitive (`cash_concepts_name_key` sobre
 * `(direction, lower(btrim(name)))`): la violación (23505) se traduce acá.
 */

const COLUMNS = 'id, direction, name, requires_sponsor, is_active, sort_order'

type CashConceptRow = {
  id: number
  direction: string
  name: string
  requires_sponsor: boolean
  is_active: boolean
  sort_order: number
}

function toCashConcept(row: CashConceptRow): CashConcept {
  return {
    id: row.id,
    direction: row.direction as CashDirection,
    name: row.name,
    requiresSponsor: row.requires_sponsor,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }
}

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const nameSchema = z
  .string('El nombre tiene que tener al menos 2 caracteres')
  .trim()
  .min(2, 'El nombre tiene que tener al menos 2 caracteres')
  .max(120, 'El nombre no puede tener más de 120 caracteres')

export const createCashConceptSchema = z
  .object({
    name: nameSchema,
    requiresSponsor: z.boolean().optional(),
  })
  .strict()
export type CreateCashConceptInput = z.infer<typeof createCashConceptSchema>

export const updateCashConceptSchema = z
  .object({
    name: nameSchema,
    requiresSponsor: z.boolean().optional(),
  })
  .strict()
export type UpdateCashConceptInput = z.infer<typeof updateCashConceptSchema>

/** Mismo criterio que `catalogs.model.ts`: lo que no se reconoce vuelve tal cual y el controller lo trata como falla interna. */
function translateConceptError(error: { code?: string; message?: string }): unknown {
  if (error.code === '23505') {
    return new DomainError('Ya existe un concepto con ese nombre', { field: 'name' })
  }
  if (error.code === '23514' && error.message?.includes('_name_check')) {
    return new DomainError('El nombre tiene que tener al menos 2 caracteres', { field: 'name' })
  }
  return error
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

/** Orden `sort_order, name`. Sin `includeInactive`, solo lo que el formulario puede ofrecer. */
export async function listCashConcepts(options: { includeInactive?: boolean } = {}): Promise<CashConcept[]> {
  const supabase = await createClient()
  let query = supabase.from('cash_concepts').select(COLUMNS)
  if (!options.includeInactive) query = query.eq('is_active', true)

  // Pocas decenas de filas por diseño: no hace falta paginar.
  const { data, error } = await query.order('sort_order', { ascending: true }).order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toCashConcept)
}

// -----------------------------------------------------------------------------
// Escrituras (cliente de sesión: el actor de la auditoría sale de auth.uid())
// -----------------------------------------------------------------------------

export async function createCashConcept(input: CreateCashConceptInput): Promise<CashConcept> {
  const supabase = await createClient()

  // El concepto nuevo va al final: max(sort_order) + 1. Una carrera entre dos
  // altas simultáneas puede repetir el orden, sin consecuencia (desempata por
  // nombre y el reorden lo reasigna).
  const { data: last, error: lastError } = await supabase
    .from('cash_concepts')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastError) throw lastError

  const { data, error } = await supabase
    .from('cash_concepts')
    .insert({
      name: input.name,
      requires_sponsor: input.requiresSponsor ?? false,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select(COLUMNS)
    .single()
  if (error) throw translateConceptError(error)

  return toCashConcept(data)
}

export async function updateCashConcept(id: number, patch: UpdateCashConceptInput): Promise<CashConcept> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cash_concepts')
    .update({
      name: patch.name,
      // `undefined` no se manda: no se pisa lo que el formulario no tocó.
      ...(patch.requiresSponsor !== undefined ? { requires_sponsor: patch.requiresSponsor } : {}),
    })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw translateConceptError(error)
  if (!data) throw new DomainError('El concepto no existe', { status: 404 })

  return toCashConcept(data)
}

/** Desactivar/reactivar. Nunca cuenta movimientos ni se impide. */
export async function setCashConceptActive(id: number, isActive: boolean): Promise<CashConcept> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cash_concepts')
    .update({ is_active: isActive })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new DomainError('El concepto no existe', { status: 404 })

  return toCashConcept(data)
}

/**
 * Reordena asignando `sort_order` = posición en `orderedIds`. NO es atómico:
 * son updates sueltos en paralelo (≤ ~10 filas). Si uno falla, los otros ya
 * se aplicaron y queda un orden mixto, sin consecuencia de integridad (el
 * usuario reintenta). Hacerlo atómico pediría una RPC (ver dev log).
 */
export async function reorderCashConcepts(orderedIds: number[]): Promise<void> {
  const supabase = await createClient()
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('cash_concepts')
        .update({ sort_order: index })
        .eq('id', id)
        .select('id')
        .then(({ data, error }) => {
          if (error) throw error
          // RLS o un id inexistente: el update "funciona" con 0 filas, sin error.
          if (!data || data.length !== 1) throw new DomainError('El concepto no existe', { status: 404 })
        }),
    ),
  )
}
