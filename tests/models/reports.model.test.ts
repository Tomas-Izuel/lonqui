import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `reports.model.ts`: NO suma nada en TS (toda agregación viene resuelta de
 * las RPC de Postgres, CLAUDE.md) — se prueba el armado de filtros
 * (`listMemberAccounts`: `debt` → `eq`/`in`, `categoryId` → `category_filter`,
 * paginación SIEMPRE con `range`) y el mapeo camelCase de cada RPC. Cliente
 * mockeado en el borde externo.
 */

/** Builder encadenable genérico: registra qué métodos se llamaron y con qué args, y resuelve en `overrideTypes()`. */
function chainableRpc(rpcSpy: (name: string, args: unknown) => void, resolve: () => { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = []
  const self: Record<string, unknown> = {
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args })
      return self
    },
    in: (...args: unknown[]) => {
      calls.push({ method: 'in', args })
      return self
    },
    order: (...args: unknown[]) => {
      calls.push({ method: 'order', args })
      return self
    },
    range: (...args: unknown[]) => {
      calls.push({ method: 'range', args })
      return self
    },
    single: () => self,
    overrideTypes: () => Promise.resolve(resolve()),
    __calls: calls,
  }
  return self
}

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

beforeEach(() => {
  createClientMock.mockReset()
})

async function importModel() {
  return import('@/models/reports.model')
}

const ACCOUNT_ROW = {
  member_id: 1,
  full_name: 'Test, Ana',
  status: 'active',
  member_type: 'practicing',
  categories: [],
  family_group_id: null,
  is_payment_responsible: false,
  charged_cents: 1_000_000,
  paid_cents: 0,
  balance_cents: 1_000_000,
  months_due: 1,
  oldest_due_period: '2026-09-01',
  last_payment_on: null,
  last_payment_cents: null,
  debt_status: 'in_debt',
  current_fee_cents: 1_000_000,
  current_fees: [],
  current_fee_period: '2026-09-01',
}

describe('listMemberAccounts: armado de filtros y paginación', () => {
  it('debt: "up_to_date" se traduce a .in(debt_status, [up_to_date, credit]) — el fix de "al día incluye saldo a favor"', async () => {
    const rpcSpy = vi.fn(() => {
      const builder = chainableRpc(() => {}, () => ({ data: [ACCOUNT_ROW], error: null }))
      return builder
    })
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listMemberAccounts } = await importModel()
    const builder = rpcSpy as unknown as ReturnType<typeof vi.fn>

    await listMemberAccounts({ debt: 'up_to_date' })

    const returnedBuilder = builder.mock.results[0].value as { __calls: { method: string; args: unknown[] }[] }
    const inCall = returnedBuilder.__calls.find((c) => c.method === 'in')
    expect(inCall?.args).toEqual(['debt_status', ['up_to_date', 'credit']])
  })

  it('debt: "in_debt" se traduce a .eq(debt_status, in_debt)', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: [], error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listMemberAccounts } = await importModel()
    await listMemberAccounts({ debt: 'in_debt' })
    const returnedBuilder = rpcSpy.mock.results[0].value as { __calls: { method: string; args: unknown[] }[] }
    expect(returnedBuilder.__calls.find((c) => c.method === 'eq')?.args).toEqual(['debt_status', 'in_debt'])
  })

  it('sin debt o "any": no filtra por debt_status', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: [], error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listMemberAccounts } = await importModel()
    await listMemberAccounts({ debt: 'any' })
    const returnedBuilder = rpcSpy.mock.results[0].value as { __calls: { method: string; args: unknown[] }[] }
    expect(returnedBuilder.__calls.some((c) => c.method === 'eq' || c.method === 'in')).toBe(false)
  })

  it('categoryId se manda como category_filter a la RPC (inscripción abierta)', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: [], error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listMemberAccounts } = await importModel()
    await listMemberAccounts({ categoryId: 5, status: 'active' })
    expect(rpcSpy).toHaveBeenCalledWith('member_accounts', { status_filter: 'active', category_filter: 5 })
  })

  it('siempre pide range (nunca un select a ciegas), páginas de 200', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: [], error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listMemberAccounts } = await importModel()
    await listMemberAccounts({})
    const returnedBuilder = rpcSpy.mock.results[0].value as { __calls: { method: string; args: unknown[] }[] }
    const rangeCall = returnedBuilder.__calls.find((c) => c.method === 'range')
    expect(rangeCall?.args).toEqual([0, 200])
  })

  it('con más filas que el límite: hasMore -> nextCursor no nulo, y la página se recorta a 200', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ ...ACCOUNT_ROW, member_id: i + 1 }))
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: rows, error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listMemberAccounts } = await importModel()
    const page = await listMemberAccounts({})
    expect(page.items).toHaveLength(200)
    expect(page.nextCursor).not.toBeNull()
  })

  it('cursor decodifica el offset y lo usa en el próximo range', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: [], error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listMemberAccounts } = await importModel()
    const cursor = Buffer.from('200', 'utf8').toString('base64url')
    await listMemberAccounts({ cursor })
    const returnedBuilder = rpcSpy.mock.results[0].value as { __calls: { method: string; args: unknown[] }[] }
    expect(returnedBuilder.__calls.find((c) => c.method === 'range')?.args).toEqual([200, 400])
  })

  it('cursor corrupto: cae a la primera página (offset 0), nunca tira', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: [], error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listMemberAccounts } = await importModel()
    await listMemberAccounts({ cursor: 'esto-no-es-un-cursor-válido' })
    const returnedBuilder = rpcSpy.mock.results[0].value as { __calls: { method: string; args: unknown[] }[] }
    expect(returnedBuilder.__calls.find((c) => c.method === 'range')?.args).toEqual([0, 200])
  })
})

