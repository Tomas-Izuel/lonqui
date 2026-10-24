# 02 — Desarrollo frontend (F1): tira de meses y formularios de pago

Pipeline `2026-10-24-pago-por-meses`. Lane `frontend`, tarea **F1**. Typecheck y lint limpios en `src/views/payments/**`.

## Archivos

- `src/views/payments/month-selection.ts` (nuevo): lógica pura de 00 §10.
- `src/views/payments/month-strip.tsx` (nuevo, client): la tira.
- `src/views/payments/month-entry.tsx` (nuevo, client; NO estaba en el plan): tira + resumen + "Otro monto" de UN socio, compartido por el pago individual y por cada fila del grupo. Es controlado: el estado (`EntryState`) vive en el formulario para leerlo al enviar.
- Modificados: `payment-form.tsx`, `group-payment-form.tsx`, `register-payment-sheet.tsx`. `payment-schema.ts` sin tocar (no hizo falta espejo de `openingBalance`: el cliente no lo valida, el servidor sí).
- `.impeccable/surfaces/route-caja.md`: párrafo del overlay, estados y anti-objetivo reescritos.

## Contratos finales

`MonthStrip` — igual al plan de F1:
`options, selection, onTap(index), variant?: 'default'|'compact' (default 'default'), preSystem: {open, onToggle, startPeriod, overrideCents, onOverrideChange} | null, coverage: {fullyCovered, partial} | null, disabled?`.
Detalles: `onTap` recibe el índice sobre el array COMPLETO. El botón del pliegue ("¿Debe meses de antes de octubre 2026?") va ARRIBA de la grilla y solo se muestra si hay celdas `pre_system`; con el pliegue abierto las celdas previas se intercalan antes de las del sistema. El campo "Total del saldo anterior" y la nota "Los meses de adelanto se cobran al valor de hoy" los dibuja la propia tira. `compact` baja el alto de celda a 44px (default 64px). El `coverage` pisa el marcado: las celdas cubiertas dicen "se cubre" / "cubre $X de $Y".

`month-selection.ts` — todo 00 §10 con las firmas pedidas (`cellTone`, `isSelectable`, `firstSystemIndex`, `defaultSelection`, `tapCell(options, selection, index, {preSystemOpen})`, `closePreSystem`, `selectedOptions`, `openingBalanceFromSelection`, `derivedAmountCents`, `coverageForAmount`, `selectionSummary`). Agregados (aditivos):
- `selectedIndexes`, `summaryText(summary)` ("3 meses · agosto a octubre"), `coverLabel(options, selection)` ("ago–oct", "nov 25–feb 26").
- `selectionSummary` devuelve además `hasOpeningBalance`; con saldo anterior vigente marcado el `rangeLabel` es "saldo anterior" o "saldo anterior y agosto a octubre". `monthsCount` no cuenta el `opening_balance` pero sí los `pre_system`.
- Semántica que fijé donde 00 §10 era ambiguo: `tapCell` sobre `pre_system` con el pliegue cerrado no cambia nada; el `end` se conserva solo si `end >= index` y no es adelanto, si no pasa al último `pre_system`. `closePreSystem` deja `start = firstSystemIndex`. `coverageForAmount` reparte el saldo anterior elegido (neto de saldo a favor) entre sus celdas previas, con la última absorbiendo el resto.

`PaymentForm({ member, options, onDone, onSuccess(amountCents, label?) })`; `GroupPaymentForm({ members, monthOptions, familyGroup, onDone, onSuccess(total, label?) })`. `RegisterPaymentSheetBody` pasa `monthOptions[memberId] ?? []`.

## Comportamiento implementado (para T1)

