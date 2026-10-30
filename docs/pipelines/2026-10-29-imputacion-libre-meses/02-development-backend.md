# 02 — Desarrollo backend (T1)

Pipeline `2026-10-29-imputacion-libre-meses`. Lane `backend`. Sin tests ni migraciones.

## Archivos

- `src/models/fees.model.ts`: `periodSchema`, `openingMonthSchema`, `openingMonthsSchema` (exportados, los reusa payments), `createOpeningBalanceMonthsSchema`, `createOpeningBalanceMonths(input): Promise<Fee[]>` (UN insert de N filas `{member_id, kind, period, amount_cents}`, sin description ni tramo). Eliminados: `createOpeningBalance`, `createOpeningBalanceFromMonths`, `openingBalanceMonthsSchema`, `openingBalanceDescription`, `createOpeningBalanceSchema`, el `insertOpeningBalance` interno.
- `src/models/payments.model.ts`: `paymentItemSchema` con `markedPeriods` (<=60, únicos, día 1) y `openingMonths` (<=36, únicos, día 1, int > 0), sin `openingBalance`. RPC recibe `marked_periods` / `opening_months` (`[{period, amount_cents}]`) o `null` (un array vacío también viaja `null`). `Payment.allocations` en `listPaymentsForMember` y `getMonthPaymentsPage` (embed `payment_allocations(fee_id, amount_cents, source, fee:fees(period, kind, voided_at))`, verificado contra PostgREST local; descarta cuota anulada, pago anulado -> `[]`, orden por período y feeId).
- `src/models/accounts.model.ts`: `getOpeningBalances(memberId): Fee[]` (exportada; vigentes, period asc, id asc) reemplaza a `getOpeningBalance`; `getMemberAccountDetail` devuelve `openingBalances`; `getPaymentMonthOptions` mapea `beforeJoined`, sin `openingFrom`; gate de schema (alguna fila con `before_joined === undefined` -> `DomainError('El sistema se está actualizando. Probá de nuevo en unos minutos')`; vacío -> `[]`).
- `src/models/audit.model.ts`: `payment_allocations` en `AUDITED_TABLES`, `AUDIT_FIELD_LABELS` y etiqueta: "imputación de $X a cuota del mes MM/YYYY del pago del DD/MM/YYYY" (o "a saldo anterior MM/YYYY"). Alias `fee_id`/`payment_id` en `LABEL_COLUMNS`; resolución batch de cuotas y pagos (`resolveAllocationRefs`), sin nombre de socio.
- `src/controllers/payments.actions.ts`: `createOpeningBalanceMonths(input)` reemplaza a `createOpeningBalanceFromMonths` (y se eliminó `createOpeningBalance`). Valida `payments.register`, Zod, facturación activa, `every(period < startPeriod)` con el texto "El saldo anterior solo cubre meses anteriores a MM/YYYY" (`field: 'months'`). Devuelve `{ ids: number[] }` (era `{ id }`). `registerPayment` y `getPaymentFormData` sin cambio de firma.

## Contratos / decisiones no obvias

- `createOpeningBalanceMonths` devuelve `{ ids: number[] }` (suposición: la spec no fija el shape; una carga crea N filas). Las vistas de T2/T3 deben tolerarlo.
- `createOpeningBalanceMonthsSchema` exige al menos 1 mes ("Marcá al menos un mes del saldo anterior"), ademas de max 36 y únicos.
- Errores de `registerPayment`: todo 23514 con mensaje no crudo cae en `DomainError` con `field: 'items'` (salvo "mayor a cero" -> `amountCents`). `isRawPostgresMessage` no matchea los textos nuevos (verificado leyendo la regex). 23505 `fees_one_opening_balance` -> "Ya hay un saldo anterior cargado para uno de esos meses" (`field: 'items'` en el lote, `'months'` en la ficha).
- Se sacó el `field: 'toPeriod'` / `'openingBalance'` viejo: la vista debería leer `items` / `months`.
- El gate de `before_joined` vive en el modelo (no en la action), así protege también a la ficha.
- `markedPeriods`/`openingMonths` vacíos se mandan como `null` para que la base no vea `[]` (con `opening_months = []` la base daría "no son válidos").

## Reglas a probar (T4)

- Con mocks: ítem sin marcar -> RPC con `null`/`null`; duplicados, día != 1, >60, >36, monto 0 -> `invalid` sin llamar a RPC; 23514 "La cuota de 05/2026 ya está paga…" -> `DomainError` literal; gate de `before_joined`; `getOpeningBalances` orden; `allocations` filtradas.
- Necesita base real (`tests/db/`): el embed de `payment_allocations` bajo RLS de `authenticated` (existe `payment_allocations_select`; no lo probé con un usuario, solo con la secret key), el insert de N filas de `fees` con el grant de `period` y atomicidad (si un mes falla no entra ninguno), la etiqueta de auditoría de `payment_allocations` contra filas reales.

## Estado

`npm run typecheck` y `eslint` sobre mis 5 archivos: limpios. Los errores restantes de typecheck están en `src/views/**` y `tests/**` (otros slices).

## Hallazgos para otros slices

- `src/views/payments/*`, `src/views/members/{member-detail-view,opening-balance-months,member-account-section}.tsx` aún importan `openingBalance`, `createOpeningBalanceFromMonths`, `openingFrom` (T2/T3). Tests viejos en `tests/models/{payments,fees,accounts}.model.test.ts` y `tests/controllers/payments.actions.test.ts` (T4).
- `AUDIT_FIELD_LABELS` en el modelo ahora incluye `payment_allocations`; `views/audit/audit-labels.ts` es de T3.

## Ajustes de review (M3, m6)

- M3: `listPaymentsForMember` y `getMonthPaymentsPage` reintentan sin el embed de `payment_allocations` si PostgREST da `PGRST200` (código nuevo antes que la migración) y devuelven `allocations: []`, en vez de tirar la ficha y /caja/pagos.
- m6: en `translateRegisterError` solo el texto exacto "El monto tiene que ser mayor a cero" va a `amountCents`; el resto de los 23514 (incluido "… y cada mes tiene que ser mayor a cero") a `items`.
- Typecheck y eslint de mis archivos: limpios.
