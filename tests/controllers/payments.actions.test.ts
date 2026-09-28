import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `payments.actions.ts`: Server Actions de pagos y cargos. Guard de permiso
 * primero (`requirePermission`, T12), Zod después, modelo después,
 * `revalidatePath('/', 'layout')` en toda escritura (T11). Se mockean los
 * modelos en el borde (`payments.model`, `fees.model`, `accounts.model`,
 * `family-groups.model`, `billing.model`, `storage.service`): nunca la
 * cadena de supabase-js (eso lo prueba `tests/models/` con mocks propios, y
 * las invariantes reales `tests/db/`).
 */

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const requirePermissionMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({ requirePermission: requirePermissionMock }))

const registerPaymentRowsMock = vi.fn()
const voidPaymentRowMock = vi.fn()
const attachReceiptRowMock = vi.fn()
const getReceiptPathMock = vi.fn()
const getMonthPaymentsPageRowsMock = vi.fn()
vi.mock('@/models/payments.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/payments.model')>('@/models/payments.model')
  return {
    ...actual,
    registerPayment: registerPaymentRowsMock,
    voidPayment: voidPaymentRowMock,
    attachReceipt: attachReceiptRowMock,
    getReceiptPath: getReceiptPathMock,
    getMonthPaymentsPage: getMonthPaymentsPageRowsMock,
  }
})

const insertOpeningBalanceMock = vi.fn()
const voidFeeRowMock = vi.fn()
vi.mock('@/models/fees.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/fees.model')>('@/models/fees.model')
  return { ...actual, createOpeningBalance: insertOpeningBalanceMock, voidFee: voidFeeRowMock }
})

const getMemberAccountsMock = vi.fn()
vi.mock('@/models/accounts.model', () => ({ getMemberAccounts: getMemberAccountsMock }))

const getFamilyGroupMock = vi.fn()
vi.mock('@/models/family-groups.model', () => ({ getFamilyGroup: getFamilyGroupMock }))

const getBillingStatusMock = vi.fn()
vi.mock('@/models/billing.model', () => ({ getBillingStatus: getBillingStatusMock }))

const createSignedUploadUrlMock = vi.fn()
const getSignedUrlMock = vi.fn()
const objectExistsMock = vi.fn()
vi.mock('@/services/storage.service', () => ({
  createSignedUploadUrl: createSignedUploadUrlMock,
  getSignedUrl: getSignedUrlMock,
  objectExists: objectExistsMock,
}))

const {
  registerPayment,
  voidPayment,
  prepareReceiptUpload,
  attachReceipt,
  getReceiptUrlAction,
  createOpeningBalance,
  voidFee,
  getPaymentFormData,
  loadMoreMonthPayments,
} = await import('@/controllers/payments.actions')
const { DomainError, PermissionError } = await import('@/lib/errors')

const REGISTER_SESSION = { userId: 'editor-1', role: 'editor' as const, permissions: ['payments.register'] }

const VALID_PAYMENT_INPUT = {
  batchId: '11111111-1111-4111-8111-111111111111',
  paidOn: '2020-06-15',
  method: 'cash' as const,
  items: [{ memberId: 1, amountCents: 1_000_000 }],
}

beforeEach(() => {
  revalidatePathMock.mockClear()
  requirePermissionMock.mockReset().mockResolvedValue(REGISTER_SESSION)
  registerPaymentRowsMock.mockReset()
  voidPaymentRowMock.mockReset()
  attachReceiptRowMock.mockReset()
  getReceiptPathMock.mockReset()
  getMonthPaymentsPageRowsMock.mockReset()
  insertOpeningBalanceMock.mockReset()
  voidFeeRowMock.mockReset()
  getMemberAccountsMock.mockReset()
  getFamilyGroupMock.mockReset()
  getBillingStatusMock.mockReset()
  createSignedUploadUrlMock.mockReset()
  getSignedUrlMock.mockReset()
  objectExistsMock.mockReset().mockResolvedValue(true)
})

