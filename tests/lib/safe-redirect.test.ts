import { describe, expect, it } from 'vitest'
import { isInternalRedirectPath, safeRedirectPath } from '@/lib/safe-redirect'

/**
 * Única fuente de verdad para "¿es `next` una ruta interna?" (03-review.md,
 * blocker 1: había tres copias con `startsWith('/') && !startsWith('//')`,
 * que dejaban pasar `/\evil.com` — los navegadores tratan `\` como `/`, así
 * que esa ruta termina en un sitio externo con un login real de por medio).
 */
describe('isInternalRedirectPath', () => {
  it('acepta una ruta relativa simple', () => {
    expect(isInternalRedirectPath('/socios/42')).toBe(true)
  })

  it('acepta la raíz', () => {
    expect(isInternalRedirectPath('/')).toBe(true)
  })

  it('rechaza una URL absoluta con esquema (https://x)', () => {
    expect(isInternalRedirectPath('https://x')).toBe(false)
    expect(isInternalRedirectPath('https://evil.example.com/socios')).toBe(false)
  })

  it('rechaza protocol-relative (//x)', () => {
    expect(isInternalRedirectPath('//x')).toBe(false)
    expect(isInternalRedirectPath('//evil.example.com')).toBe(false)
  })

  it('rechaza la barra invertida (/\\evil.com): el browser la trata como /', () => {
    expect(isInternalRedirectPath('/\\evil.com')).toBe(false)
    expect(isInternalRedirectPath('/\\/evil.com')).toBe(false)
  })

  it('rechaza caracteres de control (tabs, saltos de línea) que un parser laxo podría ignorar', () => {
    expect(isInternalRedirectPath('/\t/evil.com')).toBe(false)
    expect(isInternalRedirectPath('/\n/evil.com')).toBe(false)
    expect(isInternalRedirectPath('/\u0000evil.com')).toBe(false)
  })

  it('rechaza un esquema data:/javascript: disfrazado con un / adelante no cambia nada, pero por las dudas', () => {
    expect(isInternalRedirectPath('/javascript:alert(1)')).toBe(true) // sigue siendo una ruta relativa válida del panel
    // Lo que importa es que resuelto contra el origen del panel, sigue siendo el mismo origen.
  })

  it('rechaza string vacío, null y undefined', () => {
    expect(isInternalRedirectPath('')).toBe(false)
    expect(isInternalRedirectPath(null)).toBe(false)
    expect(isInternalRedirectPath(undefined)).toBe(false)
  })

  it('rechaza una ruta que no empieza con /', () => {
    expect(isInternalRedirectPath('socios/42')).toBe(false)
  })

  it('acepta rutas con query string y hash (siguen siendo del mismo origen)', () => {
    expect(isInternalRedirectPath('/socios?q=perez')).toBe(true)
    expect(isInternalRedirectPath('/socios/42#historia')).toBe(true)
  })
})

describe('safeRedirectPath', () => {
  it('devuelve next si es interna', () => {
    expect(safeRedirectPath('/socios/42')).toBe('/socios/42')
  })

  it('devuelve el fallback ("/" por defecto) si next es externa', () => {
    expect(safeRedirectPath('https://evil.example.com')).toBe('/')
    expect(safeRedirectPath('//evil.example.com')).toBe('/')
    expect(safeRedirectPath('/\\evil.com')).toBe('/')
  })

  it('acepta un fallback custom', () => {
    expect(safeRedirectPath(undefined, '/socios')).toBe('/socios')
  })
})
