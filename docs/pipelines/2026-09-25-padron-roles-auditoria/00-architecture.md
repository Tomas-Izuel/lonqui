# 00 — Arquitectura: padrón, roles y auditoría (slice 1 de la Fase 1)

Pipeline: `2026-09-25-padron-roles-auditoria`. Estado: **propuesta revisada
con las respuestas de Tomás (T1–T8 confirmadas, ver §10); pendiente de
aprobación final**. Cero código, cero migraciones: este documento decide qué se
construye y con qué forma; `01-tasks.md` lo reparte.

Cambio de la revisión: **los usuarios nuevos no se invitan por mail**. El admin
crea el usuario con una contraseña temporal y el sistema obliga a cambiarla en
el primer login, con enforcement en RLS (D8). La Fase 1 queda **sin dependencia
de SMTP/Resend**.

---

## 1. Problema y contexto

El repo arranca vacío de dominio (solo scaffolding, `src/lib/` y configs) y
este es el primer pipeline de la Fase 1. Tiene que dejar **los cimientos** sobre
los que se apoyan los slices 2 (cuotas, pagos, estado de cuenta) y 3 (reportes,
panel, CSV):

1. Autenticación: login con email + contraseña, cierre de sesión, reseteo de
   contraseña. Sin registro público.
2. Roles y usuarios internos (`admin` / `editor` / `consulta`), helpers
   `private.*`, `/usuarios`, bootstrap del primer admin.
3. Auditoría append-only por triggers, actor desde `auth.uid()`, `/auditoria`.
4. Ajustes: disciplinas y categorías como datos, desde `/ajustes`.
5. Padrón: alta (ficha de ingreso), modificación, baja (ficha de egreso) y
   reactivación con fecha y motivo; practicante / no practicante; disciplina y
   categoría; grupo familiar con responsable de pago; apto físico de menores
   con vencimiento y certificado en bucket privado; búsqueda y filtros.
6. Shell del panel (navegación por rol, mobile-first) y **la dirección visual
   del producto**, decidida una sola vez acá.

Además, el **modelo de datos de toda la Fase 1** se diseña acá (incluidos
valores de cuota, cargos, pagos, saldo de arranque) para que el schema de este
slice no se rehaga después. Se construye solo lo del slice 1.

Restricciones que mandan (todas justificadas en `CLAUDE.md` y no se
re-derivan): un solo club sin `club_id`; MVC sobre App Router con lint que lo
hace mecánico; autorización real en RLS por rol; nada se borra; auditoría en
Postgres con actor `auth.uid()`; dinero en centavos enteros; datos personales
de menores (Ley 25.326); todo el panel es una superficie Operate para
voluntarios no técnicos que entran desde el celular.

## 2. Chequeo de alcance contra el contrato

| Punto del contrato | Cubierto en este slice |
|---|---|
| 2.1 Gestión de asociados (alta/modif/baja/reactivación con fecha y motivo, fichas, datos personales, practicante/no practicante, disciplina y categoría, grupo familiar con responsable, apto físico con adjunto, búsqueda y filtros) | Completo, salvo el filtro por **condición de deuda**, que queda preparado en el contrato de filtros y se activa en el slice 2 |
| 2.3 Roles, permisos y auditoría | Completo |
| 2.5 Acceso y plataforma (usuario y contraseña, responsive) | Completo |
| 2.2 Cuota social y estado de cuenta | **Solo el modelo de datos** (slice 2) |
| 2.4 Reportes y exportación | No (slice 3). La auditoría de exportaciones deja el gancho (`op = 'EXPORT'`) |
| 5. Carga inicial | Es del club, con los formularios del sistema. **No se escribe importador** |

Nada de lo pedido excede la Fase 1. Lo único que roza la Fase 2 es dejar la
tabla de roles preparada para `socio` sin rediseñar: se hace con un CHECK
extensible, no construyendo nada del portal.

## 3. Lo que hay hoy (Paso 0)

Relevado con `Read`, `Bash` (solo lectura) y `psql` dentro del contenedor
`supabase_db_lonqui`. **Las tools del MCP local (`mcp__supabase__*`) no
estaban expuestas en esta sesión** aunque el endpoint `http://127.0.0.1:54321/mcp`
responde y `npx supabase status` muestra el stack arriba; inspeccioné la base
por `docker exec ... psql`, que es equivalente para lo que hacía falta.

**Repo.** `src/models`, `src/controllers`, `src/services`, `src/views/shared`,
`src/emails` vacíos (solo `.gitkeep`). Existen y se reutilizan tal cual:
`src/lib/supabase/{client,server,admin}.ts` (los tres clientes; `server.ts`
trae `getCurrentUser` memoizado con `cache()`), `src/lib/{money,dates,errors,log,env.server,env.client}.ts`,
`src/proxy.ts` (solo refresca sesión con `getClaims()`), `src/app/{layout,page}.tsx`
provisorios, 19 componentes shadcn en `src/components/ui/` (alert-dialog, badge,
button, checkbox, dialog, dropdown-menu, field, input, label, popover, select,
separator, sheet, skeleton, sonner, table, tabs, textarea, tooltip). El
`eslint.config.mjs` ya hace mecánicas las reglas MVC. `vitest.config.ts` corre
en Node con `server-only` stubeado. `tests/` vacío. `scripts/db-reset.sh`
anticipa un bootstrap de usuarios de desarrollo al final. `.impeccable/` no
existe: no hay dirección visual ni briefs; `globals.css` tiene el tema neutro de
shadcn y la tipografía es la provisoria (Geist).

**Base local** (Postgres 17.6, CLI 2.118.0): cero tablas en `public`, cero
migraciones (`supabase_migrations.schema_migrations` ni existe), cero usuarios
en `auth.users`, cero buckets. Extensiones instaladas: `pg_stat_statements`,
`pgcrypto`, `supabase_vault`, `uuid-ossp`. Disponibles y no instaladas:
`pg_cron 1.6.4`, `pg_net`, `pg_trgm`, `unaccent`, `citext`, `pgtap`, `pgaudit`,
`btree_gist`. Timezone del cluster: **UTC**. Esquema `private` no existe.

**Hallazgo que condiciona las migraciones.** Los *default privileges* del
stack local otorgan `arwdDxtm` (**incluido DELETE**) a `anon`, `authenticated`
y `service_role` sobre **toda tabla nueva** en `public` creada por `postgres` o
`supabase_admin`. La regla "authenticated no tiene grant delete" **no se cumple
por omisión: hay que revocar explícitamente** (o alterar los default
privileges en la primera migración). Y en sentido inverso, el changelog de
Supabase (2026-04-28) dice que los proyectos hosted nuevos **ya no exponen
tablas al Data API automáticamente** (obligatorio para todos el 2026-10-30):
los grants tienen que ser explícitos de todos modos. Conclusión: la primera
migración fija la política de privilegios y cada tabla declara sus grants a
mano, por columna donde corresponde.

**Config local de Auth** (`supabase/config.toml`): `[auth] enable_signup = false`,
`minimum_password_length = 10`, `password_requirements = "letters_digits"`,
`jwt_expiry = 3600`, refresh token rotation activa, `[auth.email]
enable_confirmations = false`, `secure_password_change = true`, SMTP comentado
(todo cae en Mailpit `:54324`), sin plantillas de mail personalizadas, sin
hooks de auth. `site_url = http://127.0.0.1:3000`.

**Tooling.** `psql` no está en el PATH del host (se usa el del contenedor).
**No hay driver de Postgres en `package.json`** (`pg`/`postgres`): el
`test-engineer` no puede escribir `tests/db/` sin que el hilo principal lo
instale. Node local es 24.18 (supabase-js dejó de soportar Node 20 el
2026-06-30; el `engines` del package dice `>=20.9`, conviene subirlo a `>=22`).

**Relevamiento.** El contrato (2.1–2.5) es la fuente; la transcripción confirma:
~250 socios, ~25 no practicantes históricos "que queremos que empiecen a
aportar"; apto físico solo para menores; la sede tiene un celular, no una
computadora; los tres con acceso "full" son Presidencia, Secretaría y
Tesorería y "los otros chicos pueden entrar y ver". Los CSV muestran la forma
de los datos, no se copian: una planilla por categoría con una columna por
mes y `10000` en los meses pagos (a veces `$10.000`, a veces vacío), la
planilla femenina con una columna "Saldo de 2025", nombres en formatos mixtos
("Apellido, Nombre" y "Nombre Apellido"), **columnas de DNI vacías**, filas de
totales mezcladas y duplicados. La grilla de horarios es Fase 4.

## 4. Pushback y riesgos del pedido

1. **"DNI obligatorio" choca con la carga inicial.** Los Excel reales tienen
   DNI vacíos. Si `members.dni` es `NOT NULL`, el club no puede cargar el
   padrón histórico sin inventar datos. Propongo: DNI **obligatorio en la
   ficha de ingreso nueva** (validación Zod, es lo que pide el estatuto) pero
   **nullable en la base**, con unicidad parcial (`where dni is not null`) y
   un flag visible en el padrón ("DNI pendiente") para que se complete
   después. Hay que confirmarlo con la Comisión (pregunta C1).
