import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, fakeSupabase, ok } from '../stubs/supabase-mock'

/**
 * `reports.model.getCashMonthSummary` (RPC `cash_month_summary`: todo el
 * agregado vive en la base, el modelo solo mapea) y `exports.model.logExport`
 * (RPC `log_export`: si falla TIRA, y quien llama no puede entregar el CSV).
 */

const createClientMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))

beforeEach(() => createClientMock.mockReset())

const summaryRow = (over: Record<string, unknown> = {}) => ({
  period: '2026-09-01',
  total_cents: 9_000_000,
  fees_collected_cents: 5_000_000,
  other_income_cents: 4_000_000,
  cash_cents: 6_000_000,
  transfer_cents: 3_000_000,
  fees_cents: 8_000_000,
  fees_count: 8,
  payments_count: 5,
  other_income_count: 2,
  by_concept: [
    { concept_id: 2, concept_name: 'Sponsor', amount_cents: 3_000_000, count: 1 },
    { concept_id: 4, concept_name: 'Evento', amount_cents: 1_000_000, count: 1 },
  ],
  ...over,
})

describe('getCashMonthSummary', () => {
  it('mapea todos los campos a camelCase y by_concept a CashConceptTotal[] (sin recalcular nada en TS)', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ rpc: { cash_month_summary: [ok(summaryRow())] } }).client)
    const { getCashMonthSummary } = await import('@/models/reports.model')

    const s = await getCashMonthSummary('2026-09-01')

    expect(s).toEqual({
      period: '2026-09-01',
      totalCents: 9_000_000,
      feesCollectedCents: 5_000_000,
      otherIncomeCents: 4_000_000,
      cashCents: 6_000_000,
      transferCents: 3_000_000,
      feesCents: 8_000_000,
      feesCount: 8,
      paymentsCount: 5,
      otherIncomeCount: 2,
      byConcept: [
        { conceptId: 2, conceptName: 'Sponsor', amountCents: 3_000_000, count: 1 },
        { conceptId: 4, conceptName: 'Evento', amountCents: 1_000_000, count: 1 },
      ],
    })
  })

  it('el total viene tal cual de la base: si no cuadrara con la suma, el modelo NO lo corrige', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ rpc: { cash_month_summary: [ok(summaryRow({ total_cents: 123 }))] } }).client)
    const { getCashMonthSummary } = await import('@/models/reports.model')
    expect((await getCashMonthSummary()).totalCents).toBe(123)
  })

  it('by_concept null o vacío -> []; sin período no manda target_period, con período sí', async () => {
    const { getCashMonthSummary } = await import('@/models/reports.model')
    const none = fakeSupabase({ rpc: { cash_month_summary: [ok(summaryRow({ by_concept: null, other_income_cents: 0 }))] } })
    createClientMock.mockResolvedValue(none.client)
    expect((await getCashMonthSummary()).byConcept).toEqual([])
    expect(none.opsOf('rpc:cash_month_summary')[0][1][0]).toEqual({})

    const withP = fakeSupabase({ rpc: { cash_month_summary: [ok(summaryRow({ by_concept: [] }))] } })
    createClientMock.mockResolvedValue(withP.client)
    expect((await getCashMonthSummary('2025-03-01')).byConcept).toEqual([])
    expect(withP.opsOf('rpc:cash_month_summary')[0][1][0]).toEqual({ target_period: '2025-03-01' })
  })

  it('error de la RPC (sin permisos): se propaga', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ rpc: { cash_month_summary: [fail('42501', 'No tenés permiso para ver esta información')] } }).client)
    const { getCashMonthSummary } = await import('@/models/reports.model')
    await expect(getCashMonthSummary()).rejects.toMatchObject({ code: '42501' })
  })
})

describe('logExport', () => {
  it('llama a la RPC log_export con listing, filtros como JSON plano y cantidad de filas', async () => {
    const fake = fakeSupabase({ rpc: { log_export: [ok(null)] } })
    createClientMock.mockResolvedValue(fake.client)
    const { logExport } = await import('@/models/exports.model')

    await logExport('other_income', { mes: '2026-09', concepto: undefined, sponsor: '7' }, 12)

    // JSON.parse(JSON.stringify(...)) descarta los undefined: no viajan como clave.
    expect(fake.opsOf('rpc:log_export')[0][1][0]).toEqual({ listing: 'other_income', filters: { mes: '2026-09', sponsor: '7' }, row_count: 12 })
  })

  it('si la auditoría falla, tira (el llamador no entrega el archivo)', async () => {
    createClientMock.mockResolvedValue(fakeSupabase({ rpc: { log_export: [fail('42501', 'No tenés permiso para exportar')] } }).client)
    const { logExport } = await import('@/models/exports.model')
    await expect(logExport('other_income', {}, 0)).rejects.toMatchObject({ code: '42501' })
  })
})
