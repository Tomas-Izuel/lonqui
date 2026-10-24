import { describe, expect, it } from 'vitest'
import {
  cellTone,
  closePreSystem,
  effectiveOptions,
  extendToDueMonths,
  optionsForSelection,
  coverLabel,
  coverageForAmount,
  defaultSelection,
  derivedAmountCents,
  firstSystemIndex,
  isBeforeStart,
  isSelectable,
  openingBalanceFromSelection,
  selectedOptions,
  selectionSummary,
  summaryText,
  tapCell,
  type Selection,
} from '@/views/payments/month-selection'
import type { PaymentMonthOption } from '@/models/types'

/**
 * Lógica pura de la tira de meses (00-architecture §10, criterios de F1).
 * Sin DOM: fixtures de `PaymentMonthOption[]` a mano, importes inventados.
 * $10.000 = 1_000_000 centavos.
 */
const P = 1_000_000

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
    ...partial,
  }
}

/**
 * Socio activo SIN saldo a favor (creditCents = 0), con un pago parcial de octubre. Es lo que
 * devolvería la RPC para ese socio: usar este fixture con `creditCents > 0` sería inconsistente.
 * Facturación desde octubre 2026, alta anterior:
 *   0 jul pre · 1 ago pre · 2 sep pre · 3 oct (actual, parcial: falta 600k) · 4 nov adelanto · 5 dic adelanto · 6 ene adelanto
 */
function withPreSystem(): PaymentMonthOption[] {
  return [
    opt({ period: '2026-07-01', kind: 'pre_system' }),
    opt({ period: '2026-08-01', kind: 'pre_system' }),
    opt({ period: '2026-09-01', kind: 'pre_system' }),
    opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true, coveredCents: 400_000 }),
    opt({ period: '2026-11-01', kind: 'projected' }),
    opt({ period: '2026-12-01', kind: 'projected' }),
    opt({ period: '2027-01-01', kind: 'projected' }),
  ]
}

/**
 * Lo que devuelve la RPC para un socio con $20.000 de saldo a favor (creditCents = 2P): pagó 3P
 * antes de que existieran cargos. Octubre generado y pago, nov y dic `projected` cubiertos por el
 * crédito, en orden.
 *   0 jul pre · 1 ago pre · 2 sep pre · 3 oct monthly PAGO (actual) · 4 nov proj cubierto · 5 dic proj cubierto · 6 ene proj · 7 feb proj
 */
const CREDIT = 2 * P
function withCredit(): PaymentMonthOption[] {
  return [
    opt({ period: '2026-07-01', kind: 'pre_system' }),
    opt({ period: '2026-08-01', kind: 'pre_system' }),
    opt({ period: '2026-09-01', kind: 'pre_system' }),
    opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true, coveredCents: P }),
    opt({ period: '2026-11-01', kind: 'projected', coveredCents: P }),
    opt({ period: '2026-12-01', kind: 'projected', coveredCents: P }),
    opt({ period: '2027-01-01', kind: 'projected' }),
    opt({ period: '2027-02-01', kind: 'projected' }),
  ]
}

/** Sin pre_system: 0 ago debe · 1 sep PAGADO · 2 oct actual debe · 3 nov adelanto · 4 dic adelanto. */
function plain(): PaymentMonthOption[] {
  return [
    opt({ period: '2026-08-01', kind: 'monthly' }),
    opt({ period: '2026-09-01', kind: 'monthly', coveredCents: P }),
    opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
    opt({ period: '2026-11-01', kind: 'projected' }),
    opt({ period: '2026-12-01', kind: 'projected' }),
  ]
}

const sel = (startIndex: number, endIndex: number): Selection => ({ startIndex, endIndex })

describe('cellTone / isSelectable', () => {
  it('una celda por estado', () => {
    expect(cellTone(opt({ period: '2026-07-01', kind: 'pre_system' }))).toBe('pre_system')
    expect(cellTone(opt({ period: '2026-09-01', kind: 'opening_balance', coveredCents: 100 }))).toBe('opening_balance')
    expect(cellTone(opt({ period: '2026-08-01', kind: 'monthly' }))).toBe('due')
    expect(cellTone(opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }))).toBe('current')
    expect(cellTone(opt({ period: '2026-08-01', kind: 'monthly', coveredCents: 1 }))).toBe('partial')
    expect(cellTone(opt({ period: '2026-08-01', kind: 'monthly', coveredCents: P }))).toBe('paid')
    expect(cellTone(opt({ period: '2026-11-01', kind: 'projected' }))).toBe('advance')
    expect(cellTone(opt({ period: '2026-11-01', kind: 'projected', coveredCents: P }))).toBe('covered')
    expect(cellTone(opt({ period: '2026-11-01', kind: 'projected', coveredCents: 500_000 }))).toBe('partial')
  })

  it('un centavo menos que el total sigue siendo parcial; el total exacto es pagado', () => {
    expect(cellTone(opt({ period: '2026-08-01', kind: 'monthly', coveredCents: P - 1 }))).toBe('partial')
    expect(cellTone(opt({ period: '2026-08-01', kind: 'monthly', coveredCents: P }))).toBe('paid')
  })

  it('solo es elegible lo que tiene pendiente', () => {
    expect(isSelectable(opt({ period: '2026-08-01', kind: 'monthly' }))).toBe(true)
    expect(isSelectable(opt({ period: '2026-08-01', kind: 'monthly', coveredCents: P }))).toBe(false)
    expect(isSelectable(opt({ period: '2026-07-01', kind: 'pre_system' }))).toBe(true)
  })
})

