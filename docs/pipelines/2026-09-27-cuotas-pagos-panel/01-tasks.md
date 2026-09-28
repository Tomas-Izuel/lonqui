# 01 — Tareas: cuotas, pagos, estado de cuenta y panel inicial (slice 2)

Deriva de `00-architecture.md` revisado con las respuestas de Tomás
(**T1: cron mensual el día 1 + `billing_runs` + aviso a admin con
"Reintentar"; T12: autorización por permisos con `private.can` y
`requirePermission`; T2–T11 confirmados; Revisión 3 / §13: un socio en
varios deportes, con `member_categories`, cargo por (socio, período,
deporte), precarga = suma, deuda por categoría atribuida cargo por cargo, y
los minors B2–B6 del code review del slice 1**). Cada tarea declara **lane**, **archivos que
posee en exclusiva** y **archivos que no puede tocar**. Dos agentes sobre el
mismo archivo colisionan en silencio: el corte es por directorio y es
disjunto. Los criterios de aceptación son el spec del `test-engineer`; lo
marcado **[DB]** solo se prueba contra la base local (`tests/db/`, con `pg`).

Idioma: comentarios y copy en español rioplatense, identificadores en inglés.
Ningún agente corre `npm install`, toca `supabase/**` ni resetea la base.

## Orden de ejecución

```
Paso 0  (hilo principal)  S0 socio↔categorías (nueva) + S1..S3 REESCRITAS + S4 seed/tipos + db:reset
Paso 0  (hilo principal)  SH1 types.ts │ SH1b session guards │ SH2 primitivas shared + labels │ SH3 brief /cobranza
Paso 1  (paralelo)        B1 facturación │ B2 pagos y cuenta │ B3 padrón (categorías múltiples + cuenta) │ B4 listados y panel
Paso 2  (paralelo, tras B)  F1 cobranza │ F2 alta/edición + ficha + padrón │ F3 panel inicial │ F4 ajustes
Paso 3  (paralelo)        test-engineer │ code-reviewer
```

B1–B4 no comparten archivos. B3 y B4 importan `accounts.model.ts` de B2 y
`billing.model.ts` de B1; nadie importa de B3/B4: si arrancan antes de que
B2 exista, escriben contra la firma de SH1 y `typecheck` cierra cuando ambos
aterrizan. F1–F4 dependen de su backend y de SH2. `views/shell/**` y
`ResponsiveSheet` en `views/shared/` los está terminando **otro agente de
frontend ahora**: F3 y F4 arrancan cuando ese agente cierra (§13.8).

Las migraciones `20260927130000_billing.sql`, `130100_payments.sql` y
`130200_accounts.sql` están aplicadas en local y **no commiteadas**: se
reescriben con lo de S1–S3 de abajo y se aplica `db:reset` (S4).

---

## Lane `schema` — hilo principal (los agentes no tocan `supabase/**`)

Antes de escribir SQL: skill `supabase-postgres-best-practices`
(`.claude/skills/supabase-postgres-best-practices/`, en especial
`references/lock-advisory.md`, `security-rls-performance.md`,
`security-privileges.md`, `query-partial-indexes.md`, `schema-constraints.md`,
`data-batch-inserts.md`) y skill `supabase` (`.claude/skills/supabase/`,
pg_cron y RLS). Docs de pg_cron vía Context7 (`/websites/supabase_guides`,
`cron/install`). Cada migración con reversa documentada en el encabezado.

### S0 — `20260927125000_member_categories.sql`: socio en varias categorías (corre antes de 0005)

**Debe contener** (§13.2 de `00-architecture.md`):
- `public.member_categories` con columnas (`member_id`, `category_id`,
  `joined_on`, `left_on`, `left_reason`, `created_by`, `created_at`,
  `left_by`, `left_at`), CHECKs (`left_on >= joined_on`; tríada de cierre
  coherente), índices (unique parcial `(member_id, category_id) where left_on
  is null`; parciales `(member_id) where left_on is null` y `(category_id)
  where left_on is null`; `(member_id, joined_on)`), triggers:
  `protect_immutable_columns('member_id','category_id','joined_on',
  'created_by','created_at')`; `member_categories_insert_guard` BEFORE
  INSERT **SECURITY DEFINER** (socio existe con `for update`; `joined_on`
  entre `members.joined_on` y hoy; categoría activa; ninguna inscripción
  abierta en la misma disciplina → mensaje que nombra deporte y categoría);
  `member_categories_close_guard` BEFORE UPDATE (solo `left_on`/`left_reason`
  null→valor una vez, `left_on <= club_today()`, fija `left_by`/`left_at`);
  `member_categories_sync_member_type` AFTER INSERT OR UPDATE **SECURITY
  DEFINER** que pone `members.member_type = case when exists (inscripción
  abierta) then 'practicing' else 'non_practicing' end`. RLS: SELECT
  `can('members.read')`, INSERT/UPDATE `can('members.write')`; grants insert
  (`member_id, category_id, joined_on`), update (`left_on, left_reason`);
  sin DELETE; `enable_audit`.
- Migración de datos: `insert into member_categories (member_id,
  category_id, joined_on) select id, category_id, joined_on from members
  where category_id is not null` (antes de crear el trigger de sync o con
  él, da igual: el resultado es coherente).
- `members`: `drop constraint members_practicing_has_category`; `drop index
  members_category_id_idx`; `alter table drop column category_id` (esto
  quita la columna de los grants por columna); `alter column member_type set
  default 'non_practicing'`; **`revoke insert (member_type), update
  (member_type)`** re-otorgando los grants por columna sin ella; `comment on
  column` "derivada: la escribe el trigger de member_categories"; índice
  parcial `(member_type) where member_type = 'practicing'` (opcional).
- `public.set_member_categories(target_member_id bigint, category_ids
  bigint[], effective_on date default null)` SECURITY INVOKER, `revoke from
  public, anon`, `grant to authenticated`, `can('members.write')` en el
  cuerpo; rechaza dos categorías de la misma disciplina; cierra las abiertas
  que no están y abre las que faltan con `effective_on` (default
  `club_today()`); no toca las que ya están abiertas.
- `AUDITED`: la tabla entra en `enable_audit`; el hilo principal agrega
  `member_categories` a `AUDITED_TABLES` del modelo y la page de
  `/auditoria` (junto con las tres del slice 2, review B1).

**Aceptación [DB]:**
- Tras la migración, cada socio que tenía `category_id` tiene exactamente
  una inscripción abierta con `joined_on = members.joined_on`; `members`
  no tiene la columna `category_id` ni el CHECK; `member_type` coincide con
  "tiene inscripción abierta" para todos.
- `UPDATE members set member_type` como `admin` → `permission denied`
  (columna sin grant); insertar una inscripción a un no practicante lo vuelve
  `practicing`; cerrar su única inscripción lo vuelve `non_practicing`.
- Dos inscripciones abiertas en la misma categoría → unique violation; en
  dos categorías de la misma disciplina → error del trigger con el mensaje;
  en dos disciplinas distintas → permitido; a una categoría inactiva →
  error; `joined_on` anterior al alta del socio o futuro → error.
- Cerrar: `left_on` null→valor una vez (con y sin motivo); segunda vez →
  error; volver a null → error; `UPDATE category_id/joined_on` → error de
  inmutabilidad; `DELETE` → sin privilegio para `authenticated` y
  `service_role`.
- `set_member_categories(m, {5ta, Sub18}, d)`: abre las dos; luego `{6ta,
  Sub18}` → cierra 5ta con `left_on = d2`, abre 6ta con `joined_on = d2`,
  deja Sub18 intacta; `{5ta, 6ta}` → error "una sola categoría por
  deporte"; `{}` → cierra todo y el socio queda `non_practicing`; como
  `consulta` → `insufficient_privilege`.
- Auditoría: cada INSERT/UPDATE deja fila con actor; la migración de datos
  deja filas `system`.
- `editor` lee e inserta; `consulta` solo lee.

### S1 — `0005_billing.sql` (REESCRITA): permisos, pg_cron, valores de cuota, cargos por deporte, generación, corridas, activación

> Cambios de la Revisión 3 sobre lo ya escrito: `fees.category_id` +
> `fees.discipline_id` congelados; índice único `(member_id, period,
> discipline_id) nulls not distinct where kind = 'monthly'`; generación por
> deporte con la regla de exclusión social/deporte (D30); guards
> `settings_billing_guard`, `fee_prices_insert_guard`,
> `fees_opening_balance_guard` **SECURITY DEFINER** (review B4);
> `fees_member_not_voided_idx` eliminado (B6). El contrato de
> `public.generate_pending_fees()` es **devolver** `(status, fees_created,
> error_message)` — como ya está escrito — y no relanzar.

**Debe contener** (§6.1, §6.2, §6.4, §6.5, §6.8 de `00-architecture.md`):
- **Permisos (T12), primero de todo:** `private.permissions_for_role(role
  text) → text[]` (`IMMUTABLE`, `case` con el mapeo de §6.8; comentario que
  dice que el pipeline de roles lo reemplaza por una lectura de
  `role_permissions`), `private.can(permission text) → boolean` (SECURITY
  DEFINER, `STABLE`, `set search_path = ''`, `revoke from public, anon`,
  `grant to authenticated, service_role`; null → false),
  `public.my_permissions() → text[]` (SECURITY DEFINER, mismo régimen;
  `{}` sin rol). Comentario en el SQL con el catálogo completo y la deuda
  del slice 1 (sus policies siguen con `has_role`). Toda policy, trigger y
  RPC de S1–S3 usa `(select private.can('…'))`, **nunca** `has_role` ni
  `is_admin`.
- `create extension if not exists pg_cron with schema pg_catalog; grant usage
  on schema cron to postgres; grant all privileges on all tables in schema
  cron to postgres;`
