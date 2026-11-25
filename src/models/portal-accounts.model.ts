import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { pickWhatsAppPhone } from '@/lib/phone'
import { isRawPostgresMessage } from '@/models/pg-errors'
import type {
  PortalAccountStatus,
  PortalInviteTarget,
  PortalLinkedAccount,
  PortalRelationship,
} from '@/models/types'

/**
 * Cuentas de la app de socios y sus vínculos, vistos desde el panel
 * (pipeline 2026-11-24-app-socios, S2). Único lugar que le habla a
 * `portal_accounts` / `portal_account_members` desde el panel.
 *
 * - Lecturas: por RLS (SELECT con `portal.review` o `portal.invite`). Sin
 *   ninguno de los dos, todo vuelve vacío.
 * - Escrituras: SOLO por RPC (`revoke_portal_link`, `set_portal_account_status`).
 *   Las tablas no tienen INSERT/UPDATE/DELETE para `authenticated`.
 * - Siempre el cliente de sesión: la auditoría toma el actor de `auth.uid()`.
 * - Nunca se loguea DNI, teléfono, email ni nombres: ids.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const REASON = z
  .string('Indicá el motivo')
  .trim()
  .min(3, 'El motivo tiene que tener al menos 3 caracteres')
  .max(500, 'El motivo no puede tener más de 500 caracteres')

export const revokePortalLinkSchema = z.object({ linkId: z.number().int().positive(), reason: REASON }).strict()
export type RevokePortalLinkInput = z.infer<typeof revokePortalLinkSchema>

export const setPortalAccountStatusSchema = z
  .object({
    // `guid` y no `uuid`: Zod v4 valida los bits de versión de `uuid`, y el id viene de Auth.
    accountId: z.guid('La cuenta no es válida'),
    status: z.enum(['active', 'blocked'] satisfies PortalAccountStatus[]),
    reason: REASON,
  })
  .strict()
export type SetPortalAccountStatusInput = z.infer<typeof setPortalAccountStatusSchema>

// -----------------------------------------------------------------------------
// Errores de Postgres → DomainError (compartido por los tres modelos del portal)
// -----------------------------------------------------------------------------

const INSUFFICIENT_PRIVILEGE = '42501'
const CHECK_VIOLATION = '23514'
const NO_DATA_FOUND = 'P0002'

const ACCOUNT_DNI_UNIQUE = 'portal_accounts_dni_key'

/**
 * Las RPC y los triggers del portal levantan `insufficient_privilege`,
 * `check_violation` y `no_data_found` con el mensaje YA redactado para el
 * usuario ("Indicá el motivo", "El enlace ya no está vigente"): se muestra.
 * Todo lo demás (un `permission denied for table`, una constraint cruda, una
 * caída de red) NO: se devuelve tal cual para que `failure()` lo loguee y el
 * usuario vea un genérico.
 */
export function translatePortalRpcError(error: PostgrestError): unknown {
  if (error.code === '23505' && error.message.includes(ACCOUNT_DNI_UNIQUE)) {
    return new DomainError('Ya hay otra cuenta activa con ese DNI: no se puede desbloquear')
  }
  if (isRawPostgresMessage(error.message)) return error
  if (error.code === INSUFFICIENT_PRIVILEGE && !error.message.startsWith('permission denied')) {
    return new DomainError(error.message, { status: 403 })
  }
  if (error.code === CHECK_VIOLATION) return new DomainError(error.message)
  if (error.code === NO_DATA_FOUND) return new DomainError(error.message, { status: 404 })
  return error
}

// -----------------------------------------------------------------------------
// Utilidades compartidas
// -----------------------------------------------------------------------------

const PAGE_SIZE = 1000
const IN_CHUNK = 200

export function chunk<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Lee todas las páginas de una consulta. PostgREST corta en `max_rows` (1000)
 * SIN error: una lista que pueda crecer se pagina siempre.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

/**
 * Nombre de quien hizo algo, desde `app_users.display_name`. Una sola consulta
 * para todos los ids. Ojo: la RLS de `app_users` deja a un editor ver SOLO su
 * propia fila (el admin ve todas), así que para el resto el nombre vuelve
 * ausente y la vista muestra "—". Es limitación de la base, no un bug de acá.
 */
