import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `members.model.ts`: escrituras (`createMember`, `updateMember`) mockeando
 * el cliente de Supabase en el borde externo. Cubre lo que
 * `02-development-backend-review-fixes.md` le pide a test-engineer:
 * - `translateMemberError`: los dos casos nuevos del blocker 3
 *   (`members_responsible_has_group`, `members_one_responsible_per_group`).
 * - Minor 10: `createMember` con `newFamilyGroup` (caso feliz y DNI duplicado
 *   que NO debe dejar un grupo familiar huérfano).
 * - Minor 11: `updateMember` sobre un id inexistente → 404, no éxito silencioso.
 * - Revisión 3 (slice 2, `member_categories`): `createMember` ya no acepta
 *   `memberType`/`categoryId` (esos campos ni existen en `CreateMemberInput`);
 *   recibe `categoryIds: number[]`, valida la selección ANTES del insert
 *   (`assertCategorySelection`) y, después de insertar el socio, asigna las
 *   categorías con `setMemberCategories` (importado como `assignCategories`).
 *   Si ese segundo paso falla, el socio YA quedó cargado: la función no
 *   revierte nada (dos llamadas separadas a PostgREST, no una transacción) y
 *   avisa con un mensaje explícito en vez de simular atomicidad que no existe.
 */

type QueryResult<T> = { data: T | null; error: { code?: string; message: string } | null }

/** Cadena mínima para `.select().eq().limit().maybeSingle()` (memberDniExists). */
function selectChain<T>(result: QueryResult<T>) {
  return {
    eq: () => ({
      limit: () => ({
        maybeSingle: async () => result,
      }),
    }),
  }
}

function makeFakeMembersClient(config: {
  dniExists?: boolean
  insertResult?: QueryResult<{ id: number }>
  updateResult?: QueryResult<{ id: number }>
}) {
  const from = vi.fn((table: string) => {
    if (table !== 'members') throw new Error(`tabla inesperada en el fake client: ${table}`)
    return {
      select: () => selectChain({ data: config.dniExists ? { id: 999 } : null, error: null }),
      insert: () => ({
        select: () => ({
          single: async () => config.insertResult ?? { data: { id: 1 }, error: null },
        }),
      }),
      update: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => config.updateResult ?? { data: { id: 1 }, error: null },
          }),
        }),
      }),
    }
  })
  return { from }
}

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const createFamilyGroupMock = vi.fn()
vi.mock('@/models/family-groups.model', () => ({
  createFamilyGroup: createFamilyGroupMock,
  getFamilyGroup: vi.fn(),
}))

// `assertCategorySelection` (chequeo previo) y `setMemberCategories`
// (importado en members.model.ts como `assignCategories`, el paso 2 del
// alta): se mockean acá para que `createMember` no le pegue a Postgres por
// ese lado. Con `categoryIds: []` (BASE_INPUT) `assertCategorySelection` real
// ya devuelve sin consultar nada, pero `assignCategories` SIEMPRE se llama
// (sin ese mock, tira sobre el fake client incompleto y todos los "caso
// feliz" de más abajo verían el mensaje de "se cargó pero no sus deportes").
const assertCategorySelectionMock = vi.fn()
const assignCategoriesMock = vi.fn()
vi.mock('@/models/member-categories.model', () => ({
  assertCategorySelection: assertCategorySelectionMock,
  setMemberCategories: assignCategoriesMock,
  listMemberships: vi.fn(),
  openMemberships: vi.fn(),
}))

const { createMember, updateMember } = await import('@/models/members.model')
const { DomainError } = await import('@/lib/errors')

const BASE_INPUT = {
  firstName: 'Ana',
  lastName: 'Test',
  dni: '99123456',
  categoryIds: [] as number[],
  joinedOn: '2026-01-01',
}

beforeEach(() => {
  createClientMock.mockReset()
  createFamilyGroupMock.mockReset()
  assertCategorySelectionMock.mockReset().mockResolvedValue(undefined)
  assignCategoriesMock.mockReset().mockResolvedValue(undefined)
})

describe('createMember: chequeo previo de DNI (memberDniExists)', () => {
  it('DNI ya existente: DomainError ANTES del insert, sin tocar family_groups', async () => {
    createClientMock.mockResolvedValue(makeFakeMembersClient({ dniExists: true }))

    await expect(createMember(BASE_INPUT)).rejects.toMatchObject({ message: 'Ya hay un socio con ese DNI', field: 'dni' })
    expect(createFamilyGroupMock).not.toHaveBeenCalled()
  })

  it('DNI duplicado CON newFamilyGroup presente: el grupo NO se crea (sin huérfanos)', async () => {
    createClientMock.mockResolvedValue(makeFakeMembersClient({ dniExists: true }))

    await createMember({ ...BASE_INPUT, newFamilyGroup: { name: 'Familia Nueva' } }).catch(() => {})

    expect(createFamilyGroupMock).not.toHaveBeenCalled()
  })
})