2. **El responsable de pago no siempre es socio.** El contrato dice
   "vinculación de asociados entre sí, con un responsable de pago por grupo",
   pero en la práctica quien paga por dos hermanos menores es un padre que
   puede no ser socio. Modelar "responsable = socio" a rajatabla obliga a dar
   de alta al padre como socio (y a cobrarle cuota). Propongo que el
   responsable sea **un integrante del grupo** (lectura del contrato) y que el
   grupo tenga además un **contacto de pago** libre (nombre + teléfono) para
   el caso del padre no socio. Pregunta C2.
3. **Subir el certificado por Server Action no funciona en Vercel.** El límite
   de body de una función de Vercel es **4,5 MB** (error 413, es
   infraestructura, no config), y el default de Next para Server Actions es 1
   MB. Una foto de celular pesa 3–8 MB. La carga tiene que ir **directo del
   browser a Storage con una URL de subida firmada** que emite el servidor.
   Es más trabajo de frontend que un `<input type="file">` y un action; se
   detalla en §7.5.
4. **`forbidden()`/`unauthorized()` de Next siguen siendo experimentales**
   (`experimental.authInterrupts`, desde 15.1 y aún en 16.3). No propongo
   prender un flag experimental para el panel de un club: la puerta de rol se
   resuelve con un layout de grupo de rutas + re-verificación en cada
   controller (§7.2).
5. **La dirección visual no la puede decidir un subagente solo.** `impeccable`
   exige una ronda de dirección con el usuario (`concept-seed --scope
   direction`) antes de escribir un átomo de UI, y `CLAUDE.md` prohíbe que la
   corra más de un agente. Este documento deja los **briefs de superficie**
   y las restricciones de la dirección; **la tirada la corre el hilo principal
   con Tomás** antes de repartir el frontend (§8).
6. **Auditar con `service_role` deja actor nulo.** Ya está en `CLAUDE.md`, pero
   el flujo de "crear usuario" lo tienta: la Admin API va con el admin client
   y la fila de rol tiene que ir con el cliente de sesión. Lo mismo el
   bootstrap del primer admin, que es la única escritura de dominio legítima
   sin actor (se registra explícito).
6b. **"Debe cambiar la contraseña" no puede ser solo un redirect.** Con la
   publishable key en el browser, un usuario con contraseña temporal podría
   pegarle a PostgREST antes de cambiarla. El flag tiene que apagar
   `private.current_app_role()` (§6.6 D8), y el usuario no puede apagarlo
   él mismo sin haber cambiado la contraseña de verdad: por eso la
   verificación compara el hash real de `auth.users`, no confía en un
   "listo" de la app.
7. **Lockout.** Un admin que se quita el rol o se desactiva a sí mismo deja al
   club sin administrador. Va un trigger: siempre queda al menos un admin
   activo y nadie cambia su propio rol/estado.
8. Nada del pedido está sobre-diseñado. Lo que sí sobra para este slice es
   crear ya las tablas de cuotas y pagos: se **diseñan** acá y se **crean** en
   el slice 2 (son aditivas, no obligan a tocar nada de este slice).

## 5. Investigación

Consultado (no se arquitectó de memoria):

- **Supabase SSR / Auth** (Context7 `/supabase/ssr`, `/supabase/supabase-js`,
  guías `auth/server-side/nextjs`, `auth/passwords`): en el server **nunca**
  `getSession()`; `getClaims()` valida firma localmente y es lo indicado para
  el proxy; `getUser()` hace round trip (ya memoizado en `server.ts`).
  `auth.admin.createUser` acepta `password`, `email_confirm: true` (queda
  confirmado sin mail), `ban_duration` (`'none'` para desbanear);
  `auth.admin.updateUserById` cambia la contraseña de otro usuario;
  `auth.updateUser({ password, current_password })` (supabase-js ≥ 2.102)
  verifica la contraseña actual sin mail; `listUsers` no filtra por email
  (motivo para tener email en nuestra tabla). Los flujos por mail
  (`inviteUserByEmail`, `resetPasswordForEmail`, `verifyOtp` con
  `token_hash`) quedan **documentados y descartados** para la Fase 1: sin
  SMTP, Auth solo entrega a miembros del equipo del proyecto. El setting
  `[auth.email] secure_password_change` exige reautenticación (que manda un
  OTP por mail) si el último login no es reciente: **se apaga**, y la
  verificación de la contraseña actual la hace `current_password`.
- **RBAC**: guía "Custom Claims & RBAC" (hook `custom_access_token`) contra
  helper `SECURITY DEFINER` en `private` leyendo una tabla; el trade-off es
  claims obsoletos hasta el refresh vs. una lectura por sentencia. Skill
  `supabase`: nunca `user_metadata` en autorización; `TO authenticated` solo
  no autoriza; UPDATE necesita SELECT policy y `USING` + `WITH CHECK`; una
  `SECURITY DEFINER` en `public` es callable por todos.
- **Postgres** (skill `supabase-postgres-best-practices`: `security-rls-*`,
  `security-privileges`, `schema-*`, `lock-advisory`, `data-pagination`,
  `query-partial-indexes`): `bigint identity`, `timestamptz`, `text` sin
  `varchar(n)`, `(select auth.uid())` en policies, índice en toda FK y en toda
  columna usada por RLS, `DO $$` para constraints idempotentes, keyset en vez
  de OFFSET, índices parciales para flags, advisory locks para procesos
  exclusivos (la generación de cuotas).
- **Auditoría**: blog de Supabase "Postgres auditing in 150 lines of SQL"
  (`supa_audit`): una tabla `record_version` con `record`/`old_record` jsonb,
  `record_id` estable, BRIN por tiempo, funciones `enable_tracking(regclass)`;
  **no captura el usuario** — acá se agrega `actor_id` de `auth.uid()` y el
  guard append-only, que el blog no tiene.
- **Storage** (guías `storage/serving`, `uploads/resumable-uploads`,
  `security/access-control`): buckets privados con `createSignedUrl(path, ttl)`;
  `createSignedUploadUrl` + `uploadToSignedUrl` para subir desde el browser;
  límite y tipos MIME por bucket; policies sobre `storage.objects` por
  `bucket_id` y `storage.foldername(name)`.
- **Next 16** (`node_modules/next/dist/docs`): `proxy.ts` no es sesión ni
  autorización; DAL con `cache()`; los chequeos en layouts no se re-ejecutan al
  navegar entre hijos (por eso cada page/controller re-verifica);
  `forbidden`/`unauthorized` experimentales; `serverActions.bodySizeLimit`
  default 1 MB; `'use server'` solo exporta funciones async.
- **Vercel**: body máximo de una función **4,5 MB** (docs de límites y KB
  "How to bypass the 4.5MB body size limit"): la recomendación oficial es la
  subida directa del cliente al storage.
- **Contabilidad de cuentas corrientes**: *balance forward* (saldo global,
  pagos contra lo más viejo, sin imputar a un documento) vs. *open item*
  (cada pago se imputa a ítems abiertos, permite elegir). Base de la decisión
  de imputación (§6.7).
- **Changelog de Supabase** relevante: tablas nuevas no expuestas
  automáticamente (2026-04-28, general 2026-10-30); OpenAPI no disponible
  con anon key; restricciones DDL en `auth`/`storage`/`realtime` (2025-04);
  Node 20 fuera de soporte en client libs.

## 6. Modelo de datos de toda la Fase 1

Convenciones (`CLAUDE.md`): `bigint generated always as identity` como PK,
centavos en `bigint`, `timestamptz` para instantes y `date` para períodos y
fechas de vida, snake_case, índice en toda FK, RLS en toda tabla, valores de
enumeración como `text` + CHECK (extensibles con un `ALTER`, sin los límites
transaccionales de `ALTER TYPE ... ADD VALUE`). Dominio en inglés en la base y
el código; español en la UI.

Esquemas: `public` (expuesto por PostgREST), `private` (helpers, triggers,
funciones internas; **no** expuesto; `grant usage` solo a `authenticated` para
las funciones que las policies necesitan). Storage: un bucket privado
`attachments`.

### 6.1 Slice 1 — se crea ahora

**`app_users`** — usuarios internos. `user_id uuid PK` (= `auth.users.id`, FK
`on delete restrict`: nada se borra), `email text not null unique` (CHECK
`email = lower(email)`), `display_name text not null`, `role text not null`
CHECK in (`admin`, `editor`, `consulta`) — el slice de la Fase 2 agrega
`socio` con un `ALTER ... CHECK` —, `is_active boolean not null default true`,
**`must_change_password boolean not null default true`** (nace prendido: todo
usuario nuevo tiene contraseña temporal), `password_changed_at timestamptz
null`, `created_by uuid null`, `created_at`, `updated_at`. Trigger guard:
siempre queda al menos un `admin` activo; un usuario no cambia su propio
`role` ni su propio `is_active`. `must_change_password` **no tiene grant de
UPDATE para nadie**: lo prenden y apagan solo las RPC de D8 (SECURITY
DEFINER). El rol **nunca** se copia a `user_metadata`.

