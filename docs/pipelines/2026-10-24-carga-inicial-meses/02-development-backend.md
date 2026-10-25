
## T2 — models (backend)

Archivos: `src/models/accounts.model.ts`, `src/models/fees.model.ts`.

- `getPaymentMonthOptions`: mapea `opening_from` -> `openingFrom` (`?? null`; la columna es opcional en el row type para tolerar la RPC vieja durante el deploy).
- `createOpeningBalanceFromMonths`: inserta `from_period`/`to_period` junto con monto y descripción vía helper interno `insertOpeningBalance(input, span?)`. `createOpeningBalance` (solo monto) sigue sin tramo.
- `translateOpeningBalanceError`: los 23514 con mensaje en español del guard ("Los meses del saldo anterior no son válidos", "El saldo anterior solo cubre meses anteriores a MM/YYYY") ya pasaban como DomainError por la rama `!isRawPostgresMessage`; se agregó un caso explícito para CHECK `fees_opening_span_*` -> "Los meses del saldo anterior no son válidos". Nada de `err.message` crudo; sin logs nuevos.

Criterios: saldo con tramo guarda from/to; sin tramo, null/null; CHECK de tramo -> DomainError.
Necesita DB real: guard del tramo, constraints `fees_opening_span_*`, RPC `opening_from`.

Tests (no míos): `tests/models/accounts.model.test.ts` (getPaymentMonthOptions) debe esperar `openingFrom: null`; `tests/views/payments/{month-selection,payment-views.render}.test.ts` construyen `PaymentMonthOption` con `openingFrom` opcional (error de typecheck por `undefined`).
