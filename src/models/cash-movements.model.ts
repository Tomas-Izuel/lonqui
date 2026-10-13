import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError, PermissionError } from '@/lib/errors'
import { toClubDate, lastDayOfPeriod } from '@/lib/dates'
import type { CashMovement, CashMovementFilters, PaymentMethod } from '@/models/types'

/**
 * Movimientos de caja que no son cuota (`cash_movements`). Mismo molde que
 * `payments.model.ts`: `batchId` lo genera SIEMPRE el formulario y es la
 * idempotencia del submit (índice único `cash_movements_batch_id_key`); un
 * ingreso mal cargado no se edita: se anula con motivo. Nunca toca deuda.
 */

// -----------------------------------------------------------------------------
// Comprobantes: mismo bucket `attachments`, prefijo propio
// -----------------------------------------------------------------------------

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}
const ALLOWED_MIME_TYPES = Object.keys(MIME_EXTENSIONS) as [string, ...string[]]

export const MAX_CASH_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024
export const CASH_RECEIPT_PATH_PREFIX = 'cash-receipts/'

/** `cash-receipts/<batchId>/<uuid>.<ext>`, armada en el servidor (nunca la manda el browser). */
export function buildCashReceiptPath(batchId: string, mimeType: string): string {
  const ext = MIME_EXTENSIONS[mimeType]
  return `${CASH_RECEIPT_PATH_PREFIX}${batchId}/${crypto.randomUUID()}.${ext}`
}

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export const MIN_CASH_DATE = '2020-01-01'
const DATE_FUTURE_MESSAGE = 'La fecha del ingreso no puede ser futura'
const DATE_TOO_OLD_MESSAGE = 'La fecha del ingreso no puede ser anterior a 2020. Revisá el año'

export const prepareCashReceiptUploadSchema = z
  .object({
    batchId: z.uuid('El identificador del ingreso no es válido'),
    mimeType: z.enum(ALLOWED_MIME_TYPES, 'Subí un archivo PDF, JPG, PNG o WEBP'),
    sizeBytes: z
      .number('El archivo está vacío')
      .int('El archivo está vacío')
      .positive('El archivo está vacío')
      .max(MAX_CASH_RECEIPT_SIZE_BYTES, 'El archivo no puede pesar más de 10 MB'),
  })
  .strict()
export type PrepareCashReceiptUploadInput = z.infer<typeof prepareCashReceiptUploadSchema>

export const registerCashMovementSchema = z
  .object({
    batchId: z.uuid('El identificador del ingreso no es válido'),
    conceptId: z.number('Elegí el concepto').int('Elegí el concepto').positive('Elegí el concepto'),
    sponsorId: z.number().int().positive('Elegí el sponsor').nullish(),
    amountCents: z
      .number('Ingresá el monto')
      .int('El monto no es válido')
      .positive('El monto tiene que ser mayor a cero'),
    occurredOn: z.iso.date('La fecha no es válida'),
    method: z.enum(['cash', 'transfer'] satisfies PaymentMethod[], 'Elegí el medio: efectivo o transferencia'),
    receiptPath: z
      .string()
      .refine((path) => path.startsWith(CASH_RECEIPT_PATH_PREFIX), 'El comprobante no corresponde a un ingreso')
      .nullish(),
    description: z
      .string()
      .trim()
      .max(500, 'El detalle no puede tener más de 500 caracteres')
      .nullish(),
  })
  .strict()
  .refine((data) => data.occurredOn <= toClubDate(), { message: DATE_FUTURE_MESSAGE, path: ['occurredOn'] })
  .refine((data) => data.occurredOn >= MIN_CASH_DATE, { message: DATE_TOO_OLD_MESSAGE, path: ['occurredOn'] })
export type RegisterCashMovementInput = z.infer<typeof registerCashMovementSchema>

export const voidCashMovementSchema = z
  .object({
    movementId: z.number().int().positive(),
    reason: z
      .string('El motivo tiene que tener al menos 3 caracteres')
      .trim()
      .min(3, 'El motivo tiene que tener al menos 3 caracteres')
      .max(500, 'El motivo no puede tener más de 500 caracteres'),
  })
  .strict()
export type VoidCashMovementInput = z.infer<typeof voidCashMovementSchema>

export const getCashReceiptUrlSchema = z.object({ movementId: z.number().int().positive() }).strict()
export type GetCashReceiptUrlInput = z.infer<typeof getCashReceiptUrlSchema>

export const listCashMovementsSchema = z
  .object({
    period: z.iso.date('El período no es válido'),
    conceptId: z.number().int().positive().optional(),
    sponsorId: z.number().int().positive().optional(),
  })
  .strict()

// -----------------------------------------------------------------------------
// Traducción de errores de Postgres (los mensajes los redacta la migración)
// -----------------------------------------------------------------------------

const BATCH_UNIQUE_INDEX = 'cash_movements_batch_id_key'

function isBatchAlreadyRegistered(error: PostgrestError): boolean {
  return error.code === '23505' && error.message.includes(BATCH_UNIQUE_INDEX)
}

