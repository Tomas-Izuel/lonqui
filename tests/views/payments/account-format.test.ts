import { describe, expect, it } from 'vitest'
import { categoryRowLabel } from '@/views/payments/account-format'
import type { DebtByCategoryRow } from '@/models/types'

/**
 * `categoryRowLabel` (movida a `account-format.ts` en este pipeline): rótulo
 * de una fila de `debt_by_category`. Las dos filas especiales ('social' y
 * 'opening_balance') tienen texto fijo propio; una fila de categoría real
 * combina disciplina + categoría, salvo que la disciplina venga null.
 */
function row(overrides: Partial<DebtByCategoryRow>): DebtByCategoryRow {
  return {
    kind: 'category',
    categoryId: 1,
    categoryName: '5ta',
    disciplineId: 1,
    disciplineName: 'Fútbol masculino',
    members: 10,
    membersInDebt: 2,
    debtCents: 100_000,
    ...overrides,
  }
}

describe('categoryRowLabel', () => {
  it('kind "social": texto fijo, ignora cualquier otro campo', () => {
    expect(categoryRowLabel(row({ kind: 'social', categoryName: 'lo que sea' }))).toBe('Cuota social · no practicantes')
  })

  it('kind "opening_balance": texto fijo, ignora cualquier otro campo', () => {
    expect(categoryRowLabel(row({ kind: 'opening_balance' }))).toBe('Saldo anterior al sistema')
  })

  it('kind "category" con disciplina: "Disciplina · Categoría"', () => {
    expect(categoryRowLabel(row({ disciplineName: 'Vóley', categoryName: 'Sub 18' }))).toBe('Vóley · Sub 18')
  })

  it('kind "category" sin disciplina (disciplineName null): solo el nombre de categoría, sin "· "', () => {
    const label = categoryRowLabel(row({ disciplineName: null, categoryName: 'Sin disciplina' }))
    expect(label).toBe('Sin disciplina')
    expect(label).not.toContain('·')
  })
})
