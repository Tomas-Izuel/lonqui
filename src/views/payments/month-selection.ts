/**
 * Lógica pura de la tira de meses del formulario de pago (00-architecture §10).
 * Sin React, sin fetch, sin `Date`: lo consumen `MonthStrip`, los formularios
 * de pago y la ficha (F2), y lo prueba `test-engineer` sin DOM.
 *
 * Idea central: balance forward. Los meses se cubren en orden, del más viejo
 * al más nuevo; nadie elige meses sueltos. La selección es un RANGO que
 * arranca en el primer mes sin pagar (o en el primer mes "antes del sistema"
 * que se marcó) y termina donde se tocó o arrastró.
 *
 * Carga inicial (00-architecture §6): el primer mes previo marcado F es
 * "desde cuándo debía"; el saldo anterior abarca F..P (P = último mes previo)
 * pero el PAGO cubre solo lo marcado. Lo que queda sin marcar entre el último
 * marcado y P sigue adeudado.
 */

import { periodRangeLabel } from '@/lib/dates'
import { shortMonth } from '@/views/shared/chart-format'
import type { ISODate, MemberStatus, OpeningBalanceMonths, PaymentMonthOption } from '@/models/types'

export type CellTone = 'pre_system' | 'opening_balance' | 'due' | 'partial' | 'paid' | 'covered' | 'current' | 'advance'

/** Rango inclusive sobre el array COMPLETO de opciones (las no elegibles quedan sin marcar aunque caigan adentro). */
export type Selection = { startIndex: number; endIndex: number } | null

export type CoverageResult = {
  fullyCovered: number[]
  partial: { index: number; cents: number } | null
  leftoverCents: number
}

type AmountContext = { openingBalanceOverrideCents?: number | null; creditCents: number }

/** Saldo anterior viejo (una sola celda sin tramo): conserva su rótulo "Saldo anterior · $X". */
export function isLegacyOpening(o: PaymentMonthOption): boolean {
  // `!` y no `=== null`: una fila que viene de una RPC vieja puede no traer la columna.
  return o.kind === 'opening_balance' && !o.openingFrom
}

export function cellTone(o: PaymentMonthOption): CellTone {
  // Una celda previa sin nada pendiente solo aparece en las opciones efectivas: el saldo a favor ya la cubre.
  if (o.kind === 'pre_system') return o.pendingCents <= 0 ? 'covered' : 'pre_system'
  if (o.pendingCents <= 0) return o.kind === 'projected' ? 'covered' : 'paid'
  // Con tramo, el saldo anterior son meses reales: se pintan como cualquier cuota.
  if (isLegacyOpening(o)) return 'opening_balance'
  if (o.coveredCents > 0 && o.coveredCents < o.amountCents) return 'partial'
  if (o.kind === 'projected') return o.isCurrent ? 'current' : 'advance'
  return o.isCurrent ? 'current' : 'due'
}

export function isSelectable(o: PaymentMonthOption): boolean {
  return o.pendingCents > 0
}

function isAdvance(o: PaymentMonthOption): boolean {
  return o.kind === 'projected' && !o.isCurrent
}

/** Primer índice elegible que no sea "antes del sistema". `-1` si no hay. */
export function firstSystemIndex(options: PaymentMonthOption[]): number {
  return options.findIndex((o) => o.kind !== 'pre_system' && isSelectable(o))
}

function lastPreSystemIndex(options: PaymentMonthOption[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (options[i].kind === 'pre_system') return i
  }
  return -1
}

/**
 * Antes de que arranque la facturación el mes actual también es "antes del
 * sistema": la RPC lo marca con `isCurrent` en una celda `pre_system`. Después
 * del inicio ninguna celda previa es el mes actual.
 */
export function isBeforeStart(options: PaymentMonthOption[]): boolean {
  return options.some((o) => o.kind === 'pre_system' && o.isCurrent)
}

/** Índice de la celda previa que es el mes actual (`-1` si no hay: ya empezó la facturación). */
function currentPreSystemIndex(options: PaymentMonthOption[]): number {
  return options.findIndex((o) => o.kind === 'pre_system' && o.isCurrent)
}

