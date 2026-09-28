import { describe, expect, it } from 'vitest'
import { createMemberSchema, updateMemberSchema, statusEventSchema, loadMoreMembersSchema } from '@/models/members.model'

/**
 * Los schemas de `members.model.ts` son lógica pura (sin I/O): la mejor
 * relación costo/beneficio del padrón. Lo que hace Postgres con estos mismos
 * datos (unicidad de DNI, CHECKs, triggers de transición) se prueba contra la
 * base real en `tests/db/members.test.ts`.
 */

// `categoryIds` solo existe en el alta (Revisión 3, `member_categories`):
// `updateMemberSchema` NO lo tiene (los deportes se cambian con la action
// `setMemberCategories`, no con `updateMember`), así que se separan las dos
// bases: `VALID_CORE` (alta) y `VALID_UPDATE_CORE` (modificación).
const VALID_CORE = {
  firstName: 'Ana',
  lastName: 'Pérez',
  dni: '30123456',
  categoryIds: [] as number[],
}

const VALID_UPDATE_CORE = {
  firstName: 'Ana',
  lastName: 'Pérez',
  dni: '30123456',
}

describe('createMemberSchema: DNI obligatorio salvo dniPending', () => {
  it('sin DNI y sin dniPending, rechaza con field "dni"', () => {
    const result = createMemberSchema.safeParse({ ...VALID_CORE, dni: undefined, joinedOn: '2026-01-01' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'dni')).toBe(true)
  })

  it('sin DNI pero con dniPending: true, acepta (carga histórica / DNI pendiente)', () => {
    const result = createMemberSchema.safeParse({
      ...VALID_CORE,
      dni: undefined,
      dniPending: true,
      joinedOn: '2026-01-01',
    })
    expect(result.success).toBe(true)
  })

  it('DNI Y dniPending juntos: rechaza (son contradictorios)', () => {
    const result = createMemberSchema.safeParse({ ...VALID_CORE, dniPending: true, joinedOn: '2026-01-01' })
    expect(result.success).toBe(false)
  })

  it('DNI de menos de 7 dígitos, rechaza', () => {
    const result = createMemberSchema.safeParse({ ...VALID_CORE, dni: '123', joinedOn: '2026-01-01' })
    expect(result.success).toBe(false)
  })

  it('DNI de 7 u 8 dígitos, acepta ambos', () => {
    expect(createMemberSchema.safeParse({ ...VALID_CORE, dni: '1234567', joinedOn: '2026-01-01' }).success).toBe(true)
    expect(createMemberSchema.safeParse({ ...VALID_CORE, dni: '12345678', joinedOn: '2026-01-01' }).success).toBe(true)
  })
})

describe('createMemberSchema: categoryIds (Revisión 3, member_categories)', () => {
  it('array vacío es válido: queda como no practicante (member_type lo deriva el trigger, no Zod)', () => {
    const result = createMemberSchema.safeParse({ ...VALID_CORE, categoryIds: [], joinedOn: '2026-01-01' })
    expect(result.success).toBe(true)
  })

  it('una o más categorías es válido a nivel de forma: existencia, actividad y "una por disciplina" las valida la base, no Zod', () => {
    const result = createMemberSchema.safeParse({ ...VALID_CORE, categoryIds: [5, 9], joinedOn: '2026-01-01' })
    expect(result.success).toBe(true)
  })

  it('ids repetidos: rechaza con field "categoryIds" ("Elegí cada categoría una sola vez")', () => {
    const result = createMemberSchema.safeParse({ ...VALID_CORE, categoryIds: [5, 5], joinedOn: '2026-01-01' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'categoryIds')).toBe(true)
      expect(result.error.issues.some((i) => i.message === 'Elegí cada categoría una sola vez')).toBe(true)
    }
  })

  it('un id no entero o no positivo, rechaza', () => {
    expect(createMemberSchema.safeParse({ ...VALID_CORE, categoryIds: [1.5], joinedOn: '2026-01-01' }).success).toBe(false)
    expect(createMemberSchema.safeParse({ ...VALID_CORE, categoryIds: [0], joinedOn: '2026-01-01' }).success).toBe(false)
    expect(createMemberSchema.safeParse({ ...VALID_CORE, categoryIds: [-3], joinedOn: '2026-01-01' }).success).toBe(false)
  })

  it('más de 20 categorías: rechaza ("Demasiadas categorías")', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => i + 1)
    const result = createMemberSchema.safeParse({ ...VALID_CORE, categoryIds: tooMany, joinedOn: '2026-01-01' })
    expect(result.success).toBe(false)
  })

  it('categoryIds es obligatorio (no tiene default): sin la clave, rechaza', () => {
    const { categoryIds: _omit, ...withoutCategoryIds } = VALID_CORE
    const result = createMemberSchema.safeParse({ ...withoutCategoryIds, joinedOn: '2026-01-01' })
    expect(result.success).toBe(false)
  })
})

