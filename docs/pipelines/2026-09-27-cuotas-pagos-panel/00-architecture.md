# 00 — Arquitectura: cuotas, pagos, estado de cuenta y panel inicial (slice 2 de la Fase 1)

Pipeline: `2026-09-27-cuotas-pagos-panel`. Estado: **propuesta revisada con
las respuestas de Tomás (T1–T11, ver §11); pendiente de aprobación final**.
Cero código, cero migraciones: este documento decide qué se construye y con
qué forma; `01-tasks.md` lo reparte.

Cambio de la revisión (**T1**): la generación corre **una vez por mes, el día
1 a las 00:05 hora argentina** (no diaria), **cada corrida queda registrada**
en una tabla técnica `billing_runs` (con `notified_at` reservado para un
futuro aviso por mail), y una corrida fallida o ausente del mes en curso se
ve como **aviso para admin** en el panel inicial y en `/ajustes`, con
"Reintentar" (§6.4, D18).

Segundo cambio (**T12**): los **roles configurables** (el club arma roles
tildando permisos; Administrador queda bloqueado con todos) van en un
pipeline **posterior**. Para que ese pipeline no reescriba este slice, acá se
define el **catálogo de permisos** y toda regla nueva (RLS, RPCs, triggers,
actions, UI) chequea **permisos, no roles**, vía `private.can(permission)` en
SQL y `requirePermission` / `requirePanelPermission` en TS (§6.8, D20). Las
reglas del slice 1 siguen con `has_role` y quedan documentadas como la deuda
que ese pipeline paga primero.

**Revisión 3 (T13–T22, §13): un socio puede estar en más de un deporte.**
Tabla de pertenencia `member_categories` con historia (alta/baja por
categoría con fecha), `members.category_id` desaparece, `member_type` pasa a
escribirlo un trigger, **un cargo por (socio, período, deporte)** con la
categoría congelada en el cargo, precarga del pago = suma de sus cuotas del
mes, deuda por categoría atribuida cargo por cargo con la misma cobertura
oldest-first del statement. Las migraciones 0005–0007 ya escritas (no
commiteadas) se reescriben; una migración nueva del socio corre antes. §13
también incorpora los minors de la tercera pasada del code review del slice
1 (B2–B6) y las decisiones de navegación/`ResponsiveSheet`/composición del
panel que están en curso en otro agente.

Hereda del slice 1 (`docs/pipelines/2026-09-25-padron-roles-auditoria/00-architecture.md`)
el modelo ya diseñado en su §6.2 (`fee_prices`, `fees`, `payments`, generación
por pg_cron, deuda derivada) y las decisiones D3–D6. Acá se **confirman, se
ajustan donde la realidad lo pide y se completan** con lo que faltaba decidir:
precarga del monto, saldo a favor, pagos de socios de baja, pago parcial,
deuda al cierre de mes, cambio de valor a mitad de mes, activación de la
facturación, permisos y auditoría. Las decisiones nuevas siguen la numeración
(D12 en adelante).

---

## 1. Problema y contexto

El slice 1 dejó el padrón, los roles y la auditoría. Este slice construye
**el corazón del contrato**: que el club sepa, en cualquier momento, quién
debe cuota, desde cuándo y cuánto (`PRODUCT.md`, principio 1), y que cargar un
pago sea lo más rápido del sistema (principio 2). Concretamente:

1. **Valores de cuota** en `/ajustes` (por defecto, por tipo de socio, por
   categoría) y **activación de la facturación** (`settings.billing_start_period`).
2. **Generación mensual automática** de cuotas para cada socio activo, con
   monto congelado, idempotente, por pg_cron; más una RPC para que un admin
   dispare la primera corrida y los reintentos.
3. **Saldo de arranque** por socio (la deuda previa al sistema).
4. **Registrar y anular pagos**, con comprobante opcional; pago por grupo
   familiar.
5. **Estado de cuenta** en la ficha del socio: meses adeudados, deuda total,
   último pago, historial, saldo a favor.
6. Filtro **"condición de deuda"** del padrón (hoy deshabilitado).
7. **`/cobranza`**: registrar, cobranza del mes, listados al día / con deuda /
   deuda por categoría.
8. **Panel inicial** rediseñado con KPIs (brief confirmado en
   `.impeccable/surfaces/route.md`).

Restricciones que mandan y no se re-derivan (`CLAUDE.md`): dinero en centavos
enteros; nada se borra (anulación con motivo, solo admin); auditoría por
triggers con actor de `auth.uid()`, por eso las escrituras van con el cliente
de sesión; un cargo por socio por período con índice único; generación por
pg_cron llamando SQL; monto congelado; períodos en hora argentina; deuda
derivada; agregaciones en RPC porque PostgREST corta en `max_rows = 1000` sin
error; invariantes en Postgres, permisos en RLS/grants; todo el panel es
Operate para voluntarios en el celular.

## 2. Chequeo de alcance contra el contrato

| Punto del contrato | Este slice |
|---|---|
| 2.2 Configuración del valor de la cuota, distinto por categoría o tipo de socio | Completo |
| 2.2 Generación mensual automática para cada asociado activo | Completo |
| 2.2 Registro de pagos (fecha, monto, medio, quién lo cargó), comprobante adjunto | Completo |
| 2.2 Estado de cuenta: meses adeudados, deuda total, último pago, historial | Completo |
| 2.2 Listados: al día, con deuda, deuda por categoría, cobranza del mes | Completo (en `/cobranza`) |
| 2.1 Filtro por condición de deuda | Se activa acá |
| 2.4 Panel inicial (activos, distribución por categoría, cobranza del mes, deuda acumulada) | Completo, con lo que Tomás sumó en el brief (evolución 12 meses, top 5, altas/bajas, aptos vencidos) |
| 2.4 Exportación a CSV | **No** (slice 3). Se deja creada la RPC `log_export` como gancho, sin consumidor |
| 2.3 Roles | Se extiende la matriz a las tablas nuevas |
| Fase 2 portal, Fase 3 Mercado Pago/ARCA, Fase 5 mails | **No**. El schema no los bloquea (el socio del portal leerá `member_accounts` con su propio rol) |
| Carga inicial | Sigue siendo del club, por formularios: el saldo de arranque se carga socio por socio desde la ficha. **No hay importador** |

Nada de lo pedido excede la Fase 1. Lo que Tomás agregó al brief del panel
(evolución de 12 meses, top 5, altas/bajas del mes, aptos vencidos) es una
lectura amplia pero legítima de "indicadores de uso diario" (2.4) y no crea
tablas ni procesos nuevos: todo sale de RPCs sobre datos que ya existen.

## 3. Lo que hay hoy (Paso 0)

Relevado con `Read`, `Bash` (solo lectura) y `psql` dentro del contenedor
`supabase_db_lonqui`. **El MCP de Supabase no conectó en esta sesión**
(`ECONNREFUSED` al arrancar; el stack sí está arriba y respondió por
`docker exec`). Todo lo que sigue sale de las migraciones y de la base local.

**Base local** (Postgres 17.6, PostgREST v13, `cron.timezone = GMT`,
`pg_cron` **en `shared_preload_libraries` pero no instalado**). Nueve tablas en
`public`: `app_users`, `audit_log`, `settings`, `disciplines`, `categories`,
`family_groups`, `members`, `member_status_events`, `medical_clearances`;
`private.password_markers`. Helpers en `private`: `current_app_role`,
`has_role`, `is_admin`, `club_today`, `normalize_text`, `set_updated_at`,
`protect_immutable_columns` (TG_ARGV), `forbid_change`, `audit_row_change`,
`audit_log_guard`, `enable_audit(regclass, pk)`, y los de estado del socio.
RPCs en `public`: `mark_password_reset`, `confirm_password_changed`,
`set_family_payment_responsible`. Los *default privileges* ya están revocados
(cada tabla otorga lo suyo). `settings.billing_start_period` existe, es `null`
en el seed y **hoy la escribe `updateSettings` libremente** (eso cambia acá:
D18). El bucket `attachments` ya admite el prefijo `payment-receipts/`. Hay 12
socios inventados en el seed, un grupo familiar, uno sin DNI y uno de baja.

