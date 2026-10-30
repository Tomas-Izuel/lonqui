import { describe, expect, it } from 'vitest'
import {
  advancesAllowed,
  beforeJoinedWarning,
  cellTone,
  coverLabel,
  coverageForAmount,
  debtAfterPayment,
  defaultSelection,
  derivedAmountCents,
  effectiveOptions,
  firstJoinedIndex,
  firstSystemIndex,
  isBeforeStart,
  isCharged,
  isMarked,
  isSelectable,
  markedPeriodsFromSelection,
  openingMonthsFromSelection,
  openingScope,
  openingSpan,
  paintRange,
  preCellRole,
  selectedOptions,
  selectionSummary,
  splitOpeningTotal,
  summaryText,
  toggleCell,
  unmarkPreSystem,
  type Selection,
} from '@/views/payments/month-selection'
import type { PaymentMonthOption } from '@/models/types'

/**
 * Lógica pura de la grilla de meses (pipeline 2026-10-29-imputacion-libre-meses, F1 de T2).
 * Reescrita desde cero: la versión anterior probaba un RANGO (`{startIndex, endIndex}`, `tapCell`,
 * `dragSelect`, `openingBalanceFromSelection`, `isLegacyOpening`) y el usuario lo reemplazó por un
 * CONJUNTO de meses sueltos (`Selection = number[]`). Fixtures a mano, importes inventados.
 * P = $10.000 en centavos. Se testea contra el código real (T2 se desvió de 01-tasks en algunas firmas).
 */
const P = 1_000_000
const NO_CREDIT = { creditCents: 0 }

function opt(partial: Partial<PaymentMonthOption> & Pick<PaymentMonthOption, 'period' | 'kind'>): PaymentMonthOption {
  const amountCents = partial.amountCents ?? P
  const coveredCents = partial.coveredCents ?? 0
  return {
    memberId: 1,
    amountCents,
    coveredCents,
    pendingCents: partial.pendingCents ?? amountCents - coveredCents,
    isCurrent: false,
    pricedAtToday: true,
    beforeJoined: false,
    ...partial,
  }
}

/**
 * Socio activo debiendo de mayo a octubre, mes actual = octubre, adelantos nov y dic.
 *   0 may · 1 jun · 2 jul · 3 ago · 4 sep · 5 oct (actual) · 6 nov adelanto · 7 dic adelanto
 */
function monthsOwed(): PaymentMonthOption[] {
  return [
    opt({ period: '2026-05-01', kind: 'monthly' }),
    opt({ period: '2026-06-01', kind: 'monthly' }),
    opt({ period: '2026-07-01', kind: 'monthly' }),
    opt({ period: '2026-08-01', kind: 'monthly' }),
    opt({ period: '2026-09-01', kind: 'monthly' }),
    opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
    opt({ period: '2026-11-01', kind: 'projected' }),
    opt({ period: '2026-12-01', kind: 'projected' }),
  ]
}

/**
 * Carga inicial: facturación desde octubre (inicio), alta en agosto.
 *   0 jun pre (antes del alta) · 1 jul pre (antes del alta) · 2 ago pre · 3 sep pre · 4 oct (actual, mensual) · 5 nov adelanto · 6 dic adelanto
 */
function withPreSystem(): PaymentMonthOption[] {
  return [
    opt({ period: '2026-06-01', kind: 'pre_system', beforeJoined: true }),
    opt({ period: '2026-07-01', kind: 'pre_system', beforeJoined: true }),
    opt({ period: '2026-08-01', kind: 'pre_system' }),
    opt({ period: '2026-09-01', kind: 'pre_system' }),
    opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
    opt({ period: '2026-11-01', kind: 'projected' }),
    opt({ period: '2026-12-01', kind: 'projected' }),
  ]
}

const open = { preSystemOpen: true }
const closed = { preSystemOpen: false }

