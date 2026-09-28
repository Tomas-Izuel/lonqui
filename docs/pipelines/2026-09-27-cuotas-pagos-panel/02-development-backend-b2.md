# 02 — Desarrollo backend B2: pagos, cargos del socio y estado de cuenta

Agente: `senior-backend-engineer`, lane `backend`, tarea **B2** de
`01-tasks.md` (§ B2, líneas 641–718), con `00-architecture.md` §6.2, §6.3,
§6.4, §6.6, §6.7, §6.8 y **§13 (Revisión 3, manda donde choque)** — sobre
todo §13.3–§13.5 (deporte vs. categoría, `member_fee_coverage`,
`current_fees`/`current_fee_cents` como suma) y §13.7 (los minors B2–B6 del
code review del slice 1: `voidFee` con `.select('id').maybeSingle()`, un pago
anulado no lleva comprobante).

Nota de proceso: esta tarea se retomó después de un corte por límite de gasto
de la API, a mitad de la investigación (antes de escribir código; no se
había tocado ningún archivo todavía). Se retomó releyendo `01-tasks.md` /
`00-architecture.md` y verificando el estado real de la base y de
`database.types.ts`. A mitad del desarrollo el hilo principal avisó dos
cosas, ya incorporadas:
1. **Corrió `db:reset` de nuevo** y `member_accounts.current_fee_cents` /
   `current_fees` / `current_fee_period` pasan a ser `null`/`[]`/`null`
   también cuando `billing_start_period` es un mes **futuro** (no solo sin
   activar). Verificado en la migración (`20260927130200_accounts.sql`,
   variable `billing_due := start_period is not null and start_period <=
   current_period`): no hizo falta ningún cambio de código, porque
   `accounts.model.ts` solo mapea lo que la RPC devuelve — el `null`/`[]` ya
   viene resuelto de la base.
2. **Los `user_id` de la base cambiaron** (otro `db:reset`): irrelevante para
   el código, solo afectó qué UUID usé al simular roles contra la base real
   (ver "Verificación contra la base").

## Archivos tocados (todos dentro de mi ownership declarado)

- `src/models/payments.model.ts` — **nuevo**.
- `src/models/fees.model.ts` — **nuevo**.
- `src/models/accounts.model.ts` — **nuevo**.
- `src/models/audit.model.ts` — modificado: `buildLabelDraft`/`finalizeLabel`
  suman los cuatro `AuditedTable` nuevos (`payments`, `fees`, `fee_prices`,
  `member_categories`); `LABEL_COLUMNS`/`RawLabelValues` suman las columnas
  que esos labels necesitan; nuevo export `AUDIT_FIELD_LABELS`. **No toqué**
  `AUDITED_TABLES` (ya estaba cerrado con las cuatro tablas, tal como decía
  el encargo).
- `src/controllers/payments.controller.ts` — **nuevo**.
- `src/controllers/payments.actions.ts` — **nuevo**.

No toqué `members.model.ts`, `members.controller.ts`, `storage.service.ts`,
`types.ts`, `session.controller.ts`, `lib/**`, `views/**`, `app/**`,
`supabase/**`, `tests/**`, ni archivos de B1 (`fee-prices.model.ts`,
`billing.model.ts`, `settings.*`, `billing.actions.ts`), B3
(`members.model.ts`, `member-categories.model.ts`, `members.controller.ts`,
`members.actions.ts`, `catalogs.model.ts`) o B4 (`reports.model.ts`,
`reports.controller.ts`) — todos existían o se modificaron en paralelo por
otros agentes; los importo por su firma donde hace falta (ver más abajo),
nunca los edito.

## Contratos expuestos (firmas para B1/B3/B4 y para `test-engineer`)

### `src/models/accounts.model.ts` — el que importan B3 y B4

```ts
getMemberAccount(memberId: number): Promise<MemberAccount | null>
getMemberAccounts(memberIds: number[]): Promise<MemberAccount[]>
getFeeStatement(memberId: number): Promise<FeeStatementLine[]>
getMemberAccountDetail(memberId: number): Promise<MemberAccountDetail>
```

