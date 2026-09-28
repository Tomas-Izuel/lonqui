/**
 * ¿Es `next` una ruta interna a la que se puede redirigir después del login?
 *
 * La única fuente para esto. Había tres copias con `startsWith('/') &&
 * !startsWith('//')`, y eso deja pasar `/\evil.com`: los navegadores tratan la
 * barra invertida como `/`, así que `?next=/\evil.com` mandaba a alguien a
 * otro sitio con un login real de por medio (03-review.md, blocker 1).
 *
 * Se resuelve contra un origen ficticio y se exige que siga siendo ese origen:
 * así cualquier truco de parseo (`//`, `/\`, `/%5C`, esquemas, tabs y saltos
 * de línea que el parser ignora) cae del lado de "no".
 */
const PROBE_ORIGIN = 'http://lonqui.invalid'

export function isInternalRedirectPath(next: string | null | undefined): next is string {
  if (!next || !next.startsWith('/')) return false
  // Controles y barras invertidas: no hay una ruta legítima del panel que los use.
  if (/[\u0000-\u001f\\]/.test(next)) return false
  if (next.startsWith('//')) return false

  try {
    const url = new URL(next, PROBE_ORIGIN)
    return url.origin === PROBE_ORIGIN
  } catch {
    return false
  }
}

/** `next` si es interna, si no el fallback. */
export function safeRedirectPath(next: string | null | undefined, fallback = '/'): string {
  return isInternalRedirectPath(next) ? next : fallback
}
