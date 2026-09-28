import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `billing.model.ts`: `getBillingStatus` (las 4 condiciones de `currentPeriodRun`,
 * §6.4 de `00-architecture.md`), `activateBilling`/`generatePendingFees`
 * (traducción de `settings_billing_guard` y de una corrida `error`/`skipped`
 * devuelta —no relanzada— por la RPC), y `listBillingRuns` (resolución de
 * `actorName` contra `app_users`, null para el cron). Cliente de Supabase
 * mockeado en el borde externo.
 */

type Row = Record<string, unknown>
type Result<T> = { data: T | null; error: { code?: string; message: string } | null }

/**
 * Builder encadenable mínimo. `resolve` recibe si la cadena pasó por
 * `.maybeSingle()` — la señal real (no un orden de llamadas asumido) para
 * distinguir "una fila puntual" ("la corrida del período actual") de "una
 * lista" (`listBillingRuns`, que nunca llama `.maybeSingle()`).
 */
function chainable(resolve: (sawMaybeSingle: boolean) => Result<unknown>) {
  let sawMaybeSingle = false
  const self: Record<string, unknown> = {
    select: () => self,
    order: () => self,
    eq: () => self,
    limit: () => self,
    maybeSingle: () => {
      sawMaybeSingle = true
      return self
    },
    single: () => self,
    overrideTypes: () => Promise.resolve(resolve(sawMaybeSingle)),
  }
  return self
}

/**
 * Fake completo para `getBillingStatus()`/`listBillingRuns()`. `billing_runs`
 * se consulta DOS formas distintas (la corrida del período actual, con
 * `.maybeSingle()`, y las últimas N para `listBillingRuns`): como cada
 * `from('billing_runs')` arma un builder nuevo, alcanza con que la config
 * distinga por si el resultado esperado es una fila sola o una lista — acá se
 * resuelve dándole a cada tabla su propia función de resolución fija.
 */
function makeBillingClient(config: {
  feesRow?: { period: string } | null
  feesError?: { code?: string; message: string } | null
  summaryRow?: { active_members: number; pending_periods: string[] } | null
  summaryError?: { code?: string; message: string } | null
  permissions?: string[]
  permissionsError?: { code?: string; message: string } | null
  currentRunRow?: Row | null
  currentRunError?: { code?: string; message: string } | null
  recentRuns?: Row[]
  recentRunsError?: { code?: string; message: string } | null
  appUsers?: Row[]
  updateSettingsError?: { code?: string; message: string } | null
  generateRpcResult?: { data: Row[] | null; error: { code?: string; message: string } | null }
}) {
  return {
    from: (table: string) => {
      if (table === 'fees') {
        return chainable(() => ({ data: config.feesRow ?? null, error: config.feesError ?? null }))
      }
      if (table === 'app_users') {
        return { select: () => ({ in: async () => ({ data: config.appUsers ?? [], error: null }) }) }
      }
      if (table === 'billing_runs') {
        return chainable((sawMaybeSingle) =>
          sawMaybeSingle
            ? { data: config.currentRunRow ?? null, error: config.currentRunError ?? null }
            : { data: config.recentRuns ?? [], error: config.recentRunsError ?? null },
        )
      }
      if (table === 'settings') {
        return {
          update: () => ({
            eq: async () => ({ error: config.updateSettingsError ?? null }),
          }),
        }
      }
      throw new Error(`tabla inesperada en el fake client: ${table}`)
    },
    rpc: (name: string) => {
      if (name === 'dashboard_summary') {
        return { single: () => ({ overrideTypes: () => Promise.resolve({ data: config.summaryRow ?? null, error: config.summaryError ?? null }) }) }
      }
      if (name === 'my_permissions') {
        return Promise.resolve({ data: config.permissions ?? [], error: config.permissionsError ?? null })
      }
      if (name === 'generate_pending_fees') {
        return Promise.resolve(config.generateRpcResult ?? { data: [{ status: 'ok', fees_created: 0, error_message: null }], error: null })
      }
      throw new Error(`rpc inesperada en el fake client: ${name}`)
    },
  }
}

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const getSettingsMock = vi.fn()
vi.mock('@/models/settings.model', () => ({ getSettings: getSettingsMock }))

beforeEach(() => {
  createClientMock.mockReset()
  getSettingsMock.mockReset()
})

async function importModel() {
  return import('@/models/billing.model')
}

