import { z } from 'zod'
import { toClubDate } from '@/lib/dates'
import type { CashConcept, PaymentMethod } from '@/models/types'

/**
 * Espejo de `registerCashMovementSchema` (`cash-movements.model.ts`): un Client
 * Component no puede importar el modelo, así que los textos que existen en el
 * servidor se repiten idénticos. El servidor sigue siendo la defensa real.
 */

export const INCOME_MIN_DATE = '2020-01-01'
export const INCOME_DESCRIPTION_MAX = 500
/** Ids de los `FieldError` de los grupos de botones: los grupos los referencian con `aria-describedby`. */
export const CONCEPT_ERROR_ID = 'income-concept-error'
export const METHOD_ERROR_ID = 'income-method-error'

const CONCEPT_MESSAGE = 'Elegí el concepto'
const AMOUNT_REQUIRED_MESSAGE = 'Ingresá el monto'

/** `null` = sin elegir todavía (lo resuelve el botón); siempre un id entero. */
const conceptIdSchema = z.number({ error: CONCEPT_MESSAGE }).nullable().superRefine((value, ctx) => {
  if (value === null || !Number.isInteger(value) || value <= 0) ctx.addIssue({ code: 'custom', message: CONCEPT_MESSAGE })
})

/** `null` = vacío o no numérico (lo resuelve `AmountField`); siempre centavos enteros. */
const amountCentsSchema = z.number({ error: AMOUNT_REQUIRED_MESSAGE }).nullable().superRefine((value, ctx) => {
  if (value === null) ctx.addIssue({ code: 'custom', message: AMOUNT_REQUIRED_MESSAGE })
  else if (!Number.isInteger(value)) ctx.addIssue({ code: 'custom', message: 'El monto no es válido' })
  else if (value <= 0) ctx.addIssue({ code: 'custom', message: 'El monto tiene que ser mayor a cero' })
})

const occurredOnSchema = z
  .string({ error: 'Elegí la fecha del ingreso' })
  .min(1, 'Elegí la fecha del ingreso')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha no es válida')
  .refine((value) => value <= toClubDate(), 'La fecha del ingreso no puede ser futura')
  .refine((value) => value >= INCOME_MIN_DATE, 'La fecha del ingreso no puede ser anterior a 2020. Revisá el año')

const methodSchema = z.enum(['cash', 'transfer'] satisfies PaymentMethod[], {
  error: 'Elegí el medio: efectivo o transferencia',
})

const descriptionSchema = z
  .string()
  .max(INCOME_DESCRIPTION_MAX, `El detalle no puede tener más de ${INCOME_DESCRIPTION_MAX} caracteres`)

/**
 * El sponsor es obligatorio solo si el concepto elegido lo pide
 * (`requiresSponsor`), por eso el schema se arma con los conceptos que llegó
 * a cargar el formulario.
 */
export function buildIncomeSchema(concepts: CashConcept[]) {
  return z
    .object({
      conceptId: conceptIdSchema,
      sponsorId: z.number().int().positive().nullable(),
      amountCents: amountCentsSchema,
      occurredOn: occurredOnSchema,
      method: methodSchema,
      description: descriptionSchema,
    })
    .superRefine((data, ctx) => {
      const concept = concepts.find((c) => c.id === data.conceptId)
      if (concept?.requiresSponsor && data.sponsorId === null) {
        ctx.addIssue({ code: 'custom', path: ['sponsorId'], message: 'Elegí el sponsor de este ingreso' })
      }
    })
}

export type IncomeFormValues = z.infer<ReturnType<typeof buildIncomeSchema>>

export const INCOME_KNOWN_FIELDS = ['conceptId', 'sponsorId', 'amountCents', 'occurredOn', 'method', 'description'] as const
export type IncomeKnownField = (typeof INCOME_KNOWN_FIELDS)[number]

export function isIncomeKnownField(field: string | undefined): field is IncomeKnownField {
  return (INCOME_KNOWN_FIELDS as readonly string[]).includes(field ?? '')
}