describe('celdas: elegibilidad y tono', () => {
  it('elegible = tiene pendiente; cellTone distingue pago, parcial, adeudado, actual, adelanto y cubierto', () => {
    expect(isSelectable(opt({ period: '2026-05-01', kind: 'monthly' }))).toBe(true)
    expect(isSelectable(opt({ period: '2026-05-01', kind: 'monthly', coveredCents: P }))).toBe(false)
    expect(cellTone(opt({ period: '2026-05-01', kind: 'monthly', coveredCents: P }))).toBe('paid')
    expect(cellTone(opt({ period: '2026-05-01', kind: 'opening_balance', coveredCents: P }))).toBe('paid')
    expect(cellTone(opt({ period: '2026-05-01', kind: 'monthly', coveredCents: 1 }))).toBe('partial')
    expect(cellTone(opt({ period: '2026-05-01', kind: 'monthly' }))).toBe('due')
    expect(cellTone(opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }))).toBe('current')
    expect(cellTone(opt({ period: '2026-11-01', kind: 'projected' }))).toBe('advance')
    expect(cellTone(opt({ period: '2026-11-01', kind: 'projected', coveredCents: P }))).toBe('covered')
    expect(cellTone(opt({ period: '2026-06-01', kind: 'pre_system' }))).toBe('pre_system')
    // un previo que el saldo a favor ya cubre (opciones efectivas) también es "cubierto"
    expect(cellTone(opt({ period: '2026-06-01', kind: 'pre_system', coveredCents: P }))).toBe('covered')
  })

  it('un opening_balance es una celda de un mes real: ya no hay un tono especial de "saldo viejo"', () => {
    expect(cellTone(opt({ period: '2026-03-01', kind: 'opening_balance' }))).toBe('due')
    expect(cellTone(opt({ period: '2026-03-01', kind: 'opening_balance', coveredCents: 1 }))).toBe('partial')
  })

  it('firstSystemIndex ignora los previos; isBeforeStart solo si el mes actual es pre_system', () => {
    expect(firstSystemIndex(withPreSystem())).toBe(4)
    expect(firstSystemIndex(monthsOwed())).toBe(0)
    expect(isBeforeStart(monthsOwed())).toBe(false)
    expect(isBeforeStart([opt({ period: '2026-10-01', kind: 'pre_system', isCurrent: true })])).toBe(true)
  })
})

describe('toggleCell: meses sueltos', () => {
  it('alterna: marca may y jul sin marcar jun; volver a tocar desmarca', () => {
    const o = monthsOwed()
    let s: Selection = []
    s = toggleCell(o, s, 0, closed).selection
    s = toggleCell(o, s, 2, closed).selection
    expect(s).toEqual([0, 2])
    expect(isMarked(s, 1)).toBe(false)
    s = toggleCell(o, s, 0, closed).selection
    expect(s).toEqual([2])
  })

  it('la selección queda ascendente y sin repetidos aunque se marque en desorden', () => {
    const o = monthsOwed()
    let s: Selection = []
    for (const i of [4, 1, 3, 1]) s = toggleCell(o, s, i, closed).selection
    expect(s).toEqual([3, 4])
  })

  it('una celda paga o cubierta no se marca; un índice fuera de rango tampoco rompe', () => {
    const o = monthsOwed()
    o[1] = opt({ period: '2026-06-01', kind: 'monthly', coveredCents: P })
    expect(toggleCell(o, [], 1, closed).selection).toEqual([])
    expect(toggleCell(o, [0], 99, closed).selection).toEqual([0])
  })

  it('un previo con el pliegue cerrado no se marca; abierto sí', () => {
    const o = withPreSystem()
    expect(toggleCell(o, [], 2, closed).selection).toEqual([])
    expect(toggleCell(o, [], 2, open).selection).toEqual([2])
  })

  it('un adelanto está bloqueado mientras haya un mes con cuota sin marcar, y se habilita al marcar el último', () => {
    const o = monthsOwed()
    const blocked = toggleCell(o, [0, 1, 2, 3, 4], 6, closed)
    expect(blocked).toEqual({ selection: [0, 1, 2, 3, 4], blocked: 'advance' }) // falta el actual (5)
    const ok = toggleCell(o, [0, 1, 2, 3, 4, 5], 6, closed)
    expect(ok.selection).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(ok.blocked).toBeUndefined()
  })

  it('desmarcar un mes con cuota desmarca los adelantos marcados (ya no hay nada que los justifique)', () => {
    const o = monthsOwed()
    const s = toggleCell(o, [0, 1, 2, 3, 4, 5, 6, 7], 3, closed).selection
    expect(s).toEqual([0, 1, 2, 4, 5])
  })

  it('un mes marcado siempre se puede desmarcar, aunque el saldo a favor ya lo cubra', () => {
    const o = monthsOwed()
    const covered = o.map((x, i) => (i === 2 ? { ...x, coveredCents: P, pendingCents: 0 } : x))
    expect(toggleCell(covered, [2], 2, closed).selection).toEqual([])
  })
})

