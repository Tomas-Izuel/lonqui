import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { toClubDate } from '@/lib/dates'
import { getFamilyGroup } from '@/models/family-groups.model'
import { listMedicalClearances } from '@/models/medical-clearances.model'
import type {
  MedicalClearanceStatus,
  Member,
  MemberDetail,
  MemberFilters,
  MemberStatusEvent,
  MemberStatusEventType,
  MemberSummary,
  MemberType,
  MemberStatus,
  Page,
} from '@/models/types'

/**
 * Padrón: consultas y altas/bajas de `members`. Único lugar que le habla a
 * Postgres para este dominio (CLAUDE.md). Siempre con el cliente de sesión: la
 * auditoría toma el actor de `auth.uid()`, y las RLS son la autorización real.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const MEMBER_CORE_SHAPE = {
  firstName: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  lastName: z.string().trim().min(1, 'El apellido es obligatorio').max(120),
  // `dniPending` es el flag explícito de "todavía no tengo el DNI": sin él, el
  // DNI es obligatorio en la ficha de ingreso (el estatuto lo pide), aunque la
  // columna sea nullable en la base para no frenar la carga del padrón viejo.
  dni: z
    .string()
    .regex(/^[0-9]{7,8}$/, 'El DNI tiene que tener 7 u 8 dígitos')
    .nullish(),
  dniPending: z.boolean().optional(),
  birthDate: z.iso.date('La fecha de nacimiento no es válida').nullish(),
  address: z.string().trim().max(300).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.email('El email no es válido').nullish(),
  memberType: z.enum(['practicing', 'non_practicing'] satisfies MemberType[]),
  categoryId: z.number().int().positive().nullish(),
  familyGroupId: z.number().int().positive().nullish(),
  notes: z.string().trim().max(2000).nullish(),
}

type MemberCoreInput = {
  firstName: string
  lastName: string
  dni?: string | null
  dniPending?: boolean
  birthDate?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  memberType: MemberType
  categoryId?: number | null
  familyGroupId?: number | null
  notes?: string | null
}

/** Reglas compartidas entre alta y modificación: DNI/pendiente, tipo/categoría, fechas no futuras. */
function checkMemberCoherence(data: MemberCoreInput, ctx: z.RefinementCtx) {
  const dniPending = data.dniPending === true

  if (!dniPending && !data.dni) {
    ctx.addIssue({
      code: 'custom',
      message: 'El DNI es obligatorio. Si todavía no lo tenés, marcá "DNI pendiente"',
      path: ['dni'],
    })
  }
  if (dniPending && data.dni) {
    ctx.addIssue({
      code: 'custom',
      message: 'No podés cargar un DNI y marcarlo pendiente al mismo tiempo',
      path: ['dni'],
    })
  }

  if (data.memberType === 'practicing' && data.categoryId == null) {
    ctx.addIssue({ code: 'custom', message: 'Un socio practicante necesita una categoría', path: ['categoryId'] })
  }
  if (data.memberType === 'non_practicing' && data.categoryId != null) {
    ctx.addIssue({
      code: 'custom',
      message: 'Un socio no practicante no tiene categoría',
      path: ['categoryId'],
    })
  }

  if (data.birthDate && data.birthDate > toClubDate()) {
    ctx.addIssue({ code: 'custom', message: 'La fecha de nacimiento no puede ser futura', path: ['birthDate'] })
  }
}

/** Alta: `joinedOn` es obligatorio (puede ser una fecha pasada, para carga histórica) y no futuro. */
export const createMemberSchema = z
  .object({ ...MEMBER_CORE_SHAPE, joinedOn: z.iso.date('La fecha de alta no es válida') })
  .strict()
  .superRefine((data, ctx) => {
    checkMemberCoherence(data, ctx)
    if (data.joinedOn > toClubDate()) {
      ctx.addIssue({ code: 'custom', message: 'La fecha de alta no puede ser futura', path: ['joinedOn'] })
    }
  })

