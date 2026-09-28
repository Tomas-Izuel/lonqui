/**
 * Texto derivado de `MemberAccount` para los flujos de cobranza: la línea de
 * cuenta ("Debe $X · N meses", "Al día", "Saldo a favor $X", "Dado de baja ·
 * debe $X"), el texto de deportes/categorías del encabezado, y el desglose de
 * la cuota del mes (§13.4 de `00-architecture.md`, D12 revisada). Puro
 * formato: cero data fetching (vive en `views/`, el lint lo prohibiría igual).
 */

import { formatCentsCompact } from '@/lib/money'
import { formatPeriod } from '@/lib/dates'
import type { CurrentFeeLine, MemberAccount, MemberCategoryRef } from '@/models/types'

/** `/cobranza/deuda` vs. `/cobranza/al-dia`: mismo `debt_status` que espera `AccountListFilters['debt']`. */
export type ListingVariant = 'in_debt' | 'up_to_date'

/** "Fútbol masculino · 5ta, Vóley · Sub 18" o "No practicante". */
export function categoriesLabel(categories: MemberCategoryRef[]): string {
  if (categories.length === 0) return 'No practicante'
  return categories.map((c) => `${c.disciplineName} · ${c.categoryName}`).join(', ')
}

/**
 * La línea de estado de cuenta. Nunca un número negativo para el saldo a
 * favor (piso de calidad): se informa como "Saldo a favor $X" siempre en
 * positivo.
 */
export function accountLineText(member: Pick<MemberAccount, 'status' | 'debtStatus' | 'balanceCents' | 'monthsDue'>): string {
  const prefix = member.status === 'inactive' ? 'Dado de baja · ' : ''

  if (member.debtStatus === 'credit') {
    return `${prefix}Saldo a favor ${formatCentsCompact(Math.abs(member.balanceCents))}`
  }
  if (member.debtStatus === 'up_to_date') {
    return prefix ? `${prefix}al día` : 'Al día'
  }

  const months = member.monthsDue === 1 ? '1 mes' : `${member.monthsDue} meses`
  return `${prefix}Debe ${formatCentsCompact(member.balanceCents)} · ${months}`
}

function feeLineLabel(line: CurrentFeeLine): string {
  const category = line.disciplineName ? `${line.disciplineName} · ${line.categoryName}` : line.categoryName
  return `${category} ${formatCentsCompact(line.amountCents)}`
}

/**
 * "Cuota de septiembre: $20.000 (Fútbol masculino · 5ta $10.000 + Vóley ·
 * Sub 18 $10.000)" o, si es un único cargo social, "Cuota social de
 * septiembre: $10.000" sin paréntesis (D12 revisada, §13.4). Null sin
 * facturación activa (currentFeeCents null): el formulario lo explica aparte.
 */
export function currentFeeLabel(member: Pick<MemberAccount, 'currentFeeCents' | 'currentFees' | 'currentFeePeriod'>): string | null {
  if (member.currentFeeCents == null || member.currentFeePeriod == null) return null

  const periodLabel = formatPeriod(member.currentFeePeriod)
  const isSocialOnly = member.currentFees.length <= 1 && member.currentFees.every((f) => f.categoryId == null)

  if (isSocialOnly) {
    return `Cuota social de ${periodLabel}: ${formatCentsCompact(member.currentFeeCents)}`
  }

  const breakdown = member.currentFees.map(feeLineLabel).join(' + ')
  return `Cuota de ${periodLabel}: ${formatCentsCompact(member.currentFeeCents)} (${breakdown})`
}