describe('paintRange: arrastrar', () => {
  it('pinta de izquierda a derecha y de derecha a izquierda con el mismo resultado', () => {
    const o = monthsOwed()
    const forward = paintRange(o, [], 1, 3, closed)
    const backward = paintRange(o, [], 3, 1, closed)
    expect(forward).toEqual([1, 2, 3])
    expect(backward).toEqual([1, 2, 3])
  })

  it('con las no elegibles en el medio (un mes pago) las saltea y marca el resto del rango', () => {
    const o = monthsOwed()
    o[2] = opt({ period: '2026-07-01', kind: 'monthly', coveredCents: P })
    expect(paintRange(o, [], 0, 4, closed)).toEqual([0, 1, 3, 4])
    expect(paintRange(o, [], 4, 0, closed)).toEqual([0, 1, 3, 4])
  })

  it('si el ancla ya estaba marcada, el arrastre DESMARCA solo ese rango y no toca fuera', () => {
    const o = monthsOwed()
    expect(paintRange(o, [0, 1, 2, 3, 4], 2, 3, closed)).toEqual([0, 1, 4])
    expect(paintRange(o, [0, 1, 2, 3, 4], 3, 2, closed)).toEqual([0, 1, 4])
  })

  it('no toca lo que ya estaba marcado fuera del rango al marcar', () => {
    const o = monthsOwed()
    expect(paintRange(o, [0], 3, 4, closed)).toEqual([0, 3, 4])
  })

  it('arrastrar sin moverse (ancla = destino) equivale a marcar esa celda', () => {
    expect(paintRange(monthsOwed(), [], 2, 2, closed)).toEqual([2])
  })

  it('los previos solo con el pliegue abierto; los adelantos solo si al terminar queda todo lo adeudado marcado', () => {
    const o = withPreSystem()
    expect(paintRange(o, [], 0, 3, closed)).toEqual([]) // pliegue cerrado: nada de los previos
    expect(paintRange(o, [], 2, 3, open)).toEqual([2, 3])
    // el adelanto (5) no entra: falta marcar el mes actual (4) y los previos del tramo
    expect(paintRange(o, [], 5, 6, open)).toEqual([])
    // marcando todo el rango de las cuotas y los adelantos, entran los adelantos
    expect(paintRange(o, [], 2, 6, open)).toEqual([2, 3, 4, 5, 6])
  })
})

describe('advancesAllowed y cargo del tramo', () => {
  it('con previas del tramo sin marcar NO se habilitan adelantos', () => {
    const o = withPreSystem()
    // Marco ago (previo) y el mes actual; el tramo [ago, sep] tiene sep sin marcar → hay cuota sin marcar.
    expect(advancesAllowed(o, [2, 4], NO_CREDIT)).toBe(false)
    expect(advancesAllowed(o, [2, 3, 4], NO_CREDIT)).toBe(true)
  })

  it('isCharged: las mensuales y las de saldo siempre; un previo solo si cae en el tramo que crea la selección', () => {
    const o = withPreSystem()
    expect(isCharged(o, [], 4)).toBe(true)
    expect(isCharged(o, [], 5)).toBe(false)
    expect(isCharged(o, [], 2)).toBe(false) // previo sin tramo: todavía no es una cuota
    expect(isCharged(o, [3], 2)).toBe(true) // alta en ago: la deuda corre desde ago → ago entra al tramo
    expect(isCharged(o, [3], 0)).toBe(false) // antes del alta: fuera del tramo
  })

  it('sin adeudado alguno, los adelantos están permitidos', () => {
    const o = monthsOwed().map((x) => (x.kind === 'projected' ? x : { ...x, coveredCents: P, pendingCents: 0 }))
    expect(advancesAllowed(o, [], NO_CREDIT)).toBe(true)
  })
})

