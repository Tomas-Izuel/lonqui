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
  name: z.string().trim().max(120).nullish(),
  payerContactName: z.string().trim().max(120).nullish(),
  payerContactPhone: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(2000).nullish(),
}

export const familyGroupInputSchema = z.object(FAMILY_GROUP_SHAPE).strict()
export type FamilyGroupInput = z.infer<typeof familyGroupInputSchema>

export const setPaymentResponsibleSchema = z
  .object({
    groupId: z.number().int().positive(),
    memberId: z.number().int().positive(),
  })
  .strict()
export type SetPaymentResponsibleInput = z.infer<typeof setPaymentResponsibleSchema>

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

/**
 * Ficha del grupo con sus integrantes. `missingResponsible` es true si nadie
 * ACTIVO tiene el flag: un responsable dado de baja deja al grupo "sin
 * responsable" (D4) aunque su fila siga con `is_payment_responsible = true`.
 */
export async function getFamilyGroup(id: number): Promise<FamilyGroupSummary | null> {
  const supabase = await createClient()

  const { data: group, error } = await supabase
    .from('family_groups')
    .select('id, name, payer_contact_name, payer_contact_phone, notes')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!group) return null

  const { data: memberRows, error: membersError } = await supabase
    .from('members')
    .select('id, first_name, last_name, status, is_payment_responsible')
    .eq('family_group_id', id)
    .order('last_name', { ascending: true })
  if (membersError) throw membersError

  const members: FamilyGroupMember[] = (memberRows ?? []).map((m) => ({
    id: m.id,
    fullName: `${m.last_name}, ${m.first_name}`,
    status: m.status as MemberStatus,
    isPaymentResponsible: m.is_payment_responsible,
  }))

  const activeResponsible = members.find((m) => m.isPaymentResponsible && m.status === 'active')

  return {
    id: group.id,
    name: group.name,
    payerContactName: group.payer_contact_name,
    payerContactPhone: group.payer_contact_phone,
    notes: group.notes,
    label: group.name ?? (activeResponsible ? activeResponsible.fullName.split(',')[0] : 'Grupo familiar'),
    members,
    missingResponsible: !activeResponsible,
  }
}

/**
 * Listado para selects de "asignar a un grupo existente". El club maneja
 * unos pocos grupos familiares (no una tabla que crece con el padrón): el
 * costo de una query extra por grupo para su resumen es aceptable acá y no
 * escala a una página de miles de filas.
 */
export async function listFamilyGroups(): Promise<FamilyGroupSummary[]> {
  const supabase = await createClient()

  const { data: groups, error } = await supabase.from('family_groups').select('id').order('id', { ascending: true })
  if (error) throw error

  const summaries = await Promise.all((groups ?? []).map((g) => getFamilyGroup(g.id)))
  return summaries.filter((g): g is FamilyGroupSummary => g !== null)
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

export async function updateFamilyGroup(id: number, input: FamilyGroupInput): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('family_groups')
    .update({
      name: input.name ?? null,
      payer_contact_name: input.payerContactName ?? null,
      payer_contact_phone: input.payerContactPhone ?? null,
      notes: input.notes ?? null,
    })
    .eq('id', id)

  if (error) throw error
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
