/**
 * Lógica pura de la grilla de meses del formulario de pago (pipeline
 * 2026-10-29-imputacion-libre-meses, 00-architecture §6 y §11). Sin React, sin
 * fetch, sin `Date`: la usan `MonthStrip`, los formularios de pago y la ficha, y
 * la prueba `test-engineer` sin DOM.
 *
 * Idea central: la selección es un CONJUNTO de meses sueltos (pagar mayo y julio
 * deja junio adeudado), no un rango. Tocar alterna; arrastrar pinta.
 *
 * Convención: todas las funciones reciben las opciones de la RPC (`options`,
 * "crudas") y la selección; las que dependen de lo que pasa al crear el saldo
 * anterior (crédito, total corregido) calculan las opciones efectivas adentro
 * con `effectiveOptions`. Los índices valen igual en las dos (mismo largo y
 * orden). `MonthStrip` recibe las efectivas para dibujar: por eso existe
 * `advancesAllowedOn`, que NO vuelve a aplicar el crédito.
 *
 * Carga inicial (§6.3): el primer mes previo marcado F es "desde cuándo debía"
 * (o el alta, si es anterior y entra en la ventana); el saldo anterior abarca
 * `[from, to]` pero el PAGO cubre solo lo marcado. Lo demás queda adeudado.
 */

import { periodListLabel } from '@/lib/dates'
import { shortMonth } from '@/views/shared/chart-format'
import type { MemberStatus, OpeningMonth, PaymentMonthOption } from '@/models/types'

export type CellTone = 'pre_system' | 'due' | 'partial' | 'paid' | 'covered' | 'current' | 'advance'

/** Índices MARCADOS sobre el array COMPLETO de opciones: ascendente, sin repetidos. Vacío = nada marcado. */
export type Selection = number[]

export type AmountContext = { openingBalanceOverrideCents?: number | null; creditCents: number }

export type PaintOptions = { preSystemOpen: boolean; ctx?: AmountContext }

const NO_CREDIT: AmountContext = { creditCents: 0 }