- Con `options` vacío: campo "Monto" + fecha + medio, sin chips, envía `openingBalance: null`. Precarga como antes (cuota, o la deuda si es baja con deuda).
- Con opciones: selección inicial = primer mes sin pagar (baja con deuda: toda la deuda). Monto derivado en grande; botón "Registrar pago de $X". Sin opciones elegibles arranca directo en "Otro monto".
- "Otro monto": `AmountField` (autofocus en el individual, no en la fila compacta), la tira muestra la cobertura en vivo, `role="status"` "Queda saldo a favor de $X" si sobra, botón "Volver a elegir por meses"; tocar un mes también vuelve al derivado.
- Derivado = $0 en modo meses (saldo a favor cubre lo marcado): aviso "El saldo a favor ya cubre esos meses. Indicá desde cuándo debía desde la ficha." (o "Marcá al menos un mes.") y el botón del formulario individual queda deshabilitado. En el grupo, la fila con monto 0 falla la validación existente ("mayor a cero") y el error se muestra en la fila.
- Envío: `items[].openingBalance = {fromPeriod,toPeriod,amountCents}` si hay `pre_system` marcados (sale de `entryOpeningBalance`), si no `null`. Un error de `items` se muestra en el campo de monto solo si está visible; si no, como error del formulario.
- Se eliminó `needsOverpayConfirm` y las dos cajas de confirmación. No hay `window.confirm`.
- Éxito: toast ("Pago registrado. Todavía debe / Queda saldo a favor / La cuenta quedó al día", que ahora suma el saldo anterior creado) y momento con "Cubre ago–oct" o "Pago a cuenta". Grupo: sin label.
- A11y: celdas `button` con `aria-pressed` (solo si son elegibles), texto visible `aria-hidden` y `sr-only` "julio 2026: debe, marcado"; las no elegibles van `disabled` y dicen "no se puede marcar". Pliegue con `aria-expanded`. Targets: celdas 64px (default) / 44px (compact), botones 44px. Todo `<form method="post">` intacto.
- Visibilidad por rol: sin cambios (el overlay ya solo lo abre quien tiene `payments.register`).

## Verificación (navegador, dev server local, backend ya aplicado)

Playwright a 390px y 1280px: sin scroll horizontal en individual ni grupo; celdas de 64px; se abrió el pliegue, "julio" marcó julio–septiembre, total del saldo anterior $30.000 editable, "Otro monto" con coverage. **Registro real** de un socio con alta anterior (jul–sep + octubre, $40.000): la RPC creó `Saldo anterior · julio a septiembre 2026` por $30.000 y el pago de $40.000. Grupo de 3 integrantes con tira compacta renderiza bien a 390px (arreglado: el ícono de marcado se superponía con "Sept 2026"; ahora va absoluto arriba a la derecha y el año envuelve).

## Sin verificar / pendientes

- Captura de escritorio con el sheet en reposo (la que tomé cayó a mitad de la animación del overlay); el layout es el mismo `max-w-xl`.
- No probé: socio de baja con deuda, valor programado distinto en un mes futuro (nota "al valor de hoy" cuando `pricedAtToday` es falso no tiene texto propio: solo se muestra la nota general si alguna marcada es `pricedAtToday`), doble toque real con el mismo `batchId`, ni el caso de saldo a favor que cubre todo (solo por lógica).
- Con 12 meses previos abiertos el resumen/monto queda varias pantallas más abajo en el celular (la grilla es alta). Si molesta, sugerencia: resumen fijo al pie del sheet (toca el sheet, no es de esta lane).
- Primitivas nuevas en `shared/`: ninguna. Decisión a confirmar: el botón del pliegue va arriba de la grilla, no abajo.

## Ronda 2 (pedido del hilo principal)

- **Pie fijo**: en `payment-form.tsx` y `group-payment-form.tsx` el final del `<form>` es un `div` `sticky bottom-0 -mx-4 -mb-4` con fondo `bg-background`, borde superior 1px y `pb-[calc(0.75rem+env(safe-area-inset-bottom))]`. Contiene la línea de resumen (individual: "1 mes · noviembre 2026", "Pago a cuenta", o "Pago a cuenta · queda saldo a favor de $X"; grupo: "N integrantes" + "Total $X"), el error del formulario y el botón "Registrar pago de $X". `MonthEntry` ganó `showTotal` (default true): el individual lo pasa en false (el monto vive en el botón); las filas del grupo mantienen su monto por integrante. Se quitó la fila "Total del lote" del grupo (ahora está en el pie). Verificado a 390px con el pliegue de 12 meses abierto: el botón queda a la vista (borde inferior a 796 de 844).
- **Valor programado**: celdas `projected` con `pricedAtToday = false` dicen "adelanto · $12.000" / "este mes · $12.000".
- **Verificación** (390 y 1280): baja con deuda (dado de baja desde la UI): marca toda la deuda (1 mes), sin adelantos, sin sobrante de meses futuros; doble clic rápido en el botón: un solo pago en la base; escritorio con el sheet quieto: el pie sticky funciona dentro del diálogo. Sin verificar: celda con valor programado (no hay uno cargado en la base local; es solo texto).