- `public.fee_prices` con CHECKs (scope/coherencia, `amount_cents >= 0`,
  `valid_from` primer día de mes), unique compuesto con `coalesce`, índice en
  `category_id`, trigger `forbid_change` (sin UPDATE/DELETE), trigger BEFORE
  INSERT: `valid_from >= date_trunc('month', private.club_today())` y rechazo
  si existe `fees` con `kind = 'monthly' and period = new.valid_from`
  (mensaje que nombra el mes y el siguiente). RLS: SELECT
  `can('payments.read')`, INSERT `can('billing.configure')`; grants por
  columna; `enable_audit`.
- `private.fee_price_for(category_id bigint, member_type text, period date)`
  → `(fee_price_id bigint, amount_cents bigint)`, `STABLE`, precedencia
  categoría > tipo > default, mayor `valid_from <= period` dentro del scope.
- `public.fees` con columnas de §6.2 **más `category_id bigint null` FK y
  `discipline_id bigint null` FK (índices; CHECK de §13.3: en `monthly`
  ambos o ninguno; en los demás `kind`, ambos null; inmutables)**, CHECKs
  (`period` primer día, `kind`, `amount_cents >= 0`, void tríada,
  `void_reason >= 3`), índices (**unique parcial `(member_id, period,
  discipline_id) nulls not distinct where kind = 'monthly'`** incluyendo
  anuladas; unique parcial `(member_id) where kind = 'opening_balance' and
  voided_at is null`; `(period)`; `(member_id, period)`; `(fee_price_id)`;
  **sin** `fees_member_not_voided_idx`),
  triggers: `protect_immutable_columns(...)`, `fees_void_guard` (null→valor
  una vez; `can('payments.void')`; `voided_by = auth.uid()`; `voided_at =
  now()` si vienen nulos), `fees_opening_balance_guard` BEFORE INSERT (solo
  para `opening_balance`: `billing_start_period` no nulo o excepción
  "Primero activá las cuotas en Ajustes"; `new.period := billing_start_period
  - interval '1 month'`; `amount_cents > 0`; `description` default). RLS:
  SELECT `can('payments.read')`; INSERT `can('payments.register')` con `with
  check (kind = 'opening_balance' and created_by = (select auth.uid()))`;
  UPDATE `can('payments.void')` (policy; el trigger lo vuelve a exigir);
  grants: insert (`member_id, kind, amount_cents, description`), update
  (`voided_at, voided_by, void_reason`); `enable_audit`.
- **`public.billing_runs`** (T1, §6.4): `id`, `period date` (primer día),
  `trigger text` CHECK in (`cron`, `manual`), `actor_id uuid null`,
  `started_at timestamptz not null default now()`, `finished_at timestamptz
  null`, `status text` CHECK in (`ok`, `error`, `skipped`), `fees_created int
  not null default 0`, `error_message text null`, **`notified_at timestamptz
  null`** con `comment on column` que dice: "Reservada para el job de avisos
  por mail (Fase 5): marca cuándo se avisó de una falla. Sin consumidor hoy".
  Índices `(period, started_at desc)` y parcial `(started_at desc) where
  status = 'error'`. Trigger `forbid_change` en UPDATE/DELETE. RLS: SELECT
  `can('billing.configure')`; **sin grants** de INSERT/UPDATE/DELETE para
  `anon`, `authenticated` ni `service_role` (solo `service_role` SELECT).
  **No** se llama a `enable_audit` (tabla técnica; el porqué en §6.4).
- `private.generate_monthly_fees(target_period date) → int` (DEFINER,
  `set search_path = ''`, advisory xact lock, **una sola sentencia** `insert
  … select … on conflict (member_id, period, discipline_id) where kind =
  'monthly' do nothing` que une (a) por socio activo con `joined_on <=
  fin(P)` y por **disciplina** con alguna inscripción que solape P, la
  categoría de la inscripción más reciente en P y su precio
  `fee_price_for(category_id, 'practicing', P)`, `category_id` y
  `discipline_id` congelados, `description` "Cuota MM/YYYY · <categoría>";
  (b) por socio activo sin inscripción que solape P, la cuota social
  `fee_price_for(null, 'non_practicing', P)` con `category_id` null y
  `description` "Cuota social MM/YYYY"; y la **regla de exclusión D30**:
  (a) solo si no existe ya un cargo social de P para el socio, (b) solo si
  no existe ya un cargo por deporte de P; monto y `fee_price_id` congelados;
  chequeo previo de precio faltante que recorre deportes y sociales —el
  mensaje nombra la categoría o "Cuota social", **nunca al socio**—; no-op
  si `billing_start_period` es null o el período es anterior) y `private.generate_pending_fees(run_trigger
  text, run_actor uuid default null) → int` (loop de períodos desde el inicio
  hasta el actual en zona club; cada período en un bloque `begin … exception
  when others` que registra la fila de `billing_runs` con `status`,
  `fees_created`, `error_message = sqlerrm`, `finished_at`; se detiene en el
  primer error; registra fila solo si `fees_created > 0`, hubo error, o es
  el período actual; con facturación inactiva o inicio futuro registra una
  única fila `skipped`). `revoke execute … from public, anon, authenticated`.
- `public.generate_pending_fees() → table (status text, fees_created int,
  error_message text)` (DEFINER, `revoke from public, anon`, `grant to
  authenticated`, `can('billing.configure')` en el cuerpo o excepción
  `insufficient_privilege`; llama a la privada con `'manual'` y
  `auth.uid()`). **Devuelve** el resultado, **no relanza**: relanzar
  revertiría la fila de `billing_runs` que registra la falla. La action
  mapea `error` → `DomainError(error_message)`, `skipped` → mensaje
  informativo, `ok` → `{ generated }`.
- Trigger BEFORE UPDATE en `settings` (`billing_start_period`): no vuelve a
  null; al fijarlo `>= mes actual`; exige `fee_prices` default con
  `valid_from <=` el mes; cambiable solo si no existe ninguna `fee` mensual;
  cualquier cambio exige `can('billing.configure')`. **Este guard,
  `fee_prices_insert_guard` y `fees_opening_balance_guard` son SECURITY
  DEFINER** (review B4): leen `fees`/`fee_prices`/`settings` sin depender de
  la RLS de quien escribe.
- `cron.unschedule` idempotente + **`cron.schedule('lonqui-generate-fees',
  '5 3 1 * *', $$select private.generate_pending_fees('cron')$$)`** (T1:
  una vez por mes, el día 1) y `cron.schedule('lonqui-cron-cleanup', '0 4 * *
  *', $$delete from cron.job_run_details where end_time < now() - interval
  '90 days'$$)`. Comentario en el SQL: 03:05 UTC del día 1 = 00:05 del 1° en
  Argentina, sin horario de verano; la memoria de las corridas es
  `billing_runs`, no `job_run_details`.

**Aceptación [DB]:**
- Permisos: `private.can('payments.register')` es true con claims de
  `editor` y `admin`, false con `consulta`; `can('payments.void')` solo
  `admin`; `can('reports.export')` true para los tres; con `is_active =
  false` o `must_change_password = true` **todo** `can` es false y
  `my_permissions()` devuelve `{}`; `my_permissions()` devuelve exactamente
  el array de §6.8 por rol; `anon` no puede ejecutar ninguna de las dos;
  ninguna policy/trigger/RPC de las migraciones 0005–0007 contiene
  `has_role` ni `is_admin` (grep sobre `pg_get_functiondef` y
  `pg_policies`).
- `fee_prices`: `editor` no inserta; `admin` sí; `UPDATE`/`DELETE` fallan
  como `admin`, `service_role` y `postgres`; `valid_from` de un mes pasado →
  error; `valid_from` = un mes con cuotas mensuales generadas → error con el
  mensaje que nombra el mes; dos filas mismo scope/target/`valid_from` →
  unique violation.
- `fee_price_for`: con default $10.000 y categoría X $12.000 desde octubre,
  un socio de X en septiembre → 10.000, en octubre → 12.000; un socio
  practicante de otra categoría con precio por tipo → el de tipo; sin filas →
  null.
- `settings`: fijar `billing_start_period` sin precio default → error; con un
  mes pasado → error; volver a null → error; cambiar con cuotas existentes →
  error; cambiar sin cuotas → permitido.
- Generación (fixture: A en 5ta; B en 5ta **y** Sub 18; C no practicante; D
  que sube de 5ta a 6ta el 15 de P; E no practicante que se anota en vóley el
  20 de P; F en 5ta que deja todo el 10 de P; G se anota en vóley el 20 de P
  teniendo ya fútbol): `generate_monthly_fees(P)` crea **A: 1** (5ta), **B:
  2** (5ta + Sub 18, `discipline_id` distintos), **C: 1** social
  (`category_id` null), **D: 1** (la categoría más reciente en P: 6ta si el
  ascenso fue antes de la corrida; si la corrida fue el día 1 con 5ta, una
  segunda corrida después del ascenso **no** crea la de 6ta: índice por
  disciplina), **E: 1 social** y una segunda corrida tras su inscripción
  **no** crea la de vóley (D30), **F: 1** de 5ta y una segunda corrida tras
  su baja **no** crea social (D30), **G: +1** de vóley en la segunda corrida
  (mes de alta completo); cada fila con `amount_cents` = precio de su
  categoría (o social), `fee_price_id`, `kind = 'monthly'`, `created_by`
  null como `postgres`; **la corrida repetida crea 0**; socio con
  `joined_on` posterior al fin de P no recibe; socio `inactive` no recibe;
  reactivado recibe desde el mes de la reactivación; `billing_start_period`
  null → 0 y ninguna fila; `generate_pending_fees()` con inicio dos meses
  atrás y nada generado → crea los tres períodos; como `editor` la RPC
  pública → `insufficient_privilege`; como `admin` → crea y la fila de
  `audit_log` tiene `actor_source = 'session'` y su id; como `postgres` sin
  JWT (simula el cron) → `actor_source = 'system'`; con `fee_prices` por
  categoría para 5ta y default para el resto, B paga 5ta al precio de 5ta y
  Sub 18 al default.
