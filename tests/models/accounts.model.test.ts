import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * `accounts.model.ts`: NO calcula nada (todo el balance forward vive en las
 * RPC de Postgres) — acá se prueba el mapeo camelCase, la composición de
 * `getMemberAccountDetail`, y el fix post-entrega de `disciplineName`
 * (`02-development-backend-b2.md`, "Fix post-entrega 2026-09-28"):
 * `resolveCategoryLabels` resuelve categoría Y disciplina en una sola
 * consulta batch, nunca N+1.
 */

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

const listPaymentsForMemberMock = vi.fn()
vi.mock('@/models/payments.model', () => ({ listPaymentsForMember: listPaymentsForMemberMock }))

beforeEach(() => {
  createClientMock.mockReset()
  listPaymentsForMemberMock.mockReset()
})

async function importModel() {
  return import('@/models/accounts.model')
}

const RAW_ACCOUNT_ROW = {
  member_id: 5,
  full_name: 'Ficticia, Valentina',
  status: 'active',
  member_type: 'practicing',
  categories: [
    { category_id: 8, category_name: 'Primera', discipline_id: 2, discipline_name: 'Fútbol femenino' },
    { category_id: 12, category_name: 'Sub 18', discipline_id: 3, discipline_name: 'Vóley' },
  ],
  family_group_id: null,
  is_payment_responsible: false,
  charged_cents: 5_000_000,
  paid_cents: 3_000_000,
  balance_cents: 2_000_000,
  months_due: 2,
  oldest_due_period: '2026-08-01',
  last_payment_on: '2026-09-10',
  last_payment_cents: 1_000_000,
  debt_status: 'in_debt',
  current_fee_cents: 2_000_000,
  current_fees: [
    { category_id: 8, category_name: 'Primera', discipline_name: 'Fútbol femenino', amount_cents: 1_000_000 },
    { category_id: 12, category_name: 'Sub 18', discipline_name: 'Vóley', amount_cents: 1_000_000 },
  ],
  current_fee_period: '2026-09-01',
}

function makeAccountsClient(rows: unknown[]) {
  return { rpc: (name: string) => {
    if (name !== 'member_accounts') throw new Error(`rpc inesperada: ${name}`)
    return Promise.resolve({ data: rows, error: null })
  } }
}

describe('getMemberAccounts', () => {
  it('array vacío: no llama a la RPC, devuelve []', async () => {
    const rpcSpy = vi.fn()
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { getMemberAccounts } = await importModel()
    await expect(getMemberAccounts([])).resolves.toEqual([])
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('llama member_accounts con status_filter "all" (la ficha/precarga de grupo ve también a los de baja)', async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: [RAW_ACCOUNT_ROW], error: null }))
    createClientMock.mockResolvedValue({ rpc: rpcSpy })
    const { getMemberAccounts } = await importModel()
    await getMemberAccounts([5])
    expect(rpcSpy).toHaveBeenCalledWith('member_accounts', { member_ids: [5], status_filter: 'all' })
  })

  it('mapea categories/currentFees (dos deportes) a camelCase, current_fee_cents como la SUMA', async () => {
    createClientMock.mockResolvedValue(makeAccountsClient([RAW_ACCOUNT_ROW]))
    const { getMemberAccounts } = await importModel()
    const [account] = await getMemberAccounts([5])

    expect(account.categories).toEqual([
      { categoryId: 8, categoryName: 'Primera', disciplineId: 2, disciplineName: 'Fútbol femenino' },
      { categoryId: 12, categoryName: 'Sub 18', disciplineId: 3, disciplineName: 'Vóley' },
    ])
    expect(account.currentFees).toHaveLength(2)
    expect(account.currentFeeCents).toBe(2_000_000)
    expect(account.debtStatus).toBe('in_debt')
    expect(account.monthsDue).toBe(2)
  })

  it('current_fee_cents/current_fees/current_fee_period null (facturación inactiva o inicio futuro) se pasan tal cual, sin inventar un 0', async () => {
    createClientMock.mockResolvedValue(
      makeAccountsClient([{ ...RAW_ACCOUNT_ROW, current_fee_cents: null, current_fees: null, current_fee_period: null }]),
    )
    const { getMemberAccounts } = await importModel()
    const [account] = await getMemberAccounts([5])
    expect(account.currentFeeCents).toBeNull()
    expect(account.currentFees).toEqual([])
    expect(account.currentFeePeriod).toBeNull()
  })
})