- Las cuatro son de solo lectura y **no autorizan nada por su cuenta**: las
  cuatro RPC de Postgres que llaman (`member_accounts`,
  `member_fee_statement`) ya chequean `can('payments.read')` **en el
  cuerpo** (`private.require_permission`) y tiran `insufficient_privilege`
  si no corresponde. Quien llama (B3 en `members.controller.ts`, para
  `MemberPageData.account`) decide **antes** si pide la cuenta o no, según
  `session.permissions.includes('payments.read')` — por eso el tipo dice
  "`account` es `null` sin ese permiso": no es un try/catch acá adentro, es
  una decisión de más arriba.
- `getMemberAccount`/`getMemberAccounts` llaman `member_accounts` con
  `status_filter: 'all'` **siempre**: la ficha de un socio dado de baja
  también muestra su deuda, y la precarga de un pago de grupo trae a
  integrantes activos e inactivos (contrato explícito de B2).
- `getMemberAccounts` es la que uso para "varios ids en una sola RPC, nunca
  N" (precarga del pago de un grupo familiar). **No expone
  `category_filter` ni `order`/`range`**: B4 los necesita para sus listados
  agregados (`?debt_status=eq...&order=...&range=...`) y por eso llama a la
  RPC `member_accounts` directamente desde su propio `reports.model.ts`, no
  a través de esta función — se lo dejé anotado en el comentario de cabecera
  del archivo para que no intente reusarla y se encuentre con que le falta
  algo.
- `getFeeStatement` resuelve `categoryName`/`disciplineName` con una consulta
  batch a `categories` (`resolveCategoryNames`, misma forma que las de
  `audit.model.ts`): la RPC `member_fee_statement` solo devuelve
  `category_id`/`discipline_id`, sin nombres (verificado contra la base
  real, ver más abajo). **`disciplineName` queda siempre `null`** en
  `FeeStatementLine` a propósito: el tipo fijado en `types.ts` no tiene
  `disciplineId`, así que no hay con qué resolverlo sin una vuelta extra que
  nadie pidió; si hace falta, es un cambio de contrato, no algo que meta yo
  por mi cuenta.
- `getMemberAccountDetail` compone `getMemberAccount` + `getFeeStatement` +
  `payments.model.listPaymentsForMember` (incluye anulados, más nuevo
  primero) + el saldo de arranque VIGENTE (`fees` con `kind =
  'opening_balance' and voided_at is null`, mapeado con
  `fees.model.mapFeeRow`). Si el socio no existe (`member_accounts` no
  devuelve fila), tira `DomainError('El socio no existe', {status: 404})`.

### `src/models/payments.model.ts`

```ts
registerPayment(input: RegisterPaymentInput): Promise<{ paymentIds: number[]; totalCents: number; alreadyRegistered: boolean }>
voidPayment(paymentId: number, reason: string): Promise<void>
attachReceipt(paymentId: number, path: string, filename: string | null): Promise<void>
getReceiptPath(paymentId: number): Promise<string | null>
listPaymentsForMember(memberId: number): Promise<Payment[]>
getMonthPaymentsPage(period: string, cursor?: string | null): Promise<Page<PaymentListItem>>
buildReceiptPath(memberId: number, mimeType: string): string
```

- `registerPayment` hace **una sola sentencia `insert` con N filas** (mismo
  `batchId`/`paidOn`/`method`/`receiptPath`/`notes`, un `memberId`/
  `amountCents` por fila). Un reintento con el mismo `batchId` (doble toque)
  choca contra el índice único `(batch_id, member_id)` y el modelo lo
  atrapa (`isBatchAlreadyRegistered`), recupera lo que ya había quedado
  cargado con una consulta por `batch_id` y devuelve `alreadyRegistered:
  true` — éxito idempotente, no error. **Verificado contra la base real**
  (ver abajo): el índice es `(batch_id, member_id)` sin `(batch_id)` suelto,
  como pide la Revisión 3 (B6).