const TODAY_PERIOD = new Date().toISOString().slice(0, 7) + '-01'

describe('getBillingStatus: currentPeriodRun (§6.4)', () => {
  it('not_due: facturación nunca activada (startPeriod null)', async () => {
    getSettingsMock.mockResolvedValue({ clubName: 'Club', billingStartPeriod: null })
    createClientMock.mockResolvedValue(
      makeBillingClient({ summaryRow: { active_members: 10, pending_periods: [] }, permissions: ['billing.configure'] }),
    )
    const { getBillingStatus } = await importModel()
    const status = await getBillingStatus()
    expect(status.currentPeriodRun).toBe('not_due')
    expect(status.active).toBe(false)
  })

  it('not_due: startPeriod en el futuro', async () => {
    const future = `${new Date().getUTCFullYear() + 1}-01-01`
    getSettingsMock.mockResolvedValue({ clubName: 'Club', billingStartPeriod: future })
    createClientMock.mockResolvedValue(
      makeBillingClient({ summaryRow: { active_members: 10, pending_periods: [] }, permissions: ['billing.configure'] }),
    )
    const { getBillingStatus } = await importModel()
    const status = await getBillingStatus()
    expect(status.currentPeriodRun).toBe('not_due')
    expect(status.active).toBe(true) // activa, pero el inicio todavía no llegó
  })

  it('ok: la última corrida del período actual es status=ok', async () => {
    getSettingsMock.mockResolvedValue({ clubName: 'Club', billingStartPeriod: '2026-01-01' })
    createClientMock.mockResolvedValue(
      makeBillingClient({
        summaryRow: { active_members: 10, pending_periods: [] },
        permissions: ['billing.configure'],
        currentRunRow: { id: 1, period: TODAY_PERIOD, trigger: 'cron', actor_id: null, started_at: '2026-09-01T00:05:00Z', finished_at: '2026-09-01T00:05:01Z', status: 'ok', fees_created: 5, error_message: null },
        recentRuns: [],
      }),
    )
    const { getBillingStatus } = await importModel()
    const status = await getBillingStatus()
    expect(status.currentPeriodRun).toBe('ok')
  })

  it('failed: la última corrida del período actual es status=error', async () => {
    getSettingsMock.mockResolvedValue({ clubName: 'Club', billingStartPeriod: '2026-01-01' })
    createClientMock.mockResolvedValue(
      makeBillingClient({
        summaryRow: { active_members: 10, pending_periods: [TODAY_PERIOD] },
        permissions: ['billing.configure'],
        currentRunRow: { id: 2, period: TODAY_PERIOD, trigger: 'cron', actor_id: null, started_at: '2026-09-01T00:05:00Z', finished_at: '2026-09-01T00:05:01Z', status: 'error', fees_created: 0, error_message: 'Falta el precio para una categoría' },
        recentRuns: [],
      }),
    )
    const { getBillingStatus } = await importModel()
    const status = await getBillingStatus()
    expect(status.currentPeriodRun).toBe('failed')
    expect(status.lastRun).toBeNull() // recentRuns vacío en este fixture: lastRun sale de ahí, no de currentRunRow
  })

  it('missing: facturación activa, sin ninguna fila de billing_runs del período actual (el cron no corrió)', async () => {
    getSettingsMock.mockResolvedValue({ clubName: 'Club', billingStartPeriod: '2026-01-01' })
    createClientMock.mockResolvedValue(
      makeBillingClient({
        summaryRow: { active_members: 10, pending_periods: [TODAY_PERIOD] },
        permissions: ['billing.configure'],
        currentRunRow: null,
        recentRuns: [],
      }),
    )
    const { getBillingStatus } = await importModel()
    const status = await getBillingStatus()
    expect(status.currentPeriodRun).toBe('missing')
  })

  it('sin permiso billing.configure: nunca ve billing_runs, currentPeriodRun queda en ok/not_due aunque la corrida real haya fallado', async () => {
    getSettingsMock.mockResolvedValue({ clubName: 'Club', billingStartPeriod: '2026-01-01' })
    createClientMock.mockResolvedValue(
      makeBillingClient({
        summaryRow: { active_members: 10, pending_periods: [TODAY_PERIOD] },
        permissions: ['payments.read'], // editor/consulta: sin billing.configure
        currentRunRow: { id: 3, period: TODAY_PERIOD, trigger: 'cron', actor_id: null, started_at: '2026-09-01T00:05:00Z', finished_at: null, status: 'error', fees_created: 0, error_message: 'no debería verse' },
      }),
    )
    const { getBillingStatus } = await importModel()
    const status = await getBillingStatus()
    expect(status.currentPeriodRun).toBe('ok')
    expect(status.lastRun).toBeNull()
    expect(status.recentRuns).toEqual([])
  })

  it('lastRun con actorName resuelto desde app_users; null para el cron', async () => {
    getSettingsMock.mockResolvedValue({ clubName: 'Club', billingStartPeriod: '2026-01-01' })
    createClientMock.mockResolvedValue(
      makeBillingClient({
        summaryRow: { active_members: 10, pending_periods: [] },
        permissions: ['billing.configure'],
        currentRunRow: { id: 4, period: TODAY_PERIOD, trigger: 'manual', actor_id: 'admin-uuid', started_at: '2026-09-05T12:00:00Z', finished_at: '2026-09-05T12:00:01Z', status: 'ok', fees_created: 3, error_message: null },
        recentRuns: [
          { id: 4, period: TODAY_PERIOD, trigger: 'manual', actor_id: 'admin-uuid', started_at: '2026-09-05T12:00:00Z', finished_at: '2026-09-05T12:00:01Z', status: 'ok', fees_created: 3, error_message: null },
          { id: 3, period: '2026-08-01', trigger: 'cron', actor_id: null, started_at: '2026-08-01T00:05:00Z', finished_at: '2026-08-01T00:05:01Z', status: 'ok', fees_created: 10, error_message: null },
        ],
        appUsers: [{ user_id: 'admin-uuid', display_name: 'Ana Admin' }],
      }),
    )
    const { getBillingStatus } = await importModel()
    const status = await getBillingStatus()
    expect(status.lastRun).toMatchObject({ actorName: 'Ana Admin' })
    expect(status.recentRuns[1]).toMatchObject({ actorName: null })
  })

  it('pendingPeriods/activeMembers vienen de dashboard_summary', async () => {
    getSettingsMock.mockResolvedValue({ clubName: 'Club', billingStartPeriod: '2026-01-01' })
    createClientMock.mockResolvedValue(
      makeBillingClient({
        summaryRow: { active_members: 42, pending_periods: ['2026-07-01', '2026-08-01'] },
        permissions: ['billing.configure'],
        currentRunRow: { id: 1, period: TODAY_PERIOD, trigger: 'cron', actor_id: null, started_at: '', finished_at: '', status: 'ok', fees_created: 0, error_message: null },
        recentRuns: [],
      }),
    )
    const { getBillingStatus } = await importModel()
    const status = await getBillingStatus()
    expect(status.activeMembers).toBe(42)
    expect(status.pendingPeriods).toEqual(['2026-07-01', '2026-08-01'])
  })
})

