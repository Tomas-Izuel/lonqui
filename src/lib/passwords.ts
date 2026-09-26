import { z } from 'zod'

/**
 * Contraseñas de la Fase 1: sin mail. Un admin crea el usuario con una
 * contraseña temporal que genera el sistema y se la pasa en mano; el sistema
 * obliga a cambiarla en el primer ingreso (ver D8 en el pipeline
 * 2026-09-25-padron-roles-auditoria).
 *
 * Sin `server-only` a propósito: se testea en unidad y el schema lo usa
 * también el formulario del browser. `generateTemporaryPassword` solo la
 * llaman Server Actions.
 */

/** Misma política que `supabase/config.toml` ([auth] minimum_password_length
 * y password_requirements = "letters_digits"). Si cambia una, cambia la otra. */
export const passwordPolicySchema = z
  .string()
  .min(10, 'La contraseña tiene que tener al menos 10 caracteres')
  .max(72, 'La contraseña no puede tener más de 72 caracteres')
  .regex(/[a-zA-Z]/, 'La contraseña tiene que tener al menos una letra')
  .regex(/[0-9]/, 'La contraseña tiene que tener al menos un número')

// Sin caracteres que se confunden al dictarla o copiarla a mano: 0/O, 1/l/I.
const LETTERS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const ALPHABET = LETTERS + DIGITS
const LENGTH = 12

function randomIndex(max: number): number {
  // Rechazo de muestras para no sesgar: 256 no es múltiplo del alfabeto.
  const limit = 256 - (256 % max)
  const buffer = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    if (buffer[0] < limit) return buffer[0] % max
  }
}

/**
 * 12 caracteres de letras y dígitos sin ambiguos. Siempre cumple
 * `passwordPolicySchema`: se garantiza al menos una letra y un dígito.
 * Nunca se loguea, nunca se persiste: viaja una sola vez al admin.
 */
export function generateTemporaryPassword(): string {
  const chars = Array.from({ length: LENGTH }, () => ALPHABET[randomIndex(ALPHABET.length)])
  // Dos posiciones distintas: una forzada a letra y otra a dígito.
  const letterSlot = randomIndex(LENGTH)
  let digitSlot = randomIndex(LENGTH - 1)
  if (digitSlot >= letterSlot) digitSlot += 1
  chars[letterSlot] = LETTERS[randomIndex(LETTERS.length)]
  chars[digitSlot] = DIGITS[randomIndex(DIGITS.length)]
  return chars.join('')
}