describe('firstSystemIndex / defaultSelection', () => {
  it('firstSystemIndex salta los pre_system y las celdas pagadas', () => {
    expect(firstSystemIndex(withPreSystem())).toBe(3)
    expect(firstSystemIndex(plain())).toBe(0)
    const paidFirst = plain()
    paidFirst[0] = opt({ period: '2026-08-01', kind: 'monthly', coveredCents: P })
    expect(firstSystemIndex(paidFirst)).toBe(2)
  })

  it('-1 si no hay nada elegible del sistema (solo pre_system, o todo pago)', () => {
    expect(firstSystemIndex([opt({ period: '2026-07-01', kind: 'pre_system' })])).toBe(-1)
    expect(firstSystemIndex([opt({ period: '2026-10-01', kind: 'monthly', coveredCents: P })])).toBe(-1)
    expect(firstSystemIndex([])).toBe(-1)
  })

  it('activo: marca solo el primer mes sin pagar', () => {
    expect(defaultSelection(plain(), 'active')).toEqual(sel(0, 0))
    expect(defaultSelection(withPreSystem(), 'active')).toEqual(sel(3, 3))
  })

  it('al día (primer mes sin pagar = un adelanto): marca ese adelanto', () => {
    const paid = [
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true, coveredCents: P }),
      opt({ period: '2026-11-01', kind: 'projected' }),
    ]
    expect(defaultSelection(paid, 'active')).toEqual(sel(1, 1))
  })

  it('de baja con deuda: toda la deuda, desde la primera hasta la última elegible (la pagada del medio no se marca)', () => {
    const debt = [
      opt({ period: '2026-08-01', kind: 'monthly' }),
      opt({ period: '2026-09-01', kind: 'monthly', coveredCents: P }),
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
    ]
    const s = defaultSelection(debt, 'inactive')
    expect(s).toEqual(sel(0, 2))
    expect(selectedOptions(debt, s).map((o) => o.period)).toEqual(['2026-08-01', '2026-10-01'])
  })

  it('de baja: nunca incluye pre_system', () => {
    const s = defaultSelection(withPreSystem(), 'inactive')
    expect(s?.startIndex).toBe(3)
  })

  it('null si no hay elegibles', () => {
    expect(defaultSelection([], 'active')).toBeNull()
    expect(defaultSelection([opt({ period: '2026-10-01', kind: 'monthly', coveredCents: P })], 'inactive')).toBeNull()
  })
})

describe('tapCell', () => {
  it('extiende: tocar un mes posterior marca todo desde el más viejo adeudado hasta ese', () => {
    expect(tapCell(plain(), sel(0, 0), 4, { preSystemOpen: false })).toEqual(sel(0, 4))
  })

  it('acorta: tocar un mes ya marcado termina la selección ahí', () => {
    expect(tapCell(plain(), sel(0, 4), 3, { preSystemOpen: false })).toEqual(sel(0, 3))
    expect(tapCell(plain(), sel(0, 4), 0, { preSystemOpen: false })).toEqual(sel(0, 0))
  })

  it('siempre termina donde tocaste', () => {
    const options = plain()
    for (const i of [0, 2, 3, 4]) {
      expect(tapCell(options, sel(0, 4), i, { preSystemOpen: false })?.endIndex).toBe(i)
    }
  })

  it('una celda no elegible (pagada) no cambia nada: devuelve la misma selección', () => {
    const current = sel(0, 3)
    expect(tapCell(plain(), current, 1, { preSystemOpen: false })).toBe(current)
  })

  it('una celda pagada dentro del rango queda sin marcar', () => {
    const options = plain()
    const s = tapCell(options, sel(0, 0), 2, { preSystemOpen: false })
    expect(selectedOptions(options, s).map((o) => o.period)).toEqual(['2026-08-01', '2026-10-01'])
  })

  it('tocar un pre_system (pliegue abierto) corre el inicio y mantiene el final si no era un adelanto', () => {
    // Final en el mes actual (no es adelanto): se mantiene.
    expect(tapCell(withPreSystem(), sel(3, 3), 1, { preSystemOpen: true })).toEqual(sel(1, 3))
  })

  it('tocar un pre_system con el final en un adelanto deja el final en el último pre_system', () => {
    expect(tapCell(withPreSystem(), sel(3, 5), 1, { preSystemOpen: true })).toEqual(sel(1, 2))
  })

  it('tocar un pre_system sin selección previa: marca desde ahí hasta el último pre_system', () => {
    expect(tapCell(withPreSystem(), null, 0, { preSystemOpen: true })).toEqual(sel(0, 2))
  })

  it('con el pliegue abierto, tocar un mes del sistema mantiene el inicio en el pre_system', () => {
    expect(tapCell(withPreSystem(), sel(1, 2), 4, { preSystemOpen: true })).toEqual(sel(1, 4))
  })

  it('sin pre_system marcados, tocar un mes del sistema arranca en el primer mes sin pagar', () => {
    expect(tapCell(withPreSystem(), null, 4, { preSystemOpen: false })).toEqual(sel(3, 4))
  })

  it('closePreSystem: el inicio vuelve al primer mes del sistema; si ya estaba ahí no cambia', () => {
    expect(closePreSystem(withPreSystem(), sel(1, 4))).toEqual(sel(3, 4))
    const already = sel(3, 4)
    expect(closePreSystem(withPreSystem(), already)).toBe(already)
    expect(closePreSystem(withPreSystem(), null)).toBeNull()
  })
})

