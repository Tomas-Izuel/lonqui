import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { BIRTH_DATE_TOO_OLD_MESSAGE, MIN_BIRTH_DATE, toClubDate } from '@/lib/dates'
import { createFamilyGroup, getFamilyGroup } from '@/models/family-groups.model'
import { listMedicalClearances } from '@/models/medical-clearances.model'
import {
  assertCategorySelection,
  listMemberships,
  openMemberships,
  setMemberCategories as assignCategories,
} from '@/models/member-categories.model'
import type {
  DebtStatus,
  MedicalClearanceStatus,
  Member,
  MemberCategoryRef,
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
 *
 * Revisión 3 (§13 de 00-architecture.md, pipeline 2026-09-27): un socio puede
 * jugar más de un deporte. `members.category_id` ya NO EXISTE — la pertenencia
 * vive en `member_categories` (`member-categories.model.ts`), y
 * `members.member_type` es DERIVADO por trigger (practicante ⇔ al menos una
 * inscripción abierta): esta capa nunca lo escribe ni lo acepta como input.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const MEMBER_CORE_SHAPE = {
  firstName: z
    .string('El nombre es obligatorio')
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(120, 'El nombre no puede tener más de 120 caracteres'),
  lastName: z
    .string('El apellido es obligatorio')
    .trim()
    .min(1, 'El apellido es obligatorio')
    .max(120, 'El apellido no puede tener más de 120 caracteres'),
  // `dniPending` es el flag explícito de "todavía no tengo el DNI": sin él, el
  // DNI es obligatorio en la ficha de ingreso (el estatuto lo pide), aunque la
  // columna sea nullable en la base para no frenar la carga del padrón viejo.
  dni: z
    .string()
    .regex(/^[0-9]{7,8}$/, 'El DNI tiene que tener 7 u 8 dígitos')
    .nullish(),
  dniPending: z.boolean().optional(),
  birthDate: z.iso.date('La fecha de nacimiento no es válida').nullish(),
  address: z.string().trim().max(300, 'El domicilio no puede tener más de 300 caracteres').nullish(),
  phone: z.string().trim().max(40, 'El teléfono no puede tener más de 40 caracteres').nullish(),
  email: z.email('El email no es válido').max(254, 'El email no puede tener más de 254 caracteres').nullish(),
  familyGroupId: z
    .number('Elegí un grupo familiar de la lista')
    .int('Elegí un grupo familiar de la lista')
    .positive('Elegí un grupo familiar de la lista')
    .nullish(),
  notes: z.string().trim().max(2000, 'Las notas no pueden tener más de 2000 caracteres').nullish(),
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
  familyGroupId?: number | null
  notes?: string | null
}

/** Reglas compartidas entre alta y modificación: DNI/pendiente, fechas no futuras. Tipo y categoría ya no se validan acá: son derivado (member_type) y RPC (categoryIds, solo en el alta). */
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

  if (data.birthDate && data.birthDate > toClubDate()) {
    ctx.addIssue({ code: 'custom', message: 'La fecha de nacimiento no puede ser futura', path: ['birthDate'] })
  }
  // Misma cota que el CHECK `members_birth_date_sane`: acá da el mensaje antes de pegarle a la base.
  if (data.birthDate && data.birthDate < MIN_BIRTH_DATE) {
    ctx.addIssue({ code: 'custom', message: BIRTH_DATE_TOO_OLD_MESSAGE, path: ['birthDate'] })
  }
}

/**
 * Grupo familiar nuevo, cargado desde la misma ficha de alta (Minor 10 del
 * review): sin `notes`, a propósito — ese campo solo tiene sentido editando
 * un grupo ya creado, no en el flujo de "no existe todavía".
 */
const NEW_FAMILY_GROUP_SHAPE = z
  .object({
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
  })
  .strict()