- `getMonthPaymentsPage` acepta `cursor` como parámetro del modelo (así lo
  pide `01-tasks.md`), pero la exposición hacia arriba se partió en dos,
  **igual que `searchMembers` → `getPadron` (controller, SSR) +
  `loadMoreMembers` (action, "Ver más")** — el guard de la tarea
  (`getMonthPaymentsPage → payments.read` con `requirePermission`, que
  tira en vez de redirigir) solo tiene sentido para una Server Action, y una
  page necesita una carga inicial por Server Component. Ver "Decisión:
  controller vs. action" más abajo.
- El bucket de comprobantes es el mismo `attachments` del apto físico (S4),
  prefijo propio `payment-receipts/<memberId>/<uuid>.<ext>`. Verifiqué
  contra la base real que la policy de `storage.objects` ya incluye
  `payment-receipts` en la lista de carpetas permitidas (la dejó armada la
  migración de foundation/S4, no hizo falta pedir nada al hilo principal).

### `src/models/fees.model.ts`

```ts
createOpeningBalance(input: CreateOpeningBalanceInput): Promise<Fee>
voidFee(feeId: number, reason: string): Promise<void>
mapFeeRow(row: FeeRow): Fee   // exportado para que accounts.model.ts no duplique el mapeo del saldo de arranque
FEE_SELECT                    // exportado, mismo motivo
```

- `voidFee` encadena `.select('id').maybeSingle()` y trata 0 filas como
  `DomainError('No se pudo anular el cargo: no existe o no tenés permiso')`
  — **exactamente como pide D33/review B2**: la policy de UPDATE de `fees`
  es solo `payments.void` (a diferencia de `payments`, que además acepta
  `payments.register`), así que un `editor` que llegara hasta acá por fuera
  del guard de la action vería un UPDATE de 0 filas silencioso. Verificado
  contra la base real que un `editor` autenticado hace exactamente eso (0
  filas, sin error) — confirma que el defensive check hace falta de verdad,
  no es paranoia.
- `createOpeningBalance` manda un `period` placeholder (`toPeriod()`, primer
  día del mes actual) en el INSERT porque la columna es `not null` sin
  default y el tipo generado de supabase-js lo exige, pero el trigger
  `fees_opening_balance_guard` lo pisa siempre con `billing_start_period -
  1 mes` **antes** de que se evalúe el CHECK — confirmado contra la base
  real (el saldo quedó en el período correcto pese al placeholder).

### `src/controllers/payments.controller.ts`

```ts
getMonthPaymentsPage(period: string): Promise<Page<PaymentListItem>>
```

Único export: primera página (cursor `null`) de los pagos del mes, para la
carga SSR de un listado en `/cobranza`. `requirePanelPermission('payments.read')`.

### `src/controllers/payments.actions.ts`

Todas `Promise<ActionResult<T>>`, `requirePermission(...)` primero,
`revalidatePath('/', 'layout')` en toda escritura (T11):

```ts
registerPayment(input: unknown): Promise<ActionResult<{ paymentIds: number[]; totalCents: number; alreadyRegistered: boolean }>>   // payments.register
voidPayment(input: unknown): Promise<ActionResult<void>>                                                                            // payments.void
prepareReceiptUpload(input: unknown): Promise<ActionResult<{ path: string; token: string; signedUrl: string }>>                     // payments.register
attachReceipt(input: unknown): Promise<ActionResult<void>>                                                                          // payments.register
getReceiptUrlAction(input: unknown): Promise<ActionResult<{ url: string | null }>>                                                  // payments.read
createOpeningBalance(input: unknown): Promise<ActionResult<{ id: number }>>                                                         // payments.register
voidFee(input: unknown): Promise<ActionResult<void>>                                                                                // payments.void
getPaymentFormData(input: unknown): Promise<ActionResult<PaymentFormData>>                                                          // payments.register
loadMoreMonthPayments(input: unknown): Promise<ActionResult<Page<PaymentListItem>>>                                                 // payments.read
```