describe('getMemberAccount: un socio puntual', () => {
  it('socio existente: devuelve la primera (única) fila mapeada', async () => {
    createClientMock.mockResolvedValue(makeAccountsClient([RAW_ACCOUNT_ROW]))
    const { getMemberAccount } = await importModel()
    const account = await getMemberAccount(5)
    expect(account?.memberId).toBe(5)
  })

  it('socio inexistente: null, no tira', async () => {
    createClientMock.mockResolvedValue(makeAccountsClient([]))
    const { getMemberAccount } = await importModel()
    await expect(getMemberAccount(999)).resolves.toBeNull()
  })
})

describe('getFeeStatement: resuelve categoryName Y disciplineName (fix del 2026-09-28)', () => {
  it('una fila con category_id no nulo trae categoryName Y disciplineName poblados (NO null)', async () => {
    createClientMock.mockResolvedValue({
      rpc: (name: string) => {
        if (name !== 'member_fee_statement') throw new Error(`rpc inesperada: ${name}`)
        return Promise.resolve({
          data: [
            {
              fee_id: 4,
              period: '2026-09-01',
              kind: 'monthly',
              description: 'Cuota septiembre 2026 · Primera',
              amount_cents: 1_000_000,
              covered_cents: 1_000_000,
              category_id: 8,
              discipline_id: 2,
              status: 'paid',
              voided_at: null,
              void_reason: null,
            },
          ],
          error: null,
        })
      },
      from: (table: string) => {
        if (table !== 'categories') throw new Error(`tabla inesperada: ${table}`)
        return { select: () => ({ in: async () => ({ data: [{ id: 8, name: 'Primera', disciplines: { name: 'Fútbol femenino' } }], error: null }) }) }
      },
    })

    const { getFeeStatement } = await importModel()
    const [line] = await getFeeStatement(5)
    expect(line.categoryName).toBe('Primera')
    expect(line.disciplineName).toBe('Fútbol femenino') // el bug dejaba esto en null
  })

  it('categoryId null (social o saldo anterior): categoryName y disciplineName quedan null, sin consultar categories', async () => {
    const fromSpy = vi.fn()
    createClientMock.mockResolvedValue({
      rpc: () =>
        Promise.resolve({
          data: [
            { fee_id: 1, period: '2026-08-01', kind: 'opening_balance', description: 'Saldo anterior al sistema', amount_cents: 2_000_000, covered_cents: 0, category_id: null, discipline_id: null, status: 'due', voided_at: null, void_reason: null },
          ],
          error: null,
        }),
      from: fromSpy,
    })
    const { getFeeStatement } = await importModel()
    const [line] = await getFeeStatement(5)
    expect(line.categoryName).toBeNull()
    expect(line.disciplineName).toBeNull()
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('resuelve los nombres en UNA consulta batch, no una por fila (sin N+1)', async () => {
    const inSpy = vi.fn(async () => ({ data: [{ id: 8, name: 'Primera', disciplines: { name: 'Fútbol femenino' } }, { id: 12, name: 'Sub 18', disciplines: { name: 'Vóley' } }], error: null }))
    createClientMock.mockResolvedValue({
      rpc: () =>
        Promise.resolve({
          data: [
            { fee_id: 4, period: '2026-09-01', kind: 'monthly', description: null, amount_cents: 1_000_000, covered_cents: 1_000_000, category_id: 8, discipline_id: 2, status: 'paid', voided_at: null, void_reason: null },
            { fee_id: 5, period: '2026-09-01', kind: 'monthly', description: null, amount_cents: 1_000_000, covered_cents: 0, category_id: 12, discipline_id: 3, status: 'due', voided_at: null, void_reason: null },
          ],
          error: null,
        }),
      from: () => ({ select: () => ({ in: inSpy }) }),
    })
    const { getFeeStatement } = await importModel()
    await getFeeStatement(5)
    expect(inSpy).toHaveBeenCalledTimes(1)
  })
})

describe('getMemberAccountDetail: composición cuenta + statement + pagos + saldo de arranque', () => {
  it('socio inexistente: DomainError 404, sin llamar al resto', async () => {
    createClientMock.mockResolvedValue(makeAccountsClient([]))
    const { getMemberAccountDetail } = await importModel()
    await expect(getMemberAccountDetail(999)).rejects.toMatchObject({ message: 'El socio no existe', status: 404 })
    expect(listPaymentsForMemberMock).not.toHaveBeenCalled()
  })

  /** `from('fees').select().eq().eq().is().order().order()`: la consulta de getOpeningBalances con su resultado. */
  const feesClient = (result: { data: unknown; error: unknown }, orders?: unknown[][]) => ({
    rpc: (name: string) => {
      if (name === 'member_accounts') return Promise.resolve({ data: [RAW_ACCOUNT_ROW], error: null })
      if (name === 'member_fee_statement') return Promise.resolve({ data: [], error: null })
      throw new Error(`rpc inesperada: ${name}`)
    },
    from: (table: string) => {
      if (table !== 'fees') throw new Error(`tabla inesperada: ${table}`)
      let orderCalls = 0
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.is = () => chain
      chain.order = (...args: unknown[]) => {
        orders?.push(args)
        // dos .order() encadenados: la segunda devuelve el resultado
        return ++orderCalls < 2 ? chain : Promise.resolve(result)
      }
      return chain
    },
  })

  const openingRow = (id: number, period: string, amount = 1_000_000) => ({
    id, member_id: 5, period, kind: 'opening_balance', amount_cents: amount,
    description: `Saldo anterior · ${period.slice(5, 7)}/${period.slice(0, 4)}`, category_id: null,
    created_at: '2026-09-01T00:00:00Z', voided_at: null, void_reason: null,
  })

  it('socio existente: compone las 4 partes; openingBalances es [] si no hay ninguno vigente', async () => {
    listPaymentsForMemberMock.mockResolvedValue([{ id: 1, memberId: 5, amountCents: 1_000_000 }])
    createClientMock.mockResolvedValue(feesClient({ data: [], error: null }))

    const { getMemberAccountDetail } = await importModel()
    const detail = await getMemberAccountDetail(5)
    expect(detail.account.memberId).toBe(5)
    expect(detail.payments).toHaveLength(1)
    expect(detail.openingBalances).toEqual([])
  })

  it('con saldos anteriores vigentes: una fila por mes, mapeadas con Fee (mismo mapFeeRow que fees.model.ts)', async () => {
    listPaymentsForMemberMock.mockResolvedValue([])
    createClientMock.mockResolvedValue(feesClient({ data: [openingRow(20, '2026-07-01'), openingRow(21, '2026-08-01', 2_000_000)], error: null }))

    const { getMemberAccountDetail } = await importModel()
    const detail = await getMemberAccountDetail(5)
    expect(detail.openingBalances.map((f) => [f.id, f.period, f.amountCents])).toEqual([[20, '2026-07-01', 1_000_000], [21, '2026-08-01', 2_000_000]])
    expect(detail.openingBalances.every((f) => f.kind === 'opening_balance')).toBe(true)
  })
})

describe('getOpeningBalances', () => {
  it('pide solo los vigentes del socio, ordenados por mes y después por id (estable), y mapea', async () => {
    const calls: Record<string, unknown[][]> = { eq: [], is: [], order: [] }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (...a: unknown[]) => (calls.eq.push(a), chain)
    chain.is = (...a: unknown[]) => (calls.is.push(a), chain)
    chain.order = (...a: unknown[]) => {
      calls.order.push(a)
      return calls.order.length < 2 ? chain : Promise.resolve({ data: [{ id: 9, member_id: 5, period: '2026-03-01', kind: 'opening_balance', amount_cents: 500, description: 'x', category_id: null, created_at: '2026-09-01T00:00:00Z', voided_at: null, void_reason: null }], error: null })
    }
    createClientMock.mockResolvedValue({ from: () => chain })
    const { getOpeningBalances } = await importModel()
    const result = await getOpeningBalances(5)
    expect(calls.eq).toEqual([['member_id', 5], ['kind', 'opening_balance']])
    expect(calls.is).toEqual([['voided_at', null]]) // los anulados NO cuentan
    expect(calls.order).toEqual([['period', { ascending: true }], ['id', { ascending: true }]])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 9, amountCents: 500, period: '2026-03-01' })
  })

  it('un error de la consulta se relanza (no se traga como "sin saldo")', async () => {
    const error = { code: '42501', message: 'permission denied' }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.is = () => chain
    chain.order = () => chain
    ;(chain as { order: () => unknown }).order = (() => {
      let n = 0
      return () => (++n < 2 ? chain : Promise.resolve({ data: null, error }))
    })()
    createClientMock.mockResolvedValue({ from: () => chain })
    const { getOpeningBalances } = await importModel()
    await expect(getOpeningBalances(5)).rejects.toEqual(error)
  })
})