describe('registerPayment', () => {
  it('exige payments.register', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await registerPayment(VALID_PAYMENT_INPUT)
    expect(result.ok).toBe(false)
    expect(registerPaymentRowsMock).not.toHaveBeenCalled()
    expect(requirePermissionMock).toHaveBeenCalledWith('payments.register')
  })

  it('batchId que no es uuid: error de formato antes de llegar al modelo', async () => {
    const result = await registerPayment({ ...VALID_PAYMENT_INPUT, batchId: 'no-es-uuid' })
    expect(result.ok).toBe(false)
    expect(registerPaymentRowsMock).not.toHaveBeenCalled()
  })

  it('paidOn futura (zona club): field paidOn', async () => {
    const result = await registerPayment({ ...VALID_PAYMENT_INPUT, paidOn: '2099-01-01' })
    expect(result).toMatchObject({ ok: false, field: 'paidOn' })
  })

  it('items vacío: rechaza antes del modelo', async () => {
    const result = await registerPayment({ ...VALID_PAYMENT_INPUT, items: [] })
    expect(result.ok).toBe(false)
    expect(registerPaymentRowsMock).not.toHaveBeenCalled()
  })

  it('un item con amountCents <= 0: field amountCents', async () => {
    const result = await registerPayment({ ...VALID_PAYMENT_INPUT, items: [{ memberId: 1, amountCents: 0 }] })
    expect(result).toMatchObject({ ok: false, field: 'amountCents' })
  })

  it('un item con amountCents no entero: field amountCents', async () => {
    const result = await registerPayment({ ...VALID_PAYMENT_INPUT, items: [{ memberId: 1, amountCents: 100.5 }] })
    expect(result).toMatchObject({ ok: false, field: 'amountCents' })
  })

  it('receiptPath con prefijo inválido: rechaza sin llegar a objectExists', async () => {
    const result = await registerPayment({ ...VALID_PAYMENT_INPUT, receiptPath: 'otra-carpeta/1/x.jpg' })
    expect(result.ok).toBe(false)
    expect(objectExistsMock).not.toHaveBeenCalled()
  })

  it('familyGroupId presente con un memberId que NO pertenece al grupo: DomainError, no llega al modelo', async () => {
    getFamilyGroupMock.mockResolvedValue({
      id: 9,
      members: [{ id: 1, fullName: 'Uno', status: 'active', isPaymentResponsible: true }],
    })
    const result = await registerPayment({
      ...VALID_PAYMENT_INPUT,
      familyGroupId: 9,
      items: [{ memberId: 999, amountCents: 1_000_000 }],
    })
    expect(result.ok).toBe(false)
    expect(registerPaymentRowsMock).not.toHaveBeenCalled()
  })

  it('familyGroupId inexistente: DomainError con field familyGroupId', async () => {
    getFamilyGroupMock.mockResolvedValue(null)
    const result = await registerPayment({ ...VALID_PAYMENT_INPUT, familyGroupId: 9 })
    expect(result).toMatchObject({ ok: false, field: 'familyGroupId' })
  })

  it('receiptPath con prefijo válido pero el objeto no existe en Storage: DomainError, no llega al insert', async () => {
    objectExistsMock.mockResolvedValue(false)
    const result = await registerPayment({ ...VALID_PAYMENT_INPUT, receiptPath: 'payment-receipts/1/x.jpg' })
    expect(result.ok).toBe(false)
    expect(registerPaymentRowsMock).not.toHaveBeenCalled()
  })

  it('caso feliz: inserta y revalida', async () => {
    registerPaymentRowsMock.mockResolvedValue({ paymentIds: [1], totalCents: 1_000_000, alreadyRegistered: false })
    const result = await registerPayment(VALID_PAYMENT_INPUT)
    expect(result).toEqual({ ok: true, data: { paymentIds: [1], totalCents: 1_000_000, alreadyRegistered: false } })
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })

  it('reintento con el mismo batchId (doble toque): el modelo devuelve alreadyRegistered=true, la action lo pasa como ÉXITO, no error', async () => {
    registerPaymentRowsMock.mockResolvedValue({ paymentIds: [1], totalCents: 1_000_000, alreadyRegistered: true })
    const result = await registerPayment(VALID_PAYMENT_INPUT)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.alreadyRegistered).toBe(true)
  })
})