describe('tramo del saldo anterior: openingSpan y fecha de alta', () => {
  it('sin previos marcados no hay tramo', () => {
    expect(openingSpan(withPreSystem(), [])).toBeNull()
    expect(openingSpan(withPreSystem(), [4])).toBeNull()
  })

  it('from = el primer previo con alta (aunque se marque uno posterior); to = el último previo', () => {
    const o = withPreSystem()
    expect(firstJoinedIndex(o)).toBe(2)
    expect(openingSpan(o, [3])).toEqual({ from: 2, to: 3 })
    expect(openingSpan(o, [2])).toEqual({ from: 2, to: 3 })
  })

  it('marcar un previo ANTERIOR al alta arrastra el tramo hasta ahí y avisa; marcar uno posterior no avisa', () => {
    const o = withPreSystem()
    expect(openingSpan(o, [1])).toEqual({ from: 1, to: 3 })
    expect(beforeJoinedWarning(o, [1])).toBe(true)
    expect(beforeJoinedWarning(o, [2, 3])).toBe(false)
    expect(beforeJoinedWarning(o, [])).toBe(false)
  })

  it('con alta posterior a todos los previos (firstJoinedIndex = -1) from es el primer marcado', () => {
    const o = withPreSystem().map((x) => (x.kind === 'pre_system' ? { ...x, beforeJoined: true } : x))
    expect(firstJoinedIndex(o)).toBe(-1)
    expect(openingSpan(o, [1])).toEqual({ from: 1, to: 3 })
    expect(beforeJoinedWarning(o, [1])).toBe(true)
  })

  it('un mes del tramo que ya tiene saldo cargado (no es pre_system) no se vuelve a crear', () => {
    const o = withPreSystem()
    o[2] = opt({ period: '2026-08-01', kind: 'opening_balance', coveredCents: P })
    const months = openingMonthsFromSelection(o, [3])
    expect(months.map((m) => m.period)).toEqual(['2026-09-01'])
  })
})

