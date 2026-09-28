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

  it('socio existente: compone las 4 partes, openingBalance null si no hay ninguno vigente', async () => {
    listPaymentsForMemberMock.mockResolvedValue([{ id: 1, memberId: 5, amountCents: 1_000_000 }])
    createClientMock.mockResolvedValue({
      rpc: (name: string) => {
        if (name === 'member_accounts') return Promise.resolve({ data: [RAW_ACCOUNT_ROW], error: null })
        if (name === 'member_fee_statement') return Promise.resolve({ data: [], error: null })
        throw new Error(`rpc inesperada: ${name}`)
      },
      from: (table: string) => {
        if (table !== 'fees') throw new Error(`tabla inesperada: ${table}`)
        return { select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }
      },
    })

    const { getMemberAccountDetail } = await importModel()
    const detail = await getMemberAccountDetail(5)
    expect(detail.account.memberId).toBe(5)
    expect(detail.payments).toHaveLength(1)
    expect(detail.openingBalance).toBeNull()
  })

  it('con saldo de arranque vigente, lo mapea con Fee (mismo mapFeeRow que fees.model.ts)', async () => {
    listPaymentsForMemberMock.mockResolvedValue([])
    createClientMock.mockResolvedValue({
      rpc: (name: string) => {
        if (name === 'member_accounts') return Promise.resolve({ data: [RAW_ACCOUNT_ROW], error: null })
        if (name === 'member_fee_statement') return Promise.resolve({ data: [], error: null })
        throw new Error(`rpc inesperada: ${name}`)
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 20,
                    member_id: 5,
                    period: '2026-08-01',
                    kind: 'opening_balance',
                    amount_cents: 2_000_000,
                    description: 'Saldo anterior al sistema',
                    category_id: null,
                    created_at: '2026-09-01T00:00:00Z',
                    voided_at: null,
                    void_reason: null,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    })

    const { getMemberAccountDetail } = await importModel()
    const detail = await getMemberAccountDetail(5)
    expect(detail.openingBalance).toMatchObject({ id: 20, kind: 'opening_balance', amountCents: 2_000_000 })
  })
})
