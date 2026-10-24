/**
 * Lógica pura de la tira de meses del formulario de pago (00-architecture §10).
 * Sin React, sin fetch, sin `Date`: lo consumen `MonthStrip`, los formularios
 * de pago y la ficha (F2), y lo prueba `test-engineer` sin DOM.
 *
 * Idea central: balance forward. Los meses se cubren en orden, del más viejo
 * al más nuevo; nadie elige meses sueltos. La selección es un RANGO que
 * siempre termina donde se tocó, y arranca en el primer mes sin pagar (o en
 * el primer mes "antes del sistema" si el pliegue está abierto).
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

export function cellTone(o: PaymentMonthOption): CellTone {
  if (o.kind === 'pre_system') return 'pre_system'
  if (o.pendingCents <= 0) return o.kind === 'projected' ? 'covered' : 'paid'
  if (o.kind === 'opening_balance') return 'opening_balance'
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

export function tapCell(
  options: PaymentMonthOption[],
  selection: Selection,
  index: number,
  opts: { preSystemOpen: boolean },
): Selection {
  const cell = options[index]
  if (!cell || !isSelectable(cell)) return selection

  if (cell.kind === 'pre_system') {
    // Con el pliegue cerrado esas celdas no se ven: tocarlas no puede ocurrir.
    if (!opts.preSystemOpen) return selection
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
 * Cuando la selección arranca en "antes del sistema", el saldo anterior se come
 * el pozo pagado y las cuotas mensuales que parecían cubiertas pasan a deberse
 * (brief: "tocar julio marca julio–septiembre, y octubre si lo debe"). Extiende
 * el final como mínimo hasta la última cuota mensual que quedó elegible en las
 * opciones efectivas. Recibe las opciones de la RPC.
 */
