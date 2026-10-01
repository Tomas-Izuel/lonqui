import { z } from 'zod'
import { toClubDate } from '@/lib/dates'
import type { PaymentMethod } from '@/models/types'

/**
 * Piezas de validación compartidas por `PaymentForm` y `GroupPaymentForm`.
 * Espejan `registerPaymentSchema` / `paymentItemSchema` del modelo (un Client
 * Component no puede importarlo) y el CHECK `amount_cents > 0` de `payments`.
 * Los textos que existen en el servidor se repiten idénticos.
 */

export const PAYMENT_MIN_DATE = '2020-01-01'
export const PAYMENT_NOTES_MAX = 500
/** Id del `FieldError` del medio de pago: los botones lo referencian con `aria-describedby`. */
export const METHOD_ERROR_ID = 'payment-method-error'

export const AMOUNT_REQUIRED_MESSAGE = 'Ingresá el monto'
// Mismos textos que `paymentItemSchema` del servidor.
export const AMOUNT_INVALID_MESSAGE = 'El monto no es válido'
export const AMOUNT_POSITIVE_MESSAGE = 'El monto tiene que ser mayor a cero'

/** `null` = vacío o no numérico (lo resuelve `AmountField`); siempre centavos enteros. */
export const amountCentsSchema = z.number({ error: AMOUNT_REQUIRED_MESSAGE }).nullable().superRefine((value, ctx) => {
  if (value === null) ctx.addIssue({ code: 'custom', message: AMOUNT_REQUIRED_MESSAGE })
  else if (!Number.isInteger(value)) ctx.addIssue({ code: 'custom', message: AMOUNT_INVALID_MESSAGE })
  else if (value <= 0) ctx.addIssue({ code: 'custom', message: AMOUNT_POSITIVE_MESSAGE })
})

export const paidOnSchema = z
  .string({ error: 'Elegí la fecha en que se cobró' })
  .min(1, 'Elegí la fecha en que se cobró')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha no es válida')
  .refine((value) => value <= toClubDate(), 'La fecha del pago no puede ser futura')
  .refine((value) => value >= PAYMENT_MIN_DATE, 'La fecha del pago no puede ser anterior a 2020. Revisá el año')

export const methodSchema = z.enum(['cash', 'transfer'] satisfies PaymentMethod[], {
  error: 'Elegí el medio de pago: efectivo o transferencia',
})

export const notesSchema = z
  .string()
  .max(PAYMENT_NOTES_MAX, `Las notas no pueden tener más de ${PAYMENT_NOTES_MAX} caracteres`)
