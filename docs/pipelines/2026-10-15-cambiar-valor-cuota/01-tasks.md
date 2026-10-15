# 01 — Tareas: cambiar el valor de una cuota desde la UI

Deriva de `00-architecture.md` (opciones 5.1-A y 5.2-A, con las respuestas
recomendadas a las preguntas 1–4 de §10; si Tomás cambia alguna, ajustar la
tarea que la cita). Cada tarea declara **lane**, **archivos que posee en
exclusiva** y **archivos que no toca**. Dos agentes sobre el mismo archivo
colisionan en silencio: el corte es por archivo y es disjunto. Los criterios
de aceptación son el spec del `test-engineer`; lo marcado **[DB]** solo se
prueba contra la base local (`tests/db/`, con `pg`, transacción + rollback
por test, claims por rol).

Idioma: comentarios y copy en español rioplatense, identificadores en
inglés. Ningún agente corre `npm install`, toca `supabase/**` ni resetea la
base. Ningún `requireRole`/`has_role` en código nuevo: permisos. Ningún
`createAdminClient()`. Ninguna action nueva: se reusa
`billing.actions.ts:createFeePrice` tal cual.

## Orden de ejecución

```
Paso 0  (hilo principal, secuencial)  S1 migración → db:reset + db:types → SH1 types + brief → typecheck verde
Paso 1  (paralelo)                     B1 modelo │ F1 sección + sheet
Paso 2  (paralelo, tras B1 y F1)       T1 test-engineer │ code-reviewer
```

B1 y F1 no comparten archivos. F1 consume el tipo `FeePriceHistoryEntry` de
SH1 y la action existente; no depende de B1 en tiempo de compilación (el
contrato de `FeePricesOverview` lo fija SH1). B1 no importa nada de F1.

---

## Lane `schema` — hilo principal

### S1 — `supabase/migrations/20261015120000_fee_prices_correction.sql`

Antes de escribir: skill `supabase-postgres-best-practices`
(`.claude/skills/supabase-postgres-best-practices/references/schema-constraints.md`,
`query-composite-indexes.md`, `security-privileges.md`). Levantar el stack
(`npm run db:start`) y, si el MCP responde, `get_advisors` después de
aplicar.

**Debe contener** exactamente lo de `00-architecture.md` §6.1: `drop index if
exists public.fee_prices_unique_target`; `create index fee_prices_target_idx`
(no único, mismas columnas); `create or replace function
private.fee_price_for(bigint, text, date)` con `fp.id desc` como último
criterio del `order by` (misma firma, mismo retorno, `stable`, `set
search_path = ''`); `revoke execute ... from public, anon` + `grant execute
... to authenticated, service_role`; `comment on table` actualizado. Nada
más: ni guard, ni grants de tabla, ni policies.

Después: `npm run db:reset` y `npm run db:types` (no se espera diff en
`database.types.ts`; si lo hay, revisarlo).

**Aceptación [DB]** (las escribe T1, las corre el hilo al integrar):

- Como `admin`: insertar `('default', 100, M)` y luego `('default', 200, M)`
  con `M` = un mes futuro lejano **no falla** (antes: 23505); las dos filas
  existen; `private.fee_price_for(null, 'non_practicing', M)` devuelve
  `amount_cents = 200` y `fee_price_id` = el id de la segunda. Vale igual
  para `scope = 'member_type'` y `scope = 'category'`.
- Desempate solo a igual mes: con `('default', 300, M)` y luego `('default',
  400, M + 1 mes)`, `fee_price_for(..., M)` devuelve 300 (la fila más nueva
  no gana si su `valid_from` es posterior al período).
- Precedencia intacta: el test existente "categoría > tipo de socio >
  default" sigue verde sin cambios.
- `fee_prices` sigue append-only: UPDATE/DELETE fallan como `admin`,
  `service_role` (permission denied) y `postgres` (`forbid_change`). Test
  existente, sin cambios.
- El guard sigue: `valid_from` del mes actual (ya generado por el seed) →
  "ya se generaron con otro valor"; mes pasado → "aplica desde este mes o
  uno futuro". Tests existentes, sin cambios.
- **Corrección antes de generar**: fixture con `billing_start_period`
  futuro o un período futuro sin cuotas; insertar un valor default para el
  período `P`, luego otro valor default para el mismo `P` con otro monto;
  ejecutar `private.generate_fees(P)` (como `postgres` o la RPC que
  corresponda, mirar cómo lo hace `tests/db/billing.test.ts` hoy); toda
  `fees` de `P` tiene `amount_cents` = el segundo monto y `fee_price_id` =
  el id de la segunda fila.
- Auditoría: los dos INSERT dejan dos filas en `audit_log` con `table_name =
  'fee_prices'`, `action = 'INSERT'` y `actor_id` = el admin.