export function extendToDueMonths(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): Selection {
  if (!selection || options[selection.startIndex]?.kind !== 'pre_system') return selection
  const eff = optionsForSelection(options, selection, ctx)
  let end = selection.endIndex
  for (let i = eff.length - 1; i > end; i--) {
    if (eff[i].kind === 'monthly' && isSelectable(eff[i])) {
      end = i
      break
    }
  }
  return { startIndex: selection.startIndex, endIndex: end }
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

export function openingBalanceFromSelection(
  options: PaymentMonthOption[],
  selection: Selection,
  overrideCents?: number | null,
): OpeningBalanceMonths | null {
  const pre = selectedOptions(options, selection).filter((o) => o.kind === 'pre_system')
  if (pre.length === 0) return null
  const sum = pre.reduce((total, o) => total + o.amountCents, 0)
  return { fromPeriod: pre[0].period, toPeriod: pre[pre.length - 1].period, amountCents: overrideCents ?? sum }
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
 * Las opciones tal como van a quedar DESPUÉS de crear un saldo anterior de
 * `openingAmountCents`: el saldo es el cargo más viejo, así que balance forward
 * le da primero todo el pozo ya pagado y recién después reparte lo que sobre
 * entre los meses en orden. Un mes que la RPC mostraba cubierto (por pagos o
 * por saldo a favor) puede perder cobertura y volver a ser elegible. Mismo
 * largo y mismo orden que `options`: los índices de la selección valen en las
 * dos. Las celdas `pre_system` no cambian. Sin saldo anterior devuelve
 * `options` tal cual.
 */
export function effectiveOptions(
  options: PaymentMonthOption[],
  openingAmountCents: number | null,
  creditCents: number,
): PaymentMonthOption[] {
  if (openingAmountCents === null) return options
  let remaining = Math.max(0, paidPoolCents(options, creditCents) - openingAmountCents)
  return options.map((o) => {
    if (o.kind === 'pre_system') return o
    const covered = Math.min(o.amountCents, remaining)
    remaining -= covered
    return { ...o, coveredCents: covered, pendingCents: o.amountCents - covered }
  })
}

/** Las opciones que hay que mirar para la selección actual: las efectivas si incluye meses previos, si no las de la RPC. */
export function optionsForSelection(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): PaymentMonthOption[] {
  const ob = openingBalanceFromSelection(options, selection, ctx.openingBalanceOverrideCents)
  return effectiveOptions(options, ob ? ob.amountCents : null, ctx.creditCents)
}

/** Lo que falta pagar del saldo anterior elegido tras usar el pozo ya pagado. */
function openingNetCents(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): number {
  const ob = openingBalanceFromSelection(options, selection, ctx.openingBalanceOverrideCents)
  return ob ? Math.max(0, ob.amountCents - paidPoolCents(options, ctx.creditCents)) : 0
}

/**
 * Lo que hay que cobrar por lo marcado. Con meses previos elegidos opera sobre
 * las opciones efectivas (el saldo anterior consume el saldo a favor antes que
 * nada, y los meses que parecían cubiertos dejan de estarlo): recibe las
 * opciones de la RPC, no las efectivas.
 */
export function derivedAmountCents(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): number {
  const eff = optionsForSelection(options, selection, ctx)
  const system = selectedOptions(eff, selection)
    .filter((o) => o.kind !== 'pre_system')
    .reduce((total, o) => total + o.pendingCents, 0)
  return openingNetCents(options, selection, ctx) + system
}

/**
 * Qué cubre un monto cualquiera ("Otro monto"): primero el saldo anterior
 * elegido, después las celdas del sistema en orden — también las que NO están
 * marcadas, porque balance forward sigue más allá de lo elegido.
 */
export function coverageForAmount(
  rawOptions: PaymentMonthOption[],
  selection: Selection,
  amountCents: number,
  ctx: AmountContext,
): CoverageResult {
  // Recibe las opciones de la RPC; los índices devueltos valen también para las efectivas.
  const options = optionsForSelection(rawOptions, selection, ctx)
  let pool = Math.max(0, amountCents)
  const fullyCovered: number[] = []
  let partial: CoverageResult['partial'] = null

  const preIdx = selectedIndexes(options, selection).filter((i) => options[i].kind === 'pre_system')
  let remainingNet = openingNetCents(rawOptions, selection, ctx)
  preIdx.forEach((i, n) => {
    const isLast = n === preIdx.length - 1
    const req = isLast ? remainingNet : Math.min(options[i].amountCents, remainingNet)
    remainingNet -= req
    if (partial) return
    if (req <= pool) {
      pool -= req
      fullyCovered.push(i)
    } else {
      partial = { index: i, cents: pool }
      pool = 0
    }
  })

  const first = firstSystemIndex(options)
  if (first !== -1 && !partial) {
    for (let i = first; i < options.length; i++) {
      const o = options[i]
      if (o.kind === 'pre_system' || !isSelectable(o)) continue
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
  }

  return { fullyCovered, partial, leftoverCents: pool }
}

export type SelectionSummary = {
  monthsCount: number
  /** "agosto a octubre", "saldo anterior" o "saldo anterior y agosto a octubre". Vacío si no hay nada marcado. */
  rangeLabel: string
  hasOpeningBalance: boolean
}

export function selectionSummary(options: PaymentMonthOption[], selection: Selection): SelectionSummary {
  const picked = selectedOptions(options, selection)
  const months = picked.filter((o) => o.kind !== 'opening_balance')
  const hasOpeningBalance = picked.some((o) => o.kind === 'opening_balance')
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
  const months = selectedOptions(options, selection).filter((o) => o.kind !== 'opening_balance')
  if (months.length === 0) return ''
  const first = months[0].period
  const last = months[months.length - 1].period
  if (first === last) return shortMonth(first)
  const sameYear = first.slice(0, 4) === last.slice(0, 4)
  return `${shortWithYear(first, !sameYear)}–${shortWithYear(last, !sameYear)}`
}
