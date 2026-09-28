# 02 — Desarrollo backend: B4 — Listados de cobranza y panel

Agente: `senior-backend-engineer` (B4). Pipeline `2026-09-27-cuotas-pagos-panel`.
Fuente: `01-tasks.md` (sección B4) y `00-architecture.md` §6.6, §6.7, §13.5.

## Archivos

- `src/models/reports.model.ts` (nuevo)
- `src/controllers/reports.controller.ts` (nuevo)
- `src/controllers/reports.actions.ts` (nuevo, agregado en la ronda de fixes
  de F1, ver "Fixes post-entrega" abajo)

No se tocó nada de `supabase/**`, `tests/**`, `types.ts`, `views/**`, `app/**`
ni archivos de B1/B2/B3.

## Qué expone

### `src/models/reports.model.ts`

Todo lector puro sobre las RPC de `20260927130200_accounts.sql` (S3), sin
sumar nada en TypeScript (CLAUDE.md: PostgREST corta en `max_rows` sin
avisar, toda agregación va en SQL). Ninguna función chequea permiso: eso lo
hace el controller antes de llamar acá (mismo patrón que `audit.model.ts`) —
la RPC igual lo vuelve a chequear en el cuerpo (`private.require_permission`),
así que hay dos capas, no una.

- `listMemberAccounts(filters: AccountListFilters = {}): Promise<Page<MemberAccount>>`
  — `member_accounts` paginado. `status` → `status_filter` (default `'active'`),
  `categoryId` → `category_filter` (inscripción abierta), `debt` (si no es
  `'any'`) → `.eq('debt_status', ...)` sobre el resultado de la RPC. Orden fijo
  `months_due desc, balance_cents desc, full_name`. Páginas **fijas de 200**
  (constante `ACCOUNTS_PAGE_SIZE`, no configurable desde `filters.limit`: la
  spec de B4 pide un tamaño uniforme para el "cargar más" de `/cobranza`).
  Cursor = **offset en base64url** (no keyset): el orden pedido no tiene una
  columna de desempate estable entre `full_name` iguales, así que un keyset
  no cierra; con ~250 socios el costo de `OFFSET` es irrelevante. `.range()`
  siempre explícito (nunca un pedido sin `range`, por la regla de
  `max_rows`), pidiendo una fila de más para saber si hay próxima página sin
  un segundo round trip.
- `listTopDebtors(limit): Promise<MemberAccount[]>` — mismo RPC y mismo orden,
  filtrado a `debt_status = 'in_debt'` y `status_filter = 'active'`, para el
  top de morosos del panel.
- `getDashboardSummary(): Promise<DashboardSummary>` — `dashboard_summary()`,
  `.single()` (la función siempre devuelve una fila).
- `listDebtByCategory(): Promise<DebtByCategoryRow[]>` — `debt_by_category()`,
  con `.order('sort_order')` explícito en TS aunque la función ya devuelva las
  filas ordenadas: no depender de un plan de ejecución implícito.
- `getMonthlyHistory(months = 12): Promise<MonthlyHistoryPoint[]>` —
  `monthly_history(months)`.
- `getMonthCollection(targetPeriod?): Promise<MonthCollection>` —
  `month_collection(target_period)`, `.single()`.

### `src/controllers/reports.controller.ts`

- `getDashboard(): Promise<DashboardData>` — guard `requirePanelPermission
  ('reports.read')`; `Promise.all` de `getDashboardSummary`, `listTopDebtors(5)`,
  `listDebtByCategory`, `getMonthlyHistory(12)` y `getBillingStatus()` (B1).
  Con facturación inactiva no hace falta un camino especial: las RPC ya
  devuelven `billingActive: false` y todo en cero/vacío.
- `getCobranzaHub(): Promise<CobranzaHubData>` (tipo local, no está en
  `types.ts` porque es específico de esta page) — guard `payments.read`;
  `{ collection: MonthCollection; billing: BillingStatus }` del mes actual.
- `getDebtListing(filters)` / `getUpToDateListing(filters)` — guard
  `payments.read`; delegan en `listMemberAccounts` forzando
  `debt: 'in_debt'` / `'up_to_date'` respectivamente. Reciben
  `Omit<AccountListFilters, 'debt'>` porque el filtro de deuda ya lo fija la
  ruta, no el caller.
- `getDebtByCategoryPage(): Promise<DebtByCategoryPage>` (tipo local) — guard
  `payments.read` (así lo pide la spec de B4, aunque la RPC interna chequee
  `reports.read`; con el catálogo de hoy ambos permisos los tienen los tres
  roles, así que no cambia quién ve qué). `totalCents` sale de
  `dashboard_summary().totalDebtCents`, **nunca** de sumar `rows` en TS — se
  verificó contra la base que ambos números coinciden exactamente (ver
  "Verificación").

