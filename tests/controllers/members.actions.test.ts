import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Solo la parte de seguridad de `members.actions.ts` que vale la pena mockear:
 * el chequeo de rol delegado en `requireRole`, y sobre todo
 * `confirmMedicalClearance`, que es la única defensa entre "un cliente manda
 * cualquier `path`" y "se crea una fila que apunta al archivo de otro socio o
 * a nada". El resto (traducción de errores de Postgres, keyset, búsqueda) se
 * prueba contra la base real en `tests/db/`, no con mocks de la cadena de
 * supabase-js.
 */

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const requireRoleMock = vi.fn()
const requirePermissionMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({
  requireRole: requireRoleMock,
  requirePermission: requirePermissionMock,
}))

const insertMemberMock = vi.fn()
const searchMembersMock = vi.fn()
vi.mock('@/models/members.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/members.model')>('@/models/members.model')
  return { ...actual, createMember: insertMemberMock, searchMembers: searchMembersMock }
})

const setPaymentResponsibleRpcMock = vi.fn()
vi.mock('@/models/family-groups.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/family-groups.model')>('@/models/family-groups.model')
  return { ...actual, setPaymentResponsible: setPaymentResponsibleRpcMock }
})

const insertMedicalClearanceMock = vi.fn()
const getMedicalClearanceByIdMock = vi.fn()
vi.mock('@/models/medical-clearances.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/medical-clearances.model')>(
    '@/models/medical-clearances.model',
  )
  return {
    ...actual,
    createMedicalClearance: insertMedicalClearanceMock,
    getMedicalClearanceById: getMedicalClearanceByIdMock,
  }
})

const objectExistsMock = vi.fn()
const createSignedUploadUrlMock = vi.fn()
const getSignedUrlMock = vi.fn()
vi.mock('@/services/storage.service', () => ({
  createSignedUploadUrl: createSignedUploadUrlMock,
  objectExists: objectExistsMock,
  getSignedUrl: getSignedUrlMock,
}))

const getMemberAccountMock = vi.fn()
vi.mock('@/models/accounts.model', () => ({ getMemberAccount: getMemberAccountMock }))

/** `supabase.from('members').select('phone').eq(id).maybeSingle()`, la segunda lectura de la vista rápida. */
const maybeSingleMock = vi.fn()
const createClientMock = vi.fn(async () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const { createMember, confirmMedicalClearance, getMedicalClearanceUrl, loadMoreMembers, getMemberQuickView } =
  await import('@/controllers/members.actions')
const { PermissionError } = await import('@/lib/errors')

beforeEach(() => {
  revalidatePathMock.mockClear()
  requireRoleMock.mockReset()
  requirePermissionMock.mockReset()
  insertMemberMock.mockReset()
  searchMembersMock.mockReset()
  setPaymentResponsibleRpcMock.mockReset()
  insertMedicalClearanceMock.mockReset()
  getMedicalClearanceByIdMock.mockReset()
  objectExistsMock.mockReset()
  createSignedUploadUrlMock.mockReset()
  getSignedUrlMock.mockReset()
  getMemberAccountMock.mockReset()
  maybeSingleMock.mockReset()
  createClientMock.mockClear()
})

describe('createMember', () => {
  it('consulta (sin admin/editor) no llega a tocar el modelo', async () => {
    requireRoleMock.mockRejectedValue(new PermissionError())
    const result = await createMember({ firstName: 'Ana', lastName: 'Test' })
    expect(result.ok).toBe(false)
    expect(insertMemberMock).not.toHaveBeenCalled()
  })
})

describe('confirmMedicalClearance', () => {
  const VALID_INPUT = {
    memberId: 42,
    path: 'medical-clearances/42/abc.jpg',
    expiresOn: '2027-01-01',
  }

  beforeEach(() => {
    requireRoleMock.mockResolvedValue({ userId: 'editor-1', role: 'editor' })
  })

  it('un path con el prefijo de OTRO socio se rechaza SIN llegar a preguntarle a Storage', async () => {
    const result = await confirmMedicalClearance({ ...VALID_INPUT, path: 'medical-clearances/999/abc.jpg' })
    expect(result).toMatchObject({ ok: false, error: 'El archivo no corresponde a este socio' })
    expect(objectExistsMock).not.toHaveBeenCalled()
    expect(insertMedicalClearanceMock).not.toHaveBeenCalled()
  })

  it('un path de otra carpeta cualquiera (no medical-clearances/) también se rechaza', async () => {
    const result = await confirmMedicalClearance({ ...VALID_INPUT, path: 'payment-receipts/42/abc.jpg' })
    expect(result.ok).toBe(false)
    expect(objectExistsMock).not.toHaveBeenCalled()
  })

  it('prefijo correcto pero el objeto no existe en Storage: se rechaza y no crea la fila', async () => {
    objectExistsMock.mockResolvedValue(false)
    const result = await confirmMedicalClearance(VALID_INPUT)
    expect(result).toMatchObject({ ok: false, error: 'No encontramos el archivo subido. Probá de nuevo.' })
    expect(insertMedicalClearanceMock).not.toHaveBeenCalled()
  })

  it('prefijo correcto y objeto existente: crea la fila con el path confirmado', async () => {
    objectExistsMock.mockResolvedValue(true)
    insertMedicalClearanceMock.mockResolvedValue({ id: 7 })

    const result = await confirmMedicalClearance(VALID_INPUT)

    expect(result).toEqual({ ok: true, data: { id: 7 } })
    expect(insertMedicalClearanceMock).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 42, storagePath: 'medical-clearances/42/abc.jpg' }),
    )
  })
})