export function defaultSelection(options: PaymentMonthOption[], memberStatus: MemberStatus): Selection {
  if (isBeforeStart(options)) {
    // Lo que se cobra hoy es el mes actual, como saldo anterior de un mes (activo o de baja: sin adelantos).
    const current = currentPreSystemIndex(options)
    if (isSelectable(options[current])) return { startIndex: current, endIndex: current }
  }
  const first = firstSystemIndex(options)
  if (first === -1) return null
  if (memberStatus === 'active') return { startIndex: first, endIndex: first }
  // Dado de baja con deuda: toda la deuda, sin adelantos (la RPC ya no los trae).
  let last = first
  for (let i = first; i < options.length; i++) {
    if (options[i].kind !== 'pre_system' && isSelectable(options[i])) last = i
  }
  return { startIndex: first, endIndex: last }
}

export type TapOptions = {
  preSystemOpen: boolean
  /**
   * 'to_end' (default, la ficha): tocar un mes previo marca hasta el último previo.
   * 'free' (formularios de pago): el operador decide hasta qué mes se paga.
   */
  preMode?: 'to_end' | 'free'
  /** El operador todavía no tocó nada: la selección por defecto no cuenta como rango. */
  fresh?: boolean
}

export function tapCell(options: PaymentMonthOption[], selection: Selection, index: number, opts: TapOptions): Selection {
  const cell = options[index]
  if (!cell || !isSelectable(cell)) return selection

  if (cell.kind === 'pre_system') {
    // Con el pliegue cerrado esas celdas no se ven: tocarlas no puede ocurrir.
    if (!opts.preSystemOpen) return selection

    if (opts.preMode === 'free') {
      if (opts.fresh || selection === null) return { startIndex: index, endIndex: index }
      const { startIndex, endIndex } = selection
      // Fuera del rango: se extiende hasta incluirla (tocar-tocar da un rango sin arrastrar).
      if (index < startIndex) return { startIndex: index, endIndex }
      if (index > endIndex) return { startIndex, endIndex: index }
      // El final: se achica uno, y si era la única celda se desmarca.
      if (index === endIndex) return startIndex === endIndex ? null : { startIndex, endIndex: endIndex - 1 }
      // Marcada pero no es el final: pasa a ser "hasta acá".
      return { startIndex, endIndex: index }
    }

    // Antes del inicio el tope de lo previo es el mes actual, no el último previo
    // devuelto: no se cobran como deuda meses que todavía no vencieron.
    const currentPre = currentPreSystemIndex(options)
    const lastPre = currentPre !== -1 ? currentPre : lastPreSystemIndex(options)
    // Antes del inicio no hay pliegue que cierre la parte previa: volver a tocar
    // el primer mes marcado la desmarca y deja solo lo del sistema (o nada).
    if (isBeforeStart(options) && selection && selection.startIndex === index) {
      const first = firstSystemIndex(options)
      return first !== -1 && selection.endIndex > lastPre ? { startIndex: first, endIndex: selection.endIndex } : null
    }
    const currentEnd = selection?.endIndex
    const keepEnd = currentEnd !== undefined && currentEnd >= index && !isAdvance(options[currentEnd])
    return { startIndex: index, endIndex: keepEnd ? currentEnd : lastPre }
  }

  const first = firstSystemIndex(options)
  const keepPreStart = selection !== null && options[selection.startIndex]?.kind === 'pre_system'
  return { startIndex: keepPreStart ? selection.startIndex : first, endIndex: index }
}

/**
 * Arrastre del ancla `anchor` hasta `over` (en cualquier sentido): REEMPLAZA la
 * selección. Nadie salta meses: si el extremo más viejo es del sistema, arranca
 * en el primer mes elegible del sistema. Solo entran celdas elegibles; `null` si
 * no queda ninguna.
 */
export function dragSelect(options: PaymentMonthOption[], anchor: number, over: number): Selection {
  let lo = Math.min(anchor, over)
  let hi = Math.max(anchor, over)
  if (!options[lo] || !options[hi]) return null
  if (options[lo].kind !== 'pre_system') {
    const first = firstSystemIndex(options)
    if (first === -1) return null
    lo = first
  }
  while (lo <= hi && !isSelectable(options[lo])) lo++
  while (hi >= lo && !isSelectable(options[hi])) hi--
  return lo <= hi ? { startIndex: lo, endIndex: hi } : null
}