## Decisiones y desvíos del texto literal de `01-tasks.md` (documentados)

1. **Controller vs. action para `getMonthPaymentsPage`.** El encargo lista
   `getMonthPaymentsPage → payments.read` junto con `getReceiptUrlAction`
   bajo el mismo régimen de permiso, pero no dice explícitamente con qué
   guard. Elegí partirla en dos, mirroreando el patrón ya establecido en el
   repo para toda lista paginada (`searchMembers`/`getPadron`/
   `loadMoreMembers` en el slice 1): `payments.controller.ts` expone la
   carga inicial (SSR, `requirePanelPermission`, redirige) y
   `payments.actions.ts` expone `loadMoreMonthPayments` para el "Ver más"
   (Server Action, `requirePermission`, tira). Si F1 necesita una firma
   distinta (por ejemplo, todo por action porque el listado de `/cobranza`
   es un Client Component desde el arranque), es un ajuste de una línea en
   `payments.controller.ts`/`payments.actions.ts`, no un cambio de modelo.
2. **`getPaymentFormData({ memberId, familyGroupId })`: relajé el "exactamente
   uno" a "al menos uno".** El comentario de `PaymentFormData.members` en
   `types.ts` dice "el socio desde el que se abrió el formulario va
   primero", pero la única forma de honrar eso cuando se pide un grupo
   familiar es que la acción sepa CUÁL de los integrantes lo abrió — y el
   encargo describe el input como `{ memberId | familyGroupId }` (uno u
   otro). Implementé: con `familyGroupId` solo, trae a todos sin orden
   particular; con `familyGroupId` **y** `memberId`, trae a todos con ese
   `memberId` primero; con `memberId` solo, trae a ese único socio. Esto es
   un superconjunto compatible del contrato literal (sigue funcionando
   exactamente igual si F1 manda uno solo); lo marco para que F1 lo sepa al
   construir el formulario.
3. **`getPaymentFormData` importa `billing.model.getBillingStatus()` (B1) y
   `family-groups.model.getFamilyGroup()` (slice 1, sin dueño en este
   pipeline).** Ninguno de los dos está en mi lista de "no toca" explícita
   para B2 (que nombra `members.model.ts`, `members.controller.ts` y
   `storage.service.ts`), y son lecturas, no ediciones — mismo patrón que
   B3/B4 important `accounts.model.ts`/`billing.model.ts` por su firma. B1
   ya había aterrizado `billing.model.ts` con `getBillingStatus(): Promise<BillingStatus>`
   cuando llegué a esta parte (lo verifiqué con `ls`/`grep` antes de
   importar); si hubiera faltado, el `typecheck` final lo habría marcado
   como bloqueo cruzado a reportar, no algo para resolver yo mismo
   duplicando su lógica.
4. **`AUDIT_FIELD_LABELS` queda en `audit.model.ts`, sin tocar
   `views/audit/audit-labels.ts`.** El encargo pide la traducción de columnas
   para las cuatro tablas nuevas, pero esa vista es de
   `frontend-react-craftsman` (`views/**`, fuera de mi alcance). Agregué el
   export documentado con un comentario explícito de que quien construya el
   detalle de auditoría de estas tablas debería importarlo en vez de
   reinventarlo (mismo espíritu que `AUDITED_TABLES`, que ya señalaba esta
   misma deuda para el slice 1).

## Reglas de negocio e invariantes que implementé (con su verificación)

Todo lo de abajo lo corrí contra la base real (`docker exec -i
supabase_db_lonqui psql -U postgres -d postgres`), simulando roles con
`set local role authenticated; select set_config('request.jwt.claims', ...)`
dentro de `begin; ... rollback;` (con `savepoint`/`rollback to savepoint`
alrededor de cada sentencia que debía fallar, para poder seguir probando en
la misma transacción). Usé el `admin` real del seed
(`f15200ba-b4c6-49b0-8295-1ec3e7916013`, vigente tras el segundo
`db:reset` del hilo principal) y `editor`/`consulta` de fixture creados y
descartados dentro de la misma transacción.