describe('listTopDebtors', () => {
  it('filtra status_filter active + debt_status in_debt, ordena y limita', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: [ACCOUNT_ROW], error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { listTopDebtors } = await importModel()
    const result = await listTopDebtors(5)
    expect(rpcSpy).toHaveBeenCalledWith('member_accounts', { status_filter: 'active' })
    expect(result).toHaveLength(1)
    expect(result[0].debtStatus).toBe('in_debt')
  })
})

describe('getDashboardSummary: mapeo camelCase completo', () => {
  it('mapea todos los campos, incluidas las columnas separadas de admissions/reactivations y payments_count', async () => {
    // HALLAZGO DE PRODUCCIÓN (no se arregla acá, no es tests/**): `DashboardSummary`
    // (src/models/types.ts:565-577) exige `paymentsCount: number`, pero
    // `DashboardSummaryRow`/`mapDashboardSummary` (src/models/reports.model.ts,
    // tipo en ~86-108, mapeo en ~180-203) no traen ni mapean `payments_count`.
    // `npm run typecheck` ya lo marca (TS2741, reports.model.ts:181). Este test
    // pasa la fila cruda CON `payments_count` (así vendría de la RPC real,
    // `MonthCollectionRowRaw` ya la tiene) y fija el mapeo CORRECTO: falla hoy
    // porque `mapDashboardSummary` la descarta en silencio.
    const row = {
      billing_active: true,
      billing_start_period: '2026-09-01',
      period: '2026-09-01',
      active_members: 100,
      collected_cents: 5_000_000,
      cash_cents: 3_000_000,
      transfer_cents: 2_000_000,
      payments_count: 42,
      fees_cents: 8_000_000,
      fees_count: 80,
      total_debt_cents: 12_500_000,
      members_in_debt: 20,
      members_with_credit: 2,
      credit_cents: 300_000,
      inactive_debt_cents: 400_000,
      inactive_in_debt: 3,
      admissions_count: 4,
      reactivations_count: 1,
      withdrawals_count: 2,
      expired_clearances: 5,
      missing_clearances: 1,
      pending_periods: [],
    }
    createClientMock.mockResolvedValue({ rpc: () => chainableRpc(() => {}, () => ({ data: row, error: null })) })
    const { getDashboardSummary } = await importModel()
    const summary = await getDashboardSummary()
    expect(summary).toEqual({
      billingActive: true,
      billingStartPeriod: '2026-09-01',
      period: '2026-09-01',
      activeMembers: 100,
      collectedCents: 5_000_000,
      cashCents: 3_000_000,
      transferCents: 2_000_000,
      paymentsCount: 42,
      feesCents: 8_000_000,
      feesCount: 80,
      totalDebtCents: 12_500_000,
      membersInDebt: 20,
      membersWithCredit: 2,
      creditCents: 300_000,
      inactiveDebtCents: 400_000,
      inactiveInDebt: 3,
      admissionsCount: 4,
      reactivationsCount: 1,
      withdrawalsCount: 2,
      expiredClearances: 5,
      missingClearances: 1,
      pendingPeriods: [],
    })
  })
})