- Dos cargos sociales del mismo socio y período → unique violation (`nulls
  not distinct`); dos cargos de fútbol del mismo socio y período (5ta y
  6ta) → unique violation; fútbol y vóley → permitido.
- Job en `cron.job` con nombre `lonqui-generate-fees`, schedule **`5 3 1 * *`**,
  command con `private.generate_pending_fees('cron')`.
- **Corridas (`billing_runs`, T1):** una corrida `cron` exitosa deja una fila
  `status = 'ok'`, `trigger = 'cron'`, `actor_id` null, `fees_created = N`,
  `finished_at` set; una corrida `manual` como `admin` deja `trigger =
  'manual'` y `actor_id` = el admin; con un socio sin precio resoluble (se
  inserta en el test un socio de una categoría sin precio y se anula el
  default… o se simula con un `fee_prices` vacío antes de activar) la
  corrida deja `status = 'error'` con `error_message` **sin nombres ni DNI**
  y **cero filas en `fees` para ese período** (nada a medias: se verifica
  contando antes y después); el reintento tras cargar el precio crea las N
  cuotas y deja una fila `ok` nueva (la de error queda); segundo reintento
  → fila `ok` con `fees_created = 0` para el período actual y ninguna fila
  para meses viejos sin novedades; con facturación inactiva → una fila
  `skipped`; `UPDATE`/`DELETE` sobre `billing_runs` fallan como `admin`,
  `service_role` y `postgres`; `editor`/`consulta` leen 0 filas; `admin` las
  lee; **no** hay filas de `billing_runs` en `audit_log`; `notified_at` es
  null en todas.
- `fees`: `editor` inserta `opening_balance` (con `created_by = su uid`) y
  el trigger fija `period = inicio − 1 mes`; con `billing_start_period` null →
  error legible; `editor` **no** inserta `kind = 'monthly'` ni `'adjustment'`;
  segundo `opening_balance` vigente → unique violation; anulado → se puede
  cargar otro; `UPDATE amount_cents/period/kind` → error de inmutabilidad
  también como `postgres`; anular como `editor` → error; como `admin` → OK,
  `voided_by` = admin; anular dos veces → error; `void_reason` de 2 caracteres
  → CHECK; `authenticated` sin DELETE.
- Borde horario: con `now()` simulado a `2026-09-30 23:30 -03` (02:30 UTC
  del 1/10) el período actual que calcula el generador es `2026-09-01`.

### S2 — `0006_payments.sql` (REESCRITA en dos puntos): pagos

> Revisión 3: se elimina `payments_batch_id_idx` (prefijo de la unique,
> review B6) y `payments_update_guard` rechaza adjuntar comprobante a un pago
> anulado o que se anula en la misma sentencia (review B3).

**Debe contener** (§6.3): tabla `payments` con columnas, CHECKs (`amount_cents
> 0`, `method`, `receipt_storage_path like 'payment-receipts/%'`, tríada de
void), índices (unique `(batch_id, member_id)`, `(member_id, paid_on desc, id
desc)`, `(paid_on)`, parcial no anuladas; **sin** `(batch_id)` suelto), triggers:
`protect_immutable_columns('member_id','amount_cents','paid_on','method',
'batch_id','created_by','created_at')`, `payments_paid_on_guard` (BEFORE
INSERT: `paid_on <= private.club_today()` y `>= '2020-01-01'`),
`payments_update_guard` (void null→valor una vez y solo `can('payments.void')`,
`voided_by/at` autocompletos; `receipt_storage_path` solo null→valor, nunca
valor→otro ni valor→null, **y nunca sobre un pago anulado ni en la misma
sentencia que lo anula** ("Un pago anulado no lleva comprobante"); anular
exige `can('payments.void')`, comprobante exige `can('payments.register')`). RLS: SELECT `can('payments.read')`;
INSERT `can('payments.register')` con `created_by = (select auth.uid())`;
UPDATE `can('payments.register') or can('payments.void')`; grants:
insert (`member_id, amount_cents, paid_on, method, receipt_storage_path,
receipt_filename, notes, batch_id`), update (`voided_at, voided_by,
void_reason, receipt_storage_path, receipt_filename`); `service_role` SELECT;
`enable_audit`.

**Aceptación [DB]:** `consulta` no inserta; `editor` inserta con `created_by`
propio y no puede insertar con `created_by` ajeno (policy); un `INSERT` de
tres filas con el mismo `batch_id` es atómico (una falla → ninguna queda);
segunda inserción `(batch_id, member_id)` → unique violation; `paid_on` de
mañana (zona club) → error; `UPDATE amount_cents` → error como `admin` y
`postgres`; anular como `editor` → error; como `admin` → OK y `audit_log`
con `changed_fields = {void_reason, voided_at, voided_by}`; anular dos veces
→ error; adjuntar comprobante null→valor como `editor` → OK; reemplazarlo →
error; quitarlo → error; **adjuntar a un pago anulado → error; anular y
adjuntar en el mismo UPDATE → error**; `authenticated` sin DELETE;
`service_role` sin INSERT/UPDATE; no existe el índice `payments_batch_id_idx`.

### S3 — `0007_accounts.sql` (REESCRITA): deuda derivada, campos calculados, RPCs, gancho de exportación

> Revisión 3 (§13.5): `private.member_fee_coverage(member_id)` como núcleo
> compartido del statement y de la deuda por categoría; `member_accounts` con
> `categories jsonb`, `current_fees jsonb`, `current_fee_cents` = suma, y
> `category_filter`; `debt_by_category` con atribución cargo por cargo, filas
> `social` y `opening_balance`, `kind` y `discipline_id`; `dashboard_summary`
> con `reactivations_count` aparte (B6); `log_export` con lista cerrada de
> `listing` y tope de 4 KiB para `filters` (B5).

**Debe contener** (§6.6, §13.5): `private.member_balance(member_id)`;
**`private.member_fee_coverage(member_id)` → por cargo no anulado
(`fee_id`, `period`, `kind`, `category_id`, `discipline_id`, `amount_cents`,
`covered_cents`, `uncovered_cents`) con cobertura oldest-first (orden
`period`, arranque antes que cuotas, `discipline_id` nulls first, `id`)**;
campos calculados `public.member_debt_status(public.members)`,
`public.member_balance_cents(public.members)`,
`public.member_months_due(public.members)` (`STABLE`, INVOKER, `set
search_path = ''`, `revoke from public, anon`, `grant to authenticated`);
RPCs `member_accounts(member_ids bigint[] default null, status_filter text
default 'active', category_filter bigint default null)` (con `categories
jsonb` de inscripciones abiertas, `current_fee_cents` = suma de los cargos
mensuales no anulados del período actual o de los precios resueltos de sus
inscripciones abiertas / la social, y `current_fees jsonb` con el desglose),
`member_fee_statement(target_member_id bigint)` (sobre `member_fee_coverage`;
cada línea trae `category_name`/`discipline_name` del cargo),
`month_collection(target_period date default null)`, `dashboard_summary()`,
`debt_by_category()`, `monthly_history(months int default 12)` — todas
`setof`/`returns table`, INVOKER, `STABLE`, mismo régimen de grants, y con
el chequeo de permiso **en el cuerpo** (`can('payments.read')` para cuentas,
statement, cobranza del mes y campos calculados; `can('reports.read')` para
panel, por categoría e historia; excepción `insufficient_privilege` si no) —
y `public.log_export(listing text, filters jsonb, row_count int)` (DEFINER,
`can('reports.export')`, **`listing` en la lista cerrada `members, debt,
up_to_date, debt_by_category, month_payments, audit` y `pg_column_size(
filters) <= 4096`, si no `raise`**, inserta `EXPORT` en `audit_log` con
`actor_source = 'session'`). `debt_by_category()` devuelve `kind text`
(`category | social | opening_balance`), `category_id`, `category_name`,
`discipline_id`, `discipline_name`, `members`, `members_in_debt`,
`debt_cents`, `sort_order`, con la atribución D31/D32 (la categoría **congelada en el
cargo**, decidido por Tomás).
`dashboard_summary` suma `reactivations_count` y `admissions_count` cuenta
solo `admission`. Nada de `service_role` en las RPC de lectura (no las
necesita).

**Aceptación [DB]** (fixture: socio A con cuotas jul/ago/sep de $10.000; B con
saldo de arranque $20.000 + sep; C al día; D con pago de $30.000 en agosto;
E de baja con deuda; F con un pago anulado; G con pago de $15.000 y una
cuota):
- A sin pagos: `balance 30.000`, `months_due 3`, `oldest_due_period
  2026-07-01`, `debt_status in_debt`; pago de $10.000 → `months_due 2`,
  oldest = agosto; pago de $25.000 total → statement: jul `paid`, ago `paid`,
  sep `partial` con `covered_cents 5.000`, `months_due 1`.
- B: `months_due 2` (el arranque cuenta como ítem), statement con el arranque
  primero, `status due`.
- D con $30.000 pagados y $20.000 cargados → `balance −10.000`, `debt_status
  credit`, `months_due 0`; al generar la cuota siguiente → `balance 0`,
  `up_to_date`.
- F: el pago anulado no cuenta en `paid_cents` ni en `last_payment_*`.
- G: `last_payment_on/cents` correctos; `current_fee_cents` = la cuota del
  período actual si existe, si no el precio resuelto; null con facturación
  inactiva; con socio de baja, precio resuelto igual (la UI decide).
- Campos calculados: `select … from members where member_debt_status(members)
  = 'in_debt'` devuelve exactamente A, B, E (E solo si se incluyen inactivos);
  PostgREST: `GET /members?select=id,member_debt_status&member_debt_status=eq.in_debt`
  con claims de `consulta` responde.
- `member_accounts(null, 'active')` excluye E; `('inactive')` solo E;
  `(array[A,B])` dos filas; `consulta` la ejecuta; `anon` no.
- `month_collection('2026-09-01')`: suma pagos con `paid_on` en septiembre
  aunque cubran julio; separa `cash`/`transfer`; excluye anulados;
  `fees_cents` = solo `monthly` del período, no arranque.
