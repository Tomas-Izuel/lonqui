# 03 — Revisión (code-reviewer)

**Veredicto: APPROVED**

Cubre dos cambios sin commitear: (1) cambiar valores de cuota (este pipeline) y (2) navegación de meses en `/caja` (`2026-10-15-caja-selector-mes`). Se ignoró lo de `importacion-padron`, `editar-fecha-ingreso` y `public/Logo.png`. No hay blockers. Quedan dos majors que son de tests, no de producción, y hay que cerrarlos con `test-engineer` antes de dar SUITE GREEN.

## Alcance revisado

Migración `20261015120000_fee_prices_correction.sql`, `src/models/types.ts`, `src/models/fee-prices.model.ts`, `src/views/settings/fee-prices-section.tsx`, `src/views/settings/fee-price-sheet.tsx` (renombre de `new-fee-price-sheet.tsx`), `.impeccable/surfaces/route-ajustes.md`, `src/lib/dates.ts`, `month-selector.tsx`, `month-payments-view.tsx`, `money-summary-strip.tsx`, `other-income-view.tsx`. No hay `createAdminClient`, ni action nueva, ni `DELETE`/`UPDATE`, ni imports de `@supabase/*` en pages.

## Hallazgos (por severidad)

### Major 1 — Tests existentes que ahora fallan (routear a test-engineer)
- `tests/db/billing.test.ts:~237`: "duplicado exacto: unique violation" espera `23505` al insertar dos filas `default` para el mismo mes. Con el índice no único, el insert pasa.
- `tests/db/constraint-translations.test.ts:286-292`: espera `23505` → field `validFrom`.
- `tests/models/fee-prices.model.test.ts:173-179`: espera que el modelo traduzca `23505` a "Ya hay un valor para ese alcance…". Esa rama se borró a propósito.

Escenario: `npm test` rojo (los de `tests/db` solo con Docker). Hay que invertirlos: la segunda fila entra y gana la de mayor id.

### Major 2 — Cobertura nueva pedida en 01-tasks que falta
Cubrir los criterios [DB] de S1:
- `fee_price_for` desempata por `id desc` a igual mes para los tres alcances.
- No gana la fila más nueva si su `valid_from` es posterior al período.
- `generate_fees(P)` congela el monto de la segunda fila.
- El índice `fee_prices_target_idx` existe y no es único, y `fee_prices_unique_target` no existe.
- Siguen vigentes el append-only y el guard.

También el modelo: `getFeePricesOverview` con dos filas del mismo destino y mes deja `upcoming` deduplicado y `supersededById` correcto en `history`. Y la vista: el guard "Es el mismo valor que ya tiene para ese mes".

### Minor 1 — Doble listado de un cambio programado
`fee-prices-section.tsx` muestra el programado como "Cambia a X desde Y" bajo la fila vigente y otra vez en "Próximos" con su propio "Cambiar". No es incorrecto, pero en 390px duplica ruido. Se puede dejar "Próximos" solo para destinos sin fila vigente, o dejarlo así por claridad. Decisión de producto, no bloquea.

### Minor 2 — Snapshot de `changing` en la sección
`fee-prices-section.tsx` (estado `changing`): guarda el `FeePrice` al abrir. Si tras un cambio se revalida y se reabre la misma fila, `key={changing.price.id}` no cambia y el sheet usa el monto del snapshot. Hoy no se manifiesta: una corrección del mismo mes cambia el id de la fila vigente, y una para un mes futuro no toca la fila vigente. Conviene resolver la fila por id desde `feePrices` en cada render para no depender de eso.

### Nit 1 — `src/models/fee-prices.model.ts` (comentario de `getFeePricesOverview`)
Una línea de comentario quedó larguísima por el reflow ("…y `history` marca cada fila reemplazada con el id de la que la pisó. Nunca se recalcula…"). Reflowear.

### Nit 2 — `fee-price-sheet.tsx`
`sameTarget`/`effectivePrice` duplican la lógica de `fee_price_for` en cliente. Es aceptable: es solo preventivo, el servidor decide, y los comentarios lo dicen. Los tipos locales `Target` y `sameTarget` están duplicados con `fee-prices-section.tsx`. Un helper compartido sería más limpio.

## Puntos pedidos, verificados

- **Append-only:** la migración solo suelta un índice único y crea uno común. No toca `forbid_change`, grants de tabla ni policies. Corregir es `INSERT`, así que el trigger de auditoría deja una fila por cada uno, con actor de sesión.
- **Guard "hacia adelante":** `fee_prices_insert_guard` queda intacto: rechaza mes pasado y mes ya generado (`fees kind='monthly'`). Lo pagado y lo adeudado no cambia. Una corrección antes de generar es la única que modifica el monto futuro, y `generate_fees` usa `fee_price_for` al generar y congela. Correcto.
- **Función:** `create or replace` mantiene firma, `stable`, `search_path=''`, y restablece `revoke ... from public, anon` + `grant ... to authenticated, service_role`. Idéntica a la original salvo `fp.id desc`. El `id` es identidad creciente, así que "mayor id = más nuevo".
- **Coherencia del desempate:** `fee_price_for` (`valid_from desc, id desc`), `listFeePrices` (mismo orden), `getFeePricesOverview` (primero por clave = mayor id) y `effectivePrice` del sheet (`validFrom` y luego `id`) coinciden. `current` y `upcoming` derivan del mismo orden.
- **Índice:** `fee_prices_target_idx` mismas columnas que el índice único anterior. El de `category_id` (FK) sigue. Reversa documentada en la migración.
- **UX/piso de calidad:** "Cambiar" `h-11`, con `aria-label` que contiene el texto visible. El `<form>` lleva `method="post"` con `noValidate` y submit desde el footer por `form=`. Montos con `Amount` (tabulares). El copy aclara que lo ya generado no cambia, pagado o adeudado. Hay confirmación en forma de aviso "Reemplaza el valor de…". Sin kicker, sin tarjetas anidadas, sin emoji. El `<details>` de historia tiene `min-h-11` y respeta `prefers-reduced-motion`. La fila a 390px usa `min-w-0` + `truncate` + monto `shrink-0`, razonable.
- **Errores:** se quitó la traducción de `23505`; el `23514` del guard sigue pasando por `isRawPostgresMessage`. No se filtra `err.message` crudo.
- **Navegación de meses:** `toMonthParam` produce `YYYY-MM`, que es lo que validan las pages (`PERIOD_RE`). Antes mandaban `YYYY-MM-01` y siempre caían al mes actual. `key={period}` en `MonthPaymentsList` remonta el estado `useState(initialPage)` al navegar del lado del cliente: correcto. El `other-income-view` reutiliza el helper. El selector de ingresos descarta filtros de concepto/sponsor (documentado). El export respeta `mes=YYYY-MM`.
- **Ámbito/datos personales:** nada fuera de Fase 1; sin PII en logs; sin CSV reales.

## Blockers

Ninguno.

## Qué está bien

Cambio mínimo y bien razonado: la regla vive en la base (desempate por id), la UI solo la espeja. Se mantiene append-only y auditoría sin tocar triggers. El modelo marca `supersededById` para que la historia sea honesta. Los comentarios explican el porqué y las referencias al pipeline son claras. El arreglo de meses ataca la causa real (formato del parámetro) y no un parche en las pages.
