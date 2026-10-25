# 03 — Tests de base (T4, parte DB)

`npx vitest run tests/db`: 17 archivos, 429 passed, 1 skipped. Sin hallazgos contra la migración.

## Archivos
- `tests/db/opening-balance-months.test.ts` (nuevo, 30 tests): CHECKs (con el guard apagado por DDL transaccional), mensajes del guard, período = inicio - 1, inmutabilidad (sin grant de update, trigger incluso como postgres), grants por columna, auditoría con actor, `register_payment_batch` (tramo, idempotencia, atomicidad, rol), `payment_month_options` (flujo ene–mar → abr–jun, reparto con resto, total corregido, n=1, parcial, legacy NULL, anulado, antes/después del inicio, grupo, baja, alta posterior, Σ celdas = fee y `member_accounts` derivado), grants de funciones, índice único de saldo vigente.
- `tests/db/payment-months-fixtures.ts`: `monthOptions` devuelve `openingFrom`.
- Corrección de tests viejos ajenos a la migración: `payments`, `members`, `member-categories` usaban `current_date` (UTC de la base) y fallaban entre las 21:00 y las 24:00 ART ("fecha futura"). Ahora `private.club_today()`.

## Notas
- service_role NO tiene EXECUTE sobre `payment_month_options`/`register_payment_batch` (ni antes de esta migración ni sobre `member_accounts`): son RPC de sesión. El plan T4 decía lo contrario; el test fija el comportamiento real.
- Pendiente: paridad TS/SQL de `splitOpeningTotal` (la función aún no existe). La RPC reparte `total/n` entero con el resto en el último mes; el test SQL ya lo fija (100.000,00 en 3 → 3.333.333/3.333.333/3.333.334).
- Tests de views/models: no tocados en esta corrida.