/** Cerrar el pliegue: el inicio vuelve al primer mes del sistema (o no queda nada marcado). */
export function closePreSystem(options: PaymentMonthOption[], selection: Selection): Selection {
  const first = firstSystemIndex(options)
  if (first === -1) return null
  if (selection === null) return null
  if (options[selection.startIndex]?.kind !== 'pre_system') return selection
  // Si todo lo marcado era "antes del sistema", queda el primer mes del sistema.
  return { startIndex: first, endIndex: Math.max(first, selection.endIndex) }
}

export function selectedIndexes(options: PaymentMonthOption[], selection: Selection): number[] {
  if (!selection) return []
  const out: number[] = []
  for (let i = selection.startIndex; i <= selection.endIndex; i++) {
    if (options[i] && isSelectable(options[i])) out.push(i)
  }
  return out
}

export function selectedOptions(options: PaymentMonthOption[], selection: Selection): PaymentMonthOption[] {
  return selectedIndexes(options, selection).map((i) => options[i])
}

/**
 * Partes enteras de un total entre `months` meses: el último absorbe el resto.
 * Espejo exacto del reparto de `payment_month_options` (un test de DB lo compara).
 */
export function splitOpeningTotal(totalCents: number, months: number): number[] {
  if (months <= 0) return []
  const base = Math.floor(totalCents / months)
  const parts = Array.from({ length: months }, () => base)
  parts[months - 1] = totalCents - (months - 1) * base
  return parts
}

/**
 * El tramo del saldo anterior que crea la selección: desde el primer mes previo
 * marcado hasta el último mes previo (aunque el pago termine antes). `null` si
 * la selección no arranca en una celda previa. Índices sobre el array completo.
 */
export function openingSpan(options: PaymentMonthOption[], selection: Selection): { from: number; to: number } | null {
  if (!selection || options[selection.startIndex]?.kind !== 'pre_system') return null
  const to = lastPreSystemIndex(options)
  return to >= selection.startIndex ? { from: selection.startIndex, to } : null
}

function spanAmounts(options: PaymentMonthOption[], span: { from: number; to: number }, overrideCents?: number | null): number[] {
  const months = span.to - span.from + 1
  if (overrideCents != null) return splitOpeningTotal(overrideCents, months)
  return options.slice(span.from, span.to + 1).map((o) => o.amountCents)
}

/** El saldo anterior que crea la selección (opciones de la RPC): F..P, con el total corregido si lo hay. */
export function openingBalanceFromSelection(
  options: PaymentMonthOption[],
  selection: Selection,
  overrideCents?: number | null,
): OpeningBalanceMonths | null {
  const span = openingSpan(options, selection)
  if (!span) return null
  const sum = spanAmounts(options, span).reduce((total, a) => total + a, 0)
  return { fromPeriod: options[span.from].period, toPeriod: options[span.to].period, amountCents: overrideCents ?? sum }
}

/**
 * Pozo de plata ya pagada que balance forward tiene para repartir: lo que la
 * RPC dejó cubierto en cualquier celda de la ventana más el saldo a favor que
 * todavía no cayó en ninguna celda proyectada.
 */
function paidPoolCents(options: PaymentMonthOption[], creditCents: number): number {
  let covered = 0
  let projectedCovered = 0
  for (const o of options) {
    if (o.kind === 'pre_system') continue
    covered += o.coveredCents
    if (o.kind === 'projected') projectedCovered += o.coveredCents
  }
  return covered + Math.max(0, creditCents - projectedCovered)
}

/**
 * Las opciones tal como van a quedar DESPUÉS de crear el saldo anterior de la
 * selección: el saldo es el cargo más viejo, así que balance forward le da
 * primero todo el pozo ya pagado (mes por mes, del más viejo al más nuevo) y
 * recién después reparte lo que sobre entre los meses del sistema. Un mes que
 * la RPC mostraba cubierto puede perder cobertura y volver a ser elegible.
 * Mismo largo y mismo orden que `options`: los índices valen en las dos. Las
 * celdas previas fuera de F..P no cambian. Sin tramo devuelve `options` tal cual.
 */