function sortedUnique(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

export function isMarked(selection: Selection, index: number): boolean {
  return selection.includes(index)
}

export function isSelectable(o: PaymentMonthOption): boolean {
  return o.pendingCents > 0
}

export function cellTone(o: PaymentMonthOption): CellTone {
  // Sin nada pendiente: una cuota paga, o un adelanto / un mes previo que el saldo a favor ya cubre.
  if (o.pendingCents <= 0) return o.kind === 'projected' || o.kind === 'pre_system' ? 'covered' : 'paid'
  if (o.kind === 'pre_system') return 'pre_system'
  if (o.coveredCents > 0 && o.coveredCents < o.amountCents) return 'partial'
  if (o.kind === 'projected') return o.isCurrent ? 'current' : 'advance'
  return o.isCurrent ? 'current' : 'due'
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
 * sistema": la RPC lo marca con `isCurrent` en una celda `pre_system`.
 */
export function isBeforeStart(options: PaymentMonthOption[]): boolean {
  return options.some((o) => o.kind === 'pre_system' && o.isCurrent)
}

function currentPreSystemIndex(options: PaymentMonthOption[]): number {
  return options.findIndex((o) => o.kind === 'pre_system' && o.isCurrent)
}

// -----------------------------------------------------------------------------
// El tramo del saldo anterior
// -----------------------------------------------------------------------------

/** Índice de la primera celda previa que NO es anterior al alta (`-1` si no hay previas). */
export function firstJoinedIndex(options: PaymentMonthOption[]): number {
  return options.findIndex((o) => o.kind === 'pre_system' && !o.beforeJoined)
}

type Span = { from: number; to: number }

/**
 * El tramo `[from, to]` de meses previos que crea la selección. `null` sin
 * ningún previo marcado. `from` = el primer previo marcado, o el primero que no
 * es anterior al alta si queda antes (la deuda corre desde el alta); `to` = el
 * último previo (antes del inicio: el mes actual).
 */
export function openingSpan(options: PaymentMonthOption[], selection: Selection): Span | null {
  let first = -1
  for (const i of selection) {
    if (options[i]?.kind === 'pre_system' && (first === -1 || i < first)) first = i
  }
  if (first === -1) return null
  const joined = firstJoinedIndex(options)
  const from = joined !== -1 ? Math.min(first, joined) : first
  const to = lastPreSystemIndex(options)
  return to >= from ? { from, to } : null
}

/** Hay un previo marcado anterior a la fecha de alta: la UI avisa (no bloquea). */
export function beforeJoinedWarning(options: PaymentMonthOption[], selection: Selection): boolean {
  return selection.some((i) => options[i]?.kind === 'pre_system' && options[i].beforeJoined)
}

/** Índices de las celdas `pre_system` del tramo (puede haber meses con saldo ya cargado en el medio). */
function spanIndexes(options: PaymentMonthOption[], span: Span): number[] {
  const out: number[] = []
  for (let i = span.from; i <= span.to; i++) {
    if (options[i]?.kind === 'pre_system') out.push(i)
  }
  return out
}

/**
 * Partes enteras de un total entre `months` meses: el último absorbe el resto.
 * Espejo exacto del reparto de la base (un test de DB lo compara).
 */
export function splitOpeningTotal(totalCents: number, months: number): number[] {
  if (months <= 0) return []
  const base = Math.floor(totalCents / months)
  const parts = Array.from({ length: months }, () => base)
  parts[months - 1] = totalCents - (months - 1) * base
  return parts
}

function spanAmounts(options: PaymentMonthOption[], indexes: number[], overrideCents?: number | null): number[] {
  if (overrideCents != null) return splitOpeningTotal(overrideCents, indexes.length)
  return indexes.map((i) => options[i].amountCents)
}

/**
 * Los meses de saldo anterior que hay que crear: todas las celdas previas de
 * `[from, to]` con su monto (el precio, o el reparto del total corregido).
 * Incluye las NO marcadas: quedan debiendo. Vacío sin previos marcados.
 */
export function openingMonthsFromSelection(options: PaymentMonthOption[], selection: Selection, overrideCents?: number | null): OpeningMonth[] {
  const span = openingSpan(options, selection)
  if (!span) return []
  const indexes = spanIndexes(options, span)
  const amounts = spanAmounts(options, indexes, overrideCents)
  return indexes.map((i, k) => ({ period: options[i].period, amountCents: amounts[k] }))
}

/**
 * Las opciones tal como van a quedar DESPUÉS de crear el saldo anterior: las
 * previas de `[from, to]` toman su parte del total y el saldo a favor las cubre
 * del más viejo al más nuevo (la base lo aplica así a las filas nuevas). Nada
 * más se mueve: por invariante, con crédito no hay cuota pendiente. Sin tramo
 * devuelve `options` tal cual.
 */
export function effectiveOptions(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): PaymentMonthOption[] {
  const span = openingSpan(options, selection)
  if (!span) return options
  const indexes = spanIndexes(options, span)
  const amounts = spanAmounts(options, indexes, ctx.openingBalanceOverrideCents)
  let credit = Math.max(0, ctx.creditCents)
  const replaced = new Map<number, PaymentMonthOption>()
  indexes.forEach((i, k) => {
    const amount = amounts[k]
    const covered = Math.min(amount, credit)
    credit -= covered
    replaced.set(i, { ...options[i], amountCents: amount, coveredCents: covered, pendingCents: amount - covered })
  })
  return options.map((o, i) => replaced.get(i) ?? o)
}

// -----------------------------------------------------------------------------
// Adelantos: solo cuando no queda nada adeudado sin marcar
// -----------------------------------------------------------------------------

function isChargedAt(o: PaymentMonthOption, index: number, span: Span | null): boolean {
  if (o.kind === 'monthly' || o.kind === 'opening_balance') return true
  return o.kind === 'pre_system' && span !== null && index >= span.from && index <= span.to
}

/** La celda lleva una cuota (existente o que se va a crear con el saldo anterior): no es un adelanto. */
export function isCharged(options: PaymentMonthOption[], selection: Selection, index: number): boolean {
  const o = options[index]
  return o ? isChargedAt(o, index, openingSpan(options, selection)) : false
}

/** Igual que `advancesAllowed` pero sobre opciones que YA son las efectivas (lo que dibuja `MonthStrip`). */
export function advancesAllowedOn(effective: PaymentMonthOption[], selection: Selection): boolean {
  const span = openingSpan(effective, selection)
  const marked = new Set(selection)
  return !effective.some((o, i) => isChargedAt(o, i, span) && isSelectable(o) && !marked.has(i))
}

/**
 * Regla de UI (§6.2.1): la base mandaría el dinero de un adelanto al mes
 * adeudado más viejo, así que la grilla no deja marcar adelantos mientras quede
 * un mes con cuota (previos del tramo incluidos) sin marcar.
 */
export function advancesAllowed(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext = NO_CREDIT): boolean {
  return advancesAllowedOn(effectiveOptions(options, selection, ctx), selection)
}

/** Si ya no se pueden marcar adelantos, los que estaban marcados salen de la selección. */
function normalize(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext = NO_CREDIT): Selection {
  const hasAdvance = selection.some((i) => options[i]?.kind === 'projected')
  if (!hasAdvance || advancesAllowed(options, selection, ctx)) return selection
  return selection.filter((i) => options[i]?.kind !== 'projected')
}

// -----------------------------------------------------------------------------
// Tocar y arrastrar
// -----------------------------------------------------------------------------

/**
 * Tocar alterna. No elegible → igual; previo con el pliegue cerrado → igual;
 * adelanto sin `advancesAllowed` → `blocked`. Desmarcar un mes con cargo con
 * adelantos marcados desmarca los adelantos. Un mes marcado siempre se puede
 * desmarcar, aunque el saldo a favor ya lo cubra.
 */
export function toggleCell(
  options: PaymentMonthOption[],
  selection: Selection,
  index: number,
  opts: PaintOptions,
): { selection: Selection; blocked?: 'advance' } {
  const cell = options[index]
  if (!cell) return { selection }
  if (cell.kind === 'pre_system' && !opts.preSystemOpen) return { selection }
  if (selection.includes(index)) return { selection: normalize(options, selection.filter((i) => i !== index), opts.ctx) }
  if (!isSelectable(cell)) return { selection }
  if (cell.kind === 'projected' && !advancesAllowed(options, selection, opts.ctx)) return { selection, blocked: 'advance' }
  return { selection: normalize(options, sortedUnique([...selection, index]), opts.ctx) }
}

/**
 * Arrastre del ancla `anchor` hasta `over` (en cualquier sentido) sobre la
 * selección `base` que había al empezar. La celda de partida decide: sin marcar
 * → marca; marcada → desmarca. Solo toca `[min, max]`, solo celdas elegibles, los
 * previos solo con el pliegue abierto y los adelantos solo si al terminar
 * `advancesAllowed`.
 */
export function paintRange(options: PaymentMonthOption[], base: Selection, anchor: number, over: number, opts: PaintOptions): Selection {
  const lo = Math.min(anchor, over)
  const hi = Math.max(anchor, over)
  const unmark = base.includes(anchor)
  const next = new Set(base)
  const advances: number[] = []
  for (let i = lo; i <= hi; i++) {
    const cell = options[i]
    if (!cell) continue
    if (cell.kind === 'pre_system' && !opts.preSystemOpen) continue
    if (unmark) {
      next.delete(i)
      continue
    }
    if (!isSelectable(cell)) continue
    if (cell.kind === 'projected') advances.push(i)
    else next.add(i)
  }
  if (!unmark && advances.length > 0 && advancesAllowed(options, sortedUnique(next), opts.ctx)) {
    for (const i of advances) next.add(i)
  }
  return normalize(options, sortedUnique(next), opts.ctx)
}

/** Cerrar el pliegue de meses previos: salen de la selección (y con ellos, el total corregido). */
export function unmarkPreSystem(options: PaymentMonthOption[], selection: Selection, ctx?: AmountContext): Selection {
  return normalize(
    options,
    selection.filter((i) => options[i]?.kind !== 'pre_system'),
    ctx,
  )
}

/**
 * Selección inicial: activo → el mes adeudado más viejo con cuota (sin previos) o
 * nada; de baja → toda la deuda con cuota; antes del inicio → el mes actual.
 */
export function defaultSelection(options: PaymentMonthOption[], memberStatus: MemberStatus): Selection {
  if (isBeforeStart(options)) {
    const current = currentPreSystemIndex(options)
    if (isSelectable(options[current])) return [current]
  }
  const charged: number[] = []
  options.forEach((o, i) => {
    if ((o.kind === 'monthly' || o.kind === 'opening_balance') && isSelectable(o)) charged.push(i)
  })
  if (charged.length === 0) return []
  return memberStatus === 'active' ? [charged[0]] : charged
}

export function selectedOptions(options: PaymentMonthOption[], selection: Selection): PaymentMonthOption[] {
  return selection.map((i) => options[i]).filter((o): o is PaymentMonthOption => Boolean(o))
}

// -----------------------------------------------------------------------------
// Qué se manda y cuánto
// -----------------------------------------------------------------------------

/**
 * Los períodos que se mandan como `markedPeriods`: lo marcado que lleva cuota
 * (mensual, saldo anterior, o previo dentro del tramo). Los adelantos NO van:
 * son crédito. Ascendente.
 */
export function markedPeriodsFromSelection(options: PaymentMonthOption[], selection: Selection) {
  const span = openingSpan(options, selection)
  return selection.filter((i) => options[i] && isChargedAt(options[i], i, span)).map((i) => options[i].period)
}

/**
 * Lo que hay que cobrar por lo marcado: Σ pendiente efectivo (los previos
 * toman su parte y el crédito; los adelantos, su precio).
 */
export function derivedAmountCents(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext): number {
  const eff = effectiveOptions(options, selection, ctx)
  return selectedOptions(eff, selection).reduce((total, o) => total + o.pendingCents, 0)
}

export type CoverageEntry = { index: number; cents: number }

export type CoverageResult = {
  /** Marcados con cargo cubiertos del todo, en orden. */
  marked: CoverageEntry[]
  /** El último marcado, si el monto no alcanza para completarlo. */
  partial: CoverageEntry | null
  /** No marcados con cargo que absorbe el remanente (el último puede ser parcial: `cents` < pendiente). */
  unmarked: CoverageEntry[]
  /** Adelantos (marcados o no) que cubre lo que sobra después de toda la deuda. */
  advances: CoverageEntry[]
  leftoverCents: number
}

/**
 * Qué cubre un monto cualquiera ("Otro monto"), la misma regla que aplica la
 * base (§6.2.1): los marcados con cargo en orden hasta donde alcanza (el último
 * puede quedar parcial) → el remanente a los no marcados con cargo, del más
 * viejo al más nuevo → después los adelantos → lo que sobra es saldo a favor.
 */
export function coverageForAmount(options: PaymentMonthOption[], selection: Selection, amountCents: number, ctx: AmountContext): CoverageResult {
  const eff = effectiveOptions(options, selection, ctx)
  const span = openingSpan(options, selection)
  const marked = new Set(selection)
  let pool = Math.max(0, amountCents)
  const result: CoverageResult = { marked: [], partial: null, unmarked: [], advances: [], leftoverCents: 0 }

  const take = (index: number): CoverageEntry | null => {
    const pending = eff[index].pendingCents
    if (pool <= 0) return null
    const cents = Math.min(pool, pending)
    pool -= cents
    return { index, cents }
  }

  for (let i = 0; i < eff.length; i++) {
    if (!marked.has(i) || !isChargedAt(eff[i], i, span) || !isSelectable(eff[i])) continue
    const entry = take(i)
    if (!entry) break
    if (entry.cents < eff[i].pendingCents) result.partial = entry
    else result.marked.push(entry)
  }
  for (let i = 0; i < eff.length && pool > 0; i++) {
    if (marked.has(i) || !isChargedAt(eff[i], i, span) || !isSelectable(eff[i])) continue
    const entry = take(i)
    if (entry) result.unmarked.push(entry)
  }
  for (let i = 0; i < eff.length && pool > 0; i++) {
    if (eff[i].kind !== 'projected' || !isSelectable(eff[i])) continue
    const entry = take(i)
    if (entry) result.advances.push(entry)
  }
  result.leftoverCents = pool
  return result
}

/**
 * Lo que sigue adeudado después del pago: cuotas (previos del tramo incluidos,
 * adelantos no) que el pago no cubre. En modo meses lo marcado queda pago; con
 * `otherAmountCents` ("Otro monto") sale de `coverageForAmount`.
 */
export function debtAfterPayment(
  options: PaymentMonthOption[],
  selection: Selection,
  ctx: AmountContext,
  otherAmountCents?: number | null,
): { months: number; cents: number } {
  const eff = effectiveOptions(options, selection, ctx)
  const span = openingSpan(options, selection)
  const marked = new Set(selection)
  const covered = new Map<number, number>()
  if (otherAmountCents != null) {
    const coverage = coverageForAmount(options, selection, otherAmountCents, ctx)
    for (const e of [...coverage.marked, ...(coverage.partial ? [coverage.partial] : []), ...coverage.unmarked]) covered.set(e.index, e.cents)
  }
  let months = 0
  let cents = 0
  eff.forEach((o, i) => {
    if (!isChargedAt(o, i, span) || !isSelectable(o)) return
    const paid = otherAmountCents != null ? (covered.get(i) ?? 0) : marked.has(i) ? o.pendingCents : 0
    const left = o.pendingCents - paid
    if (left <= 0) return
    months += 1
    cents += left
  })
  return { months, cents }
}

/**
 * Papel de una celda previa del tramo: `marked` entra en el pago; `owed` está
 * dentro de `[from, to]`, no se marca y queda adeudada. `null` fuera del tramo.
 * Recibe las opciones efectivas.
 */
export function preCellRole(options: PaymentMonthOption[], selection: Selection, index: number): 'marked' | 'owed' | null {
  const span = openingSpan(options, selection)
  const o = options[index]
  if (!span || !o || o.kind !== 'pre_system' || index < span.from || index > span.to) return null
  if (selection.includes(index)) return 'marked'
  return isSelectable(o) ? 'owed' : null
}

/** Alcance del saldo anterior que crea la selección (`[from, to]`), para rotular el total corregible. */
export type OpeningScope = {
  /** Primer mes del tramo: "desde cuándo debía". */
  fromPeriod: string
  /** Meses que se crean. */
  months: number
  /** Total del tramo con el valor de cada celda (sin corregir a mano). */
  sumCents: number
  /** false en la ficha: ahí no hay pago, solo la deuda. */
  payment: boolean
  paidMonths: number
  paidCents: number
  owedMonths: number
  owedCents: number
}

/** `null` sin previos marcados. Recibe las opciones de la RPC. */
export function openingScope(options: PaymentMonthOption[], selection: Selection, ctx: AmountContext, opts: { payment: boolean }): OpeningScope | null {
  const span = openingSpan(options, selection)
  if (!span) return null
  const indexes = spanIndexes(options, span)
  const eff = effectiveOptions(options, selection, ctx)
  const scope: OpeningScope = {
    fromPeriod: options[indexes[0]].period,
    months: indexes.length,
    sumCents: indexes.reduce((total, i) => total + options[i].amountCents, 0),
    payment: opts.payment,
    paidMonths: 0,
    paidCents: 0,
    owedMonths: 0,
    owedCents: 0,
  }
  for (const i of indexes) {
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

// -----------------------------------------------------------------------------
// Rótulos
// -----------------------------------------------------------------------------

export type SelectionSummary = {
  monthsCount: number
  /** "mayo, julio y septiembre 2026" / "mayo a julio 2026". Vacío si no hay nada marcado. */
  rangeLabel: string
  /** Hay meses previos marcados (se carga saldo anterior). */
  hasOpeningMonths: boolean
}

export function selectionSummary(options: PaymentMonthOption[], selection: Selection): SelectionSummary {
  const picked = selectedOptions(options, selection)
  return {
    monthsCount: picked.length,
    rangeLabel: periodListLabel(picked.map((o) => o.period)),
    hasOpeningMonths: picked.some((o) => o.kind === 'pre_system'),
  }
}

/** "3 meses · mayo, julio y septiembre 2026" / "1 mes · octubre 2026". */
export function summaryText(summary: SelectionSummary): string {
  if (summary.monthsCount === 0) return summary.rangeLabel
  const count = summary.monthsCount === 1 ? '1 mes' : `${summary.monthsCount} meses`
  return `${count} · ${summary.rangeLabel}`
}

/**
 * Para el momento de éxito: "may, jul y sept", "may–jul" si son contiguos,
 * "nov 25, feb 26" si cruza de año. Vacío si no hay meses marcados.
 */
export function coverLabel(options: PaymentMonthOption[], selection: Selection): string {
  const periods = [...new Set(selectedOptions(options, selection).map((o) => o.period.slice(0, 7)))].sort()
  if (periods.length === 0) return ''
  const monthIndex = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7))
  const crossesYears = periods[0].slice(0, 4) !== periods[periods.length - 1].slice(0, 4)
  const label = (p: string) => (crossesYears ? `${shortMonth(`${p}-01`)} ${p.slice(2, 4)}` : shortMonth(`${p}-01`))
  if (periods.length === 1) return label(periods[0])
  const contiguous = periods.every((p, i) => i === 0 || monthIndex(p) === monthIndex(periods[i - 1]) + 1)
  if (contiguous) return `${label(periods[0])}–${label(periods[periods.length - 1])}`
  const names = periods.map(label)
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}
