# 03 — Revisión temprana de schema: cuotas, pagos, estado de cuenta (slice 2)

Revisor: `code-reviewer` (pasada de schema únicamente, sin TS). Fecha: 2026-09-27.

Alcance: `supabase/migrations/20260927125000_member_categories.sql` (S0),
`20260927130000_billing.sql` (S1), `20260927130100_payments.sql` (S2),
`20260927130200_accounts.sql` (S3), `supabase/seed.sql`, contra
`00-architecture.md` (§6–§8, §13, Revisión 3) y `01-tasks.md` (S0–S4).

Verificado leyendo el SQL línea por línea **y** contra la base local
(`supabase_db_lonqui`, que ya tiene estas cuatro migraciones y el seed
aplicados), todo dentro de `begin; … rollback;`, simulando `editor` y
`consulta` con filas insertadas en `auth.users`/`app_users` dentro de la
misma transacción y `set_config('request.jwt.claims', …)` + `set local role
authenticated`.

## Veredicto: **CHANGES REQUESTED**

Un solo hallazgo MAJOR (gap funcional real, no de seguridad) y dos MINOR. El
resto del schema es sólido: la matriz de permisos, la idempotencia de la
generación, la regla D30, el ascenso de categoría (T21), la atribución de
deuda a la categoría congelada (T22/D32-a) y el cierre de `EXECUTE` de
`PUBLIC` sobre `private` están correctamente implementados y verificados en
vivo.

## Lo verificado en la base (con resultado correcto)

- **`EXECUTE` de `PUBLIC`/`anon` sobre el schema `private`: cero funciones**
  (consulta directa a `pg_proc`/`has_function_privilege` sobre las 4
  migraciones combinadas). El cierre lo hace el `revoke execute on all
  functions in schema private from public, anon;` al final de
  `20260927130200_accounts.sql`, que corre último y por lo tanto cubre
  también las funciones creadas en S0/S1/S2 (`fees_void_guard`,
  `fees_opening_balance_guard`, `fee_prices_insert_guard`,
  `settings_billing_guard`, `payments_paid_on_guard`,
  `payments_update_guard`, `member_categories_*`, `sync_member_type`,
  `monthly_fee_targets`, `generate_monthly_fees`,
  `generate_pending_fees(text,uuid)`). Ninguna quedó afuera.
- **`members.category_id` eliminada** (columna, índice y CHECK); `member_type`
  sin `insert`/`update` para `authenticated` (confirmado: solo `SELECT` en
  `information_schema.column_privileges`).
- **Permisos por rol exactos al catálogo §6.8**: `my_permissions()` como
  `consulta` simulado devuelve exactamente
  `{members.read,payments.read,reports.read,reports.export}`; `editor`
  simulado tiene `payments.register` y no `payments.void`/`billing.configure`.
- **RLS real, no solo declarada**: `editor` insertando `kind='monthly'` en
  `fees` → rechazado por policy (`new row violates row-level security
  policy`); `consulta` insertando en `payments` → rechazado.
- **Índice único `(member_id, period, discipline_id) nulls not distinct
  where kind = 'monthly'` + regla D30 (T21)**, verificado con el seed real:
  Joaquín (DNI 48555666, ascendió de 6ta a 5ta el 1/7) tiene **una sola**
  cuota de septiembre, en **5ta** (la categoría más reciente dentro del
  período, no la de la corrida anterior); Valentina (DNI 43777888, fútbol
  femenino + vóley) tiene **dos** cuotas de septiembre, una por disciplina;
  Sofía (DNI 40999000, dejó el fútbol el 31/8) tiene **una sola** cuota
  social, no una de fútbol residual.
- **D30 con datos sintéticos** (dentro de la misma transacción, revertida):
  un socio nuevo generó su cuota social del mes; inscribirlo en un deporte
  **a mitad del mismo mes** y volver a correr `generate_monthly_fees` para
  ese período creó **0** filas nuevas (la social generada primero queda; el
  deporte se cobra recién el mes siguiente), exactamente D30/§13.4.
- **Idempotencia de la corrida completa**: `generate_pending_fees('cron')`
  corrido una segunda vez sobre el estado ya generado → `fees_created = 0`,
  conteo de `fees` sin cambios.
