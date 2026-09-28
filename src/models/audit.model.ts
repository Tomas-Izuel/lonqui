import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { CLUB_TIME_ZONE, formatDate, formatPeriod } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import type { AuditedTable, AuditEntry, AuditEntryDetail, AuditFilters, AuditOp, AuditActorSource, Page } from './types'

/**
 * Lectura del registro de auditoría (`audit_log`, S1: append-only, sin grants
 * de escritura para nadie — este modelo nunca inserta).
 *
 * El rol se verifica en `audit.controller.ts`, **antes** de llamar acá: la
 * policy de SELECT ya restringe a `admin`, pero un modelo que confía solo en
 * RLS le devolvería una página vacía a un `editor` que llegó por error, y eso
 * se lee como "no hay auditoría" en vez de "no tenés acceso". Este archivo no
 * repite el chequeo.
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/**
 * Las 8 tablas auditadas del slice 1, única fuente (03-review.md, Nit 16): la
 * page de `/auditoria` y `views/audit/audit-labels.ts` traían cada una su
 * propia copia de esta lista, con el riesgo de desincronizarse si se agrega
 * una tabla auditada nueva. Ambas deberían importar esta constante en vez de
 * repetirla (pendiente del lado de frontend, fuera de este slice de fixes).
 */
export const AUDITED_TABLES = [
  'app_users',
  'settings',
  'disciplines',
  'categories',
  'family_groups',
  'members',
  'member_status_events',
  'medical_clearances',
  'member_categories',
  'fee_prices',
  'fees',
  'payments',
] as const satisfies readonly AuditedTable[]

/**
 * Nombre en español de cada columna de las cuatro tablas del slice 2, mismo
 * propósito y misma forma que `FIELD_LABELS` de `views/audit/audit-labels.ts`
 * (que trae las columnas del slice 1). No se fusionan en un solo mapa acá
 * porque ese archivo es de `frontend-react-craftsman` (views/**), fuera de
 * lo que este agente puede tocar: queda documentado para que quien construya
 * el detalle de auditoría de estas tablas copie o importe estas entradas en
 * vez de reinventarlas. `created_by`/`voided_by`/`created_at` no están: son
 * ids/timestamps que ya se muestran resueltos (`actorName`, `occurredAt`),
 * no como "campo cambiado" crudo.
 */
export const AUDIT_FIELD_LABELS: Partial<Record<AuditedTable, Record<string, string>>> = {
  member_categories: {
    category_id: 'categoría',
    joined_on: 'fecha de alta en la categoría',
    left_on: 'fecha de baja de la categoría',
    left_reason: 'motivo de baja',
  },
  fee_prices: {
    scope: 'alcance',
    member_type: 'tipo de socio',
    category_id: 'categoría',
    amount_cents: 'monto',
    valid_from: 'vigente desde',
    notes: 'notas',
  },
  fees: {
    period: 'período',
    kind: 'tipo de cargo',
    amount_cents: 'monto',
    description: 'descripción',
    category_id: 'categoría',
    voided_at: 'anulación',
    void_reason: 'motivo de anulación',
  },
  payments: {
    amount_cents: 'monto',
    paid_on: 'fecha de pago',
    method: 'medio de pago',
    receipt_storage_path: 'comprobante',
    receipt_filename: 'archivo',
    notes: 'notas',
    voided_at: 'anulación',
    void_reason: 'motivo de anulación',
  },
}

// -----------------------------------------------------------------------------
// Zona horaria del club para los filtros de fecha
// -----------------------------------------------------------------------------

