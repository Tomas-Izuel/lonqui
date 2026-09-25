/**
 * Fechas EN LA ZONA DEL CLUB.
 *
 * El proceso corre en UTC (Vercel, pg_cron). Las 22:00 del 31 en Lonquimay son
 * la 01:00 del 1° en UTC: calcular el período con la hora del servidor le
 * cobra a un socio la cuota del mes siguiente, o registra un pago de fin de mes
 * en el mes que viene. Todo lo que decide un período pasa por acá.
 */

export const CLUB_TIME_ZONE = 'America/Argentina/Buenos_Aires'
const LOCALE = 'es-AR'

/** `YYYY-MM-DD` de ese instante en la zona del club. */
export function toClubDate(instant: Date = new Date()): string {
  // `en-CA` formatea como ISO (YYYY-MM-DD) sin tener que reordenar partes.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/**
 * Período (primer día del mes, `YYYY-MM-01`) al que pertenece ese instante en
 * la zona del club. Es el mismo formato que la columna `period` (`date`).
 */
export function toPeriod(instant: Date = new Date()): string {
  return `${toClubDate(instant).slice(0, 7)}-01`
}

/** `2026-09-01` → "septiembre 2026". */
export function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  // Mediodía UTC: lejos de cualquier borde de día en cualquier zona.
  const label = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1, 12)),
  )
  return label.replace(' de ', ' ')
}

/** `2026-09-25` (date de Postgres) → "25/09/2026". Sin pasar por `Date`. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/** Instante (timestamptz) → "25/09/2026 14:30", en la zona del club, 24 h. */
export function formatDateTime(instant: string | Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: CLUB_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    // `hourCycle: 'h23'` y no `hour12: false`: este último puede imprimir
    // "24:00" según la versión de ICU.
    hourCycle: 'h23',
  }).format(typeof instant === 'string' ? new Date(instant) : instant)
}