**`private.password_markers`** — tabla técnica, no expuesta, **no auditada**
(no contiene datos de dominio). `user_id uuid PK`, `marker text not null`
(`sha256` hex del `auth.users.encrypted_password` en el momento en que un
admin asignó la contraseña temporal; un hash de un hash, nunca la contraseña),
`set_by uuid null`, `set_at timestamptz`, `cleared_at timestamptz null`. Solo
la leen y escriben las funciones de D8. Es lo que permite comprobar en la
base que **la contraseña realmente cambió** antes de apagar el flag.

**`audit_log`** — registro de auditoría. `id bigint identity`, `occurred_at
timestamptz default now()`, `actor_id uuid null` (de `auth.uid()`; cuando es
nulo, del setting de sesión `app.actor_id`, que solo fija el bootstrap y los
jobs), `actor_source text` CHECK in (`session`, `explicit`, `system`), `op
text` CHECK in (`INSERT`, `UPDATE`, `DELETE`, `EXPORT`), `table_name text`,
`record_id text` (PK serializada; `bigint` o `uuid`), `old_data jsonb null`,
`new_data jsonb null`, `changed_fields text[] null` (solo UPDATE; calculadas en
el trigger comparando `to_jsonb(old)` y `to_jsonb(new)`; un UPDATE sin cambios
**no** se registra), `context jsonb null` (para `EXPORT`: qué listado y con
qué filtros; para acciones de la app: nombre del caso de uso si lo pasan por
`set_config`). Índices: BRIN en `occurred_at`, btree en `(table_name,
record_id)`, btree en `actor_id`. Append-only: **sin grant** de INSERT/UPDATE/
DELETE para `anon`, `authenticated` ni `service_role` (solo SELECT para
`service_role`, por backups y exportación); un trigger BEFORE UPDATE/DELETE
que hace `raise exception`, declarado `enable always trigger` para que valga
también en modo réplica; el INSERT lo hacen únicamente las funciones
`SECURITY DEFINER` de `private` (dueño `postgres`).

**`settings`** — singleton (`id smallint PK CHECK (id = 1)`). `club_name`,
`billing_start_period date null` (primer mes que genera cuotas; el slice 2 lo
usa), `updated_at`. Lectura para todo rol activo; UPDATE solo `admin`; sin
INSERT/DELETE para nadie (la migración inserta la fila).

**`disciplines`** — `id`, `name text not null` (unique por `lower(name)`),
`is_active`, `sort_order int`, `created_at`, `updated_at`.

**`categories`** — `id`, `discipline_id` FK, `name` (unique por
`(discipline_id, lower(name))`), `is_active`, `sort_order`, timestamps. Índice
en `discipline_id`. Baja de una categoría = `is_active = false`; si tiene socios
activos, la UI avisa y no lo impide (pregunta C6 para la Comisión: qué pasa con
los chicos que "suben" de categoría cada año).

**`family_groups`** — `id`, `name text null` (ej. "Familia Pérez", opcional:
por defecto se muestra el apellido del responsable), `payer_contact_name text
null`, `payer_contact_phone text null` (contacto de pago cuando no es socio),
`notes`, timestamps.

**`members`** — el padrón. `id`, `first_name`, `last_name`, `dni text null`
(unique parcial `where dni is not null`; CHECK de solo dígitos 7–8), `birth_date
date null`, `address text null`, `phone text null`, `email text null`,
`member_type text not null` CHECK in (`practicing`, `non_practicing`),
`category_id bigint null` FK, CHECK `(member_type = 'practicing') = (category_id
is not null)`, `family_group_id bigint null` FK, `is_payment_responsible boolean
not null default false` con CHECK `is_payment_responsible → family_group_id is
not null` y **unique parcial `(family_group_id) where is_payment_responsible`**
(a lo sumo un responsable por grupo; "al menos uno" lo pide la UI y lo lista un
aviso, no lo fuerza la base), `joined_on date not null` (fecha de alta,
**inmutable** por trigger), `status text not null default 'active'` CHECK in
(`active`, `inactive`) — **nadie lo escribe directo**: la columna no tiene grant
de UPDATE para `authenticated`; la escribe el trigger de eventos —,
`status_changed_on date null`, `notes text null`, `search_text text generated
always as (…) stored` (nombre, apellido y DNI normalizados con un wrapper
`immutable` de `unaccent` + `lower`), `created_by`, `created_at`, `updated_at`.
Índices: `category_id`, `family_group_id`, `status` parcial (`where status =
'active'`), GIN `pg_trgm` sobre `search_text`, btree `(last_name, first_name,
id)` para keyset. La edad y "menor" se derivan de `birth_date` (no se
guardan).

**`member_status_events`** — la historia de alta/baja/reactivación (fichas de
ingreso y egreso). `id`, `member_id` FK, `event_type text` CHECK in
(`admission`, `withdrawal`, `reactivation`), `effective_on date not null`,
`reason text not null` CHECK `length(btrim(reason)) >= 3`, `notes text null`,
`created_by uuid` (default `auth.uid()`), `created_at`. Índice `(member_id,
created_at)`. Triggers: BEFORE INSERT valida la transición contra el estado
actual (`admission` solo como primer evento; `withdrawal` solo desde
`active`; `reactivation` solo desde `inactive`); AFTER INSERT actualiza
`members.status` y `status_changed_on` (función `SECURITY DEFINER`). El evento
`admission` lo inserta un trigger AFTER INSERT de `members` con `effective_on =
joined_on` y `reason = 'Ficha de ingreso'`: por eso `editor` puede dar de alta
sin tener grant de INSERT en esta tabla. Sin UPDATE ni DELETE para nadie.

**`medical_clearances`** — aptos físicos. `id`, `member_id` FK, `expires_on
date not null`, `storage_path text null` (ruta del objeto en el bucket, **nunca
una URL**), `original_filename text null`, `uploaded_by uuid`, `notes`,
`created_at`, `updated_at`. Un certificado nuevo es una fila nueva; el vigente
es el de mayor `expires_on`. UPDATE solo de `expires_on` y `notes` (grant por
columna). Índice `(member_id, expires_on desc)`. Se permite fila sin adjunto
(la Comisión vio el certificado en papel y cargó la fecha) — pregunta C4.

**Storage: bucket `attachments`** privado, `file_size_limit` 10 MiB (el global
local es 10 MiB), `allowed_mime_types` = `image/jpeg`, `image/png`, `image/webp`,
`application/pdf`. Rutas: `medical-clearances/<member_id>/<uuid>.<ext>` y, en
el slice 2, `payment-receipts/<payment_id>/<uuid>.<ext>`. Policies sobre
`storage.objects`: INSERT para `authenticated` con `private.has_role('admin',
'editor')` y `bucket_id = 'attachments'` y prefijo válido; SELECT para todo rol
activo; **sin UPDATE ni DELETE** para `authenticated`. Se sirve solo con URLs
firmadas de vida corta (60 s para abrir, 10 min para subir).

### 6.2 Slice 2 — se diseña ahora, se crea después

**`fee_prices`** — valores de cuota, append-only (cambiar el valor es insertar
una fila nueva). `id`, `scope text` CHECK in (`default`, `member_type`,
`category`), `member_type text null`, `category_id bigint null` (CHECK de
coherencia entre `scope` y los nulos), `amount_cents bigint` CHECK `>= 0`,
`valid_from date` CHECK primer día de mes, `created_by`, `created_at`. Unique
`(scope, coalesce(member_type, ''), coalesce(category_id, 0), valid_from)`.
Precedencia al resolver el precio de un socio para un período: **categoría >
tipo de socio > default**, tomando en cada scope la fila con mayor `valid_from
<= período`. Hoy alcanza con una fila `default` de $10.000.

**`fees`** — cargos. `id`, `member_id` FK, `period date` CHECK primer día de
mes, `kind text` CHECK in (`monthly`, `opening_balance`, `adjustment`),
`amount_cents bigint` CHECK `>= 0`, `description text null`, `created_by uuid
null` (nulo = generación automática), `created_at`, `voided_at timestamptz
null`, `voided_by uuid null`, `void_reason text null` (CHECK: los tres nulos o
los tres presentes). **Unique parcial `(member_id, period) where kind =
'monthly'`** (la idempotencia vive acá) y **unique parcial `(member_id) where
kind = 'opening_balance'`** (un solo saldo de arranque por socio). `amount_cents`,
`period`, `member_id`, `kind` **inmutables** por trigger; la anulación solo
completa las tres columnas de void una vez (solo `admin`), y **un cargo anulado
sigue existiendo**.

**`payments`** — pagos. `id`, `member_id` FK, `amount_cents bigint` CHECK `> 0`,
`paid_on date not null` (default: hoy en la zona del club), `method text`
CHECK in (`cash`, `transfer`), `receipt_storage_path text null`, `notes`,
`batch_id uuid null` (varios pagos cargados juntos —un padre que paga por tres
hijos— comparten `batch_id`; se sigue registrando **un pago por socio**),
`created_by uuid not null` (default `auth.uid()`), `created_at`, `voided_at`,
`voided_by`, `void_reason` (misma regla que `fees`). Inmutables: `member_id`,
`amount_cents`, `paid_on`, `method`. Índices `member_id`, `paid_on`,
`batch_id`, parcial `where voided_at is null`.