describe('createMemberSchema: fechas no futuras', () => {
  it('fecha de nacimiento futura, rechaza', () => {
    const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)
    const result = createMemberSchema.safeParse({ ...VALID_CORE, birthDate: farFuture, joinedOn: '2026-01-01' })
    expect(result.success).toBe(false)
  })

  it('fecha de alta (joinedOn) futura, rechaza', () => {
    const farFuture = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)
    const result = createMemberSchema.safeParse({ ...VALID_CORE, joinedOn: farFuture })
    expect(result.success).toBe(false)
  })

  it('joinedOn en el pasado (carga histórica) se acepta: no se restringe a "hoy"', () => {
    const result = createMemberSchema.safeParse({ ...VALID_CORE, joinedOn: '1999-03-01' })
    expect(result.success).toBe(true)
  })

  it('joinedOn es obligatorio en el alta', () => {
    const result = createMemberSchema.safeParse(VALID_CORE)
    expect(result.success).toBe(false)
  })
})

describe('updateMemberSchema: sin joinedOn, status ni categoryIds', () => {
  it('acepta el mismo shape sin joinedOn', () => {
    const result = updateMemberSchema.safeParse(VALID_UPDATE_CORE)
    expect(result.success).toBe(true)
  })

  it('rechaza si viene con joinedOn (clave desconocida en este schema, .strict())', () => {
    const result = updateMemberSchema.safeParse({ ...VALID_UPDATE_CORE, joinedOn: '2026-01-01' })
    expect(result.success).toBe(false)
  })

  it('rechaza si viene con status (nunca fue parte del shape, ni acá ni en el alta)', () => {
    const result = updateMemberSchema.safeParse({ ...VALID_UPDATE_CORE, status: 'inactive' })
    expect(result.success).toBe(false)
  })

  it('rechaza categoryIds (Revisión 3): los deportes se cambian con setMemberCategories/leaveCategory/changeCategory, nunca con updateMember', () => {
    const result = updateMemberSchema.safeParse({ ...VALID_UPDATE_CORE, categoryIds: [1] })
    expect(result.success).toBe(false)
  })

  it('sigue aplicando la coherencia de DNI/fechas (compartida con el alta vía checkMemberCoherence)', () => {
    expect(updateMemberSchema.safeParse({ ...VALID_UPDATE_CORE, dni: undefined }).success).toBe(false)
    expect(updateMemberSchema.safeParse({ ...VALID_UPDATE_CORE, dni: undefined, dniPending: true }).success).toBe(true)
  })
})

describe('statusEventSchema: ficha de egreso/reingreso', () => {
  const BASE = { memberId: 1, effectiveOn: '2026-01-01', reason: 'Mudanza' }

  it('acepta un motivo de 3+ caracteres', () => {
    expect(statusEventSchema.safeParse(BASE).success).toBe(true)
  })

  it('rechaza un motivo de menos de 3 caracteres (incluido, tras recortar espacios)', () => {
    expect(statusEventSchema.safeParse({ ...BASE, reason: 'ok' }).success).toBe(false)
    expect(statusEventSchema.safeParse({ ...BASE, reason: '  a  ' }).success).toBe(false)
  })

  it('rechaza un motivo vacío', () => {
    expect(statusEventSchema.safeParse({ ...BASE, reason: '' }).success).toBe(false)
  })

  it('no acepta eventType: lo fija la action que llama (withdrawMember/reactivateMember), nunca el input', () => {
    const result = statusEventSchema.safeParse({ ...BASE, eventType: 'admission' })
    expect(result.success).toBe(false)
  })

  it('memberId tiene que ser un entero positivo', () => {
    expect(statusEventSchema.safeParse({ ...BASE, memberId: -1 }).success).toBe(false)
    expect(statusEventSchema.safeParse({ ...BASE, memberId: 1.5 }).success).toBe(false)
  })
})