const INSERT_GUARD_FIELDS: Record<string, string | undefined> = {
  [DATE_FUTURE_MESSAGE]: 'occurredOn',
  'La fecha del ingreso es demasiado vieja': 'occurredOn',
  'El concepto no existe': 'conceptId',
  'El concepto está desactivado': 'conceptId',
  'El concepto no corresponde a este tipo de movimiento': 'conceptId',
  'Elegí el sponsor': 'sponsorId',
  'El sponsor no existe': 'sponsorId',
  'El sponsor está desactivado': 'sponsorId',
}

function translateInsertError(error: PostgrestError): unknown {
  if (error.code === '23514' || error.code === '23503') {
    if (error.message in INSERT_GUARD_FIELDS) {
      return new DomainError(error.message, { field: INSERT_GUARD_FIELDS[error.message] })
    }
    if (error.message.includes('cash_movements_amount_cents_check')) {
      return new DomainError('El monto tiene que ser mayor a cero', { field: 'amountCents' })
    }
    if (error.message.includes('cash_movements_receipt_storage_path_check')) {
      return new DomainError('El comprobante no corresponde a un ingreso', { field: 'receiptPath' })
    }
  }
  return error
}

const VOID_GUARD_MESSAGES = new Set(['Este ingreso ya está anulado'])

function translateVoidError(error: PostgrestError): unknown {
  if (error.code === '23514' && VOID_GUARD_MESSAGES.has(error.message)) {
    return new DomainError(error.message)
  }
  if (error.code === '23514' && error.message === 'Para anular un ingreso hace falta un motivo') {
    return new DomainError(error.message, { field: 'reason' })
  }
  if (error.code === '23514' && error.message.includes('cash_movements_void_triad')) {
    return new DomainError('El motivo tiene que tener al menos 3 caracteres', { field: 'reason' })
  }
  if (error.code === '42501') {
    return new PermissionError()
  }
  return error
}

// -----------------------------------------------------------------------------
// Mapeo
// -----------------------------------------------------------------------------

type CashMovementRow = {
  id: number
  direction: string
  concept_id: number
  sponsor_id: number | null
  amount_cents: number
  occurred_on: string
  method: string
  receipt_storage_path: string | null
  receipt_filename: string | null
  description: string | null
  batch_id: string
  created_by: string | null
  created_at: string
  voided_at: string | null
  void_reason: string | null
  cash_concepts: { name: string } | null
  sponsors: { name: string } | null
}

const MOVEMENT_SELECT =
  'id, direction, concept_id, sponsor_id, amount_cents, occurred_on, method, receipt_storage_path, receipt_filename, description, batch_id, created_by, created_at, voided_at, void_reason, cash_concepts(name), sponsors(name)'

function mapRow(row: CashMovementRow, createdByName: string | null): CashMovement {
  return {
    id: row.id,
    direction: row.direction as CashMovement['direction'],
    conceptId: row.concept_id,
    conceptName: row.cash_concepts?.name ?? '',
    sponsorId: row.sponsor_id,
    sponsorName: row.sponsors?.name ?? null,
    amountCents: row.amount_cents,
    occurredOn: row.occurred_on,
    method: row.method as PaymentMethod,
    hasReceipt: row.receipt_storage_path !== null,
    receiptFilename: row.receipt_filename,
    description: row.description,
    batchId: row.batch_id,
    createdByName,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    voided: row.voided_at !== null,
  }
}

/**
 * Nombres de quien cargó, en una sola consulta batch (sin N+1). `app_users`
 * solo deja leer a quien tiene permiso: para el resto queda null y la vista
 * muestra "—" (limitación heredada de pagos).
 */
async function mapWithCreators(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: CashMovementRow[],
): Promise<CashMovement[]> {
  const ids = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => id !== null))]
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const { data, error } = await supabase.from('app_users').select('user_id, display_name').in('user_id', ids)
    if (error) throw error
    for (const row of data ?? []) names.set(row.user_id, row.display_name)
  }
  return rows.map((row) => mapRow(row, row.created_by ? (names.get(row.created_by) ?? null) : null))
}

// -----------------------------------------------------------------------------
// Escrituras
// -----------------------------------------------------------------------------

/**
 * Registra un ingreso. Un reintento con el mismo `batchId` choca contra el
 * índice único y se trata como éxito idempotente (`alreadyRegistered`),
 * devolviendo la fila que ya había quedado.
 */