export function effectiveOptions(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): PaymentMonthOption[] {
  const span = openingSpan(options, selection)
  if (!span) return options
  const amounts = spanAmounts(options, span, ctx.openingBalanceOverrideCents)
  let remaining = paidPoolCents(options, ctx.creditCents)
  return options.map((o, i) => {
    const inSpan = i >= span.from && i <= span.to
    if (o.kind === 'pre_system' && !inSpan) return o
    const amount = inSpan ? amounts[i - span.from] : o.amountCents
    const covered = Math.min(amount, remaining)
    remaining -= covered
    return { ...o, amountCents: amount, coveredCents: covered, pendingCents: amount - covered }
  })
}

/** Las opciones que hay que mirar para la selección actual (las efectivas si hay tramo, si no las de la RPC). */
export function optionsForSelection(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): PaymentMonthOption[] {
  return effectiveOptions(options, selection, ctx)
}

/**
 * Lo que hay que cobrar por lo marcado: Σ pendiente de las celdas marcadas de
 * las opciones efectivas (el saldo anterior consume el saldo a favor antes que
 * nada). Recibe las opciones de la RPC, no las efectivas.
 */
export function derivedAmountCents(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): number {
  const eff = effectiveOptions(options, selection, ctx)
  return selectedOptions(eff, selection).reduce((total, o) => total + o.pendingCents, 0)
}

/**
 * Qué cubre un monto cualquiera ("Otro monto"): las celdas efectivas en orden
 * desde F (o desde el primer mes del sistema), marcadas o no, porque balance
 * forward sigue más allá de lo elegido. Las previas solo entran dentro de F..P.
 */
export function coverageForAmount(
  rawOptions: PaymentMonthOption[],
  selection: Selection,
  amountCents: number,
  ctx: AmountContext,
): CoverageResult {
  // Recibe las opciones de la RPC; los índices devueltos valen también para las efectivas.
  const options = effectiveOptions(rawOptions, selection, ctx)
  const span = openingSpan(rawOptions, selection)
  const start = span ? span.from : firstSystemIndex(options)
  let pool = Math.max(0, amountCents)
  const fullyCovered: number[] = []
  let partial: CoverageResult['partial'] = null
  if (start === -1) return { fullyCovered, partial, leftoverCents: pool }

  for (let i = start; i < options.length; i++) {
    const o = options[i]
    if (o.kind === 'pre_system' && !(span && i <= span.to)) continue
    if (!isSelectable(o)) continue
    if (pool <= 0) break
    if (o.pendingCents <= pool) {
      pool -= o.pendingCents
      fullyCovered.push(i)
    } else {
      partial = { index: i, cents: pool }
      pool = 0
      break
    }
  }

  return { fullyCovered, partial, leftoverCents: pool }
}

/**
 * Papel de una celda previa con tramo: `marked` entra en el pago; `owed` está
 * dentro de F..P, no se marca y queda adeudada. `null` fuera del tramo o si ya
 * no debe nada. Recibe las opciones efectivas.
 */
export function preCellRole(options: PaymentMonthOption[], selection: Selection, index: number): 'marked' | 'owed' | null {
  const span = openingSpan(options, selection)
  const o = options[index]
  if (!span || !o || o.kind !== 'pre_system' || index < span.from || index > span.to) return null
  if (!isSelectable(o)) return null
  return selection && index <= selection.endIndex ? 'marked' : 'owed'
}

/**
 * Lo que sigue adeudado después del pago (opciones efectivas de la misma
 * selección): las celdas no marcadas que son deuda. Los adelantos no cuentan;
 * el mes actual proyectado sí.
 */