describe('derivedAmountCents', () => {
  it('suma solo lo pendiente: un mes parcial aporta lo que falta, no el total', () => {
    expect(derivedAmountCents(withPreSystem(), sel(3, 3), { creditCents: 0 })).toBe(600_000)
    expect(derivedAmountCents(withPreSystem(), sel(3, 5), { creditCents: 0 })).toBe(600_000 + 2 * P)
  })

  it('sin selección, 0', () => {
    expect(derivedAmountCents(plain(), null, { creditCents: 0 })).toBe(0)
  })

  it('las celdas pagadas dentro del rango no suman', () => {
    expect(derivedAmountCents(plain(), sel(0, 2), { creditCents: 0 })).toBe(2 * P)
  })

  it('el saldo anterior (suma de pre_system) entra entero cuando no hay nada ya pagado que lo absorba', () => {
    // El fixture tiene 400k pagados de octubre: ese pozo se come parte del saldo (es el cargo más viejo).
    expect(derivedAmountCents(withPreSystem(), sel(0, 2), { creditCents: 0 })).toBe(3 * P - 400_000)
  })

  it('con override del saldo anterior, usa el total corregido (menos el pozo ya pagado)', () => {
    // Pozo = 400k de octubre. Octubre pierde su cobertura pero no está marcado: no suma.
    expect(derivedAmountCents(withPreSystem(), sel(0, 2), { creditCents: 0, openingBalanceOverrideCents: 2_500_000 })).toBe(2_100_000)
  })

  it('CASO DEL REVIEW: crédito $20.000, oct pago, nov y dic cubiertos, saldo jul-sep $30.000, tocar enero = $40.000 (el crédito se cuenta UNA vez)', () => {
    const ctx = { creditCents: CREDIT }
    expect(derivedAmountCents(withCredit(), sel(0, 6), ctx)).toBe(4 * P)
  })

  it('el mismo caso con el saldo corregido a menos que el pozo: sobra pozo y se cubren oct y nov, queda dic + ene', () => {
    expect(derivedAmountCents(withCredit(), sel(0, 6), { creditCents: CREDIT, openingBalanceOverrideCents: P })).toBe(2 * P)
  })

  it('el mismo caso con el saldo corregido a MÁS que el pozo: paga la diferencia más todos los meses', () => {
    expect(derivedAmountCents(withCredit(), sel(0, 6), { creditCents: CREDIT, openingBalanceOverrideCents: 5 * P })).toBe(2 * P + 4 * P)
  })

  it('solo meses previos con el pozo que los cubre del todo: 0 (el formulario deshabilita el botón)', () => {
    expect(derivedAmountCents(withCredit(), sel(0, 2), { creditCents: CREDIT })).toBe(0)
  })

  it('sin meses previos elegidos, el crédito no descuenta nada: las opciones de la RPC ya lo aplicaron', () => {
    expect(derivedAmountCents(withCredit(), sel(6, 7), { creditCents: CREDIT })).toBe(2 * P)
    expect(derivedAmountCents(withPreSystem(), sel(3, 3), { creditCents: 0 })).toBe(600_000)
  })
})

