/**
 * Un `check_violation` puede venir de dos lados: de un trigger nuestro, cuyo
 * mensaje YA está redactado para el usuario ("La fecha no puede ser futura"),
 * o de un CHECK declarativo, cuyo mensaje es el crudo de Postgres ("new row
 * for relation \"x\" violates check constraint \"y\""). Lo primero se puede
 * mostrar; lo segundo no (CLAUDE.md: un `catch` que devuelve `err.message`
 * termina mostrando el detalle de una constraint).
 *
 * Sin `server-only` a propósito: es una función pura, la usan varios modelos.
 */
const RAW_POSTGRES_MESSAGE = /violates (check|not-null|unique|foreign key) constraint|null value in column|duplicate key value/i

export function isRawPostgresMessage(message: string | undefined | null): boolean {
  return typeof message === 'string' && RAW_POSTGRES_MESSAGE.test(message)
}
