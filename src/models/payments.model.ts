import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError, PermissionError } from '@/lib/errors'
import { isRawPostgresMessage } from '@/models/pg-errors'
import { openingMonthsSchema, periodSchema } from '@/models/fees.model'
import { toClubDate, lastDayOfPeriod } from '@/lib/dates'
import { sumCents } from '@/lib/money'
import type {
  FeeKind,
  Page,
  Payment,
  PaymentAllocation,
  PaymentAllocationSource,
  PaymentListItem,
  PaymentMethod,
  RegisterPaymentResult,
} from '@/models/types'

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

const MARKED_PERIODS_INVALID_MESSAGE = 'Los meses marcados no son válidos'

const paymentItemSchema = z
  .object({
    memberId: z.number('Elegí el socio').int('Elegí el socio').positive('Elegí el socio'),
    amountCents: z
      .number('Ingresá el monto')
      .int('El monto no es válido')
      .positive('El monto tiene que ser mayor a cero'),
    /**
     * Meses que el operador marcó en la grilla (cuotas vigentes o proyectadas).
     * La plata de cada uno la reparte el motor de la base; el resto del monto
     * va a la cuota adeudada más vieja. Sin marcar = todo al más viejo.
     */
    markedPeriods: z
      .array(periodSchema)
      .max(60, MARKED_PERIODS_INVALID_MESSAGE)
      .refine((periods) => new Set(periods).size === periods.length, { message: MARKED_PERIODS_INVALID_MESSAGE })
      .nullish(),
    /**
     * Deuda previa al sistema, mes por mes, que se crea en la MISMA transacción
     * que el pago. Que cada mes quede antes del inicio de la facturación y que
     * no haya ya un saldo en ese mes lo valida la base.
     */
    openingMonths: openingMonthsSchema.nullish(),
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
    items: z
      .array(paymentItemSchema)
      .min(1, 'Cargá al menos un pago')
      .refine((items) => new Set(items.map((item) => item.memberId)).size === items.length, {
        message: 'El mismo socio aparece dos veces en el lote',
      }),
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
const ONE_OPENING_BALANCE_INDEX = 'fees_one_opening_balance'

/**
 * Errores de `register_payment_batch`. La RPC y los triggers de `payments` /
 * `fees` redactan sus mensajes para el usuario (23514 con texto propio): se
 * pasan tal cual. Un 23514 de un CHECK declarativo trae el mensaje crudo de
 * Postgres y NO se muestra (`isRawPostgresMessage`): sube como error interno.
 */
function translateRegisterError(error: PostgrestError): unknown {
  if (error.code === '42501') {
    return new PermissionError('No tenés permiso para registrar pagos')
  }
  if (error.code === '23505' && error.message.includes(ONE_OPENING_BALANCE_INDEX)) {
    return new DomainError('Ya hay un saldo anterior cargado para uno de esos meses', { field: 'items' })
  }
  if (error.code === '23505' && error.message.includes(BATCH_MEMBER_UNIQUE_INDEX)) {
    return new DomainError('El mismo socio aparece dos veces en el lote', { field: 'items' })
  }
  if (error.code === '23514' && error.message === 'La fecha del pago no puede ser futura') {
    return new DomainError(PAYMENT_DATE_FUTURE_MESSAGE, { field: 'paidOn' })
  }
  if (error.code === '23514' && error.message === 'La fecha del pago es demasiado vieja') {
    return new DomainError(PAYMENT_DATE_TOO_OLD_MESSAGE, { field: 'paidOn' })
  }
  if (error.code === '23514' && error.message.includes('payments_amount_cents_check')) {
    return new DomainError('El monto tiene que ser mayor a cero', { field: 'amountCents' })
  }
  if (error.code === '23514' && !isRawPostgresMessage(error.message)) {
    // Los mensajes de la base de la imputación ("Los meses marcados no son
    // válidos", "La cuota de MM/YYYY ya está paga…", "Lo imputado supera el
    // monto del pago", los del saldo anterior) caen en el campo `items`.
    return new DomainError(error.message, {
      // Solo el texto exacto del monto va a `amountCents`: el del saldo anterior
      // ("… y cada mes tiene que ser mayor a cero") es del campo `items`.
      field: error.message === 'El monto tiene que ser mayor a cero' ? 'amountCents' : 'items',
    })
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

type AllocationRow = {
  fee_id: number
  amount_cents: number
  source: string
  fee: { period: string; kind: string; voided_at: string | null } | null
}

type PaymentRowWithAllocations = PaymentRow & { payment_allocations?: AllocationRow[] | null }

/**
 * Imputaciones VIGENTES de un pago, por período. Las de una cuota anulada no
 * se listan (la base ya reimputó esa plata) y un pago anulado no muestra
 * ninguna: su plata dejó de cubrir cuotas.
 */
function mapAllocations(row: PaymentRowWithAllocations): PaymentAllocation[] {
  if (row.voided_at !== null) return []
  const allocations: PaymentAllocation[] = []
  for (const a of row.payment_allocations ?? []) {
    if (a.fee === null || a.fee.voided_at !== null) continue
    allocations.push({
      feeId: a.fee_id,
      period: a.fee.period,
      kind: a.fee.kind as FeeKind,
      amountCents: a.amount_cents,
      source: a.source as PaymentAllocationSource,
    })
  }
  return allocations.sort((x, y) => x.period.localeCompare(y.period) || x.feeId - y.feeId)
}

function mapPaymentRow(row: PaymentRowWithAllocations, createdByName: string | null): Payment {
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
    allocations: mapAllocations(row),
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

/**
 * Embed de las imputaciones (FK `payment_allocations.payment_id`) con la cuota
 * a la que fueron (FK `fee_id`, to-one): período y tipo para mostrarlas, y
 * `voided_at` para descartar las de cuotas anuladas.
 */
/**
 * Ventana de despliegue (código nuevo antes que la migración): sin la tabla
 * `payment_allocations` PostgREST responde PGRST200 al embeber. Antes que tirar
 * la ficha y /caja/pagos enteras, se reintenta sin el embed y los pagos salen
 * con `allocations: []`.
 */
const NO_RELATIONSHIP_CODE = 'PGRST200'

const ALLOCATIONS_EMBED = 'payment_allocations(fee_id, amount_cents, source, fee:fees(period, kind, voided_at))'

// -----------------------------------------------------------------------------
// Escrituras
// -----------------------------------------------------------------------------

type RegisterBatchRow = {
  member_id: number
  payment_id: number
  amount_cents: number
  opening_balance_fee_id: number | null
  already_registered: boolean
}

/**
 * Registra un pago o un cobro a varios integrantes de un grupo (mismo
 * `batchId`, `paidOn`, `method`, `receiptPath`, `notes`; cambia `memberId` /
 * `amountCents` por ítem) llamando a `register_payment_batch`: UN solo
 * camino de escritura, una transacción. Si un ítem trae `openingMonths`, los
 * meses de saldo anterior se crean en esa misma transacción (todo o nada); si
 * trae `markedPeriods`, el motor de la base imputa primero a esas cuotas.
 *
 * La RPC es SECURITY INVOKER: corre con la sesión del usuario, así que las
 * RLS, los grants por columna y el actor de la auditoría (`auth.uid()`) valen
 * igual que con un insert directo.
 *
 * Idempotencia (D22): un reintento con el mismo `batchId` no toca nada y la
 * RPC devuelve lo ya cargado con `already_registered = true`.
 */
export async function registerPayment(input: RegisterPaymentInput): Promise<RegisterPaymentResult> {
  const supabase = await createClient()

  const items = input.items.map((item) => ({
    member_id: item.memberId,
    amount_cents: item.amountCents,
    // Sin marcar / sin saldo anterior viaja `null` (no `[]`): la base lo trata como "nada".
    marked_periods: item.markedPeriods && item.markedPeriods.length > 0 ? item.markedPeriods : null,
    opening_months:
      item.openingMonths && item.openingMonths.length > 0
        ? item.openingMonths.map((month) => ({ period: month.period, amount_cents: month.amountCents }))
        : null,
  }))

  // Los tipos generados marcan `notes` y `receipt_storage_path` como `string`
  // (no saben de DEFAULT NULL): la RPC los acepta nulos.
  const { data, error } = await supabase.rpc('register_payment_batch', {
    batch_id: input.batchId,
    paid_on: input.paidOn,
    method: input.method,
    receipt_storage_path: (input.receiptPath ?? null) as string,
    notes: (input.notes ?? null) as string,
    items,
  })
  if (error) throw translateRegisterError(error)

  const rows = (data ?? []) as unknown as RegisterBatchRow[]
  return {
    paymentIds: rows.map((row) => row.payment_id),
    totalCents: sumCents(rows.map((row) => row.amount_cents)),
    alreadyRegistered: rows.some((row) => row.already_registered),
    openingBalanceFeeIds: rows
      .map((row) => row.opening_balance_fee_id)
      .filter((id): id is number => id !== null),
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

  const run = (select: string) =>
    supabase
      .from('payments')
      .select(select)
      .eq('member_id', memberId)
      .order('paid_on', { ascending: false })
      .order('id', { ascending: false })

  let { data, error } = await run(`${PAYMENT_SELECT}, ${ALLOCATIONS_EMBED}`)
  if (error?.code === NO_RELATIONSHIP_CODE) ({ data, error } = await run(PAYMENT_SELECT))
  if (error) throw error

  const rows = (data ?? []) as unknown as PaymentRowWithAllocations[]
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

type PaymentWithMemberRow = PaymentRowWithAllocations & { members: { first_name: string; last_name: string } | null }

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

  const decoded = cursor ? decodeMonthCursor(cursor) : null
  const run = (select: string) => {
    let query = supabase.from('payments').select(select).gte('paid_on', period).lte('paid_on', periodEnd)
    if (decoded) {
      query = query.or(
        `paid_on.lt.${pgQuote(decoded.paidOn)},and(paid_on.eq.${pgQuote(decoded.paidOn)},id.lt.${decoded.id})`,
      )
    }
    return query
      .order('paid_on', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.min(limit, MONTH_PAGE_MAX_LIMIT) + 1)
  }

  const base = `${PAYMENT_SELECT}, members(first_name, last_name)`
  let { data, error } = await run(`${base}, ${ALLOCATIONS_EMBED}`)
  if (error?.code === NO_RELATIONSHIP_CODE) ({ data, error } = await run(base))
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