// 03-review.md, Minor 14: la versión anterior fijaba `-03:00` a mano.
// Argentina no tiene horario de verano hoy, pero `CLUB_TIME_ZONE`
// (lib/dates.ts) es la única fuente de esa zona en todo el repo justamente
// para que un cambio de política (o un DST futuro) no reviente un cálculo
// hardcodeado en un archivo que nadie vuelve a mirar. Sin un helper ya hecho
// en `lib/dates.ts` para "medianoche de una fecha en la zona del club como
// instante UTC" (lib/ es del hilo principal, no se toca acá), se resuelve acá
// con el truco estándar de Intl: formatear un instante candidato en la zona
// del club y medir el corrimiento contra la hora buscada.
function clubMidnightUtc(date: string): Date {
  const naiveUtc = new Date(`${date}T00:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLUB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(naiveUtc)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)

  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  const offsetMs = asIfUtc - naiveUtc.getTime()
  return new Date(naiveUtc.getTime() - offsetMs)
}

function addDaysToIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Medianoche de ese día en la zona del club, como instante UTC. */
function clubDayStartUtc(date: string): string {
  return clubMidnightUtc(date).toISOString()
}

/** Medianoche del día SIGUIENTE en la zona del club: el límite exclusivo que hace que `to` incluya el día entero. */
function clubDayEndExclusiveUtc(date: string): string {
  return clubMidnightUtc(addDaysToIsoDate(date, 1)).toISOString()
}

// -----------------------------------------------------------------------------
// Cursor keyset: (occurred_at desc, id desc)
// -----------------------------------------------------------------------------

/**
 * Valor listo para el filtro `or=` de PostgREST (mismo motivo que
 * `pgQuote` en `members.model.ts`, Nit 15 del review: la API no escapa nada,
 * pasa el string tal cual en la URL). `occurred_at` sale de un cursor
 * decodificado por el cliente: sin comillas, un valor manipulado no salta la
 * RLS, pero rompe la gramática del filtro con un error genérico en vez de
 * ignorarse como el resto de un cursor inválido.
 */
function pgQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function encodeCursor(occurredAt: string, id: number): string {
  return Buffer.from(`${occurredAt}|${id}`, 'utf8').toString('base64url')
}

/** `null` si el cursor no tiene la forma esperada: se ignora en vez de romper la página (pudo quedar viejo tras un deploy). */
function decodeCursor(cursor: string): { occurredAt: string; id: number } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const separatorIndex = raw.lastIndexOf('|')
    if (separatorIndex === -1) return null

    const occurredAt = raw.slice(0, separatorIndex)
    const id = Number(raw.slice(separatorIndex + 1))
    if (!occurredAt || !Number.isInteger(id)) return null

    return { occurredAt, id }
  } catch {
    return null
  }
}

// -----------------------------------------------------------------------------
// Resolución de actorName
// -----------------------------------------------------------------------------

/**
 * Nombre de cada actor, resuelto con una query propia a `app_users` — no se
 * depende de `app-users.model.ts` (lo posee B1) para no acoplar dos slices en
 * paralelo. El admin que llega hasta acá puede leer cualquier fila de
 * `app_users` (RLS: `auth.uid() = user_id OR is_admin()`), así que la consulta
 * trae todos los ids de la página en una sola vuelta.
 */
async function resolveActorNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(actorIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('app_users').select('user_id, display_name').in('user_id', ids)
  if (error) throw error

  return new Map((data ?? []).map((row) => [row.user_id, row.display_name]))
}

// -----------------------------------------------------------------------------
// Fila cruda
// -----------------------------------------------------------------------------

type AuditRowBase = {
  id: number
  occurred_at: string
  actor_id: string | null
  actor_source: string
  op: string
  table_name: string
  record_id: string | null
  changed_fields: string[] | null
}

/**
 * Columnas jsonb que el listado extrae con `->>` (PostgREST permite pedir un
 * path de un jsonb y alias-earlo: `alias:columna->>clave`), para no traer
 * `old_data`/`new_data` completos en una página. Cubren solo las claves que
 * algún `AuditedTable` usa para su `recordLabel` (ver `buildLabelDraft`).
 * Verificado contra la base local: el select con estos alias devuelve el
 * valor esperado para las 8 tablas auditadas (incluida la conversión a texto
 * de `discipline_id`/`member_id`, que son bigint en Postgres).
 *
 * Slice 2 (B2): suma las columnas de `payments`, `fees`, `fee_prices` y
 * `member_categories` — todas comparten `category_id`/`member_id`, así que
 * solo hicieron falta cinco alias nuevos (`amount_cents`, `paid_on`,
 * `period`, `kind`, `scope`, `member_type`, `valid_from`; `category_id` y
 * `member_id` ya existían).
 */
const LABEL_COLUMNS =
  'new_first_name:new_data->>first_name, old_first_name:old_data->>first_name, ' +
  'new_last_name:new_data->>last_name, old_last_name:old_data->>last_name, ' +
  'new_display_name:new_data->>display_name, old_display_name:old_data->>display_name, ' +
  'new_name:new_data->>name, old_name:old_data->>name, ' +
  'new_discipline_id:new_data->>discipline_id, old_discipline_id:old_data->>discipline_id, ' +
  'new_member_id:new_data->>member_id, old_member_id:old_data->>member_id, ' +
  'new_category_id:new_data->>category_id, old_category_id:old_data->>category_id, ' +
  'new_amount_cents:new_data->>amount_cents, old_amount_cents:old_data->>amount_cents, ' +
  'new_paid_on:new_data->>paid_on, old_paid_on:old_data->>paid_on, ' +
  'new_period:new_data->>period, old_period:old_data->>period, ' +
  'new_kind:new_data->>kind, old_kind:old_data->>kind, ' +
  'new_scope:new_data->>scope, old_scope:old_data->>scope, ' +
  'new_member_type:new_data->>member_type, old_member_type:old_data->>member_type, ' +
  'new_valid_from:new_data->>valid_from, old_valid_from:old_data->>valid_from'

type AuditRow = AuditRowBase & {
  new_first_name: string | null
  old_first_name: string | null
  new_last_name: string | null
  old_last_name: string | null
  new_display_name: string | null
  old_display_name: string | null
  new_name: string | null
  old_name: string | null
  new_discipline_id: string | null
  old_discipline_id: string | null
  new_member_id: string | null
  old_member_id: string | null
  new_category_id: string | null
  old_category_id: string | null
  new_amount_cents: string | null
  old_amount_cents: string | null
  new_paid_on: string | null
  old_paid_on: string | null
  new_period: string | null
  old_period: string | null
  new_kind: string | null
  old_kind: string | null
  new_scope: string | null
  old_scope: string | null
  new_member_type: string | null
  old_member_type: string | null
  new_valid_from: string | null
  old_valid_from: string | null
}

function toEntry(row: AuditRowBase, actorName: string | null, recordLabel: string | null): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    actorName,
    actorSource: row.actor_source as AuditActorSource,
    op: row.op as AuditOp,
    tableName: row.table_name,
    recordId: row.record_id,
    recordLabel,
    changedFields: row.changed_fields,
  }
}

// -----------------------------------------------------------------------------
// Resolución de recordLabel: "Apellido, Nombre" en vez de un id
// -----------------------------------------------------------------------------

/**
 * Valores crudos (new/old) que hacen falta para derivar el `recordLabel` de
 * cualquier `AuditedTable`, sin importar si vienen de las columnas alias del
 * listado (siempre texto, por el `->>`) o del jsonb completo del detalle
 * (tipo nativo: string, number, etc.). `toText`/`toId` normalizan ambos casos.
 */
type RawLabelValues = {
  firstNameNew: unknown
  firstNameOld: unknown
  lastNameNew: unknown
  lastNameOld: unknown
  displayNameNew: unknown
  displayNameOld: unknown
  nameNew: unknown
  nameOld: unknown
  disciplineIdNew: unknown
  disciplineIdOld: unknown
  memberIdNew: unknown
  memberIdOld: unknown
  // Slice 2 (B2): payments, fees, fee_prices, member_categories.
  categoryIdNew: unknown
  categoryIdOld: unknown
  amountCentsNew: unknown
  amountCentsOld: unknown
  paidOnNew: unknown
  paidOnOld: unknown
  periodNew: unknown
  periodOld: unknown
  kindNew: unknown
  kindOld: unknown
  scopeNew: unknown
  scopeOld: unknown
  memberTypeNew: unknown
  memberTypeOld: unknown
  validFromNew: unknown
  validFromOld: unknown
}

function rawValuesFromColumns(row: AuditRow): RawLabelValues {
  return {
    firstNameNew: row.new_first_name,
    firstNameOld: row.old_first_name,
    lastNameNew: row.new_last_name,
    lastNameOld: row.old_last_name,
    displayNameNew: row.new_display_name,
    displayNameOld: row.old_display_name,
    nameNew: row.new_name,
    nameOld: row.old_name,
    disciplineIdNew: row.new_discipline_id,
    disciplineIdOld: row.old_discipline_id,
    memberIdNew: row.new_member_id,
    memberIdOld: row.old_member_id,
    categoryIdNew: row.new_category_id,
    categoryIdOld: row.old_category_id,
    amountCentsNew: row.new_amount_cents,
    amountCentsOld: row.old_amount_cents,
    paidOnNew: row.new_paid_on,
    paidOnOld: row.old_paid_on,
    periodNew: row.new_period,
    periodOld: row.old_period,
    kindNew: row.new_kind,
    kindOld: row.old_kind,
    scopeNew: row.new_scope,
    scopeOld: row.old_scope,
    memberTypeNew: row.new_member_type,
    memberTypeOld: row.old_member_type,
    validFromNew: row.new_valid_from,
    validFromOld: row.old_valid_from,
  }
}

function rawValuesFromJsonb(
  newData: Record<string, unknown> | null,
  oldData: Record<string, unknown> | null,
): RawLabelValues {
  return {
    firstNameNew: newData?.first_name,
    firstNameOld: oldData?.first_name,
    lastNameNew: newData?.last_name,
    lastNameOld: oldData?.last_name,
    displayNameNew: newData?.display_name,
    displayNameOld: oldData?.display_name,
    nameNew: newData?.name,
    nameOld: oldData?.name,
    disciplineIdNew: newData?.discipline_id,
    disciplineIdOld: oldData?.discipline_id,
    memberIdNew: newData?.member_id,
    memberIdOld: oldData?.member_id,
    categoryIdNew: newData?.category_id,
    categoryIdOld: oldData?.category_id,
    amountCentsNew: newData?.amount_cents,
    amountCentsOld: oldData?.amount_cents,
    paidOnNew: newData?.paid_on,
    paidOnOld: oldData?.paid_on,
    periodNew: newData?.period,
    periodOld: oldData?.period,
    kindNew: newData?.kind,
    kindOld: oldData?.kind,
    scopeNew: newData?.scope,
    scopeOld: oldData?.scope,
    memberTypeNew: newData?.member_type,
    memberTypeOld: oldData?.member_type,
    validFromNew: newData?.valid_from,
    validFromOld: oldData?.valid_from,
  }
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

function toId(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** new sobre old: la fila siempre trae la foto completa, pero un futuro trigger que solo audite el delta necesita este fallback. */
function coalesceText(newValue: unknown, oldValue: unknown): string | null {
  return toText(newValue) ?? toText(oldValue)
}

function coalesceId(newValue: unknown, oldValue: unknown): number | null {
  return toId(newValue) ?? toId(oldValue)
}

/**
 * Resultado intermedio de derivar el label de una fila: ya resuelto, o
 * pendiente de una consulta batch a otra tabla (disciplina de una categoría,
 * socio de un evento de alta/baja o de un apto físico, categoría de un cargo
 * o de una inscripción).
 *
 * Slice 2 (B2): `payments`/`fees`/`member_categories` necesitan el socio
 * (reutilizan `memberLabels`, la misma consulta batch de `needsMember`);
 * `fees`/`fee_prices` necesitan el nombre de una categoría (`categoryNames`,
 * consulta nueva). Ninguna de las cuatro necesita el nombre de la
 * DISCIPLINA: el ejemplo del pipeline es "5ta", no "Fútbol masculino · 5ta"
 * (a diferencia de `categories`, que sí la antepone porque el nombre de una
 * categoría sola puede repetirse entre deportes — "Sub 18" existe en más de
 * uno — y acá el cargo ya trae el socio para desambiguar).
 */
type LabelDraft =
  | { kind: 'ready'; label: string | null }
  | { kind: 'needsDiscipline'; categoryName: string | null; disciplineId: number | null }
  | { kind: 'needsMember'; memberId: string | null }
  | { kind: 'needsMemberPaymentLabel'; memberId: string | null; amountCents: number | null; paidOn: string | null }
  | {
      kind: 'needsMemberFeeLabel'
      memberId: string | null
      period: string | null
      categoryId: number | null
      feeKind: string | null
    }
  | {
      kind: 'needsFeePriceLabel'
      scope: string | null
      categoryId: number | null
      memberType: string | null
      amountCents: number | null
      validFrom: string | null
    }
  | { kind: 'needsMemberCategoryLabel'; memberId: string | null; categoryId: number | null }

const FAMILY_GROUP_FALLBACK_LABEL = 'Grupo familiar'

function buildLabelDraft(tableName: string, v: RawLabelValues): LabelDraft {
  switch (tableName as AuditedTable) {
    case 'members': {
      const lastName = coalesceText(v.lastNameNew, v.lastNameOld)
      const firstName = coalesceText(v.firstNameNew, v.firstNameOld)
      if (!lastName && !firstName) return { kind: 'ready', label: null }
      return { kind: 'ready', label: [lastName, firstName].filter(Boolean).join(', ') }
    }
    case 'app_users':
      return { kind: 'ready', label: coalesceText(v.displayNameNew, v.displayNameOld) }
    case 'disciplines':
      return { kind: 'ready', label: coalesceText(v.nameNew, v.nameOld) }
    case 'family_groups':
      return { kind: 'ready', label: coalesceText(v.nameNew, v.nameOld) ?? FAMILY_GROUP_FALLBACK_LABEL }
    case 'categories':
      return {
        kind: 'needsDiscipline',
        categoryName: coalesceText(v.nameNew, v.nameOld),
        disciplineId: coalesceId(v.disciplineIdNew, v.disciplineIdOld),
      }
    case 'member_status_events':
    case 'medical_clearances':
      return { kind: 'needsMember', memberId: coalesceText(v.memberIdNew, v.memberIdOld) }
    case 'payments':
      return {
        kind: 'needsMemberPaymentLabel',
        memberId: coalesceText(v.memberIdNew, v.memberIdOld),
        amountCents: coalesceId(v.amountCentsNew, v.amountCentsOld),
        paidOn: coalesceText(v.paidOnNew, v.paidOnOld),
      }
    case 'fees':
      return {
        kind: 'needsMemberFeeLabel',
        memberId: coalesceText(v.memberIdNew, v.memberIdOld),
        period: coalesceText(v.periodNew, v.periodOld),
        categoryId: coalesceId(v.categoryIdNew, v.categoryIdOld),
        feeKind: coalesceText(v.kindNew, v.kindOld),
      }
    case 'fee_prices':
      return {
        kind: 'needsFeePriceLabel',
        scope: coalesceText(v.scopeNew, v.scopeOld),
        categoryId: coalesceId(v.categoryIdNew, v.categoryIdOld),
        memberType: coalesceText(v.memberTypeNew, v.memberTypeOld),
        amountCents: coalesceId(v.amountCentsNew, v.amountCentsOld),
        validFrom: coalesceText(v.validFromNew, v.validFromOld),
      }
    case 'member_categories':
      return {
        kind: 'needsMemberCategoryLabel',
        memberId: coalesceText(v.memberIdNew, v.memberIdOld),
        categoryId: coalesceId(v.categoryIdNew, v.categoryIdOld),
      }
    case 'settings':
    default:
      // settings no tiene un nombre de registro que mostrar (singleton); una
      // AuditedTable futura sin entrada acá cae acá también, con label null
      // (mejor "sin nombre" que un id crudo mal derivado).
      return { kind: 'ready', label: null }
  }
}

function finalizeLabel(
  draft: LabelDraft,
  disciplineNames: Map<number, string>,
  memberLabels: Map<string, string>,
  categoryNames: Map<number, string>,
): string | null {
  switch (draft.kind) {
    case 'ready':
      return draft.label
    case 'needsDiscipline': {
      const disciplineName = draft.disciplineId !== null ? disciplineNames.get(draft.disciplineId) : undefined
      if (!draft.categoryName) return disciplineName ?? null
      return disciplineName ? `${disciplineName} · ${draft.categoryName}` : draft.categoryName
    }
    case 'needsMember':
      return draft.memberId !== null ? (memberLabels.get(draft.memberId) ?? null) : null
    case 'needsMemberPaymentLabel': {
      const memberLabel = draft.memberId !== null ? memberLabels.get(draft.memberId) : undefined
      if (!memberLabel) return null
      const amount = draft.amountCents !== null ? formatCentsCompact(draft.amountCents) : null
      const date = draft.paidOn !== null ? formatDate(draft.paidOn) : null
      return [memberLabel, amount, date].filter((part): part is string => Boolean(part)).join(' · ')
    }
    case 'needsMemberFeeLabel': {
      const memberLabel = draft.memberId !== null ? memberLabels.get(draft.memberId) : undefined
      if (!memberLabel) return null
      if (draft.feeKind === 'opening_balance') return `${memberLabel} · Saldo anterior al sistema`

      const periodLabel = draft.period !== null ? formatPeriod(draft.period) : null
      if (draft.categoryId === null) {
        return periodLabel ? `${memberLabel} · Cuota social ${periodLabel}` : `${memberLabel} · Cuota social`
      }
      const categoryName = categoryNames.get(draft.categoryId)
      const feeLabel = periodLabel ? `Cuota ${periodLabel}` : 'Cuota'
      return categoryName ? `${memberLabel} · ${feeLabel} · ${categoryName}` : `${memberLabel} · ${feeLabel}`
    }
    case 'needsFeePriceLabel': {
      const scopeLabel =
        draft.scope === 'default'
          ? 'Por defecto'
          : draft.scope === 'member_type'
            ? draft.memberType === 'practicing'
              ? 'Practicantes'
              : 'No practicantes'
            : (draft.categoryId !== null ? categoryNames.get(draft.categoryId) : undefined) ?? 'Categoría'

      const amount = draft.amountCents !== null ? formatCentsCompact(draft.amountCents) : null
      const validFromLabel = draft.validFrom !== null ? formatPeriod(draft.validFrom) : null
      const from = validFromLabel ? `desde ${validFromLabel}` : null
      const suffix = [amount, from].filter((part): part is string => Boolean(part)).join(' ')

      return suffix ? `${scopeLabel} · ${suffix}` : scopeLabel
    }
    case 'needsMemberCategoryLabel': {
      const memberLabel = draft.memberId !== null ? memberLabels.get(draft.memberId) : undefined
      if (!memberLabel) return null
      const categoryName = draft.categoryId !== null ? categoryNames.get(draft.categoryId) : undefined
      return categoryName ? `${memberLabel} · ${categoryName}` : memberLabel
    }
  }
}

/** Nombres de disciplina para las categorías de la página, en una sola consulta batch (evita N+1). */
async function resolveDisciplineNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  disciplineIds: readonly (number | null)[],
): Promise<Map<number, string>> {
  const ids = [...new Set(disciplineIds.filter((id): id is number => id !== null))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('disciplines').select('id, name').in('id', ids)
  if (error) throw error

  return new Map((data ?? []).map((row) => [row.id, row.name]))
}

/**
 * Nombre de categoría para los cargos, valores de cuota e inscripciones de la
 * página, en una sola consulta batch (evita N+1; slice 2, B2).
 */
async function resolveCategoryNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryIds: readonly (number | null)[],
): Promise<Map<number, string>> {
  const ids = [...new Set(categoryIds.filter((id): id is number => id !== null))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('categories').select('id, name').in('id', ids)
  if (error) throw error

  return new Map((data ?? []).map((row) => [row.id, row.name]))
}

/** El `categoryId` de un draft, si lo tiene, para juntar los ids a resolver en una sola consulta batch. */
function categoryIdOf(draft: LabelDraft): number | null {
  return draft.kind === 'needsMemberFeeLabel' || draft.kind === 'needsFeePriceLabel' || draft.kind === 'needsMemberCategoryLabel'
    ? draft.categoryId
    : null
}

/** El `memberId` de un draft, si lo tiene (slice 1: `needsMember`; slice 2: pagos, cargos e inscripciones). */
function memberIdOf(draft: LabelDraft): string | null {
  switch (draft.kind) {
    case 'needsMember':
    case 'needsMemberPaymentLabel':
    case 'needsMemberFeeLabel':
    case 'needsMemberCategoryLabel':
      return draft.memberId
    default:
      return null
  }
}

/** "Apellido, Nombre" de los socios de la página (eventos de alta/baja, aptos físicos), en una sola consulta batch. */
async function resolveMemberLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(memberIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()

  // `members.id` es bigint (number en los tipos generados); memberIds llega como
  // texto (viene de un `->>` o de un jsonb ya parseado), así que se convierte acá.
  const numericIds = ids.map(Number).filter((id) => Number.isFinite(id))
  if (numericIds.length === 0) return new Map()

  const { data, error } = await supabase.from('members').select('id, first_name, last_name').in('id', numericIds)
  if (error) throw error

  return new Map((data ?? []).map((row) => [String(row.id), `${row.last_name}, ${row.first_name}`]))
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

/**
 * Página del registro de auditoría, keyset por `(occurred_at desc, id desc)`
 * (mismo orden que el índice `audit_log_keyset_idx` de S1). No trae
 * `old_data`/`new_data` completos: eso viaja solo en `getAuditEntry`, para no
 * mover jsonb de más en un listado. Sí trae, vía `->>`, las claves puntuales
 * que hacen falta para `recordLabel` (ver `LABEL_COLUMNS`).
 */
export async function getAuditPage(filters: AuditFilters): Promise<Page<AuditEntry>> {
  const supabase = await createClient()
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  let query = supabase
    .from('audit_log')
    .select(`id, occurred_at, actor_id, actor_source, op, table_name, record_id, changed_fields, ${LABEL_COLUMNS}`)

  if (filters.tableName) query = query.eq('table_name', filters.tableName)
  if (filters.actorId) query = query.eq('actor_id', filters.actorId)
  if (filters.recordId) query = query.eq('record_id', filters.recordId)
  if (filters.from) query = query.gte('occurred_at', clubDayStartUtc(filters.from))
  if (filters.to) query = query.lt('occurred_at', clubDayEndExclusiveUtc(filters.to))

  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null
  if (cursor) {
    // occurred_at estrictamente anterior, o igual con id estrictamente menor:
    // el mismo criterio que ORDER BY (occurred_at desc, id desc).
    query = query.or(
      `occurred_at.lt.${pgQuote(cursor.occurredAt)},and(occurred_at.eq.${pgQuote(cursor.occurredAt)},id.lt.${cursor.id})`,
    )
  }

  // Pide uno de más para saber si hay próxima página sin un segundo round trip.
  const { data, error } = await query
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (error) throw error

  const rows = (data ?? []) as AuditRow[]
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  const drafts = pageRows.map((row) => buildLabelDraft(row.table_name, rawValuesFromColumns(row)))

  const [actorNames, disciplineNames, memberLabels, categoryNames] = await Promise.all([
    resolveActorNames(
      supabase,
      pageRows.map((row) => row.actor_id),
    ),
    resolveDisciplineNames(
      supabase,
      drafts.map((draft) => (draft.kind === 'needsDiscipline' ? draft.disciplineId : null)),
    ),
    resolveMemberLabels(supabase, drafts.map(memberIdOf)),
    resolveCategoryNames(supabase, drafts.map(categoryIdOf)),
  ])

  const items = pageRows.map((row, index) =>
    toEntry(
      row,
      row.actor_id ? (actorNames.get(row.actor_id) ?? null) : null,
      finalizeLabel(drafts[index], disciplineNames, memberLabels, categoryNames),
    ),
  )
  const last = pageRows.at(-1)
  const nextCursor = hasMore && last ? encodeCursor(last.occurred_at, last.id) : null

  return { items, nextCursor }
}

/** Detalle de una fila, con `old_data`/`new_data`/`context` completos. */
export async function getAuditEntry(id: number): Promise<AuditEntryDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, occurred_at, actor_id, actor_source, op, table_name, record_id, changed_fields, old_data, new_data, context')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const newData = data.new_data as Record<string, unknown> | null
  const oldData = data.old_data as Record<string, unknown> | null
  const draft = buildLabelDraft(data.table_name, rawValuesFromJsonb(newData, oldData))

  const [actorNames, disciplineNames, memberLabels, categoryNames] = await Promise.all([
    resolveActorNames(supabase, [data.actor_id]),
    resolveDisciplineNames(supabase, [draft.kind === 'needsDiscipline' ? draft.disciplineId : null]),
    resolveMemberLabels(supabase, [memberIdOf(draft)]),
    resolveCategoryNames(supabase, [categoryIdOf(draft)]),
  ])

  const entry = toEntry(
    data as AuditRowBase,
    data.actor_id ? (actorNames.get(data.actor_id) ?? null) : null,
    finalizeLabel(draft, disciplineNames, memberLabels, categoryNames),
  )

  return {
    ...entry,
    oldData,
    newData,
    context: data.context as Record<string, unknown> | null,
  }
}