/**
 * Alta: `joinedOn` es obligatorio (puede ser una fecha pasada, para carga
 * histórica) y no futuro. `categoryIds` (vacío = no practicante) reemplaza al
 * viejo par `memberType`/`categoryId` (Revisión 3): existencia, actividad y
 * "una por disciplina" del catálogo los valida la base (`assertCategorySelection`
 * antes del insert, y el trigger/RPC como defensa real); acá solo se descarta
 * lo puramente estructural (ids repetidos).
 */
export const createMemberSchema = z
  .object({
    ...MEMBER_CORE_SHAPE,
    joinedOn: z.iso.date('La fecha de alta no es válida'),
    categoryIds: z
      .array(
        z
          .number('Elegí una categoría de la lista')
          .int('Elegí una categoría de la lista')
          .positive('Elegí una categoría de la lista'),
      )
      .max(20, 'Demasiadas categorías: elegí hasta 20'),
    /** Alternativa a `familyGroupId`: crea el grupo en la misma alta (D10 del review). Mutuamente excluyentes. */
    newFamilyGroup: NEW_FAMILY_GROUP_SHAPE.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    checkMemberCoherence(data, ctx)
    if (data.joinedOn > toClubDate()) {
      ctx.addIssue({ code: 'custom', message: 'La fecha de alta no puede ser futura', path: ['joinedOn'] })
    }
    if (data.newFamilyGroup && data.familyGroupId != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Elegí un grupo familiar existente o cargá uno nuevo, no los dos',
        path: ['familyGroupId'],
      })
    }
    if (new Set(data.categoryIds).size !== data.categoryIds.length) {
      ctx.addIssue({ code: 'custom', message: 'Elegí cada categoría una sola vez', path: ['categoryIds'] })
    }
  })

/**
 * Modificación: mismo formulario que el alta, pero sin `joinedOn` ni `status`
 * (son inmutables desde la app: `joinedOn` por trigger, `status` sin grant de
 * UPDATE) y sin `categoryIds`: los deportes se cambian con la Server Action
 * `setMemberCategories` (`members.actions.ts`), no con esta. `.strict()`
 * rechaza cualquiera de las tres con un error de formato genérico, sin nombrar
 * la clave (CLAUDE.md, zodToApiError).
 */
export const updateMemberSchema = z.object(MEMBER_CORE_SHAPE).strict().superRefine(checkMemberCoherence)

export type CreateMemberInput = z.infer<typeof createMemberSchema>
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>

/** Ficha de egreso/reingreso: motivo y fecha, sin `eventType` (lo fija la action que llama). */
export const statusEventSchema = z
  .object({
    memberId: z.number().int().positive(),
    effectiveOn: z.iso.date('La fecha no es válida'),
    reason: z
      .string('El motivo tiene que tener al menos 3 caracteres')
      .trim()
      .min(3, 'El motivo tiene que tener al menos 3 caracteres')
      .max(500, 'El motivo no puede tener más de 500 caracteres'),
    notes: z.string().trim().max(2000, 'Las notas no pueden tener más de 2000 caracteres').nullish(),
  })
  .strict()

export type StatusEventInput = z.infer<typeof statusEventSchema>

/**
 * Filtros del padrón, validados en el borde de `loadMoreMembers` (Major 5 del
 * review: el "Ver más" pasa a ser una Server Action, no una page que
 * re-encadena todo el keyset). La lectura desde un Server Component
 * (`getPadron`) sigue sin pasar por acá: ese `MemberFilters` ya sale
 * tipado de `page.tsx`, no de un cliente que puede mandar cualquier cosa.
 */
const memberFiltersSchema = z
  .object({
    q: z.string().max(200, 'La búsqueda es demasiado larga: usá menos de 200 caracteres').optional(),
    categoryId: z.number().int().positive().optional(),
    disciplineId: z.number().int().positive().optional(),
    status: z.enum(['active', 'inactive', 'all'] satisfies (MemberStatus | 'all')[]).optional(),
    memberType: z.enum(['practicing', 'non_practicing'] satisfies MemberType[]).optional(),
    debt: z.enum(['any', 'up_to_date', 'in_debt']).optional(),
  })
  .strict()

