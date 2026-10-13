import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError, PermissionError } from '@/lib/errors'
import type { Sponsor, SponsorOption, SponsorSummary } from '@/models/types'

/**
 * Sponsors (`sponsors`): catálogo, NO socios. Nunca se borran: se desactivan
 * con motivo. Contacto, teléfono y email son datos personales (Ley 25.326):
 * nada de esto va a un log.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

/** Texto opcional: se recorta y el vacío se guarda como null. */
function optionalText(max: number, message: string) {
  return z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === '' ? null : value))
    .nullish()
}

const sponsorFields = {
  name: z
    .string('Ingresá el nombre del sponsor')
    .trim()
    .min(2, 'El nombre tiene que tener al menos 2 caracteres')
    .max(120, 'El nombre no puede tener más de 120 caracteres'),
  contactName: optionalText(120, 'El contacto no puede tener más de 120 caracteres'),
  phone: optionalText(40, 'El teléfono no puede tener más de 40 caracteres'),
  email: z
    .union([z.literal(''), z.email('El email no es válido')])
    .transform((value) => (value === '' ? null : value.toLowerCase()))
    .nullish(),
  notes: optionalText(1000, 'Las notas no pueden tener más de 1000 caracteres'),
}

export const createSponsorSchema = z.object(sponsorFields).strict()
export type CreateSponsorInput = z.infer<typeof createSponsorSchema>

/** Mismos campos; solo el nombre es obligatorio (el resto, si no viene, no se toca). */
export const updateSponsorSchema = z.object(sponsorFields).strict()
export type UpdateSponsorInput = z.infer<typeof updateSponsorSchema>

export const setSponsorActiveSchema = z
  .object({
    id: z.number().int().positive(),
    isActive: z.boolean(),
    reason: z.string().trim().max(500, 'El motivo no puede tener más de 500 caracteres').nullish(),
  })
  .strict()
  .refine((data) => data.isActive || (data.reason ?? '').length >= 3, {
    message: 'El motivo tiene que tener al menos 3 caracteres',
    path: ['reason'],
  })
export type SetSponsorActiveInput = z.infer<typeof setSponsorActiveSchema>

// -----------------------------------------------------------------------------
// Mapeo
// -----------------------------------------------------------------------------

type SponsorRow = {
  id: number
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  is_active: boolean
  deactivated_at: string | null
  deactivation_reason: string | null
  created_at: string
}

const SPONSOR_SELECT =
  'id, name, contact_name, phone, email, notes, is_active, deactivated_at, deactivation_reason, created_at'

function mapSponsor(row: SponsorRow): Sponsor {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at,
    deactivationReason: row.deactivation_reason,
    createdAt: row.created_at,
  }
}

type SponsorSummaryRow = {
  sponsor_id: number
  name: string
  is_active: boolean
  contact_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  deactivated_at: string | null
  deactivation_reason: string | null
  year_total_cents: number
  all_time_total_cents: number
  contributions_count: number
  last_contribution_on: string | null
  last_contribution_cents: number | null
}

function mapSummary(row: SponsorSummaryRow): SponsorSummary {
  return {
    id: row.sponsor_id,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at,
    deactivationReason: row.deactivation_reason,
    yearTotalCents: row.year_total_cents,
    allTimeTotalCents: row.all_time_total_cents,
    contributionsCount: row.contributions_count,
    lastContributionOn: row.last_contribution_on,
    lastContributionCents: row.last_contribution_cents,
  }
}

// -----------------------------------------------------------------------------
// Errores
// -----------------------------------------------------------------------------

const NAME_UNIQUE_INDEX = 'sponsors_name_key'

/** Escapa `%`, `_` y `\` para usar un nombre literal en `ilike`. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Un nombre repetido: si el que ya existe está desactivado, el mensaje dice
 * dónde reactivarlo (si no, la persona crea "otro" sponsor y lo duplica).
 */
async function translateNameConflict(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
): Promise<DomainError> {
  const { data } = await supabase
    .from('sponsors')
    .select('is_active')
    .ilike('name', escapeLike(name.trim()))
    .limit(1)
    .maybeSingle()

  const message =
    data && !data.is_active
      ? 'Ya existe un sponsor con ese nombre y está desactivado: reactivalo desde Sponsors'
      : 'Ya existe un sponsor con ese nombre'
  return new DomainError(message, { field: 'name' })
}