describe('voidPayment', () => {
  it('exige payments.void (no payments.register)', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await voidPayment({ paymentId: 1, reason: 'Error de carga' })
    expect(result.ok).toBe(false)
    expect(requirePermissionMock).toHaveBeenCalledWith('payments.void')
    expect(voidPaymentRowMock).not.toHaveBeenCalled()
  })

  it('reason de menos de 3 caracteres: rechaza antes del modelo', async () => {
    const result = await voidPayment({ paymentId: 1, reason: 'x' })
    expect(result.ok).toBe(false)
    expect(voidPaymentRowMock).not.toHaveBeenCalled()
  })

  it('caso feliz: anula y revalida', async () => {
    voidPaymentRowMock.mockResolvedValue(undefined)
    const result = await voidPayment({ paymentId: 1, reason: 'Cargado por error' })
    expect(result.ok).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })

  it('un pago ya anulado: el DomainError del modelo llega tal cual', async () => {
    voidPaymentRowMock.mockRejectedValue(new DomainError('El pago ya está anulado'))
    const result = await voidPayment({ paymentId: 1, reason: 'De nuevo' })
    expect(result).toMatchObject({ ok: false, error: 'El pago ya está anulado' })
  })
})

describe('prepareReceiptUpload', () => {
  it('exige payments.register', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await prepareReceiptUpload({ memberId: 1, mimeType: 'image/jpeg', sizeBytes: 1000 })
    expect(result.ok).toBe(false)
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled()
  })

  it('un MIME fuera de la lista permitida: rechaza', async () => {
    const result = await prepareReceiptUpload({ memberId: 1, mimeType: 'application/zip', sizeBytes: 1000 })
    expect(result.ok).toBe(false)
    expect(createSignedUploadUrlMock).not.toHaveBeenCalled()
  })

  it('un archivo de más de 10 MiB: rechaza', async () => {
    const result = await prepareReceiptUpload({ memberId: 1, mimeType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024 })
    expect(result.ok).toBe(false)
  })

  it('caso feliz: arma la ruta en el servidor (nunca la manda el cliente) y firma la subida', async () => {
    createSignedUploadUrlMock.mockResolvedValue({ path: 'payment-receipts/1/abc.jpg', token: 't', signedUrl: 'https://x' })
    const result = await prepareReceiptUpload({ memberId: 1, mimeType: 'image/jpeg', sizeBytes: 1000 })
    expect(result.ok).toBe(true)
    expect(createSignedUploadUrlMock).toHaveBeenCalledWith(expect.stringMatching(/^payment-receipts\/1\//))
  })
})

describe('attachReceipt', () => {
  it('exige payments.register', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await attachReceipt({ paymentId: 1, path: 'payment-receipts/1/x.jpg' })
    expect(result.ok).toBe(false)
    expect(attachReceiptRowMock).not.toHaveBeenCalled()
  })

  it('el objeto no existe en Storage: rechaza sin llamar al modelo', async () => {
    objectExistsMock.mockResolvedValue(false)
    const result = await attachReceipt({ paymentId: 1, path: 'payment-receipts/1/x.jpg' })
    expect(result.ok).toBe(false)
    expect(attachReceiptRowMock).not.toHaveBeenCalled()
  })

  it('a un pago anulado: el mensaje del trigger llega traducido', async () => {
    attachReceiptRowMock.mockRejectedValue(new DomainError('Un pago anulado no lleva comprobante'))
    const result = await attachReceipt({ paymentId: 1, path: 'payment-receipts/1/x.jpg' })
    expect(result).toMatchObject({ ok: false, error: 'Un pago anulado no lleva comprobante' })
  })

  it('caso feliz: adjunta y revalida', async () => {
    attachReceiptRowMock.mockResolvedValue(undefined)
    const result = await attachReceipt({ paymentId: 1, path: 'payment-receipts/1/x.jpg' })
    expect(result.ok).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })
})