**Repo.** Contratos vigentes: `src/models/types.ts` (con `MemberFilters.debt`
"preparado y sin efecto", `Settings.billingStartPeriod`, `AuditedTable` de las
ocho tablas), `session.controller.ts` (`requirePanelAccess` para pages y
lecturas, `requireRole` para actions), `lib/action-result.ts`
(`success`/`failure`/`invalid`), `lib/money.ts` (`formatCentsCompact`,
`parsePesosToCents`, `sumCents`), `lib/dates.ts` (`toClubDate`, `toPeriod`,
`formatPeriod`, `formatDate`, `formatDateTime`). Modelos: `members.model.ts`
(`searchMembers` con keyset en TS sobre PostgREST y el comentario "`debt` se
ignora a propósito"), `settings.model.ts`, `catalogs.model.ts`,
`family-groups.model.ts`, `medical-clearances.model.ts`, `audit.model.ts` (con
`buildLabelDraft` por tabla, que hay que extender), `app-users.model.ts`.
Servicios: `storage.service.ts` (`createSignedUploadUrl`, `getSignedUrl`,
`objectExists`, con el cliente de sesión), `auth-admin.service.ts`. Primitivas
de `views/shared/`: `Panel`, `PageHeader`, `DataList` (filas apilables /
tabla), `FilterBar` (con `disabledReason`, ya usado por el filtro de deuda
apagado), `SearchInput`, `Pagination`, `StatusPill` (**ya tiene las variantes
`up-to-date` e `in-debt`**), `ReasonDialog` (motivo + fecha + consecuencia),
`Amount` (tabular), `Dni`, `DateText`/`DateTimeText`, `EmptyState`/`ErrorState`/
`LoadingList`, `WhatsAppLink`, `form-fields.tsx` (`TextField`, `SelectField`,
`DateField`, `CheckboxField`, `PhoneField`, `DniField`, `TextareaField`,
`PasswordField`), `labels.ts`. Shell: `nav-items.ts` (Inicio, Socios; admin
suma Usuarios/Ajustes/Auditoría; `/cobranza` no aparece hasta que exista),
`home-search.tsx`, `app-shell.tsx`. `(panel)/page.tsx` es el panel provisorio
(buscador + accesos). `recharts` y `pg` **ya están instalados**; `playwright`
también (script `screens`). `DESIGN.md` documenta los tokens (primary
`#C2410C`, brand `#F26A1B`, estados al día `#15803D` / con deuda `#B91C1C`,
Geist, tabulares, 44 px).

**Briefs.** `route.md` trae el panel inicial y "Registrar pago" confirmados por
Tomás el 2026-09-27. `route-socios-id.md` anticipa "en el slice 2 suma el
estado de cuenta y Registrar pago arriba de todo"; `route-ajustes.md` reserva
el lugar de "Valores de cuota"; `route-socios.md` describe el filtro de deuda
apagado. No hay brief de `/cobranza`: se escribe en este pipeline
(`.impeccable/surfaces/route-cobranza.md`).

**Relevamiento.** Las planillas muestran: una columna por mes con `10000` en
los meses pagos, pagos de varios meses juntos, la planilla femenina con
"Saldo de 2025" (deuda previa como un número, sin detalle por mes), cuota plana
de $10.000. La transcripción: "esta persona me debe 5 meses, esta está al
día" es la pregunta central; se cobra en efectivo y por transferencia al CBU
del club; hay ~25 no practicantes que "queremos que empiecen a aportar".

## 4. Pushback y riesgos del pedido

1. **"Saldo negativo" no existe: es saldo a favor, y hay que decidir qué hace
   el sistema con él.** El brief lo dice bien ("nunca deuda negativa"), pero
   falta la consecuencia: la cuota siguiente **lo consume sola** (D13). Si no
   se decide, Tesorería va a cargar un pago adelantado y al mes siguiente el
   socio aparece "al día" sin que nadie entienda por qué. Se muestra en la
   ficha y en el historial con la palabra "saldo a favor" y la cuota que lo
   absorbió.
2. **"Cuotas del mes" contra "cobrado en el mes" no es una tasa de cobranza.**
   Tomás ya lo aceptó (puede pasar el 100%). Lo dejo explícito en la UI del
   panel: el % se etiqueta "del valor de las cuotas del mes", no "cobranza
   lograda", para que Presidencia no lo lea como "el 120% de los socios pagó".
3. **Un cron mensual que falla en silencio es peor que ninguno.** Propuse
   una corrida diaria idempotente; **Tomás decidió (T1) que corra una vez
   por mes, el día 1**, y que la falla sea *visible*: cada corrida se
   registra en `billing_runs`, y el panel y `/ajustes` avisan al admin
   cuando la del mes en curso falló o no corrió, con "Reintentar". La RPC de
   reintento genera **todos los períodos pendientes** (idempotente), así que
   un reintento tardío se pone al día solo. Consecuencia que queda escrita:
   un socio dado de alta después del día 1 recibe la cuota de ese mes al
   tocar "Generar cuotas ahora" o, si nadie lo toca, en la corrida del 1° del
   mes siguiente (que también recorre el mes anterior). No queda sin cuota.
4. **Doble toque en el celular = pago duplicado.** Es el error clásico de una
   pantalla de cobro con alguien esperando y señal mala. No se resuelve con
   `disabled` en el botón: el submit ya salió. Propongo que **todo pago lleve
   un `batch_id` generado por el formulario** (un pago suelto es un lote de
   uno) con índice único `(batch_id, member_id)`: el reintento choca con el
   índice y la action lo devuelve como éxito (D22).
5. **`updateSettings` hoy deja cambiar `billing_start_period` a cualquier
   cosa.** Una vez que hay cuotas generadas, moverlo rompe la coherencia de
   "saldo de arranque = lo anterior al primer mes". Pasa a ser **escritura
   única con reglas** (D18) y sale del formulario de "Datos del club".
6. **Anular una cuota mensual: ¿revive al día siguiente?** Si el índice único
   ignorara las anuladas, la corrida siguiente (o un "Reintentar") la
   regeneraría. El índice
   **incluye** las anuladas: una cuota anulada es definitiva para ese socio y
   ese mes (bonificación de hecho). El costo es que un error de precio en el
   mes de activación no se corrige regenerando: se corrige con la
   confirmación previa a activar y el valor nuevo desde el mes siguiente
   (D17, D18).
7. **Deuda de socios dados de baja.** Si "deuda total" suma a los de baja, el
   número del panel crece con gente que ya no está y a la que nadie reclama;
   si los excluye, la plata que se les reclama al reingresar se pierde de
   vista. Propongo KPIs sobre **activos**, con una línea aparte "de socios
   dados de baja" con link al listado (D14). Pregunta a la Comisión (C12).
8. **El padrón con filtro de deuda no puede ser "traer todo y filtrar en
   TS"**: PostgREST corta en 1.000 sin avisar y el padrón pagina por keyset.
   Se resuelve con **campos calculados de PostgREST** (funciones sobre el tipo
   `members`) que se pueden filtrar y ordenar sin mover `searchMembers` a SQL
   (D24).
9. Nada del pedido está sobre-diseñado para la Fase 1. Lo que **no** hago:
   imputación manual de meses (D3 sigue: lo más viejo primero), descuentos
   familiares (C5, sin respuesta), exportación (slice 3), recordatorios (Fase
   5), y un "anular todas las cuotas del mes" en lote (se menciona como
   herramienta futura si la Comisión se equivoca al activar).

## 5. Investigación

Consultado (no se arquitectó de memoria):

- **pg_cron en Supabase** (Context7 `/websites/supabase_guides`, guías
  `cron/install`, `cron/quickstart`): `create extension pg_cron with schema
  pg_catalog; grant usage on schema cron to postgres; grant all privileges on
  all tables in schema cron to postgres;` `cron.schedule(nombre, expresión,
  'select fn()')`; los horarios son **GMT** (el cluster local lo confirma:
  `cron.timezone = GMT`, `cron.database_name = postgres`, `pg_cron` ya en
  `shared_preload_libraries`); `cron.job_run_details` guarda cada corrida y
  **no se limpia sola** (la guía recomienda un job de limpieza). Un job
  agendado desde una migración corre como `postgres`, sin JWT: `auth.uid()`
  es null y la auditoría lo registra como `actor_source = 'system'`, que es
  exactamente lo que `CLAUDE.md` pide.
- **PostgREST v13** (Context7 `/websites/postgrest_en_v13`, *Computed
  Fields* y *Table-valued functions*): una función cuyo primer argumento es
  el tipo de la tabla se expone como campo calculado, se puede **seleccionar
  (`select=*,fn`), filtrar (`?fn=eq.x`) y ordenar (`order=fn`)**; las RPC que
  devuelven `setof` admiten filtros, `order`, `limit`/`range` y **también
  quedan sujetas a `max_rows`** — por eso los listados sobre RPC se paginan
  con `range` desde el modelo.
- **Postgres** (skill `supabase-postgres-best-practices`: `lock-advisory`,
  `security-rls-performance`, `security-privileges`, `schema-constraints`,
  `query-partial-indexes`, `data-pagination`, `data-batch-inserts`):
  `pg_advisory_xact_lock(hashtext(...))` para procesos exclusivos; `(select
  auth.uid())`/`(select private.has_role(...))` en policies; grants por
  columna; índices parciales para flags (`where voided_at is null`); un
  `insert … select … on conflict do nothing` como unidad idempotente; inserts
  en lote en una sola sentencia (un pedido de PostgREST = una transacción).
- **Contabilidad de cuentas corrientes** (ya relevado en el slice 1, D3):
  *balance forward* (saldo global, lo más viejo primero) frente a *open item*
  (imputación manual). Se mantiene balance forward; el "estado por mes"
  (pagado / parcial / adeudado) se **deriva** recorriendo los cargos del más
  viejo al más nuevo contra el total pagado, que es lo que hace la grilla del
  Excel a mano.
- **Next 16** (`node_modules/next/dist/docs`, ya relevado): pages dinámicas
  por cookies, `revalidatePath` desde actions, `'use server'` solo con
  exports async; `searchParams` como `Promise`. No hay nada nuevo que este
  slice necesite de Next.
- **Recharts 3** ya está en `package.json`; la skill `dataviz` (disponible por
  el Skill tool) fija forma, paleta y accesibilidad del gráfico de evolución
  (una tabla equivalente accesible, colores validados en claro, marcas sin
  decoración). La lee el agente de F3 antes de escribir el gráfico.

## 6. Modelo de datos del slice 2 (lo que se crea ahora)

Convenciones del slice 1. Todas las tablas: `enable` + `force row level
security`, `revoke all … from anon, authenticated, service_role` y grants
explícitos por columna; `enable_audit` en las tres tablas nuevas. Todo lo que
sea "valor de enumeración" es `text` + CHECK.

### 6.1 `fee_prices` — valores de cuota (append-only)

`id`, `scope text` CHECK in (`default`, `member_type`, `category`),
`member_type text null` CHECK in (`practicing`, `non_practicing`),
`category_id bigint null` FK `categories` (índice), CHECK de coherencia
(`scope='default' → ambos null; 'member_type' → solo member_type; 'category'
→ solo category_id`), `amount_cents bigint` CHECK `>= 0`, `valid_from date`
CHECK primer día de mes, `notes text null`, `created_by uuid default
auth.uid()`, `created_at`. Unique `(scope, coalesce(member_type,''),
coalesce(category_id,0), valid_from)`. **Sin UPDATE ni DELETE para nadie**
(trigger `forbid_change`): cambiar el valor es insertar una fila nueva.

Triggers BEFORE INSERT (D17): `valid_from >= date_trunc('month',
private.club_today())` (no se fijan precios para el pasado: el pasado ya está
congelado en `fees`); y **rechazo si ya existe alguna cuota mensual con
`period = valid_from`** (mensaje: "Las cuotas de <mes> ya se generaron con
otro valor; el nuevo aplica desde <mes siguiente>").

Resolución del precio, `private.fee_price_for(category_id, member_type,
period) → (fee_price_id, amount_cents)`: entre las filas con `valid_from <=
period`, gana `category` (si coincide la categoría) sobre `member_type` (si
coincide el tipo) sobre `default`; dentro de cada scope, la de mayor
`valid_from`. Devuelve null si no hay ninguna (el generador aborta con
mensaje; la activación lo impide antes, D18).

### 6.2 `fees` — cargos

> **Revisión 3 (§13.3):** suma `category_id` y `discipline_id` (congelados,
> solo en `monthly`), el índice único pasa a `(member_id, period,
> discipline_id) nulls not distinct where kind = 'monthly'` y la descripción
> nombra la categoría. Lo que sigue es la versión original; §13 manda donde
> difiera.

`id`, `member_id` FK (índice), `period date` CHECK primer día de mes, `kind
text` CHECK in (`monthly`, `opening_balance`, `adjustment`), `amount_cents
bigint` CHECK `>= 0`, `description text null`, `fee_price_id bigint null` FK
`fee_prices` (trazabilidad del monto congelado; solo en `monthly`),
`created_by uuid null default auth.uid()` (null = generación automática o
seed), `created_at`, `voided_at timestamptz null`, `voided_by uuid null`,
`void_reason text null` (CHECK: los tres nulos o los tres presentes, y
`length(btrim(void_reason)) >= 3`).

Índices: **unique `(member_id, period) where kind = 'monthly'`** (incluye
anuladas: una cuota anulada no se regenera, §4.6); **unique `(member_id)
where kind = 'opening_balance' and voided_at is null`** (un saldo de arranque
vigente por socio; si se cargó mal se anula y se carga de nuevo); `(period)`,
`(member_id, period)`; parcial `(member_id) where voided_at is null`.

Triggers: `protect_immutable_columns('member_id','period','kind',
'amount_cents','fee_price_id','created_by','created_at')`; BEFORE UPDATE: las
columnas de anulación solo pasan de null a valor, una sola vez, y **solo si
`private.is_admin()`**; BEFORE INSERT para `opening_balance`: exige
`settings.billing_start_period` no nulo y fija `period = billing_start_period
- 1 mes` (ignora lo que venga), `amount_cents > 0`, `description` default
"Saldo anterior al sistema"; `adjustment` queda en el CHECK para el futuro
pero **ninguna policy lo permite hoy** (documentado). `enable_audit`.

### 6.3 `payments` — pagos

`id`, `member_id` FK (índice), `amount_cents bigint` CHECK `> 0`, `paid_on
date not null default private.club_today()` (trigger: no futura, `>=
2020-01-01`), `method text` CHECK in (`cash`, `transfer`),
`receipt_storage_path text null` CHECK `like 'payment-receipts/%'`,
`receipt_filename text null`, `notes text null`, **`batch_id uuid not null`**
(un pago suelto es un lote de uno; el formulario lo genera una vez, D22),
`created_by uuid null default auth.uid()`, `created_at`, `voided_at`,
`voided_by`, `void_reason` (misma regla que `fees`).

Índices: **unique `(batch_id, member_id)`** (idempotencia del submit),
`(member_id, paid_on desc, id desc)`, `(paid_on)`, `(batch_id)`, parcial
`(member_id) where voided_at is null`.

Triggers: `protect_immutable_columns('member_id','amount_cents','paid_on',
'method','batch_id','created_by','created_at')`; BEFORE UPDATE: anulación
null→valor una vez y solo `is_admin()`; `receipt_storage_path` solo null→valor
(adjuntar después, una vez; nunca reemplazar ni quitar); `enable_audit`.

`created_by` es nullable por el seed (corre como `postgres`, sin sesión), pero
la policy de INSERT para `authenticated` exige `created_by = (select
auth.uid())`: desde la app **siempre** queda quién lo cargó (contrato 2.2).
Lo mismo para el saldo de arranque.

### 6.4 Generación mensual

> **Revisión 3 (§13.4):** la población ya no es "un socio activo → una
> cuota" sino "un socio activo → una cuota por deporte en el que estuvo
> inscripto durante el período, o una cuota social si no estuvo en ninguno".
> El contrato real de `public.generate_pending_fees()` es devolver `(status,
> fees_created, error_message)`, no relanzar (review B6).

`private.generate_monthly_fees(target_period date) → int` (SECURITY DEFINER,
dueño `postgres`, `set search_path = ''`): `pg_advisory_xact_lock(hashtext(
'lonqui.generate_fees'))`; `insert into fees (member_id, period, kind,
amount_cents, fee_price_id, description) select … from members m where
m.status = 'active' and m.joined_on <= último día del período` con el precio
de `fee_price_for(m.category_id, m.member_type, target_period)` **congelado
en la fila**, `on conflict do nothing` sobre el índice único de `monthly`;
devuelve las filas creadas. Si a algún socio no le resuelve precio, `raise
exception` y no genera nada (transacción única). No corre si
`billing_start_period` es null o `target_period < billing_start_period`.

**`billing_runs` — registro de corridas (T1).** Tabla técnica en `public`
(para que el admin la lea por PostgREST): `id`, `period date` (primer día de
mes), `trigger text` CHECK in (`cron`, `manual`), `actor_id uuid null`
(`auth.uid()` en la manual; null en el cron), `started_at timestamptz`,
`finished_at timestamptz null`, `status text` CHECK in (`ok`, `error`,
`skipped`), `fees_created int not null default 0`, `error_message text null`
(el mensaje de Postgres; **nunca** nombres ni DNI: el generador no los
incluye en sus excepciones), **`notified_at timestamptz null`** — reservada
para que un job futuro (Fase 5, mails) avise de las fallas y marque que
avisó; **hoy no tiene consumidor**, queda documentado como gancho. Índices:
`(period, started_at desc)`, parcial `(started_at desc) where status =
'error'`. **Append-only** (`forbid_change` en UPDATE/DELETE, salvo la
excepción de `notified_at` que se habilitará cuando exista el job). Sin
grant de INSERT/UPDATE/DELETE para nadie: la escribe solo el generador
(SECURITY DEFINER, dueño `postgres`). RLS: SELECT solo `admin`.

*¿Se audita?* **No.** Es una tabla técnica sin datos de dominio: el efecto de
dominio de cada corrida (las filas de `fees`) ya entra en `audit_log` con su
actor (`system` o el admin), y duplicar cada corrida como fila de auditoría
solo agrega ruido a `/auditoria` sin decir nada que `fees` no diga. La
propia `billing_runs` es append-only y guarda el actor: es su propio
registro. Misma lógica que `private.password_markers` en el slice 1.

`private.generate_pending_fees(run_trigger text) → int` (DEFINER, `set
search_path = ''`): recorre todos los períodos desde `billing_start_period`
hasta `date_trunc('month', private.club_today())` y para cada uno llama a
`generate_monthly_fees` **dentro de un bloque `begin … exception`** (una
subtransacción): si el insert falla, **se revierte entero** (ninguna cuota a
medias: es una sola sentencia) y se registra una fila `status = 'error'` con
el mensaje; si va bien, `status = 'ok'` con `fees_created`; y la función
**se detiene en el primer error** (los períodos siguientes fallarían por lo
mismo, y el reintento los recorre de nuevo). Registra una fila por período
recorrido **solo si creó al menos una cuota o hubo error, y siempre una para
el período actual** (así el 1° de octubre no acumula doce filas "0 creadas"
de meses viejos, pero un alta tardía de septiembre que se genera en octubre
sí queda registrada). Con la facturación no activada, o antes del mes de
inicio, registra una única fila `status = 'skipped'` (mensaje "Facturación
no activada" / "Empieza en <mes>") y no hace nada más. Idempotente: se
puede correr mil veces.

`public.generate_pending_fees() → int` (SECURITY DEFINER en `public`, `revoke
execute from public, anon`, `grant execute to authenticated`; en el cuerpo
exige `private.is_admin()`): llama a la privada con `run_trigger = 'manual'`
y `actor_id = auth.uid()`. La usan "Generar cuotas ahora", "Reintentar" y la
activación. Dentro, `auth.uid()` sigue siendo el admin → las filas de `fees`
y de `audit_log` quedan con `actor_source = 'session'` y su id.

`cron.schedule('lonqui-generate-fees', '5 3 1 * *', $$select
private.generate_pending_fees('cron')$$)`: **03:05 UTC del día 1 de cada mes
= 00:05 del 1° en Argentina** (UTC−3 fijo, sin horario de verano). Como el
generador calcula el período con `private.club_today()`, a esa hora ya es el
día 1 en Lonquimay. Un job segundo, `'lonqui-cron-cleanup'` (diario), borra
`cron.job_run_details` de más de 90 días (recomendación de Supabase; `cron.*`
no es una tabla del dominio; `billing_runs` es nuestra memoria de las
corridas, no `job_run_details`). Ambos `schedule` se hacen en la migración con
`cron.unschedule` previo idempotente.

**Estado de la facturación y aviso (T1).** `billing.model.getBillingStatus()`
lee `settings`, `dashboard_summary.pending_periods` y la **última fila de
`billing_runs` del período actual**, y deriva `currentPeriodRun: 'ok' |
'failed' | 'missing' | 'not_due'`: `ok` si la última corrida del mes fue
`ok`; `failed` si fue `error`; `missing` si la facturación está activa, el
mes de inicio ya llegó, hoy es ≥ 1° y **no hay ninguna corrida del mes**
(el cron no corrió: pg_cron caído, job borrado); `not_due` si la facturación
no está activa o empieza en el futuro. `failed` y `missing` producen el
**aviso para admin** en el panel inicial y en `/ajustes`, con el mensaje de
error (si lo hay) y el botón "Reintentar" → `generatePendingFees()`. Un rol
que no es admin no ve filas de `billing_runs` (RLS): para él
`currentPeriodRun` es `ok`/`not_due` y no hay aviso, que es lo correcto
(no puede reintentar).

### 6.5 `settings`: activación de la facturación (D18)

Trigger BEFORE UPDATE sobre `settings`: `billing_start_period` (a) no vuelve a
null una vez fijado; (b) al fijarlo, `>= date_trunc('month', club_today())`
(el pasado entra como saldo de arranque, nunca como meses regenerados); (c)
exige que exista un `fee_prices` con `scope = 'default'` y `valid_from <=
billing_start_period`; (d) se puede **cambiar solo mientras no exista ninguna
`fee` mensual**. Sigue siendo `grant update (club_name, billing_start_period)`
para `authenticated` con policy admin; la app lo separa en dos actions.

### 6.6 Deuda derivada: funciones y RPCs (SECURITY INVOKER, respetan RLS)

Núcleo: `private.member_balance(member_id) → (charged_cents, paid_cents,
balance_cents, months_due, oldest_due_period, last_payment_on,
last_payment_cents)`, `STABLE`. Semántica **balance forward**:
`charged` = cargos no anulados (todo `kind`); `paid` = pagos no anulados;
`balance = charged − paid`; `months_due` = cantidad de cargos no anulados
**no cubiertos del todo** recorriéndolos del más viejo al más nuevo (orden
`period`, luego `opening_balance` antes que `monthly`, luego `id`) contra
`paid` (el saldo de arranque cuenta como un ítem; el parcial cuenta como
adeudado); `oldest_due_period` = período del primero no cubierto.

Campos calculados de PostgREST sobre `public.members` (funciones
`public.member_debt_status(members) → text` in (`up_to_date`, `in_debt`,
`credit`), `public.member_balance_cents(members) → bigint`,
`public.member_months_due(members) → int`; `STABLE`, `set search_path = ''`,
`revoke from public, anon`, `grant execute to authenticated`): son lo que
permite `.eq('member_debt_status', 'in_debt')` y mostrar la deuda en cada fila
del padrón sin tocar la paginación (D24).

RPCs en `public` (todas `revoke execute from public, anon` + `grant to
authenticated`; devuelven `setof` para que PostgREST admita `order`, filtros y
`range`):

- `member_accounts(member_ids bigint[] default null, status_filter text
  default 'active')` → por socio: `member_id`, `full_name` ("Apellido,
  Nombre"), `status`, `member_type`, `category_id`, `category_name`,
  `discipline_name`, `family_group_id`, `is_payment_responsible`, los siete
  campos de `member_balance`, `debt_status`, **`current_fee_cents`** (la cuota
  mensual no anulada del período actual si existe; si no, el precio resuelto
  para el período actual; null si no hay facturación activa) y
  `current_fee_period`. Con `member_ids` null devuelve todos (según
  `status_filter`: `active` | `inactive` | `all`). Alimenta la ficha (un id),
  la precarga del pago de grupo (N ids), los listados al día / con deuda (con
  `?debt_status=eq.…&order=months_due.desc,balance_cents.desc` y `range`) y el
  top 5.
- `member_fee_statement(target_member_id bigint)` → cada cargo del socio con
  `covered_cents` y `status` in (`paid`, `partial`, `due`, `voided`), ordenado
  del más viejo al más nuevo: los "meses adeudados" de la ficha.
- `month_collection(target_period date default null)` → una fila:
  `period`, `collected_cents`, `cash_cents`, `transfer_cents`,
  `payments_count`, `fees_cents` (cuotas mensuales no anuladas del período),
  `fees_count`. "Cobrado en el mes" = pagos no anulados con `paid_on` en el
  mes, **aunque cubran deuda vieja** (confirmado por Tomás).
- `dashboard_summary()` → una fila: `billing_active`, `billing_start_period`,
  `period` (actual), `active_members`, `collected_cents`, `cash_cents`,
  `transfer_cents`, `fees_cents`, `fees_count`, `total_debt_cents` (suma de
  saldos **positivos** de socios **activos**), `members_in_debt`,
  `members_with_credit`, `credit_cents`, `inactive_debt_cents`,
  `inactive_in_debt`, `admissions_count` y `withdrawals_count` (eventos con
  `effective_on` en el mes), `expired_clearances` y `missing_clearances`
  (menores activos), `pending_periods` (períodos entre el inicio y hoy sin
  ninguna cuota generada habiendo socios activos: si no está vacío, el panel
  avisa al admin).
- `debt_by_category()` → por categoría de socios activos (una fila más para
  "No practicantes"): `category_id`, `category_name`, `discipline_name`,
  `members`, `members_in_debt`, `debt_cents`, `sort_order`. **Revisión 3
  (§13.5):** el socio aparece en cada categoría en la que está; la deuda se
  atribuye cargo por cargo (cobertura oldest-first), con filas extra "Cuota
  social" y "Saldo anterior al sistema" para que la suma sea la deuda total.
- `monthly_history(months int default 12)` → por período (los últimos N,
  incluido el actual): `period`, `collected_cents`, `fees_cents`,
  `debt_at_close_cents`. **Definición de "deuda al cierre" (D16)**: para
  cada período P, la suma sobre los socios **activos al último día de P**
  (reconstruido desde `member_status_events`: `joined_on <=` fin de P y el
  último evento con `effective_on <=` fin de P no es una baja) de
  `greatest(0, cargos no anulados con period <= P − pagos no anulados con
  paid_on <= fin de P)`. Es "como se sabe hoy" (lo anulado no cuenta nunca),
  no "como se veía entonces": una anulación corrige la historia, que es lo que
  significa anular. Con 250 socios × 12 meses es una consulta trivial.
- `log_export(listing text, filters jsonb, row_count int)` → `void`,
  SECURITY DEFINER (es la única forma de insertar en `audit_log`), exige rol
  activo, inserta `op = 'EXPORT'` con `context = {listing, filters,
  row_count}`. **Gancho para el slice 3, sin consumidor en este.**

### 6.7 Matriz de RLS y grants (tablas nuevas), expresada en permisos

Toda regla nueva de este slice chequea `private.can('<permiso>')` (§6.8),
nunca `has_role`/`is_admin`. Con el mapeo fijo de hoy, `can` equivale a los
roles que se indican entre paréntesis.

| Tabla | SELECT | INSERT | UPDATE (columnas) | Invariantes por trigger |
|---|---|---|---|---|
| `fee_prices` | `payments.read` (todos) | `billing.configure` (admin) (`scope, member_type, category_id, amount_cents, valid_from, notes`) | nadie | `valid_from` ≥ mes actual; sin cuotas ya generadas en ese mes; `forbid_change` |
| `fees` | `payments.read` (todos) | `payments.register` (admin, editor) **solo `kind = 'opening_balance'`** (`member_id, kind, amount_cents, description`; `period` lo fija el trigger); `monthly` solo por el generador (DEFINER) | `payments.void` (admin): `voided_at, voided_by, void_reason`; el trigger lo vuelve a exigir | inmutables; anulación una vez; un arranque vigente por socio |
| `payments` | `payments.read` (todos) | `payments.register` (admin, editor) (`member_id, amount_cents, paid_on, method, receipt_storage_path, receipt_filename, notes, batch_id`; `created_by = auth.uid()`) | `payments.register` **o** `payments.void` (policy); columnas `voided_at, voided_by, void_reason, receipt_storage_path, receipt_filename`; trigger: anular exige `can('payments.void')`, comprobante exige `can('payments.register')` y solo null→valor | inmutables; `paid_on` no futura; `(batch_id, member_id)` único |
| `billing_runs` | `billing.configure` (admin) | nadie (solo el generador, DEFINER) | nadie (`notified_at` se habilita cuando exista el job de avisos) | append-only por `forbid_change`; **no auditada** (técnica, §6.4) |
| `settings.billing_start_period` | (slice 1) | — | policy del slice 1 (`is_admin`, deuda); el trigger nuevo de activación exige además `can('billing.configure')` | reglas a–d de §6.5 |
| RPC `generate_pending_fees` | — | — | — | DEFINER, `can('billing.configure')` en el cuerpo; registra la corrida como `manual` con actor |
| RPCs `member_accounts`, `member_fee_statement`, `month_collection`, campos calculados | `can('payments.read')` en el cuerpo (INVOKER, y RLS filtra igual) | — | — | — |
| RPCs `dashboard_summary`, `debt_by_category`, `monthly_history` | `can('reports.read')` en el cuerpo | — | — | — |
| RPC `log_export` | — | `can('reports.export')` en el cuerpo (DEFINER) | — | gancho slice 3 |
| `storage.objects` prefijo `payment-receipts/` | policy del slice 1 (`has_role('admin','editor')`, deuda) | ídem | — | — |
| `service_role` | SELECT en las cuatro tablas (backups, exportación completa) | nada | nada | — |

Con el mapeo de hoy: `consulta` no escribe nada; `editor` registra pagos y
saldos de arranque y adjunta comprobantes; solo `admin` anula, fija valores
de cuota, activa la facturación, genera a mano y lee `billing_runs`. **Nadie
tiene DELETE.** `UPDATE` de una policy sin `SELECT` no funciona: todas tienen
SELECT para quien tiene `payments.read`.

Se prueba contra la base (`tests/db/`): cada celda con claims de cada rol
**y** con `private.can` directamente; `editor` no puede insertar `kind =
'monthly'` ni anular (la columna tiene grant pero el trigger lo rechaza);
`authenticated` no tiene DELETE en ninguna tabla de `public`; `UPDATE
payments set amount_cents` falla también como `postgres`; el cron (como
`postgres`, sin JWT) deja `audit_log.actor_source = 'system'`; la RPC de
generación como `admin` deja `'session'` con su id.

### 6.8 Catálogo de permisos y `private.can` (T12)

**Catálogo** (claves estables, `text`; se agregan, nunca se renombran):

| Permiso | Qué habilita | admin | editor | consulta |
|---|---|---|---|---|
| `members.read` | padrón, fichas, grupos, aptos (lectura) | sí | sí | sí |
| `members.write` | alta y modificación de socios, grupo familiar, apto físico | sí | sí | — |
| `members.status` | baja y reactivación (fichas de egreso) | sí | — | — |
| `payments.read` | estados de cuenta, cobranza, listados de deuda, valores de cuota (lectura) | sí | sí | sí |
| `payments.register` | registrar pagos, adjuntar comprobante, cargar saldo de arranque | sí | sí | — |
| `payments.void` | anular pagos y cuotas | sí | — | — |
| `billing.configure` | valores de cuota, activar facturación, generar/reintentar, ver corridas | sí | — | — |
| `settings.manage` | disciplinas, categorías, datos del club | sí | — | — |
| `users.manage` | usuarios internos y (mañana) roles | sí | — | — |
| `audit.read` | registro de auditoría | sí | — | — |
| `reports.read` | panel inicial y listados agregados | sí | sí | sí |
| `reports.export` | exportar CSV (slice 3) | sí | sí | sí |

Doce permisos por acción, ninguno por pantalla: una pantalla muestra lo que
la suma de permisos habilita. `consulta` exporta porque el contrato (2.3) le
da "reportes y estadísticas" y (2.4) "exportación a CSV de cualquier
listado". Administrador tiene todos y, en el pipeline de roles, queda
bloqueado.

**Resolución en SQL.** `private.permissions_for_role(role text) → text[]`
(`IMMUTABLE` hoy: un `case` con el mapeo de arriba; mañana, `STABLE` y lee
`role_permissions`). `private.can(permission text) → boolean` (SECURITY
DEFINER, `STABLE`, `set search_path = ''`, `revoke from public, anon`, `grant
execute to authenticated, service_role`): `select permission = any
(private.permissions_for_role(private.current_app_role()))`, con `null` →
`false`. Hereda de `current_app_role` que un usuario sin fila, desactivado o
con contraseña temporal pendiente **no tiene ningún permiso**. Las policies
la llaman como `(select private.can('payments.register'))` (una evaluación
por sentencia). `public.my_permissions() → text[]` (SECURITY DEFINER, mismo
régimen de grants; devuelve `permissions_for_role(current_app_role())` o
`{}`): es lo que la app lee una vez por request para poblar
`SessionInfo.permissions`, así **hay una sola fuente de verdad** (SQL) y
ningún mapa duplicado en TypeScript.

**Mañana, sin cambiar firmas.** El pipeline de roles crea `roles` (`key`,
`name`, `is_locked`) y `role_permissions` (`role_key`, `permission`),
siembra los tres roles actuales con este mapeo, cambia el cuerpo de
`permissions_for_role` para leer la tabla y `app_users.role` pasa a FK
`roles.key` (el CHECK actual se reemplaza por la FK). `private.can`,
`my_permissions`, `requirePermission` y `SessionInfo.permissions` no cambian.

**Deuda explícita (primer paso de ese pipeline):** las policies, triggers y
RPCs del slice 1 (`app_users`, `settings`, `disciplines`, `categories`,
`family_groups`, `members`, `member_status_events`, `medical_clearances`,
`storage.objects`, `set_family_payment_responsible`, `mark_password_reset`)
usan `has_role`/`is_admin`, y sus actions usan `requireRole`. Ese pipeline
empieza migrándolas a `can('members.write')`, `can('members.status')`,
`can('settings.manage')`, `can('users.manage')`, `can('audit.read')` y a
`requirePermission`, con los tests de RLS del slice 1 como red; recién
después toca `roles`/`role_permissions` y la UI de `/usuarios`. Este slice
**no** toca esas reglas.

**Guards en TS** (SH1, hilo principal): `requirePermission(...permissions)`
para actions (tira `PermissionError`; exige **todos** los listados; también
tira sin sesión, sin rol activo o con contraseña temporal, como
`requireRole`) y `requirePanelPermission(...permissions)` para pages y
controllers de lectura (redirige como `requirePanelAccess`). `getSession()`
suma `permissions: Permission[]` leyendo `my_permissions()` en paralelo con
la fila propia. `requireRole`/`requirePanelAccess` siguen existiendo para el
código del slice 1. En la UI, la vista decide qué mostrar con
`session.permissions.includes(...)`, nunca con `session.role`.

## 7. Decisiones de este slice (con opciones)

**D12. Qué monto se precarga al registrar un pago.** *(Revisión 3: "la
cuota vigente" es la **suma** de sus cuotas del mes —una por deporte, o la
social— y el formulario muestra el desglose, §13.4.)*
- *A. La cuota vigente del socio* (`current_fee_cents`): la del período actual
  si ya se generó, si no el precio resuelto. Pros: es lo que pidió Tomás,
  rápido para el caso común ("vengo a pagar el mes"). Contras: si debe cuatro
  meses, hay que editar.
- *B. La deuda total.* Pros: un toque para ponerse al día. Contras: asusta
  cuando alguien viene a pagar solo el mes; con saldo a favor precargaría 0.
- *C. La cuota vigente precargada, editable, más un atajo "Pagar toda la
  deuda ($X)" visible solo si `balance_cents > current_fee_cents`, y un
  segundo atajo "2 meses", "3 meses" como chips* (recomendada). Cubre los dos
  casos sin pensar. Socio **dado de baja**: no hay cuota vigente; se precarga
  la deuda si la hay, si no queda vacío. Socio con saldo a favor: se precarga
  la cuota igual (paga adelantado) y el formulario dice "Tiene saldo a favor
  de $Y".

**D13. Saldo a favor y pagos que exceden la deuda.**
- *A. Permitir, mostrar como "saldo a favor", que lo consuman las cuotas
  siguientes* (recomendada). Es balance forward puro: `balance < 0`; la
  próxima cuota generada baja el saldo a favor sin que nadie haga nada. En
  la ficha: "Saldo a favor $X (cubre N cuotas)". En los KPIs no resta deuda de
  otros: `total_debt` suma solo saldos positivos; `credit_cents` se muestra
  aparte. El formulario confirma: "Queda un saldo a favor de $X que se
  descuenta de las próximas cuotas". Pagar adelantado es común en el club
  (planillas con varios meses marcados de una vez).
- *B. Bloquear pagos mayores a la deuda.* Impide cobrar por adelantado; malo.
- *C. Tope silencioso al monto de la deuda.* Peor: la plata entró y no se
  registró.
Pregunta a la Comisión C13 solo para confirmar que aceptan pagos adelantados.

**D14. Pago de un socio dado de baja.**
- *A. Permitido para admin/editor, con aviso en el formulario* ("Este socio
  está dado de baja: el pago se imputa a su deuda; no se le generan cuotas").
  Recomendada: la deuda vieja se cobra, sobre todo si vuelve. La reactivación
  sigue siendo un evento aparte (solo admin, D2).
- *B. Bloquear.* Obliga a reactivar para cobrar y luego dar de baja de nuevo:
  historia falsa.
- KPIs y listados: **activos por defecto**; "Deuda de socios dados de baja"
  como línea aparte con link (`status_filter = 'inactive'`). C12 para la
  Comisión: ¿esa deuda se sigue reclamando?

**D15. Pago parcial: imputación y visualización.** Balance forward (D3): el
pago baja el saldo; el cargo más viejo no cubierto queda "parcial (pagó $X de
$Y)" y sigue contando como adeudado; los siguientes, "adeudado"; los
cubiertos, "pagado". Todo derivado por `member_fee_statement`; no hay tabla de
imputaciones. Si la Comisión responde C3 pidiendo elegir meses, se agrega
`payment_allocations` sin tocar `fees` ni `payments` (ya previsto en D3).

**D16. "Deuda al cierre de mes" para la evolución.**
- *A. Snapshot mensual guardado por el cron.* Simple de leer, pero es un saldo
  almacenado (`CLAUDE.md` lo prohíbe con razón: una anulación posterior lo
  deja mal para siempre).
- *B. Reconstrucción pura desde cargos, pagos y eventos de estado*
  (recomendada, definida en §6.6). Costo: una consulta con `generate_series`
  y `lateral`, trivial a esta escala; siempre coherente con las anulaciones.
- *C. Reconstrucción con la población activa de hoy.* Más simple pero una
  baja de este mes borra retroactivamente su deuda de la curva de hace seis
  meses: la curva miente.
"Cobrado" en la evolución = pagos no anulados por mes de `paid_on`, la misma
definición que el KPI.

**D17. Cambio del valor de la cuota a mitad de mes.**
- *A. Aceptar cualquier `valid_from` y congelar lo ya generado.* El admin cree
  que cambió septiembre y no cambió: desajuste silencioso.
- *B. `valid_from` ≥ mes actual y rechazo si ese mes ya tiene cuotas
  generadas* (recomendada). El formulario propone "Aplica desde: <mes
  siguiente>" y muestra "<mes actual>" solo si todavía no se generó (antes de
  activar, o el 1° antes de las 00:05). El error es explícito. Las cuotas
  pasadas **nunca** cambian; la ficha muestra el monto congelado de cada mes y
  `/ajustes` la historia de valores con "vigente desde".
- *C. Regenerar las cuotas del mes al cambiar el precio.* Viola "monto
  congelado" y toca cargos ya pagados. Descartada.

**D18. Activación de la facturación y el mes en curso.**
- Flujo: `/ajustes` → sección "Cuotas" → "Activar cuotas": elige el primer mes
  (mes actual o futuro), ve el resumen "Se van a generar N cuotas de <mes> por
  $X (valor por defecto; hay valores por categoría/tipo para M socios). El
  valor de ese mes no se puede cambiar después." → confirma → action
  `activateBilling`: `requireRole('admin')`, `UPDATE settings` (trigger valida
  a–d de §6.5), y si el mes es el actual llama a `generate_pending_fees()`.
  Si es futuro, el cron lo genera el 1°.
- Cadencia de generación, opciones evaluadas: *(a)* cron mensual el día 1 +
  botón; *(b)* cron diario idempotente (mi recomendación original); *(c)*
  trigger en el alta/reactivación + cron mensual. **Decidido por Tomás (T1):
  (a), con dos condiciones que le quitan el riesgo de "falla en silencio"**:
  cada corrida queda en `billing_runs`, y el mes en curso sin corrida `ok`
  se ve como aviso para admin con "Reintentar" (§6.4). El reintento y el
  botón "Generar cuotas ahora" generan todos los períodos pendientes.
- **El mes de alta se cobra completo.** Con la corrida mensual, un socio
  dado de alta después del día 1 recibe la cuota de ese mes cuando un admin
  toca "Generar cuotas ahora" o, a más tardar, en la corrida del 1° del mes
  siguiente (que recorre también el mes anterior: `joined_on` ≤ fin de ese
  mes). La precarga del pago no lo necesita (usa el precio resuelto si aún
  no hay cuota, D19). Las planillas no prorratean. Pregunta a la Comisión C10.
  Lo mismo para la reactivación. Un socio dado de baja después de generada
  la cuota del mes la conserva; si la Comisión no la cobra, el admin la
  anula con motivo (C11).
- Orden de carga inicial que esto impone (va en la UI de Ajustes como texto y
  en el manual): 1) valor de cuota por defecto; 2) activar cuotas con el mes
  de inicio; 3) socios; 4) saldos de arranque (necesitan el mes de inicio
  para fijar su período).

