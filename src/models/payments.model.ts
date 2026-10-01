import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { toClubDate, lastDayOfPeriod } from '@/lib/dates'
import { sumCents } from '@/lib/money'
import type { Page, Payment, PaymentListItem, PaymentMethod } from '@/models/types'

/**
 * Pagos (`payments`, S2). Un pago suelto es un lote de uno: `batchId` lo
 * genera SIEMPRE el formulario (nunca acá) y es la idempotencia del submit
 * (D22) — un doble toque con mala señal reintenta el mismo `batchId` y el
 * índice único `(batch_id, member_id)` lo vuelve un éxito repetido, no un
 * pago duplicado.
 */

// -----------------------------------------------------------------------------
// Adjuntos: mismo bucket `attachments` que el apto físico (S4), prefijo propio
// -----------------------------------------------------------------------------

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}
const ALLOWED_MIME_TYPES = Object.keys(MIME_EXTENSIONS) as [string, ...string[]]

export const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024
export const RECEIPT_PATH_PREFIX = 'payment-receipts/'

/** `payment-receipts/<memberId>/<uuid>.<ext>`, armada en el servidor (nunca la manda el browser). */
export function buildReceiptPath(memberId: number, mimeType: string): string {
  const ext = MIME_EXTENSIONS[mimeType]
  return `${RECEIPT_PATH_PREFIX}${memberId}/${crypto.randomUUID()}.${ext}`
}

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export const prepareReceiptUploadSchema = z
  .object({
    memberId: z.number().int().positive(),
    mimeType: z.enum(ALLOWED_MIME_TYPES, 'Subí un archivo PDF, JPG, PNG o WEBP'),
    sizeBytes: z
      .number('El archivo está vacío')
      .int('El archivo está vacío')
      .positive('El archivo está vacío')
      .max(MAX_RECEIPT_SIZE_BYTES, 'El archivo no puede pesar más de 10 MB'),
  })
  .strict()
export type PrepareReceiptUploadInput = z.infer<typeof prepareReceiptUploadSchema>

/**
 * Piso de `paid_on`, igual al trigger `payments_paid_on_guard` (ahí es
 * `date '2020-01-01'`): ataja el año mal tipeado en un `<input type="date">`.
 */
export const MIN_PAYMENT_DATE = '2020-01-01'
const PAYMENT_DATE_TOO_OLD_MESSAGE = 'La fecha del pago no puede ser anterior a 2020. Revisá el año'
const PAYMENT_DATE_FUTURE_MESSAGE = 'La fecha del pago no puede ser futura'

const paymentItemSchema = z
  .object({
    memberId: z.number('Elegí el socio').int('Elegí el socio').positive('Elegí el socio'),
    amountCents: z
      .number('Ingresá el monto')
      .int('El monto no es válido')
      .positive('El monto tiene que ser mayor a cero'),
  })
  .strict()

/**
 * `batchId` viaja del cliente (uuid que genera el formulario UNA vez) y
 * nunca se regenera acá: es la clave de idempotencia (D22). `receiptPath`,
 * si viene, es el mismo comprobante para las N filas del lote (un cobro de
 * grupo con un solo comprobante de transferencia).
 */
export const registerPaymentSchema = z
  .object({
    batchId: z.uuid('El identificador del lote no es válido'),
    paidOn: z.iso.date('La fecha no es válida'),
    method: z.enum(['cash', 'transfer'] satisfies PaymentMethod[], 'Elegí el medio de pago: efectivo o transferencia'),
    items: z.array(paymentItemSchema).min(1, 'Cargá al menos un pago'),
    notes: z.string().trim().max(500, 'Las notas no pueden tener más de 500 caracteres').nullish(),
    receiptPath: z
      .string()
      .refine((path) => path.startsWith(RECEIPT_PATH_PREFIX), 'El comprobante no corresponde a un pago')
      .nullish(),
    /** Si viene, todo `memberId` de `items` tiene que pertenecer a este grupo (lo valida la action, no este schema). */
    familyGroupId: z.number().int().positive().nullish(),
  })
  .strict()
  .refine((data) => data.paidOn <= toClubDate(), {
    message: PAYMENT_DATE_FUTURE_MESSAGE,
    path: ['paidOn'],
  })
  .refine((data) => data.paidOn >= MIN_PAYMENT_DATE, {
    message: PAYMENT_DATE_TOO_OLD_MESSAGE,
    path: ['paidOn'],
  })
export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>