describe('getReceiptUrlAction', () => {
  it('cualquier rol con payments.read alcanza (no payments.register)', async () => {
    getReceiptPathMock.mockResolvedValue('payment-receipts/1/x.jpg')
    getSignedUrlMock.mockResolvedValue('https://signed.example/x.jpg')
    await getReceiptUrlAction({ paymentId: 1 })
    expect(requirePermissionMock).toHaveBeenCalledWith('payments.read')
  })

  it('pago sin comprobante: null, sin firmar nada', async () => {
    getReceiptPathMock.mockResolvedValue(null)
    const result = await getReceiptUrlAction({ paymentId: 1 })
    expect(result).toEqual({ ok: true, data: { url: null } })
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it('con comprobante: firma con TTL de 60s', async () => {
    getReceiptPathMock.mockResolvedValue('payment-receipts/1/x.jpg')
    getSignedUrlMock.mockResolvedValue('https://signed.example/x.jpg')
    await getReceiptUrlAction({ paymentId: 1 })
    expect(getSignedUrlMock).toHaveBeenCalledWith('payment-receipts/1/x.jpg', 60)
  })
})

describe('createOpeningBalance', () => {
  it('exige payments.register', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await createOpeningBalance({ memberId: 1, amountCents: 2_000_000 })
    expect(result.ok).toBe(false)
    expect(insertOpeningBalanceMock).not.toHaveBeenCalled()
  })

  it('amountCents <= 0: rechaza', async () => {
    const result = await createOpeningBalance({ memberId: 1, amountCents: 0 })
    expect(result.ok).toBe(false)
  })

  it('facturación inactiva: el mensaje del trigger llega traducido', async () => {
    insertOpeningBalanceMock.mockRejectedValue(new DomainError('Primero activá las cuotas en Ajustes'))
    const result = await createOpeningBalance({ memberId: 1, amountCents: 2_000_000 })
    expect(result).toMatchObject({ ok: false, error: 'Primero activá las cuotas en Ajustes' })
  })

  it('ya tiene un saldo de arranque vigente: DomainError', async () => {
    insertOpeningBalanceMock.mockRejectedValue(new DomainError('Este socio ya tiene un saldo anterior cargado'))
    const result = await createOpeningBalance({ memberId: 1, amountCents: 2_000_000 })
    expect(result.ok).toBe(false)
  })

  it('caso feliz: crea y revalida', async () => {
    insertOpeningBalanceMock.mockResolvedValue({ id: 5 })
    const result = await createOpeningBalance({ memberId: 1, amountCents: 2_000_000 })
    expect(result).toEqual({ ok: true, data: { id: 5 } })
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })
})

describe('voidFee', () => {
  it('exige payments.void', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await voidFee({ feeId: 1, reason: 'Cargado por error' })
    expect(result.ok).toBe(false)
    expect(requirePermissionMock).toHaveBeenCalledWith('payments.void')
    expect(voidFeeRowMock).not.toHaveBeenCalled()
  })

  it('un editor que llegara hasta acá (0 filas de UPDATE, policy estricta de fees): el mensaje defensivo del modelo llega tal cual', async () => {
    voidFeeRowMock.mockRejectedValue(new DomainError('No se pudo anular el cargo: no existe o no tenés permiso'))
    const result = await voidFee({ feeId: 1, reason: 'Cargado por error' })
    expect(result).toMatchObject({ ok: false, error: 'No se pudo anular el cargo: no existe o no tenés permiso' })
  })

  it('caso feliz: anula y revalida', async () => {
    voidFeeRowMock.mockResolvedValue(undefined)
    const result = await voidFee({ feeId: 1, reason: 'Cargado por error' })
    expect(result.ok).toBe(true)
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })
})