**D19. Cómo se congela y se muestra el precio por período.** Se resuelve al
generar y queda en `fees.amount_cents` con `fee_price_id`. La ficha lista cada
período con su monto; el padrón no muestra precios; `/ajustes` muestra los
valores vigentes hoy (uno por scope) y la historia. `current_fee_cents` de
`member_accounts` es la única fuente de "cuota vigente" para la precarga
(nunca se recalcula en TS).

**D20. Permisos, no roles (T12).** Toda regla nueva chequea un permiso del
catálogo de §6.8 vía `private.can` / `requirePermission`. El mapeo fijo de
hoy es la lectura estricta del contrato (2.3): `editor` "registra pagos",
"sin permiso para eliminar registros históricos" → tiene `payments.register`
y no `payments.void`; `consulta` "solo lectura" → `members.read`,
`payments.read`, `reports.read`, `reports.export`. Alternativas evaluadas:
*(a)* seguir con `has_role` y migrar todo junto en el pipeline de roles
(duplica el trabajo de este slice); *(b)* claims de permisos en el JWT
(descartado por lo mismo que D1: obsoletos hasta el refresh); *(c)* **helper
SQL + RPC `my_permissions` + guards TS** (elegida): un solo lugar de verdad,
firmas estables, y "que Secretaría pueda anular" pasa a ser una fila de
`role_permissions` mañana en vez de una policy hoy.