/**
 * Modificación: mismo formulario que el alta, pero sin `joinedOn` ni `status`
 * (son inmutables desde la app: `joinedOn` por trigger, `status` sin grant de
 * UPDATE). `.strict()` rechaza cualquiera de las dos con un error de formato
 * genérico, sin nombrar la clave (CLAUDE.md, zodToApiError).
 */
export const updateMemberSchema = z.object(MEMBER_CORE_SHAPE).strict().superRefine(checkMemberCoherence)

export type CreateMemberInput = z.infer<typeof createMemberSchema>
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>

/** Ficha de egreso/reingreso: motivo y fecha, sin `eventType` (lo fija la action que llama). */
export const statusEventSchema = z
  .object({
    memberId: z.number().int().positive(),
    effectiveOn: z.iso.date('La fecha no es válida'),
    reason: z.string().trim().min(3, 'El motivo tiene que tener al menos 3 caracteres').max(500),
    notes: z.string().trim().max(2000).nullish(),
  })
  .strict()

export type StatusEventInput = z.infer<typeof statusEventSchema>

// -----------------------------------------------------------------------------
// Traducción de errores de Postgres a DomainError (CLAUDE.md: el mensaje del
// trigger YA está pensado para el usuario; lo envolvemos, no lo re-escribimos).
// -----------------------------------------------------------------------------

const DNI_UNIQUE_CONSTRAINT = 'members_dni_key'
const PRACTICING_CHECK_CONSTRAINT = 'members_practicing_has_category'

function translateMemberError(error: PostgrestError): unknown {
  if (error.code === '23505' && error.message.includes(DNI_UNIQUE_CONSTRAINT)) {
    return new DomainError('Ya hay un socio con ese DNI', { field: 'dni' })
  }
  // Defensivo: Zod ya lo frena antes de llegar acá, pero un CHECK violado sin
  // traducir mostraría el nombre de la constraint en un error genérico.
  if (error.code === '23514' && error.message.includes(PRACTICING_CHECK_CONSTRAINT)) {
    return new DomainError('La categoría no corresponde con el tipo de socio elegido', { field: 'categoryId' })
  }
  return error
}

const STATUS_MESSAGES_WITHOUT_FIELD = new Set(['El socio ya está dado de baja', 'El socio ya está activo'])
const STATUS_MESSAGES_ON_DATE = new Set([
  'La fecha no puede ser futura',
  'La fecha no puede ser anterior a la fecha de alta',
])

function translateStatusEventError(error: PostgrestError): unknown {
  if (error.code === '23514') {
    if (STATUS_MESSAGES_WITHOUT_FIELD.has(error.message)) return new DomainError(error.message)
    if (STATUS_MESSAGES_ON_DATE.has(error.message)) return new DomainError(error.message, { field: 'effectiveOn' })
  }
  return error
}

// -----------------------------------------------------------------------------
// Derivaciones puras (edad, menor, estado del apto físico): sin I/O, mismas
// reglas para el listado y para la ficha.
// -----------------------------------------------------------------------------

/** Años cumplidos a `today`, comparando componentes de fecha sin pasar por `Date` (evita corrimientos de zona). */
function calculateAge(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = today.slice(0, 10).split('-').map(Number)
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age -= 1
  return age
}

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = toIso.slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

const EXPIRING_SOON_DAYS = 30

/** El apto físico solo se pide a menores (§6.1, D11); `expiresOn` es el del apto vigente (mayor vencimiento). */
function deriveMedicalClearanceStatus(
  isMinor: boolean,
  expiresOn: string | null,
  today: string,
): MedicalClearanceStatus {
  if (!isMinor) return 'not_required'
  if (!expiresOn) return 'missing'
  const daysLeft = daysBetween(today, expiresOn)
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= EXPIRING_SOON_DAYS) return 'expiring'
  return 'valid'
}