- **`months_due` cuenta meses, no cargos** (T-ítem de §6.6): Valentina, con
  un saldo de arranque (agosto) y dos cuotas de septiembre (dos disciplinas,
  tres cargos en total sin cubrir), da `months_due = 2` (agosto, septiembre),
  no 3.
- **La suma de `debt_by_category()` = `dashboard_summary().total_debt_cents`
  exacto** (`12.500.000` en ambos, con el seed + los datos de octubre
  aplicados), incluidas las filas `social` y `opening_balance` (T18).
- **Atribución T22/D32-a**: `private.member_fee_coverage` lee `category_id`
  de `fees` (la columna congelada), no de la inscripción actual del socio;
  `debt_by_category` agrupa sobre ese valor. Una categoría puede mostrar
  `members = 0` con `members_in_debt > 0` cuando el deudor ya cambió de
  categoría — es el comportamiento decidido, y el `where r.n is not null or
  cd.n is not null` lo deja visible en vez de perderlo.
- **B2–B6 del review del slice 1 (según §13.7)**: `fees_void_guard`,
  `fee_prices_insert_guard`, `fees_opening_balance_guard`,
  `settings_billing_guard` son `SECURITY DEFINER` (B4, cerrado);
  `payments_update_guard` rechaza adjuntar comprobante a un pago anulado o
  en la misma sentencia que lo anula (B3, cerrado, y confirmado por
  lectura); `log_export` valida `listing` contra lista cerrada y
  `pg_column_size(filters) <= 4096` (B5, cerrado); no existe
  `payments_batch_id_idx` ni `fees_member_not_voided_idx` (B6, cerrado);
  `dashboard_summary` separa `admissions_count`/`reactivations_count` (B6,
  cerrado).
- **Nada se borra**: cero `DELETE` grants para `authenticated`/`service_role`
  en las cuatro tablas; `fee_prices` sin `UPDATE`; `fees`/`payments`/
  `member_categories` con `forbid_change`/inmutables salvo la anulación (una
  vez, con motivo, solo `payments.void`) o el cierre de inscripción (una vez,
  con fecha).
- **Auditoría**: `member_categories`, `fee_prices`, `fees`, `payments` con
  `enable_audit`; `billing_runs` deliberadamente **no** auditada (tabla
  técnica append-only con su propio actor), consistente con §6.4.
- **Zona horaria y cron**: `5 3 1 * *` = 03:05 UTC = 00:05 AR del día 1
  (`cron.timezone = GMT` confirmado); el generador usa `private.club_today()`
  para el período, no `now()` en UTC.
- **Índices en toda FK** de las cuatro tablas nuevas (`category_id`,
  `discipline_id`, `fee_price_id`, `member_id` cubierto por el prefijo de
  índices compuestos).

## Hallazgos

### 1. MAJOR — `member_accounts.current_fee_cents` precarga un monto para un período que la facturación todavía no va a cobrar (activación con mes de inicio futuro)

- `supabase/migrations/20260927130200_accounts.sql`, función
  `member_accounts`, columnas `current_fee_cents`/`current_fees`/
  `current_fee_period` (el `cur` `cross join lateral`, líneas ~269–273 y
  ~288–327).
- **Qué está mal.** El único gate para devolver `null`/`'[]'` es `start_period
  is null` (facturación nunca activada). Si la facturación **está** activada
  pero con un mes de inicio futuro (flujo explícitamente soportado por D18:
  *"elige el primer mes (mes actual o futuro)"*), `current_period` sigue
  siendo el mes calendario de hoy, y como no hay filas en `fees` para ese
  período (el generador nunca corre para períodos `< billing_start_period`),
  la función cae a la segunda rama: calcula el precio resuelto
  (`private.fee_price_for(...)`) para las inscripciones abiertas de hoy y lo
  devuelve como si fuera "la cuota del mes actual". Esto contradice §6.4:
  `getBillingStatus().currentPeriodRun` en ese mismo escenario es `not_due`
  ("facturación no está activa **o empieza en el futuro**"), pero la RPC que
  alimenta la precarga del pago no conoce ese estado y muestra un monto de
  todas formas.
