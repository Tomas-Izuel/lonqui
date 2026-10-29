import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { isRawPostgresMessage } from '@/models/pg-errors'
import type { TablesInsert } from '@/lib/supabase/database.types'
import type { Fee, FeeKind, OpeningMonth } from '@/models/types'

/**
 * Cargos (`fees`, S1/§13.3). Las cuotas mensuales las genera SOLO la base
 * (`private.generate_monthly_fees`, pg_cron): desde acá nunca se inserta un
 * `kind = 'monthly'`. Lo único que la app carga es el saldo de arranque
 * (`createOpeningBalanceMonths`, una fila por mes) y lo único que modifica es la anulación
 * (`voidFee`), y ambos vía triggers que ya son la fuente de verdad del
 * mensaje de error — este modelo solo lo envuelve en `DomainError`.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

/** `YYYY-MM-01`: los períodos son siempre el primer día del mes. */
export const periodSchema = z
  .iso.date('El mes no es válido')
  .refine((value) => value.endsWith('-01'), 'El mes no es válido')

/** Máximo de meses de saldo anterior por carga (igual al guard de la base: 36 meses atrás). */
export const MAX_OPENING_MONTHS = 36

/** Un mes de saldo anterior: monto en centavos enteros, > 0. Que el mes quede antes del inicio de la facturación lo valida la base (y la action). */
export const openingMonthSchema = z
  .object({
    period: periodSchema,
    amountCents: z
      .number('Ingresá el monto del saldo anterior')
      .int('El monto no es válido')
      .positive('El saldo anterior tiene que ser mayor a cero'),
  })
  .strict()

const OPENING_MONTHS_INVALID_MESSAGE = 'Los meses del saldo anterior no son válidos'

/**
 * Meses de saldo anterior de una carga: únicos y a lo sumo 36. Compartido con
 * `payments.model` (el saldo que viaja dentro de un pago).
 */
export const openingMonthsSchema = z
  .array(openingMonthSchema)
  .max(MAX_OPENING_MONTHS, OPENING_MONTHS_INVALID_MESSAGE)
  .refine((months) => new Set(months.map((m) => m.period)).size === months.length, {
    message: OPENING_MONTHS_INVALID_MESSAGE,
  })

export const createOpeningBalanceMonthsSchema = z
  .object({
    memberId: z.number().int().positive(),
    months: openingMonthsSchema.refine((months) => months.length > 0, {
      message: 'Marcá al menos un mes del saldo anterior',
    }),
  })
  .strict()
export type CreateOpeningBalanceMonthsInput = z.infer<typeof createOpeningBalanceMonthsSchema>

export const voidFeeSchema = z
  .object({
    feeId: z.number().int().positive(),
    reason: z
      .string('El motivo tiene que tener al menos 3 caracteres')
      .trim()
      .min(3, 'El motivo tiene que tener al menos 3 caracteres')
      .max(500, 'El motivo no puede tener más de 500 caracteres'),
  })
  .strict()
export type VoidFeeInput = z.infer<typeof voidFeeSchema>

// -----------------------------------------------------------------------------
// Traducción de errores de Postgres a DomainError
//
// Los triggers de `fees` (0005_billing.sql) ya redactan el mensaje para el
// usuario final ("Primero activá las cuotas en Ajustes", "Este cargo ya está
// anulado"): acá se envuelve tal cual, sin reescribirlo (CLAUDE.md).
// -----------------------------------------------------------------------------

const ONE_OPENING_BALANCE_INDEX = 'fees_one_opening_balance'

function translateOpeningBalanceError(error: PostgrestError): unknown {
  if (error.code === '23505' && error.message.includes(ONE_OPENING_BALANCE_INDEX)) {
    return new DomainError('Ya hay un saldo anterior cargado para uno de esos meses', { field: 'months' })
  }
  // check_violation (23514): mensajes ya redactados por el trigger
  // (`fees_opening_balance_guard`) — "Primero activá las cuotas en Ajustes"
  // o "El saldo anterior tiene que ser mayor a cero".
  if (error.code === '23514' && error.message.includes('fees_amount_cents_check')) {
    return new DomainError('El saldo anterior tiene que ser mayor a cero', { field: 'months' })
  }
  // Red de seguridad: el guard ya valida los meses con mensaje propio; si igual
  // salta un CHECK del tramo, el usuario ve lo mismo.
  if (error.code === '23514' && error.message.includes('fees_opening_span_')) {
    return new DomainError(OPENING_MONTHS_INVALID_MESSAGE, { field: 'months' })
  }
  if (error.code === '23514' && !isRawPostgresMessage(error.message)) {
    return new DomainError(error.message, { field: 'months' })
  }
  return error
}