export async function resolveActorNames(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)))
  const names = new Map<string, string>()
  if (unique.length === 0) return names

  const supabase = await createClient()
  for (const part of chunk(unique)) {
    const { data, error } = await supabase.from('app_users').select('user_id, display_name').in('user_id', part)
    if (error) throw error
    for (const row of data ?? []) names.set(row.user_id, row.display_name)
  }
  return names
}

/** Código de área por defecto del club (`settings`), para normalizar teléfonos sin área. */
export async function getDefaultPhoneAreaCode(): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('settings').select('default_phone_area_code').eq('id', 1).maybeSingle()
  if (error) throw error
  return data?.default_phone_area_code ?? null
}

/** El socio y su grupo, o `null` si no existe (o la RLS no lo deja ver). */
export async function getMemberRef(memberId: number): Promise<{ id: number; familyGroupId: number | null } | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('members').select('id, family_group_id').eq('id', memberId).maybeSingle()
  if (error) throw error
  return data ? { id: data.id, familyGroupId: data.family_group_id } : null
}

/** Ids de todos los integrantes del grupo (activos o no: la visibilidad del portal los incluye a todos). */
export async function getFamilyGroupMemberIds(groupId: number): Promise<number[]> {
  const supabase = await createClient()
  const rows = await fetchAllRows<{ id: number }>((from, to) =>
    supabase.from('members').select('id').eq('family_group_id', groupId).order('id').range(from, to),
  )
  return rows.map((r) => r.id)
}

/** Teléfono E.164 de la cuenta (el que dio al registrarse), para el `wa.me` del enlace de ingreso. */
export async function getAccountPhoneE164(accountId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('portal_accounts')
    .select('phone_e164')
    .eq('user_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data?.phone_e164 ?? null
}

// -----------------------------------------------------------------------------
// Cuentas vinculadas (ficha del socio y del grupo)
// -----------------------------------------------------------------------------

type LinkRow = {
  id: number
  account_id: string
  member_id: number
  relationship: string
  family_scope: boolean
  created_at: string
  linked_by: string | null
  portal_accounts: { first_name: string; last_name: string; status: string } | null
}

type LoginTokenRow = {
  account_id: string | null
  created_at: string
  created_by: string
  consumed_at: string | null
}

const LINK_SELECT =
  'id, account_id, member_id, relationship, family_scope, created_at, linked_by, portal_accounts(first_name, last_name, status)'

/**
 * Vínculos NO revocados sobre esos socios, con la cuenta, quién la invitó y el
 * último enlace de ingreso emitido (00 §4.A.7: "emitido por X, usado el día Z").
 *
 * `visibleToMemberId`: para la ficha de UN socio. Una cuenta lo ve si el vínculo
 * es directo a él, o si es de alcance familiar (`family_scope`) sobre cualquier
 * integrante de su grupo (un hermano). Sin esto, `getMemberPortalAccess`
 * mostraría solo los vínculos directos y ocultaría a la madre que entró por un
 * hermano. Para la ficha del grupo se pasa `null`: todos los vínculos del grupo.
 */
export async function listLinkedAccounts(
  memberIds: readonly number[],
  visibleToMemberId: number | null,
): Promise<PortalLinkedAccount[]> {
  if (memberIds.length === 0) return []
  const supabase = await createClient()

  const rows: LinkRow[] = []
  for (const part of chunk(memberIds)) {
    const { data, error } = await supabase
      .from('portal_account_members')
      .select(LINK_SELECT)
      .in('member_id', part)
      .is('revoked_at', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as LinkRow[]))
  }

  const links = rows.filter((l) => visibleToMemberId === null || l.member_id === visibleToMemberId || l.family_scope)
  if (links.length === 0) return []

  const accountIds = Array.from(new Set(links.map((l) => l.account_id)))
  const lastLoginByAccount = new Map<string, LoginTokenRow>()
  for (const part of chunk(accountIds)) {
    const { data, error } = await supabase
      .from('portal_access_tokens')
      .select('account_id, created_at, created_by, consumed_at')
      .eq('purpose', 'login')
      .in('account_id', part)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (error) throw error
    for (const t of (data ?? []) as LoginTokenRow[]) {
      // Viene ordenado del más nuevo al más viejo: el primero de cada cuenta es el último.
      if (t.account_id && !lastLoginByAccount.has(t.account_id)) lastLoginByAccount.set(t.account_id, t)
    }
  }

  const names = await resolveActorNames([
    ...links.map((l) => l.linked_by),
    ...Array.from(lastLoginByAccount.values()).map((t) => t.created_by),
  ])

  return links.map((l) => {
    const login = lastLoginByAccount.get(l.account_id)
    return {
      linkId: l.id,
      accountId: l.account_id,
      firstName: l.portal_accounts?.first_name ?? '',
      lastName: l.portal_accounts?.last_name ?? '',
      relationship: l.relationship as PortalRelationship,
      familyScope: l.family_scope,
      accountStatus: (l.portal_accounts?.status ?? 'active') as PortalAccountStatus,
      linkedAt: l.created_at,
      linkedByName: l.linked_by ? (names.get(l.linked_by) ?? null) : null,
      lastLoginLink: login
        ? {
            createdAt: login.created_at,
            createdByName: names.get(login.created_by) ?? null,
            consumedAt: login.consumed_at,
          }
        : null,
    }
  })
}