describe('openingMonthsFromSelection', () => {
  it('incluye TODOS los previos del tramo, también los no marcados (quedan debiendo)', () => {
    const o = withPreSystem()
    expect(openingMonthsFromSelection(o, [2])).toEqual([
      { period: '2026-08-01', amountCents: P },
      { period: '2026-09-01', amountCents: P },
    ])
    expect(openingMonthsFromSelection(o, [1]).map((m) => m.period)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
  })

  it('sin previos marcados devuelve []', () => {
    expect(openingMonthsFromSelection(withPreSystem(), [])).toEqual([])
    expect(openingMonthsFromSelection(withPreSystem(), [4])).toEqual([])
  })

  it('con total corregido: Σ = total, las n−1 primeras iguales y el resto en la última', () => {
    const o = withPreSystem()
    const months = openingMonthsFromSelection(o, [1], 3_000_001)
    expect(months).toHaveLength(3)
    expect(months.reduce((a, m) => a + m.amountCents, 0)).toBe(3_000_001)
    expect(new Set(months.slice(0, 2).map((m) => m.amountCents)).size).toBe(1)
    expect(months[2].amountCents).toBe(1_000_001)
  })
})

describe('splitOpeningTotal', () => {
  it('conserva el total para totales y cantidades variadas; n <= 0 → []', () => {
    const totals = [1, 5, 999, 1_000_000, 3_333_333, 10_000_001, 8_555_555, 123_456_789, 0]
    for (const total of totals) {
      for (const n of [1, 2, 3, 7, 10, 36]) {
        const parts = splitOpeningTotal(total, n)
        expect(parts, `${total}/${n}`).toHaveLength(n)
        expect(parts.reduce((a, b) => a + b, 0), `${total}/${n}`).toBe(total)
        expect(parts.slice(0, -1).every((p) => p === parts[0]), `${total}/${n}`).toBe(true)
        expect(parts.every((p) => Number.isInteger(p))).toBe(true)
      }
    }
    expect(splitOpeningTotal(100, 0)).toEqual([])
    expect(splitOpeningTotal(100, -2)).toEqual([])
  })
})

describe('effectiveOptions: saldo anterior con crédito', () => {
  it('sin tramo devuelve las mismas opciones', () => {
    const o = monthsOwed()
    expect(effectiveOptions(o, [0, 1], { creditCents: 5 * P })).toBe(o)
  })

  it('crédito $20.000 y previas jul–sep marcadas: jul y ago cubiertas, sep pendiente; derivado $10.000; nada fuera del tramo cambia', () => {
    const o: PaymentMonthOption[] = [
      opt({ period: '2026-07-01', kind: 'pre_system' }),
      opt({ period: '2026-08-01', kind: 'pre_system' }),
      opt({ period: '2026-09-01', kind: 'pre_system' }),
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true, coveredCents: P }),
      opt({ period: '2026-11-01', kind: 'projected' }),
    ]
    const sel: Selection = [0, 1, 2]
    const eff = effectiveOptions(o, sel, { creditCents: 2 * P })
    expect(eff.map((x) => x.coveredCents)).toEqual([P, P, 0, P, 0])
    expect(eff.map((x) => x.pendingCents)).toEqual([0, 0, P, 0, P])
    expect(eff[3]).toEqual(o[3])
    expect(eff[4]).toEqual(o[4])
    expect(derivedAmountCents(o, sel, { creditCents: 2 * P })).toBe(P)
    // la base saltea los marcados ya cubiertos: se manda igual el set completo del tramo
    expect(markedPeriodsFromSelection(o, sel)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
  })

  it('conservación bajo effectiveOptions para 20 totales distintos: Σ monto del tramo = total, Σ cubierto = min(crédito, total), Σ pendiente = el resto', () => {
    const o = withPreSystem()
    const totals = [1, 2, 3, 99, 1_000, 999_999, 1_000_000, 1_000_001, 2_500_000, 2_999_999, 3_000_000, 3_000_001, 3_333_333, 4_999_999, 5_555_555, 7_777_777, 9_000_001, 10_000_000, 12_345_678, 99_999_999]
    expect(totals).toHaveLength(20)
    for (const total of totals) {
      for (const credit of [0, 500_000, 2_000_000, total, total + 1]) {
        const eff = effectiveOptions(o, [1], { openingBalanceOverrideCents: total, creditCents: credit })
        const span = eff.slice(1, 4) // jul, ago, sep
        const amount = span.reduce((a, x) => a + x.amountCents, 0)
        const covered = span.reduce((a, x) => a + x.coveredCents, 0)
        const pending = span.reduce((a, x) => a + x.pendingCents, 0)
        expect(amount, `total ${total}`).toBe(total)
        expect(covered, `total ${total} crédito ${credit}`).toBe(Math.min(total, credit))
        expect(pending, `total ${total} crédito ${credit}`).toBe(total - Math.min(total, credit))
        expect(span.every((x) => x.pendingCents === x.amountCents - x.coveredCents && x.pendingCents >= 0)).toBe(true)
      }
    }
  })

  it('un crédito negativo se trata como cero (no inventa deuda ni plata)', () => {
    const eff = effectiveOptions(withPreSystem(), [2], { creditCents: -5 })
    expect(eff.slice(2, 4).every((x) => x.coveredCents === 0)).toBe(true)
  })
})

describe('markedPeriodsFromSelection y derivedAmountCents', () => {
  it('nunca incluye adelantos; incluye mensuales y previos del tramo', () => {
    const o = monthsOwed()
    expect(markedPeriodsFromSelection(o, [0, 2, 5, 6, 7])).toEqual(['2026-05-01', '2026-07-01', '2026-10-01'])
    const p = withPreSystem()
    expect(markedPeriodsFromSelection(p, [3, 4, 5])).toEqual(['2026-09-01', '2026-10-01'])
  })

  it('Σ pendiente de los marcados (adelantos incluidos con su precio) = el monto derivado', () => {
    const o = monthsOwed()
    const sel: Selection = [0, 1, 2, 3, 4, 5, 6]
    const expected = selectedOptions(o, sel).reduce((a, x) => a + x.pendingCents, 0)
    expect(derivedAmountCents(o, sel, NO_CREDIT)).toBe(expected)
    expect(derivedAmountCents(o, sel, NO_CREDIT)).toBe(7 * P)
    expect(derivedAmountCents(o, [], NO_CREDIT)).toBe(0)
  })

  it('un mes parcial aporta solo lo que le falta', () => {
    const o = monthsOwed()
    o[5] = opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true, coveredCents: 400_000 })
    expect(derivedAmountCents(o, [5], NO_CREDIT)).toBe(600_000)
  })
})

