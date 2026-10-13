import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'

/**
 * Cobranza pasó a llamarse Caja. Los links guardados (favoritos, mensajes de
 * WhatsApp de la Comisión) siguen andando por estos redirects. Next evalúa
 * `redirects` en orden y gana el PRIMER match: `/cobranza/pagos` (que además
 * cambió de nombre a `/caja/cuotas`) tiene que ir ANTES del comodín, o caería
 * en `/caja/pagos`, que no existe.
 *
 * Se prueba la función REAL de `next.config.ts` y, aparte, un matcher mínimo
 * de `source` (`:path*`) para verificar el efecto: orden, query y destino.
 */

type Redirect = { source: string; destination: string; permanent?: boolean }

async function loadRedirects(): Promise<Redirect[]> {
  expect(typeof nextConfig.redirects).toBe('function')
  return (await nextConfig.redirects!()) as Redirect[]
}

/** Aplica la primera regla que matchee, como Next: devuelve el destino con la query intacta. */
function resolve(redirects: Redirect[], pathname: string, search = ''): string | null {
  for (const rule of redirects) {
    const hasWildcard = rule.source.endsWith('/:path*')
    const base = hasWildcard ? rule.source.slice(0, -'/:path*'.length) : rule.source
    if (!hasWildcard && pathname === base) return rule.destination + search
    if (hasWildcard && (pathname === base || pathname.startsWith(`${base}/`))) {
      const rest = pathname.slice(base.length + 1)
      const destBase = rule.destination.slice(0, -'/:path*'.length)
      return (rest ? `${destBase}/${rest}` : destBase) + search
    }
  }
  return null
}

describe('redirects de /cobranza a /caja (next.config.ts)', () => {
  it('son exactamente tres entradas, permanentes, en este orden', async () => {
    const redirects = await loadRedirects()
    expect(redirects).toEqual([
      { source: '/cobranza', destination: '/caja', permanent: true },
      { source: '/cobranza/pagos', destination: '/caja/cuotas', permanent: true },
      { source: '/cobranza/:path*', destination: '/caja/:path*', permanent: true },
    ])
  })

  it('/cobranza/pagos va ANTES del comodín (primer match gana)', async () => {
    const redirects = await loadRedirects()
    const specific = redirects.findIndex((r) => r.source === '/cobranza/pagos')
    const wildcard = redirects.findIndex((r) => r.source === '/cobranza/:path*')
    expect(specific).toBeGreaterThanOrEqual(0)
    expect(specific).toBeLessThan(wildcard)
  })

  it.each([
    ['/cobranza', '', '/caja'],
    ['/cobranza/pagos', '', '/caja/cuotas'],
    ['/cobranza/pagos', '?mes=2026-09', '/caja/cuotas?mes=2026-09'],
    ['/cobranza/deuda', '', '/caja/deuda'],
    ['/cobranza/al-dia', '?page=2', '/caja/al-dia?page=2'],
    ['/cobranza/por-categoria', '', '/caja/por-categoria'],
    ['/cobranza/nuevo', '?socio=3', '/caja/nuevo?socio=3'],
  ])('%s%s va a %s (query preservada)', async (path, search, expected) => {
    expect(resolve(await loadRedirects(), path, search)).toBe(expected)
  })

  it('el orden importa: con el comodín primero, /cobranza/pagos caería en /caja/pagos (una página que no existe)', async () => {
    const redirects = await loadRedirects()
    const swapped = [redirects[0], redirects[2], redirects[1]]
    expect(resolve(swapped, '/cobranza/pagos')).toBe('/caja/pagos')
    expect(resolve(redirects, '/cobranza/pagos')).toBe('/caja/cuotas')
  })

  it('no toca rutas que no son de cobranza (ni parecidas)', async () => {
    const redirects = await loadRedirects()
    for (const path of ['/caja', '/caja/cuotas', '/socios', '/cobranzas', '/cobranza-vieja', '/']) {
      expect(resolve(redirects, path), path).toBeNull()
    }
  })

  it('ningún destino vuelve a /cobranza (no hay bucles)', async () => {
    for (const rule of await loadRedirects()) expect(rule.destination.startsWith('/cobranza')).toBe(false)
  })
})

describe('headers de seguridad del panel (no se perdieron al sumar redirects)', () => {
  it('siguen definidos: anti-iframe y nosniff', async () => {
    const headers = (await nextConfig.headers!()) as Array<{ headers: Array<{ key: string; value: string }> }>
    const keys = headers[0].headers.map((h) => h.key)
    expect(keys).toEqual(expect.arrayContaining(['X-Frame-Options', 'X-Content-Type-Options', 'Content-Security-Policy']))
  })
})