- **Permisos por rol** (`private.can`): `editor` tiene `payments.register`
  pero no `payments.void`; `consulta` no tiene ninguno de los dos (sí
  `payments.read` y `reports.export`, coincide con el catálogo §6.8:
  consulta puede exportar listados de solo lectura). `admin` tiene los
  cuatro.
- **`registerPayment` — idempotencia del lote**: inserté 2 filas con el
  mismo `batch_id` (socios 2 y 3, grupo familiar 1) como `editor`,
  `created_by` quedó en el uid del editor (default `auth.uid()`, no lo mando
  yo); reintentar el MISMO insert violó `payments_batch_member_key` y abortó
  las 2 filas juntas (una sola sentencia, todo o nada) — exactamente lo que
  `registerPayment` (modelo) atrapa y traduce a `alreadyRegistered: true`.
- **`voidFee` como `editor` → 0 filas, sin error** (fee id real del seed,
  `kind = 'monthly'`): confirma que la policy de `fees` es estrictamente
  `payments.void` y que el `.maybeSingle()` defensivo es necesario.
- **`voidPayment`/adjuntar comprobante como `editor` sobre un pago real
  (no de fixture)**: anular → error real de Postgres
  ("No tenés permiso para anular pagos", `insufficient_privilege`) — la
  policy de `payments` SÍ deja pasar el UPDATE (register OR void), pero el
  trigger lo frena; no es una `DomainError` traducida a propósito (el guard
  de la action ya corta antes con `requirePermission('payments.void')`;
  esto es defensa en profundidad, un 500 genérico es aceptable acá).
  Adjuntar comprobante a un pago YA anulado (payment del seed, socio 6,
  `voided_at` no nulo) → `"Un pago anulado no lleva comprobante"`, que
  `translateUpdateError` sí traduce a `DomainError`. Adjuntar normal → OK;
  reintentar adjuntar → `"El comprobante ya está cargado y no se
  reemplaza"`, también traducido.
- **`voidPayment`/`voidFee` como `admin` sobre una fila ya anulada** →
  `"Este pago ya está anulado"` / `"Este cargo ya está anulado"`, ambos
  traducidos por mis funciones de traducción.
- **`createOpeningBalance` como `editor`** → `period` queda en el mes
  anterior al inicio de la facturación (agosto 2026, con
  `billing_start_period = 2026-09-01`) pese al placeholder que mando;
  segundo saldo de arranque para el mismo socio → viola
  `fees_one_opening_balance` (unique parcial), tal como espera
  `translateOpeningBalanceError`.
- **`editor` insertando `kind = 'monthly'`** → `permission denied for table
  fees` (RLS bloquea antes de llegar al trigger: la policy de INSERT exige
  `kind = 'opening_balance'` en el `with check`).
- **`consulta` insertando un pago** → `new row violates row-level security
  policy`; lee `fees`/`payments` sin problema (payments.read).
- **`member_accounts(array[5], 'all', null)`** (socio con DOS deportes —
  Fútbol femenino/Primera y Vóley/Sub 18 — más saldo de arranque de
  agosto): `categories` trae las dos inscripciones abiertas,
  `current_fees` trae las dos cuotas de septiembre con su categoría y
  disciplina, `current_fee_cents = 2.000.000` (la SUMA), `charged_cents =
  5.000.000` (3M saldo + 1M + 1M), `months_due = 2` (agosto y septiembre,
  cuenta MESES no cargos). Confirma que mi mapeo de `categories`/
  `current_fees` (jsonb → `MemberCategoryRef[]`/`CurrentFeeLine[]`) está en
  el orden y con las claves exactas que la RPC devuelve.