describe('coverageForAmount ("Otro monto", la regla de la base)', () => {
  it('monto exacto a lo marcado: marcados completos, sin remanente', () => {
    const r = coverageForAmount(monthsOwed(), [0, 2], 2 * P, NO_CREDIT)
    expect(r.marked).toEqual([{ index: 0, cents: P }, { index: 2, cents: P }])
    expect(r.partial).toBeNull()
    expect(r.unmarked).toEqual([])
    expect(r.advances).toEqual([])
    expect(r.leftoverCents).toBe(0)
  })

  it('un peso menos: el último marcado queda parcial', () => {
    const r = coverageForAmount(monthsOwed(), [0, 2], 2 * P - 1, NO_CREDIT)
    expect(r.marked).toEqual([{ index: 0, cents: P }])
    expect(r.partial).toEqual({ index: 2, cents: P - 1 })
    expect(r.leftoverCents).toBe(0)
  })

  it('mayo y julio marcados con $25.000 debiendo may–nov: mayo y julio completos, junio "se cubre" $5.000', () => {
    const o = monthsOwed()
    const r = coverageForAmount(o, [0, 2], 2 * P + 500_000, NO_CREDIT)
    expect(r.marked).toEqual([{ index: 0, cents: P }, { index: 2, cents: P }])
    expect(r.unmarked).toEqual([{ index: 1, cents: 500_000 }])
    expect(r.leftoverCents).toBe(0)
  })

  it('más monto: después de lo marcado van los no marcados en orden, luego los adelantos y al final el saldo a favor', () => {
    const o = monthsOwed()
    // Todo lo adeudado son 6 cuotas; con 9 sobran 3: 2 adelantos y 1 de saldo a favor.
    const r = coverageForAmount(o, [5], 9 * P, NO_CREDIT)
    expect(r.marked).toEqual([{ index: 5, cents: P }])
    expect(r.unmarked.map((e) => e.index)).toEqual([0, 1, 2, 3, 4])
    expect(r.advances).toEqual([{ index: 6, cents: P }, { index: 7, cents: P }])
    expect(r.leftoverCents).toBe(P)
  })

  it('monto 0 o negativo no cubre nada', () => {
    const r = coverageForAmount(monthsOwed(), [0], -10, NO_CREDIT)
    expect(r).toEqual({ marked: [], partial: null, unmarked: [], advances: [], leftoverCents: 0 })
  })

  it('conservación: Σ de lo cubierto + remanente = el monto (para 20 montos)', () => {
    const o = monthsOwed()
    for (let k = 0; k < 20; k++) {
      const amount = Math.floor((k * 9_876_543) / 19)
      const r = coverageForAmount(o, [1, 3], amount, NO_CREDIT)
      const covered = [...r.marked, ...(r.partial ? [r.partial] : []), ...r.unmarked, ...r.advances].reduce((a, e) => a + e.cents, 0)
      expect(covered + r.leftoverCents, `monto ${amount}`).toBe(amount)
    }
  })
})

describe('debtAfterPayment', () => {
  it('mayo y julio marcados de mayo a noviembre: quedan 5 meses · $50.000', () => {
    const o = monthsOwed().slice(0, 7) // may..oct + nov adelanto → nov es adelanto, no cuenta
    // may..nov del ejemplo = 7 cuotas: se arma con nov mensual.
    const seven = [...o.slice(0, 6), opt({ period: '2026-11-01', kind: 'monthly' })]
    expect(debtAfterPayment(seven, [0, 2], NO_CREDIT)).toEqual({ months: 5, cents: 5 * P })
  })

  it('los adelantos nunca cuentan como deuda; con todo marcado no queda nada', () => {
    const o = monthsOwed()
    expect(debtAfterPayment(o, [0, 1, 2, 3, 4, 5], NO_CREDIT)).toEqual({ months: 0, cents: 0 })
  })

  it('con "Otro monto" el remanente cubre los no marcados del más viejo al más nuevo (el último, parcial)', () => {
    const o = monthsOwed()
    const r = debtAfterPayment(o, [0, 2], NO_CREDIT, 2 * P + 500_000)
    // may y jul completos, jun $5.000 de $10.000: quedan jun (mitad), ago, sep, oct = 4 meses y $35.000
    expect(r).toEqual({ months: 4, cents: 3_500_000 })
  })

  it('un previo del tramo sin marcar queda adeudado', () => {
    const o = withPreSystem()
    // marco solo sep (3) → el tramo es ago..sep (alta en ago): ago queda debiendo, oct también
    expect(debtAfterPayment(o, [3], NO_CREDIT)).toEqual({ months: 2, cents: 2 * P })
  })
})