**Generación mensual** (`private.generate_monthly_fees(period)`): advisory lock
transaccional + `insert … select` de los socios `active` cuyo `joined_on` es
anterior al fin del período y con `period >= settings.billing_start_period`,
`on conflict do nothing` sobre el índice único; monto resuelto con
`private.fee_price_for(member_id, period)` y **congelado** en la fila.
`pg_cron` la llama directo (`'5 3 1 * *'` en UTC = 00:05 del día 1 en
Argentina; la función calcula el período con `now() at time zone
'America/Argentina/Buenos_Aires'`). También la expone una RPC `public`
(`generate_fees_for_current_period`, con `revoke execute from public, anon` y
chequeo de `admin` en el cuerpo) para la primera corrida y para reintentos a
mano. Los socios dados de baja no reciben cargo; un reactivado vuelve a
recibirlo desde el período de la reactivación.

**Deuda derivada** — RPC `member_balances(member_ids[] | null, filtros)` en
`public` (SECURITY INVOKER, respeta RLS): por socio, `charged_cents` (cargos no
anulados), `paid_cents` (pagos no anulados), `balance_cents`, `months_due`,
`first_due_period`, `last_payment_on`, `last_payment_cents`, `debt_status`
(`up_to_date`, `in_debt`). Es la que alimenta el filtro "condición de deuda"
del padrón y los listados. Nunca se guarda un saldo.

### 6.3 Slice 3 — gancho

`public.log_export(listing text, filters jsonb, row_count int)` (revoke de
`public`/`anon`, chequeo de rol en el cuerpo) inserta la fila `EXPORT` en
`audit_log` con actor de sesión. La exportación completa del club (contrato
10.2) es un script con `pg_dump` + copia del bucket, no una feature.

### 6.4 Roles y permisos en Postgres (helpers)

- `private.current_app_role()` → `text | null`: `select role from public.app_users
  where user_id = (select auth.uid()) and is_active and not
  must_change_password`. `SECURITY DEFINER`, `STABLE`, `set search_path = ''`;
  `revoke execute from public, anon`; `grant execute to authenticated`. Lee la
  tabla saltando su RLS (evita recursión). **Con contraseña temporal
  pendiente, el rol es null y el dominio entero queda cerrado**, aunque el
  JWT sea válido.
- `public.mark_password_reset(target_user_id uuid)` → `void`. SECURITY
  DEFINER en `public` (tiene que ser llamable por RPC), `revoke execute from
  public, anon`, `grant execute to authenticated, service_role`; en el
  cuerpo: exige `private.is_admin()` **o** claim `role = 'service_role'`
  (solo para el bootstrap), guarda en `private.password_markers` el `sha256`
  del `encrypted_password` actual de `auth.users` para ese usuario, y pone
  `app_users.must_change_password = true` (auditado por trigger, actor =
  `auth.uid()` del admin, que dentro de una SECURITY DEFINER sigue siendo el
  del JWT).
- `public.confirm_password_changed()` → `boolean`. SECURITY DEFINER en
  `public`, mismo régimen de grants (`authenticated`); actúa **solo sobre
  `auth.uid()`**: compara el `sha256` del `encrypted_password` actual con el
  marker; si son distintos apaga `must_change_password`, fija
  `password_changed_at` y marca `cleared_at`; si son iguales (o no hay
  marker) lanza `'La contraseña no cambió'`. Un usuario que la llame por
  PostgREST sin haber cambiado la contraseña no obtiene nada.
- `private.has_role(variadic text[])` → `boolean`, sobre la anterior.
- `private.is_admin()` → atajo.
- `private.club_today()` → `date` en `America/Argentina/Buenos_Aires`, para
  defaults de `paid_on`, `effective_on`.
- `private.normalize_text(text)` → `text`, `IMMUTABLE`, `lower(unaccent(...))`
  (wrapper porque `unaccent` no es immutable y la columna generada lo exige).
- `private.audit_row_change()` (trigger genérico), `private.audit_log_guard()`,
  `private.enable_audit(regclass)` (idempotente: crea el trigger AFTER
  INSERT/UPDATE/DELETE FOR EACH ROW), `private.set_updated_at()`,
  `private.protect_immutable_columns()` (parametrizado con `TG_ARGV`).

### 6.5 Matriz de RLS y grants (slice 1)

Regla general: `revoke all on <tabla> from anon, authenticated, service_role`
tras crearla; después grants explícitos. **Ninguna tabla del dominio otorga
DELETE a `authenticated`**; `service_role` conserva SELECT/INSERT/UPDATE donde
el admin client los necesita (solo `app_users`), y **nunca** DELETE ni nada
sobre `audit_log`. Toda policy usa `(select private.has_role(...))` para que
se evalúe una vez por sentencia. Todas las tablas: `enable row level security`
+ `force row level security`.

| Tabla | SELECT | INSERT | UPDATE (columnas) | Notas |
|---|---|---|---|---|
| `app_users` | fila propia (`(select auth.uid()) = user_id`, **directo, sin pasar por `has_role`**: el usuario con contraseña temporal necesita leer su propio flag) **o** `admin` | `admin` (`user_id, email, display_name, role, is_active, created_by`) | `admin` (`display_name, role, is_active`); `must_change_password` y `password_changed_at` **sin grant**, solo las RPC de D8 | trigger guard anti-lockout |
| `audit_log` | `admin` | nadie (solo triggers `SECURITY DEFINER`) | nadie | guard `enable always` |
| `settings` | activo | nadie | `admin` (`club_name, billing_start_period`) | singleton |
| `disciplines`, `categories` | activo | `admin` | `admin` (`name, is_active, sort_order`, `discipline_id` en categorías) | |
| `family_groups` | activo | `admin`, `editor` | `admin`, `editor` | |
| `members` | activo | `admin`, `editor` (todas menos `status`, `status_changed_on`) | `admin`, `editor` (datos personales, `member_type`, `category_id`, `family_group_id`, `is_payment_responsible`, `notes`) | `status` sin grant; `joined_on` inmutable |
| `member_status_events` | activo | `admin` (`withdrawal`, `reactivation`); `admission` solo vía trigger | nadie | |
| `medical_clearances` | activo | `admin`, `editor` | `admin`, `editor` (`expires_on, notes`) | |
| `storage.objects` (bucket `attachments`) | activo | `admin`, `editor` | nadie | prefijos válidos |

"Activo" = `private.current_app_role() is not null` (usuario con fila en
`app_users`, `is_active = true` **y** `must_change_password = false`). Un
usuario de Auth **sin fila** en `app_users`, desactivado o con contraseña
temporal pendiente no ve nada aunque tenga JWT válido: eso es lo que hace
innecesario revocar sesiones a mano al desactivar o al restablecer (el JWT
dura 1 h y la policy corta al instante).

Prueba contra la base (para `tests/db/`): cada celda de la matriz con el rol
correspondiente vía `set local role authenticated` + `request.jwt.claims`;
ausencia de privilegio DELETE para `authenticated` en toda tabla de `public`;
`UPDATE`/`DELETE` sobre `audit_log` falla también como `service_role` y como
`postgres`; un rol leído de `user_metadata` no otorga nada; un admin con
`must_change_password = true` no lee `members` ni `audit_log` pero sí su
propia fila de `app_users`; `confirm_password_changed()` sin cambio real de
hash falla y con cambio real apaga el flag.

### 6.6 Decisiones abiertas de `CLAUDE.md`, resueltas

**D1. Dónde vive el rol y cómo lo lee RLS.**
- *A. Tabla `app_users` + helper `SECURITY DEFINER` en `private`* (recomendada).
  Pros: revocación y cambio de rol **inmediatos**; una sola fuente de verdad;
  sin configuración de hooks por ambiente; sin claims que caduquen. Contras:
  una lectura indexada por sentencia (irrelevante con 7 usuarios y 250 socios).
- *B. Hook `custom_access_token` que copia el rol al JWT.* Pros: cero lecturas.
  Contras: rol obsoleto hasta el próximo refresh (hasta 1 h), configuración en
  `config.toml` **y** en el dashboard hosted, y el hook necesita grants a
  `supabase_auth_admin` sobre nuestra tabla. Se descarta: el caso de uso
  "desactivar a alguien de la Comisión que se fue" exige efecto inmediato.
- *C. Ambos* (claim para UI, tabla para RLS). Descartado: dos verdades.
En la app, `session.controller.ts` expone `getSession()` (usuario + rol, una
vez por request con `cache()`) y `requireRole(...)`. Para la Fase 2, `socio`
entra como valor nuevo del CHECK y sus policies se agregan a las tablas del
portal; nada de este slice se toca.

**D2. Modelo de estado del socio.** Estado almacenado (`members.status`) pero
**escrito solo por el trigger de eventos** y con la historia en
`member_status_events`. Alternativas: (a) solo eventos y estado derivado en
cada query (más lento en filtros y RLS, sin ganancia); (b) estado editable con
`reason` en la misma fila (pierde la historia). Postgres fuerza: alta única,
baja solo desde activo, reactivación solo desde baja, motivo y fecha
obligatorios, `joined_on` inmutable, sin UPDATE/DELETE de eventos.

