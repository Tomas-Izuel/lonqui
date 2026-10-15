# 03 — Tests: cambiar el valor de una cuota + selector de mes de /caja

Veredicto: **SUITE GREEN** (`npm test`: 66 archivos, 1201 pasan, 1 skip previo; los de `tests/db/` corrieron contra el stack local, sin reset).

## Cambios

- `tests/db/billing.test.ts`: el caso "duplicado exacto: 23505" se reemplazó por un bloque "corrección" (10 casos): segunda fila mismo destino+mes aceptada; `fee_prices_target_idx` existe y no es único (y el viejo no); `fee_price_for` devuelve el id más alto (con el monto más alto cargado primero, para que no pase por azar); desempate solo a igual mes; precedencia categoría > default intacta con corrección; `generate_monthly_fees` congela el monto corregido con el `fee_price_id` nuevo y la fila equivocada queda; el guard rechaza mes ya generado y mes pasado; monto congelado del mes anterior al cambiar el siguiente; auditoría con `actor_id = auth.uid()` y `actor_source = session` por cada inserción; editor no inserta.
- `tests/db/constraint-translations.test.ts`: se sacó el caso 23505 (ya no hay constraint que lo produzca).
- `tests/models/fee-prices.model.test.ts`: 23505 se relanza sin traducir (no es `DomainError`); `upcoming` deduplicado por destino+mes (gana el mayor id); destinos distintos o meses distintos no se deduplican; `history` conserva todo con `supersededById`; vigente = mayor id a igual mes.
- `tests/lib/dates.test.ts`: `toMonthParam` (YYYY-MM, cruce de año con `addMonths`, matchea la regex de las pages).
- `tests/views/payments/month-selector.test.ts` (nuevo, `renderToStaticMarkup`, sin jsdom; `vitest.config.ts` solo incluye `*.test.ts`, por eso no es `.tsx`): hrefs `?mes=YYYY-MM`, 2026-01 -> 2025-12, 2025-12 -> 2026-01, sin día.

## Fuera de cobertura (a propósito)

- `fee-prices-section.tsx` / `fee-price-sheet.tsx`: el repo no testea componentes interactivos (Node, sin jsdom). La lógica de "reemplaza el valor de..." y "mismo valor" vive en el cliente; queda sin test.

## Bugs de producción encontrados

Ninguno.