// -----------------------------------------------------------------------------
// Teléfono del padrón para el `wa.me` de una invitación
// -----------------------------------------------------------------------------

type PhoneMemberRow = {
  id: number
  phone: string | null
  family_group_id: number | null
  is_payment_responsible: boolean
  status: string
  first_name: string
  last_name: string
  family_groups: { payer_contact_phone: string | null } | null
}

const PHONE_MEMBER_SELECT =
  'id, phone, family_group_id, is_payment_responsible, status, first_name, last_name, family_groups(payer_contact_phone)'

function byName(a: PhoneMemberRow, b: PhoneMemberRow): number {
  return (
    a.last_name.localeCompare(b.last_name, 'es') ||
    a.first_name.localeCompare(b.first_name, 'es') ||
    a.id - b.id
  )
}

/**
 * Teléfonos candidatos (crudos, en orden de prioridad) para mandar una
 * invitación por WhatsApp (contrato S2):
 *  - invitación al grupo: `payer_contact_phone` del grupo, si no el del
 *    responsable de pago, si no el del ancla;
 *  - invitación a un socio: el del socio.
 * El que decide cuál sirve es `pickWhatsAppPhone` (el primero normalizable).
 */
export async function getInvitePhoneSources(memberId: number, familyScope: boolean): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('members').select(PHONE_MEMBER_SELECT).eq('id', memberId).maybeSingle()
  if (error) throw error
  if (!data) return []

  const anchor = data as unknown as PhoneMemberRow
  if (!familyScope || anchor.family_group_id === null) return anchor.phone ? [anchor.phone] : []

  const { data: responsible, error: responsibleError } = await supabase
    .from('members')
    .select('phone')
    .eq('family_group_id', anchor.family_group_id)
    .eq('is_payment_responsible', true)
    .eq('status', 'active')
    .limit(1)
  if (responsibleError) throw responsibleError

  return [anchor.family_groups?.payer_contact_phone, responsible?.[0]?.phone, anchor.phone].filter(
    (p): p is string => !!p,
  )
}

/**
 * Lo mismo para la ficha del GRUPO ("¿hay teléfono para invitar al grupo?"):
 * el ancla es el responsable de pago activo, si no el primer integrante activo
 * por nombre.
 */
export async function getGroupPhoneSources(groupId: number): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('members')
    .select(PHONE_MEMBER_SELECT)
    .eq('family_group_id', groupId)
    .eq('status', 'active')
    .limit(PAGE_SIZE)
  if (error) throw error

  const members = ((data ?? []) as unknown as PhoneMemberRow[]).slice().sort(byName)
  if (members.length === 0) return []
  const anchor = members.find((m) => m.is_payment_responsible) ?? members[0]
  return [members[0].family_groups?.payer_contact_phone, anchor.phone].filter((p): p is string => !!p)
}

