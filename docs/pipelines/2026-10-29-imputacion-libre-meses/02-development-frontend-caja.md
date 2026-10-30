# 02 — Frontend caja (T2: grilla y formularios de pago)

## Hecho (F1–F5)
- F1 `src/views/payments/month-selection.ts` reescrito: `Selection = number[]` (conjunto). Exporta: `isMarked`, `isSelectable`, `cellTone`, `firstSystemIndex`, `isBeforeStart`, `firstJoinedIndex`, `openingSpan`, `beforeJoinedWarning`, `splitOpeningTotal`, `openingMonthsFromSelection(options, selection, overrideCents?)`, `effectiveOptions(options, selection, ctx)`, `isCharged(options, selection, index)`, `advancesAllowed(options, selection, ctx?)`, `advancesAllowedOn(effective, selection)`, `toggleCell(options, selection, index, {preSystemOpen, ctx?}) -> {selection, blocked?}`, `paintRange(options, base, anchor, over, {preSystemOpen, ctx?})`, `unmarkPreSystem`, `defaultSelection`, `selectedOptions`, `markedPeriodsFromSelection`, `derivedAmountCents`, `coverageForAmount`, `debtAfterPayment(options, selection, ctx, otherAmountCents?)`, `preCellRole`, `openingScope`, `selectionSummary` (`hasOpeningMonths`), `summaryText`, `coverLabel`. Todas reciben opciones CRUDAS salvo `preCellRole` y `advancesAllowedOn` (efectivas). Eliminadas: tapCell, dragSelect, closePreSystem, optionsForSelection, openingBalanceFromSelection, isLegacyOpening, selectedIndexes. `CellTone` ya no tiene `opening_balance`.
- F2 `use-month-drag.ts`: `onDragStart(anchor)` al armar. `month-drag.ts` sin cambios.
- F3 `month-strip.tsx`: props nuevas `onDragStart`, `joinedWarning: {joinedPeriod: ISODate|null, memberId}|null`; `coverage` = `CoverageResult`; adelantos bloqueados con `aria-disabled` + aviso `role="status"`; ayuda nueva; aviso de alta con Link a `/socios/<id>/editar`. Recibe opciones EFECTIVAS.
- F4 `month-entry.tsx` (nueva prop `memberId`), `payment-form.tsx`, `group-payment-form.tsx` mandan `markedPeriods`/`openingMonths` (null si vacío; también en "Otro monto"). `register-payment-sheet.tsx`: error con "Reintentar" (incluye el gate de schema). `payment-schema.ts` sin cambios.
- F5 brief `route-caja.md` actualizado.

## Decisiones no obvias
- Default activo sin cuota adeudada = `[]`: `custom` solo si no hay ningún mes elegible.
- En "Otro monto", marcar meses no sale del modo (las marcas son prioridad de imputación).
- Un mes marcado siempre se puede desmarcar, aunque el saldo a favor ya lo cubra.
- `joinedPeriod` no está en `MemberAccount`/`PaymentFormData`: se deduce de la primera previa con `beforeJoined=false`; si no hay, el aviso va sin mes. Sugerencia cross-lane: exponer `joinedOn`.
- Éxito en "Otro monto": "Cubre …" solo con los marcados cubiertos completos.

## Verificado
typecheck y eslint limpios en `src/views/payments`. Sanidad de month-selection con vite-node. Navegador local (~500 px): abre el sheet, desmarcar el mes adeudado atenúa los adelantos y descarta los marcados. NO verificado: arrastre, iOS/Android, registrar contra el backend nuevo, grupo, gate, aviso de alta. Tests viejos de tests/views/payments quedan rotos (T4).
