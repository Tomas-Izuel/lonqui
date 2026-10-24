# 02 — Desarrollo frontend: ficha (F2)

## Hecho
- `src/views/members/opening-balance-months.tsx` (nuevo, Client Component): al montarse llama `getPaymentMonthOptions({ memberId })` y filtra `kind === 'pre_system'`. Estados: carga (`LoadingList`), error con "Reintentar" (`ErrorState`), vacío ("No hay meses anteriores para indicar"). Renderiza `MonthStrip` con `preSystem` abierto fijo (`onToggle` no-op), `coverage={null}`, selección por `tapCell(..., { preSystemOpen: true })`. Resumen "julio a septiembre 2026 · $30.000", aviso de saldo a favor (`creditCents` desde la ficha: cubre todo / parte). Botón "Cargar saldo anterior de $X" -> `createOpeningBalanceFromMonths({ memberId, fromPeriod, toPeriod, amountCents })` (from/to y monto de `openingBalanceFromSelection`, con override) -> toast "Saldo anterior cargado" + `router.refresh()`. `<form method="post">`. Doble envío bloqueado con `pending`.
- `member-account-section.tsx`: nueva prop `joinedOn: ISODate`. Se eliminó el formulario por monto, su schema y la importación de `createOpeningBalance`. Reglas: `openingBalance != null` -> "Ya tiene un saldo anterior cargado: $X"; si no y `canRegister && billing.active && startPeriod != null && startPeriod <= currentPeriod && joinedOn.slice(0,7) <= startPeriod.slice(0,7)` -> botón "Indicar desde cuándo debía"; si no, nada.
- `.impeccable/surfaces/route-socios-id.md`: párrafo actualizado.

## Criterios de aceptación implementados
Ver 01-tasks.md F2. Accesibilidad: botones `h-11`, errores con `role="alert"`, carga con `role="status"` (LoadingList).

## Decisiones
- El error de campo `amountCents` del servidor se muestra con `role="alert"` justo debajo de la tira, que es donde vive el campo "Total del saldo anterior" (lo renderiza `MonthStrip`, no esta vista). Si F1 expone una prop de error en `MonthStrip`, conviene moverlo ahí.
- Sin react-hook-form: el único campo editable es el override que maneja `MonthStrip` por callback.

## Integración pendiente
- `member-detail-view.tsx` ya pasa `joinedOn={member.joinedOn}` (verificado en el árbol al terminar); no queda nada pendiente ahí.

## Estado de dependencias al cerrar
- `src/views/payments/month-strip.tsx` y `month-selection.ts` (F1) NO existían: codeado contra el contrato (§F1 y §10). Alinear firmas cuando aterricen.
- `getPaymentMonthOptions` / `createOpeningBalanceFromMonths` (B1) NO estaban exportadas aún en `payments.actions.ts`.
- `npm run typecheck`: los únicos errores de mi archivo son los imports faltantes de F1/B1 (más los `any` implícitos derivados); `payments.actions.ts` falla por `monthOptions` (B1). `npm run lint`: 0 errores.

## Cierre (post F1/B1)
- Typecheck del árbol completo pasa; `eslint src/views/members` sin hallazgos. Firmas reales de `MonthStrip`/`month-selection` coinciden con lo codeado. `tapCell(..., { preSystemOpen: true })` devuelve `{ startIndex: index, endIndex: último pre_system }` (con el pliegue cerrado no cambia nada), que es lo que esta vista usa. No reuso `MonthEntry`/`summaryText`: la ficha no tiene monto de pago ni "otro monto", y el resumen propio ("julio a septiembre 2026 · $X") es más corto que duplicar el estado de `EntryState`.
- Verificación en navegador NO hecha: el admin local de los scripts (`admin@lonqui.test`) no existe en la base; el único usuario es de la cuenta personal de Tomás y no quise crear/alterar usuarios. Casos para probar a mano (base local, inicio de facturación 2026-10-01): socio 10 (alta feb 2026, sin saldo) para el flujo completo; socio 8 (saldo a favor, sin saldo anterior) para el aviso de cobertura; 390px y 1280px.
- Ajuste F1: `preSystem` sin `onToggle` (sin botón de pliegue; línea propia "Meses de antes de <mes>") y `setOverrideCents(null)` en cada tap.
- Ajuste F1: `onValidityChange` conectado; el botón se deshabilita con total inválido (y se rehabilita al tocar otro mes).
