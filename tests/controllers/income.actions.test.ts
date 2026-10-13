import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS_BY_ROLE, signedOut, signInAs, type TestRole } from '../stubs/sessions'

/**
 * `income.actions.ts`: Server Actions de otros ingresos. El guard de permisos
 * es el REAL de `session.controller` (se mockean solo sus bordes: el usuario
 * de Auth, la fila de `app_users` y los permisos), así que probamos que cada
 * ROL llegue o no llegue al modelo. Orden fijo: permiso, Zod, modelo.
 */

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))
const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const getCurrentUserMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: getCurrentUserMock }))
const getOwnAppUserMock = vi.fn()
const getOwnPermissionsMock = vi.fn()
vi.mock('@/models/session.model', () => ({ getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }))
const session = { getCurrentUser: getCurrentUserMock, getOwnAppUser: getOwnAppUserMock, getOwnPermissions: getOwnPermissionsMock }

const insertMock = vi.fn()
const voidRowMock = vi.fn()
const getReceiptPathMock = vi.fn()
vi.mock('@/models/cash-movements.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/cash-movements.model')>('@/models/cash-movements.model')
  return { ...actual, registerCashMovement: insertMock, voidCashMovement: voidRowMock, getCashReceiptPath: getReceiptPathMock }
})

const listCashConceptsMock = vi.fn()
vi.mock('@/models/cash-concepts.model', () => ({ listCashConcepts: listCashConceptsMock }))
const listSponsorOptionsMock = vi.fn()
vi.mock('@/models/sponsors.model', () => ({ listSponsorOptions: listSponsorOptionsMock }))

const createSignedUploadUrlMock = vi.fn()
const getSignedUrlMock = vi.fn()
const objectExistsMock = vi.fn()
vi.mock('@/services/storage.service', () => ({
  createSignedUploadUrl: createSignedUploadUrlMock,
  getSignedUrl: getSignedUrlMock,
  objectExists: objectExistsMock,
}))

const { registerCashMovement, voidCashMovement, prepareCashReceiptUpload, getCashReceiptUrlAction, getIncomeFormData } = await import(
  '@/controllers/income.actions'
)
const { DomainError } = await import('@/lib/errors')

const BATCH = '11111111-1111-4111-8111-111111111111'
const VALID = { batchId: BATCH, conceptId: 3, amountCents: 1_500_000, occurredOn: '2026-01-15', method: 'cash' as const }