describe('createMemberSchema: newFamilyGroup (D10 del review, alta con grupo nuevo)', () => {
  it('acepta newFamilyGroup sin familyGroupId', () => {
    const result = createMemberSchema.safeParse({
      ...VALID_CORE,
      joinedOn: '2026-01-01',
      newFamilyGroup: { name: 'Familia Nueva' },
    })
    expect(result.success).toBe(true)
  })

  it('newFamilyGroup Y familyGroupId juntos: son mutuamente excluyentes, rechaza con field "familyGroupId"', () => {
    const result = createMemberSchema.safeParse({
      ...VALID_CORE,
      joinedOn: '2026-01-01',
      familyGroupId: 5,
      newFamilyGroup: { name: 'Familia Nueva' },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((i) => i.path[0] === 'familyGroupId')).toBe(true)
  })

  it('newFamilyGroup NO acepta notes (solo tiene sentido editando un grupo ya creado)', () => {
    const result = createMemberSchema.safeParse({
      ...VALID_CORE,
      joinedOn: '2026-01-01',
      newFamilyGroup: { name: 'Familia Nueva', notes: 'esto no debería aceptarse' },
    })
    expect(result.success).toBe(false)
  })

  it('newFamilyGroup vacío ({}) es válido: todos sus campos son opcionales', () => {
    const result = createMemberSchema.safeParse({ ...VALID_CORE, joinedOn: '2026-01-01', newFamilyGroup: {} })
    expect(result.success).toBe(true)
  })
})

describe('loadMoreMembersSchema (Major 5 del review: "Ver más" como Server Action)', () => {
  it('exige un cursor no vacío', () => {
    expect(loadMoreMembersSchema.safeParse({ filters: {}, cursor: '' }).success).toBe(false)
  })

  it('acepta filtros vacíos con un cursor', () => {
    expect(loadMoreMembersSchema.safeParse({ filters: {}, cursor: 'abc' }).success).toBe(true)
  })

  it('acepta los mismos filtros que MemberFilters (q, categoryId, disciplineId, status, memberType, debt)', () => {
    const result = loadMoreMembersSchema.safeParse({
      filters: { q: 'perez', categoryId: 1, disciplineId: 2, status: 'active', memberType: 'practicing', debt: 'in_debt' },
      cursor: 'abc',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un status fuera del enum', () => {
    const result = loadMoreMembersSchema.safeParse({ filters: { status: 'archived' }, cursor: 'abc' })
    expect(result.success).toBe(false)
  })

  it('rechaza claves desconocidas en filters (.strict())', () => {
    const result = loadMoreMembersSchema.safeParse({ filters: { q: 'x', unknownKey: 1 }, cursor: 'abc' })
    expect(result.success).toBe(false)
  })

  // REGRESIÓN R1 (03-review.md, segunda pasada): "Ver más" del padrón
  // fallaba SIEMPRE porque `socios/page.tsx` mandaba `limit` adentro de
  // `filters`, y `memberFiltersSchema` es `.strict()` sin ese campo. El bug
  // no era de negocio (nunca se vio en un test que solo probara
  // `filters: {}`): era de forma del payload real. Estos tests pasan por el
  // schema la forma EXACTA que manda `MemberList` (`src/views/members/member-list.tsx`,
  // el objeto armado a mano post-fix) y la forma vieja que lo rompía.
  it('CONTRATO: la forma real que manda MemberList (q, categoryId, disciplineId, status, memberType) pasa', () => {
    const result = loadMoreMembersSchema.safeParse({
      filters: {
        q: 'perez',
        categoryId: 3,
        disciplineId: 1,
        status: 'active',
        memberType: 'practicing',
      },
      cursor: 'abc123',
    })
    expect(result.success).toBe(true)
  })

  it('CONTRATO: la misma forma real, pero con los filtros no seteados como undefined (así los manda MemberList cuando no hay filtro activo)', () => {
    const result = loadMoreMembersSchema.safeParse({
      filters: {
        q: undefined,
        categoryId: undefined,
        disciplineId: undefined,
        status: undefined,
        memberType: undefined,
      },
      cursor: 'abc123',
    })
    expect(result.success).toBe(true)
  })

  it('REGRESIÓN R1: si `filters` vuelve a traer `limit` (el bug original), el schema lo rechaza — así no puede reaparecer en silencio', () => {
    const result = loadMoreMembersSchema.safeParse({
      filters: { q: 'perez', limit: 50 },
      cursor: 'abc123',
    })
    expect(result.success).toBe(false)
  })

  it('REGRESIÓN R1: un `cursor` colado DENTRO de filters (en vez de al lado) también se rechaza', () => {
    const result = loadMoreMembersSchema.safeParse({
      filters: { q: 'perez', cursor: 'no-debería-estar-acá' },
      cursor: 'abc123',
    })
    expect(result.success).toBe(false)
  })
})

describe('PADRON_PAGE_SIZE: mismo tamaño de página entre la primera tanda y "Ver más"', () => {
  /**
   * `socios/page.tsx` arma un objeto APARTE para la primera tanda
   * (`{ ...filters, limit: PADRON_PAGE_SIZE }`, nunca mezclado en `filters`);
   * `loadMoreMembers` nunca recibe `limit` (el schema no lo acepta) y depende
   * de que `clampLimit` (privada, no exportada) default a `PADRON_PAGE_SIZE`
   * cuando no llega ninguno. Si algún día alguien desincroniza esos dos
   * números (p. ej. un `LIST_PAGE_SIZE` local hardcodeado en la page, que es
   * justo lo que había antes del fix de R1), este test no lo agarra por sí
   * solo — pero al menos fija que la CONSTANTE que ambos caminos comparten
   * sigue siendo el número que el resto del sistema espera: 50 (route.md /
   * briefs de superficie hablan de páginas de esa magnitud para un padrón de
   * unos pocos cientos de socios).
   */
  it('PADRON_PAGE_SIZE es 50 y es la ÚNICA fuente que ambos caminos comparten', async () => {
    const { PADRON_PAGE_SIZE } = await import('@/models/members.model')
    expect(PADRON_PAGE_SIZE).toBe(50)
  })

  it('socios/page.tsx importa PADRON_PAGE_SIZE del modelo para la primera tanda, no un número propio', async () => {
    // Prueba de contrato a nivel de código fuente, no de runtime: el punto de
    // R1 era exactamente que la page tenía SU PROPIO `LIST_PAGE_SIZE = 50`
    // (dos fuentes de verdad que "por las dudas" coincidían) y además lo
    // filtraba adentro de `filters`. Confirmamos las dos partes del fix: se
    // importa la constante del modelo, y no queda una constante local
    // homónima con un número propio.
    const fs = await import('node:fs/promises')
    const source = await fs.readFile('src/app/(panel)/socios/page.tsx', 'utf8')
    expect(source).toMatch(/import\s*\{\s*PADRON_PAGE_SIZE\s*\}\s*from\s*['"]@\/models\/members\.model['"]/)
    expect(source).not.toMatch(/const\s+LIST_PAGE_SIZE\s*=/)
  })

  it('el objeto que se le pasa a MemberListView (prop filters) nunca incluye limit', async () => {
    const fs = await import('node:fs/promises')
    const source = await fs.readFile('src/app/(panel)/socios/page.tsx', 'utf8')
    // parseFilters() es lo que termina siendo la prop `filters` de la vista:
    // no debe devolver `limit`. Un segundo objeto aparte sí lo lleva para
    // `getPadron` (la primera tanda), y ESE es el único lugar donde debe
    // aparecer `limit: PADRON_PAGE_SIZE`.
    const parseFiltersBody = source.slice(source.indexOf('function parseFilters'), source.indexOf('export default'))
    expect(parseFiltersBody).not.toMatch(/limit/)
    expect(source).toMatch(/limit:\s*PADRON_PAGE_SIZE/)
  })
})
