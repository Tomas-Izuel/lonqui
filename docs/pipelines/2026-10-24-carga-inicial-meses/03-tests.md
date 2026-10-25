# 03 — Tests (T4, parte Node) y cierre

**Veredicto: SUITE GREEN.** `npm run typecheck` limpio, `npm run lint` 0 errores (9 warnings previos de `_args`), `npm test` con stack local arriba: 81 archivos, 1697 passed, 1 skipped (el skip es preexistente).

## Tests viejos actualizados (la semántica nueva es la intencionada, ningún hallazgo)
- `tests/views/payments/month-selection.test.ts`: `extendToDueMonths` eliminado (bloque borrado, spec §7.1); `effectiveOptions` con la firma `(options, selection, ctx)`; las previas de F..P ahora absorben el pozo (no son las mismas referencias; sí las anteriores a F); `coverageForAmount` ya no lista como cubiertas por el pago las previas que el crédito cubrió (`[3,4]` en vez de `[0..4]`), reparto por partes del total corregido; `coverLabel`/`selectionSummary` arrancan en el primer mes marcable. El helper `opt` lleva `openingFrom: null`.
- `tests/views/payments/payment-views.render.test.ts`: `billingStarted` en `PaymentForm`; en grupo la grilla arranca colapsada (0 celdas, 3 "Cambiar").
- `tests/models/accounts.model.test.ts`: mapeo con `openingFrom: null` y caso `opening_from` presente / null / ausente. `tests/models/fees.model.test.ts`: el insert manda `from_period`/`to_period`.
- `tests/views/shared/responsive-sheet.test.ts`: 2 errores de lint preexistentes corregidos (displayName, children como argumento).

## Tests nuevos
- `month-selection.test.ts` (+62): `splitOpeningTotal` (resto al último, n=1, n<=0, total<n, invariante de suma), `openingSpan`, `openingBalanceFromSelection` (ene–jun de ene..oct: desde enero, hasta octubre, 10 meses u override), `derivedAmountCents` (override, resto, crédito, crédito > marcado), `debtAfterPayment` (4 meses · $40.000, corregido, crédito, adelanto no es deuda, mes actual sí, legacy), `tapCell` free (fresh, tocar-tocar, extender atrás, intermedia, achicar, única, pliegue cerrado) y `to_end` default sin cambios, `dragSelect`, `preCellRole`, `openingScope`, `cellTone`/`selectionSummary`/`coverLabel` con `openingFrom` vs legacy, `coverageForAmount` con tramo.
- `tests/views/payments/month-drag.test.ts` (nuevo, 36 con mouse/pen/dedo): arma por entrar en otra celda; dedo arma por 250 ms y tolerancia 8 px; scroll antes de armar descarta; `armed` NO emite `range` y soltar en la misma celda no descarta el click (fix del review #1); recién `enter` en otra celda emite el rango; `suppressClick` solo si hubo movimiento; `cancel`, `down` repetido, idle, `null`, pureza.
- `tests/views/payments/carga-inicial.render.test.ts` (nuevo): colapsada vs abierta, "Cambiar"/"Listo" con `aria-expanded`/`aria-controls`/`min-h-11`, "Queda debiendo", avisos de saldo existente con y sin `openingFrom` (solo con grilla abierta), "queda debiendo" con ícono en celdas, total rotulado y pista, ayuda de arrastre (con/sin `onRange`, ficha, deshabilitada), grupo colapsado, `method="post"`.
- `tests/db/opening-balance-months.test.ts` (+1): paridad TS/SQL de `splitOpeningTotal` contra las celdas de `payment_month_options` (8 pares total/n, hasta 36 meses). Verde contra el stack local; sin reset.

## No cubierto (declarado)
La interacción real de punteros (touch, scroll, pointer capture, `click` fantasma) no es testeable sin DOM: queda en la verificación manual de §11. Hallazgo 2 del review (`paidPoolCents` ignora cuotas pagas ocultas por la RPC) es un seguimiento que pide otra migración: no se testea el comportamiento actual para no fijar el defecto.

## Hallazgos para dev
Ninguno.