describe('unmarkPreSystem y defaultSelection', () => {
  it('cerrar el pliegue saca los previos de la selección y deja el resto', () => {
    expect(unmarkPreSystem(withPreSystem(), [2, 3, 4], NO_CREDIT)).toEqual([4])
  })

  it('activo: el adeudado más viejo con cuota; de baja: toda la deuda con cuota; sin deuda: nada', () => {
    const o = monthsOwed()
    expect(defaultSelection(o, 'active')).toEqual([0])
    expect(defaultSelection(o, 'inactive')).toEqual([0, 1, 2, 3, 4, 5])
    const none = o.map((x) => (x.kind === 'projected' ? x : { ...x, coveredCents: P, pendingCents: 0 }))
    expect(defaultSelection(none, 'active')).toEqual([])
  })

  it('antes del inicio: el mes actual previo', () => {
    const o = [
      opt({ period: '2026-09-01', kind: 'pre_system' }),
      opt({ period: '2026-10-01', kind: 'pre_system', isCurrent: true }),
      opt({ period: '2026-11-01', kind: 'projected' }),
    ]
    expect(defaultSelection(o, 'active')).toEqual([1])
  })
})

describe('preCellRole y openingScope', () => {
  it('dentro del tramo: marcada → "marked", sin marcar → "owed"; fuera del tramo o no previa → null', () => {
    const o = withPreSystem()
    const sel: Selection = [2]
    const eff = effectiveOptions(o, sel, NO_CREDIT)
    expect(preCellRole(eff, sel, 2)).toBe('marked')
    expect(preCellRole(eff, sel, 3)).toBe('owed')
    expect(preCellRole(eff, sel, 1)).toBeNull() // antes del alta y fuera del tramo
    expect(preCellRole(eff, sel, 4)).toBeNull() // no es previa
  })

  it('openingScope: desde cuándo debía, cuántos meses, cuánto se paga y cuánto queda debiendo', () => {
    const o = withPreSystem()
    const scope = openingScope(o, [2], NO_CREDIT, { payment: true })
    expect(scope).toMatchObject({ fromPeriod: '2026-08-01', months: 2, sumCents: 2 * P, paidMonths: 1, paidCents: P, owedMonths: 1, owedCents: P, payment: true })
    expect(openingScope(o, [4], NO_CREDIT, { payment: true })).toBeNull()
  })
})

describe('rótulos', () => {
  it('selectionSummary y summaryText: sueltos "mayo, julio y septiembre 2026", contiguos "mayo a julio 2026"', () => {
    const o = monthsOwed()
    expect(summaryText(selectionSummary(o, [0, 2, 4]))).toBe('3 meses · mayo, julio y septiembre 2026')
    expect(summaryText(selectionSummary(o, [0, 1, 2]))).toBe('3 meses · mayo a julio 2026')
    expect(summaryText(selectionSummary(o, [5]))).toBe('1 mes · octubre 2026')
    expect(selectionSummary(o, [])).toEqual({ monthsCount: 0, rangeLabel: '', hasOpeningMonths: false })
    expect(summaryText(selectionSummary(o, []))).toBe('')
  })

  it('hasOpeningMonths solo si hay un previo marcado', () => {
    const o = withPreSystem()
    expect(selectionSummary(o, [2, 4]).hasOpeningMonths).toBe(true)
    expect(selectionSummary(o, [4]).hasOpeningMonths).toBe(false)
  })

  it('coverLabel: "may, jul y sept", contiguos con guion, cambio de año con el año', () => {
    const o = monthsOwed()
    expect(coverLabel(o, [0, 2, 4])).toMatch(/^may, jul y sep/)
    expect(coverLabel(o, [0, 1, 2])).toMatch(/^may–jul$/)
    expect(coverLabel(o, [5])).toMatch(/^oct/)
    expect(coverLabel(o, [])).toBe('')
    const across = [opt({ period: '2026-11-01', kind: 'monthly' }), opt({ period: '2027-02-01', kind: 'monthly' })]
    expect(coverLabel(across, [0, 1])).toMatch(/nov 26.*feb 27/)
  })
})