- Grants: `authenticated` y `service_role` siguen sin DELETE/UPDATE en
  `fee_prices` (`tests/db/grants-and-lockdown.test.ts`, sin cambios).
- `pg_indexes` para `fee_prices` no contiene `fee_prices_unique_target` y
  contiene `fee_prices_target_idx` con `indisunique = false`.

---

## Lane `shared` — hilo principal

### SH1 — Contrato de tipos y brief de superficie

**Posee:** `src/models/types.ts`, `.impeccable/surfaces/route-ajustes.md`.

- `types.ts`: agregar `FeePriceHistoryEntry = FeePrice & { supersededById:
  number | null }` con su doc-comment ("`null` si rige para su destino y mes;
  si no, el id de la fila que la reemplazó"); `FeePricesOverview.history:
  FeePriceHistoryEntry[]`; doc-comment de `upcoming` pasa a "una fila por
  destino y mes: la que rige". `FeePrice`, `FeePriceInput` y
  `FeePricesOverview.current` no cambian.
- `route-ajustes.md`: pegar el bloque de `00-architecture.md` §9.
- `npm run typecheck` va a fallar en `fee-prices.model.ts` hasta que B1
  aterrice: esperado; se reparte igual.

---

## Lane `backend` — `senior-backend-engineer`

### B1 — Modelo: desempate, deduplicación y marca de reemplazo

**Posee en exclusiva:** `src/models/fee-prices.model.ts`.
**No toca:** `src/models/types.ts` (SH1), `src/controllers/**`,
`src/views/**`, `supabase/**`, `tests/**`.

**Skills:** `supabase` (`.claude/skills/supabase/`, solo para confirmar que
nada de esto necesita ir a la base). No hace falta Context7: no hay API
nueva de librería.

**Goal:** que `getFeePricesOverview` refleje la regla "a igual destino y mes
rige la fila de mayor id", y que el modelo deje de traducir un 23505 que ya
no existe.

**Contratos a honrar:** las firmas públicas no cambian:
`listFeePrices(): Promise<FeePrice[]>`,
`getFeePricesOverview(): Promise<FeePricesOverview>`,
`createFeePrice(input: CreateFeePriceInput): Promise<FeePrice>`,
`createFeePriceSchema`. `FEE_PRICE_COLUMNS` y el orden `valid_from desc, id
desc` de `listFeePrices` se mantienen (el cálculo de abajo depende de ese
orden).

**Qué hacer:**

- Quitar la rama `error.code === '23505'` de `translateFeePriceError` y su
  comentario; un 23505 pasa a relanzarse como error no reconocido.
- `getFeePricesOverview`: `upcoming` deduplicado por clave (scope,
  memberType, categoryId, validFrom) quedándose con la primera aparición;
  `history` como `FeePriceHistoryEntry[]`: una pasada sobre la lista
  ordenada, la primera fila de cada clave recibe `supersededById: null`, las
  siguientes de la misma clave reciben el id de esa primera. Una función
  pura interna para la clave (no exportar: las vistas no importan modelos).
- Actualizar el doc-comment de cabecera del archivo y el de
  `getFeePricesOverview` (referenciar este pipeline y la regla de
  corrección).

**Aceptación (unit, `tests/models/fee-prices.model.test.ts`):**

- Con dos filas default para el mismo mes vigente (ids 1 y 3, montos
  distintos), `current.default.id === 3`.
- Con dos filas de la misma categoría para el mismo mes futuro (ids 2 y 5),
  `upcoming` contiene solo la de id 5; `history` contiene las dos, la de id
  5 con `supersededById: null` y la de id 2 con `supersededById: 5`.
- Filas de **distintos** destinos con el mismo mes no se reemplazan entre sí
  (default vs. categoría, categoría A vs. categoría B, practicante vs. no
  practicante): todas `supersededById: null`.
- Filas del mismo destino con **distintos** meses: `supersededById: null` en
  todas.
- Un 23505 desde `createFeePrice` **se relanza tal cual** (ya no es
  `DomainError`); el test "23505 → DomainError field validFrom" se elimina.
- El resto de los tests del archivo (schema, 23514 del guard, 23503, éxito)
  siguen verdes sin cambios.

**Fuera de alcance:** cualquier RPC nueva; tocar `billing.model.ts`; cambiar
`listFeePrices`.

**Log:** `docs/pipelines/2026-10-15-cambiar-valor-cuota/02-development-backend.md`.

---

## Lane `frontend` — `frontend-react-craftsman`

### F1 — Acción "Cambiar" por fila y sheet con dos modos

**Posee en exclusiva:** `src/views/settings/fee-prices-section.tsx`,
`src/views/settings/new-fee-price-sheet.tsx` (renombrar a
`src/views/settings/fee-price-sheet.tsx`, export `FeePriceSheet`; la
importación vive en `fee-prices-section.tsx`, mismo dueño).
**No toca:** `src/views/settings/settings-page-view.tsx` (sus props no
cambian), `src/views/shared/**`, `src/components/ui/**`, `src/controllers/**`,
`src/models/**`, `src/app/**`, `tests/**`.

**Skills obligatorias, en este orden:** `impeccable` — correr
`.claude/skills/impeccable/scripts/impeccable context --target
src/views/settings/fee-prices-section.tsx`, leer
`/Users/tomasizuel/.claude/skills/impeccable/reference/operate.md` y, justo
antes de editar, `/Users/tomasizuel/.claude/skills/impeccable/reference/craft-floor.md`;
`vercel-react-best-practices`; `web-design-guidelines` antes de cerrar.
Context7 (`react-hook-form`, `@hookform/resolvers`) si necesita confirmar
`useWatch`/`setFocus` en React 19.

**Goal:** que un admin cambie el valor de cualquier fila vigente o programada
en un toque, entendiendo desde qué mes aplica y qué reemplaza.

**Contratos a honrar:**

- `FeePricesSectionProps` no cambia de forma hacia afuera (`feePrices:
  FeePricesOverview`, `billing`, `disciplines`, `categoriesByDiscipline`);
  internamente `feePrices.history` ahora es `FeePriceHistoryEntry[]` y
  `feePrices.upcoming` ya viene deduplicado (B1).
- Action: `createFeePrice(input)` de `@/controllers/billing.actions`, misma
  entrada `{ scope, memberType?, categoryId?, amountCents, validFrom }`,
  mismo `ActionResult<FeePrice>`.
- Primitivas: `ResponsiveSheet`, `SelectField`, `AmountField`, `Amount`,
  `PeriodText`, `Panel`, `Button` (`variant="ghost"`, alto 44px),
  `memberTypeLabels`, `feePriceScopeLabels`, `formatPeriod`, `addMonths`,
  `periodRange`, `toPeriod`. Nada nuevo en `views/shared`.

**Qué construir (detalle en `00-architecture.md` §6.5):**

1. `FeePriceRow` con slot de acción: botón de texto "Cambiar"
   (`aria-label="Cambiar valor de <etiqueta>"`), presente en vigentes y
   próximos, ausente en Historia. A 390px la fila queda en una línea:
   etiqueta truncable, "desde <mes>", monto, botón; el monto nunca se trunca.
2. Fila vigente: tercera línea "Cambia a $Y desde <mes>" cuando `upcoming`
   tiene una fila del mismo destino (la de menor `validFrom`). Helper puro
   local `sameTarget(a, b)` comparando scope/memberType/categoryId.
3. Historia: filas con `supersededById !== null` muestran "Reemplazado"
   (texto secundario, `text-xs text-muted-foreground`) y el monto atenuado.
   Sin pill nueva, sin ícono unicode.
4. `FeePriceSheet` con `mode: 'new' | 'change'`; en `change` recibe `price:
   FeePrice` y `label: string`. Nuevo prop `history: FeePriceHistoryEntry[]`
   en ambos modos. En `change`: título "Cambiar valor de cuota", descripción
   con la etiqueta del destino, línea "Hoy: $X desde <mes>" / "Programado: $X
   desde <mes>" según `price.validFrom <= billing.currentPeriod`, sin campos
   de alcance/destino, monto vacío con foco al abrir, "Aplica desde" con
   default = primera opción (vigente) o `price.validFrom` (programado).
5. Debajo de "Aplica desde", en ambos modos, texto dinámico con el mes
   elegido: "Se usa en las cuotas que se generen desde <mes>. Las cuotas ya
   generadas no cambian, estén pagadas o adeudadas." Si `history` tiene una
   fila del destino resultante con `validFrom` igual al mes elegido y
   `supersededById === null`: "Reemplaza el valor de $Y programado para
   <mes>."
6. Guard de cliente en el `superRefine`: si el monto es igual al que regiría
   en el mes elegido para ese destino (entre las filas de `history` del
   mismo destino con `validFrom <=` mes elegido y `supersededById === null`,
   la de mayor `validFrom`), error en `amountCents`: "Es el mismo valor que
   ya tiene para ese mes".
7. Toast de éxito según modo: "Valor de cuota actualizado" / "Valor de cuota
   creado". Reset del formulario al cerrar, como hoy.
8. Actualizar los comentarios de cabecera de ambos archivos (la fila tiene
   acción pero sigue insertando; el sheet tiene dos modos y por qué).

**Aceptación (lo verificable sin base; el `test-engineer` decide qué cubre con
tests de vista en `tests/views/settings/`):**

- Con el overview del seed (default vigente, categoría programada): la fila
  "Por defecto" tiene botón "Cambiar" y la fila programada también; Historia
  no tiene botones.
- La fila "Por defecto" no muestra "Cambia a…" (el programado es de otra
  categoría); si se agrega al overview un default programado, lo muestra con
  su monto y mes.
- En Historia, una entrada con `supersededById` muestra "Reemplazado".
- Tocar "Cambiar" en la fila vigente abre el sheet con título "Cambiar valor
  de cuota", la etiqueta del destino, "Hoy: …", monto vacío, y envía a
  `createFeePrice` **exactamente** el scope/memberType/categoryId de esa fila
  (no editables), con el `validFrom` elegido.
- Tocar "Cambiar" en una fila programada preselecciona su mes.
- Elegir un mes que ya tiene valor para ese destino muestra "Reemplaza el
  valor de…"; elegir otro mes lo oculta.
- Enviar el mismo monto que regiría en el mes elegido no llama a la action y
  muestra "Es el mismo valor que ya tiene para ese mes" en el campo.
- `result.field === 'validFrom'` con el mensaje del guard de Postgres se
  pinta bajo "Aplica desde" (camino existente).
- El `<form>` lleva `method="post"` (regla de lint).
- A 390px: ninguna fila parte el monto o el botón a una segunda línea
  (captura o inspección del DOM como el pipeline `2026-09-28-ui-expresiva`).
- Hook de `impeccable` sin hallazgos pendientes; `npm run lint` y
  `npm run typecheck` verdes.

**Fuera de alcance / no hacer:** edición inline; selector de alcance en modo
cambio; botón "Cancelar valor programado"; tocar `settings-page-view.tsx`,
`billing-section.tsx` o `views/shared`; nuevas variantes de `StatusPill`;
cualquier fetch en la vista.

**Log:** `docs/pipelines/2026-10-15-cambiar-valor-cuota/02-development-frontend.md`.

---

## Lane `tests` — `test-engineer`

### T1 — Suite verde con la regla de corrección

**Posee en exclusiva:** todo `tests/**`. **No toca:** `src/**`,
`supabase/**`.

**Skills:** `supabase-postgres-best-practices` (para leer el SQL de S1 antes
de escribir los `[DB]`), `supabase` (RLS/claims en `tests/db/helpers.ts`).

**Qué cambiar y agregar:**

- `tests/models/fee-prices.model.test.ts`: los casos de B1 (desempate en
  `current`, deduplicación de `upcoming`, `supersededById` en `history`,
  destinos distintos no se pisan, meses distintos no se pisan); eliminar
  "23505 → DomainError", agregar "23505 se relanza tal cual".
- `tests/db/billing.test.ts`: reemplazar "duplicado exacto → 23505" por los
  casos [DB] de S1 (segunda fila aceptada, `fee_price_for` devuelve la más
  nueva, desempate solo a igual mes, generación con el valor corregido,
  auditoría de los dos INSERT, índice no único presente).
- `tests/db/constraint-translations.test.ts`: eliminar "valor duplicado
  (23505) → field validFrom" (ya no existe la constraint ni la traducción).
- `tests/controllers/settings.controller.test.ts`: el mock de
  `getFeePricesOverview` sigue válido (`history: []`); ajustar solo si el
  tipo lo exige.
- `tests/controllers/billing.actions.test.ts`: sin cambios esperados.
- `tests/views/settings/fee-prices-section.test.tsx` (nuevo, opcional según
  el costo real de renderizar `ResponsiveSheet` en jsdom: si es caro, cubrir
  solo la sección sin abrir el sheet): botón "Cambiar" en vigentes y
  próximos, no en Historia; "Cambia a…" en la fila vigente con un programado
  del mismo destino; "Reemplazado" en Historia.
- Verificar que `tests/db/grants-and-lockdown.test.ts` sigue verde sin
  tocarlo (ningún grant cambió).

**Aceptación:** `npm test` verde con Docker arriba (los `[DB]` corren) y sin
Docker (se saltean), `SUITE GREEN` en
`docs/pipelines/2026-10-15-cambiar-valor-cuota/03-tests.md`. Un test que
revele un bug en `src/**` se reporta ahí, no se arregla en `tests/`.

---

## `code-reviewer`

Revisa el diff completo contra `00-architecture.md`: que `fee_prices` siga sin
UPDATE/DELETE para nadie; que el guard no se haya tocado; que la única
redefinición de `fee_price_for` sea la de S1 y conserve grants y `search_path`;
que el modelo no haya ganado una RPC ni un fetch nuevo; que la vista no
importe modelos ni haga fetch; que el sheet mande el mismo `FeePriceInput` en
los dos modos; copy en rioplatense, sin "editar" ni "borrar"; 44px, estados,
390px. Veredicto en `03-review.md`.