describe('effectiveOptions / optionsForSelection', () => {
  it('sin saldo anterior (null): devuelve las MISMAS opciones', () => {
    const options = withCredit()
    expect(effectiveOptions(options, null, CREDIT)).toBe(options)
  })

  it('mismo largo y mismo orden de períodos; las pre_system no cambian (mismas referencias)', () => {
    const options = withCredit()
    const eff = effectiveOptions(options, 3 * P, CREDIT)
    expect(eff).toHaveLength(options.length)
    expect(eff.map((o) => o.period)).toEqual(options.map((o) => o.period))
    expect(eff.map((o) => o.kind)).toEqual(options.map((o) => o.kind))
    options.forEach((o, i) => {
      if (o.kind === 'pre_system') expect(eff[i]).toBe(o)
    })
  })

  it('no muta las opciones de entrada', () => {
    const options = withCredit()
    const snapshot = JSON.parse(JSON.stringify(options))
    effectiveOptions(options, 3 * P, CREDIT)
    expect(options).toEqual(snapshot)
  })

  it('saldo anterior de 3P con el pozo de 3P: oct, nov y dic pierden la cobertura y vuelven a ser elegibles con su pendiente real', () => {
    const eff = effectiveOptions(withCredit(), 3 * P, CREDIT)
    for (const i of [3, 4, 5, 6, 7]) {
      expect(eff[i]).toMatchObject({ coveredCents: 0, pendingCents: P })
      expect(isSelectable(eff[i])).toBe(true)
    }
    // Vuelven a verse como adelanto / este mes, no como "cubierto".
    expect(cellTone(eff[3])).toBe('current')
    expect(cellTone(eff[4])).toBe('advance')
    expect(cellTone(eff[5])).toBe('advance')
  })

  it('saldo anterior MAYOR que el pozo: ninguna celda del sistema queda cubierta', () => {
    const eff = effectiveOptions(withCredit(), 10 * P, CREDIT)
    expect(eff.filter((o) => o.kind !== 'pre_system').every((o) => o.coveredCents === 0)).toBe(true)
  })

  it('saldo anterior MENOR que el pozo: lo que sobra se reparte en orden (el último cubierto queda parcial si no alcanza)', () => {
    // Pozo 3P - A (1,5P) = 1,5P: oct entera, nov a la mitad.
    const eff = effectiveOptions(withCredit(), 1_500_000, CREDIT)
    expect(eff[3]).toMatchObject({ coveredCents: P, pendingCents: 0 })
    expect(eff[4]).toMatchObject({ coveredCents: 500_000, pendingCents: 500_000 })
    expect(eff[5]).toMatchObject({ coveredCents: 0, pendingCents: P })
  })

  it('conservación: lo cubierto + el saldo anterior nunca supera el pozo pagado (el crédito no se usa dos veces)', () => {
    for (const a of [0, 1, P, 3 * P - 1, 3 * P, 3 * P + 1, 9 * P]) {
      const eff = effectiveOptions(withCredit(), a, CREDIT)
      const covered = eff.filter((o) => o.kind !== 'pre_system').reduce((t, o) => t + o.coveredCents, 0)
      expect(covered + Math.min(a, 3 * P)).toBeLessThanOrEqual(3 * P)
      expect(covered).toBe(Math.max(0, 3 * P - a))
    }
  })

  it('optionsForSelection: sin meses previos marcados devuelve las de la RPC; con ellos, las efectivas', () => {
    const options = withCredit()
    expect(optionsForSelection(options, sel(6, 7), { creditCents: CREDIT })).toBe(options)
    const eff = optionsForSelection(options, sel(0, 6), { creditCents: CREDIT })
    expect(eff[4].pendingCents).toBe(P)
  })
})

describe('openingBalanceFromSelection', () => {
  it('from = primer pre_system marcado, to = último, monto = suma', () => {
    expect(openingBalanceFromSelection(withPreSystem(), sel(1, 3))).toEqual({ fromPeriod: '2026-08-01', toPeriod: '2026-09-01', amountCents: 2 * P })
  })

  it('el override reemplaza la suma', () => {
    expect(openingBalanceFromSelection(withPreSystem(), sel(0, 3), 2_750_000)).toEqual({
      fromPeriod: '2026-07-01',
      toPeriod: '2026-09-01',
      amountCents: 2_750_000,
    })
  })

  it('un override de 0 no se confunde con "sin override" (?? y no ||): lo respeta', () => {
    expect(openingBalanceFromSelection(withPreSystem(), sel(0, 2), 0)?.amountCents).toBe(0)
  })

  it('sin pre_system marcados: null (aunque haya override)', () => {
    expect(openingBalanceFromSelection(withPreSystem(), sel(3, 4), 5 * P)).toBeNull()
    expect(openingBalanceFromSelection(withPreSystem(), null)).toBeNull()
  })
})