export const loadMoreMembersSchema = z
  .object({
    filters: memberFiltersSchema,
    cursor: z.string().min(1, 'Cursor inválido'),
  })
  .strict()
export type LoadMoreMembersInput = z.infer<typeof loadMoreMembersSchema>

// -----------------------------------------------------------------------------
// Traducción de errores de Postgres a DomainError (CLAUDE.md: el mensaje del
// trigger YA está pensado para el usuario; lo envolvemos, no lo re-escribimos).
// -----------------------------------------------------------------------------

const DNI_UNIQUE_CONSTRAINT = 'members_dni_key'
// CHECK de la migración de socios: red de seguridad si algo esquiva el Zod (ej. PostgREST directo).
const BIRTH_DATE_SANE_CHECK = 'members_birth_date_sane'
// Migración `20260927120000_review_fixes.sql` (03-review.md, blocker 3): un
// trigger BEFORE UPDATE OF family_group_id ya limpia `is_payment_responsible`
// cuando cambia el grupo, así que en el camino normal estos dos ya no
// deberían violarse. Se traducen igual, defensivos, para el caso raro de una
// carrera (dos updates concurrentes) o de un futuro camino de escritura que
// toque `is_payment_responsible` sin pasar por ese trigger.
const RESPONSIBLE_HAS_GROUP_CHECK = 'members_responsible_has_group'
const ONE_RESPONSIBLE_PER_GROUP_INDEX = 'members_one_responsible_per_group'
// CHECK declarativos de la tabla (nombres autogenerados por Postgres): red de
// seguridad si algo esquiva el Zod, por ejemplo una escritura directa a PostgREST.
const FIRST_NAME_CHECK = 'members_first_name_check'
const LAST_NAME_CHECK = 'members_last_name_check'
const DNI_CHECK = 'members_dni_check'
const EMAIL_CHECK = 'members_email_check'
const FAMILY_GROUP_FK = 'members_family_group_id_fkey'

function translateMemberError(error: PostgrestError): unknown {
  if (error.code === '23505' && error.message.includes(DNI_UNIQUE_CONSTRAINT)) {
    return new DomainError('Ya hay un socio con ese DNI', { field: 'dni' })
  }
  if (error.code === '23505' && error.message.includes(ONE_RESPONSIBLE_PER_GROUP_INDEX)) {
    return new DomainError('Ese grupo familiar ya tiene un responsable de pago', { field: 'familyGroupId' })
  }
  if (error.code === '23514' && error.message.includes(BIRTH_DATE_SANE_CHECK)) {
    return new DomainError(BIRTH_DATE_TOO_OLD_MESSAGE, { field: 'birthDate' })
  }
  if (error.code === '23514' && error.message.includes(RESPONSIBLE_HAS_GROUP_CHECK)) {
    return new DomainError('El responsable de pago no puede quedar sin grupo familiar', { field: 'familyGroupId' })
  }
  if (error.code === '23514' && error.message.includes(FIRST_NAME_CHECK)) {
    return new DomainError('El nombre es obligatorio', { field: 'firstName' })
  }
  if (error.code === '23514' && error.message.includes(LAST_NAME_CHECK)) {
    return new DomainError('El apellido es obligatorio', { field: 'lastName' })
  }
  if (error.code === '23514' && error.message.includes(DNI_CHECK)) {
    return new DomainError('El DNI tiene que tener 7 u 8 dígitos', { field: 'dni' })
  }
  if (error.code === '23514' && error.message.includes(EMAIL_CHECK)) {
    return new DomainError('El email no es válido', { field: 'email' })
  }
  if (error.code === '23503' && error.message.includes(FAMILY_GROUP_FK)) {
    return new DomainError('Ese grupo familiar no existe', { field: 'familyGroupId' })
  }
  return error
}

