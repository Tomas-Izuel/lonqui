import 'server-only'

import { z } from 'zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError } from '@/lib/errors'
import { toPeriod } from '@/lib/dates'
import type { FeePrice, FeePriceScope, FeePricesOverview, MemberType } from './types'

/**
 * Valores de cuota (`00-architecture.md` del pipeline `2026-09-27-cuotas-pagos-panel`,
 * §6.1). Append-only: no hay `update` ni `delete` — cambiar un valor es
 * insertar una fila nueva con `validFrom` = el mes desde el que aplica.
 *
 * La coherencia `scope` ↔ `memberType`/`categoryId` (el CHECK
 * `fee_prices_scope_shape`) se valida acá en Zod para devolver el campo
 * exacto sin ir a Postgres. Lo que SÍ depende de leer `fees`/`fee_prices` —
 * el trigger `fee_prices_insert_guard` (mes pasado, o mes ya generado) y la
 * unique constraint del duplicado exacto — se traduce del error de Postgres:
 * el mensaje del trigger ya está pensado para el usuario, se envuelve tal cual.
 */

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

const feePriceScopeEnum = z.enum(['default', 'member_type', 'category'])
const memberTypeEnum = z.enum(['practicing', 'non_practicing'])

const firstOfMonth = z.iso.date().refine((value) => value.endsWith('-01'), {
  message: 'Tiene que ser el primer día de un mes',
})

export const createFeePriceSchema = z
  .object({
    scope: feePriceScopeEnum,
    memberType: memberTypeEnum.nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    amountCents: z
      .number()
      .int('El monto tiene que ser un número entero de centavos')
      .nonnegative('El monto no puede ser negativo'),
    validFrom: firstOfMonth,
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Repite acá el CHECK `fee_prices_scope_shape`: un valor por categoría
    // lleva categoryId y nada de memberType, uno por tipo lleva memberType y
    // nada de categoryId, y el default no lleva ninguno de los dos.
    const hasCategory = data.categoryId != null
    const hasMemberType = data.memberType != null

    if (data.scope === 'category' && !hasCategory) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Elegí una categoría' })
    }
    if (data.scope === 'category' && hasMemberType) {
      ctx.addIssue({ code: 'custom', path: ['memberType'], message: 'Un valor por categoría no lleva tipo de socio' })
    }
    if (data.scope === 'member_type' && !hasMemberType) {
      ctx.addIssue({ code: 'custom', path: ['memberType'], message: 'Elegí un tipo de socio' })
    }
    if (data.scope === 'member_type' && hasCategory) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Un valor por tipo de socio no lleva categoría' })
    }
    if (data.scope === 'default' && (hasCategory || hasMemberType)) {
      ctx.addIssue({
        code: 'custom',
        path: [hasCategory ? 'categoryId' : 'memberType'],
        message: 'Un valor por defecto no lleva categoría ni tipo de socio',
      })
    }
  })
export type CreateFeePriceInput = z.infer<typeof createFeePriceSchema>

// -----------------------------------------------------------------------------
// Lecturas
// -----------------------------------------------------------------------------

const FEE_PRICE_COLUMNS =
  'id, scope, member_type, category_id, amount_cents, valid_from, notes, created_at, categories(name)'

type FeePriceRow = {
  id: number
  scope: string
  member_type: string | null
  category_id: number | null
  amount_cents: number
  valid_from: string
  notes: string | null
  created_at: string
  categories: { name: string } | null
}

function toFeePrice(row: FeePriceRow): FeePrice {
  return {
    id: row.id,
    scope: row.scope as FeePriceScope,
    memberType: row.member_type as MemberType | null,
    categoryId: row.category_id,
    categoryName: row.categories?.name ?? null,
    amountCents: row.amount_cents,
    validFrom: row.valid_from,
    notes: row.notes,
    createdAt: row.created_at,
  }
}

/** Historia completa de valores de cuota, el más nuevo primero. */
export async function listFeePrices(): Promise<FeePrice[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('fee_prices')
    .select(FEE_PRICE_COLUMNS)
    .order('valid_from', { ascending: false })
    .order('id', { ascending: false })
    .overrideTypes<FeePriceRow[], { merge: false }>()

  if (error) throw error
  return (data ?? []).map(toFeePrice)
}

/**
 * El valor vigente hoy en cada scope (D19: el de mayor `validFrom <= mes
 * actual`, dentro de cada scope/target) y lo programado para meses futuros
 * aparte ("próximos" en la UI). `listFeePrices` ya trae todo ordenado desc,
 * así que alcanza con partir esa lista una vez: el primero de cada grupo es
 * el vigente. Nunca se recalcula el precio de un socio acá — eso lo resuelve
 * `private.fee_price_for` al generar (D19), esto es solo para mostrar.
 */
export async function getFeePricesOverview(): Promise<FeePricesOverview> {
  const prices = await listFeePrices()
  const currentPeriod = toPeriod()

  const current = prices.filter((price) => price.validFrom <= currentPeriod)
  const upcoming = prices.filter((price) => price.validFrom > currentPeriod)

  const defaultPrice = current.find((price) => price.scope === 'default') ?? null

  const byMemberType: FeePrice[] = []
  const seenMemberTypes = new Set<MemberType>()
  for (const price of current) {
    if (price.scope === 'member_type' && price.memberType && !seenMemberTypes.has(price.memberType)) {
      seenMemberTypes.add(price.memberType)
      byMemberType.push(price)
    }
  }

  const byCategory: FeePrice[] = []
  const seenCategories = new Set<number>()
  for (const price of current) {
    if (price.scope === 'category' && price.categoryId != null && !seenCategories.has(price.categoryId)) {
      seenCategories.add(price.categoryId)
      byCategory.push(price)
    }
  }

  return {
    current: { default: defaultPrice, byMemberType, byCategory },
    upcoming,
    history: prices,
  }
}

// -----------------------------------------------------------------------------
// Escritura
// -----------------------------------------------------------------------------

function translateFeePriceError(error: PostgrestError): unknown {
  // Duplicado exacto: mismo scope/target/mes (fee_prices_unique_target).
  if (error.code === '23505') {
    return new DomainError('Ya hay un valor para ese alcance desde ese mes', { field: 'validFrom' })
  }
  // `fee_prices_insert_guard`: mes pasado, o mes que ya generó cuotas con
  // otro valor. El mensaje del trigger ya está pensado para el usuario.
  if (error.code === '23514') {
    return new DomainError(error.message, { field: 'validFrom' })
  }
  // FK a categories: un id que no existe (o de una categoría borrada, que acá no pasa: on delete restrict).
  if (error.code === '23503') {
    return new DomainError('Esa categoría no existe', { field: 'categoryId' })
  }
  return error
}

export async function createFeePrice(input: CreateFeePriceInput): Promise<FeePrice> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('fee_prices')
    .insert({
      scope: input.scope,
      member_type: input.memberType ?? null,
      category_id: input.categoryId ?? null,
      amount_cents: input.amountCents,
      valid_from: input.validFrom,
      notes: input.notes ?? null,
    })
    .select(FEE_PRICE_COLUMNS)
    .single()
    .overrideTypes<FeePriceRow, { merge: false }>()

  if (error) throw translateFeePriceError(error)
  return toFeePrice(data)
}