## Ronda 3 (post-review, `03-review.md`)

- **#1 bloqueante (saldo a favor contado dos veces)**: `month-selection.ts` ahora tiene `effectiveOptions(options, openingAmountCents|null, creditCents)` y `optionsForSelection(options, selection, ctx)`. Con saldo anterior elegido se re-corre balance forward con UN pozo (Σ `coveredCents` de las celdas que no son `pre_system` + el saldo a favor que no cayó en proyectadas) y el saldo anterior como cargo más viejo; mismo largo y orden que `options`, así que los índices valen en ambos arrays. `derivedAmountCents` y `coverageForAmount` reciben las opciones de la RPC y operan sobre las efectivas por dentro; `selectionSummary`, `coverLabel`, `tapCell` y la tira se alimentan con `optionsForSelection(...)` (lo hace `MonthEntry`). Caso del review (crédito $20.000, oct pago, nov/dic cubiertos, saldo anterior jul–sep $30.000, tocar enero) = $40.000 (probado con un script; en el navegador con un socio real: el total y la cobertura coinciden, octubre vuelve a "falta" y los adelantos dejan de decir "cubierto"). Limitación conocida: las celdas viejas ya pagadas que quedan fuera de la ventana de la RPC no se pueden re-evaluar (el pozo las ignora).
- **#2 reintento**: con `alreadyRegistered` los dos formularios muestran `result.data.totalCents` sin "Cubre…", y si el ítem llevaba saldo anterior y `openingBalanceFeeIds` no lo trae, un toast avisa que se indique desde la ficha.
- **#4**: `OpeningTotalField` muestra "Ingresá un monto válido" (con `aria-invalid`) si lo tipeado no se lee o es 0, anula el override y avisa por `preSystem.onValidityChange?(valid)`; `EntryState.overrideInvalid` frena el botón en ambos formularios. El texto vuelve a la suma cuando cambian los meses marcados. Para la ficha (F2): `onValidityChange` es opcional; si no lo usa, con texto inválido el envío usa la suma de las celdas.
- **#6** la nota de adelanto excluye `isCurrent`. **#13** "Agregar nota" `min-h-11`.
- **Ruido visual**: las celdas `pre_system` muestran mes, año e ícono; el texto "antes del sistema" queda en el `sr-only`.

## Ronda 4 (re-review R2)

- **R2-1**: `MonthStripPreSystem.onChange?(cents: number | null, valid: boolean)` emite total y validez en UN solo callback; si está, la tira no llama a `onOverrideChange` ni a `onValidityChange` (siguen existiendo, compatibles con F2). `MonthEntry` usa solo `onChange`, así que cada tecla es un único cambio de estado (el grupo hereda el arreglo). Verificado: tipear $250 en el total deja el botón en $10.250 y la base registra saldo anterior $250 + pago $10.250 (antes se mandaba la suma).
- **R2-2**: `extendToDueMonths(options, selection, ctx)` en `month-selection.ts`; `MonthEntry` lo aplica al tocar una celda previa: el final se extiende como mínimo hasta la última cuota `monthly` que queda elegible en las opciones efectivas. Tocar julio en un socio que debe octubre da "4 meses · julio a octubre" y $40.000. La pista "indicá desde la ficha" solo sale con derivado $0 (nada que pagar).
- **R2-3**: `coverageForAmount` ya no reasigna su parámetro (se llama `rawOptions`).