describe('listDebtByCategory: ordena por sort_order, mapea kind/atribución', () => {
  it('mapea kind, categoryId/disciplineId null en las filas especiales', async () => {
    const rows = [
      { kind: 'category', category_id: 5, category_name: '5ta', discipline_id: 1, discipline_name: 'Fútbol masculino', members: 10, members_in_debt: 2, debt_cents: 2_000_000, sort_order: 1 },
      { kind: 'social', category_id: null, category_name: 'Cuota social', discipline_id: null, discipline_name: null, members: 5, members_in_debt: 1, debt_cents: 500_000, sort_order: 100 },
      { kind: 'opening_balance', category_id: null, category_name: 'Saldo anterior al sistema', discipline_id: null, discipline_name: null, members: 3, members_in_debt: 3, debt_cents: 6_000_000, sort_order: 101 },
    ]
    createClientMock.mockResolvedValue({ rpc: () => chainableRpc(() => {}, () => ({ data: rows, error: null })) })
    const { listDebtByCategory } = await importModel()
    const result = await listDebtByCategory()
    expect(result.map((r) => r.kind)).toEqual(['category', 'social', 'opening_balance'])
    expect(result[1].categoryId).toBeNull()
    // La suma de debtCents es la deuda total (invariante probada a fondo en tests/db/accounts.test.ts).
    expect(result.reduce((sum, r) => sum + r.debtCents, 0)).toBe(8_500_000)
  })
})

describe('getMonthlyHistory / getMonthCollection', () => {
  it('getMonthlyHistory mapea period/collectedCents/feesCents/debtAtCloseCents', async () => {
    createClientMock.mockResolvedValue({
      rpc: () => chainableRpc(() => {}, () => ({ data: [{ period: '2026-09-01', collected_cents: 1, fees_cents: 2, debt_at_close_cents: 3 }], error: null })),
    })
    const { getMonthlyHistory } = await importModel()
    const [point] = await getMonthlyHistory(1)
    expect(point).toEqual({ period: '2026-09-01', collectedCents: 1, feesCents: 2, debtAtCloseCents: 3 })
  })

  it('getMonthCollection sin targetPeriod llama la RPC sin argumentos (mes actual del club)', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: { period: '2026-09-01', collected_cents: 1, cash_cents: 1, transfer_cents: 0, payments_count: 1, fees_cents: 1, fees_count: 1 }, error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { getMonthCollection } = await importModel()
    await getMonthCollection()
    expect(rpcSpy).toHaveBeenCalledWith('month_collection', {})
  })

  it('getMonthCollection con targetPeriod lo pasa como target_period', async () => {
    const rpcSpy = vi.fn(() => chainableRpc(() => {}, () => ({ data: { period: '2026-08-01', collected_cents: 1, cash_cents: 1, transfer_cents: 0, payments_count: 1, fees_cents: 1, fees_count: 1 }, error: null })))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { getMonthCollection } = await importModel()
    await getMonthCollection('2026-08-01')
    expect(rpcSpy).toHaveBeenCalledWith('month_collection', { target_period: '2026-08-01' })
  })
})

describe('loadMoreMemberAccountsSchema', () => {
  it('acepta filtros vacíos', async () => {
    const { loadMoreMemberAccountsSchema } = await importModel()
    expect(loadMoreMemberAccountsSchema.safeParse({}).success).toBe(true)
  })

  it('rechaza claves desconocidas (.strict())', async () => {
    const { loadMoreMemberAccountsSchema } = await importModel()
    expect(loadMoreMemberAccountsSchema.safeParse({ limit: 50 }).success).toBe(false)
  })

  it('acepta debt=credit explícito', async () => {
    const { loadMoreMemberAccountsSchema } = await importModel()
    expect(loadMoreMemberAccountsSchema.safeParse({ debt: 'credit' }).success).toBe(true)
  })
})