describe('getPaymentMonthOptions', () => {
  const RAW_CELL = {
    member_id: 5,
    period: '2026-10-01',
    kind: 'monthly',
    amount_cents: 1_000_000,
    covered_cents: 400_000,
    pending_cents: 600_000,
    is_current: true,
    priced_at_today: false,
    before_joined: false,
  }

  it('una sola RPC con todos los ids y mapeo snake -> camel', async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: [RAW_CELL], error: null }))
    createClientMock.mockResolvedValue({ rpc })
    const { getPaymentMonthOptions } = await importModel()

    const result = await getPaymentMonthOptions([5, 6, 7])

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('payment_month_options', { member_ids: [5, 6, 7] })
    expect(result).toEqual([
      {
        memberId: 5,
        period: '2026-10-01',
        kind: 'monthly',
        amountCents: 1_000_000,
        coveredCents: 400_000,
        pendingCents: 600_000,
        isCurrent: true,
        pricedAtToday: false,
        beforeJoined: false,
      },
    ])
  })

  it('before_joined (solo pre_system) se mapea a beforeJoined; la RPC ya no manda opening_from y el modelo no lo inventa', async () => {
    const rows = [
      { ...RAW_CELL, kind: 'pre_system', before_joined: true },
      { ...RAW_CELL, kind: 'pre_system', before_joined: false },
      { ...RAW_CELL, kind: 'opening_balance', before_joined: false },
    ]
    createClientMock.mockResolvedValue({ rpc: async () => ({ data: rows, error: null }) })
    const { getPaymentMonthOptions } = await importModel()
    const result = await getPaymentMonthOptions([5])
    expect(result.map((o) => o.beforeJoined)).toEqual([true, false, false])
    for (const o of result) expect(o).not.toHaveProperty('openingFrom')
  })

  it('gate de schema: si ALGUNA fila no trae before_joined (la base todavía no migró) -> DomainError "se está actualizando", no una grilla mal armada', async () => {
    const { before_joined: _omit, ...legacy } = RAW_CELL
    void _omit
    createClientMock.mockResolvedValue({ rpc: async () => ({ data: [RAW_CELL, legacy], error: null }) })
    const { getPaymentMonthOptions } = await importModel()
    await expect(getPaymentMonthOptions([5])).rejects.toMatchObject({ message: 'El sistema se está actualizando. Probá de nuevo en unos minutos' })
  })

  it('el gate NO se dispara con before_joined null/false ni con la lista vacía (socio sin tira): solo con undefined', async () => {
    const { getPaymentMonthOptions } = await importModel()
    createClientMock.mockResolvedValue({ rpc: async () => ({ data: [], error: null }) })
    await expect(getPaymentMonthOptions([5])).resolves.toEqual([])
    createClientMock.mockResolvedValue({ rpc: async () => ({ data: [{ ...RAW_CELL, before_joined: null }], error: null }) })
    await expect(getPaymentMonthOptions([5])).resolves.toHaveLength(1)
  })

  it('sin ids: [] y NO llama a la base', async () => {
    const rpc = vi.fn()
    createClientMock.mockResolvedValue({ rpc })
    const { getPaymentMonthOptions } = await importModel()
    expect(await getPaymentMonthOptions([])).toEqual([])
    expect(createClientMock).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('data null sin error: []', async () => {
    createClientMock.mockResolvedValue({ rpc: async () => ({ data: null, error: null }) })
    const { getPaymentMonthOptions } = await importModel()
    expect(await getPaymentMonthOptions([1])).toEqual([])
  })

  it('un error de la RPC se relanza (no se traga como "sin tira")', async () => {
    const error = { code: '42501', message: 'No tenés permiso para ver esta información' }
    createClientMock.mockResolvedValue({ rpc: async () => ({ data: null, error }) })
    const { getPaymentMonthOptions } = await importModel()
    await expect(getPaymentMonthOptions([1])).rejects.toBe(error)
  })
})
