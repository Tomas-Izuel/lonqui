# 03 — Tests (T4)

Veredicto: **SUITE GREEN** (1681 verdes, 1 skipped; tsc limpio). H1 (deadlock) quedó corregido por el hilo principal y el caso 18 pasa. Nota: si otro proceso corre tests de base a la vez sobre la misma base aparecen deadlocks espurios dentro de las transacciones de test; correr de a uno.

Corrida final: `npm test` 83 archivos, 1681 verdes, 1 skipped (1682); tres corridas seguidas sin el proceso ajeno, más una con el candado de `withRollback`. `npx tsc --noEmit` limpio. `npm run lint` 0 errores (10 warnings de `_args` sin usar en mocks). La cifra anterior (1 failed | 1678) era de la corrida con H1 abierto.
Antes (al repartir T4): 258 rojos | 1413 verdes (1672). `tests/db/cash-isolation.test.ts` verde sin cambios.

## Hallazgo H1 (abierto): deadlock en dos lotes concurrentes del mismo socio
- Test: `tests/db/payment-allocations.test.ts` caso 18 (dos conexiones, `register_payment_batch` con `marked_periods` del mismo mes, Promise.all).
- Observado (4/4 corridas, antes y después del reset): uno de los dos falla con `deadlock detected` (40P01). Esperado: los dos registran.
- Causa: el `FK check` de `payments.member_id` toma `FOR KEY SHARE` sobre `members`; después los triggers del motor piden `FOR UPDATE` sobre la misma fila (`apply_credit` línea ~372, `allocate_marked` ~420). Dos transacciones: cada una espera el KEY SHARE de la otra.
- Cambio sugerido: `for update` -> `for no key update` en esos dos `perform 1 from public.members ... for update` (NO KEY UPDATE no conflictúa con KEY SHARE pero sí consigo mismo). Verificado con experimento reversible (funciones redefinidas, 3 carreras x 2 lotes: `ok, ok`; restauradas después). El `order by member_id` y el `lock_timeout` agregados no lo evitan (es el mismo socio).
- Dueño: migración (hilo principal).

## Hallazgos ya corregidos durante T4
- B1: anular una cuota con `update ... set void_reason` no disparaba la reimputación (trigger `of voided_at`). Detectado por casos 7 y 9; arreglado por el hilo principal.
- B2: anular un pago con otro pago con crédito dejaba deuda y crédito juntos. Cubierto por el caso nuevo "anular P1 con P2 con crédito"; verde. Todas las anulaciones de los tests van con `set void_reason` solamente (como el modelo).

## Qué se hizo
Base (`tests/db/`):
- Nuevo `payment-allocations.test.ts` (30): casos 1-18 de la spec + variantes (6b-6d, 10b-c, grupo, anulación de pago con crédito). Invariante global deuda/crédito y `Σ pending − Σ credit = member_balance` en cada caso.
- Nuevo `payment-allocations-migration.test.ts` (8): escenario A–H con forma vieja (tramo $100.000.03 no divisible, saldo sin tramo, parcial, saldo a favor, pago y cuota anulados, dos deportes, grupo); snapshot → migrate → backfill → verify; `member_balance` idéntica para todos los socios; Σ imputado + crédito = Σ pagos; auditoría `system`; idempotencia; el verify aborta (imputación de más, faltante, cargo agregado, pago excedido) con id de socio, sin nombres.
- Reescrito `opening-balance-months.test.ts` (una fila por mes; se conservan los CHECKs del tramo para filas viejas). Borrado: celdas expandidas del tramo, `opening_from`, tramo en el lote, auditoría del tramo (modelo reemplazado por decisión del usuario).
- Actualizados: `billing.test` (period explícito ahora entra si < inicio, 23514 si >=; fixture de borrado despeja allocations), `payment-month-options*.test` (pre_system por mes sin fila), `register-payment-batch.test` (forma vieja expandida a N filas; un saldo por mes), `constraint-translations` (field `months`), `member-joined-on` (saldo posterior al alta no bloquea), `accounts.test` (saldo por meses cuenta N; sin tramo 1), `grants-and-lockdown` (payment_allocations: RLS, policy, grants de columna de fees).
- Fixtures nuevos en `payment-months-fixtures.ts` (`insertOpeningMonths`, `insertLegacySpan`, `feeStatus`, `paymentCredit`, `allocations`, `callBatch`, `before_joined`).
Unidad/render: `month-selection.test.ts` reescrito (53), `periodListLabel` en dates, `fees/payments/accounts/audit` models, `payments.actions` (`createOpeningBalanceMonths`), render de caja y ficha (aria-disabled de adelantos, aviso de alta con link, ayuda de arrastre, "Cubre…"/"Saldo a favor", saldo por mes).

## No cubierto
- `onDragStart` de `use-month-drag.ts` (hook React; sin jsdom ni react-test-renderer). La máquina pura `month-drag` sí está.
- Estado "ready" de `OpeningBalanceMonths` (botón "Cargar saldo anterior de $X (N meses)", aviso de alta en la ficha): carga por `useEffect`, no corre en render estático. Solo se prueba el estado inicial.
- Mensaje `role="status"` de adelanto bloqueado tras tocar (interacción); se prueba la región vacía y `aria-disabled`.
- `ErrorState`/"Reintentar" del gate en `register-payment-sheet` (se prueba el gate en el modelo).
- Residuo: el test 18 deja filas de auditoría (append-only); el resto de sus fixtures commiteados se limpia (members, status events, pagos, imputaciones, usuarios).

## Deadlocks intermitentes en la suite completa
Causa: dos procesos vitest a la vez sobre la misma base (se vio `node (vitest)` ajeno corriendo), no un cliente vivo de los tests ni del producto. Aislado, `npm test` dio 3 corridas seguidas 1681 verdes. Endurecido: `withRollback` toma `pg_advisory_xact_lock` al inicio, así los tests de base se serializan entre procesos.