- `dashboard_summary()`: `total_debt_cents` suma **solo positivos** de
  **activos** (D con crédito no resta; E no suma), `inactive_debt_cents` = E,
  `members_in_debt` cuenta A y B, `admissions_count` (solo `admission`),
  `reactivations_count` y `withdrawals_count` por `effective_on` del mes,
  `expired_clearances` cuenta menores activos con
  apto vencido, `pending_periods` vacío tras generar y `{2026-09-01}` si se
  borra la generación del mes en el fixture; `billing_active` false con
  `billing_start_period` null y todo en cero, sin error.
- `debt_by_category()` (fixture de S1 más pagos): una fila por categoría con
  inscripciones abiertas hoy, más `social` y `opening_balance`; **B (5ta +
  Sub 18) aparece en `members` de las dos filas**; su deuda se reparte según
  qué cargos quedaron sin cubrir (si pagó $10.000 de $20.000, el cargo más
  viejo por orden se cubre y el otro queda: un deporte en deuda, no dos
  mitades); D (subió a 6ta con deuda de 5ta) figura en **6ta** con esa deuda
  y 5ta no la muestra; un socio que dejó fútbol con deuda de fútbol figura
  en la categoría congelada del cargo; **`sum(debt_cents)` de todas las
  filas = `dashboard_summary.total_debt_cents`** (con saldos de arranque y
  sociales incluidos, y un socio con saldo a favor aportando 0);
  `member_fee_statement` y `member_fee_coverage` dan la misma cobertura por
  cargo.
- `member_accounts(null, 'active', <5ta>)` devuelve solo socios con
  inscripción abierta en 5ta (B y A, no D); `categories` de B trae dos; C
  trae `[]`; `current_fee_cents` de B = suma de sus dos cuotas y
  `current_fees` trae el desglose; de C = la social; de un socio sin cuotas
  generadas aún = suma de precios resueltos de sus inscripciones abiertas.
- `monthly_history(12)`: 12 filas incluida la actual; para un mes P la
  `debt_at_close_cents` usa pagos con `paid_on <=` fin de P y cargos con
  `period <= P`; un socio dado de baja en P+1 **sí** cuenta en P; anular un
  pago de P baja la deuda de P retroactivamente; `collected_cents` de P = lo
  mismo que `month_collection(P)`.
- Ninguna RPC devuelve un saldo negativo como deuda: los negativos van en
  `credit_cents`/`debt_status = 'credit'`.
- `log_export` como `consulta` inserta una fila `EXPORT` con su id y
  `context.listing`; como `anon` → error; `listing = 'cualquiera'` → error;
  `filters` de 5 KiB → error.
- Permisos en RPCs: un usuario de prueba al que se le simula un rol sin
  `reports.read` (en el test, un `app_users.role` válido pero con
  `permissions_for_role` stubeada vía `set local`… si no es viable, se
  documenta y se prueba solo el camino positivo) recibe
  `insufficient_privilege` en `dashboard_summary`; `consulta` la ejecuta.

### S4 — Seed, tipos y config del hilo principal

- `supabase/seed.sql`: **socios con `member_categories` en vez de
  `category_id`** (uno en dos deportes —fútbol y vóley—, uno que subió de
  categoría con la vieja cerrada, uno que dejó su deporte y quedó no
  practicante, los demás como hoy); `fee_prices` default $10.000 con
  `valid_from = date_trunc('month', private.club_today())`, un valor por
  categoría distinto (para probar precedencia) desde el mes siguiente;
  `settings.billing_start_period = mes actual`; `select
  private.generate_pending_fees('cron')`; saldos de arranque
  para dos socios inventados; pagos inventados con `batch_id` (uno de tres
  meses, uno parcial, uno de transferencia con `receipt_storage_path` null,
  uno anulado con motivo, un lote de grupo familiar). Siempre `created_by`
  null (corre sin sesión) y montos redondos.
- `npm run db:reset` (obligatorio: las tres migraciones del slice 2 ya
  aplicadas se reescriben y S0 corre antes que ellas) y `npm run db:types`
  (los agentes usan `database.types.ts` regenerado con las tablas, campos
  calculados y RPCs).
- Cierre del blocker B1 del review y de `AUDITED_TABLES` (modelo + page de
  `/auditoria`) con `member_categories`, `fee_prices`, `fees`, `payments`.
- `.impeccable/surfaces/route-socios-nuevo.md` y `route-socios-id.md`:
  el hilo principal pega el texto de §13.6 (sección "Deportes y categorías")
  o F2 lo registra en su dev log.
- `src/lib/dates.ts` (hilo principal, `lib/` es suyo): `periodRange(from,
  to)`, `addMonths(period, n)`, `previousPeriod(period)`, `lastDayOfPeriod`
  si los agentes los necesitan (pequeños, puros, testeables).
- Nada en `config.toml`: pg_cron local ya está precargado.

---

## Lane `shared` — hilo principal (contratos)

### SH1 — `src/models/types.ts`

Agregar exactamente lo de §8.2 de `00-architecture.md`: `FeePriceScope`,
`FeePrice`, `FeePriceInput`, `FeeKind`, `Fee`, `FeeStatementStatus`,
`FeeStatementLine`, `PaymentMethod`, `Payment`, `PaymentListItem`,
`DebtStatus`, `MemberAccount`, `MemberAccountDetail`, `MemberPageData`,
`BillingStatus`, `FeePricesOverview`, `MonthCollection`, `DashboardSummary`,
`DebtByCategoryRow`, `MonthlyHistoryPoint`, `DashboardData`,
`AccountListFilters`, `PaymentFormData`; `MemberSummary` + `debtStatus`,
`balanceCents`, `monthsDue`; `AuditedTable` + `fee_prices | fees | payments`;
`MemberFilters.debt` sin cambios de valores (quitar el comentario "sin
efecto"). **Revisión 3:** `MemberCategoryRef` (`categoryId`, `categoryName`,
`disciplineId`, `disciplineName`), `MemberCategoryMembership` (`id` +
`MemberCategoryRef` + `joinedOn`, `leftOn | null`, `leftReason | null`,
`leftByName | null`); `Member` pierde `categoryId`; `MemberSummary` y
`MemberAccount` reemplazan `categoryName/disciplineName` por `categories:
MemberCategoryRef[]`; `MemberDetail` pierde `categoryId/categoryName/
disciplineId/disciplineName` y suma `categories` (abiertas) y
`categoryHistory: MemberCategoryMembership[]`; `MemberType` queda y se
documenta como **derivado** (lo escribe la base); `CreateMemberInput` pierde
`memberType`/`categoryId` y gana `categoryIds: number[]` (una por
disciplina, validado en Zod contra el catálogo); `SetMemberCategoriesInput`
(`memberId`, `categoryIds`, `effectiveOn?`); `LeaveCategoryInput`
(`membershipId`, `leftOn`, `reason?`); `FeeStatementLine` y `Fee` suman
`categoryId | null`, `categoryName | null`, `disciplineName | null`;
`MemberAccount` suma `currentFees: { categoryId | null, categoryName,
disciplineName | null, amountCents }[]`; `DebtByCategoryRow` suma `kind:
'category' | 'social' | 'opening_balance'` y `disciplineId | null`;
`DashboardSummary` suma `reactivationsCount` y documenta que
`admissionsCount` cuenta solo altas; `AuditedTable` suma `member_categories`;
`AccountListFilters.categoryId` filtra por inscripción abierta. **T1:**
`BillingRunStatus`, `BillingRunTrigger`, `BillingRun`;
`BillingStatus` con `currentPeriodRun: 'ok' | 'failed' | 'missing' |
'not_due'`, `lastRun`, `recentRuns`. **T12:** `Permission` (unión literal de
las doce claves de §6.8, en el mismo orden) y `SessionInfo.permissions:
Permission[]`. Fechas como `ISODate`/`ISODateTime`; centavos como `number`.

### SH1b — `src/controllers/session.controller.ts` y `src/models/session.model.ts` (T12)

`session.model.getOwnPermissions()` (RPC `my_permissions`, cliente de sesión,
devuelve `Permission[]`; `[]` ante cualquier error de lectura, fail-closed).
`getSession()` la llama en `Promise.all` con `getOwnAppUser` y expone
`permissions`. `requirePermission(...permissions: Permission[])`: mismas
cuatro condiciones de `requireRole` (sesión, contraseña temporal, rol activo)
y además **todos** los permisos pedidos presentes, si no `PermissionError`.
`requirePanelPermission(...permissions)`: como `requirePanelAccess` pero con
permisos (redirige a `/` si falta alguno). `requireRole` y
`requirePanelAccess` **no se tocan** (slice 1). Comentario en el archivo que
apunta a §6.8 y a la deuda del slice 1.

**Aceptación (unidad, con mocks del modelo):** `requirePermission('payments.void')`
tira para una sesión con permisos de `editor` y pasa con los de `admin`;
pide varios y falta uno → tira; sin sesión / con `mustChangePassword` / sin
rol → tira aunque `permissions` traiga algo; `requirePanelPermission`
redirige en esos mismos casos; `getSession` con `getOwnPermissions`
fallando devuelve `permissions: []`.

### SH2 — `src/views/shared/**` y `labels.ts`

`AmountField` en `form-fields.tsx` (react-hook-form; muestra pesos, entrega
centavos; `inputMode="decimal"`, tabular; mensaje "Ingresá un monto válido");
`StatusPill` variante `credit` + `DebtStatusPill({ status })`; `PeriodText`
(`formatPeriod`); `labels.ts`: `paymentMethodLabels` (`cash` "Efectivo",
`transfer` "Transferencia"), `debtStatusLabels` ("Al día", "Con deuda",
"Saldo a favor"), `feeKindLabels` ("Cuota", "Saldo anterior", "Ajuste"),
`feeStatementStatusLabels` ("Pagada", "Parcial", "Adeudada", "Anulada"),
`feePriceScopeLabels` ("Por defecto", "Por tipo de socio", "Por categoría").
Sin cambiar la firma de ninguna primitiva existente.

