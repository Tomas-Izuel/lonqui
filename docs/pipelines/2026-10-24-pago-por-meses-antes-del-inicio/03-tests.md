# 03 — Tests (T1)

## Agregado
- `tests/db/payment-month-options-before-start.test.ts` (8 tests, DB local, todo en `withRollback`): inicio = mes siguiente (12 pre_system con `is_current` solo en el mes actual + projected desde el inicio hasta actual+6); inicio a 3 meses; inicio null sin filas; socio de baja (pre_system si, projected no); fallback de precio (precondicion `priceToday = 0`, valor desde el inicio, celdas al valor del inicio); despues del inicio sin cambios; `register_payment_batch` con saldo anterior de solo el mes actual (periodo fijado por la base, deuda 0 con el monto exacto, 1 centavo con un peso menos).
- `tests/views/payments/month-selection.test.ts`: `isBeforeStart`, `defaultSelection` (activo e inactivo), `tapCell` (previo anterior, proyectado, desmarcar el primer previo -> null o solo sistema, sin selección), monto derivado, resumen "1 mes · octubre 2026", cover "oct", y que despues del inicio no cambia.
- `tests/views/payments/payment-views.render.test.ts`: tira y `PaymentForm` antes del inicio (línea "Las cuotas arrancan en noviembre 2026.", sin "¿Debe meses…?" ni `aria-expanded`, "este mes" con ícono y texto para lectores, selección inicial solo el mes actual).

## Modificado
- `tests/views/members/member-account-section.test.ts`: inicio futuro ahora SÍ muestra el botón; sigue oculto sin `payments.register` o con saldo anterior vigente.
- `tests/db/payment-month-options.test.ts`: se quitó "con el inicio en un mes futuro: 0 filas" (contradice la nueva política; cubierto por el archivo nuevo).

## Resultado
`npm test`: 77 archivos, 1531 pasan, 1 skipped (preexistente). `npm run typecheck` limpio. Sin hallazgos de bugs en producción.
Nota: la baja con `joined_on` futuro es imposible ("La fecha no puede ser futura"), por eso no hay test de alta posterior a un inicio futuro.

SUITE GREEN

## Ronda 2
- DB (`payment-month-options-before-start.test.ts`, ahora 11 tests): "inicio a 3 meses" reescrito (12 pre_system terminando en el mes actual con `is_current`, sin celdas entre actual e inicio, proyectados desde el inicio); inicio a 13 y 20 meses (12 celdas que terminan en el actual, sin proyectados); inicio pasado sin cambios (`inicio-12..inicio-1`, sin `is_current`); socio con saldo anterior vigente y inicio futuro: sin pre_system.
- Unit (`month-selection.test.ts`): selección por la celda `is_current` aunque haya un previo posterior en el arreglo; arreglo real de la RPC con inicio lejano (default, tocar previo, tocar proyectada, desmarcar con y sin proyectadas); resumen "octubre 2026"; ventana de 12 con el actual al final; crédito C con `{actual, actual}` (`derived = max(0, X − C)` con C menor/igual/mayor; `effectiveOptions` re-reparte el crédito: con C = 2P cubre nov y pasa dic y ene a pendientes).
- Render: `startPeriod` explícito ("Las cuotas arrancan en enero 2027." con el último previo en octubre), fallback sin `startPeriod`, `hideBeforeStartNote`, pago de grupo con 3 integrantes (línea una sola vez, 15 celdas) y sin línea después del inicio.
- NO cubierto: descarte/conservación del override del total al desmarcar o tocar (vive en el closure `onTap` de `MonthEntry`; no hay jsdom ni testing-library, y no puedo tocar `src/`). Si se quiere test, extraer esa transición a una función pura en `month-selection.ts`.
- Resultado: `npm test` 77 archivos, 1546 pasan, 1 skipped; typecheck limpio. Sin bugs de producción.

SUITE GREEN
