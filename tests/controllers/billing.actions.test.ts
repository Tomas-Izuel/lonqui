import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `billing.actions.ts`: valores de cuota y activación/generación de cuotas
 * (`/ajustes`). Las tres exigen `requirePermission('billing.configure')`
 * (T12/D20: por permiso, no por rol — con el mapeo de hoy solo `admin` lo
 * tiene). Se mockea `session.controller` en el borde (mismo patrón que
 * `users.actions.test.ts`/`members.actions.test.ts`): un `requirePermission`
 * que rechaza SIGUE envuelto por el try/catch de la action (es una
 * `DomainError`/`PermissionError`, `failure()` la traduce a
 * `{ ok: false, error }`), no se relanza sin capturar.
 *
 * La lógica de "si el mes es el actual, generar de una" vive en
 * `billing.model.ts` (`activateBilling`), no acá: se mockea esa función
 * completa y solo se prueba que la action la llama y devuelve su resultado
 * tal cual.
 */

const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))

const requirePermissionMock = vi.fn()
vi.mock('@/controllers/session.controller', () => ({ requirePermission: requirePermissionMock }))

const createFeePriceMock = vi.fn()
vi.mock('@/models/fee-prices.model', async () => {
  const actual = await vi.importActual<typeof import('@/models/fee-prices.model')>('@/models/fee-prices.model')
  return { ...actual, createFeePrice: createFeePriceMock }
})

const activateBillingMock = vi.fn()
const generatePendingFeesMock = vi.fn()
vi.mock('@/models/billing.model', async () => {
  // `PartialBillingActivationError` real (no un mock): la action hace
  // `err instanceof PartialBillingActivationError`, así que necesita la
  // clase de verdad para que ese chequeo tenga sentido.
  const actual = await vi.importActual<typeof import('@/models/billing.model')>('@/models/billing.model')
  return {
    PartialBillingActivationError: actual.PartialBillingActivationError,
    activateBilling: activateBillingMock,
    generatePendingFees: generatePendingFeesMock,
  }
})

const { createFeePrice, activateBilling, generatePendingFees } = await import('@/controllers/billing.actions')
const { PartialBillingActivationError } = await import('@/models/billing.model')
const { DomainError, PermissionError } = await import('@/lib/errors')
const { toPeriod, addMonths } = await import('@/lib/dates')

// Una regla de "no mes pasado" hace frágil cualquier fecha fija: se deriva del reloj.
const CURRENT_PERIOD = toPeriod()
const FUTURE_PERIOD = addMonths(CURRENT_PERIOD, 3)

const ADMIN_SESSION = { userId: 'admin-1', role: 'admin' as const, permissions: ['billing.configure'] }

const VALID_FEE_PRICE_INPUT = {
  scope: 'default' as const,
  amountCents: 1_000_000,
  validFrom: CURRENT_PERIOD,
}

beforeEach(() => {
  revalidatePathMock.mockClear()
  requirePermissionMock.mockReset().mockResolvedValue(ADMIN_SESSION)
  createFeePriceMock.mockReset()
  activateBillingMock.mockReset()
  generatePendingFeesMock.mockReset()
})

describe('createFeePrice', () => {
  it('exige billing.configure antes que nada', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await createFeePrice(VALID_FEE_PRICE_INPUT)
    expect(result.ok).toBe(false)
    expect(createFeePriceMock).not.toHaveBeenCalled()
    expect(requirePermissionMock).toHaveBeenCalledWith('billing.configure')
  })

  it('un scope inválido no llega al modelo', async () => {
    const result = await createFeePrice({ scope: 'inventado', amountCents: 100, validFrom: CURRENT_PERIOD })
    expect(result.ok).toBe(false)
    expect(createFeePriceMock).not.toHaveBeenCalled()
  })

  it('caso feliz: llama al modelo, revalida el árbol entero y devuelve el valor creado', async () => {
    const created = { id: 1, scope: 'default', memberType: null, categoryId: null, amountCents: 1_000_000, validFrom: CURRENT_PERIOD, notes: null, createdAt: '2026-09-01T00:00:00Z' }
    createFeePriceMock.mockResolvedValue(created)

    const result = await createFeePrice(VALID_FEE_PRICE_INPUT)

    expect(result).toEqual({ ok: true, data: created })
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })

  it('un DomainError del modelo (trigger de mes ya generado) llega como field validFrom', async () => {
    createFeePriceMock.mockRejectedValue(
      new DomainError('Las cuotas de octubre ya se generaron con otro valor; el nuevo aplica desde noviembre', {
        field: 'validFrom',
      }),
    )
    const result = await createFeePrice(VALID_FEE_PRICE_INPUT)
    expect(result).toMatchObject({ ok: false, field: 'validFrom' })
  })
})