### SH3 — Brief `.impeccable/surfaces/route-cobranza.md`

Escrito por el planner en este pipeline. Las adiciones a la ficha, el padrón
y ajustes están en §10 de `00-architecture.md`; el hilo principal decide si
las pega en los briefs existentes.

---

## Lane `backend` — `senior-backend-engineer`

Reglas comunes: escrituras con el cliente de sesión; ningún
`createAdminClient()` en este slice; **`requirePermission(...)` en toda action
nueva y `requirePanelPermission(...)` en todo controller de lectura nuevo
(T12; nunca `requireRole` en código nuevo; donde abajo dice "solo `admin`" o
"`admin`/`editor`" léase el permiso de §6.8 entre paréntesis)**; Zod v4 `.strict()`;
errores de Postgres traducidos a `DomainError` con `field` cuando hay campo;
logs con ids y montos, nunca nombres; `revalidatePath('/', 'layout')` en las
actions de escritura (T11). Dev log en
`docs/pipelines/2026-09-27-cuotas-pagos-panel/02-development-backend-<id>.md`.

### B1 — Facturación: valores de cuota, activación, generación

**Posee:** `src/models/fee-prices.model.ts`, `src/models/billing.model.ts`,
`src/models/settings.model.ts` (modificar), `src/controllers/settings.controller.ts`
(modificar), `src/controllers/settings.actions.ts` (modificar),
`src/controllers/billing.actions.ts` (nuevo).
**No toca:** `types.ts`, `session.controller.ts`, `lib/**`, `views/**`,
`app/**`, `supabase/**`, `tests/**`, nada de B2/B3.

**Aceptación:**
- Permisos: `createFeePrice`, `activateBilling`, `generatePendingFees` →
  `requirePermission('billing.configure')`; `getSettingsPage` →
  `requirePanelPermission('settings.manage')` (además del layout `(admin)`);
  `getBillingStatus` no exige permiso (la usan `/socios`, `/cobranza` y el
  panel) pero solo devuelve `lastRun`/`recentRuns` no vacíos si RLS deja leer
  `billing_runs`; para quien no, `currentPeriodRun` es `ok` o `not_due`.
- **Corridas (T1):** `getBillingStatus().currentPeriodRun` = `failed` si la
  última fila de `billing_runs` del período actual es `error`; `missing` si
  la facturación está activa, `billingStartPeriod <= currentPeriod` y no hay
  ninguna fila del período; `ok` si la última es `ok`; `not_due` si inactiva o
  inicio futuro; `lastRun` con `actorName` resuelto contra `app_users` (null
  para cron); `recentRuns` las últimas 10 desc. `generatePendingFees` traduce
  el error relanzado por la RPC a `DomainError` con ese mensaje y devuelve
  `{ generated }` si va bien; `listBillingRuns(limit)` para `/ajustes`.
- `createFeePrice`: solo `admin` (`editor` → `PermissionError`); `scope`
  fuera del enum, `category` sin `categoryId`, `member_type` sin `memberType`,
  `default` con alguno → error con `field`; `amountCents` no entero o negativo
  → `field: 'amountCents'`; `validFrom` que no sea primer día de mes →
  `field: 'validFrom'`; mes pasado o mes ya generado → `DomainError` con el
  mensaje del trigger y `field: 'validFrom'`; duplicado exacto → `DomainError`
  "Ya hay un valor para ese alcance desde ese mes".
- `getFeePricesOverview`: `current` resuelve por scope el de mayor
  `validFrom <= mes actual` (y lista los futuros aparte como "próximos");
  `history` completa ordenada desc.