**D3. Imputación de pagos.**
- *A. Saldo global, "lo más viejo primero" derivado* (balance forward;
  recomendada para la Fase 1). Deuda = cargos − pagos no anulados; los "meses
  adeudados" se calculan recorriendo los cargos del más viejo al más nuevo
  contra el total pagado. Pros: cero estado extra, la anulación se resuelve
  sola (se recalcula), un pago de $30.000 con cuota de $10.000 cubre tres
  meses sin que nadie elija nada, reproduce exactamente la grilla del Excel
  con cuota plana. Contras: no se puede marcar "pagó septiembre pero debe
  julio y agosto" (ese caso no aparece en las planillas).
- *B. Ítems abiertos con tabla `payment_allocations`* (elección manual de
  meses). Pros: fidelidad documental. Contras: una tabla y una RPC atómica
  más, pagos parciales y anulaciones con estado que mantener, y una pantalla
  de imputación que atenta contra "cargar un pago lleva segundos".
- *C. Híbrido* (auto oldest-first + override). Es B con más UI.
Recomendación: **A**, y el schema no lo cierra: `payment_allocations` se puede
agregar después sin tocar `fees` ni `payments`. Confirmar con la Comisión
(C3). Pago parcial: baja el saldo; el mes "más viejo" queda parcialmente
cubierto y sigue contando como adeudado hasta completarse.

**D4. Grupo familiar y cobro.**
- *A. Un cargo por integrante, el grupo consolida* (recomendada). Cada socio
  activo tiene su cargo (la invariante `(member_id, period)` ya lo exige); el
  estado de cuenta del grupo suma los de sus integrantes; el responsable es a
  quien se le muestra y reclama; un pago por varios integrantes se carga como
  N pagos con un `batch_id`. Sin descuento familiar (no está en el contrato).
- *B. Un cargo de grupo al responsable.* Rompe "un cargo por socio", complica
  altas/bajas de un integrante a mitad de mes y deja al socio sin estado de
  cuenta propio (Fase 2 lo necesita).
- Responsable dado de baja: el grupo queda "sin responsable" (aviso en el
  padrón), la Comisión elige otro; no se fuerza en la base. Descuentos por
  grupo: pregunta C5 (si existen, entran como `fee_prices` con scope nuevo,
  no como cambio de modelo).

**D5. Precedencia de valores de cuota.** Categoría > tipo de socio > default,
todas con `valid_from`; el precio se **resuelve al generar** y se congela en
`fees.amount_cents`. Cambiar el valor inserta una fila nueva con `valid_from`
= próximo período; nunca se edita una vigente. Alternativa (tabla por
categoría con `amount` editable) pierde historia y viola "monto congelado".

**D6. Saldo de arranque.** Cargo `kind = 'opening_balance'` por socio, período =
el mes anterior a `settings.billing_start_period`, monto tipeado por el club,
uno por socio (unique parcial), anulable por `admin` con motivo si se cargó
mal. Entra por la ficha del socio en el slice 2. Alternativa (columna
`opening_balance_cents` en `members`) no deja rastro ni se anula limpio.

**D7. DNI nullable con unicidad parcial** (ver §4.1). **Confirmado (T1).**
Queda la pregunta C1 a la Comisión sobre la política de uso.

**D8. Usuarios: contraseña temporal + cambio obligatorio en el primer login.
Confirmado (T3), sin mail.** Crear usuario = Admin API `createUser({ email,
password: <temporal>, email_confirm: true })` + fila en `app_users` con el
cliente de sesión (auditada, actor = el admin; nace con `must_change_password
= true`) + `mark_password_reset(user_id)` (guarda el marker del hash
temporal). La contraseña temporal se muestra **una sola vez** en la pantalla
del admin, que se la pasa a la persona por el canal que quiera; nunca se
loguea, nunca se persiste, nunca entra en la auditoría (la auditoría ve
`app_users`, y la contraseña solo va a Auth). "Olvidé mi contraseña" en la
Fase 1 = un admin usa **"Restablecer contraseña"** en `/usuarios`: Admin API
`updateUserById(id, { password: <temporal nueva> })` + `mark_password_reset`
(auditado como cambio de `must_change_password`). El login muestra "Si
olvidaste tu contraseña, pedile a un administrador que te asigne una nueva".

*Quién genera la temporal.* Opciones: (a) la tipea el admin; (b) **la genera
el sistema** (recomendada, confirmada): 12 caracteres de letras y dígitos sin
ambiguos (`0/O`, `1/l/I`), cumple la política local (`≥ 10`, letras y
dígitos), no la elige un humano (evita "club1234" reutilizada), y el admin
la ve una vez con un botón "Copiar". Se genera en el servidor con
`crypto.getRandomValues`, viaja al browser una sola vez dentro del
`ActionResult` y no queda en ningún estado persistente.

*Dónde vive el flag y quién lo escribe.* `app_users.must_change_password`
(§6.1). Lo **prenden** la creación (default) y `mark_password_reset` (admin).
Lo **apaga** solo `confirm_password_changed()`, que el propio usuario invoca
(vía la action `changePassword`) después de `auth.updateUser({ password,
current_password })`; el usuario no tiene grant sobre la columna y la RPC
verifica en `auth.users` que el hash cambió respecto del marker. Fail-closed:
si algo falla a mitad de camino, el flag queda prendido.

*Enforcement, opciones evaluadas:*
- *A. Redirect en el layout + `requireRole` en cada action.* Insuficiente
  solo: PostgREST directo lo saltea.
- *B. Trigger sobre `auth.users` que apaga el flag cuando cambia
  `encrypted_password`.* Simple, pero **fail-open**: el reset del admin
  también cambia el hash (lo apagaría y habría que volver a prenderlo en un
  segundo paso, con ventana y dependencia del orden), y no distingue quién
  cambió la contraseña. Supabase además desaconseja depender de triggers en
  el schema `auth` (restricciones DDL de 2025).
- *C. `private.current_app_role()` devuelve null mientras el flag está
  prendido, y el flag solo se apaga con verificación de hash* (recomendada).
  El dominio entero queda cerrado por RLS aunque el JWT sea válido; la única
  lectura permitida es la fila propia de `app_users` (policy directa por
  `auth.uid()`) para que el layout sepa a dónde mandar al usuario. El
  redirect de A queda como UX encima de C.
- *D. Custom claim en el JWT.* Descartado por el mismo motivo que D1 (claims
  obsoletos).

Desactivar sigue igual: `is_active = false` (sesión, auditado) +
`ban_duration` vía Admin API; reactivar es lo inverso. Orden de creación:
primero Auth (por la FK), después la fila y el marker; si la fila falla, el
usuario existe en Auth sin rol y no ve nada; `/usuarios` lo lista como
"alta incompleta" desde `listUsers` de la Admin API cruzado con `app_users` y
permite completar (el modelo hace upsert por `user_id`, y el completar
regenera la temporal porque la anterior ya no se puede mostrar).

**D9. Bootstrap del primer admin. Confirmado.** Script
`scripts/bootstrap-admin.mjs` (Node + supabase-js con la secret key,
`--env-file`): crea el usuario en Auth (`createUser` con `email_confirm:
true`) e inserta la fila en `app_users` con actor explícito
(`set_config('app.actor_id', <su propio id>)` vía la RPC de registro → la
fila de auditoría queda con `actor_source = 'explicit'`). **Local**:
contraseña de `DEV_ADMIN_PASSWORD` y `must_change_password = false`
(comodidad de desarrollo; `--force-change` lo prende para probar el flujo).
**Hosted**: contraseña temporal generada, impresa **una vez** en la terminal
de Tomás, y `mark_password_reset` con `service_role` → el referente entra y
la cambia. `db-reset.sh` lo llama al final en local. En producción lo corre
Tomás **una vez** contra el proyecto hosted; a partir de ahí, todo usuario
nuevo nace en `/usuarios`.

**D10. Puerta de rol en la app sin APIs experimentales.** Route group
`app/(panel)/` cuyo layout resuelve la sesión: sin usuario → `redirect('/login?next=…')`;
con usuario sin rol activo → vista "Tu usuario no tiene acceso" con botón de
cierre de sesión. Sub-grupo `app/(panel)/(admin)/` para `/usuarios`, `/ajustes`,
`/auditoria`: su layout exige `admin` y renderiza la vista `AccessDenied` si
no. Y **cada controller y cada action re-verifica** (`requireRole`), porque el
layout no se re-ejecuta al navegar entre hermanos y porque la defensa real es
RLS.

**D11. Subida del apto físico** (ver §4.3 y §7.5): URL de subida firmada
emitida por un Server Action, upload directo desde el browser, confirmación
por un segundo action que verifica el objeto y crea la fila. **Confirmado
(T2).**

**Confirmados por defecto (T6, T7, T8):** `/cobranza` y `/reportes` no
aparecen en la navegación hasta que existan; un solo bucket `attachments` con
prefijos por tipo; login/logout **no** se duplican en `audit_log` (Auth ya
tiene `auth.audit_log_entries`). **T4**: el hilo principal instala `pg` +
`@types/pg` y sube `engines.node` a `>=22`. **T5**: la ronda de dirección
visual la corre Tomás en el hilo principal antes de F1.

## 7. Arquitectura recomendada (aplicación)

### 7.1 Rutas y árbol de `src/app`