export const attachReceiptSchema = z
  .object({
    paymentId: z.number().int().positive(),
    path: z.string().refine((path) => path.startsWith(RECEIPT_PATH_PREFIX), 'El comprobante no corresponde a un pago'),
    filename: z.string().trim().max(255, 'El nombre del archivo no puede tener más de 255 caracteres').nullish(),
  })
  .strict()
export type AttachReceiptInput = z.infer<typeof attachReceiptSchema>

export const voidPaymentSchema = z
  .object({
    paymentId: z.number().int().positive(),
    reason: z
      .string('El motivo tiene que tener al menos 3 caracteres')
      .trim()
      .min(3, 'El motivo tiene que tener al menos 3 caracteres')
      .max(500, 'El motivo no puede tener más de 500 caracteres'),
  })
  .strict()
export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>

/**
 * Al menos uno de los dos: el formulario se abre desde la ficha de UN socio
 * (`memberId`) o desde un grupo familiar (`familyGroupId`, trae a todos los
 * integrantes). Los dos juntos son válidos: `familyGroupId` manda en quiénes
 * aparecen, `memberId` solo dice cuál va primero (el socio desde el que se
 * abrió el formulario).
 */
export const getPaymentFormDataSchema = z
  .object({
    memberId: z.number().int().positive().nullish(),
    familyGroupId: z.number().int().positive().nullish(),
  })
  .strict()
  .refine((data) => data.memberId != null || data.familyGroupId != null, {
    message: 'Elegí un socio o un grupo familiar',
    path: ['memberId'],
  })
export type GetPaymentFormDataInput = z.infer<typeof getPaymentFormDataSchema>

export const getReceiptUrlSchema = z.object({ paymentId: z.number().int().positive() }).strict()
export type GetReceiptUrlInput = z.infer<typeof getReceiptUrlSchema>

export const getMonthPaymentsPageSchema = z
  .object({
    period: z.iso.date('El período no es válido'),
    cursor: z.string().min(1).nullish(),
  })
  .strict()
export type GetMonthPaymentsPageInput = z.infer<typeof getMonthPaymentsPageSchema>

// -----------------------------------------------------------------------------
// Traducción de errores de Postgres
// -----------------------------------------------------------------------------

const BATCH_MEMBER_UNIQUE_INDEX = 'payments_batch_member_key'

function isBatchAlreadyRegistered(error: PostgrestError): boolean {
  return error.code === '23505' && error.message.includes(BATCH_MEMBER_UNIQUE_INDEX)
}

/**
 * `payments_paid_on_guard` (fecha futura o demasiado vieja) y las FK de socio.
 * El monto (`amount_cents > 0`) lo ataja Zod; si llegara a la base por
 * PostgREST directo se traduce igual, con el mismo texto.
 */
function translateInsertError(error: PostgrestError): unknown {
  if (error.code === '23514' && error.message === 'La fecha del pago no puede ser futura') {
    return new DomainError(PAYMENT_DATE_FUTURE_MESSAGE, { field: 'paidOn' })
  }
  if (error.code === '23514' && error.message === 'La fecha del pago es demasiado vieja') {
    return new DomainError(PAYMENT_DATE_TOO_OLD_MESSAGE, { field: 'paidOn' })
  }
  if (error.code === '23514' && error.message.includes('payments_amount_cents_check')) {
    return new DomainError('El monto tiene que ser mayor a cero', { field: 'amountCents' })
  }
  if (error.code === '23503') {
    return new DomainError('El socio no existe', { field: 'memberId' })
  }
  return error
}

const ALREADY_VOIDED_MESSAGE = 'Este pago ya está anulado'
const ALREADY_HAS_RECEIPT_MESSAGE = 'El comprobante ya está cargado y no se reemplaza'
const VOIDED_NO_RECEIPT_MESSAGE = 'Un pago anulado no lleva comprobante'
const VOID_NEEDS_REASON_MESSAGE = 'Para anular un pago hace falta un motivo'
const RECEIPT_FILE_MISSING_MESSAGE = 'Falta el archivo del comprobante'