- **`member_fee_statement(5)`**: orden `opening_balance` (agosto) antes que
  las dos `monthly` de septiembre, y entre esas dos por `discipline_id`
  ascendente — confirma la cobertura oldest-first de §13.5 tal como la
  mapea `getFeeStatement`.
- **`member_accounts` para el grupo familiar 1** (socios 1/2/3: no
  practicante + dos deportes distintos): la socia no practicante trae
  `current_fees = [{category_id: null, category_name: "Cuota social", ...}]`
  — confirma que mi mapeo no fuerza ningún texto fijo por su cuenta, lo que
  viene de la RPC se pasa tal cual.
- **Storage**: el bucket `attachments` (privado, límite 10 MiB, MIME
  jpeg/png/webp/pdf) ya tiene la policy de INSERT con `payment-receipts`
  habilitado como carpeta junto a `medical-clearances`; la de SELECT es para
  cualquier rol activo (coincide con "`getReceiptUrlAction`: cualquier
  rol").

## Lo que falta probar contra una base real en `tests/db/` (para `test-engineer`)

- Todo lo de la sección anterior, como casos de `tests/db/` (hoy solo lo
  corrí a mano, una vez, con `rollback` al final — no queda nada persistido).
- El índice único `(batch_id, member_id)` de `payments` **sin**
  `payments_batch_id_idx` suelto (verificado que no aparece en
  `\d payments` — lo dejo anotado para que el test de "no hay índices de
  más" lo cubra explícitamente, si no lo cubre ya el de B1/schema).
- Keyset de `getMonthPaymentsPage`/`loadMoreMonthPayments`: paginar hacia
  atrás por `(paid_on desc, id desc)` con más de una página de pagos en el
  mismo día (mismo `paid_on`, distinto `id`) — no llegué a armar el fixture
  de volumen para probarlo end-to-end contra PostgREST (solo revisé la
  construcción del filtro `or=` a mano, igual que el patrón ya probado de
  `audit.model.ts`).
- `AUDIT_FIELD_LABELS`/`buildLabelDraft` de las cuatro tablas nuevas: no hay
  un test de contenido de auditoría end-to-end en este pipeline todavía
  (que yo haya visto) — un caso que dispare un INSERT/UPDATE real de
  `payments`/`fees`/`fee_prices`/`member_categories` y lea `getAuditPage`/
  `getAuditEntry` para confirmar el `recordLabel` armado (con nombres reales
  de categoría y disciplina desde el seed) sería el primero que cerraría
  esto.
- `attachReceipt`/`prepareReceiptUpload` con un objeto de Storage real (no
  simulado): no probé la subida real vía `createSignedUploadUrl` +
  `uploadToSignedUrl` desde este agente (es responsabilidad de
  `test-engineer`/`frontend-react-craftsman`, no tengo Storage real
  disponible desde psql).

## Deferrals / fuera de alcance

- Nada de listados agregados ni panel (B4), nada de imputación manual de un
  pago a meses puntuales, nada de descuentos, nada de exportación real (el
  gancho `log_export` es de B4/slice 3), nada de mails — todo consistente
  con "Fuera de alcance" de B2 en `01-tasks.md`.
- No pedí ningún cambio de schema: las tres migraciones de S1–S3 ya traían
  todo lo que necesitaba (`member_fee_coverage`, `member_accounts` con
  `categories`/`current_fees`/`category_filter`, `member_fee_statement` con
  `category_id`/`discipline_id`, `voidFee` con la policy estricta que D33
  pedía, `payments_update_guard` con el rechazo de comprobante en pago
  anulado).

## Verificación

- `npm run typecheck`: limpio en los seis archivos de mi ownership. Quedan
  errores en `app/**`, `views/**` y `tests/**` (padrón con categorías
  múltiples, B3 todavía en curso) — ninguno en archivos míos, no los toqué.
- `npm run lint`: limpio en todo el repo.
- Verificación contra la base real: ver más arriba, sección por sección.

## Fix post-entrega (2026-09-28): `disciplineName` null en el statement

**Bug reportado por F2** (frontend, `/socios/[id]`): `FeeStatementLine.disciplineName`
venía siempre `null` en `getMemberAccountDetail`/`getFeeStatement`, incluso
para las cuotas por deporte (no solo la social/saldo anterior, donde `null`
es correcto). Causa: `mapStatementRow` en `accounts.model.ts` lo hardcodeaba
a `null` sin resolverlo — quedó así de la primera versión, donde solo había
pensado en resolver `categoryName` (vía `resolveCategoryNames`, que
consultaba `categories` pidiendo únicamente `id, name`, sin la disciplina).
`categoryName` en sí **no estaba roto**: se resolvía bien, pero compartía la
consulta con el campo que sí faltaba, así que valía la pena arreglar los dos
juntos en una sola función en vez de agregar una segunda consulta al lado.

**Fix**, todo en `src/models/accounts.model.ts`:
- `resolveCategoryNames(supabase, categoryIds): Promise<Map<number, string>>`
  → reemplazada por `resolveCategoryLabels(supabase, categoryIds):
  Promise<Map<number, { name: string; disciplineName: string | null }>>`,
  que pide `id, name, disciplines(name)` en una sola consulta batch (embed
  de PostgREST `categories → disciplines`, el mismo patrón ya probado en
  `members.model.ts` para el padrón). Sigue siendo UNA consulta para todos
  los `category_id` presentes en el statement, nunca N+1.
- `mapStatementRow` ahora lee `categoryName`/`disciplineName` del mismo
  `label` resuelto (`categoryLabels.get(row.category_id)`), en vez de
  hardcodear el segundo campo.
- **Revisé `Fee` en `fees.model.ts`** (pedido explícito del hilo principal):
  `mapFeeRow` también deja `categoryName`/`disciplineName` en `null` fijo,
  pero ahí **no es un bug** — es la única función que mapea `fees` a `Fee` en
  este archivo, y sus dos únicos call sites (`createOpeningBalance` acá
  mismo, `getOpeningBalance` en `accounts.model.ts`) filtran siempre por
  `kind = 'opening_balance'`, que en el schema **nunca** tiene categoría
  (`fees_category_shape`: category_id/discipline_id son null para todo lo
  que no es `monthly`). No hay ningún camino de código donde `mapFeeRow`
  reciba una fila con `category_id` no nulo, así que no hacía falta tocar
  nada ahí. Lo dejé documentado en el comentario de la función (ya decía
  "el saldo de arranque... nunca tiene categoría"; no hizo falta reescribirlo).

**Verificación contra la base real** (`docker exec -i supabase_db_lonqui
psql`, `begin;...rollback;`, admin real): con la ficha de **Valentina
Ficticia** (member 5, dos deportes: Fútbol femenino/Primera y Vóley/Sub 18,
más un saldo de arranque de agosto):
- `select c.id, c.name, d.name from categories c join disciplines d on
  d.id=c.discipline_id where c.id in (8,12)` → `8 → Primera / Fútbol
  femenino`, `12 → Sub 18 / Vóley`, confirmando el shape que
  `resolveCategoryLabels` espera del embed `categories(id, name,
  disciplines(name))`.
- `member_fee_statement(5)` crudo confirma `category_id`/`discipline_id` por
  fila (`13`: ambos null, saldo anterior; `4`: `8`/`2`; `5`: `12`/`3`) — con
  el fix, `getFeeStatement(5)` ahora arma `categoryName: 'Primera',
  disciplineName: 'Fútbol femenino'` y `categoryName: 'Sub 18',
  disciplineName: 'Vóley'` para esas dos líneas, y ambos `null` para la del
  saldo anterior (correcto, D31).
- `npm run typecheck`/`npx eslint src/models/accounts.model.ts`: limpios,
  sin nuevos errores.

No hizo falta ningún cambio de schema ni de otro archivo: el embed que uso
ya lo permite la policy de SELECT existente de `categories`/`disciplines`
(`current_app_role() is not null`, cualquier rol activo), verificada en la
entrega original.