- `activateBilling({ startPeriod })`: solo `admin`; `startPeriod` primer día
  de mes; los cuatro rechazos del trigger llegan como `DomainError` legibles
  ("Primero cargá el valor de cuota por defecto", "El mes de inicio no puede
  ser pasado", "Las cuotas ya están activadas y hay cuotas generadas");
  si `startPeriod` = mes actual, llama a `generatePendingFees` y devuelve
  `{ generated: number }`; si es futuro, `{ generated: 0 }`.
- `generatePendingFees`: solo `admin`; devuelve la cantidad creada; llamado
  dos veces seguidas la segunda devuelve 0 sin error.
- `getBillingStatus`: `active`, `startPeriod`, `currentPeriod` (`toPeriod()`),
  `lastGeneratedPeriod` (max `period` de cuotas mensuales o null),
  `pendingPeriods` (de `dashboard_summary`), `activeMembers`.
- `updateSettings` ya **no** acepta `billingStartPeriod` (clave desconocida →
  error de formato); `getSettingsPage` devuelve además `feePrices`, `billing` y
  las categorías activas agrupadas por disciplina.
- **[DB]** lo de S1 se prueba con las funciones del modelo y claims por rol.

**Contratos:** `FeePrice`, `FeePriceInput`, `FeePricesOverview`,
`BillingStatus`, `BillingRun`, `Settings`, `ActionResult`, `Permission`;
RPC `generate_pending_fees`; tabla `billing_runs` (solo lectura).
**Dependencias:** S1, S4, SH1.
**Fuera de alcance:** UI, descuentos, `adjustment`, anulación de cuotas
(B2), exportación.
**Skills:** `supabase-postgres-best-practices` (antes de cada query),
`supabase`, `context7` (supabase-js `.rpc()`, Zod v4), `vercel-react-best-practices`.

### B2 — Pagos, cargos del socio y estado de cuenta

**Posee:** `src/models/payments.model.ts`, `src/models/fees.model.ts`,
`src/models/accounts.model.ts`, `src/models/audit.model.ts` (modificar:
`buildLabelDraft`), `src/controllers/payments.controller.ts`,
`src/controllers/payments.actions.ts`.
**No toca:** `members.model.ts`, `members.controller.ts`,
`storage.service.ts` (lo usa tal cual), contratos, `views/**`, `app/**`,
`supabase/**`, `tests/**`, nada de B1/B3.

**Aceptación:**
- Permisos: `registerPayment`, `prepareReceiptUpload`, `attachReceipt`,
  `createOpeningBalance` → `requirePermission('payments.register')`;
  `voidPayment`, `voidFee` → `requirePermission('payments.void')`;
  `getReceiptUrlAction`, `getMonthPaymentsPage` →
  `payments.read`; `getPaymentFormData` → `payments.register`.
- `registerPayment(input)`: `admin`/`editor` (`consulta` → `PermissionError`);
  Zod: `batchId` uuid obligatorio (se acepta el del cliente, nunca se
  regenera), `paidOn` ≤ hoy en zona club (`field: 'paidOn'`), `method` enum,
  `items` ≥ 1 con `memberId` entero y `amountCents` entero > 0 (`field:
  'items.<i>.amountCents'`), `notes` ≤ 500, `receiptPath` opcional con
  prefijo `payment-receipts/`; `familyGroupId` opcional: si viene, todo
  `memberId` debe pertenecer al grupo (`DomainError`); `receiptPath` que no
  existe en Storage → `DomainError`; una sola sentencia `insert` con N filas
  (mismo `batchId`, `paidOn`, `method`, `receiptPath`, `notes`); unique
  violation de `(batch_id, member_id)` → `success({ alreadyRegistered: true,
  … })`; éxito devuelve `{ paymentIds, totalCents, alreadyRegistered: false
  }`; pago a socio inactivo permitido (no bloquea); revalida.
- `voidPayment({ paymentId, reason })`: solo `admin`; `reason` < 3 →
  `field: 'reason'`; ya anulado → `DomainError("El pago ya está anulado")`.
- `prepareReceiptUpload({ memberId, mimeType, sizeBytes })`: `admin`/`editor`;
  MIME ∈ lista del bucket y ≤ 10 MiB; ruta `payment-receipts/<memberId>/<uuid>.<ext>`
  armada en el servidor; devuelve `{ path, token, signedUrl }`.
- `attachReceipt({ paymentId, path, filename })`: `admin`/`editor`; objeto
  existente y prefijo válido; pago ya con comprobante → `DomainError`.
- `getReceiptUrlAction({ paymentId })`: cualquier rol; 60 s; null si no hay.
- `createOpeningBalance({ memberId, amountCents, description? })`:
  `admin`/`editor`; `amountCents` > 0; facturación inactiva → `DomainError`
  "Primero activá las cuotas en Ajustes"; ya tiene uno vigente →
  `DomainError`.
- `voidFee({ feeId, reason })`: solo `admin`; misma semántica que el pago;
  **encadena `.select('id').maybeSingle()` y trata 0 filas como
  `DomainError('No se pudo anular el cargo: no existe o no tenés permiso')`**
  (review B2 / D33; la policy de `fees` es solo `payments.void`).
- `attachReceipt` sobre un pago anulado → `DomainError` con el mensaje del
  trigger ("Un pago anulado no lleva comprobante").
- `getMemberAccountDetail`: `currentFees` desglosado y cada línea del
  statement con su categoría/disciplina (o "Cuota social" / "Saldo
  anterior").
- `accounts.model`: `getMemberAccount`, `getMemberAccounts(ids)` (una RPC, no
  N), `getFeeStatement`, `getMemberAccountDetail` (cuenta + statement +
  pagos incluidos anulados + saldo de arranque vigente); con facturación
  inactiva devuelve cuenta con ceros y `currentFeeCents: null`.
- `getPaymentFormData({ memberId | familyGroupId })`: `admin`/`editor`;
  con `familyGroupId` trae a **todos** los integrantes (activos e
  inactivos) con su cuenta; con `memberId` uno; `billing`.
- `getMonthPaymentsPage(period, cursor)`: keyset por `(paid_on desc, id
  desc)`, embed del nombre del socio, incluye anulados marcados, `limit` ≤
  100.
- `audit.model.buildLabelDraft`: `payments` → "Apellido, Nombre · $X ·
  dd/mm/aaaa", `fees` → "Apellido, Nombre · Cuota septiembre 2026 · 5ta" (o
  "Cuota social" / "Saldo anterior"), `fee_prices` → "Por defecto · $X desde
  septiembre 2026" (o categoría/tipo), `member_categories` → "Apellido,
  Nombre · 5ta"; sin N+1 (reutiliza el camino batch existente);
  `AUDIT_FIELD_LABELS` con las columnas de las cuatro tablas.
- Ningún log con nombres; `batchId`, `paymentId`, `memberId`, montos sí.
- **[DB]** lo de S2 y el statement de S3 con las funciones del modelo.

**Contratos:** `Payment`, `PaymentListItem`, `Fee`, `FeeStatementLine`,
`MemberAccount`, `MemberAccountDetail`, `PaymentFormData`, `ActionResult`;
`storage` port existente; RPCs `member_accounts`, `member_fee_statement`.
**Dependencias:** S2, S3, S4, SH1.
**Fuera de alcance:** listados agregados y panel (B3), imputación manual,
descuentos, exportación, mails.
**Skills:** `supabase-postgres-best-practices`, `supabase` (Storage, RLS),
`context7` (supabase-js `insert` de arrays, `rpc`, `createSignedUploadUrl`,
Zod v4), `vercel-react-best-practices`.

### B3 — Padrón: categorías múltiples, estado de cuenta en la ficha, filtro de deuda

**Posee:** `src/models/members.model.ts` (modificar),
`src/models/member-categories.model.ts` (nuevo), `src/models/catalogs.model.ts`
(modificar solo `setCategoryActive`: contar inscripciones abiertas),
`src/controllers/members.controller.ts` (modificar),
`src/controllers/members.actions.ts` (modificar).
**No toca:** nada de B1/B2/B4 (importa `accounts.model.ts` y
`billing.model.ts` por sus firmas), `family-groups.model.ts`,
`medical-clearances.model.ts`, contratos, `views/**`, `app/**`,
`supabase/**`, `tests/**`.

**Aceptación (categorías múltiples, §13.2 / §13.6):**
- `createMember`: `requireRole('admin','editor')` se mantiene (action del
  slice 1; deuda documentada) — **no** acepta `memberType` ni `categoryId`;
  acepta `categoryIds: number[]` (vacío = no practicante); Zod rechaza dos
  ids de la misma disciplina ("Elegí una sola categoría por deporte", `field:
  'categoryIds'`) y un id inactivo o inexistente; flujo: INSERT del socio
  (sin `member_type`: lo pone la base) y luego `set_member_categories(id,
  categoryIds, joinedOn)`; si la RPC falla, el socio queda cargado sin
  deporte y la action devuelve `DomainError` que lo dice ("Se cargó el socio
  pero no sus deportes: agregalos desde la ficha"); revalida.
- `updateMember`: sin `memberType`/`categoryId`; los deportes se cambian con
  `setMemberCategories({ memberId, categoryIds, effectiveOn? })` (nueva
  action, `requirePermission('members.write')`; `effectiveOn` ≤ hoy y ≥ alta
  del socio; RPC; errores del trigger → `DomainError`); `leaveCategory({
  membershipId, leftOn, reason? })` (UPDATE `left_on`/`left_reason`;
  `members.write`); `changeCategory({ membershipId, newCategoryId,
  effectiveOn })` = `setMemberCategories` con la lista actual reemplazando
  esa disciplina.
- `member-categories.model.ts`: `listMemberships(memberId)` (todas, con
  nombres y `leftByName` resuelto), `setMemberCategories(...)` (RPC),
  `closeMembership(id, leftOn, reason)`; traduce unique violation y mensajes
  del trigger a `DomainError`.
- `searchMembers`: filtro `categoryId`/`disciplineId` por **inscripción
  abierta** con el embed `member_categories!inner(...)` + `left_on is null`
  (documentado en el código; un socio en dos categorías coincidentes sale
  una vez); `memberType` por la columna; cada `MemberSummary.categories`
  lista sus inscripciones abiertas con disciplina; `getMemberDetail` trae
  `categories` (abiertas) y `categoryHistory` (todas, ordenadas desc por
  `joinedOn`).
- `catalogs.setCategoryActive(false)` informa la cantidad de inscripciones
  abiertas, no `members.category_id`.

**Aceptación (estado de cuenta y deuda):**
- Permisos: `getMemberPage` y `getPadron` siguen con `requirePanelAccess()`
  (lecturas del slice 1) y el estado de cuenta que agregan viene vacío si
  RLS no deja leer `fees`/`payments`.
- `searchMembers`: `debt = 'in_debt'` → solo socios con `member_debt_status
  = 'in_debt'`; `'up_to_date'` → `up_to_date` y `credit`; `'any'`/ausente →
  sin filtro; el keyset, la búsqueda y los demás filtros siguen funcionando
  combinados (incluido `categoryId` + `debt`); cada `MemberSummary` trae
  `debtStatus`, `balanceCents`, `monthsDue` (con facturación inactiva:
  `up_to_date`, 0, 0). Se quita el comentario "se ignora a propósito".
- `getMemberPage(id)` → `MemberPageData` (ficha + `account` + `billing`);
  socio inexistente → `DomainError` 404 como hoy.
- **[DB]** lo de S0 se prueba a través de estas funciones con claims por rol.

**Contratos:** `MemberSummary`, `MemberDetail`, `MemberCategoryRef`,
`MemberCategoryMembership`, `CreateMemberInput`, `SetMemberCategoriesInput`,
`LeaveCategoryInput`, `MemberFilters`, `MemberPageData`; firmas de
`accounts.model.ts` (B2) y `billing.model.ts` (B1); RPC
`set_member_categories`.
**Dependencias:** S0, S3, S4, SH1; B1 y B2 para `typecheck`.
**Fuera de alcance:** listados agregados y panel (B4), escrituras de pagos.
**Skills:** `supabase-postgres-best-practices`, `supabase`, `context7`
(PostgREST embed `!inner` con filtro sobre el recurso embebido y `is.null`;
computed fields en supabase-js; Zod v4).

### B4 — Listados de cobranza y panel

**Posee:** `src/models/reports.model.ts`, `src/controllers/reports.controller.ts`.
**No toca:** nada de B1/B2/B3 (importa `accounts.model.ts`,
`payments.model.ts` y `billing.model.ts` por sus firmas), contratos,
`views/**`, `app/**`, `supabase/**`, `tests/**`.

**Aceptación:**
- Permisos: `getDashboard` → `requirePanelPermission('reports.read')`;
  `getCobranzaHub`, `getDebtListing`, `getUpToDateListing`,
  `getDebtByCategoryPage` → `payments.read`.
- `getDebtByCategoryPage`: devuelve las filas con `kind` y un `totalCents`
  que sale de `dashboard_summary.total_debt_cents` (no de sumar filas en TS)
  para que la vista pueda mostrar "coincide con la deuda total".
- `reports.model.listMemberAccounts(filters)`: `debt` (`in_debt` |
  `up_to_date` | `credit`), `categoryId` (→ `category_filter`: inscripción
  abierta), `status` (`active` default | `inactive` | `all`), orden
  `months_due desc, balance_cents desc, full_name`; **`range` por páginas de
  200** con cursor de offset; nunca un pedido sin `range`.
- `getDashboard()`: cualquier rol; cuatro lecturas en `Promise.all`
  (`dashboard_summary`, top 5 vía `member_accounts` ordenada y `limit 5`,
  `debt_by_category`, `monthly_history(12)`); con facturación inactiva no
  tira: devuelve `summary.billingActive = false` y listas vacías.
- `getCobranzaHub()`: `month_collection` del mes actual + `billing`;
  `getDebtListing`/`getUpToDateListing`/`getDebtByCategoryPage`: cualquier rol.
- Montos jamás sumados en TS: si un test encuentra `reduce` sobre centavos
  para un total que muestra la UI, falla (salvo el total del lote del
  formulario, que es de B2/F1 y se recalcula en la base al guardar).
- **[DB]** los criterios de S3 se prueban a través de estas funciones con
  claims de `consulta` (lectura) y verificando que `anon` no ejecuta las RPC.

**Contratos:** `DashboardData`, `DashboardSummary`, `DebtByCategoryRow`,
`MonthlyHistoryPoint`, `MonthCollection`, `AccountListFilters`,
`Page<MemberAccount>`, `PaymentListItem`; firmas de `accounts.model.ts`
(B2), `payments.model.ts` (B2) y `billing.model.ts` (B1).
**Dependencias:** S3, S4, SH1; B1 y B2 para `typecheck`.
**Fuera de alcance:** exportación, `/reportes`, escrituras, padrón (B3).
**Skills:** `supabase-postgres-best-practices`, `supabase`, `context7`
(`range` y `order` sobre `rpc` en supabase-js).

---

## Lane `frontend` — `frontend-react-craftsman`

Reglas comunes: hereda la dirección de `route.md`/`DESIGN.md` (no se corre
`concept-seed`); **qué se muestra lo decide `session.permissions.includes(…)`
(T12), nunca `session.role`**: "Registrar pago" / "Cargar saldo anterior" /
"Adjuntar comprobante" con `payments.register`, "Anular" con `payments.void`,
valores de cuota / activar / generar / reintentar / corridas con
`billing.configure`; `impeccable` con `reference/craft-floor.md` antes de editar y
`reference/operate.md`; mobile first a 390 px y verificación con una mano;
targets 44 px; estados de carga/vacío/error; montos con `Amount`/tabulares,
sin decimales; nunca "eliminar"; `web-design-guidelines` antes de cerrar;
`vercel-react-best-practices`; `context7` para Next 16 (`searchParams`,
Server Actions con `useActionState`/`useTransition`) y react-hook-form + Zod
v4. Vistas sin data fetching. Dev log `02-development-frontend-<id>.md`.

### F1 — Cobranza: hub, registrar pago (socio y grupo), pagos del mes, listados

**Posee:** `src/app/(panel)/cobranza/**`, `src/views/payments/**`.
**No toca:** `views/shared/**` (si falta una primitiva, la pide en el dev log
y usa lo existente), `views/shell/**`, `views/members/**`, backend,
`supabase/**`, `tests/**`.
**Brief:** `.impeccable/surfaces/route-cobranza.md` y la sección "Registrar
pago" de `route.md`.

**Aceptación:**
- `/cobranza` (todos los roles): "Registrar pago" (admin/editor) con un
  buscador de socio que lleva a `/cobranza/nuevo?socio=<id>`; "Este mes"
  (cobrado, cuotas del mes, %, efectivo/transferencia, cantidad de pagos)
  como filas etiqueta/valor; accesos a Pagos del mes, Con deuda, Al día,
  Deuda por categoría; con facturación inactiva lo explica.
- `/cobranza/nuevo?socio=<id>`: encabezado con nombre, sus deportes y
  categorías (o "No practicante") y línea de cuenta ("Debe $X · N meses" /
  "Al día" / "Saldo a favor $X" / "Dado de baja · debe $X"); `batchId`
  generado **una vez** por instancia de formulario (`crypto.randomUUID()` en
  `useState` inicializador) y reenviado en cada intento; monto precargado
  según D12 revisada: **la suma de sus cuotas del mes con el desglose
  visible** ("Cuota de septiembre: $20.000 — Fútbol masculino · 5ta $10.000
  + Vóley · Sub 18 $10.000"; "Cuota social $10.000"), chips "1 mes", "2
  meses", "3 meses" (múltiplos de la suma) y "Toda la deuda ($X)" (los que
  apliquen); `AmountField`; fecha
  default hoy (zona club) con `DateField`; medio como dos botones grandes
  (Efectivo / Transferencia); comprobante opcional con subida directa por URL
  firmada (progreso, reducción de imágenes > 2 MB en el browser, error con el
  límite dicho) que aparece **al elegir Transferencia** y sigue disponible en
  Efectivo plegado; notas plegadas; botón "Registrar pago de $X" que
  nombra el monto; deshabilitado mientras envía; si el resultado es
  `alreadyRegistered`, toast "El pago ya estaba registrado"; éxito → vuelve a
  la ficha (`?volver=`) con toast que dice cómo queda la cuenta; socio de
  baja: aviso y monto precargado con la deuda; con saldo a favor: aviso
  "Tiene saldo a favor de $Y" y confirmación cuando el pago excede la deuda.
- `/cobranza/nuevo?grupo=<id>`: lista de integrantes con checkbox (activos
  marcados; de baja desmarcados y con la etiqueta), cuota precargada
  editable por fila, total del lote actualizado en vivo y repetido en el
  botón; un solo submit; un integrante sin cuota (facturación inactiva) →
  campo vacío y el botón exige monto.
- `/cobranza/pagos?mes=YYYY-MM`: selector de mes (anterior/siguiente),
  totales del mes arriba, lista por fecha desc con socio, monto, medio, quién
  cargó, "Ver comprobante" (pide la URL al tocar) y "Anular" (solo admin,
  `ReasonDialog` con consecuencia); anulados tachados con motivo; "Ver más".
- `/cobranza/deuda`: filtros en la URL (categoría = inscripción abierta,
  incluir dados de baja); filas "Apellido, Nombre · sus categorías · N meses
  · $X" (la deuda **total** del socio) ordenadas por meses desc; tocar abre
  la ficha; `/cobranza/al-dia` igual con `DebtStatusPill`;
  `/cobranza/por-categoria`: filas por disciplina/categoría con socios
  (un socio cuenta en cada una de las suyas), con deuda y monto atribuido,
  más las filas "Cuota social · no practicantes" y "Saldo anterior al
  sistema" al final, y **el total al pie que coincide con la deuda total del
  panel** (viene del controller, no se suma en la vista); cada fila de
  categoría enlaza a `/cobranza/deuda?categoriaId=`; las dos especiales no
  enlazan (o enlazan a `/cobranza/deuda` sin filtro).
- Todos: `EmptyState` que enseña ("Todavía no se registraron pagos en
  septiembre"), `LoadingList`, `ErrorState`; `consulta` no ve botones de
  escritura; nada de scroll horizontal a 390 px.

**Contratos:** `PaymentFormData`, `MemberAccount`, `MonthCollection`,
`PaymentListItem`, `DebtByCategoryRow`, `Page<MemberAccount>`, actions de B2,
controllers de B2/B3, `AmountField`/`DebtStatusPill`/`PeriodText` de SH2.
**Dependencias:** SH2, B2, B3.
**Skills:** `impeccable` (`.claude/skills/impeccable/reference/craft-floor.md`,
`reference/operate.md`), `web-design-guidelines`, `vercel-react-best-practices`,
`context7` (supabase-js `uploadToSignedUrl` en el browser, Next 16
`useActionState`, react-hook-form `useFieldArray` para el lote).

### F2 — Alta/edición con deportes y categorías; ficha con deportes y estado de cuenta; padrón con categorías y filtro de deuda

**Posee:** `src/app/(panel)/socios/**`, `src/views/members/**`.
**No toca:** `views/shared/**`, `views/shell/**`, `views/payments/**`,
backend, `supabase/**`, `tests/**`.
**Brief:** `route-socios-nuevo.md`, `route-socios-id.md`, `route-socios.md`
+ §10 y **§13.6** de `00-architecture.md`.

**Aceptación (Revisión 3 — UI del slice 1 que cambia):**
- `/socios/nuevo` y `/socios/[id]/editar`: desaparece "Practicante / No
  practicante" y el par disciplina → categoría; sección **"Deportes y
  categorías"** como lista agrupada por disciplina donde dentro de cada
  deporte se elige a lo sumo una categoría (radio con "Ninguna"; a 390 px
  targets de 44 px); texto "Si no practica ningún deporte, queda como socio
  no practicante y paga la cuota social"; en alta, las categorías se
  guardan con la fecha de alta; en edición, si cambió la selección aparece
  "A partir de" (default hoy, no futura) y la consecuencia escrita ("Deja de
  generar cuota de <deporte> desde el mes siguiente; la de este mes queda" /
  "Empieza a pagar <deporte> desde este mes"); error "Elegí una sola
  categoría por deporte" inline; si el alta guardó el socio pero fallaron
  los deportes, muestra el mensaje y lleva a la ficha.
- `/socios/[id]`: encabezado con las categorías abiertas ("Fútbol masculino ·
  5ta, Vóley · Sub 18") o "No practicante"; `Panel` "Deportes": cada
  inscripción abierta con "desde <fecha>" y acciones (`members.write`)
  "Cambiar de categoría" (select de la misma disciplina + fecha) y "Dar de
  baja de <categoría>" (`ReasonDialog` con fecha y motivo **opcional**,
  consecuencia escrita), "Agregar deporte" (select de disciplinas sin
  inscripción abierta → categoría + fecha); historia plegada (categoría,
  desde, hasta, motivo, quién). Nunca "eliminar".
- `/socios`: la meta/columna de categoría lista todas ("5ta, Sub 18" con la
  disciplina en tabla desktop); los filtros de categoría/disciplina/tipo
  siguen igual para el usuario.

**Aceptación (estado de cuenta):**
- `/socios/[id]`: recibe `MemberPageData`; sección de cuenta arriba del todo
  con la línea de estado (`DebtStatusPill` + texto), último pago, "Registrar
  pago" (primaria, admin/editor) y "Pago del grupo" (si tiene grupo), ambas
  a `/cobranza/nuevo?…&volver=/socios/<id>`; `Panel` "Cuotas" (statement
  desc, **una línea por cargo con su deporte · categoría o "Cuota social"**,
  estado por cargo, anuladas tachadas con motivo, saldo anterior
  como ítem con "hasta <mes>"); `Panel` "Pagos" (fecha, monto, medio, quién,
  comprobante bajo demanda, anulado con motivo); "Anular" en cuotas y pagos
  solo admin con `ReasonDialog` (consecuencia explícita); "Cargar saldo
  anterior" (admin/editor) solo si no hay uno vigente y la facturación está
  activa, si no un texto que explica; facturación inactiva → una línea, sin
  ceros que asusten; socio de baja con deuda → la línea lo dice.
- `/socios`: filtro "Deuda" habilitado con Todos / Al día / Con deuda (en la
  URL); deshabilitado con el texto actual si la facturación está inactiva
  (la page `/socios` llama directo a `getBillingStatus()` de
  `billing.model.ts` —lectura plana, sin controller— y pasa `billing` a
  `MemberListView`);
  cada fila suma la pill y "N meses · $X" o "Saldo a favor $X" en meta
  tabular; sin scroll horizontal.
- Accesibilidad: la línea de cuenta es un `<p>` con texto completo, no solo
  color; anulados con `<s>` y texto "Anulado".

**Contratos:** `MemberPageData`, `MemberAccountDetail`, `FeeStatementLine`,
`Payment`, `MemberSummary` (nuevos campos), `MemberCategoryRef`,
`MemberCategoryMembership`, `CreateMemberInput` (`categoryIds`), actions de
B2 y B3 (`setMemberCategories`, `leaveCategory`, `changeCategory`),
controller de B3.
**Dependencias:** SH2, B2, B3.
**Skills:** las de F1.

### F3 — Panel inicial (reemplaza el inicio actual entero)

**Posee:** `src/app/(panel)/page.tsx`, `src/views/dashboard/**`, y en
`src/views/shell/**` **únicamente prender el flag de Cobranza** que deja el
agente de frontend en curso (el algoritmo de la barra —máximo 5 ítems,
importancia creciente hacia la derecha, "Más" solo con más de 5 destinos—
ya existe; no se toca; `home-search.tsx` puede reutilizarse desde
`views/dashboard/`).
**No toca:** `views/shared/**`, `views/payments|members|settings/**`, otras
pages, backend, `supabase/**`, `tests/**`, nada más de `views/shell/**`.
**Brief:** sección "Panel inicial" de `route.md` (confirmada) + §13.8.
**Arranca después** de que el agente de frontend actual cierre `views/shell/**`.

**Primer paso obligatorio (pedido de Tomás):** el inicio actual "es espacio
desperdiciado" y se reemplaza entero; F3 **arranca con la ronda de
composición de `impeccable`** (scope *surface*, dentro del mundo canon ya
elegido en `route.md`/`DESIGN.md`; **no** vuelve a correr la ronda de
dirección ni `concept-seed --scope direction`) usando el brief como insumo,
la registra en `.impeccable/` y en su dev log, y recién después construye.

**Aceptación:**
- Orden a 390 px: Tarea del día (buscador + "Registrar pago" y "Cargar ficha
  de ingreso" por rol; reemplaza los accesos que duplican la navegación
  inferior) → Este mes → Deuda → Evolución → Padrón, en `Panel`s hermanos
  con filas etiqueta/valor tabulares; **sin** tarjetas de número grande ni
  métrica-héroe.
- Este mes: "Cobrado en <mes>" contra "Cuotas de <mes>" con % etiquetado
  "del valor de las cuotas del mes" (puede superar 100%), efectivo /
  transferencia, cantidad de pagos. Deuda: total (activos), cuántos deben,
  "de socios dados de baja" aparte, top 5 (nombre, meses, monto) con link a
  la ficha. Padrón: activos, "Altas · N (+M reactivaciones)" y bajas del
  mes, socios y deuda por categoría (lista con las filas de categoría y las
  dos especiales "Cuota social" y "Saldo anterior"; un socio en dos deportes
  cuenta en las dos), aptos vencidos y faltantes.
- **Todo número es un link** al listado filtrado (`/cobranza/deuda`,
  `/cobranza/deuda?estado=inactive`, `/cobranza/pagos?mes=`, `/socios?debt=`,
  `/socios?categoryId=`, `/socios?...` para aptos si el filtro existe; si no,
  a `/socios` con nota en el dev log).
- Evolución: un gráfico `recharts` de 12 meses (cobrado y deuda al cierre)
  hecho **con la skill `dataviz`** (Skill tool `dataviz`; sus
  `references/palette.md` para colores, validados en tema claro; marcas sin
  decoración; tooltip con montos formateados) y una **tabla accesible
  equivalente** (visually-hidden o plegable) con los mismos datos; skeleton
  de carga con la misma altura para no saltar.
- Estados: facturación inactiva (explicación + link a Ajustes para quien
  tiene `billing.configure`); **aviso de corrida (T1)**: con
  `billing.currentPeriodRun` en `failed` o `missing` y permiso
  `billing.configure`, una línea arriba de "Este mes" — "No se generaron las
  cuotas de <mes>" más el `errorMessage` si lo hay — con botón "Reintentar"
  (`generatePendingFees`, estado de envío, toast con la cantidad, y el aviso
  desaparece al revalidar) o link a Ajustes; nunca un banner permanente ni
  visible para quien no puede reintentar; sin pagos → ceros explicados;
  error.
- Navegación: con el flag de Cobranza prendido, la barra inferior queda
  `Inicio · Cobranza · Socios` para editor/consulta y `Más (Ajustes,
  Auditoría) · Usuarios · Inicio · Cobranza · Socios` para admin (lo arma el
  algoritmo existente; F3 solo verifica y no lo reordena); ítem activo
  correcto bajo `/cobranza/*`.

**Contratos:** `DashboardData`, `DashboardSummary`, `MonthlyHistoryPoint`,
`DebtByCategoryRow`, `MemberAccount`, `SessionInfo`; controller de B3.
**Dependencias:** SH2, B3.
**Skills:** `impeccable` (`craft-floor.md`, `operate.md`), **`dataviz`**,
`web-design-guidelines`, `vercel-react-best-practices`, `context7`
(recharts 3: `ResponsiveContainer`, `ComposedChart`/`LineChart`, accesibilidad).

### F4 — Ajustes: valores de cuota y activación; etiquetas de auditoría

**Posee:** `src/app/(panel)/(admin)/ajustes/**`, `src/views/settings/**`,
`src/views/audit/audit-labels.ts` (sumar `member_categories` y las tres
tablas del slice 2).
**No toca:** el resto. **Arranca después** de que el agente de frontend en
curso termine de pasar los sheets de ajustes a `ResponsiveSheet`
(`views/shared/`): "Nuevo valor de cuota" y "Activar cuotas" se construyen
con `ResponsiveSheet` (abajo en móvil, diálogo en desktop), no con `Sheet`.
**Brief:** `route-ajustes.md` + §10 de `00-architecture.md`.

**Aceptación:**
- Sección "Cuotas": estado (no activadas → texto que explica el orden de
  carga + "Activar cuotas" deshabilitado con motivo si no hay valor por
  defecto; activadas desde <mes>, último mes generado, "Generar cuotas ahora"
  con la cantidad de períodos pendientes cuando hay); **aviso de corrida
  (T1)**: con `currentPeriodRun` `failed`/`missing`, "No se generaron las
  cuotas de <mes>" con el motivo y "Reintentar" (misma action; toast con la
  cantidad); **"Últimas corridas"** plegado: fecha y hora (zona club),
  "Automática" o el nombre del admin, estado con texto (Correcta / Con error
  / Sin cuotas que generar), cuotas creadas, mensaje de error si hay; sin
  filas → "Todavía no corrió ninguna generación"; diálogo de activación
  con select de mes (actual + 12 futuros), resumen "Se van a generar N cuotas
  de <mes>" y consecuencia ("El valor de ese mes no se puede cambiar
  después"); toast con la cantidad generada.
- Sección "Valores de cuota": vigentes por scope (por defecto; por tipo;
  por categoría agrupadas por disciplina) con "desde <mes>" y "próximos" si
  hay; "Nuevo valor" en sheet (scope → campo dependiente, `AmountField`,
  "Aplica desde" con el mes actual solo si no está generado); errores del
  trigger inline bajo "Aplica desde"; historia plegada.
- "Datos del club" ya no muestra el mes de inicio de cuotas.
- `audit-labels.ts`: "Valores de cuota", "Cuotas", "Pagos".

**Contratos:** `FeePricesOverview`, `FeePrice`, `BillingStatus`,
`BillingRun`, `DisciplineWithCategories`, `SessionInfo.permissions`, actions
de B1.
**Dependencias:** SH2, B1.
**Skills:** las de F1.

---

## Lane `tests` — `test-engineer` (después de B y F)

Spec = los criterios de arriba. Prioridad: (00) **[DB]** S0: migración de
datos de `category_id`, `member_type` escrito solo por trigger, una
inscripción abierta por deporte, `set_member_categories`, historia
intacta; **[DB]** generación por deporte con el fixture A–G de S1 (dos
cuotas para el de dos deportes, ninguna doble en el mes de un ascenso ni de
una transición social↔deporte) y `sum(debt_by_category) =
total_debt_cents` con socios en dos categorías, ascendidos y con saldo a
favor; (0) **[DB]** `private.can` y
`my_permissions` por rol y con `is_active`/`must_change_password`, y que
ninguna regla nueva use `has_role`/`is_admin`; (1) **[DB]** matriz de RLS y
grants de las cuatro tablas por rol, incluido que `editor` no anula ni
inserta `monthly`, `billing_runs` solo legible por admin, y ausencia de
DELETE; (2) **[DB]** idempotencia de la generación (dos corridas, cron
simulado como `postgres`, RPC como `admin`, actor en `audit_log`),
**corridas registradas** (ok / error con mensaje sin PII y cero cuotas a
medias / skipped / reintento tardío que se pone al día), población (alta a
mitad de mes que se cobra en la corrida siguiente, baja, reactivación),
precio congelado y precedencia, activación (a–d); (2b) unidad de
`requirePermission`/`requirePanelPermission` y de `currentPeriodRun`; (3) **[DB]** deuda derivada:
statement con pago parcial, multi-mes, saldo de arranque, anulación de pago y
de cuota, saldo a favor absorbido por la cuota siguiente; (4) **[DB]** RPCs
del panel: cobrado por `paid_on` aunque cubra deuda vieja, deuda solo
positivos y activos, historia con población por eventos, `pending_periods`;
(5) **[DB]** borde horario 30/09 23:30 AR; (6) **[DB]** unique
`(batch_id, member_id)` y atomicidad del lote; (7) actions: roles,
Zod (`field`), `alreadyRegistered`, receipt inexistente, pertenencia al
grupo; (8) `searchMembers` con `debt` combinado con keyset y búsqueda; (9)
`parsePesosToCents`/`AmountField` con "10.000", "10.000,50", "10000", "$
10.000"; (10) sin PII en logs. **Nunca** resetea la base; usa transacciones
con rollback por test y claims por rol como en el slice 1.

## Lane `review` — `code-reviewer` (en paralelo con tests)

Verifica además: ninguna referencia a `members.category_id`,
`categoryName` simple ni "practicante ⇔ categoría" en código nuevo o
modificado; `member_type` nunca escrito desde TS; el índice único de `fees`
es por disciplina con `nulls not distinct`; los tres guards de S1 y el de
`member_categories` son SECURITY DEFINER; `log_export` con lista cerrada;
`voidFee` con `.select()`; el total de `/cobranza/por-categoria` viene del
controller; ningún `requireRole`/`has_role`/`is_admin`/`session.role`
en código nuevo (solo `requirePermission`, `requirePanelPermission`,
`private.can`, `session.permissions`); `billing_runs` sin `enable_audit` y
sin grants de escritura; el cron es `5 3 1 * *`; el aviso de corrida solo
para `billing.configure`; ningún `createAdminClient()` nuevo; ninguna suma de centavos
en TS para totales que muestra la UI; ningún saldo mostrado en negativo;
`batchId` nunca regenerado en el servidor; URLs firmadas nunca persistidas ni
firmadas en lote; `revalidatePath` presente en toda action de escritura;
copy sin "eliminar"; el % del mes etiquetado como "del valor de las cuotas";
el gráfico con tabla equivalente; targets 44 px medidos a 390 px; una sola
identidad visual; `AuditedTable` y etiquetas completas.