- **Escenario concreto.** Un admin activa la facturación el 15 de septiembre
  con mes de inicio **octubre** (para dar tiempo a cargar saldos de
  arranque, como indica el orden de carga de D18). Un editor abre "Registrar
  pago" para un socio de 5ta el mismo 15 de septiembre: el formulario
  precarga "$10.000 (Fútbol masculino · 5ta)" como si septiembre estuviera
  facturado. El editor confirma el pago de septiembre; como no hay (ni
  habrá nunca) un cargo de septiembre para ese socio, el pago entero queda
  como saldo a favor sin que nadie lo haya decidido, y en octubre —cuando sí
  se genera la cuota real— el sistema la consume silenciosamente. No es
  corrupción de datos, pero es exactamente la clase de "consecuencia no
  entendida" que D13 pide evitar para el saldo a favor, y acá se origina en
  una precarga que no debería haber existido.
- **Arreglo propuesto.** Gatear las tres columnas también con
  `start_period <= current_period` (no solo `is not null`):
  ```sql
  case when start_period is null or start_period > current_period then null else
    (select coalesce(sum((x ->> 'amount_cents')::bigint), 0)::bigint from jsonb_array_elements(cur.fees) x)
  end,
  case when start_period is null or start_period > current_period then '[]'::jsonb else cur.fees end,
  case when start_period is null or start_period > current_period then null else current_period end
  ```
  (o, más simple, envolver el `cross join lateral (…) cur` para que devuelva
  `fees := '[]'::jsonb` directamente cuando `start_period > current_period`,
  y dejar el `case` externo con la misma condición). Aceptación sugerida
  para `test-engineer`: con `billing_start_period` = mes siguiente,
  `member_accounts()` devuelve `current_fee_cents = null`,
  `current_fees = []`, `current_fee_period = null` para todos los socios.

### 2. MINOR — `debt_by_category()` clasifica cualquier cargo que no sea `'monthly'` como `'opening_balance'`, incluido el futuro `'adjustment'`

- `supabase/migrations/20260927130200_accounts.sql`, CTE `uncovered` (~línea
  578-582):
  ```sql
  case when cv.kind = 'monthly' then
    case when cv.category_id is null then 'social' else 'category' end
    else 'opening_balance'
  end as bucket,
  ```
