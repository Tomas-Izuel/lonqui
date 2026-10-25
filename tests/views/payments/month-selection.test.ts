import { describe, expect, it } from 'vitest'
import {
  cellTone,
  closePreSystem,
  effectiveOptions,
  optionsForSelection,
  coverLabel,
  coverageForAmount,
  debtAfterPayment,
  dragSelect,
  isLegacyOpening,
  openingScope,
  openingSpan,
  preCellRole,
  splitOpeningTotal,
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
    openingFrom: null,
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
    expect(effectiveOptions(options, null, { creditCents: CREDIT })).toBe(options)
  })

  it('mismo largo y mismo orden de períodos; las pre_system ANTERIORES a F no cambian (mismas referencias)', () => {
    const options = withCredit()
    const eff = effectiveOptions(options, sel(1, 2), { creditCents: CREDIT })
    expect(eff).toHaveLength(options.length)
    expect(eff.map((o) => o.period)).toEqual(options.map((o) => o.period))
    expect(eff.map((o) => o.kind)).toEqual(options.map((o) => o.kind))
    expect(eff[0]).toBe(options[0])
  })

  it('las pre_system dentro de F..P absorben el pozo ya pagado (quedan sin pendiente) y las del sistema pierden cobertura', () => {
    const eff = effectiveOptions(withCredit(), sel(0, 2), { creditCents: CREDIT })
    for (const i of [0, 1, 2]) expect(eff[i]).toMatchObject({ coveredCents: P, pendingCents: 0 })
    expect(eff[3].coveredCents).toBe(0)
  })

  it('no muta las opciones de entrada', () => {
    const options = withCredit()
    const snapshot = JSON.parse(JSON.stringify(options))
    effectiveOptions(options, sel(0, 2), { creditCents: CREDIT })
    expect(options).toEqual(snapshot)
  })

  it('saldo anterior de 3P con el pozo de 3P: oct, nov y dic pierden la cobertura y vuelven a ser elegibles con su pendiente real', () => {
    const eff = effectiveOptions(withCredit(), sel(0, 2), { creditCents: CREDIT })
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
    const eff = effectiveOptions(withCredit(), sel(0, 2), { creditCents: CREDIT, openingBalanceOverrideCents: 10 * P })
    expect(eff.filter((o) => o.kind !== 'pre_system').every((o) => o.coveredCents === 0)).toBe(true)
  })

  it('saldo anterior MENOR que el pozo: lo que sobra se reparte en orden (el último cubierto queda parcial si no alcanza)', () => {
    // Pozo 3P - A (1,5P) = 1,5P: oct entera, nov a la mitad.
    const eff = effectiveOptions(withCredit(), sel(0, 2), { creditCents: CREDIT, openingBalanceOverrideCents: 1_500_000 })
    expect(eff[3]).toMatchObject({ coveredCents: P, pendingCents: 0 })
    expect(eff[4]).toMatchObject({ coveredCents: 500_000, pendingCents: 500_000 })
    expect(eff[5]).toMatchObject({ coveredCents: 0, pendingCents: P })
  })

  it('conservación: lo cubierto + el saldo anterior nunca supera el pozo pagado (el crédito no se usa dos veces)', () => {
    for (const a of [0, 1, P, 3 * P - 1, 3 * P, 3 * P + 1, 9 * P]) {
      const eff = effectiveOptions(withCredit(), sel(0, 2), { creditCents: CREDIT, openingBalanceOverrideCents: a })
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
    // El crédito ya se come jul-sep (pendiente 0 en las efectivas): no figuran como cubiertas por ESTE pago.
    const r = coverageForAmount(withCredit(), sel(0, 6), 2 * P, { creditCents: CREDIT })
    expect(r).toEqual({ fullyCovered: [3, 4], partial: null, leftoverCents: 0 })
  })

  it('con $40.000 cubre hasta enero inclusive y no sobra nada; un peso menos deja enero parcial', () => {
    expect(coverageForAmount(withCredit(), sel(0, 6), 4 * P, { creditCents: CREDIT })).toEqual({
      fullyCovered: [3, 4, 5, 6],
      partial: null,
      leftoverCents: 0,
    })
    const short = coverageForAmount(withCredit(), sel(0, 6), 4 * P - 1, { creditCents: CREDIT })
    expect(short.fullyCovered).toEqual([3, 4, 5])
    expect(short.partial).toEqual({ index: 6, cents: P - 1 })
  })

  it('un peso menos que $20.000: noviembre queda parcial (el número que promete la UI no miente)', () => {
    const r = coverageForAmount(withCredit(), sel(0, 6), 2 * P - 1, { creditCents: CREDIT })
    expect(r.fullyCovered).toEqual([3])
    expect(r.partial).toEqual({ index: 4, cents: P - 1 })
  })

  it('con saldo anterior, un monto corto deja parcial al último mes previo', () => {
    const r = coverageForAmount(withPreSystem(), sel(1, 2), P + 400_000, ctx)
    // El pozo de 400k de octubre se come el primer mes del saldo (idx 1: queda 600k); lo que sobra va al último previo.
    expect(r.fullyCovered).toEqual([1])
    expect(r.partial).toEqual({ index: 2, cents: P + 400_000 - 600_000 })
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
    const ctxO = { creditCents: 0, openingBalanceOverrideCents: 2_500_000 }
    const r = coverageForAmount(withPreSystem(), sel(0, 2), 2_000_000, ctxO)
    expect(r.partial).not.toBeNull()
    // El monto se reparte entre las partes del total corregido (no n × cuota): lo cubierto + la parcial = lo pagado.
    const eff = effectiveOptions(withPreSystem(), sel(0, 2), ctxO)
    const covered = r.fullyCovered.reduce((t, i) => t + eff[i].pendingCents, 0)
    expect(covered + r.partial!.cents).toBe(2_000_000)
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
    // El crédito ya cubre jul-sep: no son marcables, el rótulo arranca en el primer mes que sí se paga.
    expect(coverLabel(eff, selection)).toBe('oct 26–ene 27')
    expect(selectionSummary(eff, selection).rangeLabel).toBe('octubre 2026 a enero 2027')
    expect(selectionSummary(eff, selection).monthsCount).toBe(4)
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


/**
 * Carga inicial por meses (00-architecture §6-§7, pipeline 2026-10-24-carga-inicial-meses).
 * Facturación que arranca en noviembre, hoy es octubre 2026: la RPC devuelve los previos
 * ene..oct 2026 (oct = mes actual, pre_system) y proyectados nov y dic.
 *   0 ene · 1 feb · 2 mar · 3 abr · 4 may · 5 jun · 6 jul · 7 ago · 8 sep · 9 oct (actual) · 10 nov proj · 11 dic proj
 */
function carga(): PaymentMonthOption[] {
  const pre = Array.from({ length: 10 }, (_, i) =>
    opt({ period: `2026-${String(i + 1).padStart(2, '0')}-01` as PaymentMonthOption['period'], kind: 'pre_system', isCurrent: i === 9 }),
  )
  return [...pre, opt({ period: '2026-11-01', kind: 'projected' }), opt({ period: '2026-12-01', kind: 'projected' })]
}

describe('splitOpeningTotal', () => {
  it('total no múltiplo: el último mes absorbe el resto ($100.000 en 3 meses, igual que la RPC)', () => {
    expect(splitOpeningTotal(10_000_000, 3)).toEqual([3_333_333, 3_333_333, 3_333_334])
  })

  it('un solo mes: todo el total; cero o negativo de meses: vacío', () => {
    expect(splitOpeningTotal(777, 1)).toEqual([777])
    expect(splitOpeningTotal(777, 0)).toEqual([])
    expect(splitOpeningTotal(777, -2)).toEqual([])
  })

  it('total menor que la cantidad de meses: ceros y el resto en el último (nunca negativos)', () => {
    expect(splitOpeningTotal(2, 5)).toEqual([0, 0, 0, 0, 2])
    expect(splitOpeningTotal(0, 4)).toEqual([0, 0, 0, 0])
  })

  it('invariante: suma exacta, partes enteras y el último nunca menor que el resto', () => {
    for (const total of [0, 1, 99, 1_000_000, 10_000_001, 123_456_789]) {
      for (const n of [1, 2, 3, 7, 10, 36]) {
        const parts = splitOpeningTotal(total, n)
        expect(parts).toHaveLength(n)
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
        expect(parts.every((x) => Number.isInteger(x) && x >= 0)).toBe(true)
        expect(parts[n - 1]).toBeGreaterThanOrEqual(parts[0])
      }
    }
  })
})

describe('openingSpan', () => {
  it('ene–jun marcados de ene..oct: el tramo va de ene hasta el último previo (oct), no hasta lo marcado', () => {
    expect(openingSpan(carga(), sel(0, 5))).toEqual({ from: 0, to: 9 })
  })

  it('el primer previo marcado es F, aunque no sea el primero de la ventana', () => {
    expect(openingSpan(carga(), sel(4, 6))).toEqual({ from: 4, to: 9 })
  })

  it('null si la selección no arranca en una previa, o no hay selección', () => {
    expect(openingSpan(carga(), sel(10, 11))).toBeNull()
    expect(openingSpan(carga(), null)).toBeNull()
    expect(openingSpan(plain(), sel(0, 2))).toBeNull()
  })
})

describe('openingBalanceFromSelection (carga por meses)', () => {
  it('ene–jun marcados de ene..oct: desde enero, hasta octubre, suma de los 10 meses', () => {
    expect(openingBalanceFromSelection(carga(), sel(0, 5))).toEqual({ fromPeriod: '2026-01-01', toPeriod: '2026-10-01', amountCents: 10 * P })
  })

  it('con override el monto es el corregido, el tramo no cambia', () => {
    expect(openingBalanceFromSelection(carga(), sel(0, 5), 8_765_432)).toEqual({
      fromPeriod: '2026-01-01',
      toPeriod: '2026-10-01',
      amountCents: 8_765_432,
    })
  })

  it('marcar hasta el final del tramo o solo un mes da el mismo "hasta" (octubre)', () => {
    expect(openingBalanceFromSelection(carga(), sel(0, 9))?.toPeriod).toBe('2026-10-01')
    expect(openingBalanceFromSelection(carga(), sel(0, 0))?.toPeriod).toBe('2026-10-01')
  })

  it('con proyectados marcados además de previos, el tramo sigue terminando en el último previo', () => {
    expect(openingBalanceFromSelection(carga(), sel(0, 10))).toMatchObject({ fromPeriod: '2026-01-01', toPeriod: '2026-10-01' })
  })
})

describe('derivedAmountCents (carga por meses)', () => {
  it('ene–jun de ene..oct: el pago son solo los 6 marcados (los 4 sin marcar quedan debiendo)', () => {
    expect(derivedAmountCents(carga(), sel(0, 5), { creditCents: 0 })).toBe(6 * P)
  })

  it('con total corregido: cada marcado vale su parte del total, no una cuota', () => {
    // $90.000 en 10 meses = 9.000 por mes: 6 marcados = 54.000
    expect(derivedAmountCents(carga(), sel(0, 5), { creditCents: 0, openingBalanceOverrideCents: 9_000_000 })).toBe(5_400_000)
  })

  it('el resto del reparto cae en el último mes del tramo: marcando todo, el pago es exactamente el total corregido', () => {
    const ctx = { creditCents: 0, openingBalanceOverrideCents: 1_000_001 }
    expect(derivedAmountCents(carga(), sel(0, 9), ctx)).toBe(1_000_001)
    // marcando solo los primeros 6, el resto (1) no está en el pago
    expect(derivedAmountCents(carga(), sel(0, 5), ctx)).toBe(600_000)
  })

  it('con saldo a favor: se come los meses más viejos primero y el pago baja en igual medida', () => {
    expect(derivedAmountCents(carga(), sel(0, 5), { creditCents: 2 * P })).toBe(4 * P)
  })

  it('el saldo a favor mayor que todo lo marcado deja el pago en 0, nunca negativo', () => {
    expect(derivedAmountCents(carga(), sel(0, 5), { creditCents: 100 * P })).toBe(0)
  })

  it('previos + proyectado marcado: suma el proyectado a pleno', () => {
    expect(derivedAmountCents(carga(), sel(0, 10), { creditCents: 0 })).toBe(11 * P)
  })
})

describe('debtAfterPayment', () => {
  it('ene–jun de ene..oct: quedan debiendo 4 meses · $40.000 (jul–oct)', () => {
    expect(debtAfterPayment(carga(), sel(0, 5), { creditCents: 0 })).toEqual({ months: 4, cents: 4 * P })
  })

  it('marcar todo el tramo: no queda nada (los adelantos proyectados no son deuda)', () => {
    expect(debtAfterPayment(carga(), sel(0, 9), { creditCents: 0 })).toEqual({ months: 0, cents: 0 })
  })

  it('con total corregido, lo que queda es la suma de las partes sin marcar (incluye el resto)', () => {
    // 1.000.001 en 10: 100.000 x9 + 100.001; sin marcar 4 (jul..oct) = 300.000 + 100.001
    expect(debtAfterPayment(carga(), sel(0, 5), { creditCents: 0, openingBalanceOverrideCents: 1_000_001 })).toEqual({
      months: 4,
      cents: 400_001,
    })
  })

  it('el saldo a favor reduce lo que queda: el crédito se aplica al más viejo, que está marcado', () => {
    // Crédito de 2 cuotas cubre ene y feb; quedan los mismos 4 sin marcar
    expect(debtAfterPayment(carga(), sel(0, 5), { creditCents: 2 * P })).toEqual({ months: 4, cents: 4 * P })
    // Crédito de 8 cuotas: cubre ene..ago (incluye jul y ago, sin marcar); solo sep y oct siguen pendientes
    expect(debtAfterPayment(carga(), sel(0, 5), { creditCents: 8 * P })).toEqual({ months: 2, cents: 2 * P })
  })

  it('después del inicio: un mes del sistema sin marcar sigue siendo deuda', () => {
    const o = [
      opt({ period: '2026-07-01', kind: 'pre_system' }),
      opt({ period: '2026-08-01', kind: 'pre_system' }),
      opt({ period: '2026-09-01', kind: 'monthly' }),
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
      opt({ period: '2026-11-01', kind: 'projected' }),
    ]
    expect(debtAfterPayment(o, sel(0, 1), { creditCents: 0 })).toEqual({ months: 2, cents: 2 * P })
  })

  it('el mes actual proyectado sin marcar es deuda; el adelanto no', () => {
    const o = [
      opt({ period: '2026-09-01', kind: 'pre_system' }),
      opt({ period: '2026-10-01', kind: 'projected', isCurrent: true }),
      opt({ period: '2026-11-01', kind: 'projected' }),
    ]
    expect(debtAfterPayment(o, sel(0, 0), { creditCents: 0 })).toEqual({ months: 1, cents: P })
  })

  it('sin tramo (no arranca en previa): cuenta lo no marcado que se debe, sin inventar previas', () => {
    expect(debtAfterPayment(plain(), sel(0, 0), { creditCents: 0 })).toEqual({ months: 1, cents: P })
  })

  it('un saldo anterior viejo (legacy) sin marcar es deuda', () => {
    const o = [
      opt({ period: '2026-09-01', kind: 'opening_balance', amountCents: 3 * P }),
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
    ]
    expect(debtAfterPayment(o, sel(1, 1), { creditCents: 0 })).toEqual({ months: 1, cents: 3 * P })
  })
})

describe('tapCell modo "free" (formularios de pago)', () => {
  const free = { preSystemOpen: true, preMode: 'free' as const }

  it('fresh: la selección por defecto no cuenta, el toque arranca un rango nuevo de una celda', () => {
    expect(tapCell(carga(), sel(9, 9), 2, { ...free, fresh: true })).toEqual(sel(2, 2))
  })

  it('sin selección: arranca en la celda tocada', () => {
    expect(tapCell(carga(), null, 3, free)).toEqual(sel(3, 3))
  })

  it('tocar-tocar da un rango sin arrastrar: primero y último', () => {
    const first = tapCell(carga(), null, 0, { ...free, fresh: true })
    expect(tapCell(carga(), first, 5, free)).toEqual(sel(0, 5))
  })

  it('tocar antes del inicio del rango lo extiende hacia atrás', () => {
    expect(tapCell(carga(), sel(3, 5), 1, free)).toEqual(sel(1, 5))
  })

  it('tocar una marcada intermedia la vuelve el final ("hasta acá")', () => {
    expect(tapCell(carga(), sel(0, 5), 2, free)).toEqual(sel(0, 2))
  })

  it('tocar el final achica de a uno; si era la única celda, desmarca todo', () => {
    expect(tapCell(carga(), sel(0, 5), 5, free)).toEqual(sel(0, 4))
    expect(tapCell(carga(), sel(3, 3), 3, free)).toBeNull()
  })

  it('con el pliegue cerrado tocar una previa no hace nada', () => {
    const selection = sel(9, 9)
    expect(tapCell(carga(), selection, 2, { preSystemOpen: false, preMode: 'free' })).toBe(selection)
  })

  it('una celda sin pendiente no se toca', () => {
    const o = carga()
    o[2] = { ...o[2], coveredCents: P, pendingCents: 0 }
    const selection = sel(0, 1)
    expect(tapCell(o, selection, 2, free)).toBe(selection)
  })

  it('sobre celdas del sistema se comporta igual que en to_end (inicio mantenido, final donde se tocó)', () => {
    const sel0 = sel(0, 5)
    expect(tapCell(carga(), sel0, 10, free)).toEqual(tapCell(carga(), sel0, 10, { preSystemOpen: true }))
    expect(tapCell(carga(), sel0, 10, free)).toEqual(sel(0, 10))
  })

  it('"to_end" es el default y no cambió: tocar una previa marca hasta el mes actual (ficha)', () => {
    expect(tapCell(carga(), null, 2, { preSystemOpen: true })).toEqual(sel(2, 9))
    expect(tapCell(carga(), null, 2, { preSystemOpen: true, preMode: 'to_end' })).toEqual(sel(2, 9))
  })

  it('"to_end" ignora `fresh`: el modo de la ficha no se altera', () => {
    expect(tapCell(carga(), sel(4, 9), 6, { preSystemOpen: true, fresh: true })).toEqual(sel(6, 9))
  })
})

describe('dragSelect', () => {
  it('de una previa a otra: rango entre las dos', () => {
    expect(dragSelect(carga(), 0, 5)).toEqual(sel(0, 5))
  })

  it('en cualquier sentido: arrastrar de derecha a izquierda da el mismo rango', () => {
    expect(dragSelect(carga(), 5, 0)).toEqual(dragSelect(carga(), 0, 5))
  })

  it('una sola celda (mantener apretado sin mover) = esa celda', () => {
    expect(dragSelect(carga(), 3, 3)).toEqual(sel(3, 3))
  })

  it('un arrastre que llega a un mes del sistema arranca en la previa de donde salió', () => {
    expect(dragSelect(carga(), 7, 10)).toEqual(sel(7, 10))
  })

  it('nadie salta meses: si el extremo viejo es del sistema, arranca en el primer mes elegible del sistema', () => {
    const o = [
      opt({ period: '2026-08-01', kind: 'monthly', coveredCents: P }),
      opt({ period: '2026-09-01', kind: 'monthly' }),
      opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true }),
      opt({ period: '2026-11-01', kind: 'projected' }),
    ]
    expect(dragSelect(o, 3, 3)).toEqual(sel(1, 3))
    expect(dragSelect(o, 2, 3)).toEqual(sel(1, 3))
  })

  it('las celdas sin pendiente de los extremos se recortan', () => {
    const o = carga()
    o[0] = { ...o[0], coveredCents: P, pendingCents: 0 }
    o[5] = { ...o[5], coveredCents: P, pendingCents: 0 }
    expect(dragSelect(o, 0, 5)).toEqual(sel(1, 4))
  })

  it('null si no queda ninguna elegible, o un índice fuera de rango', () => {
    const o = carga().map((c) => ({ ...c, coveredCents: c.amountCents, pendingCents: 0 }))
    expect(dragSelect(o, 0, 3)).toBeNull()
    expect(dragSelect(carga(), 0, 99)).toBeNull()
    expect(dragSelect(carga(), -1, 2)).toBeNull()
  })

  it('dos meses pagados sin ninguna elegible del sistema devuelven null (no inventa rango)', () => {
    const o = [opt({ period: '2026-09-01', kind: 'monthly', coveredCents: P }), opt({ period: '2026-10-01', kind: 'monthly', coveredCents: P })]
    expect(dragSelect(o, 0, 1)).toBeNull()
  })
})

describe('preCellRole', () => {
  it('ene–jun: ene..jun son "marked", jul..oct "owed", los proyectados null', () => {
    const selection = sel(0, 5)
    const eff = effectiveOptions(carga(), selection, { creditCents: 0 })
    const roles = eff.map((_, i) => preCellRole(eff, selection, i))
    expect(roles).toEqual([...Array(6).fill('marked'), ...Array(4).fill('owed'), null, null])
  })

  it('sin tramo (selección en el sistema): null en todas', () => {
    const selection = sel(10, 10)
    const eff = effectiveOptions(carga(), selection, { creditCents: 0 })
    expect(eff.map((_, i) => preCellRole(eff, selection, i)).every((r) => r === null)).toBe(true)
  })

  it('una previa anterior a F no tiene rol', () => {
    const selection = sel(3, 5)
    const eff = effectiveOptions(carga(), selection, { creditCents: 0 })
    expect(preCellRole(eff, selection, 0)).toBeNull()
    expect(preCellRole(eff, selection, 3)).toBe('marked')
  })

  it('una previa que el saldo a favor ya cubrió (pendiente 0) da null: no hay nada que marcar ni que deber', () => {
    const selection = sel(0, 5)
    const eff = effectiveOptions(carga(), selection, { creditCents: P })
    expect(preCellRole(eff, selection, 0)).toBeNull()
    expect(preCellRole(eff, selection, 1)).toBe('marked')
  })
})

describe('openingScope', () => {
  it('ene–jun de ene..oct: desde enero, 10 meses, pagó 6 · $60.000, queda debiendo 4 · $40.000', () => {
    expect(openingScope(carga(), sel(0, 5), { creditCents: 0 }, { payment: true })).toEqual({
      fromPeriod: '2026-01-01',
      months: 10,
      sumCents: 10 * P,
      payment: true,
      paidMonths: 6,
      paidCents: 6 * P,
      owedMonths: 4,
      owedCents: 4 * P,
    })
  })

  it('null sin tramo', () => {
    expect(openingScope(carga(), sel(10, 10), { creditCents: 0 }, { payment: true })).toBeNull()
  })

  it('en la ficha (payment false) lo dice en el alcance', () => {
    expect(openingScope(carga(), sel(0, 9), { creditCents: 0 }, { payment: false })?.payment).toBe(false)
  })
})

describe('cellTone / selectionSummary / coverLabel con openingFrom vs legacy', () => {
  const withSpan = (partial: Partial<PaymentMonthOption> = {}) =>
    opt({ period: '2026-03-01', kind: 'opening_balance', openingFrom: '2026-01-01', ...partial })
  const legacy = (partial: Partial<PaymentMonthOption> = {}) => opt({ period: '2026-09-01', kind: 'opening_balance', amountCents: 3 * P, ...partial })

  it('isLegacyOpening: solo el saldo sin tramo', () => {
    expect(isLegacyOpening(legacy())).toBe(true)
    expect(isLegacyOpening(withSpan())).toBe(false)
    expect(isLegacyOpening(opt({ period: '2026-10-01', kind: 'monthly' }))).toBe(false)
  })

  it('con tramo se pinta como una cuota cualquiera: debe, parcial, pagada', () => {
    expect(cellTone(withSpan())).toBe('due')
    expect(cellTone(withSpan({ coveredCents: 400_000 }))).toBe('partial')
    expect(cellTone(withSpan({ coveredCents: P }))).toBe('paid')
  })

  it('la legacy conserva "opening_balance" (y pagada, "paid")', () => {
    expect(cellTone(legacy())).toBe('opening_balance')
    expect(cellTone(legacy({ coveredCents: 3 * P }))).toBe('paid')
  })

  it('una previa con pendiente 0 (cubierta por saldo a favor) es "covered"; con pendiente es "pre_system"', () => {
    expect(cellTone(opt({ period: '2026-01-01', kind: 'pre_system' }))).toBe('pre_system')
    expect(cellTone(opt({ period: '2026-01-01', kind: 'pre_system', coveredCents: P }))).toBe('covered')
  })

  it('selectionSummary: las celdas del saldo con tramo cuentan como meses; la legacy no', () => {
    const spanCells = [withSpan({ period: '2026-03-01' }), withSpan({ period: '2026-04-01' }), opt({ period: '2026-05-01', kind: 'monthly' })]
    expect(selectionSummary(spanCells, sel(0, 2))).toMatchObject({ monthsCount: 3, hasOpeningBalance: false, rangeLabel: 'marzo a mayo 2026' })
    const leg = [legacy(), opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true })]
    expect(selectionSummary(leg, sel(0, 1))).toMatchObject({ monthsCount: 1, hasOpeningBalance: true })
  })

  it('coverLabel: con tramo incluye esos meses; con legacy los saltea', () => {
    const spanCells = [withSpan({ period: '2026-03-01' }), withSpan({ period: '2026-04-01' })]
    expect(coverLabel(spanCells, sel(0, 1))).toBe('mar–abr')
    const leg = [legacy(), opt({ period: '2026-10-01', kind: 'monthly', isCurrent: true })]
    expect(coverLabel(leg, sel(0, 1))).toBe('oct')
  })
})