// -----------------------------------------------------------------------------
// Paginación keyset: cursor opaco = base64url de [lastName, firstName, id].
// -----------------------------------------------------------------------------

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 30

function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT
  return Math.min(Math.trunc(limit), MAX_LIMIT)
}

type MemberCursor = { lastName: string; firstName: string; id: number }

function encodeCursor(lastName: string, firstName: string, id: number): string {
  return Buffer.from(JSON.stringify([lastName, firstName, id])).toString('base64url')
}

/** Un cursor inválido (manipulado a mano) se ignora: arranca de nuevo en vez de tirar un error críptico. */
function decodeCursor(cursor: string): MemberCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      typeof parsed[2] === 'number'
    ) {
      return { lastName: parsed[0], firstName: parsed[1], id: parsed[2] }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Valor listo para el filtro `or=` de PostgREST. La API no escapa nada (pasa
 * el string tal cual en la URL): comillas dobles siempre, backslash y comilla
 * interna escapados, así un apellido con coma, punto o paréntesis no rompe la
 * gramática del filtro (docs.postgrest.org, "Reserved characters").
 */
function pgQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** `q` se normaliza igual que `private.normalize_text` en la base: minúsculas y sin acentos (NFD). */
function normalizeSearchTerm(q: string): string {
  return q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

// -----------------------------------------------------------------------------
// Mapeo de filas
// -----------------------------------------------------------------------------

type CategoryEmbed = { name: string; discipline_id: number; disciplines: { name: string } | null } | null

function mapMember(row: {
  id: number
  first_name: string
  last_name: string
  dni: string | null
  birth_date: string | null
  address: string | null
  phone: string | null
  email: string | null
  member_type: string
  category_id: number | null
  family_group_id: number | null
  is_payment_responsible: boolean
  joined_on: string
  status: string
  status_changed_on: string | null
  notes: string | null
  created_at: string
  updated_at: string
}): Member {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    dni: row.dni,
    birthDate: row.birth_date,
    address: row.address,
    phone: row.phone,
    email: row.email,
    memberType: row.member_type as MemberType,
    categoryId: row.category_id,
    familyGroupId: row.family_group_id,
    isPaymentResponsible: row.is_payment_responsible,
    joinedOn: row.joined_on,
    status: row.status as MemberStatus,
    statusChangedOn: row.status_changed_on,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

const SEARCH_SELECT =
  'id, first_name, last_name, dni, birth_date, member_type, status, family_group_id, is_payment_responsible, categories(name, discipline_id, disciplines(name))'

/**
 * Listado del padrón: filtros combinables, keyset estable por
 * `(last_name, first_name, id)`, por defecto solo activos. `medicalClearanceStatus`
 * se resuelve con una sola query extra (apto vigente por socio menor de la
 * página), nunca una por fila.
 */
export async function searchMembers(filters: MemberFilters = {}): Promise<Page<MemberSummary>> {
  const supabase = await createClient()
  const limit = clampLimit(filters.limit)
  const today = toClubDate()

  let query = supabase.from('members').select(SEARCH_SELECT)

  if (filters.status === 'all') {
    // sin filtro: activos y de baja.
  } else {
    query = query.eq('status', filters.status ?? 'active')
  }

  if (filters.memberType) query = query.eq('member_type', filters.memberType)
  if (filters.categoryId != null) query = query.eq('category_id', filters.categoryId)

  if (filters.disciplineId != null) {
    const { data: cats, error: catsError } = await supabase
      .from('categories')
      .select('id')
      .eq('discipline_id', filters.disciplineId)
    if (catsError) throw catsError
    const categoryIds = (cats ?? []).map((c) => c.id)
    // Ninguna categoría en esa disciplina: cero resultados, sin pegarle a members.
    if (categoryIds.length === 0) return { items: [], nextCursor: null }
    query = query.in('category_id', categoryIds)
  }

  if (filters.q && filters.q.trim().length > 0) {
    query = query.ilike('search_text', `%${normalizeSearchTerm(filters.q.trim())}%`)
  }

  // `debt` (condición de deuda) se acepta y se IGNORA a propósito: depende de
  // `fees`/`payments`, que llegan en el slice 2 (cuotas). La UI ya lo muestra
  // deshabilitado con esa explicación.

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null
  if (cursor) {
    query = query.or(
      [
        `last_name.gt.${pgQuote(cursor.lastName)}`,
        `and(last_name.eq.${pgQuote(cursor.lastName)},first_name.gt.${pgQuote(cursor.firstName)})`,
        `and(last_name.eq.${pgQuote(cursor.lastName)},first_name.eq.${pgQuote(cursor.firstName)},id.gt.${cursor.id})`,
      ].join(','),
    )
  }

  query = query
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit + 1)

  const { data, error } = await query
  if (error) throw error

  const rows = data ?? []
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  const minorIds = pageRows
    .filter((r) => r.birth_date != null && calculateAge(r.birth_date, today) < 18)
    .map((r) => r.id)
  const clearanceByMember = await currentClearanceExpirationByMember(supabase, minorIds)

  const items: MemberSummary[] = pageRows.map((r) => {
    const age = r.birth_date ? calculateAge(r.birth_date, today) : null
    const isMinor = age !== null && age < 18
    const category = r.categories as unknown as CategoryEmbed
    return {
      id: r.id,
      fullName: `${r.last_name}, ${r.first_name}`,
      dni: r.dni,
      hasDni: r.dni != null,
      memberType: r.member_type as MemberType,
      status: r.status as MemberStatus,
      categoryName: category?.name ?? null,
      disciplineName: category?.disciplines?.name ?? null,
      familyGroupId: r.family_group_id,
      isPaymentResponsible: r.is_payment_responsible,
      isMinor,
      medicalClearanceStatus: deriveMedicalClearanceStatus(
        isMinor,
        isMinor ? (clearanceByMember.get(r.id) ?? null) : null,
        today,
      ),
    }
  })

  const last = pageRows.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.last_name, last.first_name, last.id) : null

  return { items, nextCursor }
}

/** `expires_on` del apto de mayor vencimiento por socio, para el conjunto de ids dado. Una sola query. */
async function currentClearanceExpirationByMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberIds: number[],
): Promise<Map<number, string>> {
  if (memberIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('medical_clearances')
    .select('member_id, expires_on')
    .in('member_id', memberIds)
    .order('expires_on', { ascending: false })
  if (error) throw error

  const map = new Map<number, string>()
  for (const row of data ?? []) {
    // Ordenado desc: la primera fila vista por socio es la de mayor vencimiento.
    if (!map.has(row.member_id)) map.set(row.member_id, row.expires_on)
  }
  return map
}

const DETAIL_SELECT =
  'id, first_name, last_name, dni, birth_date, address, phone, email, member_type, category_id, family_group_id, is_payment_responsible, joined_on, status, status_changed_on, notes, created_at, updated_at, categories(name, discipline_id, disciplines(name))'

/**
 * Ficha completa del socio. Combina member + categoría/disciplina + grupo
 * familiar + aptos físicos + historia de estado. La URL firmada del apto
 * vigente NO se resuelve acá (queda en `medicalClearanceUrl: null`): solo la
 * arma `getMemberPage` del controller, y solo si hay adjunto.
 */
export async function getMemberDetail(id: number): Promise<MemberDetail> {
  const supabase = await createClient()

  const { data: row, error } = await supabase.from('members').select(DETAIL_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  if (!row) throw new DomainError('El socio no existe', { status: 404 })

  const today = toClubDate()
  const age = row.birth_date ? calculateAge(row.birth_date, today) : null
  const isMinor = age !== null && age < 18

  const [familyGroup, clearances, statusHistory] = await Promise.all([
    row.family_group_id ? getFamilyGroup(row.family_group_id) : Promise.resolve(null),
    listMedicalClearances(row.id),
    getMemberStatusHistory(row.id),
  ])

  const current = clearances[0] ?? null
  const category = row.categories as unknown as CategoryEmbed

  return {
    ...mapMember(row),
    fullName: `${row.last_name}, ${row.first_name}`,
    age,
    isMinor,
    categoryName: category?.name ?? null,
    disciplineId: category?.discipline_id ?? null,
    disciplineName: category?.disciplines?.name ?? null,
    familyGroup,
    currentMedicalClearance: current,
    medicalClearanceStatus: deriveMedicalClearanceStatus(isMinor, current?.expiresOn ?? null, today),
    medicalClearanceUrl: null,
    medicalClearances: clearances,
    statusHistory,
  }
}

/** Historia de alta/baja/reactivación, con el nombre del actor cuando la RLS de `app_users` lo deja ver. */
export async function getMemberStatusHistory(memberId: number): Promise<MemberStatusEvent[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('member_status_events')
    .select('id, event_type, effective_on, reason, notes, created_by, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = data ?? []
  const actorIds = Array.from(new Set(rows.map((r) => r.created_by).filter((id): id is string => id != null)))

  const nameByActor = new Map<string, string>()
  if (actorIds.length > 0) {
    // Solo devuelve lo que la RLS de app_users deja ver a este usuario (su
    // propia fila, o todas si es admin): un editor puede no ver quién dio de
    // baja a un socio, y eso es correcto, no un bug.
    const { data: actors, error: actorsError } = await supabase
      .from('app_users')
      .select('user_id, display_name')
      .in('user_id', actorIds)
    if (actorsError) throw actorsError
    for (const actor of actors ?? []) nameByActor.set(actor.user_id, actor.display_name)
  }

  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type as MemberStatusEventType,
    effectiveOn: r.effective_on,
    reason: r.reason,
    notes: r.notes,
    createdByName: r.created_by ? (nameByActor.get(r.created_by) ?? null) : null,
    createdAt: r.created_at,
  }))
}