describe('activateBilling: traducción de settings_billing_guard', () => {
  it('mes actual: genera de una y devuelve { generated }', async () => {
    createClientMock.mockResolvedValue(
      makeBillingClient({ generateRpcResult: { data: [{ status: 'ok', fees_created: 12, error_message: null }], error: null } }),
    )
    const { activateBilling } = await importModel()
    const result = await activateBilling(TODAY_PERIOD)
    expect(result).toEqual({ generated: 12 })
  })

  it('mes futuro: NO genera, devuelve { generated: 0 }', async () => {
    const future = `${new Date().getUTCFullYear() + 1}-01-01`
    const client = makeBillingClient({})
    const rpcSpy = vi.spyOn(client, 'rpc')
    createClientMock.mockResolvedValue(client)
    const { activateBilling } = await importModel()
    const result = await activateBilling(future)
    expect(result).toEqual({ generated: 0 })
    expect(rpcSpy).not.toHaveBeenCalledWith('generate_pending_fees')
  })

  it('trigger rechaza (23514, cualquiera de las 4 condiciones de §6.5) -> DomainError con field startPeriod y el mensaje del trigger', async () => {
    createClientMock.mockResolvedValue(makeBillingClient({ updateSettingsError: { code: '23514', message: 'Primero cargá el valor de cuota por defecto' } }))
    const { activateBilling } = await importModel()
    await expect(activateBilling(TODAY_PERIOD)).rejects.toMatchObject({
      message: 'Primero cargá el valor de cuota por defecto',
      field: 'startPeriod',
    })
  })

  it('42501 (defensivo, sin permiso) -> PermissionError', async () => {
    createClientMock.mockResolvedValue(makeBillingClient({ updateSettingsError: { code: '42501', message: 'permission denied' } }))
    const { activateBilling } = await importModel()
    const { PermissionError } = await import('@/lib/errors')
    await expect(activateBilling(TODAY_PERIOD)).rejects.toBeInstanceOf(PermissionError)
  })

  // 03-review.md MINOR 3: la activación de `settings` ya quedó hecha (el
  // UPDATE hizo commit) aunque la generación posterior falle — no puede ser
  // un error genérico que sugiera que nada se guardó.
  it('activación OK pero generatePendingFees falla: PartialBillingActivationError con un mensaje que dice que la facturación SÍ quedó activada', async () => {
    createClientMock.mockResolvedValue(
      makeBillingClient({ generateRpcResult: { data: [{ status: 'error', fees_created: 0, error_message: 'Falta el precio para 5ta' }], error: null } }),
    )
    const { activateBilling, PartialBillingActivationError } = await importModel()
    const err = await activateBilling(TODAY_PERIOD).catch((e) => e)
    expect(err).toBeInstanceOf(PartialBillingActivationError)
    expect(err.message).toContain('quedó activada')
    expect(err.message).toContain('Falta el precio para 5ta')
  })

  it('mes futuro: si fallara la generación no importa, porque ni se llama (generated: 0 directo)', async () => {
    const future = `${new Date().getUTCFullYear() + 1}-01-01`
    createClientMock.mockResolvedValue(
      makeBillingClient({ generateRpcResult: { data: [{ status: 'error', fees_created: 0, error_message: 'no debería importar' }], error: null } }),
    )
    const { activateBilling } = await importModel()
    await expect(activateBilling(future)).resolves.toEqual({ generated: 0 })
  })
})