export async function registerCashMovement(
  input: RegisterCashMovementInput,
): Promise<{ movementId: number; amountCents: number; alreadyRegistered: boolean }> {
  const supabase = await createClient()

  const receiptPath = input.receiptPath ?? null

  // La ruta la arma `buildCashReceiptPath` con el batchId de ESTE pedido: una
  // ruta ajena (otro lote, o un archivo de otro bucket lógico) no se acepta.
  if (receiptPath && !receiptPath.startsWith(`${CASH_RECEIPT_PATH_PREFIX}${input.batchId}/`)) {
    throw new DomainError('El comprobante no corresponde a este ingreso', { field: 'receiptPath' })
  }
  const { data, error } = await supabase
    .from('cash_movements')
    .insert({
      direction: 'income',
      concept_id: input.conceptId,
      sponsor_id: input.sponsorId ?? null,
      amount_cents: input.amountCents,
      occurred_on: input.occurredOn,
      method: input.method,
      receipt_storage_path: receiptPath,
      // El nombre original no viaja (la ruta es <uuid>.<ext>): se guarda el de la ruta.
      receipt_filename: receiptPath ? (receiptPath.split('/').at(-1) ?? null) : null,
      description: input.description || null,
      batch_id: input.batchId,
    })
    .select('id, amount_cents')
    .single()

  if (error) {
    if (isBatchAlreadyRegistered(error)) {
      const { data: existing, error: existingError } = await supabase
        .from('cash_movements')
        .select('id, amount_cents')
        .eq('batch_id', input.batchId)
        .single()
      if (existingError) throw existingError
      return { movementId: existing.id, amountCents: existing.amount_cents, alreadyRegistered: true }
    }
    throw translateInsertError(error)
  }

  return { movementId: data.id, amountCents: data.amount_cents, alreadyRegistered: false }
}

/**
 * Anula un ingreso. La policy de UPDATE admite `income.register` o
 * `income.void` y el guard exige `income.void`: sin permiso llega 42501, y
 * 0 filas es "no existe".
 */
export async function voidCashMovement(movementId: number, reason: string): Promise<void> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cash_movements')
    .update({ void_reason: reason })
    .eq('id', movementId)
    .select('id')
    .maybeSingle()

  if (error) throw translateVoidError(error)
  if (!data) throw new DomainError('El ingreso no existe', { status: 404 })
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

/** Ruta del comprobante, o null si no existe o no tiene. La action firma la URL. */
export async function getCashReceiptPath(movementId: number): Promise<string | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cash_movements')
    .select('receipt_storage_path')
    .eq('id', movementId)
    .maybeSingle()
  if (error) throw error

  return data?.receipt_storage_path ?? null
}

export const CASH_MOVEMENTS_LIST_LIMIT = 500

/** Ingresos del mes (por `occurred_on`), anulados incluidos con `voided: true`. Máximo 500: el controller marca `truncated`. */
export async function listCashMovements(filters: CashMovementFilters): Promise<CashMovement[]> {
  const supabase = await createClient()

  let query = supabase
    .from('cash_movements')
    .select(MOVEMENT_SELECT)
    .gte('occurred_on', filters.period)
    .lte('occurred_on', lastDayOfPeriod(filters.period))
  if (filters.conceptId !== undefined) query = query.eq('concept_id', filters.conceptId)
  if (filters.sponsorId !== undefined) query = query.eq('sponsor_id', filters.sponsorId)

  const { data, error } = await query
    .order('occurred_on', { ascending: false })
    .order('id', { ascending: false })
    // Uno de más: así el controller sabe si hay más que el techo (`truncated` exacto).
    .limit(CASH_MOVEMENTS_LIST_LIMIT + 1)
  if (error) throw error

  return mapWithCreators(supabase, (data ?? []) as unknown as CashMovementRow[])
}

const EXPORT_PAGE_SIZE = 1000
const EXPORT_MAX_ROWS = 20000

/**
 * Todos los ingresos del mes para exportar. PostgREST corta en `max_rows`
 * (1000) sin error: se pagina con `range` hasta agotar. Si se llega al techo
 * duro se tira un `DomainError`: un CSV incompleto sin aviso es peor que nada.
 */
export async function listAllCashMovements(filters: CashMovementFilters): Promise<CashMovement[]> {
  const supabase = await createClient()
  const rows: CashMovementRow[] = []

  for (let from = 0; from < EXPORT_MAX_ROWS; from += EXPORT_PAGE_SIZE) {
    let query = supabase
      .from('cash_movements')
      .select(MOVEMENT_SELECT)
      .gte('occurred_on', filters.period)
      .lte('occurred_on', lastDayOfPeriod(filters.period))
    if (filters.conceptId !== undefined) query = query.eq('concept_id', filters.conceptId)
    if (filters.sponsorId !== undefined) query = query.eq('sponsor_id', filters.sponsorId)

    const { data, error } = await query
      .order('occurred_on', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + EXPORT_PAGE_SIZE - 1)
    if (error) throw error

    const page = (data ?? []) as unknown as CashMovementRow[]
    rows.push(...page)
    if (page.length < EXPORT_PAGE_SIZE) break
    if (rows.length >= EXPORT_MAX_ROWS) {
      throw new DomainError('Hay demasiados ingresos para exportar de una vez; filtrá por concepto o sponsor')
    }
  }

  return mapWithCreators(supabase, rows)
}

/** Todos los aportes de un sponsor, anulados incluidos, del más nuevo al más viejo. */
export async function listSponsorMovements(sponsorId: number): Promise<CashMovement[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cash_movements')
    .select(MOVEMENT_SELECT)
    .eq('sponsor_id', sponsorId)
    .order('occurred_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(CASH_MOVEMENTS_LIST_LIMIT)
  if (error) throw error

  return mapWithCreators(supabase, (data ?? []) as unknown as CashMovementRow[])
}