function isNameConflict(error: PostgrestError): boolean {
  return error.code === '23505' && error.message.includes(NAME_UNIQUE_INDEX)
}

function translateGuardError(error: PostgrestError): unknown {
  if (error.code === '42501') return new PermissionError()
  if (error.code === '23514' && error.message === 'Para desactivar un sponsor hace falta un motivo') {
    return new DomainError(error.message, { field: 'reason' })
  }
  if (error.code === '23514' && error.message === 'El estado del sponsor se cambia desactivándolo o reactivándolo') {
    return new DomainError(error.message)
  }
  if (error.code === '23514' && error.message.includes('sponsors_deactivation_triad')) {
    return new DomainError('El motivo tiene que tener al menos 3 caracteres', { field: 'reason' })
  }
  return error
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

/** Opciones del buscador del formulario y los filtros. Por defecto, solo activos. */
export async function listSponsorOptions(options: { includeInactive?: boolean } = {}): Promise<SponsorOption[]> {
  const supabase = await createClient()

  let query = supabase.from('sponsors').select('id, name, is_active')
  if (!options.includeInactive) query = query.eq('is_active', true)

  // Un club tiene decenas de sponsors, no miles; el techo evita el corte mudo de PostgREST.
  const { data, error } = await query.order('name', { ascending: true }).limit(1000)
  if (error) throw error

  return (data ?? []).map((row) => ({ id: row.id, name: row.name, isActive: row.is_active }))
}

/** Sponsors con lo aportado en el año (calendario, por `occurred_on`; el del club si se omite). Una sola RPC. */
export async function listSponsorSummaries(year?: number): Promise<SponsorSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('sponsor_summaries', year !== undefined ? { target_year: year } : {})
    .overrideTypes<SponsorSummaryRow[], { merge: false }>()
  if (error) throw error
  return (data ?? []).map(mapSummary)
}

export async function getSponsorSummary(id: number): Promise<SponsorSummary | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('sponsor_summaries', { target_sponsor_id: id })
    .overrideTypes<SponsorSummaryRow[], { merge: false }>()
  if (error) throw error
  const row = (data ?? [])[0]
  return row ? mapSummary(row) : null
}

// -----------------------------------------------------------------------------
// Escrituras (siempre con el cliente de sesión: el actor sale de auth.uid())
// -----------------------------------------------------------------------------

export async function createSponsor(input: CreateSponsorInput): Promise<Sponsor> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('sponsors')
    .insert({
      name: input.name,
      contact_name: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
    })
    .select(SPONSOR_SELECT)
    .single()

  if (error) {
    if (isNameConflict(error)) throw await translateNameConflict(supabase, input.name)
    throw error
  }
  return mapSponsor(data)
}

/** Edita datos de contacto. No cambia el estado (eso es `setSponsorActive`). */
export async function updateSponsor(id: number, patch: UpdateSponsorInput): Promise<Sponsor> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('sponsors')
    .update({
      name: patch.name,
      // undefined = no se toca; null (campo vaciado) = se limpia.
      ...(patch.contactName !== undefined && { contact_name: patch.contactName }),
      ...(patch.phone !== undefined && { phone: patch.phone }),
      ...(patch.email !== undefined && { email: patch.email }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
    })
    .eq('id', id)
    .select(SPONSOR_SELECT)
    .maybeSingle()

  if (error) {
    if (isNameConflict(error)) throw await translateNameConflict(supabase, patch.name)
    throw translateGuardError(error)
  }
  if (!data) throw new DomainError('El sponsor no existe', { status: 404 })
  return mapSponsor(data)
}

/**
 * Desactiva (con motivo) o reactiva. La tríada fecha/autor/motivo la fija el
 * trigger `sponsors_update_guard`; acá solo se manda el motivo, y al
 * reactivar se manda null para que el guard la limpie.
 */
export async function setSponsorActive(id: number, isActive: boolean, reason: string | null): Promise<Sponsor> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('sponsors')
    .update({ is_active: isActive, deactivation_reason: isActive ? null : reason })
    .eq('id', id)
    .select(SPONSOR_SELECT)
    .maybeSingle()

  if (error) throw translateGuardError(error)
  if (!data) throw new DomainError('El sponsor no existe', { status: 404 })
  return mapSponsor(data)
}