**D21. Auditoría.** `enable_audit` en `fee_prices`, `fees`, `payments`. Cron:
`actor_source = 'system'`, `actor_id` null. Generación manual: `'session'`
con el admin. Registrar pago: `INSERT` con actor. Anular: `UPDATE` con
`changed_fields = {voided_at, voided_by, void_reason}` y actor admin. Adjuntar
comprobante después: `UPDATE` con `changed_fields = {receipt_storage_path,
receipt_filename}`. Activar facturación y valores de cuota: `settings` y
`fee_prices`. `audit.model.ts` extiende `buildLabelDraft` para las tres
tablas (`fees`/`payments` → nombre del socio + período/monto;
`fee_prices` → scope + monto + "desde <mes>"); `AuditedTable` suma las tres.
Sin datos personales en logs: `paymentId`, `memberId`, `batchId`, montos.

**D22. Pago por grupo familiar e idempotencia.** Un pago por integrante con el
mismo `batch_id`, insertados en **una sola sentencia** (un `.insert([...])` de
supabase-js = una transacción de PostgREST: o entran todos o ninguno). Sin
RPC: no hay invariante nueva que la base deba proteger más allá del índice
único. El `batch_id` lo genera el formulario al montarse (`crypto.randomUUID()`
en el cliente; la action lo valida como uuid y **no** lo regenera); un doble
toque o un reintento por señal choca con `(batch_id, member_id)` y la action
lo devuelve como "El pago ya estaba registrado" con `ok: true`. Un pago suelto
es un lote de uno. La pantalla de grupo lista a **todos** los integrantes
(activos y de baja, marcados), con cada cuota precargada (`current_fee_cents`
por id) y editable, y permite desmarcar; el comprobante, si hay, es el mismo
objeto para todas las filas del lote.

**D23. Comprobante.** Ruta `payment-receipts/<member_id>/<uuid>.<ext>` (para
el lote, el `member_id` del primer integrante marcado; la ruta no necesita el
id del pago, que aún no existe). Mismo flujo que D11: `prepareReceiptUpload`
(admin/editor, valida MIME y tamaño, arma la ruta, firma la subida) → el
browser sube → `registerPayment` recibe `receiptPath` y verifica con
`objectExists` que el objeto está y que la ruta empieza con el prefijo
válido. "Adjuntar comprobante" a un pago existente: mismo prepare +
`attachReceipt(paymentId, path)` que hace el UPDATE null→valor. Ver: URL
firmada de 60 s desde el controller de la ficha y del listado de pagos, nunca
persistida. Objetos huérfanos: script de limpieza, no integridad.

**D24. Filtro "condición de deuda" en el padrón.**
- *A. Campos calculados de PostgREST sobre `members`* (recomendada): tres
  funciones sobre el tipo de la tabla, `searchMembers` agrega
  `member_debt_status, member_balance_cents, member_months_due` al `select`,
  filtra con `.eq('member_debt_status', …)` y el keyset sigue igual. Costo:
  una función por fila (dos agregaciones indexadas por socio) sobre las
  filas que ya pasan los otros filtros; a 1.000 socios es imperceptible.
- *B. Mover `searchMembers` a una RPC SQL.* Más limpio en SQL, pero reescribe
  algo que funciona y traslada el keyset y la búsqueda por trigram a la
  función.
- *C. Pedir los ids con deuda por RPC y filtrar con `.in()`.* URL de 1.000
  ids, dos viajes, y el keyset se enrarece.
`MemberSummary` gana `debtStatus`, `balanceCents`, `monthsDue` (con la
facturación inactiva: `up_to_date`, 0, 0). `MemberFilters.debt` mantiene sus
valores (`credit` cuenta como al día para el filtro; la fila lo muestra como
"Saldo a favor").