const STATUS_MESSAGES_WITHOUT_FIELD = new Set(['El socio ya está dado de baja', 'El socio ya está activo'])
const STATUS_MESSAGES_ON_DATE = new Set([
  'La fecha no puede ser futura',
  'La fecha no puede ser anterior a la fecha de alta',
])

const STATUS_REASON_CHECK = 'member_status_events_reason_check'

function translateStatusEventError(error: PostgrestError): unknown {
  if (error.code === '23514' && error.message.includes(STATUS_REASON_CHECK)) {
    return new DomainError('El motivo tiene que tener al menos 3 caracteres', { field: 'reason' })
  }
  if (error.code === '23503') {
    return new DomainError('El socio no existe', { status: 404 })
  }
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

/**
 * Tamaño de página único del padrón (R1, segunda pasada del review): antes
 * `searchMembers` sin `limit` caía en 30 mientras `socios/page.tsx` pedía 50
 * a mano, así que la primera tanda traía 50 filas y "Ver más" traía 30 — el
 * tamaño lo decide el servidor, no cada llamador, y todos usan esta misma
 * constante. `getPadron` (primera tanda) y `loadMoreMembers` (server action
 * de "Ver más") nunca reciben `limit` del cliente: `memberFiltersSchema` es
 * `.strict()` sin ese campo a propósito, así que siempre cae acá.
 */
export const PADRON_PAGE_SIZE = 50

function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return PADRON_PAGE_SIZE
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
    // Bloque Unicode "Combining Diacritical Marks" (U+0300–U+036F): lo que
    // NFD separa de la letra base (á → a + ́). Con caracteres combinantes
    // literales en el regex (como estaba antes) el rango es ilegible en el
    // código fuente; con el escape se lee y es el mismo rango.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

// -----------------------------------------------------------------------------
// Mapeo de filas
// -----------------------------------------------------------------------------

/** Fila de `member_categories` embebida (abierta: el `is(...left_on, null)` de la consulta ya la filtró). */
type CategoryEmbedRow = {
  category_id: number
  left_on: string | null
  categories: { name: string; discipline_id: number; disciplines: { name: string } | null } | null
}

function mapCategoryEmbed(rows: CategoryEmbedRow[] | null | undefined): MemberCategoryRef[] {
  return (rows ?? [])
    .filter((r) => r.left_on === null)
    .map((r) => ({
      categoryId: r.category_id,
      categoryName: r.categories?.name ?? '',
      disciplineId: r.categories?.discipline_id ?? 0,
      disciplineName: r.categories?.disciplines?.name ?? '',
    }))
}

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

/**
 * DOS embeds de la misma relación `member_categories`, con alias EXPLÍCITO
 * en los dos. `open_categories` es el que se muestra (todas las inscripciones
 * abiertas del socio, siempre); `match_categories` (`!inner`, solo cuando hay
 * filtro de categoría/disciplina) es el que decide qué socios entran.
 *
 * Si el segundo embed queda SIN alias (el nombre por defecto
 * `member_categories`, como en la primera versión de este archivo),
 * PostgREST arrastra un bug de resolución de filtros: con más de una fila de
 * resultado, el filtro `member_categories.left_on=is.null` deja de aplicarse
 * al embed sin alias y un socio con una categoría vieja YA CERRADA la vuelve
 * a mostrar en la lista (verificado a mano contra PostgREST 12.2 del stack
 * local — con una sola fila de resultado el bug no aparece, lo que lo hace
 * fácil de no ver en una prueba manual apurada). Aliasando los DOS no pasa
 * (00-architecture.md §13.2: "cada fila muestra sus categorías", sin
 * excepción cuando hay un filtro activo).
 */
const CATEGORY_DISPLAY_EMBED =
  'open_categories:member_categories(category_id, left_on, categories(name, discipline_id, disciplines(name)))'
const CATEGORY_MATCH_EMBED = 'match_categories:member_categories!inner(category_id, left_on)'

function buildSearchSelect(hasCategoryFilter: boolean, includeDebt: boolean): string {
  const base =
    'id, first_name, last_name, dni, birth_date, member_type, status, family_group_id, is_payment_responsible'
  // Campos calculados de PostgREST (member_balance_cents/member_debt_status/
  // member_months_due, migración 130200): tiran `insufficient_privilege` sin
  // `payments.read`, por eso solo se piden si `includeDebt` (el controller ya
  // lo decidió por permiso, no por rol).
  const debtCols = includeDebt ? ', member_debt_status, member_balance_cents, member_months_due' : ''
  const matchEmbed = hasCategoryFilter ? `, ${CATEGORY_MATCH_EMBED}` : ''
  return `${base}${debtCols}, ${CATEGORY_DISPLAY_EMBED}${matchEmbed}`
}

type SearchRow = {
  id: number
  first_name: string
  last_name: string
  dni: string | null
  birth_date: string | null
  member_type: string
  status: string
  family_group_id: number | null
  is_payment_responsible: boolean
  open_categories: CategoryEmbedRow[] | null
  member_debt_status?: string | null
  member_balance_cents?: number | null
  member_months_due?: number | null
}

/**
 * Listado del padrón: filtros combinables, keyset estable por
 * `(last_name, first_name, id)`, por defecto solo activos.
 * `medicalClearanceStatus` se resuelve con una sola query extra (apto vigente
 * por socio menor de la página), nunca una por fila.
 *
 * `options.includeDebt` lo decide el controller según `payments.read` de la
 * sesión (nunca el rol): sin él, `filters.debt` se ignora y ni se piden las
 * columnas calculadas de deuda — la UI ya muestra ese filtro deshabilitado.
 */
export async function searchMembers(
  filters: MemberFilters = {},
  options?: { includeDebt?: boolean },
): Promise<Page<MemberSummary>> {
  const supabase = await createClient()
  const limit = clampLimit(filters.limit)
  const today = toClubDate()
  const includeDebt = options?.includeDebt ?? false

  // El filtro por disciplina se resuelve a las categorías de esa disciplina
  // (una consulta chica, igual que antes de la Revisión 3); el de categoría
  // puntual ya viene como id. Los dos se combinan si vienen juntos.
  let categoryIds: number[] | null = filters.categoryId != null ? [filters.categoryId] : null
  if (filters.disciplineId != null) {
    const { data: cats, error: catsError } = await supabase
      .from('categories')
      .select('id')
      .eq('discipline_id', filters.disciplineId)
    if (catsError) throw catsError
    const disciplineCategoryIds = (cats ?? []).map((c) => c.id)
    // Ninguna categoría en esa disciplina: cero resultados, sin pegarle a members.
    if (disciplineCategoryIds.length === 0) return { items: [], nextCursor: null }
    categoryIds = categoryIds ? categoryIds.filter((id) => disciplineCategoryIds.includes(id)) : disciplineCategoryIds
    if (categoryIds.length === 0) return { items: [], nextCursor: null }
  }
  const hasCategoryFilter = categoryIds !== null

  let query = supabase.from('members').select(buildSearchSelect(hasCategoryFilter, includeDebt))

  if (filters.status === 'all') {
    // sin filtro: activos y de baja.
  } else {
    query = query.eq('status', filters.status ?? 'active')
  }

  if (filters.memberType) query = query.eq('member_type', filters.memberType)

  // Inscripción ABIERTA en la categoría/disciplina pedida: las dos
  // condiciones (`category_id` y `left_on is null`) se evalúan sobre la MISMA
  // fila del embed `match_categories` (PostgREST arma un join, no filtra el
  // array condición por condición), así que una categoría vieja ya cerrada no
  // hace matchear a un socio que ya no juega ahí (00-architecture.md §13.2).
  if (hasCategoryFilter) {
    query =
      categoryIds!.length === 1
        ? query.eq('match_categories.category_id', categoryIds![0])
        : query.in('match_categories.category_id', categoryIds!)
    query = query.is('match_categories.left_on', null)
  }
  // `open_categories` (el que se MUESTRA) siempre recortado a lo abierto,
  // haya o no filtro: es un embed aparte del anterior (alias distinto), así
  // que esto no afecta qué socios entran, solo qué inscripciones se listan.
  query = query.is('open_categories.left_on', null)

  if (includeDebt && filters.debt && filters.debt !== 'any') {
    query =
      filters.debt === 'in_debt'
        ? query.eq('member_debt_status', 'in_debt')
        : query.in('member_debt_status', ['up_to_date', 'credit'])
  }

  if (filters.q && filters.q.trim().length > 0) {
    query = query.ilike('search_text', `%${normalizeSearchTerm(filters.q.trim())}%`)
  }

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

  const rows = ((data ?? []) as unknown as SearchRow[]) ?? []
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  const minorIds = pageRows
    .filter((r) => r.birth_date != null && calculateAge(r.birth_date, today) < 18)
    .map((r) => r.id)
  const clearanceByMember = await currentClearanceExpirationByMember(supabase, minorIds)

  const items: MemberSummary[] = pageRows.map((r) => {
    const age = r.birth_date ? calculateAge(r.birth_date, today) : null
    const isMinor = age !== null && age < 18

    const item: MemberSummary = {
      id: r.id,
      fullName: `${r.last_name}, ${r.first_name}`,
      dni: r.dni,
      hasDni: r.dni != null,
      memberType: r.member_type as MemberType,
      status: r.status as MemberStatus,
      categories: mapCategoryEmbed(r.open_categories),
      familyGroupId: r.family_group_id,
      isPaymentResponsible: r.is_payment_responsible,
      isMinor,
      medicalClearanceStatus: deriveMedicalClearanceStatus(
        isMinor,
        isMinor ? (clearanceByMember.get(r.id) ?? null) : null,
        today,
      ),
    }

    if (includeDebt) {
      item.debtStatus = (r.member_debt_status as DebtStatus | null) ?? 'up_to_date'
      item.balanceCents = r.member_balance_cents ?? 0
      item.monthsDue = r.member_months_due ?? 0
    }

    return item
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
  'id, first_name, last_name, dni, birth_date, address, phone, email, member_type, family_group_id, is_payment_responsible, joined_on, status, status_changed_on, notes, created_at, updated_at'

/**
 * Ficha completa del socio. Combina member + categorías (abiertas e historia,
 * vía `member-categories.model.ts`) + grupo familiar + aptos físicos +
 * historia de estado. La URL firmada del apto vigente NO se resuelve acá
 * (queda en `medicalClearanceUrl: null`): solo la arma `getMemberPage` del
 * controller, y solo si hay adjunto.
 *
 * Tira `DomainError` con `status: 404` si el socio no existe (id inválido o
 * navegado a mano); la page lo puede mapear a `notFound()`.
 */
export async function getMemberDetail(id: number): Promise<MemberDetail> {
  const supabase = await createClient()

  const { data: row, error } = await supabase.from('members').select(DETAIL_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  if (!row) throw new DomainError('El socio no existe', { status: 404 })

  const today = toClubDate()
  const age = row.birth_date ? calculateAge(row.birth_date, today) : null
  const isMinor = age !== null && age < 18

  const [familyGroup, clearances, statusHistory, categoryHistory] = await Promise.all([
    row.family_group_id ? getFamilyGroup(row.family_group_id) : Promise.resolve(null),
    listMedicalClearances(row.id),
    getMemberStatusHistory(row.id),
    listMemberships(row.id),
  ])

  const current = clearances[0] ?? null

  return {
    ...mapMember(row),
    fullName: `${row.last_name}, ${row.first_name}`,
    age,
    isMinor,
    categories: openMemberships(categoryHistory),
    categoryHistory,
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

/** Chequeo previo (no reemplaza la unicidad real, que es el índice `members_dni_key`): evita crear un grupo familiar huérfano cuando el DNI ya existe, el caso común del Minor 10 del review. */
async function memberDniExists(supabase: Awaited<ReturnType<typeof createClient>>, dni: string): Promise<boolean> {
  const { data, error } = await supabase.from('members').select('id').eq('dni', dni).limit(1).maybeSingle()
  if (error) throw error
  return data !== null
}

/**
 * Alta del socio. Si viene `newFamilyGroup`, el grupo se crea DESPUÉS de
 * validar el socio (Zod ya corrió, y acá el chequeo previo de DNI y de la
 * selección de categorías): así el caso común (DNI duplicado, categoría
 * inválida) no deja un grupo familiar vacío dando vueltas en el select de la
 * próxima ficha (03-review.md, Minor 10), ni un socio cargado a mitad de
 * camino por una selección de deportes que la base iba a rechazar.
 *
 * Flujo (Revisión 3, §13.2/§13.6): 1) INSERT del socio SIN `member_type`
 * (derivado por trigger) ni `category_id` (ya no existe la columna); 2)
 * `set_member_categories(id, categoryIds, joinedOn)`. Si el paso 2 falla
 * (una carrera real: alguien desactivó la categoría entre el chequeo previo y
 * la RPC), el socio YA quedó cargado —el insert de arriba ya hizo commit— y
 * esta función avisa con un mensaje que lo dice, en vez de simular una
 * transacción atómica que no existe entre dos llamadas separadas a PostgREST.
 */
export async function createMember(input: CreateMemberInput): Promise<{ id: number }> {
  const supabase = await createClient()

  if (!input.dniPending && input.dni && (await memberDniExists(supabase, input.dni))) {
    throw new DomainError('Ya hay un socio con ese DNI', { field: 'dni' })
  }
  await assertCategorySelection(supabase, input.categoryIds)

  let familyGroupId = input.familyGroupId ?? null
  if (input.newFamilyGroup) {
    const group = await createFamilyGroup(input.newFamilyGroup)
    familyGroupId = group.id
  }

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
      family_group_id: familyGroupId,
      joined_on: input.joinedOn,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()

  if (error) throw translateMemberError(error)

  try {
    await assignCategories({ memberId: data.id, categoryIds: input.categoryIds, effectiveOn: input.joinedOn })
  } catch {
    throw new DomainError('Se cargó el socio pero no sus deportes: agregalos desde la ficha')
  }

  return { id: data.id }
}

/**
 * Modificación. `is_payment_responsible` nunca se escribe acá a propósito: si
 * `familyGroupId` cambia, el trigger `members_clear_responsible_on_group_change`
 * (migración de fixes del review) ya lo pone en `false` en la misma
 * transacción — escribirlo también desde acá sería una segunda fuente de la
 * misma verdad. `.select().maybeSingle()` para distinguir "actualizó 0 filas"
 * (id inexistente, o RLS que igual lo dejó pasar la policy de UPDATE porque
 * `USING` solo mira columnas, y el `WHERE id = ...` no matcheó ninguna fila
 * visible) de un éxito real (Minor 11 del review).
 *
 * Los deportes NO se tocan acá (Revisión 3): van por la Server Action
 * `setMemberCategories`, que llama a `member-categories.model.ts`.
 */
export async function updateMember(id: number, input: UpdateMemberInput): Promise<void> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('members')
    .update({
      first_name: input.firstName,
      last_name: input.lastName,
      dni: input.dniPending ? null : (input.dni ?? null),
      birth_date: input.birthDate ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ? input.email.toLowerCase() : null,
      family_group_id: input.familyGroupId ?? null,
      notes: input.notes ?? null,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) throw translateMemberError(error)
  if (!data) throw new DomainError('El socio no existe', { status: 404 })
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