describe('coverageForAmount ("Otro monto")', () => {
  const ctx = { creditCents: 0 }

  it('el monto exacto de lo marcado cubre todo y no sobra nada', () => {
    const r = coverageForAmount(withPreSystem(), sel(3, 4), 600_000 + P, ctx)
    expect(r).toEqual({ fullyCovered: [3, 4], partial: null, leftoverCents: 0 })
  })

  it('un peso menos que el primer mes: celda parcial con lo que alcanzó, nada cubierto', () => {
    const r = coverageForAmount(withPreSystem(), sel(3, 3), 599_999, ctx)
    expect(r).toEqual({ fullyCovered: [], partial: { index: 3, cents: 599_999 }, leftoverCents: 0 })
  })

  it('monto menor al total marcado: cubre en orden y deja una parcial', () => {
    const r = coverageForAmount(withPreSystem(), sel(3, 5), 600_000 + P + 250_000, ctx)
    expect(r.fullyCovered).toEqual([3, 4])
    expect(r.partial).toEqual({ index: 5, cents: 250_000 })
    expect(r.leftoverCents).toBe(0)
  })

  it('monto mayor a lo marcado: balance forward sigue más allá (aunque no estén marcados) y el resto es saldo a favor', () => {
    const r = coverageForAmount(withPreSystem(), sel(3, 3), 600_000 + 2 * P + 300_000, ctx)
    expect(r.fullyCovered).toEqual([3, 4, 5])
    expect(r.partial).toEqual({ index: 6, cents: 300_000 })
  })

  it('monto mayor a TODA la ventana: leftoverCents = lo que sobra', () => {
    const total = 600_000 + 3 * P
    const r = coverageForAmount(withPreSystem(), sel(3, 3), total + 123, ctx)
    expect(r.fullyCovered).toEqual([3, 4, 5, 6])
    expect(r.partial).toBeNull()
    expect(r.leftoverCents).toBe(123)
  })

  it('monto 0 o negativo: no cubre nada y no inventa saldo', () => {
    for (const amount of [0, -500]) {
      expect(coverageForAmount(withPreSystem(), sel(3, 3), amount, ctx)).toEqual({ fullyCovered: [], partial: null, leftoverCents: 0 })
    }
  })

  it('el saldo anterior elegido se cubre primero (con el pozo ya pagado descontado)', () => {
    // Fixture con 400k pagados de octubre: el saldo ago+sep (2P) se achica a 1,6P.
    const r = coverageForAmount(withPreSystem(), sel(1, 2), 1_600_000, ctx)
    expect(r.fullyCovered).toEqual([1, 2])
    expect(r.leftoverCents).toBe(0)
  })

  it('CASO DEL REVIEW: con crédito $20.000, "otro monto" de $20.000 sobre jul-ene cubre solo hasta noviembre', () => {
    const r = coverageForAmount(withCredit(), sel(0, 6), 2 * P, { creditCents: CREDIT })
    expect(r).toEqual({ fullyCovered: [0, 1, 2, 3, 4], partial: null, leftoverCents: 0 })
  })

  it('con $40.000 cubre hasta enero inclusive y no sobra nada; un peso menos deja enero parcial', () => {
    expect(coverageForAmount(withCredit(), sel(0, 6), 4 * P, { creditCents: CREDIT })).toEqual({
      fullyCovered: [0, 1, 2, 3, 4, 5, 6],
      partial: null,
      leftoverCents: 0,
    })
    const short = coverageForAmount(withCredit(), sel(0, 6), 4 * P - 1, { creditCents: CREDIT })
    expect(short.fullyCovered).toEqual([0, 1, 2, 3, 4, 5])
    expect(short.partial).toEqual({ index: 6, cents: P - 1 })
  })

  it('un peso menos que $20.000: noviembre queda parcial (el número que promete la UI no miente)', () => {
    const r = coverageForAmount(withCredit(), sel(0, 6), 2 * P - 1, { creditCents: CREDIT })
    expect(r.fullyCovered).toEqual([0, 1, 2, 3])
    expect(r.partial).toEqual({ index: 4, cents: P - 1 })
  })

  it('con saldo anterior, un monto corto deja parcial al último mes previo', () => {
    const r = coverageForAmount(withPreSystem(), sel(1, 2), P + 400_000, ctx)
    expect(r.fullyCovered).toEqual([1])
    expect(r.partial).toEqual({ index: 2, cents: 400_000 })
  })

  it('el monto derivado siempre cubre exactamente lo marcado (derivado y cobertura no se contradicen)', () => {
    const cases: Array<[PaymentMonthOption[], Selection, number]> = [
      [withCredit(), sel(0, 6), CREDIT],
      [withCredit(), sel(1, 7), CREDIT],
      [withCredit(), sel(6, 7), CREDIT],
      [withPreSystem(), sel(0, 4), 0],
    ]
    for (const [options, selection, credit] of cases) {
      const amount = derivedAmountCents(options, selection, { creditCents: credit })
      const r = coverageForAmount(options, selection, amount, { creditCents: credit })
      expect(r.partial).toBeNull()
      expect(r.leftoverCents).toBe(0)
      const marked = selectedOptions(optionsForSelection(options, selection, { creditCents: credit }), selection).length
      expect(r.fullyCovered.length).toBeGreaterThanOrEqual(marked)
    }
  })

  it('con override del saldo anterior, la cobertura usa el total corregido', () => {
    const r = coverageForAmount(withPreSystem(), sel(0, 2), 2_000_000, { creditCents: 0, openingBalanceOverrideCents: 2_500_000 })
    expect(r.partial).not.toBeNull()
    expect(r.partial!.cents + P * r.fullyCovered.length).toBe(2_000_000)
  })
})

describe('selectionSummary / summaryText / coverLabel', () => {
  it('tres meses seguidos: cuenta y rango (el año va una vez al final, como periodRangeLabel)', () => {
    const s = selectionSummary(withPreSystem(), sel(3, 5))
    expect(s).toMatchObject({ monthsCount: 3, hasOpeningBalance: false })
    expect(s.rangeLabel).toBe('octubre a diciembre 2026')
    expect(summaryText(s)).toBe('3 meses · octubre a diciembre 2026')
  })

  it('cruce de año: cada extremo con su año', () => {
    const s = selectionSummary(withPreSystem(), sel(5, 6))
    expect(s.rangeLabel).toBe('diciembre 2026 a enero 2027')
  })

  it('un solo mes: singular y sin rango', () => {
    const s = selectionSummary(withPreSystem(), sel(4, 4))
    expect(s.monthsCount).toBe(1)
    expect(summaryText(s)).toBe('1 mes · noviembre 2026')
  })

  it('las celdas pagadas no cuentan como mes', () => {
    expect(selectionSummary(plain(), sel(0, 2)).monthsCount).toBe(2)
  })

  it('el saldo anterior vigente cuenta como "saldo anterior", no como mes', () => {
    const options = [
      opt({ period: '2026-09-01', kind: 'opening_balance', amountCents: 3 * P }),
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
    ]
    expect(selectionSummary(options, sel(0, 1))).toMatchObject({ monthsCount: 1, hasOpeningBalance: true, rangeLabel: 'saldo anterior y octubre 2026' })
    expect(selectionSummary(options, sel(0, 0))).toMatchObject({ monthsCount: 0, hasOpeningBalance: true, rangeLabel: 'saldo anterior' })
  })

  it('sin selección: vacío', () => {
    expect(selectionSummary(plain(), null)).toEqual({ monthsCount: 0, rangeLabel: '', hasOpeningBalance: false })
  })

  it('coverLabel (momento de éxito): abreviado, año solo si cruza', () => {
    expect(coverLabel(withPreSystem(), sel(3, 5))).toBe('oct–dic')
    expect(coverLabel(withPreSystem(), sel(4, 4))).toBe('nov')
    expect(coverLabel(withPreSystem(), sel(5, 6))).toBe('dic 26–ene 27')
    expect(coverLabel(withPreSystem(), null)).toBe('')
  })

  it('caso del review: "Cubre jul 26–ene 27" y "4 meses" no cuentan mal con las opciones efectivas', () => {
    const selection = sel(0, 6)
    const eff = optionsForSelection(withCredit(), selection, { creditCents: CREDIT })
    expect(coverLabel(eff, selection)).toBe('jul 26–ene 27')
    expect(selectionSummary(eff, selection).rangeLabel).toBe('julio 2026 a enero 2027')
  })
})