export function debtAfterPayment(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): { months: number; cents: number } {
  const eff = effectiveOptions(options, selection, ctx)
  const span = openingSpan(options, selection)
  const marked = new Set(selectedIndexes(eff, selection))
  let months = 0
  let cents = 0
  eff.forEach((o, i) => {
    if (marked.has(i) || o.pendingCents <= 0) return
    const isDebt =
      o.kind === 'opening_balance' ||
      o.kind === 'monthly' ||
      (o.kind === 'pre_system' && span !== null && i >= span.from && i <= span.to) ||
      (o.kind === 'projected' && o.isCurrent)
    if (!isDebt) return
    months += 1
    cents += o.pendingCents
  })
  return { months, cents }
}

/** Alcance del saldo anterior que crea la selección (F..P), para rotular el total corregible. */
export type OpeningScope = {
  /** Primer mes previo marcado: "desde cuándo debía". */
  fromPeriod: ISODate
  /** Meses de F a P. */
  months: number
  /** Total de F..P con el valor de cada celda (sin corregir a mano). */
  sumCents: number
  /** false en la ficha: ahí no hay pago, solo la deuda. */
  payment: boolean
  paidMonths: number
  paidCents: number
  owedMonths: number
  owedCents: number
}

/** `null` si la selección no arranca en una celda previa. Recibe las opciones de la RPC. */
export function openingScope(
  options: PaymentMonthOption[],
  selection: Selection,
  ctx: AmountContext,
  opts: { payment: boolean },
): OpeningScope | null {
  const span = openingSpan(options, selection)
  if (!span) return null
  const eff = effectiveOptions(options, selection, ctx)
  const scope: OpeningScope = {
    fromPeriod: options[span.from].period,
    months: span.to - span.from + 1,
    sumCents: spanAmounts(options, span).reduce((total, a) => total + a, 0),
    payment: opts.payment,
    paidMonths: 0,
    paidCents: 0,
    owedMonths: 0,
    owedCents: 0,
  }
  for (let i = span.from; i <= span.to; i++) {
    const role = preCellRole(eff, selection, i)
    if (role === 'marked') {
      scope.paidMonths += 1
      scope.paidCents += eff[i].amountCents
    } else if (role === 'owed') {
      scope.owedMonths += 1
      scope.owedCents += eff[i].pendingCents
    }
  }
  return scope
}

export type SelectionSummary = {
  monthsCount: number
  /** "agosto a octubre", "saldo anterior" o "saldo anterior y agosto a octubre". Vacío si no hay nada marcado. */
  rangeLabel: string
  hasOpeningBalance: boolean
}

export function selectionSummary(options: PaymentMonthOption[], selection: Selection): SelectionSummary {
  const picked = selectedOptions(options, selection)
  const months = picked.filter((o) => !isLegacyOpening(o))
  const hasOpeningBalance = picked.some(isLegacyOpening)
  const range = months.length > 0 ? periodRangeLabel(months[0].period, months[months.length - 1].period) : ''
  let rangeLabel = range
  if (hasOpeningBalance) rangeLabel = range ? `saldo anterior y ${range}` : 'saldo anterior'
  return { monthsCount: months.length, rangeLabel, hasOpeningBalance }
}

/** "3 meses · agosto a octubre" / "1 mes · octubre". */
export function summaryText(summary: SelectionSummary): string {
  if (summary.monthsCount === 0) return summary.rangeLabel
  const count = summary.monthsCount === 1 ? '1 mes' : `${summary.monthsCount} meses`
  return `${count} · ${summary.rangeLabel}`
}

function shortWithYear(period: ISODate, withYear: boolean): string {
  return withYear ? `${shortMonth(period)} ${period.slice(2, 4)}` : shortMonth(period)
}

/** Para el momento de éxito: "ago–oct", "oct", "nov 25–feb 26". Vacío si no hay meses marcados. */
export function coverLabel(options: PaymentMonthOption[], selection: Selection): string {
  const months = selectedOptions(options, selection).filter((o) => !isLegacyOpening(o))
  if (months.length === 0) return ''
  const first = months[0].period
  const last = months[months.length - 1].period
  if (first === last) return shortMonth(first)
  const sameYear = first.slice(0, 4) === last.slice(0, 4)
  return `${shortWithYear(first, !sameYear)}–${shortWithYear(last, !sameYear)}`
}