// -----------------------------------------------------------------------------
// "Invitar por categoría"
// -----------------------------------------------------------------------------

type CategoryMemberRow = {
  member_id: number
  members: {
    id: number
    first_name: string
    last_name: string
    phone: string | null
    status: string
    family_group_id: number | null
    is_payment_responsible: boolean
    family_groups: { name: string | null; payer_contact_phone: string | null } | null
  } | null
}

type GroupMemberRow = {
  id: number
  first_name: string
  last_name: string
  phone: string | null
  status: string
  family_group_id: number
  is_payment_responsible: boolean
}

type ActiveLinkRow = {
  member_id: number
  family_scope: boolean
  portal_accounts: { status: string } | null
}

const fullName = (m: { first_name: string; last_name: string }): string => `${m.last_name}, ${m.first_name}`

/**
 * Grupos (o socios sin grupo) con al menos un socio ACTIVO en la categoría que
 * todavía NO ven una cuenta activa. Es la lista de "Invitar por categoría": una
 * fila, un botón de WhatsApp.
 *
 * "Ya visible" = cada integrante activo del grupo lo ve alguna cuenta ACTIVA,
 * sea por un vínculo directo o por un `family_scope` sobre CUALQUIER integrante
 * del grupo (que cubre a todos), esté ese ancla activo o dado de baja. Un grupo donde solo el adolescente tiene su
 * propia cuenta sigue apareciendo: la madre todavía no está. Bloqueada o
 * revocada = no cuenta, coherente con `private.portal_member_ids()`.
 *
 * Ancla (a quién se atan `member_id` y `family_scope`): el responsable de pago
 * ACTIVO del grupo aunque no juegue en la categoría; si no hay, el primero por
 * nombre entre los de la categoría. Sin grupo, el propio socio.
 */