describe('getPaymentFormData', () => {
  it('exige payments.register (no solo payments.read: es la pantalla para cargar un pago)', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await getPaymentFormData({ memberId: 1 })
    expect(result.ok).toBe(false)
    expect(getMemberAccountsMock).not.toHaveBeenCalled()
  })

  it('sin memberId ni familyGroupId: rechaza (Zod: "Elegí un socio o un grupo familiar")', async () => {
    const result = await getPaymentFormData({})
    expect(result.ok).toBe(false)
  })

  it('memberId de un socio inexistente: DomainError, no una lista vacía silenciosa', async () => {
    getBillingStatusMock.mockResolvedValue({ active: true })
    getMemberAccountsMock.mockResolvedValue([])
    const result = await getPaymentFormData({ memberId: 999 })
    expect(result).toMatchObject({ ok: false, field: 'memberId' })
  })

  it('con memberId solo: trae la cuenta de ese único socio', async () => {
    getBillingStatusMock.mockResolvedValue({ active: true })
    getMemberAccountsMock.mockResolvedValue([{ memberId: 1, fullName: 'Uno, Test' }])
    const result = await getPaymentFormData({ memberId: 1 })
    expect(getMemberAccountsMock).toHaveBeenCalledWith([1])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.familyGroup).toBeNull()
  })

  it('con familyGroupId: trae a TODOS los integrantes en una sola RPC (getMemberAccounts con el array completo, nunca N llamadas)', async () => {
    getBillingStatusMock.mockResolvedValue({ active: true })
    getFamilyGroupMock.mockResolvedValue({
      id: 9,
      members: [
        { id: 1, fullName: 'Uno', status: 'active', isPaymentResponsible: true },
        { id: 2, fullName: 'Dos', status: 'inactive', isPaymentResponsible: false },
      ],
    })
    getMemberAccountsMock.mockResolvedValue([
      { memberId: 1, fullName: 'Uno' },
      { memberId: 2, fullName: 'Dos' },
    ])

    const result = await getPaymentFormData({ familyGroupId: 9 })

    expect(getMemberAccountsMock).toHaveBeenCalledWith([1, 2])
    expect(getMemberAccountsMock).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.members).toHaveLength(2)
  })

  it('con familyGroupId Y memberId: el socio desde el que se abrió el formulario va PRIMERO, sin perder al resto (3+ integrantes)', async () => {
    getBillingStatusMock.mockResolvedValue({ active: true })
    getFamilyGroupMock.mockResolvedValue({
      id: 9,
      members: [
        { id: 1, fullName: 'Uno', status: 'active', isPaymentResponsible: true },
        { id: 2, fullName: 'Dos', status: 'active', isPaymentResponsible: false },
        { id: 3, fullName: 'Tres', status: 'inactive', isPaymentResponsible: false },
      ],
    })
    // La RPC devuelve en CUALQUIER orden (acá, a propósito, con el socio
    // "fuente" en el medio): la action lo reordena, no la RPC.
    getMemberAccountsMock.mockResolvedValue([
      { memberId: 1, fullName: 'Uno' },
      { memberId: 3, fullName: 'Tres' },
      { memberId: 2, fullName: 'Dos' },
    ])

    const result = await getPaymentFormData({ familyGroupId: 9, memberId: 2 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.members.map((m) => m.memberId)).toEqual([2, 1, 3])
    }
  })

  it('familyGroupId inexistente: DomainError', async () => {
    getBillingStatusMock.mockResolvedValue({ active: true })
    getFamilyGroupMock.mockResolvedValue(null)
    const result = await getPaymentFormData({ familyGroupId: 9 })
    expect(result).toMatchObject({ ok: false, field: 'familyGroupId' })
  })
})

describe('loadMoreMonthPayments', () => {
  it('exige payments.read', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await loadMoreMonthPayments({ period: '2026-09-01', cursor: 'abc' })
    expect(result.ok).toBe(false)
    expect(getMonthPaymentsPageRowsMock).not.toHaveBeenCalled()
  })

  it('un cursor vacío: rechaza antes del modelo', async () => {
    const result = await loadMoreMonthPayments({ period: '2026-09-01', cursor: '' })
    expect(result.ok).toBe(false)
    expect(getMonthPaymentsPageRowsMock).not.toHaveBeenCalled()
  })

  it('caso feliz: pasa período y cursor tal cual', async () => {
    getMonthPaymentsPageRowsMock.mockResolvedValue({ items: [], nextCursor: null })
    await loadMoreMonthPayments({ period: '2026-09-01', cursor: 'abc123' })
    expect(getMonthPaymentsPageRowsMock).toHaveBeenCalledWith('2026-09-01', 'abc123')
  })
})