Todas las funciones de permisos usan `requirePanelPermission` (T12), nunca
`requireRole`/`requirePanelAccess`.

## Dependencia con `getBillingStatus` (B1) — RESUELTA

`getCobranzaHub` y `getDashboard` importan `getBillingStatus` desde
`@/models/billing.model` (B1, en paralelo). Se escribió inicialmente contra
la firma que la propia spec de B1 declara literalmente ("`getBillingStatus`
no exige permiso: la usan `/socios`, `/cobranza` y el panel"), sin que el
archivo existiera todavía. B1 aterrizó `src/models/billing.model.ts` a mitad
de esta tarea (reanudado en paralelo tras el reset de la base) y exporta
`getBillingStatus(): Promise<BillingStatus>` con exactamente ese nombre y esa
firma — cero ajuste necesario en `reports.controller.ts`.

Verificado con `npx tsc --noEmit` sobre el repo completo (no solo mis
archivos): `reports.model.ts` y `reports.controller.ts` no producen NINGÚN
error. Los errores restantes del typecheck del repo son de B1 (`fees.model.ts`,
un `period` faltante al insertar un cargo — no es mío), B3/frontend
(`member-categories.model.ts`, `member-detail-view.tsx`, `member-form.tsx`,
`member-list.tsx`, `audit-labels.ts`) y de `tests/models/members.model.writes.
test.ts` (test-engineer, `categoryIds` faltante tras el cambio de contrato de
S0) — todos fuera de mi ownership, no los toqué.

## Decisiones y por qué

- **Nulabilidad real vs. tipos generados.** `database.types.ts` declara las
  columnas de retorno de `member_accounts`, `dashboard_summary`,
  `debt_by_category`, etc. sin `| null` donde la función SÍ puede devolver
  null en runtime (`current_fee_cents`/`current_fee_period` sin facturación
  activa o con inicio futuro; `category_id`/`discipline_id`/`discipline_name`
  null en las filas `social`/`opening_balance` de `debt_by_category`). Es un
  límite conocido del generador de tipos de Supabase con funciones (no
  infiere nulabilidad de columnas de retorno como sí lo hace con tablas). Se
  resolvió declarando tipos de fila LOCALES con la nulabilidad verificada
  contra el SQL de `20260927130200_accounts.sql`, e imponiéndolos con
  `.overrideTypes<Row[], { merge: false }>()` en vez de confiar en el tipo
  generado o hacer `as` a ciegas. No es un problema de schema a reportar: es
  una limitación conocida y documentada del tooling, no algo para arreglar en
  una migración.
- **`getDebtByCategoryPage` en `payments.read` y no `reports.read`.** Así lo
  pide la spec de B4 explícita ("`getCobranzaHub`, `getDebtListing`,
  `getUpToDateListing`, `getDebtByCategoryPage` → `payments.read`"), aunque
  la RPC `debt_by_category` chequee `reports.read` en su cuerpo. Con el
  catálogo de permisos de hoy (§6.8) los tres roles tienen ambos permisos, así
  que no cambia ningún resultado observable; documentado acá por si el
  pipeline de roles configurables algún día separa esos dos permisos entre
  roles distintos — en ese momento hay que decidir cuál de los dos manda.
- **Cursor de offset, no keyset, para `listMemberAccounts`.** Ver comentario
  en el archivo: el orden (`months_due desc, balance_cents desc, full_name`)
  no tiene una columna final única para desempatar un keyset (dos socios
  pueden compartir apellido, saldo y meses adeudados). La spec de B4 pide
  explícitamente "páginas de 200 con cursor de offset", así que no hace falta
  inventar una columna de desempate synthetic.
- **`listDebtByCategory` reordena en TS aunque la RPC ya ordene.** Defensivo:
  la función SQL hace `order by 9, 3` dentro de su cuerpo, pero pedir el mismo
  orden desde PostgREST no cuesta nada y no depende de que un futuro cambio en
  el cuerpo de la función preserve el orden implícito de un `return query`.

## Verificado contra la base real

Stack local reseteado por el hilo principal a mitad de esta tarea (nuevas
migraciones + seed; ids distintos a los de la primera pasada). Se verificó
con `docker exec -i supabase_db_lonqui psql -U postgres`, simulando sesión
con `set_config('request.jwt.claims', ...)` + `set local role authenticated`
dentro de una transacción con `rollback` (mismo patrón que
`tests/db/helpers.ts`, sin dejar filas):

- `member_accounts(null, 'active', null)` devuelve las columnas esperadas;
  ordenado por `months_due desc, balance_cents desc, full_name` como en el
  modelo.
- Filtro `where debt_status = 'in_debt'` (equivalente al `.eq()` de
  `listMemberAccounts`/`listTopDebtors`) funciona sobre el resultado de la
  RPC.
- `category_filter` con un id de categoría sin inscriptos devuelve 0 filas
  (no error): el filtro se aplica, no rompe con datos vacíos.
- `dashboard_summary().total_debt_cents` = `12.500.000` centavos con el seed
  actual.
- **`sum(debt_by_category().debt_cents) = dashboard_summary().
  total_debt_cents` exactamente (12.500.000 = 12.500.000)**: la invariante
  D31/D32 que `getDebtByCategoryPage` da por sentada (spec B4: "para que la
  vista pueda mostrar 'coincide con la deuda total'") se sostiene con datos
  reales, incluidas las filas `social` y `opening_balance`.
- `monthly_history(3)` y `month_collection(null)` devuelven una fila por
  período / una fila total, con `collected_cents`/`fees_cents` coherentes
  entre sí (`month_collection` de septiembre coincide con la fila de
  septiembre de `monthly_history`).
- `anon` (rol de sesión `anon`, sin `request.jwt.claims` de usuario) recibe
  `permission denied for function member_accounts` — el `revoke ... from
  public, anon` de la migración funciona como documenta CLAUDE.md.
- Un `app_user` con `role = 'consulta'` (creado y revertido dentro de la
  misma transacción) SÍ puede leer `dashboard_summary()` y `member_accounts()`
  — confirma que `payments.read`/`reports.read` están en el catálogo de los
  tres roles (§6.8), consistente con que B4 use `payments.read` en todos sus
  controllers de listado.

No se corrió `db:reset` ni se tocó ninguna migración: todo lo anterior es
lectura dentro de una transacción con `rollback`.

## Qué necesita `tests/db/` (para `test-engineer`)

Estos son invariantes de Postgres que ya se verificaron a mano pero que
necesitan un test que corra en cada cambio, no solo en esta sesión:

1. **`sum(debt_by_category().debt_cents) = dashboard_summary().
   total_debt_cents`** con un fixture que incluya cargos de deporte,
   sociales y saldo de arranque, algunos anulados — es la invariante que
   `getDebtByCategoryPage` expone a la UI como "coincide con la deuda total".
2. `member_accounts(...)` con `category_filter` de una categoría con
   inscriptos: devuelve exactamente esos socios, y la deuda que trae cada
   fila sigue siendo la TOTAL del socio (no la de esa categoría) — la
   diferencia con `debt_by_category` (que sí atribuye por categoría) es a
   propósito y fácil de confundir en una regresión.
3. `anon` sin permiso en las 6 RPC de este modelo (`member_accounts`,
   `member_fee_statement` —no la usa este archivo, pero comparte grants—,
   `month_collection`, `dashboard_summary`, `debt_by_category`,
   `monthly_history`): las seis con `revoke ... from public, anon` y
   `grant ... to authenticated`.
4. `current_fee_cents`/`current_fee_period` null en `member_accounts` cuando
   `billing_start_period` es null o futuro (el cambio que el hilo principal
   avisó a mitad de esta tarea): un test que arme ese escenario y confirme
   que la fila trae `current_fees: []` y ambos campos null, no que tire.

Nada de esto lo puede probar un test de TypeScript con mocks: son invariantes
de la base (RLS, agregación SQL), como pide CLAUDE.md.

## Fuera de alcance (según el brief, no se tocó)

- Exportación a CSV (`log_export` sigue sin consumidor: es del slice 3).
- `/reportes`, cualquier página o vista.
- Escrituras (pagos, cuotas, activación de facturación): B1/B2.
- Padrón (`/socios`): B3.

## Typecheck y lint

- `npx tsc --noEmit`: sin errores en `reports.model.ts` ni
  `reports.controller.ts`, salvo el `Cannot find module '@/models/
  billing.model'` esperado (documentado arriba). El resto de errores del
  repo son de archivos de B3/frontend, no tocados acá.
- `npx eslint src/models/reports.model.ts src/controllers/reports.controller.ts`:
  limpio.

## Fixes post-entrega (2026-09-28, dos hallazgos de F1)

### 1. "Al día" excluía a los socios con saldo a favor

`getUpToDateListing` fuerza `debt: 'up_to_date'` y `listMemberAccounts`
traducía eso a `.eq('debt_status', 'up_to_date')`: un socio con `debt_status
= 'credit'` (pagó de más) no le debe nada al club, pero quedaba afuera de
"al día" Y de "con deuda" — invisible en los dos listados de `/cobranza`.
`Ramón Histórico` en el seed es exactamente ese caso (`balance_cents =
-2.000.000`, `debt_status = 'credit'`).

**Fix** en `listMemberAccounts` (`reports.model.ts`): cuando `filters.debt
=== 'up_to_date'`, el filtro pasa a `.in('debt_status', ['up_to_date',
'credit'])` en vez de `.eq(...)`. `debt: 'in_debt'` y un eventual `debt:
'credit'` explícito siguen siendo filtros estrictos de un solo valor (no se
tocó `getDebtListing` ni `listTopDebtors`, que ya filtran `'in_debt'`
correcto). La regla vive en un solo lugar (el modelo), no en el controller
ni en la Server Action nueva: así ningún consumidor futuro de
`listMemberAccounts` con `debt: 'up_to_date'` puede olvidarse de incluir
`credit`.

Verificado contra la base real (rollback, sin dejar filas): antes del fix,
`where debt_status = 'up_to_date'` no traía a Ramón Histórico (member_id 8);
con `where debt_status = any(array['up_to_date','credit'])` sí aparece,
junto con los demás socios en `up_to_date` y en `credit`.

### 2. Sin "cargar más" para los listados de cobranza

`listMemberAccounts` siempre devolvía una sola página de 200 sin forma de
pedir la siguiente desde la UI: con más de 200 socios en un bucket,
`/cobranza/deuda` y `/cobranza/al-dia` se quedaban truncados en silencio.

**Fix**: Server Action nueva en `src/controllers/reports.actions.ts`
(archivo nuevo, `'use server'` en la primera línea, solo exporta funciones
async):

```ts
export async function loadMoreMemberAccounts(input: unknown): Promise<ActionResult<Page<MemberAccount>>>
```

Mismo patrón que `loadMoreMembers` (`members.actions.ts`) y
`loadMoreMonthPayments` (`payments.actions.ts`): `requirePermission
('payments.read')` primero (T12), después `loadMoreMemberAccountsSchema.
safeParse(input)` (Zod `.strict()`, nueva, exportada desde `reports.model.
ts` junto al resto de los tipos/queries de esta lectura — mismo lugar donde
vive `loadMoreMembersSchema` para `members.model.ts`), después
`listMemberAccounts(parsed.data)`. `input` es `unknown` a propósito: lo llama
un Client Component (F1), así que se valida en el borde — a diferencia de
`getDebtListing`/`getUpToDateListing`, que reciben filtros ya tipados desde
un Server Component.

**Firma para F1** (`src/views/**`, no la toqué):

```ts
import { loadMoreMemberAccounts } from '@/controllers/reports.actions'

// input: { debt?: 'any'|'up_to_date'|'in_debt'|'credit', categoryId?: number,
//          status?: 'active'|'inactive'|'all', cursor?: string }
// (mismo shape que AccountListFilters sin `limit`: la página es fija de 200)
const result = await loadMoreMemberAccounts({ ...filtrosDeLaPageActual, cursor: page.nextCursor })
if (result.ok) {
  setItems((prev) => [...prev, ...result.data.items])
  setNextCursor(result.data.nextCursor)
} else {
  // result.error (y result.field si aplica): mostrar como en loadMoreMembers
}
```

No se llama a `revalidatePath` acá: es una lectura ("cargar más"), no una
escritura — mismo criterio que `loadMoreMembers`/`loadMoreMonthPayments`, que
tampoco revalidan.

Verificado: `offset`/`limit` sobre `member_accounts(...)` con el orden
`months_due desc, balance_cents desc, full_name` devuelve páginas
consistentes (se probó `offset 0 limit 2` sobre el bucket `in_debt` del seed
actual). El cursor que expone `listMemberAccounts` (offset en base64url) es
exactamente el que la Server Action reenvía sin decodificar — `reports.
actions.ts` no sabe que es un offset, solo lo pasa como `string`.

### Verificación y typecheck/lint tras los fixes

- `npx tsc --noEmit`: cero errores en `reports.model.ts`, `reports.
  controller.ts` y `reports.actions.ts`.
- `npx eslint src/models/reports.model.ts src/controllers/reports.
  controller.ts src/controllers/reports.actions.ts`: limpio.
- Verificado contra la base real (psql, `set_config('request.jwt.claims',
  ...)` + `set local role authenticated`, dentro de una transacción con
  `rollback`): ambos hallazgos confirmados y corregidos (ver arriba).
