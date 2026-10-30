# T3 — Frontend ficha del socio y auditoría

## Archivos
- `src/views/members/opening-balance-months.tsx`: reescrito contra F1 (`Selection = number[]`). Importa `firstJoinedIndex`, `openingMonthsFromSelection`, `openingScope`, `isBeforeStart`, `type Selection` de `@/views/payments/month-selection`; `createOpeningBalanceMonths` de `payments.actions`. Props nuevas: `joinedOn`, `hasOpeningBalance`.
- `member-account-section.tsx`: props `openingBalances: Fee[]` y `statement` (reemplazan `openingBalance`). Bloque "Saldo anterior · <periodListLabel> · $Σ · N meses pagos"; botón "Indicar desde cuándo debía" / "Agregar meses anteriores".
- `member-detail-view.tsx`: pasa `account.openingBalances` y `account.statement`.
- `member-fee-statement.tsx`: "Saldo anterior · <mes>".
- `member-payments-list.tsx`: "Cubre …" y "Saldo a favor $X"; anulado sin detalle.
- `member-account-answer.tsx`: sin cambios (ya dice "N meses", no asume contigüidad).
- `src/views/audit/audit-labels.ts`: `payment_allocations` (filtro "Imputaciones", "una imputación", frase sin nombre de socio, etiquetas de columnas).
- `.impeccable/surfaces/route-socios-id.md`: párrafo actualizado.

## Decisiones
- En la ficha no hay pago: tocar un mes previo REEMPLAZA la selección (`[index]`), tocarlo de nuevo la suelta. `from` lo calcula `openingMonthsFromSelection` (min(tocado, firstJoinedIndex)); los meses del tramo se crean todos. Preselección: `[firstJoinedIndex]` si ≠ -1.
- Aviso de alta: `beforeJoined = selection.some(i => options[i].beforeJoined)` calculado local (no dependo de `beforeJoinedWarning`); se pasa a `MonthStrip` como `joinedWarning={{ joinedPeriod: 'YYYY-MM-01', memberId }}`.
- Total del botón = Σ `openingMonthsFromSelection(...).amountCents` (incluye total corregido).
- Lista de pagos, más de 3 meses: corridos "Cubre 5 meses · enero a mayo 2026"; con huecos "Cubre 5 meses · entre enero y mayo 2026".
- Auditoría: la frase de `payment_allocations` ignora `recordLabel`. El verbo INSERT ("registró la imputación") vive en `views/shared/labels.ts` (`auditOpLabels`, no mío): quedó "Creó una imputación"; si se quiere el verbo específico, lo hace el hilo principal.

## Dependencias / integración pendiente (T1, T2 aún no aterrizaron)
- `month-selection.ts` todavía no exporta `firstJoinedIndex` ni `openingMonthsFromSelection`, y `Selection` sigue siendo el objeto viejo. Mi código asume las firmas de F1.
- Asumo que `openingScope(options, selection, ctx, { payment: false })` sigue existiendo (F1 no lo lista) y que `MonthStrip` acepta `joinedWarning` y `onTap(index)` con el mismo `preSystem` de hoy. Si T2 cambia eso, ajustar en `opening-balance-months.tsx`.
- `createOpeningBalanceMonths` aún no existe en `payments.actions.ts` (T1).
- Los tests viejos de `tests/views/members/member-account-section.test.ts` pasan `openingBalance` y no pasan `joinedOn`/`hasOpeningBalance`/`statement`: T4.

## Criterios implementados
- Botón "Cargar saldo anterior de $X (N meses)"; con alta anterior X = Σ desde el alta, con alta posterior X = Σ desde el tocado y aviso con link a `/socios/[id]/editar`.
- Sin celdas previas: "No quedan meses anteriores para agregar" (con filas) / "No hay meses anteriores para indicar".
- Roles: botones de carga solo con `canRegister`; "Anular" por fila solo con `canVoid`.
- A11y: botones 44 px, `role="alert"` en errores, estados loading/empty/error en la carga de celdas.

## Verificado / no verificado
- `eslint` limpio en `src/views/members` y `src/views/audit`. Typecheck: en mis archivos solo quedan los errores por firmas de T1/T2 pendientes. No probado en navegador (depende de T1/T2).

## Nits del review
- Comentario de `creditCents` reescrito (trigger imputa el saldo a favor a las filas nuevas) y ayuda afinada: "la deuda se cuenta desde ahí hasta <mes>. Si la fecha de alta es anterior, arranca en la fecha de alta."