describe('extendToDueMonths (tocar un mes previo marca también lo que el saldo anterior deja debiendo)', () => {
  const ctx0 = { creditCents: 0 }

  /** 0-2 jul-sep pre · 3 oct monthly actual SIN pagar · 4 nov · 5 dic adelantos */
  function octDue(): PaymentMonthOption[] {
    return [
      opt({ period: '2026-07-01', kind: 'pre_system' }),
      opt({ period: '2026-08-01', kind: 'pre_system' }),
      opt({ period: '2026-09-01', kind: 'pre_system' }),
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
      opt({ period: '2026-11-01', kind: 'projected' }),
      opt({ period: '2026-12-01', kind: 'projected' }),
    ]
  }

  it('debe octubre y no hay crédito: tocar julio extiende el final hasta octubre', () => {
    expect(extendToDueMonths(octDue(), sel(0, 2), ctx0)).toEqual(sel(0, 3))
  })

  it('octubre pago con pozo de sobra (pagó 4 cuotas: oct + 3 de crédito) y saldo de 3: no extiende', () => {
    const paid: PaymentMonthOption[] = [
      opt({ period: '2026-07-01', kind: 'pre_system' }),
      opt({ period: '2026-08-01', kind: 'pre_system' }),
      opt({ period: '2026-09-01', kind: 'pre_system' }),
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true, coveredCents: P }),
      opt({ period: '2026-11-01', kind: 'projected', coveredCents: P }),
      opt({ period: '2026-12-01', kind: 'projected', coveredCents: P }),
      opt({ period: '2027-01-01', kind: 'projected', coveredCents: P }),
      opt({ period: '2027-02-01', kind: 'projected' }),
    ]
    expect(extendToDueMonths(paid, sel(0, 2), { creditCents: 3 * P })).toEqual(sel(0, 2))
  })

  it('crédito que con el saldo anterior deja octubre elegible: extiende hasta octubre (caso del review)', () => {
    expect(extendToDueMonths(withCredit(), sel(0, 2), { creditCents: CREDIT })).toEqual(sel(0, 3))
  })

  it('el saldo corregido a menos que el pozo: octubre sigue cubierto y no se extiende', () => {
    expect(extendToDueMonths(withCredit(), sel(0, 2), { creditCents: CREDIT, openingBalanceOverrideCents: P })).toEqual(sel(0, 2))
  })

  it('una selección que no arranca en pre_system queda igual (misma referencia), y null sigue null', () => {
    const selection = sel(3, 3)
    expect(extendToDueMonths(octDue(), selection, ctx0)).toBe(selection)
    expect(extendToDueMonths(octDue(), null, ctx0)).toBeNull()
  })

  it('un final que ya está más adelante (adelanto) no se acorta', () => {
    expect(extendToDueMonths(octDue(), sel(0, 5), ctx0)).toEqual(sel(0, 5))
    expect(extendToDueMonths(withCredit(), sel(0, 5), { creditCents: CREDIT })).toEqual(sel(0, 5))
  })

  it('solo extiende por cuotas monthly: un adelanto que pierde cobertura no arrastra el final', () => {
    // Con crédito, oct pasa a deberse (monthly) pero nov/dic (projected) no se marcan solos.
    const extended = extendToDueMonths(withCredit(), sel(0, 2), { creditCents: CREDIT })
    expect(extended?.endIndex).toBe(3)
  })
})

/**
 * Pipeline 2026-10-24-pago-por-meses-antes-del-inicio: facturacion que arranca en noviembre y hoy
 * es octubre. Lo que devuelve la RPC: los previos incluyen el mes actual (pre_system + isCurrent)
 * y los proyectados arrancan en el inicio.
 *   0 jul pre · 1 ago pre · 2 sep pre · 3 oct pre (actual) · 4 nov proj · 5 dic proj · 6 ene proj
 */