describe('createMember: newFamilyGroup (Minor 10)', () => {
  it('caso feliz: crea el grupo primero y usa su id como family_group_id del socio', async () => {
    createFamilyGroupMock.mockResolvedValue({ id: 42 })
    const fake = makeFakeMembersClient({ dniExists: false, insertResult: { data: { id: 7 }, error: null } })
    createClientMock.mockResolvedValue(fake)

    const result = await createMember({ ...BASE_INPUT, newFamilyGroup: { name: 'Familia Nueva' } })

    expect(result).toEqual({ id: 7 })
    expect(createFamilyGroupMock).toHaveBeenCalledWith({ name: 'Familia Nueva' })
  })

  it('sin newFamilyGroup, no se crea ningún grupo', async () => {
    createClientMock.mockResolvedValue(makeFakeMembersClient({ dniExists: false }))
    await createMember(BASE_INPUT)
    expect(createFamilyGroupMock).not.toHaveBeenCalled()
  })
})

describe('translateMemberError (vía createMember/updateMember)', () => {
  it('23505 sobre members_dni_key -> DomainError field dni', async () => {
    createClientMock.mockResolvedValue(
      makeFakeMembersClient({
        dniExists: false,
        insertResult: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "members_dni_key"' } },
      }),
    )
    await expect(createMember(BASE_INPUT)).rejects.toMatchObject({
      message: 'Ya hay un socio con ese DNI',
      field: 'dni',
    })
  })

  it('23505 sobre members_one_responsible_per_group -> DomainError field familyGroupId (blocker 3)', async () => {
    createClientMock.mockResolvedValue(
      makeFakeMembersClient({
        dniExists: false,
        insertResult: {
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint "members_one_responsible_per_group"' },
        },
      }),
    )
    await expect(createMember(BASE_INPUT)).rejects.toMatchObject({
      message: 'Ese grupo familiar ya tiene un responsable de pago',
      field: 'familyGroupId',
    })
  })

  it('23514 sobre members_responsible_has_group -> DomainError field familyGroupId (blocker 3)', async () => {
    createClientMock.mockResolvedValue(
      makeFakeMembersClient({
        dniExists: false,
        insertResult: {
          data: null,
          error: { code: '23514', message: 'new row for relation "members" violates check constraint "members_responsible_has_group"' },
        },
      }),
    )
    await expect(createMember(BASE_INPUT)).rejects.toMatchObject({
      message: 'El responsable de pago no puede quedar sin grupo familiar',
      field: 'familyGroupId',
    })
  })

  it('un error de Postgres no reconocido se relanza tal cual (nunca se le muestra el texto crudo al usuario sin traducir)', async () => {
    const rawError = { code: '42501', message: 'permission denied for table members' }
    createClientMock.mockResolvedValue(
      makeFakeMembersClient({ dniExists: false, insertResult: { data: null, error: rawError } }),
    )
    await expect(createMember(BASE_INPUT)).rejects.toEqual(rawError)
  })
})

describe('createMember: categoryIds (Revisión 3, member_categories)', () => {
  it('valida la selección de categorías ANTES de insertar el socio (assertCategorySelection primero)', async () => {
    const insertSpy = vi.fn()
    createClientMock.mockResolvedValue({
      from: (table: string) => {
        if (table !== 'members') throw new Error(`tabla inesperada: ${table}`)
        return {
          select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
          insert: insertSpy,
        }
      },
    })
    assertCategorySelectionMock.mockRejectedValue(new DomainError('Una de las categorías elegidas no existe', { field: 'categoryIds' }))

    await expect(createMember({ ...BASE_INPUT, categoryIds: [999] })).rejects.toMatchObject({
      message: 'Una de las categorías elegidas no existe',
      field: 'categoryIds',
    })
    // Rechazado antes del insert real del socio.
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('caso feliz: inserta el socio y asigna las categorías con effectiveOn = joinedOn', async () => {
    createClientMock.mockResolvedValue(makeFakeMembersClient({ dniExists: false, insertResult: { data: { id: 7 }, error: null } }))

    const result = await createMember({ ...BASE_INPUT, categoryIds: [5, 9] })

    expect(result).toEqual({ id: 7 })
    expect(assignCategoriesMock).toHaveBeenCalledWith({ memberId: 7, categoryIds: [5, 9], effectiveOn: BASE_INPUT.joinedOn })
  })

  it('el socio se carga aunque falle assignCategories (asignación de deportes), con un mensaje que lo explica', async () => {
    createClientMock.mockResolvedValue(makeFakeMembersClient({ dniExists: false, insertResult: { data: { id: 8 }, error: null } }))
    assignCategoriesMock.mockRejectedValue(new Error('cualquier falla de la RPC'))

    await expect(createMember({ ...BASE_INPUT, categoryIds: [5] })).rejects.toMatchObject({
      message: 'Se cargó el socio pero no sus deportes: agregalos desde la ficha',
    })
  })
})

describe('updateMember: 404 sobre un id que no existe (Minor 11)', () => {
  it('sin fila devuelta (id inexistente o fuera de lo que RLS deja ver), tira DomainError 404, no éxito silencioso', async () => {
    createClientMock.mockResolvedValue(
      makeFakeMembersClient({ updateResult: { data: null, error: null } }),
    )

    const err = await updateMember(99999, BASE_INPUT).catch((e) => e)
    expect(DomainError.prototype.isPrototypeOf(err) || err instanceof DomainError).toBe(true)
    expect(err.message).toBe('El socio no existe')
    expect(err.status).toBe(404)
  })

  it('con fila devuelta, no tira nada', async () => {
    createClientMock.mockResolvedValue(
      makeFakeMembersClient({ updateResult: { data: { id: 5 }, error: null } }),
    )
    await expect(updateMember(5, BASE_INPUT)).resolves.toBeUndefined()
  })
})
