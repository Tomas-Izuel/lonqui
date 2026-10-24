# 03 — Tests: Registrar pago por meses, con "desde cuándo"

Veredicto: **SUITE GREEN** (tercera ronda, post-review: `npm test` 76 archivos, 1495 pasan, 1 salteado preexistente; `tsc` sin errores en `tests/`).

## Agregado
- `tests/db/payment-months-fixtures.ts` (helpers; todo relativo al mes actual de la base, nunca hardcodeado).
- `tests/db/payment-month-options.test.ts` (20): sin facturación / inicio futuro -> 0 filas; ventana con parcial + actual + 6 proyectados; al día; dos deportes = una celda sumada (y parcial por un solo deporte); baja sin proyectados; saldo a favor 1,5 cuotas aplicado en orden y suma = crédito; un peso menos; valor programado (`priced_at_today = false`); `pre_system` (12 filas, borde de alta <= inicio, saldo vigente / cubierto / anulado); grupo en una llamada; `consulta` y `user_metadata` -> 42501; anon/PUBLIC sin EXECUTE; INVOKER.
- `tests/db/register-payment-batch.test.ts` (23): camino feliz (period por trigger, created_by, descripción); grupo con dos saldos (cada fee_id en la fila de su socio); auditoría con actor de sesión; atomicidad (monto 0 y FK en el INSERT de pagos); idempotencia por `batch_id`; 23505 `fees_one_opening_balance`; `to_period` = inicio / posterior / límite inicio-1; from > to; monto <= 0; sin facturación; fecha futura; lote vacío / no-array / sin batch_id; `consulta`, `user_metadata`, anon; deuda derivada tras crear el saldo anterior (caso de Tomás).
- `tests/views/payments/month-selection.test.ts` (49), sin DOM.
- `tests/lib/dates.test.ts`: `periodRangeLabel` (4).
- Actualizados por B1: `tests/models/payments.model.test.ts` (reescrito el bloque de `registerPayment` a la RPC, esquema con `openingBalance` y duplicados), `tests/models/fees.model.test.ts`, `tests/models/accounts.model.test.ts`, `tests/controllers/payments.actions.test.ts` (mocks de `getPaymentMonthOptions` / `createOpeningBalanceFromMonths`, `monthOptions` agrupado en una sola llamada).
- `grants-and-lockdown.test.ts`: sin cambios, sigue verde con las funciones nuevas.

## Tercera ronda: post-review (bloqueante del crédito contado dos veces)
- DB (`register-payment-batch.test.ts`): caso de punta a punta (crédito $30.000, oct pago, nov/dic cubiertos; lote con saldo jul-sep $30.000 + pago $40.000 -> cubierto hasta enero; con $20.000 solo hasta noviembre; con $20.000-1 noviembre parcial), reintento devuelve el `opening_balance_fee_id` original, `from/to_period` que no son día 1 -> `check_violation`.
- Unit (`month-selection.test.ts`, 64): el fixture `withPreSystem` queda documentado como "crédito 0" (consistente con la RPC) y se agrega `withCredit()` que espeja la RPC con crédito (proyectados cubiertos en orden). Reescritos los tests que pinneaban la fórmula vieja (`creditCents` restado del saldo anterior). Nuevos: caso del review (`derivedAmountCents` = 4.000.000), contraste "otro monto" $20.000 -> hasta noviembre, `effectiveOptions` (null = misma referencia, largo/orden estables, pre_system intactas, sin mutar, saldo mayor y menor que el pozo, conservación del pozo), `optionsForSelection`, `coverLabel` "jul 26–ene 27".
- Acción `createOpeningBalanceFromMonths`: ahora valida `toPeriod < inicio` y facturación activa (hallazgo 3 del review); tests agregados.
- `extendToDueMonths` (7 tests): debe octubre sin crédito -> extiende; octubre pago con pozo de sobra -> no; crédito que deja octubre elegible -> extiende; saldo corregido menor al pozo -> no; selección que no arranca en pre_system igual (misma referencia); final en adelanto no se acorta; solo extiende por `monthly`.
- Render: sin cambios necesarios, siguen verdes con el markup nuevo.

## Segunda ronda: render de vistas (sin DOM, `renderToStaticMarkup`)
- `tests/views/payments/payment-views.render.test.ts` (15): `MonthStrip` (aria-pressed solo en marcadas, celda pagada deshabilitada, `sr-only` con mes/año/estado, "adelanto · $15.000" para valor programado, nota "valor de hoy", cobertura de "Otro monto", pliegue pre_system) y `PaymentForm` (sin opciones = campo Monto y sin tira; con opciones = tira + "Otro monto" + resumen; botón nombra el monto; `method="post"`; sin `window.confirm`/`needsOverpayConfirm` en `payment-form` ni `group-payment-form`; baja con deuda marca todo).
- `tests/views/members/member-account-section.test.ts` (9): "Indicar desde cuándo debía" según alta (<= inicio), saldo vigente, facturación activa/inactiva/futura y `canRegister`; ya no existe "Cargar saldo anterior"; `OpeningBalanceMonths` solo en estado inicial (los efectos no corren en render estático).
- Decidido por coordinación: el copy con año ("agosto a octubre 2026") queda.

## Hallazgos / ambigüedades (ningún test fallado)
1. (Resuelto: se queda con año.) **Año en el resumen.** F1 y §10 escriben "3 meses · agosto a octubre", pero `selectionSummary` usa `periodRangeLabel` y devuelve "agosto a octubre 2026" (el contrato de T0 para `periodRangeLabel` lleva el año). Pinneé lo implementado; decidir cuál es el copy correcto (dueño: F1 si el brief manda).
2. `tapCell` ignora un pre_system tocado con `preSystemOpen: false` (el spec no lo dice; es inocuo porque esas celdas no se ven).
3. En un reintento por `batch_id` la RPC devuelve `opening_balance_fee_id = null` (el saldo ya existía); el modelo devuelve `openingBalanceFeeIds: []`. Pinneado en el test del modelo.

## No cubierto (pendiente, declarado)
- Concurrencia real del mismo `batch_id` en dos conexiones: exige commitear y `audit_log` es append-only; el advisory lock queda sin prueba concurrente. Sí está el reintento secuencial.
- Interacción de componentes (taps, envío, `OpeningBalanceMonths` tras el fetch, `MonthEntry.showTotal`, `group-payment-form` renderizado): sin DOM interactivo; solo render inicial y la lógica pura.
- Los tests de DB cambian `settings.billing_start_period` con `alter table ... disable trigger settings_billing_guard` dentro del rollback (el stack local tiene cuotas generadas y `postgres` no es superusuario); depende de `singleFork`.
