import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guardias estáticas del pipeline de la caja (2026-10-13). No prueban
 * comportamiento: fijan reglas de arquitectura que, si se rompen, abren un
 * agujero sin que ningún test funcional se entere.
 *  - ninguna ruta viva a /cobranza (los links viejos entran por los redirects);
 *  - el código nuevo chequea PERMISOS, no roles, y escribe con el cliente de
 *    sesión (el actor de la auditoría sale de auth.uid(); con el admin client
 *    quedaría sin autor);
 *  - el route handler del CSV no habla con Supabase ni con modelos: delega en
 *    el controller, que audita antes de entregar.
 */

const ROOT = join(__dirname, '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/** Quita comentarios para no confundir un "// antes era /cobranza" con una ruta viva. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('no queda ninguna ruta viva a /cobranza en src/', () => {
  it('ni como string de href/redirect/revalidatePath/router.push', () => {
    const offenders: string[] = []
    for (const file of walk(join(ROOT, 'src'))) {
      const code = stripComments(readFileSync(file, 'utf8'))
      if (/['"`]\/cobranza(?:[/'"`?#])/.test(code)) offenders.push(relative(ROOT, file))
    }
    expect(offenders).toEqual([])
  })
})

const NEW_BACKEND_FILES = [
  'src/controllers/income.actions.ts',
  'src/controllers/income.controller.ts',
  'src/controllers/sponsors.actions.ts',
  'src/models/cash-movements.model.ts',
  'src/models/cash-concepts.model.ts',
  'src/models/sponsors.model.ts',
  'src/models/exports.model.ts',
  'src/app/api/caja/ingresos/exportar/route.ts',
]

describe('código nuevo de la caja: permisos, no roles; cliente de sesión, no admin', () => {
  it.each(NEW_BACKEND_FILES)('%s no usa requireRole, requirePanelAccess, session.role, has_role ni el admin client', (file) => {
    const code = stripComments(read(file))
    expect(code).not.toMatch(/\brequireRole\b/)
    expect(code).not.toMatch(/\brequirePanelAccess\b/)
    expect(code).not.toMatch(/session\.role|\.role\s*===/)
    expect(code).not.toMatch(/has_role|is_admin/)
    expect(code).not.toMatch(/createAdminClient|supabase\/admin/)
  })

  it.each(['src/controllers/income.actions.ts', 'src/controllers/sponsors.actions.ts'])(
    '%s: cada action pide un permiso y revalida /caja entera tras escribir',
    (file) => {
      const code = stripComments(read(file))
      expect(code).toMatch(/requirePermission\(/)
      expect(code).toMatch(/revalidatePath\('\/caja', 'layout'\)/)
      expect(code.trimStart().startsWith("'use server'")).toBe(true)
    },
  )

  it('el route handler del CSV no importa @supabase/* ni modelos: solo el controller y el traductor de errores', () => {
    const code = stripComments(read('src/app/api/caja/ingresos/exportar/route.ts'))
    expect(code).not.toMatch(/@supabase\//)
    expect(code).not.toMatch(/@\/models\//)
    expect(code).toMatch(/@\/controllers\/income\.controller/)
  })

  it('un .actions.ts solo exporta funciones async (Next rechaza el build si no)', () => {
    for (const file of ['src/controllers/income.actions.ts', 'src/controllers/sponsors.actions.ts']) {
      const code = stripComments(read(file))
      const exports = [...code.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1])
      expect(exports.length, file).toBeGreaterThan(0)
      for (const kind of exports) expect(kind, file).toBe('async')
    }
  })
})
