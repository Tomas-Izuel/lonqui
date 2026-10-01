import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { isRawPostgresMessage } from '@/models/pg-errors'
import type { TablesInsert } from '@/lib/supabase/database.types'
import type { Fee, FeeKind } from '@/models/types'

/**
 * Cargos (`fees`, S1/§13.3). Las cuotas mensuales las genera SOLO la base
 * (`private.generate_monthly_fees`, pg_cron): desde acá nunca se inserta un
 * `kind = 'monthly'`. Lo único que la app carga es el saldo de arranque
 * (`createOpeningBalance`) y lo único que modifica es la anulación
 * (`voidFee`), y ambos vía triggers que ya son la fuente de verdad del
 * mensaje de error — este modelo solo lo envuelve en `DomainError`.
 */

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

export const createOpeningBalanceSchema = z
  .object({
    memberId: z.number().int().positive(),
    // El trigger `fees_opening_balance_guard` vuelve a exigir > 0 (defensa en
    // profundidad); acá se valida temprano para el mensaje de campo.
    amountCents: z
      .number('Ingresá el monto del saldo anterior')
      .int('El monto no es válido')
      .positive('El saldo anterior tiene que ser mayor a cero'),
    description: z.string().trim().max(500, 'La descripción no puede tener más de 500 caracteres').nullish(),
  })
  .strict()
export type CreateOpeningBalanceInput = z.infer<typeof createOpeningBalanceSchema>

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
    return new DomainError('Ya tiene un saldo anterior vigente. Anulalo antes de cargar uno nuevo.')
  }
  // check_violation (23514): mensajes ya redactados por el trigger
  // (`fees_opening_balance_guard`) — "Primero activá las cuotas en Ajustes"
  // o "El saldo anterior tiene que ser mayor a cero".
  if (error.code === '23514' && error.message.includes('fees_amount_cents_check')) {
    return new DomainError('El saldo anterior tiene que ser mayor a cero', { field: 'amountCents' })
  }
  if (error.code === '23514' && !isRawPostgresMessage(error.message)) {
    return new DomainError(error.message, { field: error.message.includes('mayor a cero') ? 'amountCents' : undefined })
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
 * Insert de `fees` sin `period`: el trigger `fees_opening_balance_guard`
 * (BEFORE INSERT) la fija él mismo (mes anterior al inicio de la facturación)
 * antes de que se evalúe el `not null`, así que ni hace falta mandarla. Pero
 * además NO SE PUEDE mandarla: `authenticated` no tiene grant de INSERT sobre
 * `fees.period` (a propósito, `20260927130000_billing.sql`, `grant insert
 * (member_id, kind, amount_cents, description) on public.fees`) — un `insert`
 * que la incluya, aunque el valor termine descartado por el trigger, dispara
 * `42501 permission denied for column period` porque el grant es por columna,
 * no por tabla completa. El tipo generado de `supabase-js` sí la marca
 * `required` (no sabe de triggers ni de grants), de ahí el `Omit` + cast acá.
 */
type OpeningBalanceInsert = Omit<TablesInsert<'fees'>, 'period'>

/** Carga la deuda previa al sistema (contrato: "la deuda previa entra como un cargo inicial"). */
export async function createOpeningBalance(input: CreateOpeningBalanceInput): Promise<Fee> {
  const supabase = await createClient()

  const payload: OpeningBalanceInsert = {
    member_id: input.memberId,
    kind: 'opening_balance',
    amount_cents: input.amountCents,
    description: input.description ?? null,
  }

  const { data, error } = await supabase
    .from('fees')
    .insert(payload as TablesInsert<'fees'>)
    .select(FEE_SELECT)
    .single()

  if (error) throw translateOpeningBalanceError(error)
  return mapFeeRow(data)
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