describe('generatePendingFees: la RPC no relanza, acá se traduce', () => {
  it('status=ok devuelve fees_created', async () => {
    createClientMock.mockResolvedValue(
      makeBillingClient({ generateRpcResult: { data: [{ status: 'ok', fees_created: 7, error_message: null }], error: null } }),
    )
    const { generatePendingFees } = await importModel()
    await expect(generatePendingFees()).resolves.toBe(7)
  })

  it('status=error -> DomainError con error_message', async () => {
    createClientMock.mockResolvedValue(
      makeBillingClient({ generateRpcResult: { data: [{ status: 'error', fees_created: 0, error_message: 'Falta el precio para 5ta' }], error: null } }),
    )
    const { generatePendingFees } = await importModel()
    await expect(generatePendingFees()).rejects.toMatchObject({ message: 'Falta el precio para 5ta' })
  })

  it('status=skipped -> DomainError con el mensaje informativo', async () => {
    createClientMock.mockResolvedValue(
      makeBillingClient({ generateRpcResult: { data: [{ status: 'skipped', fees_created: 0, error_message: 'Facturación no activada' }], error: null } }),
    )
    const { generatePendingFees } = await importModel()
    await expect(generatePendingFees()).rejects.toMatchObject({ message: 'Facturación no activada' })
  })

  it('42501 de la propia RPC (defensivo) -> PermissionError', async () => {
    createClientMock.mockResolvedValue(makeBillingClient({ generateRpcResult: { data: null, error: { code: '42501', message: 'insufficient_privilege' } } }))
    const { generatePendingFees } = await importModel()
    const { PermissionError } = await import('@/lib/errors')
    await expect(generatePendingFees()).rejects.toBeInstanceOf(PermissionError)
  })

  it('llamado dos veces seguidas, la segunda con fees_created=0 no tira (idempotencia)', async () => {
    createClientMock.mockResolvedValue(
      makeBillingClient({ generateRpcResult: { data: [{ status: 'ok', fees_created: 0, error_message: null }], error: null } }),
    )
    const { generatePendingFees } = await importModel()
    await expect(generatePendingFees()).resolves.toBe(0)
    await expect(generatePendingFees()).resolves.toBe(0)
  })
})

describe('listBillingRuns', () => {
  it('vacío si RLS no deja ver billing_runs (0 filas, sin error): no es un error', async () => {
    createClientMock.mockResolvedValue(makeBillingClient({ recentRuns: [] }))
    const { listBillingRuns } = await importModel()
    await expect(listBillingRuns()).resolves.toEqual([])
  })
})