const ALREADY_VOIDED_MESSAGE = 'Este cargo ya está anulado'

function translateVoidFeeError(error: PostgrestError): unknown {
  if (error.code === '23514' && error.message === ALREADY_VOIDED_MESSAGE) {
    return new DomainError(ALREADY_VOIDED_MESSAGE)
  }
  if (error.code === '23514' && error.message === 'Para anular un cargo hace falta un motivo') {
    return new DomainError(error.message, { field: 'reason' })
  }
  if (error.code === '23514' && error.message.includes('fees_void_triad')) {
    return new DomainError('El motivo tiene que tener al menos 3 caracteres', { field: 'reason' })
  }
  return error
}

// -----------------------------------------------------------------------------
// Mapeo
// -----------------------------------------------------------------------------

export type FeeRow = {
  id: number
  member_id: number
  period: string
  kind: string
  amount_cents: number
  description: string | null
  category_id: number | null
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

/**
 * `categoryName`/`disciplineName` siempre null acá: el saldo de arranque (el
 * único `kind` que este modelo inserta) nunca tiene categoría. Un cargo
 * mensual con deporte se mapea desde `accounts.model.ts`, que sí tiene el
 * nombre resuelto vía el statement. Exportada: `accounts.model.ts` la
 * reutiliza para mapear el saldo de arranque de `getMemberAccountDetail` en
 * vez de duplicar el mapeo fila → `Fee`.
 */
export function mapFeeRow(row: FeeRow): Fee {
  return {
    id: row.id,
    memberId: row.member_id,
    period: row.period,
    kind: row.kind as FeeKind,
    amountCents: row.amount_cents,
    description: row.description,
    categoryId: row.category_id,
    categoryName: null,
    disciplineName: null,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  }
}

// -----------------------------------------------------------------------------
// Escrituras
// -----------------------------------------------------------------------------

export const FEE_SELECT =
  'id, member_id, period, kind, amount_cents, description, category_id, created_at, voided_at, void_reason'

/**
 * Saldo anterior por mes: UN insert de N filas (una transacción: o entran
 * todas o ninguna). Sin `description` (la pone `fees_opening_balance_guard`:
 * "Saldo anterior · MM/YYYY") y sin tramo (`from_period`/`to_period` ya no
 * tienen grant de INSERT). `period` sí se manda: el grant de columna se abrió
 * en la migración 20261029120000. Que cada mes quede antes del inicio de la
 * facturación y que no haya ya un saldo vigente en ese mes lo decide la base.
 * Devuelve las filas creadas, por mes ascendente.
 */
export async function createOpeningBalanceMonths(input: CreateOpeningBalanceMonthsInput): Promise<Fee[]> {
  const supabase = await createClient()

  const months: OpeningMonth[] = input.months
  const payload = months.map((month) => ({
    member_id: input.memberId,
    kind: 'opening_balance' as const,
    period: month.period,
    amount_cents: month.amountCents,
  }))

  const { data, error } = await supabase
    .from('fees')
    .insert(payload as TablesInsert<'fees'>[])
    .select(FEE_SELECT)
    .order('period', { ascending: true })

  if (error) throw translateOpeningBalanceError(error)
  return ((data ?? []) as FeeRow[]).map(mapFeeRow)
}

/**
 * Anula un cargo. Encadena `.select('id').maybeSingle()` a propósito (D33,
 * review B2): la policy de UPDATE de `fees` es estrictamente
 * `can('payments.void')` (solo admin, sin el OR de `payments` con
 * `payments.register`), así que un `editor` que llegara hasta acá vería un
 * UPDATE de 0 filas silencioso en vez de un error — se traduce a un mensaje
 * explícito en lugar de un éxito mudo que no anuló nada.
 */
export async function voidFee(feeId: number, reason: string): Promise<void> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fees')
    .update({ void_reason: reason })
    .eq('id', feeId)
    .select('id')
    .maybeSingle()

  if (error) throw translateVoidFeeError(error)
  if (!data) {
    throw new DomainError('No se pudo anular el cargo: no existe o no tenés permiso')
  }
}