function translateUpdateError(error: PostgrestError): unknown {
  // check_violation (23514): mensajes ya redactados por `payments_update_guard`.
  if (
    error.code === '23514' &&
    (error.message === ALREADY_VOIDED_MESSAGE ||
      error.message === ALREADY_HAS_RECEIPT_MESSAGE ||
      error.message === VOIDED_NO_RECEIPT_MESSAGE)
  ) {
    return new DomainError(error.message)
  }
  if (error.code === '23514' && error.message === VOID_NEEDS_REASON_MESSAGE) {
    return new DomainError(error.message, { field: 'reason' })
  }
  if (error.code === '23514' && error.message === RECEIPT_FILE_MISSING_MESSAGE) {
    return new DomainError(error.message)
  }
  if (error.code === '23514' && error.message.includes('payments_void_triad')) {
    return new DomainError('El motivo tiene que tener al menos 3 caracteres', { field: 'reason' })
  }
  return error
}

// -----------------------------------------------------------------------------
// Mapeo
// -----------------------------------------------------------------------------

type PaymentRow = {
  id: number
  member_id: number
  amount_cents: number
  paid_on: string
  method: string
  receipt_storage_path: string | null
  receipt_filename: string | null
  notes: string | null
  batch_id: string
  created_by: string | null
  created_at: string
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

function mapPaymentRow(row: PaymentRow, createdByName: string | null): Payment {
  return {
    id: row.id,
    memberId: row.member_id,
    amountCents: row.amount_cents,
    paidOn: row.paid_on,
    method: row.method as PaymentMethod,
    hasReceipt: row.receipt_storage_path !== null,
    receiptFilename: row.receipt_filename,
    notes: row.notes,
    batchId: row.batch_id,
    createdByName,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  }
}

/** Nombres de quien cargó cada pago, en una sola consulta batch (evita N+1, mismo patrón que `audit.model.ts`). */
async function resolveCreatedByNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('app_users').select('user_id, display_name').in('user_id', ids)
  if (error) throw error

  return new Map((data ?? []).map((row) => [row.user_id, row.display_name]))
}

const PAYMENT_SELECT =
  'id, member_id, amount_cents, paid_on, method, receipt_storage_path, receipt_filename, notes, batch_id, created_by, created_at, voided_at, voided_by, void_reason'

// -----------------------------------------------------------------------------
// Escrituras
// -----------------------------------------------------------------------------

/**
 * Registra un pago o un cobro a varios integrantes de un grupo en una sola
 * sentencia `insert` con N filas (mismo `batchId`, `paidOn`, `method`,
 * `receiptPath`, `notes`; solo cambia `memberId`/`amountCents` por fila).
 *
 * Un reintento con el mismo `batchId` (doble toque, mala señal) choca contra
 * el índice único `(batch_id, member_id)`: se trata como éxito idempotente
 * (`alreadyRegistered: true`), recuperando lo que ya había quedado cargado
 * la primera vez, en vez de mostrar un error de "ya existe".
 */
export async function registerPayment(
  input: RegisterPaymentInput,
): Promise<{ paymentIds: number[]; totalCents: number; alreadyRegistered: boolean }> {
  const supabase = await createClient()

  const rows = input.items.map((item) => ({
    member_id: item.memberId,
    amount_cents: item.amountCents,
    paid_on: input.paidOn,
    method: input.method,
    receipt_storage_path: input.receiptPath ?? null,
    notes: input.notes ?? null,
    batch_id: input.batchId,
  }))

  const { data, error } = await supabase.from('payments').insert(rows).select('id, amount_cents')

  if (error) {
    if (isBatchAlreadyRegistered(error)) {
      const { data: existing, error: existingError } = await supabase
        .from('payments')
        .select('id, amount_cents')
        .eq('batch_id', input.batchId)
      if (existingError) throw existingError

      return {
        paymentIds: (existing ?? []).map((row) => row.id),
        totalCents: sumCents((existing ?? []).map((row) => row.amount_cents)),
        alreadyRegistered: true,
      }
    }
    throw translateInsertError(error)
  }

  const created = data ?? []
  return {
    paymentIds: created.map((row) => row.id),
    totalCents: sumCents(created.map((row) => row.amount_cents)),
    alreadyRegistered: false,
  }
}

/**
 * Anula un pago. `.select('id').maybeSingle()` (mismo patrón que
 * `medical-clearances.model.ts`): distingue un id inexistente de un éxito
 * real. La policy de UPDATE ya admite `payments.register` **o**
 * `payments.void`, así que acá 0 filas es casi siempre "no existe" (a
 * diferencia de `voidFee`, donde 0 filas puede ser "sin permiso").
 */
export async function voidPayment(paymentId: number, reason: string): Promise<void> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('payments')
    .update({ void_reason: reason })
    .eq('id', paymentId)
    .select('id')
    .maybeSingle()

  if (error) throw translateUpdateError(error)
  if (!data) throw new DomainError('El pago no existe', { status: 404 })
}

