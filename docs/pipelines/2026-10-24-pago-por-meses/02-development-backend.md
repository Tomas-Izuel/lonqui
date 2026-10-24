# 02 — Desarrollo backend (B1)

Pipeline `2026-10-24-pago-por-meses`. Lane `backend`, slice B1. Sin tests ni migraciones (T0 y T1 son de otros).

## Qué se hizo

Un solo camino de escritura de pagos (`register_payment_batch`), lectura de celdas (`payment_month_options`) y saldo anterior por meses para la ficha.

### Firmas finales

`src/models/accounts.model.ts`
- `getPaymentMonthOptions(memberIds: number[]): Promise<PaymentMonthOption[]>` — una RPC, snake→camel, `[]` si no hay ids.

`src/models/fees.model.ts`
- `openingBalanceDescription(fromPeriod: string, toPeriod: string): string` → `"Saldo anterior · julio a septiembre 2026"`.
- `openingBalanceMonthsSchema` (`{ fromPeriod, toPeriod, amountCents }`, strict, períodos `YYYY-MM-01`, `from <= to`, monto entero > 0). Lo usa el schema de pagos.
- `createOpeningBalanceFromMonthsSchema` (`{ memberId, fromPeriod, toPeriod, amountCents }`) + `CreateOpeningBalanceFromMonthsInput`.
- `createOpeningBalanceFromMonths(input): Promise<Fee>` → delega en `createOpeningBalance` (que sigue exportada con su schema).

`src/models/payments.model.ts`
- `registerPaymentSchema.items[]` suma `openingBalance: { fromPeriod, toPeriod, amountCents } | null | undefined`; `items` con `memberId` únicos (mensaje "El mismo socio aparece dos veces en el lote", path `items`).
- `registerPayment(input: RegisterPaymentInput): Promise<RegisterPaymentResult>` → RPC `register_payment_batch`. Sin openingBalance manda `opening_balance: null`. Se eliminaron el INSERT batch por PostgREST, `isBatchAlreadyRegistered` y `translateInsertError`; `alreadyRegistered` sale de la fila de la RPC.
- Traducción (`translateRegisterError`): 42501 → `PermissionError`; 23505 `fees_one_opening_balance` → DomainError "Ya tiene un saldo anterior vigente. Actualizá la pantalla y volvé a intentar." (field `openingBalance`); 23505 `payments_batch_member_key` → "El mismo socio aparece dos veces en el lote"; 23514 de fecha/monto con los mismos textos de antes; 23514 con texto redactado (no `isRawPostgresMessage`) → DomainError tal cual; 23503 → "El socio no existe". Todo lo demás sube crudo (lo loguea `failure`).

`src/controllers/payments.actions.ts` (`'use server'`, solo async exports)
- `registerPayment(input: unknown): Promise<ActionResult<RegisterPaymentResult>>` (misma lógica de grupo y comprobante).
- `getPaymentMonthOptions(input: unknown /* { memberId } */): Promise<ActionResult<PaymentMonthOption[]>>`.
- `createOpeningBalanceFromMonths(input: unknown): Promise<ActionResult<{ id: number }>>` (`payments.register`, `revalidatePath('/', 'layout')`).
- `getPaymentFormData` ahora devuelve `monthOptions` (una llamada a la RPC con todos los ids, en paralelo con `member_accounts`; todo socio pedido tiene clave, `[]` si la RPC no trajo filas).
- `createOpeningBalance` (por monto) queda exportada sin consumidor de UI.

## Criterios de aceptación implementados
Los de `01-tasks.md` §B1: descripción del saldo, `opening_balance: null` sin saldo, rechazos de schema (from>to, día != 1, monto <= 0, socio duplicado con path `items`), traducciones de error, una sola llamada de opciones para el grupo, `payments.register` + Zod antes del modelo en las dos actions nuevas.

## Verificado contra el stack local (login admin de dev, RPC reales)
- `payment_month_options` devuelve `pre_system` (12), `monthly`, `projected` (6) por socio; mapeo camelCase por el modelo.
- Errores reales: saldo con `to >= inicio` → 23514 "El saldo anterior solo cubre meses anteriores a 10/2026"; `from>to` → 23514 redactado; socio duplicado → 23505 `payments_batch_member_key`; fecha futura → 23514 con el texto exacto; socio inexistente → 23503 (FK); segundo saldo vigente → 23505 `fees_one_opening_balance`.
- Éxito + reintento con mismo `batch_id`: primera vez `already_registered=false` con `opening_balance_fee_id`; reintento `already_registered=true`, sin duplicar.
- Efecto colateral en la base de dev: socio id 1 quedó con el pago 14 ($10 de prueba) y un saldo anterior 14 (agosto–septiembre 2026, $20). Nada se borra: se anula desde la UI si molesta, o se descarta con el próximo `db:reset`.
- No se pudo probar `PermissionError` (42501) con un `editor`/`consulta` real; necesita `tests/db/`.

## Para T1 (necesita base real)
RLS por rol en `register_payment_batch` (consulta → 42501), atomicidad (saldo + pago todo o nada), idempotencia por `batch_id` con lock, `fees_one_opening_balance` concurrente, auditoría con actor de sesión, ventana de `payment_month_options` (pre_system solo sin saldo vigente y alta <= inicio).

## Hallazgos de SQL (para el hilo principal, no bloqueantes)
1. En un reintento (`already_registered = true`) la RPC devuelve `opening_balance_fee_id = null` para los ítems que habían creado saldo, así que `openingBalanceFeeIds` sale `[]` en el reintento. Si la UI necesita el id en el reintento, la RPC debería devolver el id existente del saldo (fee `opening_balance` no anulado del socio creado en el lote). Hoy `alreadyRegistered` solo dispara el toast "ya estaba registrado".
2. Los tipos generados tipan `notes` y `receipt_storage_path` como `string` (sin `| null`): se castea en el modelo; si la RPC declarara `default null` los tipos saldrían opcionales.

## Desvíos del plan
Ninguno de fondo. `openingBalanceMonthsSchema` es un extra exportado de `fees.model` para reutilizar las reglas de período en el schema de pagos.

## Typecheck / lint
Mis 4 archivos pasan lint y typecheck. Typecheck falla solo en `src/views/members/opening-balance-months.tsx` (F2: faltan `month-strip` / `month-selection` de F1 todavía).

## Ronda de review (hallazgos 3 y 10)
- #3: `createOpeningBalanceFromMonths` (action) lee `getBillingStatus()` y rechaza con `DomainError`: facturación inactiva → "Primero activá las cuotas en Ajustes"; `toPeriod >= startPeriod` → "El saldo anterior solo cubre meses anteriores a MM/YYYY" (field `toPeriod`). Mismo texto que la RPC. Vive en la action porque `billing.model` no puede ser importado desde `fees.model` sin acoplar modelos.
- #10: `fees.model.ts` con una base `openingBalanceMonthsBase` sin refine; `openingBalanceMonthsSchema` y `createOpeningBalanceFromMonthsSchema` (`.extend({ memberId })`) comparten un solo refine (`fromNotAfterTo`).
- Reintento: `openingBalanceFeeIds` filtra los `opening_balance_fee_id` no nulos de las filas, así que con la RPC corregida (devuelve el id en el reintento) sale poblado sin cambios de código.
- #9 queda: el cast de `notes`/`receipt_storage_path` se mantiene.
- Typecheck y lint limpios.