function beforeStart(): PaymentMonthOption[] {
  return [
    opt({ period: '2026-07-01', kind: 'pre_system' }),
    opt({ period: '2026-08-01', kind: 'pre_system' }),
    opt({ period: '2026-09-01', kind: 'pre_system' }),
    opt({ period: '2026-10-01', kind: 'pre_system', isCurrent: true }),
    opt({ period: '2026-11-01', kind: 'projected' }),
    opt({ period: '2026-12-01', kind: 'projected' }),
    opt({ period: '2027-01-01', kind: 'projected' }),
  ]
}
const OPEN = { preSystemOpen: true }
const ctx0 = { creditCents: 0 }

describe('isBeforeStart', () => {
  it('true solo si hay un pre_system que es el mes actual', () => {
    expect(isBeforeStart(beforeStart())).toBe(true)
  })

  it('despues del inicio (los pre_system son meses pasados, ninguno es el actual): false', () => {
    expect(isBeforeStart(withPreSystem())).toBe(false)
    expect(isBeforeStart(plain())).toBe(false)
    expect(isBeforeStart([])).toBe(false)
  })

  it('un mes actual que no es pre_system no cuenta', () => {
    expect(isBeforeStart([opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true })])).toBe(false)
  })
})

describe('antes del inicio: defaultSelection', () => {
  it('socio activo: el mes actual solo (no el primer proyectado)', () => {
    expect(defaultSelection(beforeStart(), 'active')).toEqual(sel(3, 3))
  })

  it('socio de baja: igual, el mes actual solo y sin adelantos', () => {
    expect(defaultSelection(beforeStart(), 'inactive')).toEqual(sel(3, 3))
  })

  it('la seleccion por defecto es saldo anterior de un mes: openingBalanceFromSelection da from = to = el mes actual', () => {
    expect(openingBalanceFromSelection(beforeStart(), defaultSelection(beforeStart(), 'active'))).toEqual({
      fromPeriod: '2026-10-01',
      toPeriod: '2026-10-01',
      amountCents: P,
    })
  })

  it('monto derivado de la seleccion por defecto: exactamente una cuota', () => {
    expect(derivedAmountCents(beforeStart(), sel(3, 3), ctx0)).toBe(P)
  })

  it('despues del inicio el default no cambia (primer mes sin pagar del sistema)', () => {
    expect(defaultSelection(withPreSystem(), 'active')).toEqual(sel(3, 3))
    expect(defaultSelection(plain(), 'active')).toEqual(sel(0, 0))
  })
})

describe('antes del inicio: tapCell', () => {
  it('tocar un mes previo anterior marca desde ahi hasta el mes actual (el ultimo previo)', () => {
    expect(tapCell(beforeStart(), sel(3, 3), 1, OPEN)).toEqual(sel(1, 3))
    expect(tapCell(beforeStart(), sel(3, 3), 0, OPEN)).toEqual(sel(0, 3))
  })

  it('tocar un mes proyectado extiende hasta ahi manteniendo el previo marcado', () => {
    expect(tapCell(beforeStart(), sel(3, 3), 5, OPEN)).toEqual(sel(3, 5))
    expect(tapCell(beforeStart(), sel(1, 3), 4, OPEN)).toEqual(sel(1, 4))
  })

  it('volver a tocar el primer mes previo marcado desmarca la parte previa: no queda nada si no hay sistema marcado', () => {
    expect(tapCell(beforeStart(), sel(3, 3), 3, OPEN)).toBeNull()
    expect(tapCell(beforeStart(), sel(1, 3), 1, OPEN)).toBeNull()
  })

  it('volver a tocar el primer mes previo con proyectados marcados: queda solo lo del sistema, hasta el mismo final', () => {
    expect(tapCell(beforeStart(), sel(3, 5), 3, OPEN)).toEqual(sel(4, 5))
    expect(tapCell(beforeStart(), sel(1, 5), 1, OPEN)).toEqual(sel(4, 5))
  })

  it('tocar un previo que NO es el primero marcado acorta/corre el inicio, no desmarca', () => {
    expect(tapCell(beforeStart(), sel(1, 3), 2, OPEN)).toEqual(sel(2, 3))
  })

  it('sin seleccion, tocar un proyectado arranca en el primer mes del sistema (nov), no en el actual', () => {
    expect(tapCell(beforeStart(), null, 5, OPEN)).toEqual(sel(4, 5))
  })

  it('con la parte previa desmarcada, volver a tocar un previo la remarca hasta el mes actual', () => {
    expect(tapCell(beforeStart(), null, 2, OPEN)).toEqual(sel(2, 3))
  })

  it('despues del inicio tocar el primer pre_system marcado NO lo desmarca (sigue el comportamiento previo)', () => {
    expect(tapCell(withPreSystem(), sel(1, 3), 1, OPEN)).toEqual(sel(1, 3))
  })
})

describe('antes del inicio: monto y resumen', () => {
  it('monto derivado: suma los previos marcados, mas los proyectados marcados', () => {
    expect(derivedAmountCents(beforeStart(), sel(1, 3), ctx0)).toBe(3 * P)
    expect(derivedAmountCents(beforeStart(), sel(3, 5), ctx0)).toBe(3 * P)
  })

  it('resumen del default: "1 mes · octubre 2026"', () => {
    expect(summaryText(selectionSummary(beforeStart(), sel(3, 3)))).toBe('1 mes · octubre 2026')
  })

  it('resumen con previos y proyectados: cuenta todos como meses', () => {
    const s = selectionSummary(beforeStart(), sel(3, 5))
    expect(s.monthsCount).toBe(3)
    expect(summaryText(s)).toBe('3 meses · octubre a diciembre 2026')
  })

  it('coverLabel del default: "oct"', () => {
    expect(coverLabel(beforeStart(), sel(3, 3))).toBe('oct')
  })
})

