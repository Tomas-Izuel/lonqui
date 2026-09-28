# 02 — Desarrollo backend B1: facturación (valores de cuota, activación, generación)

Agente: `senior-backend-engineer`, lane `backend`, tarea **B1** de
`01-tasks.md` (§ B1, líneas 582–639), con `00-architecture.md` §6.1, §6.4,
§6.5, §6.8, §8.2 y **§13 (Revisión 3, manda donde choque)** como contrato.

Nota de proceso: esta tarea se retomó después de un corte por límite de gasto
de la API a mitad de la investigación (antes de escribir código). No hubo
que deshacer nada: se retomó leyendo `01-tasks.md`/`00-architecture.md` desde
cero y verificando el estado real de la base con `db:reset` ya corrido por el
hilo principal (incluye S0–S4: `member_categories`, `0005_billing`,
`0006_payments`, `0007_accounts`, seed, `database.types.ts` regenerado).

## Archivos tocados (todos dentro de mi ownership declarado)

- `src/models/fee-prices.model.ts` — **nuevo**.
- `src/models/billing.model.ts` — **nuevo**.
- `src/models/settings.model.ts` — modificado (`updateSettingsSchema` pierde
  `billingStartPeriod`).
- `src/controllers/settings.controller.ts` — modificado (`getSettingsPage`
  suma `feePrices`, `billing`, `categoriesByDiscipline`; permiso en vez de rol).
- `src/controllers/settings.actions.ts` — modificado (solo el comentario de
  cabecera; el schema ya venía sin `billingStartPeriod` desde el modelo, no
  hizo falta tocar la lógica de la action).
- `src/controllers/billing.actions.ts` — **nuevo**.

No toqué `types.ts`, `session.controller.ts`, `lib/**`, `views/**`, `app/**`,
`supabase/**`, `tests/**`, ni archivos de B2 (`payments*`, `fees.model.ts`,
`accounts.model.ts`, `audit.model.ts`), B3 (`members*`, `member-categories.model.ts`,
`catalogs.model.ts`) o B4 (`reports*`) — todos ya existían o se modificaron en
paralelo por otros agentes; los dejé como los encontré.

## Contratos expuestos

### `src/models/fee-prices.model.ts`

- `createFeePriceSchema` (Zod `.strict()` + `.superRefine`) y su tipo
  `CreateFeePriceInput` (compatible con `FeePriceInput` de `types.ts`):
  repite en TS el CHECK `fee_prices_scope_shape` (scope ↔
  `memberType`/`categoryId`) para devolver el campo exacto sin ir a Postgres.
- `listFeePrices(): Promise<FeePrice[]>` — historia completa, desc por
  `valid_from, id`.
- `getFeePricesOverview(): Promise<FeePricesOverview>` — parte la historia en
  `current` (el de mayor `validFrom <= mes actual` por scope/target, D19) y
  `upcoming` (programados a futuro); `history` es la lista completa. Nunca
  recalcula un precio de socio: eso es `private.fee_price_for`, solo para
  mostrar.
- `createFeePrice(input): Promise<FeePrice>` — traduce:
  - `23505` (duplicado exacto de scope/target/mes) → `DomainError('Ya hay un
    valor para ese alcance desde ese mes', { field: 'validFrom' })`.
  - `23514` (trigger `fee_prices_insert_guard`: mes pasado, o mes que ya
    generó cuotas con otro valor) → `DomainError(error.message, { field:
    'validFrom' })`. El mensaje del trigger ya viene armado para el usuario
    (incluye el mes en `MM/YYYY`), se envuelve tal cual.
  - `23503` (FK a `categories`) → `DomainError('Esa categoría no existe', {
    field: 'categoryId' })` (defensivo; Zod ya exige `categoryId` positivo).

### `src/models/billing.model.ts`

- `listBillingRuns(limit = 10): Promise<BillingRun[]>` — últimas corridas
  desc; resuelve `actorName` con una consulta propia a `app_users` (mismo
  patrón que `audit.model.ts:resolveActorNames`, duplicado a propósito para
  no acoplar este archivo al de otro slice en paralelo — `billing_runs.actor_id`
  no tiene FK, así que no hay embed de PostgREST posible).