describe('getMedicalClearanceUrl', () => {
  beforeEach(() => {
    // Guard nuevo (pipeline de cuotas/pagos, T12): `requirePermission('members.read')`
    // en vez de `requireRole()` sin roles. Con el mapeo de hoy es equivalente
    // (todo rol activo tiene `members.read`), pero lo que la action llama de
    // verdad cambió.
    requirePermissionMock.mockResolvedValue({ userId: 'consulta-1', role: 'consulta', permissions: ['members.read'] })
  })

  it('cualquier rol con members.read puede pedirla (requirePermission, no requireRole)', async () => {
    getMedicalClearanceByIdMock.mockResolvedValue({
      id: 7,
      memberId: 42,
      expiresOn: '2027-01-01',
      storagePath: 'medical-clearances/42/x.jpg',
      originalFilename: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
    })
    getSignedUrlMock.mockResolvedValue('https://signed.example/x.jpg')

    const result = await getMedicalClearanceUrl({ memberId: 42, clearanceId: 7 })

    expect(result).toEqual({ ok: true, data: { url: 'https://signed.example/x.jpg' } })
    expect(requirePermissionMock).toHaveBeenCalledWith('members.read')
  })

  it('sin members.read (requirePermission rechaza): no llega a preguntarle al modelo', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await getMedicalClearanceUrl({ memberId: 42, clearanceId: 7 })
    expect(result.ok).toBe(false)
    expect(getMedicalClearanceByIdMock).not.toHaveBeenCalled()
  })

  it('un clearanceId que no pertenece al memberId pedido se rechaza SIN firmar nada', async () => {
    getMedicalClearanceByIdMock.mockResolvedValue({
      id: 7,
      memberId: 999, // pertenece a OTRO socio
      expiresOn: '2027-01-01',
      storagePath: 'medical-clearances/999/x.jpg',
      originalFilename: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
    })

    const result = await getMedicalClearanceUrl({ memberId: 42, clearanceId: 7 })

    expect(result).toMatchObject({ ok: false, error: 'No encontramos ese apto físico' })
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it('un clearanceId inexistente se rechaza igual (mismo mensaje, no revela si existe)', async () => {
    getMedicalClearanceByIdMock.mockResolvedValue(null)
    const result = await getMedicalClearanceUrl({ memberId: 42, clearanceId: 999 })
    expect(result).toMatchObject({ ok: false, error: 'No encontramos ese apto físico' })
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it('un apto sin adjunto (solo fecha, sin storagePath) se rechaza antes de gastar una firma', async () => {
    getMedicalClearanceByIdMock.mockResolvedValue({
      id: 7,
      memberId: 42,
      expiresOn: '2027-01-01',
      storagePath: null,
      originalFilename: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
    })

    const result = await getMedicalClearanceUrl({ memberId: 42, clearanceId: 7 })

    expect(result).toMatchObject({ ok: false, error: 'Este apto no tiene certificado adjunto' })
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it('firma con TTL corto (60 s), no una URL de vida larga', async () => {
    getMedicalClearanceByIdMock.mockResolvedValue({
      id: 7,
      memberId: 42,
      expiresOn: '2027-01-01',
      storagePath: 'medical-clearances/42/x.jpg',
      originalFilename: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
    })
    getSignedUrlMock.mockResolvedValue('https://signed.example/x.jpg')

    await getMedicalClearanceUrl({ memberId: 42, clearanceId: 7 })

    expect(getSignedUrlMock).toHaveBeenCalledWith('medical-clearances/42/x.jpg', 60)
  })
})

describe('loadMoreMembers', () => {
  it('cualquier rol con members.read puede pedir más páginas (requirePermission, no requireRole)', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'consulta-1', role: 'consulta', permissions: ['members.read'] })
    searchMembersMock.mockResolvedValue({ items: [], nextCursor: null })

    const result = await loadMoreMembers({ filters: {}, cursor: 'abc123' })

    expect(result).toEqual({ ok: true, data: { items: [], nextCursor: null } })
    expect(requirePermissionMock).toHaveBeenCalledWith('members.read')
  })

  it('sin members.read (requirePermission rechaza): no llega a tocar el modelo', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await loadMoreMembers({ filters: {}, cursor: 'abc123' })
    expect(result.ok).toBe(false)
    expect(searchMembersMock).not.toHaveBeenCalled()
  })

  it('pasa filters + cursor tal cual al modelo, con includeDebt según session.permissions (nunca session.role)', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'consulta-1', role: 'consulta', permissions: ['members.read', 'payments.read'] })
    searchMembersMock.mockResolvedValue({ items: [], nextCursor: 'xyz' })

    await loadMoreMembers({ filters: { status: 'active', q: 'perez' }, cursor: 'abc123' })

    expect(searchMembersMock).toHaveBeenCalledWith(
      { status: 'active', q: 'perez', cursor: 'abc123' },
      { includeDebt: true },
    )
  })

  it('sin payments.read en session.permissions, includeDebt sale false (el filtro de deuda no se ni pide)', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'consulta-1', role: 'consulta', permissions: ['members.read'] })
    searchMembersMock.mockResolvedValue({ items: [], nextCursor: null })

    await loadMoreMembers({ filters: {}, cursor: 'abc123' })

    expect(searchMembersMock).toHaveBeenCalledWith({ cursor: 'abc123' }, { includeDebt: false })
  })

  it('un cursor vacío es inválido (Zod lo corta antes de tocar el modelo)', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'consulta-1', role: 'consulta', permissions: ['members.read'] })
    const result = await loadMoreMembers({ filters: {}, cursor: '' })
    expect(result.ok).toBe(false)
    expect(searchMembersMock).not.toHaveBeenCalled()
  })
})