**D25. Saldo de arranque.** Confirma D6 con un ajuste: el período **lo fija
el trigger** (`billing_start_period − 1 mes`), no el usuario, y exige la
facturación activada (si no, `DomainError`: "Primero activá las cuotas en
Ajustes"). Se carga desde la ficha ("Cargar saldo anterior", admin/editor),
solo si el socio no tiene uno vigente; monto > 0; anulable por admin con
motivo (y entonces se puede cargar otro). Aparece en el estado de cuenta como
"Saldo anterior al sistema (hasta <mes>)" y cuenta como un ítem adeudado.

**D26. Dónde viven los listados.** `CLAUDE.md` ubica en `/cobranza` "registrar
pagos, cobranza del mes, listados de deuda" y en `/reportes` "listados
operativos y exportación" (slice 3). Para no duplicar pantallas: los cuatro
listados del contrato viven en `/cobranza` **ahora**; en el slice 3,
`/reportes` es el índice de listados exportables y cada listado suma el botón
"Exportar CSV" en el mismo lugar. Pregunta a Tomás T3.

## 8. Arquitectura recomendada (aplicación)

### 8.1 Rutas

```
app/(panel)/
  page.tsx                          panel inicial (rediseñado)            [F3]
  socios/page.tsx                   padrón: filtro de deuda activo + deuda por fila  [F2]
  socios/[id]/page.tsx              ficha + estado de cuenta + acciones     [F2]
  cobranza/page.tsx                 hub: registrar, este mes, accesos       [F1]
  cobranza/nuevo/page.tsx           registrar pago (?socio=<id> | ?grupo=<id>) [F1]
  cobranza/pagos/page.tsx           pagos del mes (?mes=YYYY-MM), anular     [F1]
  cobranza/deuda/page.tsx           socios con deuda (?categoriaId, ?estado) [F1]
  cobranza/al-dia/page.tsx          socios al día                           [F1]
  cobranza/por-categoria/page.tsx   deuda por categoría                     [F1]
  (admin)/ajustes/page.tsx          + valores de cuota + estado de cuotas   [F4]
```

Todas las pages pasan por `requirePanelAccess()` (o su controller). Las de
`/cobranza` son para todos los roles; "Registrar pago", "Cargar saldo
anterior" y "Adjuntar comprobante" solo aparecen para admin/editor; "Anular"
solo para admin. `nav-items.ts` suma **Cobranza** para todos (móvil: Inicio,
Socios, Cobranza; admin suma Usuarios/Ajustes/Auditoría como hoy).

### 8.2 Capas

**`src/models/types.ts`** (SH1, hilo principal) suma: `FeePriceScope`,
`FeePrice`, `FeePriceInput`, `FeeKind`, `Fee`, `FeeStatementStatus`
(`paid | partial | due | voided`), `FeeStatementLine`, `PaymentMethod`,
`Payment`, `PaymentListItem` (pago + `memberId`, `memberFullName`, `voided`,
`hasReceipt`), `DebtStatus` (`up_to_date | in_debt | credit`), `MemberAccount`
(la fila de `member_accounts` en camelCase), `MemberAccountDetail`
(`account` + `statement: FeeStatementLine[]` + `payments: Payment[]` +
`openingBalance: Fee | null`), `MemberPageData` (`member: MemberDetail`,
`account: MemberAccountDetail | null`, `billing: BillingStatus`),
`BillingStatus` (`active`, `startPeriod`, `currentPeriod`,
`lastGeneratedPeriod`, `pendingPeriods: ISODate[]`, `activeMembers`),
`BillingRunStatus` (`ok | error | skipped`), `BillingRun` (`id`, `period`,
`trigger: 'cron' | 'manual'`, `actorName | null`, `startedAt`, `finishedAt`,
`status`, `feesCreated`, `errorMessage | null`), `BillingStatus` suma
`currentPeriodRun: 'ok' | 'failed' | 'missing' | 'not_due'`, `lastRun:
BillingRun | null` y `recentRuns: BillingRun[]` (solo admin ve filas),
`FeePricesOverview` (`current: { default, byMemberType[], byCategory[] }`,
`history: FeePrice[]`), `MonthCollection`, `DashboardSummary`,
`DebtByCategoryRow`, `MonthlyHistoryPoint`, `DashboardData` (summary +
topDebtors + byCategory + history), `AccountListFilters` (`debt`, `categoryId`,
`status`, `cursor`, `limit`), `PaymentFormData` (`members: MemberAccount[]`,
`familyGroup: FamilyGroupSummary | null`, `billing`), y `MemberSummary` +
`debtStatus`, `balanceCents`, `monthsDue`; `AuditedTable` + `fee_prices`,
`fees`, `payments`; **`Permission`** (unión de las doce claves de §6.8) y
`SessionInfo.permissions: Permission[]`. Solo tipos.

**`src/controllers/session.controller.ts`** (SH1, hilo principal):
`getSession()` lee `my_permissions()` (RPC, cliente de sesión) en paralelo
con la fila propia y lo memoiza con `cache()`; `requirePermission(...perms)`
(actions; `PermissionError`; exige todos) y `requirePanelPermission(...perms)`
(pages y controllers; redirige). `requireRole`/`requirePanelAccess` quedan
para el slice 1. `session.model.ts` (hilo principal) suma
`getOwnPermissions()`, fail-closed (`[]` ante error).

**`src/views/shared/`** (SH2, hilo principal): `AmountField` en
`form-fields.tsx` (pesos tipeados → centavos con `parsePesosToCents`,
`inputmode="decimal"`, tabular, error "Ingresá un monto válido"); variante
`credit` en `StatusPill` (texto "Saldo a favor", tono neutro/verde suave) y
`DebtStatusPill(status)`; `PeriodText` (`formatPeriod`); `labels.ts` suma
`paymentMethodLabels`, `debtStatusLabels`, `feeKindLabels`,
`feeStatementStatusLabels`, `feePriceScopeLabels`, y `auditedTableLabels`
(en `views/audit/audit-labels.ts`, F4) suma las tres tablas.

**Modelos** (`server-only`, cliente de sesión salvo indicación):
- `fee-prices.model.ts` [B1]: `listFeePrices()` → historia completa;
  `getFeePricesOverview()`; `createFeePrice(input)` (Zod `.strict()`: scope +
  coherencia, `amountCents` entero ≥ 0, `validFrom` primer día de mes; traduce
  la excepción del trigger a `DomainError` con `field: 'validFrom'`).
- `billing.model.ts` [B1]: `getBillingStatus()` (settings + `pending_periods`
  y `lastGeneratedPeriod` desde `dashboard_summary`/`fees` + últimas filas de
  `billing_runs` → `currentPeriodRun`, `lastRun`, `recentRuns`),
  `listBillingRuns(limit)`, `activateBilling(startPeriod)` (UPDATE settings;
  traduce a–d a `DomainError`), `generatePendingFees()` (RPC → cantidad
  creada; si la RPC devuelve una corrida `error`, la traduce a `DomainError`
  con el mensaje registrado).
- `settings.model.ts` [B1, modificar]: `updateSettings` pasa a aceptar **solo
  `clubName`**; `billingStartPeriod` sale del schema.
- `fees.model.ts` [B2]: `createOpeningBalance({ memberId, amountCents,
  description? })`, `voidFee(id, reason)`, `getOpeningBalance(memberId)`.
- `payments.model.ts` [B2]: `registerPayments(batch)` (una sentencia con N
  filas; detecta unique violation de `(batch_id, member_id)` → resultado
  `alreadyRegistered: true`), `voidPayment(id, reason)`,
  `attachReceipt(id, path, filename)`, `listPayments({ period | memberId,
  includeVoided, cursor, limit })` con embed de `members(first_name,
  last_name)`, `getPayment(id)`; schemas `paymentItemSchema`,
  `registerPaymentSchema` (`batchId` uuid, `paidOn` ≤ hoy, `method`, `notes`,
  `receiptPath` opcional con prefijo, `items` ≥ 1, cada uno `memberId` +
  `amountCents` > 0), `voidSchema` (`reason` ≥ 3).
- `accounts.model.ts` [B2]: `getMemberAccount(memberId)`,
  `getMemberAccounts(memberIds)` (RPC `member_accounts` con ids),
  `getFeeStatement(memberId)`, `getMemberAccountDetail(memberId)` (compone
  cuenta + statement + pagos del socio + saldo de arranque vigente).
- `reports.model.ts` [B3]: `getDashboardSummary()`, `getMonthCollection(period)`,
  `getDebtByCategory()`, `getMonthlyHistory(months)`,
  `listMemberAccounts(filters)` (RPC `member_accounts` con
  `status_filter`, `?debt_status=eq.…`, `?category_id=eq.…`, `order` por
  `months_due desc, balance_cents desc, full_name`, y **`range` por páginas
  de 200** hasta agotar; devuelve `Page<MemberAccount>` con cursor de
  offset), `getTopDebtors(5)`.
- `members.model.ts` [B3, modificar]: `searchMembers` suma los tres campos
  calculados al `select`, aplica `debt` (`in_debt` → `eq`, `up_to_date` →
  `in ('up_to_date','credit')`), y mapea a `MemberSummary`.
- `audit.model.ts` [B2, modificar]: `buildLabelDraft` para `fee_prices`,
  `fees`, `payments` (necesita resolver el nombre del socio: reutiliza el
  camino `needsMember` que ya existe).

**Controllers**:
- `settings.controller.ts` [B1, modificar]: `getSettingsPage()` suma
  `feePrices: FeePricesOverview`, `billing: BillingStatus` y `categories`
  activas para el select de scope.
- `settings.actions.ts` [B1, modificar]: `updateSettings` solo `clubName`.
- `billing.actions.ts` [B1, nuevo]: `createFeePrice(input)`,
  `activateBilling(input)` (admin; después del UPDATE, si el mes es el
  actual llama a `generatePendingFees`; revalida `/ajustes`, `/`,
  `/cobranza`, `/socios`), `generatePendingFees()` (admin; devuelve la
  cantidad; revalida lo mismo).
- `payments.controller.ts` [B2, nuevo]: `getPaymentFormData({ memberId? ,
  familyGroupId? })` (admin/editor: cuentas de los integrantes con
  `current_fee_cents`, grupo, `billing`), `getMonthPaymentsPage(period,
  cursor)` (todos los roles), `getReceiptUrl(paymentId)` (todos los roles;
  firma 60 s **solo bajo demanda**: la lista no firma una URL por fila. Como
  la vista es un Client Component y la pide al tocar "Ver comprobante", se
  expone también como action de solo lectura `getReceiptUrlAction` en
  `payments.actions.ts`, que delega en esta; ver §9).
- `payments.actions.ts` [B2, nuevo]: `registerPayment(input)` (admin/editor;
  Zod; valida que si hay `familyGroupId` todos los `memberId` pertenezcan al
  grupo; si hay `receiptPath`, `objectExists` y prefijo; llama a
  `registerPayments`; revalida `/`, `/cobranza`, `/socios`, `/socios/[id]`
  de cada socio), `voidPayment(input)` (admin), `prepareReceiptUpload(input)`
  (admin/editor), `attachReceipt(input)` (admin/editor),
  `createOpeningBalance(input)` (admin/editor), `voidFee(input)` (admin).
- `members.controller.ts` [B3, modificar]: `getMemberPage(id)` devuelve
  `MemberPageData` (ficha + `getMemberAccountDetail` + `getBillingStatus`);
  `getPadron` sin cambios de firma.
- `reports.controller.ts` [B3, nuevo]: `getDashboard()` (todos los roles;
  compone `dashboard_summary` + top 5 + por categoría + historia),
  `getCobranzaHub()` (mes actual + `billing`), `getDebtListing(filters)`,
  `getUpToDateListing(filters)`, `getDebtByCategoryPage()`.

**Servicios**: `storage.service.ts` sin cambios (se reutiliza para los
comprobantes).

**Vistas**: `views/payments/**` [F1] (`PaymentForm` con chips de monto y
selector de medio, `GroupPaymentForm`, `ReceiptUpload`, `MonthPaymentsList`,
`VoidPaymentDialog` sobre `ReasonDialog`, `DebtList`, `UpToDateList`,
`DebtByCategoryList`, `CobranzaHub`), `views/members/**` [F2]
(`AccountSection` arriba de la ficha, `FeeStatementList`, `MemberPaymentsList`,
`OpeningBalanceDialog`, fila del padrón con `DebtStatusPill` y "Debe N meses ·
$X"), `views/dashboard/**` [F3] (`DashboardView`, `MonthPanel`, `DebtPanel`,
`HistoryChart` + `HistoryTable`, `PadronPanel`, `BillingInactiveNotice`),
`views/shell/**` [F3] (Cobranza en la navegación), `views/settings/**` [F4]
(`FeePricesSection`, `NewFeePriceSheet`, `BillingSection` con activar /
generar ahora / períodos pendientes).

### 8.3 Flujos clave (en prosa)

**Activar cuotas.** Admin en `/ajustes` → (si no hay valor por defecto, la
sección pide cargarlo primero, con el botón de activar deshabilitado y el
motivo escrito) → "Activar cuotas" → elige mes (mes actual o futuros; default
mes actual) → resumen con N socios activos y valor por scope → confirma →
`activateBilling` → `requireRole('admin')` → Zod → `activateBilling` del
modelo (UPDATE `settings`; el trigger valida) → si es el mes actual,
`generatePendingFees()` (RPC) → toast "Se generaron N cuotas de <mes>" →
revalidación. Auditoría: `settings` UPDATE + N `fees` INSERT con actor admin.

**Cron mensual.** 00:05 AR del día 1: `private.generate_pending_fees('cron')`
→ por cada período pendiente, lock + `insert … on conflict do nothing` en una
subtransacción → fila en `billing_runs` (`ok` con la cantidad, o `error` con
el mensaje y nada a medias). Sin `billing_start_period`: una fila `skipped`.
**Aviso**: `getBillingStatus().currentPeriodRun` en `failed` o `missing` →
el panel inicial y `/ajustes` muestran a los admins "No se generaron las
cuotas de <mes>" (con el error si lo hay) y "Reintentar" →
`generatePendingFees()` → toast con la cantidad creada; el aviso desaparece
cuando la última corrida del mes es `ok`. `/ajustes` lista además las últimas
corridas (fecha, disparada por, estado, cuotas creadas). `notified_at` queda
en null hasta que exista el job de avisos por mail (Fase 5).

**Registrar pago (socio).** Ficha (o `/cobranza` con el buscador) → "Registrar
pago" → `/cobranza/nuevo?socio=<id>` → `getPaymentFormData` → `PaymentForm`
con `batchId` nuevo, monto precargado (D12), chips, fecha hoy (zona club),
medio, comprobante opcional (subida directa D23), notas → `registerPayment`
→ `requireRole('admin','editor')` → Zod → `objectExists` si hay comprobante →
`registerPayments` (una fila) → éxito: vuelve a la ficha con toast "Pago de
$X registrado. Ahora debe $Y / está al día / tiene saldo a favor de $Z"
(el texto lo arma la vista con la cuenta recargada). Reintento con el mismo
`batchId` → "El pago ya estaba registrado" (éxito).

**Registrar pago (grupo).** Ficha de un integrante → "Pago del grupo" →
`/cobranza/nuevo?grupo=<id>` → lista de integrantes con checkbox (marcados por
defecto los activos), cuota precargada y editable por fila, total abajo → un
solo `registerPayment` con N `items` y el mismo `batchId` → una sentencia →
toast con el total y vuelta a la ficha de origen.

**Anular pago.** Admin en la ficha o en `/cobranza/pagos` → "Anular" →
`ReasonDialog` (motivo obligatorio; consecuencia: "El pago deja de contar para
la deuda. Queda registrado como anulado, con tu nombre y el motivo") →
`voidPayment` → `requireRole('admin')` → UPDATE de las tres columnas → el
trigger valida → revalidación. El pago sigue en el historial tachado, con
motivo y quién anuló.

**Saldo de arranque.** Ficha → "Cargar saldo anterior" (solo si no hay uno
vigente y la facturación está activa; si no, el botón explica) → monto +
descripción opcional → `createOpeningBalance` → INSERT `kind =
'opening_balance'` → el trigger fija el período → aparece primero en el
estado de cuenta.

**Panel inicial.** `getDashboard()` → una page, cuatro RPCs en paralelo →
`DashboardView`: tarea del día (buscador + acciones por rol), Este mes,
Deuda, Evolución (recharts con tabla equivalente), Padrón. Con
`billing_active = false`: "Las cuotas todavía no están activadas" con link a
Ajustes para admin y texto neutro para el resto; los paneles de dinero se
muestran en cero explicado, no se ocultan.

### 8.4 Lo que va en Postgres vs. TypeScript

Postgres: valores de cuota append-only y su precedencia; congelamiento y
trazabilidad del monto; unicidad de cuota por mes y de saldo de arranque
vigente; idempotencia de la generación (índice + lock); período del saldo de
arranque; reglas de activación; anulación una vez y solo admin; comprobante
una vez; inmutabilidad de montos, fechas, medio y lote; `paid_on` no futura;
idempotencia del submit (`(batch_id, member_id)`); toda agregación (cuenta,
statement, cobranza, panel, historia, por categoría); auditoría y actor.
TypeScript: Zod de entrada, mensajes de dominio, orquestación (activar +
generar, subir + confirmar comprobante, lote de N filas), pertenencia al grupo
de los ids del lote (conveniencia, no invariante), URLs firmadas,
revalidación, navegación por rol.

## 9. Transversales

**Autorización.** Cada page/controller de lectura nuevo:
`requirePanelPermission('payments.read')` (cobranza, listados),
`requirePanelPermission('reports.read')` (panel), `('billing.configure')`
(lecturas de corridas; `/ajustes` sigue además detrás del layout `(admin)`
del slice 1); cada action nueva: `requirePermission(...)` con el permiso de
§6.7/§6.8. La page `/` no exige permiso (es a donde se redirige): cada
sección se renderiza según `session.permissions`. Defensa real: policies +
triggers con `private.can` (dentro del trigger de anulación, porque el grant
de columna es todo-o-nada). SECURITY DEFINER nuevas en `public`:
`generate_pending_fees`, `log_export`, `my_permissions`; todas con `revoke
from public, anon` y chequeo en el cuerpo (o sin efecto de escritura, en el
caso de `my_permissions`).

**Auditoría y actor.** D21. Prueba en `tests/db/`: fila por cada operación
con el actor esperado; cron `system`; RPC `session`; `UPDATE` sin cambio no
registra.

**Nada se borra.** Sin DELETE para `authenticated` ni `service_role` en las
tres tablas; `fee_prices` sin UPDATE; anulación con motivo y actor; el
comprobante no se reemplaza. UI: nunca "eliminar"; "Anular pago", "Anular
cuota", "Anular saldo anterior".

**Dinero y cuotas.** Centavos; `AmountField` parsea "10.000" y "10.000,50";
la suma del lote se muestra con `formatCentsCompact`; totales solo de RPC.
Períodos: `private.club_today()` en la base, `toPeriod()`/`toClubDate()` en
TS; el cron a 03:05 UTC; **test de borde**: a las 23:30 del 30/09 hora AR
(02:30 UTC del 01/10) el período actual sigue siendo septiembre.

**Datos personales.** Comprobantes en el bucket privado, URL firmada de 60 s
solo cuando alguien toca "Ver comprobante" (el listado de pagos del mes no
firma 200 URLs por render: el controller expone `getReceiptUrl(paymentId)`
y la vista lo pide al abrir); listados muestran nombre y deuda (necesario);
logs con ids y montos, nunca nombres; los seeds usan socios inventados.

**Fallas y recuperación.** Cron que falla → fila `error` en `billing_runs` +
aviso a admin + "Reintentar" (genera todo lo pendiente). Cron que **no
corre** (pg_cron caído, job borrado) → no hay fila del mes → `missing` →
mismo aviso. Generación con precio faltante → subtransacción revertida,
fila `error` con el mensaje, cero cuotas a medias. Doble submit → índice único → éxito idempotente. Lote
parcial → imposible (una sentencia). Comprobante subido sin confirmar →
huérfano (script). Anular dos veces → el trigger rechaza → `DomainError("El
pago ya está anulado")`. Pago a socio inexistente → FK → error genérico.
Activación con mes pasado / sin precio / dos veces con cuotas → `DomainError`
del trigger, traducidos en el modelo. Cambio de valor para un mes generado →
`DomainError` con `field: 'validFrom'`. `member_accounts` a 1.000 socios →
`range` por páginas, nunca un `select` a ciegas.

**Migraciones.** Tres migraciones aditivas (`0005_billing`, `0006_payments`,
`0007_accounts`), idempotentes donde Postgres lo permite; `cron.unschedule`
antes de `cron.schedule` para poder re-aplicar; ninguna toca datos de las
tablas del slice 1 salvo el trigger nuevo en `settings`. Reversa documentada
en el encabezado (drop de tablas/funciones/jobs). `db:types` después.
Advisors (`supabase db lint` / advisors del MCP si conecta) al cerrar la lane
de schema.

**Cache y revalidación.** Pages dinámicas. Actions revalidan: pagos y
anulaciones → `/`, `/cobranza`, `/cobranza/pagos`, `/cobranza/deuda`,
`/cobranza/al-dia`, `/cobranza/por-categoria`, `/socios`, `/socios/[id]`;
valores de cuota y activación → `/ajustes`, `/`, `/cobranza`, `/socios/[id]`
(precarga). Simplificación aceptable: `revalidatePath('/', 'layout')` en las
actions de pagos y de facturación, porque casi todo el panel depende de la
deuda.

**Portal del socio (Fase 2), sin construirlo.** `member_accounts` y
`member_fee_statement` son SECURITY INVOKER: cuando exista el rol `socio`,
una policy de SELECT en `fees`/`payments` por `member_id` propio alcanza para
que vea su cuenta con las mismas funciones. No hay nada que rehacer.

## 10. Superficies (briefs)

`route.md` ya trae **Panel inicial** y **Registrar pago** confirmados. Este
pipeline escribe `.impeccable/surfaces/route-cobranza.md` (hub, registrar,
pagos del mes, listados). Las adiciones a superficies existentes van acá y
los agentes de F2/F4 las tratan como brief (el hilo principal puede pegarlas
en `route-socios-id.md`, `route-socios.md` y `route-ajustes.md`):

- **Ficha del socio (`/socios/[id]`), slice 2.** Arriba del todo, debajo del
  encabezado, el **estado de cuenta**: una línea grande y clara — "Al día",
  "Debe $30.000 · 3 meses (desde julio 2026)" o "Saldo a favor $10.000" —,
  último pago (fecha y monto), y la acción primaria **"Registrar pago"**
  (admin/editor) con "Pago del grupo" secundaria si tiene grupo. Debajo,
  `Panel` "Cuotas": lista de períodos del más nuevo al más viejo con monto y
  estado (Pagada / Parcial: $X de $Y / Adeudada / Anulada), el saldo
  anterior al sistema como primer ítem histórico; `Panel` "Pagos": fecha,
  monto, medio, quién lo cargó, comprobante (link que firma al abrir),
  anulado tachado con motivo; "Anular" solo admin en cada pago y cuota;
  "Cargar saldo anterior" cuando aplica. Con la facturación inactiva: una
  línea "Las cuotas todavía no están activadas" y nada de deuda. Estados:
  cargando, error, socio de baja con deuda (la línea lo dice), sin cuotas
  aún ("Todavía no tiene cuotas generadas").
- **Padrón (`/socios`), slice 2.** El filtro "Deuda" se habilita (Todos /
  Al día / Con deuda); cada fila suma `DebtStatusPill` y, con deuda, "N
  meses · $X" en meta con numerales tabulares; con saldo a favor, "Saldo a
  favor $X". Con la facturación inactiva el filtro sigue deshabilitado con el
  mismo texto de hoy.
- **Ajustes (`/ajustes`), slice 2.** Sección **"Cuotas"**: estado (no
  activadas → explicación + "Activar cuotas"; activadas desde <mes>, último
  mes generado, "Generar cuotas ahora" si hay pendientes, con la cantidad);
  **aviso de corrida fallida o ausente** del mes en curso (T1): texto
  "No se generaron las cuotas de <mes>" con el motivo si lo hay y botón
  "Reintentar"; debajo, "Últimas corridas" plegado (fecha y hora, cron o el
  nombre del admin, estado con texto, cuotas creadas).
- **Panel inicial (`/`), slice 2, adición a `route.md` (T1):** arriba de
  "Este mes", solo para admin y solo cuando `currentPeriodRun` es `failed` o
  `missing`, un aviso de una línea con el mismo texto y "Reintentar" (o link a
  Ajustes); nunca un banner permanente.
  Sección **"Valores de cuota"**: los valores vigentes (Por defecto; por tipo
  de socio; por categoría, agrupadas por disciplina) como filas
  etiqueta/valor con "desde <mes>", botón "Nuevo valor" → sheet con scope,
  monto (`AmountField`), "Aplica desde" (select de meses: el actual solo si
  no se generó, y los 12 siguientes), texto que explica la precedencia
  ("Si un socio tiene valor por categoría, gana sobre el de tipo y el
  general"); historia plegada. Errores del trigger inline bajo "Aplica
  desde". Sin valor por defecto: `EmptyState` que enseña el orden de carga
  (D18).

Todas mobile first a 390 px, una mano, targets 44 px, sin tarjetas anidadas,
sin métrica-héroe, montos tabulares sin decimales, estados de carga/vacío/
error, copy en rioplatense ("Registrar pago", "Anular", nunca "Eliminar").

## 11. Preguntas y decisiones

### Para Tomás — respondidas (2026-09-27)

| # | Pregunta | Respuesta | Impacta |
|---|---|---|---|
| T1 | Cadencia de la generación | **Cambio: una vez por mes, el día 1 (00:05 AR = `5 3 1 * *` UTC); cada corrida registrada en `billing_runs` (append-only, no auditada, con `notified_at` como gancho para avisos por mail); aviso visible a admin en el panel y en `/ajustes` cuando la corrida del mes falló o no corrió, con "Reintentar" que genera todo lo pendiente** | §4.3, §6.4, §6.7, D18, §8.3, §10, S1, SH1, B1, F3, F4 |
| T2 | `batch_id` obligatorio en todo pago, generado por el formulario, como idempotencia del submit | **Confirmado** | D22, S2, B2, F1 |
| T3 | Los cuatro listados del contrato viven en `/cobranza`; `/reportes` (slice 3) es el índice exportable | **Confirmado** | D26, F1 |
| T4 | Índice único de cuota mensual **incluye** las anuladas (anular = definitivo) | **Confirmado** | §4.6, S1 |
| T5 | `billing_start_period` escritura única (cambiable solo sin cuotas), mes actual o futuro, exige valor por defecto | **Confirmado** | D18, S1, B1 |
| T6 | Rechazar un valor de cuota para un mes ya generado (trigger) | **Confirmado** | D17, S1 |
| T7 | Campos calculados de PostgREST para el filtro de deuda del padrón | **Confirmado** | D24, S3, B3 |
| T8 | Deuda al cierre reconstruida con la población activa **de ese mes** | **Confirmado** | D16, S3 |
| T9 | KPIs sobre socios activos; deuda de bajas aparte con link | **Confirmado** | D14, F3 |
| T10 | Crear `log_export` ahora como gancho | **Confirmado** | S3 |
| T11 | `revalidatePath('/', 'layout')` en actions de pagos/facturación | **Confirmado** | B1, B2 |
| T12 | Roles configurables (pipeline posterior) | **Decisión: catálogo de 12 permisos definido ahora; toda regla nueva chequea permisos (`private.can`, `my_permissions`, `requirePermission`/`requirePanelPermission`, `SessionInfo.permissions`); el slice 1 sigue con `has_role` como deuda documentada; mañana `roles`/`role_permissions` sin cambiar firmas** | §6.7, §6.8, D20, §8.2, §9, S1, SH1, B1–B3, F1–F4 |

### Para la Comisión — pendientes (se sigue con los defaults recomendados, confirmado por Tomás)

Bloque listo para mandar, continúa la numeración del slice 1 (las 1–9 de
aquel bloque siguen pendientes; la 3 —lo más viejo primero— y la 7 —no
practicantes pagan lo mismo— son las que más pesan acá):

```
Hola Comisión. Para la parte de cuotas y pagos necesito que definan estas
cinco cosas más. Al lado va lo que propongo; si no me dicen nada, seguimos
con eso.

10. Mes de alta. Si alguien se hace socio el 20 del mes, ¿paga la cuota de
    ese mes completa?
    → Propuesta: sí, se cobra el mes entero (como en las planillas). Lo
    mismo cuando un socio vuelve después de una baja.

11. Mes de baja. Si a alguien se le da de baja el 10, ¿se le cobra la cuota
    de ese mes?
    → Propuesta: la cuota ya generada queda; si deciden no cobrarla, un
    administrador la anula con el motivo y queda registrado.

12. Deuda de los que se fueron. Cuando dan de baja a alguien que debe, ¿esa
    deuda se sigue reclamando (por ejemplo si quiere volver)?
    → Propuesta: la deuda queda en su ficha y se puede cobrar; en el panel
    se muestra aparte de la deuda de los socios activos.

13. Pagar por adelantado. ¿Puede un socio pagar meses que todavía no se
    generaron (por ejemplo, tres meses juntos en septiembre)?
    → Propuesta: sí; queda como "saldo a favor" y se va descontando de las
    cuotas siguientes.

14. Comprobante de transferencia. ¿Quieren que sea obligatorio adjuntarlo
    cuando el pago es por transferencia, u opcional?
    → Propuesta: opcional (la propuesta aceptada dice "posibilidad de
    adjuntar"), para no frenar la carga cuando no tienen el comprobante a
    mano.
```

Mapa a las decisiones: 10 → D18 (población del generador), 11 → D18/anular
cuota, 12 → D14, 13 → D13, 14 → D23 (un `refine` de Zod si cambia). Ninguna
respuesta obliga a rehacer el schema: 10 y 11 son un `where`; 12 y 13 son UI;
14 es validación.

## 13. Revisión 3 — un socio en varios deportes (2026-09-27)

### 13.1 Qué cambió y qué hay

Tomás decidió que **un socio puede estar en más de un deporte/categoría**,
que **paga una cuota por cada deporte** (la suma), que el **no practicante
paga una sola cuota social sin categoría**, y que en **listados y KPIs por
categoría el socio aparece en cada una de sus categorías**, con la deuda por
categoría calculada desde los cargos de esa categoría para que la suma no se
duplique.

Estado real: el slice 1 está implementado con `members.category_id` (una
categoría), el CHECK `members_practicing_has_category` (practicante ⇔
categoría), el índice `members_category_id_idx`, `search_text` sin categoría,
y el padrón filtra por `category_id`/`discipline_id` con `eq`/`in`. Las tres
migraciones del slice 2 (`20260927130000_billing.sql`,
`130100_payments.sql`, `130200_accounts.sql`) están aplicadas en local **y no
commiteadas**: `fee_price_for(category_id, member_type, period)`,
`generate_monthly_fees` (un `cross join lateral` por socio),
`member_balance`, `member_accounts` (devuelve `category_id`/`category_name`),
`debt_by_category` (agrupa por `members.category_id`), `dashboard_summary`
(cuenta reactivaciones como altas) y el índice único
`fees_one_monthly_per_period (member_id, period) where kind = 'monthly'`
asumen una sola categoría. Se reescriben. Una migración nueva del socio corre
**antes** (`20260927125000_member_categories.sql`), y como la base local ya
tiene las tres aplicadas, el hilo principal hace `db:reset` después de
reescribirlas.

**Una precisión que cambia el índice único (T21).** "Una cuota por cada
deporte": el deporte es la **disciplina** (fútbol masculino, fútbol femenino,
vóley); la categoría es la franja dentro del deporte (5ta, 6ta, Sub 18). Un
chico que sube de 5ta a 6ta a mitad de mes **no** juega dos deportes: si el
cargo fuera por (socio, período, categoría), el ascenso del día 15 generaría
en la corrida siguiente una segunda cuota de ese mes. Por eso el cargo es
**por (socio, período, deporte)**, con la **categoría congelada en el cargo**
(precio, trazabilidad y "deuda por categoría"). Con una sola inscripción
abierta por deporte (invariante de la base), "por categoría" y "por deporte"
coinciden en todo salvo en el mes del ascenso, que es exactamente el caso
que hay que proteger.

### 13.2 Schema del socio (migración nueva, lane `schema`, S0)

**`member_categories`** — pertenencia con historia (intervalos, nada se
borra): `id`, `member_id` FK (índice), `category_id` FK (índice), `joined_on
date not null` (alta en la categoría), `left_on date null` (baja en la
categoría; abierta mientras es null), `left_reason text null`, `created_by
uuid default auth.uid()`, `created_at`, `left_by uuid null`, `left_at
timestamptz null`. CHECKs: `left_on is null or left_on >= joined_on`;
`(left_on is null) = (left_by is null) = (left_at is null)`. Índices: unique
parcial `(member_id, category_id) where left_on is null` (una inscripción
abierta por categoría), parcial `(member_id) where left_on is null`, parcial
`(category_id) where left_on is null`, btree `(member_id, joined_on)`.
Triggers: `protect_immutable_columns('member_id','category_id','joined_on',
'created_by','created_at')`; BEFORE INSERT: el socio existe (`for update`,
serializa), `joined_on >= members.joined_on`, `joined_on <= club_today()`,
la categoría está activa, y **no hay otra inscripción abierta en la misma
disciplina** (join a `categories`; mensaje "Ya está inscripto en <deporte>
(<categoría>); dalo de baja de esa categoría primero o usá el cambio de
categoría"); BEFORE UPDATE: solo `left_on`/`left_reason` de null a valor,
una vez, `left_on <= club_today()`, fija `left_by = auth.uid()`, `left_at =
now()`. AFTER INSERT/UPDATE: recalcula `members.member_type` (§13.2, D28).
`enable_audit`. RLS (regla nueva → permisos): SELECT `can('members.read')`,
INSERT y UPDATE `can('members.write')`; grants insert (`member_id,
category_id, joined_on`), update (`left_on, left_reason`); sin DELETE.

**`members`**: se **elimina `category_id`** (con su índice, su FK y el CHECK
`members_practicing_has_category`) después de migrar los datos: `insert into
member_categories (member_id, category_id, joined_on) select id,
category_id, joined_on from members where category_id is not null` (corre
como `postgres`: auditoría `system`). `member_type` **se conserva como
columna** pero pasa a ser **derivada y escrita solo por trigger** (como
`status`, D2): `practicing` ⇔ existe al menos una inscripción abierta;
default `non_practicing`; **sale de los grants de INSERT/UPDATE** de
`authenticated` (comentario en la columna). Índice parcial `(member_type)
where member_type = 'practicing'` (opcional; el filtro del padrón lo usa).
`search_text` no cambia (no incluye categoría). El resto de `members`,
`member_status_events`, `family_groups`, `medical_clearances` no se toca.

**RPC `public.set_member_categories(target_member_id bigint, category_ids
bigint[], effective_on date default null)`** (SECURITY INVOKER, `revoke from
public, anon`, `grant to authenticated`; en el cuerpo `can('members.write')`):
en una transacción, cierra con `left_on = effective_on` las inscripciones
abiertas cuya categoría no está en la lista y abre con `joined_on =
effective_on` las de la lista que no están abiertas; `effective_on` default
`club_today()`. Rechaza dos categorías de la misma disciplina en la lista
("Elegí una sola categoría por deporte"). La alta la usa con `effective_on =
joined_on` del socio; la edición, con hoy (o la fecha que elija quien edita:
"a partir de"). Es el mismo patrón que `set_family_payment_responsible`.
`left_reason` es opcional y solo se carga desde la ficha ("Dar de baja de
<categoría>", con motivo opcional); el cambio masivo del formulario no pide
motivo.

**Padrón y filtros.** `searchMembers` filtra por categoría/disciplina con un
embed interno: `member_categories!inner(category_id, left_on, categories(name,
discipline_id, disciplines(name)))` + `.eq('member_categories.category_id',
X)` (o `.in(...)` con las categorías de la disciplina) + `.is(
'member_categories.left_on', null)`; PostgREST devuelve un socio por fila
aunque coincidan dos categorías (el embed es un array anidado), así que el
keyset no cambia. Para la lista se usa el mismo embed **sin** `!inner` y con
el `left_on is null` en el select (`member_categories(…)` con filtro
`left_on=is.null` sobre el embed) y cada fila muestra sus categorías como
"Fútbol masculino · 5ta, Vóley · Sub 18". `memberType` sigue filtrando por la
columna. `MemberSummary.categoryName/disciplineName` → `categories:
MemberCategoryRef[]`; `MemberDetail` suma `categories` (abiertas) y
`categoryHistory` (todas, con fechas).

**Ajustes**: desactivar una categoría con socios cuenta inscripciones
abiertas (`catalogs.model.setCategoryActive`), no `members.category_id`.
Trigger BEFORE INSERT de `member_categories` rechaza categorías inactivas.

### 13.3 Cuotas (cambios a S1)

- `fees` suma `category_id bigint null` FK y `discipline_id bigint null` FK
  (ambos con índice), CHECK `(kind = 'monthly' and ((category_id is null) =
  (discipline_id is null))) or (kind <> 'monthly' and category_id is null and
  discipline_id is null)`; `discipline_id` se copia de la categoría al
  generar (frozen: si mañana una categoría cambia de disciplina, el cargo
  viejo no se mueve). Ambas inmutables.
- **Índice único: `(member_id, period, discipline_id) nulls not distinct
  where kind = 'monthly'`** (Postgres 15+; el cluster es 17). Con
  `discipline_id` null (cuota social) `nulls not distinct` hace que dos
  sociales del mismo mes choquen. Incluye anuladas (T4). `on conflict
  (member_id, period, discipline_id) where kind = 'monthly' do nothing`.
- Precio: `fee_price_for(category_id, 'practicing', P)` por cada deporte
  (categoría > tipo practicante > default); `fee_price_for(null,
  'non_practicing', P)` para la social. La tabla `fee_prices` no cambia.
- `description`: "Cuota 09/2026 · 5ta" / "Cuota social 09/2026".
- Saldo de arranque: sigue siendo **uno por socio**, sin categoría.

### 13.4 Generación, entradas y salidas a mitad de mes, precarga

**Población de `generate_monthly_fees(P)`** (todo en una sentencia, o
ninguna fila):
1. Para cada socio `active` con `joined_on <= fin(P)` y para cada
   **deporte** en el que tuvo al menos una inscripción que **solapa P**
   (`joined_on <= fin(P) and (left_on is null or left_on >= inicio(P))`): un
   cargo con la categoría de la inscripción **más reciente** de ese deporte
   dentro de P (mayor `joined_on`, luego id) y su precio.
2. Para cada socio `active` con `joined_on <= fin(P)` **sin ninguna
   inscripción que solape P**: un cargo social (`category_id` null).
3. **Regla de exclusión por período (D30):** no se crea un cargo social en P
   si ya existe (anulado o no) un cargo por deporte en P para ese socio, ni
   un cargo por deporte si ya existe la social. "Lo que se generó primero
   queda": el no practicante que se inscribe el 15 pagó la social ese mes y
   empieza a pagar por deporte el mes siguiente; el practicante que deja
   todo el 15 pagó su deporte ese mes y la social desde el siguiente. Sin
   esta regla la corrida del 1° siguiente (que recorre el mes anterior) le
   cobraría dos veces el mes de transición.
4. El índice único absorbe el resto: el ascenso 5ta→6ta el 15 no genera una
   segunda cuota de fútbol; un segundo deporte inscripto el 20 **sí** genera
   su cuota de ese mes en la corrida siguiente o con "Generar cuotas ahora"
   (mes de alta completo, D18, pregunta 16 a la Comisión). Salir de un
   deporte el 10 no anula su cuota ya generada (pregunta 11).

Falta de precio: el chequeo previo recorre deportes y sociales; el mensaje
nombra la categoría o "Cuota social", nunca al socio. Todo lo demás de §6.4
(subtransacción por período, `billing_runs`, cron `5 3 1 * *`, aviso) queda
igual. **Contrato real de `public.generate_pending_fees()`**: devuelve una
fila `(status text, fees_created int, error_message text)`; **no relanza**
(relanzar revertiría la fila de `billing_runs`); la action mapea `error` →
`DomainError(error_message)` y `skipped` → mensaje informativo.

**Precarga del pago (D12 revisada).** `member_accounts.current_fee_cents` =
suma de sus cargos mensuales no anulados del período actual (todos los
deportes, o la social); si todavía no se generaron, la suma de los precios
resueltos para sus inscripciones abiertas hoy (o la social si no tiene).
Suma además `current_fees jsonb` = `[{category_id, category_name,
discipline_name, amount_cents}]` (con `category_id` null y nombre "Cuota
social") para que el formulario muestre "Cuota de septiembre: $20.000 (Fútbol
masculino · 5ta $10.000 + Vóley · Sub 18 $10.000)". Los chips "1 / 2 / 3
meses" multiplican la suma; "Toda la deuda" no cambia.

### 13.5 Deuda: por socio y por categoría (cambios a S3)

El balance forward **sigue siendo por socio**: un pago no se asigna a una
categoría, y `member_balance`, `member_debt_status`, `monthly_history`,
`dashboard_summary.total_debt_cents` no cambian de semántica.

**Atribución a cada cargo** (D31): `private.member_fee_coverage(member_id)`
devuelve cada cargo no anulado del socio con `covered_cents` usando **la
misma cobertura oldest-first del statement** (orden `period`, saldo de
arranque antes que las cuotas del mismo mes, luego `discipline_id` nulls
first, luego id) y `uncovered_cents = amount − covered`. Es la función que
`member_fee_statement` ya calcula, extraída para reutilizarla. Por
construcción, `sum(uncovered) = greatest(0, balance)` para cada socio, así
que **la suma de todas las categorías + cuota social + saldo anterior = la
deuda total** sin duplicar, y un socio con saldo a favor aporta 0.

**`debt_by_category()`** devuelve, para socios activos:
- una fila por **categoría** (`kind = 'category'`): `members` = socios con
  inscripción abierta en esa categoría hoy (el socio aparece en cada una de
  las suyas), `members_in_debt` y `debt_cents` = socios y suma de
  `uncovered` de los cargos **atribuidos** a esa categoría;
- una fila `kind = 'social'` ("Cuota social · no practicantes"): `members`
  = activos sin inscripción abierta; deuda = `uncovered` de los cargos
  sociales;
- una fila `kind = 'opening_balance'` ("Saldo anterior al sistema"): deuda =
  `uncovered` de los saldos de arranque; `members` = socios con saldo
  anterior sin cubrir.
Atribución de un cargo por deporte a una categoría (D32, **decidido por
Tomás 2026-09-27: opción (a)**): **la categoría congelada en el cargo**, la
verdad documental. Si un chico subió de 5ta a 6ta, la deuda de los meses en
5ta sigue contando en 5ta y la de los meses en 6ta en 6ta; `members` sigue
siendo el plantel de hoy, así que una categoría puede mostrar deuda con menos
socios actuales que `members_in_debt`. Es esperado y la vista lo explica.
Ordenado por disciplina/categoría y
las dos filas especiales al final. `DebtByCategoryRow` suma `kind` y
`disciplineId`, y `categoryId` es null en las especiales. El listado
`/cobranza/deuda?categoriaId=` filtra `member_accounts` por inscripción
abierta (`category_filter`), y muestra la deuda **total** del socio (la
atribución por cargo es para el KPI; a la persona se le reclama todo).

`member_accounts` reemplaza `category_id/category_name/discipline_name` por
`categories jsonb` (`[{category_id, category_name, discipline_id,
discipline_name}]`, abiertas) y agrega `category_filter bigint default null`
(socios con inscripción abierta en esa categoría). Los campos calculados de
`members` no cambian.

`dashboard_summary`: `admissions_count` pasa a contar **solo** `admission` y
se agrega `reactivations_count` (review B6); el panel muestra "Altas · N
(+M reactivaciones)".

### 13.6 UI afectada del slice 1 y del slice 2

Slice 1 (ya construido, cambia):
- **Ficha de ingreso y edición (`/socios/nuevo`, `/socios/[id]/editar`)**:
  desaparece el selector "practicante / no practicante" y el par disciplina →
  categoría; en su lugar, la sección **"Deportes y categorías"**: lista de
  checkboxes agrupada por disciplina (una sola categoría por deporte: dentro
  de cada disciplina se comporta como radio con opción "ninguna"), con el
  texto "Si no practica ningún deporte, queda como socio no practicante y
  paga la cuota social". En edición, cambiar la selección pide "a partir de"
  (default hoy) y explica la consecuencia ("Deja de generar cuota de <deporte>
  desde el mes siguiente; la cuota de este mes queda" / "Empieza a pagar
  <deporte> desde este mes"). El brief `route-socios-nuevo.md` se actualiza
  en la sección "Resultado y prueba" con esto (lo hace el hilo principal o
  F2 en su dev log).
- **Ficha (`/socios/[id]`)**: encabezado con las categorías abiertas como
  texto ("Fútbol masculino · 5ta, Vóley · Sub 18" o "No practicante");
  `Panel` "Deportes" con las inscripciones abiertas (desde <fecha>) y acción
  "Dar de baja de <categoría>" (motivo opcional, `ReasonDialog` con fecha) y
  "Cambiar de categoría" (cierra y abre en la misma disciplina, misma fecha),
  más la historia plegada (categoría, desde, hasta, motivo, quién).
- **Padrón (`/socios`)**: la columna/meta de categoría muestra la lista; los
  filtros de categoría y disciplina siguen igual para el usuario; el filtro
  de tipo también.
- **Ajustes**: sin cambio visible (el conteo de socios al desactivar usa las
  inscripciones).

Slice 2 (aún no construido, ajusta el spec):
- Formulario de pago: desglose de la cuota del mes por deporte (§13.4).
- `/cobranza/por-categoria`: filas por categoría más "Cuota social" y "Saldo
  anterior"; el total al pie coincide con "Deuda total" del panel (test).
- Panel: "Socios y deuda por categoría" con las mismas filas; "Altas" con
  reactivaciones aparte.
- `/cobranza/deuda?categoriaId=`: filtra por inscripción abierta.

### 13.7 Minors del code review del slice 1 (tercera pasada, B) incorporados

- **B2** (anular cargo como `editor` es un "0 filas" mudo): se mantiene la
  policy estricta (`payments.void`) por mínimo privilegio, y la action
  `voidFee` encadena `.select('id').maybeSingle()` y trata 0 filas como
  `DomainError('No se pudo anular el cargo: no existe o no tenés permiso')`
  (D33, opción action; la alternativa de alinear la policy con `payments`
  daría UPDATE a `editor` sobre `fees` sin ningún uso legítimo).
- **B3**: `payments_update_guard` rechaza adjuntar comprobante si `old.voided_at
  is not null` o si se anula en la misma sentencia ("Un pago anulado no
  lleva comprobante").
- **B4**: `settings_billing_guard`, `fee_prices_insert_guard` y
  `fees_opening_balance_guard` pasan a **SECURITY DEFINER** (viven en
  `private`, sin EXECUTE para PUBLIC): la invariante no depende de la RLS de
  quien escribe. Lo mismo para el trigger nuevo de `member_categories`.
- **B5**: `log_export` valida `listing` contra una lista cerrada —
  `'members'`, `'debt'`, `'up_to_date'`, `'debt_by_category'`,
  `'month_payments'`, `'audit'` (el slice 3 la extiende con un `ALTER` del
  CHECK o de la constante) — y rechaza `filters` de más de 4 KiB
  (`pg_column_size`).
- **B6 nits**: se elimina `payments_batch_id_idx` (prefijo de la unique);
  `fees_member_not_voided_idx` se elimina también (cubierto por
  `fees_member_period_idx`); `admissions_count` solo altas +
  `reactivations_count` (§13.5); `AUDITED_TABLES` del modelo y de la page de
  `/auditoria` incluyen `member_categories`, `fee_prices`, `fees`, `payments`
  (el blocker B1 lo cierra el hilo principal; el plan lo asume cerrado);
  `buildLabelDraft` para las cuatro tablas nuevas es trabajo de B2/B3.

### 13.8 Decisiones que están en curso en otro agente (para no contradecirlas)

- **Navegación inferior móvil** (regla de Tomás): **máximo 5 ítems**,
  ordenados por importancia creciente hacia la derecha; "Más" solo aparece
  cuando hay más de 5 destinos y se lleva los menos importantes. Importancia:
  Socios > Cobranza > Inicio > Usuarios > Ajustes > Auditoría. Con Cobranza
  activa, admin ve `Más (Ajustes, Auditoría) · Usuarios · Inicio · Cobranza ·
  Socios`; editor y consulta ven `Inicio · Cobranza · Socios`. El agente de
  frontend actual implementa el algoritmo (orden + armado de "Más") y deja
  **un flag** para Cobranza; en este slice, F3 **solo prende ese flag** en
  `views/shell/**` cuando `/cobranza` existe. No rediseña nada de la barra.
- **`ResponsiveSheet`** (abajo en móvil, diálogo en desktop) en
  `views/shared/`: F4 lo usa para "Nuevo valor de cuota" y "Activar cuotas";
  F1 para "Anular" no (sigue `ReasonDialog`) y para el comprobante no.
- **El inicio actual se reemplaza entero** por el panel de KPIs (F3). Tomás
  pidió definirlo con `/impeccable`: F3 **arranca con la ronda de
  composición de impeccable** (scope *surface*, dentro del mundo canon ya
  elegido; **no** vuelve a correr la ronda de dirección) con el brief de
  `route.md` como insumo, y recién después construye.

### 13.9 Decisiones nuevas (opciones y recomendación)

**D27. Modelo de pertenencia.** *(a)* **Filas-intervalo `member_categories`
(`joined_on`/`left_on`)** — recomendada: "inscripciones abiertas" es un
`where left_on is null` indexado, la historia queda en las mismas filas, y
el generador consulta solapes con dos comparaciones. *(b)* Tabla de eventos
join/leave como `member_status_events`: uniforme con lo que hay, pero
"categorías actuales" exige el último evento por (socio, categoría) en cada
query y en RLS. *(c)* `category_ids bigint[]` en `members`: sin historia,
sin FK, sin fechas. Descartadas b y c.

**D28. `member_type`.** *(a)* Declarado por el usuario + trigger que exige
coherencia: el alta (socio primero, categorías después) rompe la coherencia
en el medio. *(b)* Derivado en cada query (sin columna): el filtro del
padrón, `fee_price_for` y los índices lo pierden. *(c)* **Columna
materializada por trigger, sin grant de escritura** — recomendada: mismo
patrón que `status` (D2); la base es la única escritora y la invariante
"practicante ⇔ inscripto" no puede romperse desde la app.

**D29. `members.category_id`.** *(a)* **Eliminarla** — recomendada: una
fuente de verdad; el padrón embebe las inscripciones. *(b)* Conservarla como
"categoría principal" cache: dos verdades, y "principal" no significa nada
cuando paga por cada deporte. Descartada.

**D30. Transición practicante ↔ no practicante dentro de un mes.** *(a)*
Cobrar ambas (social + deporte) y que el admin anule una: trabajo manual
previsible cada vez. *(b)* **"Por período, o cuota social o cuotas por
deporte; la primera generada queda"** — recomendada: cero intervención, y el
mes de transición se cobra una vez, con lo que la persona era el día 1 (o el
día que se generó). *(c)* Prorratear: fuera del contrato y de las planillas.

**D31. Atribución de la deuda a cada cargo.** *(a)* **Cobertura
oldest-first del statement, extraída a `member_fee_coverage`** —
recomendada: una sola definición para la ficha y los KPIs; la suma cierra
por construcción. *(b)* Prorrateo proporcional del saldo entre los cargos
abiertos: dos definiciones (statement vs. KPI) que no coinciden. *(c)* Tabla
de imputaciones: es D3-B, descartada.

**D32. A qué categoría se atribuye un cargo por deporte.** *(a)* La
categoría congelada en el cargo: verdad documental, pero en enero "5ta"
muestra deuda de chicos que ya están en 6ta y 0 socios. *(b)* **La categoría
actual del socio en ese deporte, con la del cargo como respaldo** —
recomendada: el KPI habla del plantel de hoy, que es a quien se le reclama.
*(c)* Agrupar por disciplina: no es lo que dice el contrato ("por
categoría").

**D33. Policy de UPDATE de `fees` (review B2).** Action con `.select()` y 0
filas como error de dominio (recomendada, mínimo privilegio) vs. alinear la
policy con `payments`. Ver §13.7.

### 13.10 Preguntas

**Para Tomás (con lo recomendado se sigue):**

| # | Pregunta | Recomendación | Impacta |
|---|---|---|---|
| T13 | Pertenencia como filas-intervalo `member_categories` (D27) | Sí | S0, B3, F2 |
| T14 | `member_type` materializado por trigger, sin grant (D28) | Sí | S0, B3 |
| T15 | Eliminar `members.category_id` y el CHECK (D29) | Sí | S0 |
| T16 | Regla "social o por deporte, nunca ambas en un período; la primera queda" (D30) | Sí | S1 |
| T17 | Índice único `(member_id, period, discipline_id) nulls not distinct` | Sí | S1 |
| T18 | Filas "Cuota social" y "Saldo anterior" en deuda por categoría, total = deuda total | Sí | S3, F1, F3 |
| T19 | B2 del review: action con `.select()` en vez de policy alineada (D33) | Sí | B2 |
| T20 | RPC `set_member_categories` con diff atómico, una categoría por deporte | Sí | S0, B3, F2 |
| T21 | **El cargo es por (socio, período, deporte) con la categoría congelada**, no por categoría, para no cobrar dos veces el mes de un ascenso 5ta→6ta | Sí | S1, S3 |
| T22 | Deuda por categoría atribuida a la categoría **congelada en el cargo** (D32 a) | **Decidido: categoría del cargo** (Tomás, 2026-09-27) | S3, F1, F3 |

**Para la Comisión (bloque para agregar al de §11, sigue la numeración):**

```
15. Socio en dos deportes. Si alguien juega al fútbol y al vóley, ¿paga
    dos cuotas (una por cada deporte)?
    → Propuesta: sí, paga una cuota por cada deporte; si no practica
    ninguno, paga una sola cuota social.

16. Se suma a un deporte a mitad de mes. Si alguien que ya paga fútbol se
    anota en vóley el 20, ¿paga la cuota de vóley de ese mes completa?
    → Propuesta: sí, el mes de alta se cobra completo (como cuando entra
    al club). Subir de categoría dentro del mismo deporte (de 5ta a 6ta)
    no cobra nada extra.

17. Deja de practicar pero sigue de socio. Si alguien deja el fútbol pero
    sigue en el club, ¿pasa a pagar la cuota social (la de los no
    practicantes) desde el mes siguiente?
    → Propuesta: sí, automáticamente.
```

Mapa: 15 → D27/§13.4, 16 → §13.4 punto 4, 17 → D28/D30.

## 12. Resumen para aprobar

**Opción recomendada:** balance forward derivado (D3 confirmado) sobre
`fee_prices` append-only + `fees` congeladas + `payments` inmutables con
`batch_id` idempotente; generación **mensual el día 1** (00:05 AR) por
pg_cron de todos los períodos pendientes, **cada corrida registrada en
`billing_runs`**, con aviso a admin y "Reintentar" (RPC idempotente) cuando la
del mes falló o no corrió; activación de escritura única con reglas en
trigger; saldo de
arranque con período fijado por la base; saldo a favor consumido por las
cuotas siguientes y nunca mostrado como deuda negativa; toda agregación en
RPC `SECURITY INVOKER` (`member_accounts`, `member_fee_statement`,
`month_collection`, `dashboard_summary`, `debt_by_category`,
`monthly_history`); filtro de deuda del padrón por campos calculados de
PostgREST; **autorización por permisos** (catálogo de 12, `private.can`,
`my_permissions`, `requirePermission`; hoy mapeados fijos a los tres roles:
`editor` registra y adjunta, `admin` anula/configura/genera, `consulta` mira
y exporta); auditoría por triggers con `system` para el cron y `session`
para todo lo demás; **y desde la Revisión 3 (§13): un socio en varios
deportes** con `member_categories` (intervalos con historia, una inscripción
abierta por deporte), `member_type` derivado por trigger, **un cargo por
(socio, período, deporte)** con la categoría congelada, precarga = suma de
sus cuotas del mes, deuda por categoría atribuida cargo por cargo con la
cobertura del statement (suma = deuda total), y los minors B2–B6 del review
incorporados. **Aprobado por Tomás (2026-09-27)**: T13–T21 como se recomendaron; T22 con la categoría congelada en el cargo (D32 a).