- `getBillingStatus(): Promise<BillingStatus>` — compone `settings` +
  `lastGeneratedPeriod` (max `period` de `fees` `kind='monthly'`) +
  `dashboard_summary` (`pendingPeriods`, `activeMembers`) + `billing_runs`
  (`lastRun`, `recentRuns`, `currentPeriodRun`). **No exige permiso.** Antes
  de leer `billing_runs` pregunta con `my_permissions()` si la sesión tiene
  `billing.configure`: si no, nunca calcula `failed`/`missing` (quedan en
  `ok`/`not_due` según corresponda) — evita confundir "no hay corridas" con
  "no puede verlas", que es exactamente lo que pedía la aceptación ("para
  quien no, `currentPeriodRun` es `ok` o `not_due`").
- `generatePendingFees(): Promise<number>` — llama a la RPC
  `public.generate_pending_fees()` (sin argumentos: usa `auth.uid()`
  adentro). La RPC **no relanza** sus errores (relanzar revertiría la fila de
  `billing_runs` que registra la falla): devuelve
  `(status, fees_created, error_message)` y acá se traduce `status='error'`
  o `'skipped'` a `DomainError(error_message)`; `'ok'` devuelve
  `fees_created`. `42501` (insufficient_privilege, defensivo — la action ya
  exige `billing.configure`) → `PermissionError`.
- `activateBilling(startPeriod): Promise<{ generated: number }>` — `UPDATE
  settings.billing_start_period`; el trigger `settings_billing_guard` valida
  las cuatro condiciones de §6.5 (`23514` → `DomainError(error.message, {
  field: 'startPeriod' })`; `42501` defensivo → `PermissionError`). Si
  `startPeriod` es el mes actual, llama a `generatePendingFees()` de una; si
  es futuro, `{ generated: 0 }` (lo genera el cron el día 1).

### `src/controllers/settings.controller.ts`

- `getSettingsPage(): Promise<SettingsPageData>` con
  `SettingsPageData = { settings, disciplines, categoriesByDiscipline,
  feePrices, billing }`. **Cambio de guard**: `requirePanelPermission('settings.manage')`
  en vez de `requirePanelAccess('admin')` (T12/D20 — con el mapeo de hoy es
  lo mismo, pero la firma ya no cambia cuando exista el pipeline de roles).
  `categoriesByDiscipline` es un nombre que invento yo (no está en
  `01-tasks.md`, que solo dice "las categorías activas agrupadas por
  disciplina"): son las mismas `DisciplineWithCategories[]` de
  `listDisciplines({ includeInactive: false })`, para el selector de "valor
  de cuota por categoría" en `NewFeePriceSheet` (F4) — no tiene sentido fijar
  un precio para una categoría que el club ya dio de baja. **F4: el campo se
  llama `categoriesByDiscipline`, no `activeCategories` ni nada parecido.**

### `src/controllers/billing.actions.ts` (nuevo)

- `createFeePrice(input: unknown): Promise<ActionResult<FeePrice>>` —
  `requirePermission('billing.configure')`.
- `activateBilling(input: unknown): Promise<ActionResult<{ generated: number }>>`
  — ídem, Zod valida `{ startPeriod }` primer día de mes.
- `generatePendingFees(): Promise<ActionResult<{ generated: number }>>` —
  ídem, sin input.
- Las tres `revalidatePath('/', 'layout')` (T11: una cuota generada puede
  cambiar lo que muestran `/`, `/socios`, `/cobranza` y `/ajustes` a la vez).

## Decisión de diseño: dónde vive la traducción de errores

La nota del hilo principal decía "la action mapea `error` → `DomainError`,
`skipped` → mensaje informativo". Implementé la traducción en el **modelo**
(`billing.model.ts:generatePendingFees`), no en la action, siguiendo el
patrón ya establecido en el resto del repo (`members.model.ts:translateMemberError`,
`catalogs.model.ts`): los modelos traducen errores de Postgres/RPC a
`DomainError`, las actions solo capturan con `failure()`. El resultado
observable es el mismo (la action recibe una excepción con el mensaje
correcto y la convierte en `ActionResult` de error); documentado acá para que
quede claro que no ignoré la instrucción, elegí la capa según la convención
del repo.

`GenerateFeesResult` (tipo en `types.ts`, con `status`/`feesCreated`/`errorMessage`)
**no lo usé**: ni `01-tasks.md` ni `00-architecture.md` lo nombran como
contrato de B1 (la lista de "Contratos" de B1 no lo incluye), y el texto de
aceptación es explícito en que la action devuelve `{ generated: number }` o
lanza `DomainError`. Lo dejo como hallazgo por si el hilo principal lo diseñó
para otro consumidor (¿F4 lo necesita para pintar el estado de una corrida en
curso?) — hoy no tiene ningún llamador en el repo.

## Reglas de negocio, invariantes y qué se verificó contra la base real

Verifiqué todo lo siguiente contra `supabase_db_lonqui` (stack local, ya con
`db:reset` corrido por el hilo principal), simulando roles con
`set_config('request.jwt.claims', ...)` + `set local role authenticated`
dentro de `begin ... rollback` (sin dejar filas). Usuarios de prueba:
el admin seedeado (`f15200ba-b4c6-49b0-8295-1ec3e7916013`) y dos `auth.users`/`app_users`
temporales (`editor`, `consulta`) creados y revertidos en la misma transacción.

- **`private.can` y `my_permissions()` por rol**: coinciden EXACTO con la
  tabla de §6.8 — admin los doce permisos, editor
  `{members.read, members.write, payments.read, payments.register,
  reports.read, reports.export}`, consulta `{members.read, payments.read,
  reports.read, reports.export}`.
- **`fee_prices` INSERT como `editor`** → `new row violates row-level
  security policy` (RLS bloquea antes de llegar al trigger; en la app esto
  ni se intenta, `requirePermission('billing.configure')` corta antes).
- **`fee_prices_insert_guard`**: `valid_from` de un mes pasado (`2026-08-01`
  con "hoy" `2026-09-27`) → `"Un valor de cuota nuevo aplica desde este mes o
  uno futuro"`; `valid_from` de un mes con cuotas ya generadas (`2026-09-01`,
  que ya tiene 11 `fees` `kind='monthly'` del seed) → `"Las cuotas de
  09/2026 ya se generaron con otro valor; el nuevo aplica desde 10/2026"`
  (el `MM/YYYY` sale bien formateado). Ambos con mi traducción quedan como
  `DomainError` con `field: 'validFrom'`.
- **Unique `fee_prices_unique_target`**: duplicar `(category, 9, 2026-10-01)`
  (ya existe en el seed) → `duplicate key value violates unique constraint`
  → mi traducción: `"Ya hay un valor para ese alcance desde ese mes"`.
- **Insert válido** (`default`, `2026-11-01`, no generado, no duplicado) →
  OK, fila creada.
- **`forbid_change` en `fee_prices`**: `UPDATE`/`DELETE` fallan incluso sin
  ningún JWT (sesión `postgres`, superusuario): el trigger no mira rol ni
  `auth.uid()`, es incondicional. Confirma "nadie" en la matriz §6.7,
  incluido el caso más fuerte (superusuario).
- **`settings_billing_guard`**: volver `billing_start_period` a `null` como
  admin → `"La facturación no se puede desactivar una vez activada"`;
  cambiarlo con cuotas ya generadas (hay 11 en el seed) → `"El mes de inicio
  ya no se puede cambiar: hay cuotas generadas"`. Ambos verificados con una
  sesión `authenticated` genuina (confirmé `select private.can('billing.configure')`
  = `true` en la misma conexión antes del `UPDATE`, para no repetir el error
  de test que tuve la primera vez — ver nota debajo).
- **`settings` UPDATE como `editor`** → `UPDATE 0` (la policy de slice 1
  bloquea silenciosamente, ni siquiera llega al trigger nuevo).
- **`generate_pending_fees()` como `editor`** → `insufficient_privilege`,
  `"No tenés permiso para generar cuotas"` (mi código lo traduce a
  `PermissionError`, defensivo — la action ya exige el permiso antes).
- **`generate_pending_fees()` como `admin`, llamado de nuevo sin nada
  pendiente** → `status='ok'`, `fees_created=0`, y **sí** agrega una fila
  nueva a `billing_runs` (conteo `1 → 2`): confirma "siempre registra una
  fila para el período actual", que es lo que necesita
  `getBillingStatus().lastRun`/`recentRuns` para reflejar la corrida más
  reciente aunque no haya creado nada.
- **`billing_runs` RLS**: `editor`/`consulta` ven `0` filas, `admin` ve las
  reales. **`billing_runs` UPDATE** → `permission denied for table
  billing_runs` incluso para `admin` autenticado (no hay grant de `UPDATE`
  para nadie, ni siquiera llega a un trigger: el `REVOKE` de tabla ya corta).

**Hallazgo de metodología (no de schema, para quien escriba `tests/db/`):**
mezclar `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` con `set_config(...,
true)`/`SET LOCAL ROLE` sin resetear AMBOS (`RESET ROLE` **y**
`set_config('request.jwt.claims', '', true)`) después de cada bloque hace que
un `ROLLBACK TO SAVEPOINT` anterior "resucite" el rol/los claims que estaban
vigentes en el momento en que se creó ese savepoint — no un estado neutro. Me
pasó una vez (un `UPDATE settings` que debía correr como `admin` corrió con
claims de `editor` que habían quedado pisados) y lo detecté porque el mensaje
de error fue `"No tenés permiso para activar la facturación"` en vez del
esperado. `tests/db/helpers.ts:actAsSuperuser` ya resetea las dos cosas
juntas — el patrón correcto ya está ahí, esto es solo una nota de por qué
importa hacerlo siempre así y no solo `RESET ROLE`.

## Lo que falta para tests/db (`[DB]` de S1 en `01-tasks.md`)

Todo lo de arriba es candidato directo a `tests/db/billing.model.test.ts` (o
donde el test-engineer decida): la matriz de `private.can`/`my_permissions`
por rol, los cuatro mensajes de `fee_prices_insert_guard`/`settings_billing_guard`,
la unique de `fee_prices`, el `forbid_change`, la idempotencia de
`generate_pending_fees()` y el conteo de `billing_runs`, y el `RLS`/lockdown
de `billing_runs`. No agregué nada a `tests/db/` (no es mi lane).

## Deferrals / fuera de alcance

- `FeePricesSection`, `NewFeePriceSheet`, `BillingSection` (`views/settings/**`,
  F4): consumen `feePrices`, `billing` y `categoriesByDiscipline` de
  `getSettingsPage()` — el contrato ya está, la UI no.
- El aviso "no se generaron las cuotas" en el panel inicial (F3) y en
  `/ajustes` (F4): usan `getBillingStatus().currentPeriodRun` +
  `generatePendingFees()` de `billing.actions.ts` (botón "Reintentar" /
  "Generar cuotas ahora").
- No toqué nada de `adjustment` (`fees.kind`): sigue en el CHECK sin ninguna
  policy que lo permita, como documenta la migración.
- No hay exportación CSV ni nada de `reports.export` en este archivo: eso es
  slice 3.

## Verificación de calidad

- `npm run typecheck`: sin errores atribuibles a mis archivos (hay errores
  preexistentes en archivos de B2/B3/tests que otros agentes están
  terminando en paralelo — `fees.model.ts`, `member-categories.model.ts`,
  `views/members/*`, `views/audit/audit-labels.ts`, `tests/models/members.model.writes.test.ts`
  — no son míos, no los toqué).
- `npx eslint` sobre los seis archivos que poseo: limpio, sin warnings.
