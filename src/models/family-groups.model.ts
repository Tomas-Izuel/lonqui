import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import type { FamilyGroupMember, FamilyGroupSummary, MemberStatus } from '@/models/types'

/**
 * Grupos familiares: el responsable de pago es SIEMPRE un integrante del
 * grupo (00-architecture.md D4); el contacto de pago libre (`payerContact*`)
 * cubre al padre/madre que paga pero no es socio.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const FAMILY_GROUP_SHAPE = {
  name: z.string().trim().max(120, 'El nombre del grupo no puede tener más de 120 caracteres').nullish(),
  payerContactName: z
    .string()
    .trim()
    .max(120, 'El nombre del responsable no puede tener más de 120 caracteres')
    .nullish(),
  payerContactPhone: z
    .string()
    .trim()
    .max(40, 'El teléfono del responsable no puede tener más de 40 caracteres')
    .nullish(),
  notes: z.string().trim().max(2000, 'Las notas no pueden tener más de 2000 caracteres').nullish(),
}

export const familyGroupInputSchema = z.object(FAMILY_GROUP_SHAPE).strict()
export type FamilyGroupInput = z.infer<typeof familyGroupInputSchema>

export const setPaymentResponsibleSchema = z
  .object({
    groupId: z.number().int().positive(),
    memberId: z
      .number('Elegí un integrante del grupo')
      .int('Elegí un integrante del grupo')
      .positive('Elegí un integrante del grupo'),
  })
  .strict()
export type SetPaymentResponsibleInput = z.infer<typeof setPaymentResponsibleSchema>

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

/**
 * Grupo + integrantes en una sola consulta (embed de PostgREST), no una por
 * grupo (03-review.md, Major 6: `listFamilyGroups` hacía 1 + 2·N queries).
 * `!inner` no hace falta: un grupo sin integrantes es válido y `members`
 * viene `null`/`[]`.
 */
const FAMILY_GROUP_SELECT =
  'id, name, payer_contact_name, payer_contact_phone, notes, ' +
  'members(id, first_name, last_name, status, is_payment_responsible)'

type FamilyGroupRow = {
  id: number
  name: string | null
  payer_contact_name: string | null
  payer_contact_phone: string | null
  notes: string | null
  members: { id: number; first_name: string; last_name: string; status: string; is_payment_responsible: boolean }[] | null
}

/** `missingResponsible` es true si nadie ACTIVO tiene el flag: un responsable dado de baja deja al grupo "sin responsable" (D4) aunque su fila siga con `is_payment_responsible = true`. */
function mapFamilyGroupRow(row: FamilyGroupRow): FamilyGroupSummary {
  const members: FamilyGroupMember[] = (row.members ?? [])
    .map((m) => ({
      id: m.id,
      fullName: `${m.last_name}, ${m.first_name}`,
      status: m.status as MemberStatus,
      isPaymentResponsible: m.is_payment_responsible,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'))

  const activeResponsible = members.find((m) => m.isPaymentResponsible && m.status === 'active')

  return {
    id: row.id,
    name: row.name,
    payerContactName: row.payer_contact_name,
    payerContactPhone: row.payer_contact_phone,
    notes: row.notes,
    label: row.name ?? (activeResponsible ? activeResponsible.fullName.split(',')[0] : 'Grupo familiar'),
    members,
    missingResponsible: !activeResponsible,
  }
}

/** Ficha del grupo con sus integrantes. */
export async function getFamilyGroup(id: number): Promise<FamilyGroupSummary | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.from('family_groups').select(FAMILY_GROUP_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? mapFamilyGroupRow(data as unknown as FamilyGroupRow) : null
}

/** Listado para selects de "asignar a un grupo existente" y para la página de grupos. Una sola consulta, con embed. */
export async function listFamilyGroups(): Promise<FamilyGroupSummary[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('family_groups')
    .select(FAMILY_GROUP_SELECT)
    .order('id', { ascending: true })
  if (error) throw error

  return (data ?? []).map((row) => mapFamilyGroupRow(row as unknown as FamilyGroupRow))
}

// -----------------------------------------------------------------------------
// Altas y modificaciones
// -----------------------------------------------------------------------------

export async function createFamilyGroup(input: FamilyGroupInput): Promise<{ id: number }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('family_groups')
    .insert({
      name: input.name ?? null,
      payer_contact_name: input.payerContactName ?? null,
      payer_contact_phone: input.payerContactPhone ?? null,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  return { id: data.id }
}

/** `.select().maybeSingle()` para distinguir un id inexistente (0 filas) de un éxito real (Minor 11 del review). */
export async function updateFamilyGroup(id: number, input: FamilyGroupInput): Promise<void> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('family_groups')
    .update({
      name: input.name ?? null,
      payer_contact_name: input.payerContactName ?? null,
      payer_contact_phone: input.payerContactPhone ?? null,
      notes: input.notes ?? null,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new DomainError('El grupo familiar no existe', { status: 404 })
}

function translateResponsibleError(error: PostgrestError): unknown {
  if (error.code === '23514' && error.message === 'El socio no pertenece a ese grupo familiar') {
    return new DomainError(error.message, { field: 'memberId' })
  }
  return error
}

/**
 * Cambia el responsable de pago del grupo en una sola transacción (RPC
 * `set_family_payment_responsible`, S3): atómico contra el índice único
 * parcial de "a lo sumo un responsable por grupo".
 */
export async function setPaymentResponsible(groupId: number, memberId: number): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.rpc('set_family_payment_responsible', { group_id: groupId, member_id: memberId })
  if (error) throw translateResponsibleError(error)
}