/** Ronda 2: inicio a varios meses. Hoy oct 2026, inicio ene 2027: la RPC corta los previos en el mes actual (sin nov/dic). */
function farStart(): PaymentMonthOption[] {
  return [
    opt({ period: '2026-08-01', kind: 'pre_system' }),
    opt({ period: '2026-09-01', kind: 'pre_system' }),
    opt({ period: '2026-10-01', kind: 'pre_system', isCurrent: true }),
    opt({ period: '2027-01-01', kind: 'projected' }),
    opt({ period: '2027-02-01', kind: 'projected' }),
  ]
}

describe('antes del inicio, inicio a 2 o mas meses: la seleccion usa la celda is_current', () => {
  it('isBeforeStart y defaultSelection eligen el mes actual aunque no sea el ultimo previo del arreglo', () => {
    // Un arreglo donde despues del actual hay otro previo (no lo devuelve la RPC hoy, pero el codigo no lo asume).
    const options = [
      opt({ period: '2026-09-01', kind: 'pre_system' }),
      opt({ period: '2026-10-01', kind: 'pre_system', isCurrent: true }),
      opt({ period: '2026-11-01', kind: 'pre_system' }),
      opt({ period: '2027-01-01', kind: 'projected' }),
    ]
    expect(isBeforeStart(options)).toBe(true)
    expect(defaultSelection(options, 'active')).toEqual(sel(1, 1))
    expect(defaultSelection(options, 'inactive')).toEqual(sel(1, 1))
  })

  it('tocar un previo anterior marca hasta el mes actual, nunca hasta un previo posterior', () => {
    const options = [
      opt({ period: '2026-09-01', kind: 'pre_system' }),
      opt({ period: '2026-10-01', kind: 'pre_system', isCurrent: true }),
      opt({ period: '2026-11-01', kind: 'pre_system' }),
      opt({ period: '2027-01-01', kind: 'projected' }),
    ]
    expect(tapCell(options, sel(1, 1), 0, OPEN)).toEqual(sel(0, 1))
  })

  it('con el arreglo real de la RPC (previos hasta el actual, proyectados desde el inicio): default, tocar previo, tocar proyectado, desmarcar', () => {
    const o = farStart()
    expect(defaultSelection(o, 'active')).toEqual(sel(2, 2))
    expect(tapCell(o, sel(2, 2), 0, OPEN)).toEqual(sel(0, 2))
    expect(tapCell(o, sel(2, 2), 4, OPEN)).toEqual(sel(2, 4))
    expect(tapCell(o, sel(2, 2), 2, OPEN)).toBeNull()
    expect(tapCell(o, sel(2, 4), 2, OPEN)).toEqual(sel(3, 4))
  })

  it('el resumen del default dice octubre 2026 (el mes actual), no un mes futuro', () => {
    expect(summaryText(selectionSummary(farStart(), sel(2, 2)))).toBe('1 mes · octubre 2026')
  })

  it('inicio a 13+ meses (previos 12 terminando en el actual): sigue siendo antes del inicio', () => {
    const o = Array.from({ length: 12 }, (_, i) =>
      opt({ period: `${i < 2 ? 2025 : 2026}-${String(((i + 10 - 1) % 12) + 1).padStart(2, '0')}-01`, kind: 'pre_system', isCurrent: i === 11 }),
    )
    expect(isBeforeStart(o)).toBe(true)
    expect(defaultSelection(o, 'active')).toEqual(sel(11, 11))
  })
})

describe('antes del inicio con saldo a favor C y {actual, actual}', () => {
  const sel33 = sel(3, 3)
  it('derived = max(0, X - C): C menor que la cuota, igual, y mayor', () => {
    expect(derivedAmountCents(beforeStart(), sel33, { creditCents: P / 2 })).toBe(P / 2)
    expect(derivedAmountCents(beforeStart(), sel33, { creditCents: P })).toBe(0)
    expect(derivedAmountCents(beforeStart(), sel33, { creditCents: 3 * P })).toBe(0)
  })

  it('el credito que sobra del saldo anterior cubre los proyectados en orden, y lo cubierto por C antes se reparte de nuevo', () => {
    // La RPC ya habia cubierto nov y dic con C = 2P (no hay cargos).
    const raw = [
      ...beforeStart().slice(0, 4),
      opt({ period: '2026-11-01', kind: 'projected', coveredCents: P }),
      opt({ period: '2026-12-01', kind: 'projected', coveredCents: P }),
      opt({ period: '2027-01-01', kind: 'projected' }),
    ]
    const eff = optionsForSelection(raw, sel33, { creditCents: 2 * P })
    // El saldo anterior (P) se come primero P del credito: queda P para nov; dic y ene pasan a pendientes.
    expect(eff[4]).toMatchObject({ coveredCents: P, pendingCents: 0 })
    expect(eff[5]).toMatchObject({ coveredCents: 0, pendingCents: P })
    expect(eff[6]).toMatchObject({ coveredCents: 0, pendingCents: P })
  })
})