describe('getMemberQuickView (B1, sheet de vista rápida abierto con ?ver=<id>)', () => {
  it('sin sesión (requirePermission rechaza con PermissionError): ActionResult de error, nunca una excepción', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())

    const result = await getMemberQuickView(12)

    expect(result.ok).toBe(false)
    expect(getMemberAccountMock).not.toHaveBeenCalled()
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('exige payments.read, no members.read (la vista rápida siempre muestra estado de cuenta)', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'u1', role: 'consulta', permissions: ['payments.read'] })
    getMemberAccountMock.mockResolvedValue({ memberId: 12, fullName: 'Test Socia' })
    maybeSingleMock.mockResolvedValue({ data: { phone: null }, error: null })

    await getMemberQuickView(12)

    expect(requirePermissionMock).toHaveBeenCalledWith('payments.read')
  })

  it('memberId inválido (0, negativo o no entero): error de validación de Zod, sin tocar el modelo', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'u1', role: 'consulta', permissions: ['payments.read'] })

    for (const invalidId of [0, -1, 1.5]) {
      const result = await getMemberQuickView(invalidId)
      expect(result.ok).toBe(false)
    }
    expect(getMemberAccountMock).not.toHaveBeenCalled()
  })

  it('socio inexistente (getMemberAccount devuelve null): error de dominio "No encontramos ese socio", nunca un throw sin capturar', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'u1', role: 'consulta', permissions: ['payments.read'] })
    getMemberAccountMock.mockResolvedValue(null)

    const result = await getMemberQuickView(999)

    expect(result).toEqual({ ok: false, error: 'No encontramos ese socio' })
    // La segunda lectura (teléfono) nunca se ejecuta si el socio no existe.
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('éxito: junta MemberAccount con phone de la segunda lectura (members.phone)', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'u1', role: 'consulta', permissions: ['payments.read'] })
    getMemberAccountMock.mockResolvedValue({ memberId: 12, fullName: 'Test Socia', balanceCents: 0 })
    maybeSingleMock.mockResolvedValue({ data: { phone: '+54 9 11 5555-5555' }, error: null })

    const result = await getMemberQuickView(12)

    expect(result).toEqual({
      ok: true,
      data: { memberId: 12, fullName: 'Test Socia', balanceCents: 0, phone: '+54 9 11 5555-5555' },
    })
  })

  it('fila de members ausente (maybeSingle sin data): phone null, nunca un 500 por single() estricto', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'u1', role: 'consulta', permissions: ['payments.read'] })
    getMemberAccountMock.mockResolvedValue({ memberId: 12, fullName: 'Test Socia' })
    maybeSingleMock.mockResolvedValue({ data: null, error: null })

    const result = await getMemberQuickView(12)

    expect(result).toEqual({ ok: true, data: { memberId: 12, fullName: 'Test Socia', phone: null } })
  })

  it('error de Postgres en la segunda lectura se captura y devuelve un ActionResult de error (no una excepción)', async () => {
    requirePermissionMock.mockResolvedValue({ userId: 'u1', role: 'consulta', permissions: ['payments.read'] })
    getMemberAccountMock.mockResolvedValue({ memberId: 12, fullName: 'Test Socia' })
    maybeSingleMock.mockResolvedValue({ data: null, error: new Error('boom') })

    const result = await getMemberQuickView(12)

    expect(result.ok).toBe(false)
  })
})
