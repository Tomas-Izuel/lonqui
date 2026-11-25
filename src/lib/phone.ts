import { parsePhoneNumberFromString } from 'libphonenumber-js'

/**
 * Teléfonos argentinos y enlaces de WhatsApp. Todo puro: sin red, sin base, sin
 * `server-only`, para poder probarlo sin mocks (pipeline 2026-11-24-app-socios,
 * 00 §A.9).
 *
 * Esto normaliza ENTRADAS (el teléfono que figura en el padrón, el que declara
 * un pedido de acceso) para armar un `wa.me`. Las coincidencias del padrón las
 * sugiere `private.phone_match_keys` en SQL: acá no se decide ningún vínculo.
 */

const E164 = /^\+[0-9]{8,15}$/

/** Largo de un número nacional argentino sin `0` ni `15`: área + abonado. */
const AR_NATIONAL_LENGTH = 10

/**
 * Teléfono tal cual lo tipeó una persona → E.164 (`+54…`), o `null` si no se
 * puede resolver sin adivinar.
 *
 * - Con `+` o con `54` adelante: se interpreta como internacional.
 * - Con `0` de larga distancia o con área completa (10 dígitos): lo resuelve
 *   libphonenumber (saca el `0` y el `15`).
 * - Sin código de área (típico del padrón: "4444-5555"): se completa con el
 *   `defaultAreaCode` del club (`settings.default_phone_area_code`). Sin ese
 *   dato es ambiguo y devuelve `null`: mejor no ofrecer el botón que mandar
 *   la invitación al número equivocado.
 */
export function normalizePhoneToE164(
  raw: string | null | undefined,
  defaultAreaCode?: string | null,
): string | null {
  const text = (raw ?? '').trim()
  if (text === '') return null

  const digits = text.replace(/\D/g, '')
  if (digits === '') return null

  let candidate: string | null = null

  if (text.startsWith('+')) {
    candidate = `+${digits}`
  } else if (digits.startsWith('54') && digits.length >= 12) {
    candidate = `+${digits}`
  } else if (digits.startsWith('0')) {
    candidate = digits
  } else if (digits.length === AR_NATIONAL_LENGTH && !digits.startsWith('15')) {
    // Ningún código de área argentino empieza con 15: "15 4444 5555" es el `15`
    // de celular más un abonado de 8 dígitos, no un área completa.
    candidate = digits
  } else if (defaultAreaCode && /^[1-9][0-9]{1,3}$/.test(defaultAreaCode)) {
    const local = digits.startsWith('15') ? digits.slice(2) : digits
    if (defaultAreaCode.length + local.length === AR_NATIONAL_LENGTH) {
      candidate = `${defaultAreaCode}${local}`
    }
  }

  if (!candidate) return null

  const parsed = parsePhoneNumberFromString(candidate, 'AR')
  if (!parsed || !parsed.isValid()) return null
  return E164.test(parsed.number) ? parsed.number : null
}

/**
 * Dígitos para `wa.me/<dígitos>`: E.164 sin el `+`. Un móvil argentino en
 * WhatsApp lleva `9` después del `54`; el padrón casi nunca lo trae (el `15`
 * lo reemplaza), así que se inserta. Un número fijo no tiene WhatsApp: si
 * alguien eligió esta vía, el número es de un móvil.
 */
export function phoneToWhatsAppDigits(e164: string | null | undefined): string | null {
  if (!e164 || !E164.test(e164)) return null
  const digits = e164.slice(1)
  if (digits.startsWith('54') && !digits.startsWith('549')) return `549${digits.slice(2)}`
  return digits
}

/** Primer candidato (en orden de prioridad) que se pueda normalizar. */
export function pickWhatsAppPhone(
  candidates: readonly (string | null | undefined)[],
  defaultAreaCode?: string | null,
): string | null {
  for (const candidate of candidates) {
    const e164 = normalizePhoneToE164(candidate, defaultAreaCode)
    if (e164) return e164
  }
  return null
}

export function buildWhatsAppUrl(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

/**
 * Enlace de la app de socios. El token va en el FRAGMENTO (`#t=`): no viaja al
 * servidor, ni a logs, ni al `Referer` (00 §A.3). Nunca se persiste.
 */
export function buildPortalUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/entrar#t=${token}`
}

/**
 * Mensaje de WhatsApp. Sin datos personales: ni el nombre del socio ni el de
 * quien lo recibe. El espacio antes del punto evita que WhatsApp lo incluya
 * dentro del enlace.
 */
export function buildPortalMessage(kind: 'invite' | 'login', url: string): string {
  if (kind === 'login') {
    return `Hola. Para volver a entrar a la app de socios del Club, usá este enlace: ${url} . Vence en 30 minutos.`
  }
  return `Hola. Te invitamos a la app de socios del Club. Entrá desde este enlace: ${url} . Vence en 72 horas.`
}