```
app/
  layout.tsx                      root: fuentes, tokens, Toaster, contrato de dirección (comentario HTML)
  (auth)/
    login/page.tsx                email + contraseña; texto "pedile una nueva a un administrador"
    cambiar-contrasena/page.tsx   requiere sesión; obligatorio con contraseña temporal, voluntario después
  (panel)/
    layout.tsx                    sesión + rol → <AppShell>; redirect a /login sin sesión;
                                  redirect a /cambiar-contrasena con must_change_password
    page.tsx                      panel inicial (slice 3 pone indicadores; acá: búsqueda + accesos)
    socios/page.tsx               padrón con búsqueda, filtros y paginación keyset
    socios/nuevo/page.tsx         ficha de ingreso
    socios/[id]/page.tsx          ficha del socio (datos, grupo, apto físico, historia de estado)
    socios/[id]/editar/page.tsx   modificación
    (admin)/layout.tsx            exige admin → <AccessDenied> si no
    (admin)/usuarios/page.tsx     listado + alta con contraseña temporal + restablecer + rol/estado
    (admin)/ajustes/page.tsx      disciplinas y categorías
    (admin)/auditoria/page.tsx    registro, filtros, detalle del cambio
  forbidden / unauthorized        NO (experimentales)
```

`/cobranza` y `/reportes` no existen todavía; la navegación los muestra como
"próximamente" solo si el brief lo decide (recomiendo **no** mostrarlos:
un panel con botones muertos no es Operate).

### 7.2 Capas

**`src/models/types.ts`** (vocabulario, solo tipos): `AppRole`, `AppUser`,
`SessionInfo`, `MemberType`, `MemberStatus`, `MemberStatusEventType`,
`Member`, `MemberSummary` (fila del padrón), `MemberDetail` (ficha completa:
socio + categoría + disciplina + grupo + integrantes + apto vigente + eventos),
`MemberFilters` (`q`, `categoryId`, `disciplineId`, `status`, `memberType`,
`debt: 'any' | 'up_to_date' | 'in_debt'` — preparado, sin efecto hasta el
slice 2 —, `cursor`, `limit`), `Page<T>` (`items`, `nextCursor`),
`FamilyGroup`, `FamilyGroupSummary`, `MedicalClearance`, `Discipline`,
`Category`, `AuditEntry`, `AuditFilters`, y las **etiquetas** en español no
van acá (van en `views/shared/labels.ts`).

**`src/lib/action-result.ts`** (sin `server-only`, lo importan Client
Components): `ActionResult<T> = { ok: true; data: T } | { ok: false; error:
string; field?: string }` y `fromError(err, context)` que usa `toApiError`.

**`src/controllers/session.controller.ts`** (`server-only`): `getSession()`
→ `SessionInfo | null` (usuario de Auth + fila propia de `app_users`,
incluido `mustChangePassword`, memoizado por request), `requireSession()`
(redirige a `/login`), `requireRole(...roles)` (lanza `PermissionError`,
subclase de `DomainError` con status 403; **también lanza si
`mustChangePassword` está prendido**, salvo para la action `changePassword`,
que solo exige `requireSession()`). Es el DAL que recomienda Next; lo escribe
el hilo principal como contrato.

**Modelos** (`src/models/*.model.ts`, `server-only`, único acceso a Postgres,
siempre con el cliente de sesión salvo donde se indica):
- `app-users.model.ts`: `getAppUser(userId)`, `listAppUsers()`,
  `upsertAppUser(input)`, `updateAppUser(userId, patch)`,
  `markPasswordReset(userId)` (RPC), `confirmPasswordChanged()` (RPC);
  schemas Zod `createAppUserSchema` (`email`, `displayName`, `role`)
  `.strict()`, `updateAppUserSchema`, `changePasswordSchema`
  (`currentPassword`, `newPassword` con la política local, `confirm`).
- `members.model.ts`: `searchMembers(filters): Page<MemberSummary>` (keyset
  por `(last_name, first_name, id)`; `q` contra `search_text` con `ilike`/
  trigram), `getMemberDetail(id)`, `createMember(input)`, `updateMember(id,
  patch)`, `insertStatusEvent({ memberId, eventType, effectiveOn, reason,
  notes })`, `getMemberStatusHistory(id)`; schemas `memberInputSchema` (DNI
  requerido en alta nueva, `birthDate` ≤ hoy, teléfono normalizado, email
  opcional, practicante ⇔ categoría), `withdrawalSchema` /
  `reactivationSchema` (`effectiveOn`, `reason` ≥ 3 caracteres).
- `family-groups.model.ts`: `listFamilyGroups()`, `getFamilyGroup(id)`,
  `createFamilyGroup(input)`, `updateFamilyGroup(id, patch)`,
  `setPaymentResponsible(groupId, memberId)` (RPC pequeña o dos updates en
  una transacción: quita el flag anterior y pone el nuevo; se recomienda RPC
  `set_family_payment_responsible` para que sea atómica contra el índice
  único parcial).
- `medical-clearances.model.ts`: `listMedicalClearances(memberId)`,
  `createMedicalClearance(input)`, `updateMedicalClearance(id, patch)`.
- `catalogs.model.ts`: disciplinas y categorías (`list…`, `create…`,
  `update…`), con `includeInactive`.
- `audit.model.ts`: `searchAuditLog(filters): Page<AuditEntry>` (keyset por
  `(occurred_at, id)`), `getAuditEntry(id)`.
- `settings.model.ts`: `getSettings()`, `updateSettings(patch)`.

**Controllers** (solo donde hay orquestación):
- `auth.actions.ts`: `signIn`, `signOut`, `changePassword`. `signIn` valida
  Zod, llama a Auth con el cliente de sesión, `revalidatePath('/', 'layout')`,
  `redirect(next)` (o a `/cambiar-contrasena` si el flag está prendido);
  mensajes genéricos ("Email o contraseña incorrectos"). `changePassword`:
  `requireSession()`, Zod, `auth.updateUser({ password, current_password })`
  con el cliente de sesión, luego `confirmPasswordChanged()` (RPC) y
  `revalidatePath('/', 'layout')`; si la RPC dice que el hash no cambió
  (contraseña nueva igual a la temporal), `DomainError('Elegí una
  contraseña distinta a la temporal')`.
- `users.controller.ts` (lecturas: `listUsers`, que cruza `app_users` con
  `listUsers` de la Admin API para detectar altas incompletas) y
  `users.actions.ts` (`createUser` → devuelve `{ userId, temporaryPassword }`
  una sola vez, `resetUserPassword` → devuelve `{ temporaryPassword }` una
  sola vez, `changeUserRole`, `setUserActive`): cada action hace
  `requireRole('admin')`, valida, usa `services/auth-admin.service.ts` (port
  sobre la Admin API: `createWithPassword(email, password)`,
  `setPassword(userId, password)`, `ban(userId)`, `unban(userId)`,
  `listAuthUsers()`), luego el modelo con el cliente de sesión y
  `markPasswordReset`. La temporal la genera `lib/passwords.ts`
  (`generateTemporaryPassword()`, sin `server-only` para poder testearla en
  unidad, pero solo la llaman actions).
- `members.controller.ts` (`getPadron(filters)`, `getMemberPage(id)` que
  combina detalle + historia + URL firmada del apto vigente) y
  `members.actions.ts` (`createMember`, `updateMember`, `withdrawMember`,
  `reactivateMember`, `createFamilyGroup`, `assignFamilyGroup`,
  `setPaymentResponsible`, `prepareMedicalClearanceUpload`,
  `confirmMedicalClearance`, `updateMedicalClearance`). Revalidan
  `/socios` y `/socios/[id]`.
- `settings.controller.ts` + `settings.actions.ts` (disciplinas/categorías).
- `audit.controller.ts` (`getAuditPage(filters)`; resuelve `actor_id` →
  nombre con `listAppUsers`, admin ve todos).

**Servicios** (`src/services/`, adapters detrás de una interfaz):
- `auth-admin.service.ts`: la Admin API (admin client). Única puerta al
  `createAdminClient()` en el slice.
- `storage.service.ts`: `createSignedUploadUrl(path)`, `getSignedUrl(path,
  ttl)`, `objectExists(path)`; usa el **cliente de sesión** (así las policies
  de Storage aplican con el rol del usuario y el `owner` es quien sube).

**Vistas** (`src/views/`): `shell/` (`AppShell`, `NavItem`, `UserMenu`),
`auth/` (`LoginForm`, `ChangePasswordForm`), `users/` (incluye
`TemporaryPasswordDialog`, que muestra la temporal una sola vez), `members/`
(`MemberSearch`, `MemberFilters`, `MemberList`, `MemberRow`, `MemberForm`,
`MemberDetail`, `StatusHistory`, `WithdrawDialog`, `ReactivateDialog`,
`FamilyGroupPanel`, `MedicalClearancePanel`, `UploadClearance`), `users/`,
`settings/`, `audit/`, y `shared/` (§7.4).

### 7.3 Flujos clave (secuencia en prosa)