- **Qué está mal.** `kind` admite `'adjustment'` en el CHECK de `fees`
  (reservado a propósito para el futuro, comentado en el schema: "ninguna
  policy lo permite hoy"). El día que una migración futura habilite
  `adjustment` (una nota de crédito o un ajuste manual, por ejemplo), su
  deuda no cubierta caería silenciosamente en la fila "Saldo anterior al
  sistema" del panel, mezclando dos conceptos que no tienen nada que ver.
  Hoy es inalcanzable (no hay policy de INSERT para `adjustment`), así que
  no es explotable, pero es una trampa para quien extienda esta función sin
  releer el `case`.
- **Arreglo propuesto.** `case when cv.kind = 'monthly' then … when cv.kind =
  'opening_balance' then 'opening_balance' else 'adjustment' end` (agregando
  `'adjustment'` al tipo de retorno documentado y a la lista de `kind`
  aceptados en el frontend cuando llegue), o simplemente un comentario en el
  código que obligue a revisar este `case` antes de habilitar `adjustment`.
  No bloquea el commit de este slice.

### 3. NIT — asimetría en el CHECK de cierre de `member_categories`, inofensiva por los grants de columna

- `supabase/migrations/20260927125000_member_categories.sql`, constraint
  `member_categories_left_shape`:
  ```sql
  check ((left_on is null) = (left_at is null) and (left_on is not null or left_by is null))
  ```
  Esto exige `left_on null ⟺ left_at null` y `left_on null ⟹ left_by null`,
  pero **no** exige la implicación inversa (`left_on no-null ⟹ left_by
  no-null`): en teoría una fila con `left_on` seteado y `left_by` null
  pasaría el CHECK. En la práctica es inalcanzable porque `authenticated`
  nunca tiene grant de `UPDATE` sobre `left_by`/`left_at` (los fija
  `member_categories_update_guard` con `auth.uid()`/`now()` en cada cierre,
  sin excepción, y el INSERT guard los fuerza a `null`). No es un hallazgo
  que haya que resolver para este slice; se deja anotado porque el
  comentario del plan (§13.2) describe una igualdad de tres vías que el SQL
  no implementa literalmente. Si algún día se agrega un camino de escritura
  directa a esas columnas, conviene el CHECK completo: `(left_on is null) =
  (left_at is null) and (left_on is null) = (left_by is null)`.

## Blockers

Ninguno estrictamente bloqueante para el commit de **este** lane de schema
(no hay violación de seguridad, de auditoría, de "nada se borra" ni de
dinero/cuotas): el hallazgo 1 es un bug funcional real pero acotado a la
RPC de lectura `member_accounts`, no a una invariante de escritura. Dicho
esto, dado que **B1 (agentes de backend/frontend) va a consumir
`current_fee_cents` tal cual está** para la precarga del formulario de
pago (D12/D19), recomiendo resolverlo **antes** de que esos agentes cierren
el flujo "Registrar pago", para no tener que revisitar la UI después. Si el
hilo principal prefiere seguir en paralelo, que quede como ítem explícito
para B2/F1 antes de la integración final.

## Qué falta de cobertura para `test-engineer` (no lo escribe este reviewer)

1. `member_accounts()` con `billing_start_period` en un mes futuro:
   `current_fee_cents`/`current_fees`/`current_fee_period` deben ser
   `null`/`[]`/`null` (hallazgo 1; hoy no hay test que lo cubra porque el
   bug es de la RPC, no de TS).
2. El escenario D30 con datos sintéticos (social generada, alta a un
   deporte a mitad del mismo período, segunda corrida no genera nada; y el
   simétrico: deporte generado, baja del deporte a mitad de mes, segunda
   corrida no genera la social) como test de base de datos permanente en
   `tests/db/` (lo verifiqué a mano en esta revisión, pero no vi ese
   fixture específico en `01-tasks.md` §S1 más allá del listado con A–G;
   confirmar que quede como test real).
3. `sum(debt_by_category().debt_cents) = dashboard_summary().total_debt_cents`
   como test de invariante (lo verifiqué a mano con el seed; es la clase de
   propiedad que vale la pena fijar con `fast-check` o con un fixture
   grande, no solo con el seed pequeño).

## Resumen de lo que está bien

El diseño de Revisión 3 (un cargo por socio/período/**deporte**, con la
categoría y disciplina congeladas; `member_categories` como filas-intervalo;
`member_type` derivado por trigger sin grant de escritura; la regla D30 de
exclusión social-vs-deporte; la atribución de deuda por categoría congelada
decidida por Tomás) está implementado **exactamente** como lo describe
`00-architecture.md` §13, y lo pude reproducir en la base con los casos
límite reales del seed (ascenso de categoría, dos deportes, baja de un
deporte) sin necesitar datos sintéticos adicionales salvo para el hallazgo
2 del punto "qué falta de cobertura". El catálogo de permisos (§6.8) está
resuelto en un solo lugar (`private.can`/`my_permissions`) y ninguna regla
nueva usa `has_role`/`is_admin`. El cierre de `EXECUTE` de `PUBLIC` sobre
`private` —la trampa explícita de `CLAUDE.md`— se resuelve correctamente
porque la migración que corre última (`accounts.sql`) hace el `revoke`
global y vuelve a otorgar a mano lo que cada policy/función `INVOKER`
necesita.

## Resolución (hilo principal, 2026-09-27)

- **1 (MAJOR) — corregido** en `20260927130200_accounts.sql`: `member_accounts` gatea `current_fee_cents`, `current_fees` y `current_fee_period` con `billing_due = start_period is not null and start_period <= current_period`. `db:reset` limpio; la deuda por categoría sigue sumando la deuda total ($125.000 en el seed).
- **2 (MINOR) — corregido**: el `case` de `debt_by_category` ya no tiene `else`; `adjustment` no cae en "Saldo anterior" (hoy no tiene camino de escritura) y un comentario obliga a darle su propia fila cuando lo tenga.
- **3 (NIT) — se deja a propósito**: `left_by` null en una inscripción cerrada es "la cerró el sistema" (seed, jobs), igual que `created_by`; está comentado en la migración.