// -----------------------------------------------------------------------------
// Altas, modificaciones y eventos de estado
// -----------------------------------------------------------------------------

export async function createMember(input: CreateMemberInput): Promise<{ id: number }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('members')
    .insert({
      first_name: input.firstName,
      last_name: input.lastName,
      dni: input.dniPending ? null : (input.dni ?? null),
      birth_date: input.birthDate ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ? input.email.toLowerCase() : null,
      member_type: input.memberType,
      category_id: input.memberType === 'practicing' ? (input.categoryId ?? null) : null,
      family_group_id: input.familyGroupId ?? null,
      joined_on: input.joinedOn,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()

  if (error) throw translateMemberError(error)
  return { id: data.id }
}

export async function updateMember(id: number, input: UpdateMemberInput): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('members')
    .update({
      first_name: input.firstName,
      last_name: input.lastName,
      dni: input.dniPending ? null : (input.dni ?? null),
      birth_date: input.birthDate ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ? input.email.toLowerCase() : null,
      member_type: input.memberType,
      category_id: input.memberType === 'practicing' ? (input.categoryId ?? null) : null,
      family_group_id: input.familyGroupId ?? null,
      notes: input.notes ?? null,
    })
    .eq('id', id)

  if (error) throw translateMemberError(error)
}

/**
 * Ficha de egreso/reingreso. El `admission` inicial lo crea solo el trigger de
 * `members` (§S3): esta función nunca lo inserta a mano, por eso `eventType`
 * está acotado a los dos únicos que la RLS deja insertar a un admin.
 */
export async function insertStatusEvent(
  input: StatusEventInput & { eventType: Extract<MemberStatusEventType, 'withdrawal' | 'reactivation'> },
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.from('member_status_events').insert({
    member_id: input.memberId,
    event_type: input.eventType,
    effective_on: input.effectiveOn,
    reason: input.reason,
    notes: input.notes ?? null,
  })

  if (error) throw translateStatusEventError(error)
}