**Login.** `LoginForm` (client) → `signIn(formData)` → Zod → `supabase.auth.
signInWithPassword` (cliente de sesión; las cookies las escribe `@supabase/ssr`)
→ error genérico, o `redirect('/cambiar-contrasena')` si la fila propia tiene
`must_change_password`, o `redirect(next ?? '/')`. `proxy.ts` sigue igual:
refresca sesión, no autoriza. El layout de `(panel)` llama `getSession()`;
sin fila activa en `app_users`, muestra "sin acceso"; con flag prendido,
redirige a `/cambiar-contrasena`.

**Alta de usuario.** Admin en `/usuarios` → `createUser({ email, displayName,
role })` → `requireRole('admin')` → genera la temporal →
`authAdmin.createWithPassword(email, temporal)` (`email_confirm: true`) →
`upsertAppUser` con el cliente de sesión (auditado, actor = admin,
`must_change_password = true`) → `markPasswordReset(userId)` (marker) →
la action devuelve `{ temporaryPassword }` → la UI la muestra **una vez** en
un diálogo con "Copiar" y la instrucción "pasásela a la persona; le va a
pedir cambiarla al entrar". Sin mail, sin SMTP.

**Primer login / cambio obligatorio.** El usuario entra con la temporal →
`(panel)/layout` lo manda a `/cambiar-contrasena` → `ChangePasswordForm`
(contraseña actual, nueva, repetir) → `changePassword` → `auth.updateUser({
password, current_password })` → `confirmPasswordChanged()` verifica en
`auth.users` que el hash cambió y apaga el flag → `redirect('/')`. Mientras
el flag esté prendido, **RLS niega todo el dominio** aunque el usuario evite
la UI. El mismo formulario sirve para el cambio voluntario desde el menú del
usuario (sin el flag, la RPC no hace falta y no se llama).

**Restablecer contraseña (admin).** `/usuarios` → "Restablecer contraseña"
con confirmación ("La persona va a tener que cambiarla al entrar") →
`resetUserPassword(userId)` → temporal nueva → `authAdmin.setPassword` →
`markPasswordReset` → la UI la muestra una vez. La auditoría registra el
cambio de `must_change_password` con actor = admin; la contraseña no aparece
en ningún lado.

**Alta de socio.** `MemberForm` → `createMember` → `requireRole('admin',
'editor')` → Zod → `members.model.createMember` (INSERT con sesión) → trigger
crea el evento `admission` y el trigger de auditoría deja dos filas (members,
member_status_events) con el mismo actor → `revalidatePath('/socios')` →
`redirect('/socios/[id]')`. DNI duplicado: la unique violation se traduce a
`DomainError('Ya hay un socio con ese DNI', { field: 'dni' })` en el modelo.