export async function listCategoryInviteTargets(categoryId: number): Promise<PortalInviteTarget[]> {
  const supabase = await createClient()

  // Inscripciones abiertas de la categoría (hoy: sin fecha de salida), socios activos.
  const enrolled = await fetchAllRows<CategoryMemberRow>((from, to) =>
    supabase
      .from('member_categories')
      .select(
        'member_id, members!inner(id, first_name, last_name, phone, status, family_group_id, is_payment_responsible, family_groups(name, payer_contact_phone))',
      )
      .eq('category_id', categoryId)
      .is('left_on', null)
      .eq('members.status', 'active')
      .order('member_id')
      .range(from, to),
  )

  const inCategory = new Map<number, NonNullable<CategoryMemberRow['members']>>()
  for (const row of enrolled) if (row.members) inCategory.set(row.members.id, row.members)
  if (inCategory.size === 0) return []

  // Los integrantes de cada grupo involucrado (aunque no jueguen acá ni estén activos).
  const groupIds = Array.from(
    new Set(
      Array.from(inCategory.values())
        .map((m) => m.family_group_id)
        .filter((id): id is number => id !== null),
    ),
  )
  const groupMembers: GroupMemberRow[] = []
  for (const part of chunk(groupIds)) {
    const rows = await fetchAllRows<GroupMemberRow>((from, to) =>
      supabase
        .from('members')
        .select('id, first_name, last_name, phone, status, family_group_id, is_payment_responsible')
        .in('family_group_id', part)
        .order('id')
        .range(from, to),
    )
    groupMembers.push(...rows)
  }
  // Todos los integrantes (activos o no) sirven para BUSCAR vínculos: la visibilidad
  // del portal no mira el estado del ancla (`private.portal_member_ids()`), así que
  // un `family_scope` anclado a un integrante dado de baja sigue cubriendo al grupo.
  // Solo los ACTIVOS cuentan para "todos cubiertos" y para elegir el ancla.
  const activeByGroup = new Map<number, GroupMemberRow[]>()
  for (const m of groupMembers) {
    if (m.status !== 'active') continue
    const list = activeByGroup.get(m.family_group_id) ?? []
    list.push(m)
    activeByGroup.set(m.family_group_id, list)
  }

  // Vínculos activos (cuenta activa, vínculo no revocado) que tocan a esos socios.
  const relevantMemberIds = Array.from(new Set([...inCategory.keys(), ...groupMembers.map((m) => m.id)]))
  const links: ActiveLinkRow[] = []
  for (const part of chunk(relevantMemberIds)) {
    const rows = await fetchAllRows<ActiveLinkRow>((from, to) =>
      supabase
        .from('portal_account_members')
        .select('member_id, family_scope, portal_accounts!inner(status)')
        .in('member_id', part)
        .is('revoked_at', null)
        .eq('portal_accounts.status', 'active')
        .order('id')
        .range(from, to),
    )
    links.push(...rows)
  }

  const directlyLinked = new Set(links.map((l) => l.member_id))
  const memberGroup = new Map<number, number>()
  for (const m of groupMembers) memberGroup.set(m.id, m.family_group_id)
  for (const m of inCategory.values()) if (m.family_group_id !== null) memberGroup.set(m.id, m.family_group_id)
  const scopedGroups = new Set<number>()
  for (const l of links) {
    const group = memberGroup.get(l.member_id)
    if (l.family_scope && group !== undefined) scopedGroups.add(group)
  }

  const areaCode = await getDefaultPhoneAreaCode()
  const targets: PortalInviteTarget[] = []

  // Socios sin grupo: una fila por socio.
  for (const m of inCategory.values()) {
    if (m.family_group_id !== null) continue
    if (directlyLinked.has(m.id)) continue
    targets.push({
      familyGroupId: null,
      anchorMemberId: m.id,
      label: fullName(m),
      memberNames: [fullName(m)],
      hasPhoneOnFile: pickWhatsAppPhone([m.phone], areaCode) !== null,
    })
  }

  // Grupos.
  for (const groupId of groupIds) {
    if (scopedGroups.has(groupId)) continue
    const active = (activeByGroup.get(groupId) ?? []).slice().sort((a, b) => fullName(a).localeCompare(fullName(b), 'es'))
    if (active.length > 0 && active.every((m) => directlyLinked.has(m.id))) continue

    const playing = Array.from(inCategory.values())
      .filter((m) => m.family_group_id === groupId)
      .sort((a, b) => fullName(a).localeCompare(fullName(b), 'es'))
    if (playing.length === 0) continue

    const responsible = active.find((m) => m.is_payment_responsible)
    const anchor = responsible ?? active.find((m) => m.id === playing[0].id) ?? playing[0]
    const group = playing[0].family_groups

    targets.push({
      familyGroupId: groupId,
      anchorMemberId: anchor.id,
      label: group?.name?.trim() || (responsible ? responsible.last_name : playing[0].last_name) || 'Grupo familiar',
      memberNames: playing.map(fullName),
      hasPhoneOnFile:
        pickWhatsAppPhone([group?.payer_contact_phone, responsible?.phone, anchor.phone], areaCode) !== null,
    })
  }

  return targets.sort((a, b) => a.label.localeCompare(b.label, 'es') || a.anchorMemberId - b.anchorMemberId)
}

// -----------------------------------------------------------------------------
// Escrituras (RPC)
// -----------------------------------------------------------------------------

/** Revoca un vínculo (motivo obligatorio). Corta el acceso al instante: `portal_member_ids()` deja de devolverlo. */
export async function revokePortalLink(input: RevokePortalLinkInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('revoke_portal_link', { p_link_id: input.linkId, p_reason: input.reason })
  if (error) throw translatePortalRpcError(error)
}

/** Bloquea o desbloquea una cuenta (motivo obligatorio). Bloquear también revoca sus enlaces de ingreso pendientes. */
export async function setPortalAccountStatus(input: SetPortalAccountStatusInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_portal_account_status', {
    p_user_id: input.accountId,
    p_status: input.status,
    p_reason: input.reason,
  })
  if (error) throw translatePortalRpcError(error)
}