describe('activateBilling', () => {
  it('exige billing.configure', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await activateBilling({ startPeriod: CURRENT_PERIOD })
    expect(result.ok).toBe(false)
    expect(activateBillingMock).not.toHaveBeenCalled()
  })

  it('startPeriod que no es el primer día del mes: error de formato antes de llamar al modelo', async () => {
    const result = await activateBilling({ startPeriod: `${CURRENT_PERIOD.slice(0, 8)}15` })
    expect(result.ok).toBe(false)
    expect(activateBillingMock).not.toHaveBeenCalled()
  })

  it('mes actual: el modelo genera de una, la action pasa { generated } tal cual', async () => {
    activateBillingMock.mockResolvedValue({ generated: 42 })
    const result = await activateBilling({ startPeriod: CURRENT_PERIOD })
    expect(result).toEqual({ ok: true, data: { generated: 42 } })
    expect(activateBillingMock).toHaveBeenCalledWith(CURRENT_PERIOD)
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })

  it('mes futuro: el modelo devuelve generated 0 (el cron lo genera el día 1), la action lo respeta', async () => {
    activateBillingMock.mockResolvedValue({ generated: 0 })
    const result = await activateBilling({ startPeriod: FUTURE_PERIOD })
    expect(result).toEqual({ ok: true, data: { generated: 0 } })
  })

  it('las cuatro condiciones del trigger de activación llegan traducidas (mes pasado, ya activado, etc.)', async () => {
    activateBillingMock.mockRejectedValue(
      new DomainError('El mes de inicio no puede ser pasado', { field: 'startPeriod' }),
    )
    const result = await activateBilling({ startPeriod: CURRENT_PERIOD })
    expect(result).toMatchObject({ ok: false, error: 'El mes de inicio no puede ser pasado', field: 'startPeriod' })
  })

  it('activación parcial (el UPDATE de settings quedó hecho pero la generación posterior falló): revalida IGUAL, aunque el resultado sea ok:false', async () => {
    // La activación en sí no es reversible desde acá (dos llamadas
    // separadas a Postgres, no una transacción): `/ajustes` tiene que dejar
    // de mostrar "Activar cuotas" y pasar a "Reintentar" aunque la action
    // reporte error, o el admin creería que no pasó nada y reintentaría la
    // activación completa (que ahora fallaría por "ya está activada").
    activateBillingMock.mockRejectedValue(
      new PartialBillingActivationError(
        'La facturación quedó activada desde septiembre 2026, pero la generación de cuotas falló: motivo. Reintentá desde Ajustes.',
      ),
    )
    const result = await activateBilling({ startPeriod: CURRENT_PERIOD })
    expect(result.ok).toBe(false)
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })

  it('un DomainError que NO es PartialBillingActivationError no fuerza la revalidación extra', async () => {
    activateBillingMock.mockRejectedValue(new DomainError('El mes de inicio no puede ser pasado', { field: 'startPeriod' }))
    await activateBilling({ startPeriod: CURRENT_PERIOD })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})

describe('generatePendingFees', () => {
  it('exige billing.configure', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError())
    const result = await generatePendingFees()
    expect(result.ok).toBe(false)
    expect(generatePendingFeesMock).not.toHaveBeenCalled()
  })

  it('caso feliz: devuelve { generated } y revalida', async () => {
    generatePendingFeesMock.mockResolvedValue(7)
    const result = await generatePendingFees()
    expect(result).toEqual({ ok: true, data: { generated: 7 } })
    expect(revalidatePathMock).toHaveBeenCalledWith('/', 'layout')
  })

  it('llamada dos veces seguidas: la segunda devuelve generated 0 sin error (idempotencia, ya la prueba tests/db/, acá solo el passthrough)', async () => {
    generatePendingFeesMock.mockResolvedValueOnce(7).mockResolvedValueOnce(0)
    await generatePendingFees()
    const second = await generatePendingFees()
    expect(second).toEqual({ ok: true, data: { generated: 0 } })
  })

  it('una corrida en error (RPC devuelve status=error) llega como DomainError con el mensaje registrado, sin nombres ni DNI', async () => {
    generatePendingFeesMock.mockRejectedValue(new DomainError('No se pudo resolver un precio para Cuota social'))
    const result = await generatePendingFees()
    expect(result).toMatchObject({ ok: false, error: 'No se pudo resolver un precio para Cuota social' })
  })
})