describe('coverageForAmount con tramo', () => {
  it('arranca en F: las previas anteriores a F no entran aunque sobre plata', () => {
    // F = abr (idx 3): ene..mar no existen para este pago.
    const r = coverageForAmount(carga(), sel(3, 4), 100 * P, { creditCents: 0 })
    expect(r.fullyCovered).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(r.fullyCovered.some((i) => i < 3)).toBe(false)
    expect(r.leftoverCents).toBe(100 * P - 9 * P)
  })

  it('"otro monto" cubre de F en orden y deja la parcial en el mes siguiente', () => {
    const r = coverageForAmount(carga(), sel(0, 5), 3 * P + 250_000, { creditCents: 0 })
    expect(r.fullyCovered).toEqual([0, 1, 2])
    expect(r.partial).toEqual({ index: 3, cents: 250_000 })
    expect(r.leftoverCents).toBe(0)
  })

  it('con total corregido, las partes mandan: un monto igual al total cubre todo el tramo', () => {
    const r = coverageForAmount(carga(), sel(0, 5), 9_000_000, { creditCents: 0, openingBalanceOverrideCents: 9_000_000 })
    expect(r.fullyCovered).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(r.partial).toBeNull()
    expect(r.leftoverCents).toBe(0)
  })

  it('un peso menos que el total corregido: el último mes del tramo queda parcial', () => {
    const r = coverageForAmount(carga(), sel(0, 5), 8_999_999, { creditCents: 0, openingBalanceOverrideCents: 9_000_000 })
    expect(r.fullyCovered).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(r.partial).toEqual({ index: 9, cents: 899_999 })
  })

  it('el monto derivado de lo marcado cubre justo lo marcado (sin parcial ni sobrante)', () => {
    const ctx = { creditCents: 0 }
    const amount = derivedAmountCents(carga(), sel(0, 5), ctx)
    const r = coverageForAmount(carga(), sel(0, 5), amount, ctx)
    expect(r).toEqual({ fullyCovered: [0, 1, 2, 3, 4, 5], partial: null, leftoverCents: 0 })
  })
})