beforeEach(() => {
  for (const m of [revalidatePathMock, insertMock, voidRowMock, getReceiptPathMock, listCashConceptsMock, listSponsorOptionsMock, createSignedUploadUrlMock, getSignedUrlMock, objectExistsMock]) {
    m.mockReset()
  }
  objectExistsMock.mockResolvedValue(true)
  signInAs(session, 'editor')
  // Los errores internos se loguean en el servidor: silenciados, pero sin tocarse el módulo log.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const DENIED = { ok: false, error: 'No tenés permiso para hacer esto' }

describe('catálogo de permisos usado por estos tests (sanidad)', () => {
  it('solo admin anula y desactiva; editor registra; consulta solo lee', () => {
    expect(PERMISSIONS_BY_ROLE.consulta).not.toContain('income.register')
    expect(PERMISSIONS_BY_ROLE.editor).toContain('income.register')
    expect(PERMISSIONS_BY_ROLE.editor).not.toContain('income.void')
    expect(PERMISSIONS_BY_ROLE.admin).toContain('income.void')
  })
})

describe('registerCashMovement', () => {
  it.each([
    ['consulta', false],
    ['editor', true],
    ['admin', true],
  ] as Array<[TestRole, boolean]>)('rol %s: llega al modelo = %s', async (role, allowed) => {
    signInAs(session, role)
    insertMock.mockResolvedValue({ movementId: 1, amountCents: 1_500_000, alreadyRegistered: false })
    const result = await registerCashMovement(VALID)
    if (allowed) {
      expect(result).toEqual({ ok: true, data: { movementId: 1, amountCents: 1_500_000, alreadyRegistered: false } })
      expect(insertMock).toHaveBeenCalledTimes(1)
    } else {
      expect(result).toEqual(DENIED)
      expect(insertMock).not.toHaveBeenCalled()
      expect(revalidatePathMock).not.toHaveBeenCalled()
    }
  })

  it('sin sesión, con contraseña temporal pendiente, o usuario desactivado: denegado y el modelo no se toca', async () => {
    signedOut(session)
    expect(await registerCashMovement(VALID)).toMatchObject({ ok: false, error: 'Tu sesión venció. Volvé a ingresar.' })
    signInAs(session, 'editor', { mustChangePassword: true })
    expect(await registerCashMovement(VALID)).toMatchObject({ ok: false, error: 'Tenés que cambiar tu contraseña antes de seguir.' })
    signInAs(session, 'editor', { isActive: false })
    expect(await registerCashMovement(VALID)).toMatchObject({ ok: false, error: 'Tu usuario no tiene acceso al sistema.' })
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('un rol puesto "admin" solo en los permisos que no tiene no alcanza: lo que vale es el permiso income.register', async () => {
    signInAs(session, 'admin', { permissions: PERMISSIONS_BY_ROLE.admin.filter((p) => p !== 'income.register') })
    expect(await registerCashMovement(VALID)).toEqual(DENIED)
  })

  it('revalida /caja entera (layout) en el éxito; no en el fallo', async () => {
    insertMock.mockResolvedValue({ movementId: 1, amountCents: 1, alreadyRegistered: false })
    await registerCashMovement(VALID)
    expect(revalidatePathMock).toHaveBeenCalledWith('/caja', 'layout')

    revalidatePathMock.mockClear()
    insertMock.mockRejectedValue(new Error('boom'))
    await registerCashMovement(VALID)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it.each([
    ['monto 0', { amountCents: 0 }, 'amountCents'],
    ['sin concepto', { conceptId: 0 }, 'conceptId'],
    ['fecha con formato inválido', { occurredOn: '15/01/2026' }, 'occurredOn'],
    ['medio inválido', { method: 'cheque' }, 'method'],
    ['comprobante de otro prefijo', { receiptPath: 'payment-receipts/1/a.pdf' }, 'receiptPath'],
  ])('%s: ok=false con field %s, antes de llegar al modelo ni a Storage', async (_n, patch, field) => {
    const result = await registerCashMovement({ ...VALID, ...patch })
    expect(result).toMatchObject({ ok: false, field })
    expect(insertMock).not.toHaveBeenCalled()
    expect(objectExistsMock).not.toHaveBeenCalled()
  })

  it('fecha futura (zona del club): field occurredOn', async () => {
    const farFuture = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    expect(await registerCashMovement({ ...VALID, occurredOn: farFuture })).toMatchObject({ ok: false, field: 'occurredOn' })
  })

  it('claves de más: formato inválido genérico, sin nombrar la clave (no ayuda a sondear)', async () => {
    const result = await registerCashMovement({ ...VALID, createdBy: 'otro-usuario' })
    expect(result).toEqual({ ok: false, error: 'Los datos llegaron con un formato inválido' })
    expect(JSON.stringify(result)).not.toContain('createdBy')
  })

  it('un input que no es objeto (null, string): error de validación, no excepción', async () => {
    expect(await registerCashMovement(null)).toMatchObject({ ok: false })
    expect(await registerCashMovement('hola')).toMatchObject({ ok: false })
  })

  it('el comprobante tiene que existir de verdad en Storage: si no, field receiptPath y no se registra', async () => {
    objectExistsMock.mockResolvedValue(false)
    const result = await registerCashMovement({ ...VALID, method: 'transfer', receiptPath: `cash-receipts/${BATCH}/a.pdf` })
    expect(result).toEqual({ ok: false, error: 'No encontramos el comprobante subido. Probá de nuevo.', field: 'receiptPath' })
    expect(objectExistsMock).toHaveBeenCalledWith(`cash-receipts/${BATCH}/a.pdf`)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('sin comprobante no se consulta Storage', async () => {
    insertMock.mockResolvedValue({ movementId: 1, amountCents: 1, alreadyRegistered: false })
    await registerCashMovement(VALID)
    expect(objectExistsMock).not.toHaveBeenCalled()
  })

  it('idempotencia: alreadyRegistered=true llega como ÉXITO (la vista lo trata como "ya estaba registrado")', async () => {
    insertMock.mockResolvedValue({ movementId: 9, amountCents: 1_500_000, alreadyRegistered: true })
    const result = await registerCashMovement(VALID)
    expect(result).toEqual({ ok: true, data: { movementId: 9, amountCents: 1_500_000, alreadyRegistered: true } })
  })

  it('el batchId se pasa tal cual al modelo (el servidor nunca lo regenera)', async () => {
    insertMock.mockResolvedValue({ movementId: 1, amountCents: 1, alreadyRegistered: false })
    await registerCashMovement(VALID)
    expect(insertMock.mock.calls[0][0]).toMatchObject({ batchId: BATCH })
  })

  it('DomainError del modelo (guard de concepto/sponsor): conserva mensaje y field; un error interno se vuelve genérico y no filtra el detalle', async () => {
    insertMock.mockRejectedValue(new DomainError('El concepto está desactivado', { field: 'conceptId' }))
    expect(await registerCashMovement(VALID)).toEqual({ ok: false, error: 'El concepto está desactivado', field: 'conceptId' })

    insertMock.mockRejectedValue(Object.assign(new Error('violates check constraint "cash_movements_amount_cents_check"'), { code: '23514' }))
    const generic = await registerCashMovement(VALID)
    expect(generic).toEqual({ ok: false, error: 'No pudimos completar la operación. Probá de nuevo en un momento.' })
  })
})

describe('voidCashMovement', () => {
  it.each([
    ['consulta', false],
    ['editor', false],
    ['admin', true],
  ] as Array<[TestRole, boolean]>)('rol %s: anula = %s (solo income.void)', async (role, allowed) => {
    signInAs(session, role)
    voidRowMock.mockResolvedValue(undefined)
    const result = await voidCashMovement({ movementId: 4, reason: 'Cargado dos veces' })
    expect(result.ok).toBe(allowed)
    expect(voidRowMock).toHaveBeenCalledTimes(allowed ? 1 : 0)
    if (allowed) {
      expect(voidRowMock).toHaveBeenCalledWith(4, 'Cargado dos veces')
      expect(revalidatePathMock).toHaveBeenCalledWith('/caja', 'layout')
    } else {
      expect(result).toEqual(DENIED)
    }
  })

  it('motivo corto: field reason, sin llamar al modelo; el motivo se recorta antes de llegar', async () => {
    signInAs(session, 'admin')
    expect(await voidCashMovement({ movementId: 4, reason: 'ab' })).toMatchObject({ ok: false, field: 'reason' })
    expect(voidRowMock).not.toHaveBeenCalled()
    voidRowMock.mockResolvedValue(undefined)
    await voidCashMovement({ movementId: 4, reason: '  Cargado dos veces  ' })
    expect(voidRowMock).toHaveBeenCalledWith(4, 'Cargado dos veces')
  })

  it('id inválido: error de validación; ingreso inexistente o ya anulado: mensaje del modelo', async () => {
    signInAs(session, 'admin')
    expect((await voidCashMovement({ movementId: 0, reason: 'motivo' })).ok).toBe(false)
    voidRowMock.mockRejectedValue(new DomainError('El ingreso no existe', { status: 404 }))
    expect(await voidCashMovement({ movementId: 99, reason: 'motivo' })).toEqual({ ok: false, error: 'El ingreso no existe' })
    voidRowMock.mockRejectedValue(new DomainError('Este ingreso ya está anulado'))
    expect(await voidCashMovement({ movementId: 1, reason: 'motivo' })).toEqual({ ok: false, error: 'Este ingreso ya está anulado' })
  })
})

describe('prepareCashReceiptUpload', () => {
  const upload = { batchId: BATCH, mimeType: 'application/pdf', sizeBytes: 2048 }

  it('consulta no sube; editor sí', async () => {
    signInAs(session, 'consulta')
    expect(await prepareCashReceiptUpload(upload)).toEqual(DENIED)
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled()

    signInAs(session, 'editor')
    createSignedUploadUrlMock.mockImplementation(async (path: string) => ({ path, token: 'tok', signedUrl: 'https://x.test/upload' }))
    const result = await prepareCashReceiptUpload(upload)
    expect(result.ok).toBe(true)
  })

  it('la ruta la arma el servidor: cash-receipts/<batchId>/<uuid>.<ext>, y es la que se firma', async () => {
    createSignedUploadUrlMock.mockImplementation(async (path: string) => ({ path, token: 'tok', signedUrl: 'https://x.test/upload' }))
    const result = await prepareCashReceiptUpload({ ...upload, mimeType: 'image/png' })
    if (!result.ok) throw new Error('debería ser ok')
    expect(result.data.path).toMatch(new RegExp(`^cash-receipts/${BATCH}/[0-9a-f-]{36}\\.png$`))
    expect(createSignedUploadUrlMock).toHaveBeenCalledWith(result.data.path)
  })

  it('el browser no puede elegir la ruta (clave path de más): rechazado', async () => {
    const result = await prepareCashReceiptUpload({ ...upload, path: 'cash-receipts/../medical-clearances/1/x.pdf' })
    expect(result.ok).toBe(false)
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled()
  })

  it.each([
    ['más de 10 MB', { sizeBytes: 10 * 1024 * 1024 + 1 }, 'sizeBytes'],
    ['archivo vacío', { sizeBytes: 0 }, 'sizeBytes'],
    ['MIME no permitido', { mimeType: 'application/zip' }, 'mimeType'],
    ['batchId inválido', { batchId: 'no-uuid' }, 'batchId'],
  ])('%s: rechaza con field %s', async (_n, patch, field) => {
    expect(await prepareCashReceiptUpload({ ...upload, ...patch })).toMatchObject({ ok: false, field })
  })
})

describe('getCashReceiptUrlAction', () => {
  it('income.read alcanza (consulta puede ver comprobantes); firma por 60 s; la URL no se guarda en ningún lado', async () => {
    signInAs(session, 'consulta')
    getReceiptPathMock.mockResolvedValue('cash-receipts/a/b.pdf')
    getSignedUrlMock.mockResolvedValue('https://x.test/signed?token=abc')
    const result = await getCashReceiptUrlAction({ movementId: 3 })
    expect(result).toEqual({ ok: true, data: { url: 'https://x.test/signed?token=abc' } })
    expect(getSignedUrlMock).toHaveBeenCalledWith('cash-receipts/a/b.pdf', 60)
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('sin comprobante (o ingreso que no existe/no se ve): url null y no se firma nada', async () => {
    getReceiptPathMock.mockResolvedValue(null)
    expect(await getCashReceiptUrlAction({ movementId: 3 })).toEqual({ ok: true, data: { url: null } })
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it('sin sesión: denegado, no se consulta la ruta', async () => {
    signedOut(session)
    expect((await getCashReceiptUrlAction({ movementId: 3 })).ok).toBe(false)
    expect(getReceiptPathMock).not.toHaveBeenCalled()
  })

  it('id inválido: error de validación', async () => {
    expect((await getCashReceiptUrlAction({ movementId: -1 })).ok).toBe(false)
  })
})

describe('getIncomeFormData', () => {
  it('consulta no (no puede registrar); editor recibe solo conceptos y sponsors ACTIVOS', async () => {
    signInAs(session, 'consulta')
    expect(await getIncomeFormData()).toEqual(DENIED)
    expect(listCashConceptsMock).not.toHaveBeenCalled()

    signInAs(session, 'editor')
    listCashConceptsMock.mockResolvedValue([{ id: 1 }])
    listSponsorOptionsMock.mockResolvedValue([{ id: 2 }])
    const result = await getIncomeFormData()
    expect(result).toEqual({ ok: true, data: { concepts: [{ id: 1 }], sponsors: [{ id: 2 }] } })
    // Sin includeInactive: el formulario no ofrece lo desactivado.
    expect(listCashConceptsMock).toHaveBeenCalledWith()
    expect(listSponsorOptionsMock).toHaveBeenCalledWith()
  })
})