/** Adjunta un comprobante a un pago YA registrado (el otro camino es mandarlo en `registerPayment`). */
export async function attachReceipt(paymentId: number, path: string, filename: string | null): Promise<void> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('payments')
    .update({ receipt_storage_path: path, receipt_filename: filename })
    .eq('id', paymentId)
    .select('id')
    .maybeSingle()

  if (error) throw translateUpdateError(error)
  if (!data) throw new DomainError('El pago no existe', { status: 404 })
}

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

/** La ruta del comprobante de un pago, o null si no existe o no tiene. La action firma la URL. */
export async function getReceiptPath(paymentId: number): Promise<string | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('payments')
    .select('receipt_storage_path')
    .eq('id', paymentId)
    .maybeSingle()
  if (error) throw error

  return data?.receipt_storage_path ?? null
}

/** Todos los pagos del socio, incluidos los anulados, del más nuevo al más viejo (para `getMemberAccountDetail`). */
export async function listPaymentsForMember(memberId: number): Promise<Payment[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('payments')
    .select(`${PAYMENT_SELECT}`)
    .eq('member_id', memberId)
    .order('paid_on', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as PaymentRow[]
  const createdByNames = await resolveCreatedByNames(
    supabase,
    rows.map((row) => row.created_by),
  )
  return rows.map((row) => mapPaymentRow(row, row.created_by ? (createdByNames.get(row.created_by) ?? null) : null))
}

const MONTH_PAGE_MAX_LIMIT = 100
const MONTH_PAGE_DEFAULT_LIMIT = 50

type PaymentMonthCursor = { paidOn: string; id: number }

function encodeMonthCursor(paidOn: string, id: number): string {
  return Buffer.from(`${paidOn}|${id}`, 'utf8').toString('base64url')
}

function decodeMonthCursor(cursor: string): PaymentMonthCursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const separatorIndex = raw.lastIndexOf('|')
    if (separatorIndex === -1) return null

    const paidOn = raw.slice(0, separatorIndex)
    const id = Number(raw.slice(separatorIndex + 1))
    if (!paidOn || !Number.isInteger(id)) return null

    return { paidOn, id }
  } catch {
    return null
  }
}

/** Mismo escape de `or=` que `members.model.ts`/`audit.model.ts`: la API de PostgREST no lo hace por vos. */
function pgQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

type PaymentWithMemberRow = PaymentRow & { members: { first_name: string; last_name: string } | null }

/**
 * Página de pagos de un período (mes calendario), keyset por
 * `(paid_on desc, id desc)`, con el nombre del socio embebido. Incluye los
 * anulados (marcados con `voided: true`): la cobranza del mes es un
 * registro, no solo lo vigente.
 */
export async function getMonthPaymentsPage(period: string, cursor?: string | null): Promise<Page<PaymentListItem>> {
  const supabase = await createClient()
  const limit = MONTH_PAGE_DEFAULT_LIMIT
  const periodEnd = lastDayOfPeriod(period)

  let query = supabase
    .from('payments')
    .select(`${PAYMENT_SELECT}, members(first_name, last_name)`)
    .gte('paid_on', period)
    .lte('paid_on', periodEnd)

  const decoded = cursor ? decodeMonthCursor(cursor) : null
  if (decoded) {
    query = query.or(
      `paid_on.lt.${pgQuote(decoded.paidOn)},and(paid_on.eq.${pgQuote(decoded.paidOn)},id.lt.${decoded.id})`,
    )
  }

  const { data, error } = await query
    .order('paid_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(limit, MONTH_PAGE_MAX_LIMIT) + 1)

  if (error) throw error

  const rows = (data ?? []) as unknown as PaymentWithMemberRow[]
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  const createdByNames = await resolveCreatedByNames(
    supabase,
    pageRows.map((row) => row.created_by),
  )

  const items: PaymentListItem[] = pageRows.map((row) => ({
    ...mapPaymentRow(row, row.created_by ? (createdByNames.get(row.created_by) ?? null) : null),
    memberFullName: row.members ? `${row.members.last_name}, ${row.members.first_name}` : '',
    voided: row.voided_at !== null,
  }))

  const last = pageRows.at(-1)
  const nextCursor = hasMore && last ? encodeMonthCursor(last.paid_on, last.id) : null

  return { items, nextCursor }
}
