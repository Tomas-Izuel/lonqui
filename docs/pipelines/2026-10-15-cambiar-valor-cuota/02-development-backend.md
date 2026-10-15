# 02 — Desarrollo backend (B1)

## Tarea
B1 — modelo de valores de cuota: desempate, deduplicación y marca de reemplazo.
Archivo tocado: `src/models/fee-prices.model.ts` (único).

## Qué se hizo
- `translateFeePriceError`: se quitó la rama `23505` (el índice único ya no existe, ver migración `20261015120000_fee_prices_correction.sql`). Un 23505 ahora se relanza tal cual como error no reconocido (el controller lo loguea y devuelve algo genérico).
- Función pura interna `priceKey(price)` = `scope|memberType|categoryId|validFrom` (no exportada).
- `getFeePricesOverview`: una pasada sobre `listFeePrices()` (orden `valid_from desc, id desc`, sin cambios). La primera fila de cada clave gana: entra a `upcoming` si `validFrom > mes actual` y a `history` con `supersededById: null`; las siguientes de la misma clave van a `history` con `supersededById = id del ganador`.
- `current.*` sigue usando "primera aparición" sobre el orden desc, que a igual mes es el mayor id: coincide con `private.fee_price_for`.
- Doc-comments de cabecera y de `getFeePricesOverview` actualizados.
- Firmas públicas sin cambios; `FEE_PRICE_COLUMNS` y `listFeePrices` intactos.

## Criterios de aceptación implementados (para T1)
- Dos default mismo mes vigente (ids 1 y 3) -> `current.default.id === 3`.
- Misma categoría, mismo mes futuro (ids 2 y 5) -> `upcoming` solo id 5; `history` ambas, 5 con `null`, 2 con `5`.
- Destinos distintos mismo mes (default/categoría, cat A/cat B, practicing/non_practicing) -> todos `null`.
- Mismo destino, meses distintos -> todos `null`.
- 23505 desde `createFeePrice` se relanza sin traducir; 23514 (guard, checks), 23503 y éxito sin cambios.

## Verificación
- `npm run lint`: 0 errores (5 warnings preexistentes en tests).
- `npm run typecheck`: sin errores en el modelo. Queda un error en `src/views/settings/fee-prices-section.tsx` (importa `new-fee-price-sheet`, que F1 está renombrando a `fee-price-sheet`): es del lane frontend, esperado.

## Necesita base real (tests/db)
- Dos inserts del mismo destino y mes ya no dan 23505.
- `fee_price_for` desempata por `id desc` (generación de cuotas usa la fila de mayor id).

## Cambios de schema pedidos / diferidos
Ninguno.