**Baja.** `WithdrawDialog` (motivo obligatorio, fecha default hoy en zona
club, confirmación que nombra la consecuencia: "deja de generar cuota desde el
próximo mes; la ficha queda") → `withdrawMember` → `requireRole('admin')` →
`insertStatusEvent({ eventType: 'withdrawal', … })` → triggers validan y
actualizan `status`. Reactivación, igual.

**Apto físico.** `UploadClearance` elige archivo → (opcional, recomendado)
reduce imágenes en el browser a ≤ 2 MB con canvas → `prepareMedicalClearanceUpload({
memberId, mimeType, sizeBytes })` → `requireRole('admin','editor')`, valida
tipo/tamaño, arma `medical-clearances/<memberId>/<uuid>.<ext>`, `storage.
createSignedUploadUrl(path)` con sesión → el browser sube con
`uploadToSignedUrl` → `confirmMedicalClearance({ memberId, path, expiresOn })`
→ verifica que el objeto exista en ese path y que pertenezca al `memberId`
→ `createMedicalClearance` (auditado). Ver certificado: `getSignedUrl(path,
60)` desde el controller de la ficha; la vista abre el link y **nunca** lo
persiste. Un upload huérfano (subió y no confirmó) queda en el bucket sin
fila: se limpia con un script de mantenimiento, no es un problema de
integridad.

### 7.4 Primitivas compartidas de `src/views/shared/` (contrato)

Descritas, no codeadas. Todas sin data fetching, con `'use client'` solo
donde hay interacción, targets de 44 px, numerales tabulares donde hay
medición, sin kicker/eyebrow, sin tarjetas anidadas.

- `AppShell` (en `views/shell/`): barra superior con identidad del club,
  navegación por rol (móvil: barra inferior o sheet; desktop: lateral),
  `UserMenu` con nombre, rol y "Cerrar sesión". Recibe `session` y `nav`.
- `PageHeader`: título (h1) + descripción opcional + acción primaria opcional
  (slot). Sin eyebrow.
- `Panel`: sección con título h2 y cuerpo; opcional acción en el encabezado.
  No se anida.
- `DataList`: lista/tabla responsive: en móvil filas apilables (`ListRow` con
  título, subtítulo, meta a la derecha, chevron), en ≥ md tabla (`Table` de
  shadcn). Props: `items`, `renderRow`, `emptyState`, `loading`.
- `SearchInput` (con debounce y limpiar), `FilterBar` (chips/selects que
  escriben en la URL: los filtros viven en `searchParams`, no en estado
  local, para que "retomar después de una interrupción" funcione).
- `Pagination` keyset ("Ver más" / cursor).
- `StatusPill`: variantes `member-active`, `member-inactive`, y desde el slice
  2 `up-to-date`, `in-debt`; `RolePill` (`admin`/`editor`/`consulta`).
- `EmptyState`, `ErrorState`, `LoadingList` (skeleton).
- `ReasonDialog`: diálogo de confirmación con campo de motivo obligatorio y
  fecha, texto de consecuencia y botón que nombra la acción ("Dar de baja",
  "Reactivar", más adelante "Anular pago"). Nunca "Eliminar".
- `FormField*`: adaptadores de `react-hook-form` sobre `Field`/`Input`/
  `Select`/`Textarea` de shadcn con error inline (de Zod o de
  `DomainError.field`), `DateField` (teclado numérico en móvil), `PhoneField`,
  `DniField` (inputmode numérico, tabular).
- `Amount` (centavos → `formatCentsCompact`, tabular), `Dni` (tabular),
  `DateText` (`formatDate`), `DateTimeText`.
- `labels.ts`: mapas `MemberType`, `MemberStatus`, `AppRole`, `EventType`,
  `AuditOp` → texto en español.
- `WhatsAppLink`: botón que abre `wa.me/<E.164>` con el teléfono del socio o
  del contacto de pago (lo único de WhatsApp permitido).

### 7.5 Lo que va en Postgres vs. TypeScript (resumen)

Postgres: roles y su lectura (`private.*`), toda la matriz de permisos,
unicidad de DNI, coherencia practicante/categoría, un responsable por grupo,
transiciones de estado con fecha y motivo, inmutabilidad de `joined_on` y de
los eventos, auditoría completa y append-only, anti-lockout de admins,
límites y tipos del bucket. TypeScript: validación de entrada (Zod, `.strict()`
donde el payload lo permite), mensajes de dominio, orquestación de Auth Admin
API + fila de rol, URLs firmadas, revalidación, navegación por rol (UX, no
seguridad).

## 8. Dirección visual y briefs

**Modo**: Operate en todas las superficies. **Escena física**: un voluntario
en la cancha, al sol, con un celular de gama media, o en su casa de noche con
la compu; una sola persona en la sede con un teléfono. Eso fuerza **tema
claro** (no un toggle oscuro en este slice), tipografía con x-height alta y
tamaños generosos, contraste medido.

**Restricciones para la ronda de dirección** (no la reemplazan):
- Estrategia de color: **Restrained** con el naranja institucional como único
  acento (acciones primarias, selección, estado), con permiso para **un**
  campo Committed en la barra/identidad del panel. El naranja sobre blanco
  casi seguro no llega a 4,5:1 para texto: el token de texto naranja se
  oscurece hasta pasar y se documenta el valor medido.
- Una sola familia tipográfica (UI, datos y títulos), escala rem fija con
  ratio 1,125–1,2, **numerales tabulares** obligatorios en montos y DNI.
- Estructura de la categoría: barra superior + navegación lateral en
  desktop, navegación inferior en móvil; tablas que colapsan a filas
  apilables; formularios de una columna; sin modales salvo confirmación con
  consecuencias.
- Identidad: naranja y blanco, el logo del club en la barra y el login. El
  desarrollador no firma la interfaz.
- Piso de calidad de `CLAUDE.md` y `craft-floor.md`: sin eyebrow, sin
  tarjetas anidadas, sin métrica-héroe, íconos `lucide-react`, sombras con
  blur, targets 44 px, estados de carga/vacío/error en toda superficie async.

**Proceso** (obligatorio por `impeccable` y por `CLAUDE.md`; **confirmado
T5: la corre Tomás en el hilo principal ahora**): antes de repartir el
frontend, **el hilo principal corre con Tomás una única ronda**
`concept-seed --scope direction --mode operate` (decision page o structured
question), fija la dirección elegida y el resultado se le pasa a la tarea de
frontend T-F1 como insumo. T-F1 escribe el contrato de dirección (comentario
HTML en el root layout), los tokens en `globals.css`, el shell y las
primitivas, corre el finish review y el documenter (`DESIGN.md`). Las demás
tareas de frontend **heredan** y no vuelven a correr ni `context.mjs` en modo
seed ni `concept-seed`.

**Briefs** escritos en este pipeline con `surface-brief.mjs` (formato de la
skill) en `.impeccable/surfaces/`: `route-login.md`, `route.md` (shell y panel
inicial), `route-socios.md`, `route-socios-nuevo.md`, `route-socios-id.md`,
`route-usuarios.md`, `route-ajustes.md`, `route-auditoria.md`. Contienen
trabajo, audiencia, tarea principal, estados y rangos, interacción y
anti-objetivos; la "dirección seleccionada" queda marcada como pendiente de la
ronda.

## 9. Transversales

**Seguridad y secretos.** La secret key solo en `services/auth-admin.service.ts`
y el script de bootstrap. Ningún `SECURITY DEFINER` en `public` salvo las dos
RPC de contraseñas (D8), que necesitan leer `auth.users` y escribir una
columna sin grant; ambas con `revoke execute from public, anon`, `set
search_path = ''`, y acotadas en el cuerpo (`is_admin()` o `service_role` para
`mark_password_reset`; solo `auth.uid()` para `confirm_password_changed`).
Las demás RPC en `public` son SECURITY INVOKER con `revoke execute from
public, anon` y chequeo de rol en el cuerpo. Contraseñas temporales: se
generan en el servidor, viajan una vez, no se loguean (`log.ts` nunca recibe
el valor), no se persisten, no entran en `audit_log`.
Server Actions: `allowedOrigins` no hace falta (mismo origen). Cookies de
sesión las maneja `@supabase/ssr`. Rate limits de Auth por defecto; captcha no
(7 usuarios). Sin registro público: `enable_signup = false` local y en el
dashboard hosted, y un test que prueba que `POST /auth/v1/signup` con la
publishable key falla.

**Datos personales.** Sin DNI/nombres/teléfonos en logs (`log.ts`), en URLs
(`/socios/[id]` usa el id), en títulos de página ni en mensajes de error. La
auditoría **sí** guarda el antes/después de los datos personales (es su
función); por eso solo la lee `admin` y forma parte de la exportación
completa y del borrado final (contrato 10.2). Adjuntos: bucket privado, URLs
firmadas de 60 s, sin URL persistida. Los seeds usan datos inventados; los
CSV reales no se tocan.

**Auditoría, cobertura.** `enable_audit()` sobre `app_users`, `settings`,
`disciplines`, `categories`, `family_groups`, `members`, `member_status_events`,
`medical_clearances` (y en el slice 2, `fee_prices`, `fees`, `payments`).
Actor: `auth.uid()`; `explicit` por `app.actor_id` en bootstrap/jobs;
`system` cuando ninguno (solo el cron). Los `UPDATE` sin cambio real no
generan fila. `tests/db/` verifica actor y `changed_fields` en cada operación
del slice.

**Fallas y recuperación.** Alta de usuario: si Auth crea y la fila o el
marker fallan, el usuario existe en Auth sin rol (no ve nada), `/usuarios` lo
lista como "alta incompleta" y "Completar" regenera la temporal (upsert). Un
cambio de contraseña que actualiza Auth pero falla en la RPC deja el flag
prendido: el usuario vuelve a `/cambiar-contrasena`, pone la nueva como
actual y la RPC apaga el flag (fail-closed, sin pérdida). Upload: si
sube y no confirma, objeto huérfano sin fila (script de limpieza, no
integridad). Baja concurrente: el trigger valida contra el estado actual en la
misma transacción; dos bajas simultáneas → una gana, la otra recibe
`DomainError('El socio ya está dado de baja')`. Cambio de rol del propio
admin: bloqueado por trigger. No hay mails en la Fase 1: ningún flujo depende
de SMTP.

**Migraciones y reversibilidad.** Migraciones imperativas, una por bloque
(`0001_foundation`, `0002_catalogs`, `0003_members`, `0004_storage`), todas
idempotentes donde Postgres lo permite (`create … if not exists`, `DO $$` para
constraints y policies). No hay datos que migrar (base vacía). Rollback en
local = `db:reset`; en hosted, cada migración tiene su inversa documentada en
el encabezado. Tipos regenerados con `db:types` tras cada migración.

**Cache y revalidación.** Todas las pages del panel son dinámicas (leen
cookies). Sin Cache Components. Cada action revalida las rutas afectadas
(`/socios`, `/socios/[id]`, `/usuarios`, `/ajustes`) y `signIn`/`signOut`
revalidan el layout raíz.

**Observabilidad.** `log.ts` con `userId`/`memberId`; un `requestId` por
action cuando se pueda derivar; errores internos a `console.error` en JSON
(drains de Vercel). Advisors de Supabase (`get_advisors` o `supabase db
advisors`) corren al cerrar la lane de schema y sus hallazgos se resuelven o
justifican en el dev log.

**Prerrequisitos de ambiente de prueba** (fuera del código pero bloqueantes):
proyecto hosted en `sa-east-1` en un plan que no se pause; `enable_signup`
apagado y `secure_password_change` apagado en el dashboard; política de
contraseñas (10+, letras y dígitos) en el dashboard; bucket y policies vía
migración; `bootstrap-admin` una vez con la temporal impresa. **SMTP/Resend
ya no es prerrequisito de la Fase 1**: vuelve en la Fase 5 (avisos por mail).

## 10. Preguntas y decisiones

### Para Tomás — respondidas (2026-09-25)

| # | Pregunta | Respuesta | Dónde impacta |
|---|---|---|---|
| T1 | DNI nullable + unique parcial | **Confirmado** | D7, S3, B2, F2 |
| T2 | Subida directa a Storage con URL firmada | **Confirmado** | D11, B2, F2 |
| T3 | Usuarios nuevos | **Cambio: contraseña temporal generada por el sistema + cambio obligatorio en el primer login con enforcement en RLS; sin mail, sin SMTP en la Fase 1; "olvidé mi contraseña" = un admin restablece desde `/usuarios`** | D8, D9, §6.1, §6.4, §6.5, §7, S1, S5, B1, F1, F3 |
| T4 | `pg` + `@types/pg`, `engines.node >= 22` | **Sí, lo hace el hilo principal** | S5 |
| T5 | Ronda de dirección visual | **La corre Tomás en el hilo principal ahora; F1 arranca con lo decidido** | §8, D0, F1 |
| T6 | `/cobranza` y `/reportes` en la navegación | **No se muestran hasta que existan** | F1 |
| T7 | Bucket | **Uno, `attachments`, con prefijos por tipo** | S4, B2 |
| T8 | Login/logout en `audit_log` | **No se duplican** | S1 |

### Para la Comisión — pendientes (se sigue con los defaults recomendados hasta que respondan)

Bloque listo para mandar (WhatsApp o mail):

```
Hola Comisión. Para avanzar con el sistema necesito que definan estas nueve
cosas. Al lado de cada una va lo que propongo por defecto; si no me dicen
nada, seguimos con eso.

1. Socio sin DNI. ¿Puede quedar cargado un socio sin DNI (marcado como
   "DNI pendiente") para no frenar la carga del padrón viejo?
   → Propuesta: sí, con un aviso en el padrón hasta que lo completen.

2. Responsable de pago del grupo familiar. ¿Tiene que ser socio, o puede
   ser un papá/mamá que no es socio?
   → Propuesta: el responsable es un integrante del grupo, y además el grupo
   puede tener un contacto de pago (nombre y teléfono) que no sea socio.

3. Pago de varios meses. Cuando alguien paga varios meses juntos, ¿siempre
   se cubren los meses más viejos primero? ¿Pasa que alguien paga
   septiembre pero sigue debiendo julio?
   → Propuesta: siempre lo más viejo primero, sin elegir meses.

4. Apto físico. ¿Se puede cargar solo la fecha de vencimiento sin adjuntar
   el certificado (porque lo vieron en papel)? ¿Hasta qué edad se pide?
   → Propuesta: sí, adjunto opcional; se pide a menores de 18.

5. Descuentos. ¿Hay descuento por grupo familiar o por segundo hermano?
   → Propuesta: no por ahora (no está en la propuesta aceptada); se puede
   agregar después.

6. Cambio de categoría. Los chicos que suben de categoría cada año, ¿los
   cambian ustedes a mano desde la ficha?
   → Propuesta: a mano, queda registrado quién lo cambió.

7. No practicantes. ¿Empiezan a pagar cuota desde que arranca el sistema,
   con el mismo valor ($10.000)?
   → Propuesta: sí, mismo valor.

8. Baja y reactivación de socios. ¿Solo el Administrador (Presidencia y
   Tesorería) o también Secretaría?
   → Propuesta: solo Administrador, como dice la propuesta aceptada.

9. Motivos de baja. ¿Cuáles son los más comunes? (renuncia, pase a otro
   club, falta de pago, fallecimiento, otro)
   → Propuesta: texto libre con esas sugerencias.
```

Mapa a las decisiones: 1 → C1/D7, 2 → C2/D4, 3 → C3/D3, 4 → C4, 5 → C5,
6 → C6, 7 → C7/D5, 8 → C8, 9 → C9. Ninguna respuesta obliga a rehacer el
schema de este slice: 2 y 5 agregan columnas o filas de `fee_prices`; 3
agrega una tabla; 8 cambia una policy.
