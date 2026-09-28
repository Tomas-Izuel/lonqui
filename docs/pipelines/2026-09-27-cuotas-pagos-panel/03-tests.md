# 03 — Tests: cuotas, pagos, estado de cuenta y panel inicial (slice 2)

Test-engineer. Alcance: slice 2 completo según `01-tasks.md` (lane `tests`) y
`00-architecture.md` §13, con la cobertura pedida en las secciones "qué
necesita tests" de `02-development-backend-b1.md` a `b4.md` y en
`03-review-schema.md`.

**Nota de proceso.** Esta corrida se paralelizó en cuatro agentes (S0+S1,
S2+S3, `tests/models/`, `tests/controllers/`+`tests/lib/`), con un corte de
archivos disjunto por lane. Hubo un tramo de confusión real de coordinación
(dos agentes escribiendo brevemente sobre el mismo archivo `tests/db/
billing.test.ts`, y uno de ellos creyéndose por un momento el coordinador de
todo el pipeline) que se corrigió por mensaje antes de que se perdiera
trabajo — se verificó archivo por archivo que el contenido final en disco
coincide con lo reportado por su dueño real. Este documento es la única
versión final: consolida y **verifica de nuevo, corriendo yo mismo** `npx
vitest run`/`npm run typecheck` sobre el repo completo tal como quedó al
cierre de las cuatro lanes, en vez de confiar en los reportes por separado.
El hallazgo 1 (bloqueante) lo encontró uno de los agentes de `tests/db/`
verificando S2 contra la base real; el test que lo pinea permanentemente lo
agregué yo al integrar, porque ningún archivo existente lo cubría (todos los
fixtures de `opening_balance` insertaban como superusuario, que bypasea el
grant de columna que causa el bug).

## Veredicto

## SUITE GREEN

El hallazgo 1 (bloqueante) se reportó en rojo en la corrida anterior de este
mismo documento; `senior-backend-engineer` lo corrigió
(`02-development-backend-review-fixes.md`, sección "Bug real (post-review) —
`createOpeningBalance` mandaba `period` sin grant de INSERT") y avisó que el
test que lo pineaba había quedado desalineado con el fix (seguía reproduciendo
a propósito la forma VIEJA, con `period`, así que seguía fallando incluso
después de corregido `src/models/fees.model.ts`). Se actualizó el test para
reflejar el insert real corregido (sin `period`) y se agregó un segundo test
de regresión que fija que mandar `period` explícito SIGUE dando `42501` (el
grant ausente es intencional, no algo para volver a "arreglar" agregándolo).

```
npx vitest run    → 39 archivos, 662 passed | 1 skipped (663 total), 0 failed
npm run typecheck → 0 errores
npx eslint         → 0 errores (4 warnings preexistentes de variables sin
                      usar en tests, no bloqueantes)
```

`tests/db/**` corrió contra el stack local real (Docker arriba,
`supabase_db_lonqui`), no mockeado. No se corrió `npm run db:reset` en ningún
momento: toda la base usada es la que dejaron las migraciones + `supabase/seed.sql`
del propio pipeline, y cada test de `tests/db/` limpia su propio estado con
`BEGIN … ROLLBACK` (`tests/db/helpers.ts`).

## Conteo por archivo

### `tests/db/` (contra la base real)

| Archivo | Tests | Qué cubre |
|---|---|---|
| `member-categories.test.ts` | 22 | S0: inscripción abierta única por disciplina (no por categoría), rechazo de segunda categoría en la misma disciplina con el mensaje que nombra deporte+categoría, categoría inactiva, `joined_on` fuera de rango, cierre de inscripción (null→valor una vez, con/sin motivo, no reabre, no futuro), inmutabilidad de `category_id`/`joined_on` (grant ausente + trigger si se bypasea), `DELETE` sin privilegio para `authenticated` **y** `service_role` (con `forbid_change` real incluso para `postgres`), `member_type` derivado (sin grant de escritura, se deriva solo al abrir/cerrar, correcto con dos deportes), `set_member_categories` atómico (ascenso, `{}` cierra todo, rechazo de dos categorías del mismo deporte, `insufficient_privilege` para `consulta`), permisos por rol y auditoría con actor. |
| `billing.test.ts` | 36 (34 + 1 `it.skip` documentado + 1 nuevo de regresión) | S1: catálogo `private.can`/`my_permissions` exacto por rol (incluido `is_active=false`/`must_change_password=true` → `{}`), grep de que ninguna función/policy nueva usa `has_role`/`is_admin`, `fee_prices` append-only con precedencia categoría>tipo>default, activación de `settings` (a–d, incluido que la policy `USING (is_admin())` deja pasar un `UPDATE 0` silencioso para `editor`, no una excepción), fixture A–G completo de generación (dos deportes, ascenso de categoría a mitad de mes, alta/baja de deporte a mitad de mes con la regla D30 en las dos direcciones, idempotencia de 3 corridas seguidas), unicidad `(member_id, period, discipline_id) nulls not distinct`, `billing_runs` (ok/manual/RLS/append-only/sin auditoría/`notified_at` null), borde horario 30/09 23:30 ART. El único `it.skip` documenta un hallazgo real (ver abajo), no una prueba debilitada. |
| `payments.test.ts` | 13 | S2: quién inserta (`consulta` no, `editor` con `created_by` propio, rechazo de `created_by` ajeno), atomicidad e idempotencia del lote `batch_id` (todo o nada, unique violation, ausencia de `payments_batch_id_idx`), `paid_on` no futura/no antes de 2020, inmutabilidad de `amount_cents`, anulación (permiso, `audit_log.changed_fields`, doble anulación), comprobante (adjuntar una vez, no reemplazar, no quitar, no sobre un pago anulado, no en la misma sentencia que la anulación), grants de tabla. |
| `accounts.test.ts` | 21 | S3: cobertura oldest-first (`member_fee_statement`/`member_balance`) con pago parcial, saldo de arranque como ítem, saldo a favor absorbido por la cuota siguiente, pago y cuota anulados fuera del cálculo; `month_collection`; **la invariante `sum(debt_by_category().debt_cents) = dashboard_summary().total_debt_cents`** con un fixture que combina deporte + social + saldo anterior + anulados + saldo a favor; atribución de deuda a la categoría **congelada en el cargo** (no la actual del socio); `member_accounts` con `category_filter` (deuda total, no solo de esa categoría) y `current_fee_cents`/`current_fees`; `monthly_history` con población reconstruida por eventos y anulación retroactiva; `log_export` (lista cerrada, tope de 4 KiB, actor, `anon` rechazado). |
| `grants-and-lockdown.test.ts` | 37 (34 de slice 1 + 3 nuevos) | Slice 1 sin cambios + slice 2: ausencia de `DELETE` en las 5 tablas nuevas, `service_role` sin `INSERT`/`UPDATE` en las tablas de dominio nuevas, `anon` sin ejecución en ninguna RPC nueva del slice. |
| `catalogs.test.ts`, `members.test.ts`, `storage.test.ts` | 10, 26, 11 | Slice 1, adaptados al contrato nuevo: `members.test.ts` perdió el describe que probaba el CHECK `members_practicing_has_category` (ya no existe desde S0; esa cobertura la hereda `member-categories.test.ts`) y se corrigieron 3 INSERTs crudos que mandaban `member_type` bajo un rol sin ese grant. |

### `tests/models/` (mocks del cliente de Supabase, sin tocar la base)

| Archivo | Tests |
|---|---|
| `fee-prices.model.test.ts` | 21 |
| `billing.model.test.ts` | 20 |
| `payments.model.test.ts` | 19 |
| `fees.model.test.ts` | 11 |
| `accounts.model.test.ts` | 12 |
| `member-categories.model.test.ts` | 16 |
| `reports.model.test.ts` | 17 |
| `audit.model.test.ts` | 11 |
| `members.model.test.ts` | 41 (incluye `createMemberSchema` migrado de `memberType`/`categoryId` a `categoryIds`) |
| `members.model.writes.test.ts` | 13 (`createMember`/`updateMember` con el flujo de dos pasos: INSERT del socio + `assignCategories`, y el mensaje de fallo parcial) |
| `settings.model.test.ts` | 5 (`updateSettingsSchema` ya sin `billingStartPeriod`) |
| `catalogs.model.test.ts`, `family-groups.model.test.ts`, `medical-clearances.model.test.ts`, `app-users.model.test.ts` | 10, 4, 13, 22 (slice 1, sin cambios) |

Cubren, entre otras cosas: traducción de errores de Postgres a `DomainError`
con `field`, `alreadyRegistered` en `registerPayment`, `voidFee` con
`.select().maybeSingle()` (0 filas → `DomainError`, no éxito silencioso),
`current_fee_cents` como suma de las cuotas del mes, `disciplineName`
resuelto (no hardcodeado a null salvo en saldo anterior/social), el fix de
"Al día" incluyendo `credit` en `listMemberAccounts`, precedencia y mensajes
de `set_member_categories`/`assertCategorySelection`.

### `tests/controllers/` (mocks de `session.controller`/modelos)

| Archivo | Tests |
|---|---|
| `session.controller.test.ts` | 38 (incluye `requirePermission`/`requirePanelPermission` del catálogo de permisos T12, y `getSession` fail-closed) |
| `billing.actions.test.ts` | 15 |
| `payments.actions.test.ts` | 45 |
| `payments.controller.test.ts` | 2 |
| `reports.controller.test.ts` | 8 |
| `settings.controller.test.ts` | 2 |
| `members.actions.test.ts` | 16 (migrado a `categoryIds`) |
| `audit.controller.test.ts`, `auth.actions.test.ts`, `users.actions.test.ts` | 6, 16, 18 (slice 1, sin cambios) |

### `tests/lib/`

`dates.test.ts` (27, incluye `addMonths`/`previousPeriod`/`lastDayOfPeriod`/`periodRange`
del S4), `money.test.ts` (16), `safe-redirect.test.ts` (13),
`action-result.test.ts` (6), `errors.test.ts` (13), `passwords.test.ts` (11).

## Hallazgos de producción

### 1. RESUELTO — `createOpeningBalance` mandaba una columna sin grant: "Cargar saldo anterior" estaba roto para cualquier editor/admin real

- **Encontrado por este agente** verificando S2/S3 contra la base real:
  `src/models/fees.model.ts` (función `createOpeningBalance`) mandaba
  `period: toPeriod()` como placeholder en el `insert`, pero `authenticated`
  nunca tuvo grant de INSERT en `fees.period` (`grant insert (member_id, kind,
  amount_cents, description) on public.fees to authenticated`,
  `20260927130000_billing.sql`). Postgres evalúa los privilegios de columna
  sobre la lista del `INSERT` **antes** de que cualquier trigger (incluido
  `fees_opening_balance_guard`, que pisaría `period` igual) llegue a correr:
  el solo hecho de nombrar la columna alcanzaba para `42501 permission denied
  for table fees`, para cualquier editor/admin real (no para los fixtures de
  test, que insertan como superusuario y bypasean grants de columna — por eso
  no se había visto hasta que este agente escribió un test que reproducía el
  insert exacto que arma el modelo, en vez de usar el atajo de superusuario).
- **Corregido por `senior-backend-engineer`**
  (`02-development-backend-review-fixes.md`, "Bug real (post-review)"):
  `createOpeningBalance` ya NO incluye `period` en el payload (tipo local
  `OpeningBalanceInsert = Omit<TablesInsert<'fees'>, 'period'>`); el trigger
  la sigue fijando en el mes anterior al inicio de la facturación.
- **Test actualizado** (`tests/db/billing.test.ts`, describe "fees: saldo de
  arranque (opening_balance) por el camino REAL de la app"): el primer test
  ahora reproduce el insert CORREGIDO (sin `period`) como un `editor` real y
  confirma que el trigger fija `period` al valor esperado (leído, no
  escrito: el grant es solo sobre INSERT/UPDATE). Se agregó un segundo test
  de regresión que fija que mandar `period` explícito SIGUE dando `42501` —
  el grant ausente es intencional (la fija el trigger, no la app), y este
  test evita que alguien "corrija" el bug agregando el grant en vez de sacar
  la columna del payload.
- Barrido del resto del slice (`02-development-backend-review-fixes.md`): se
  comparó cada `.insert()`/`.update()` de los modelos nuevos contra su grant
  de columna correspondiente; `createOpeningBalance` era el único desvío.

### 2. Higiene — una fila de `fee_prices` quedó persistida fuera de una transacción con rollback

- Durante esta corrida (con múltiples instancias de test-engineer trabajando
  en paralelo sobre el mismo stack local, algunas fuera de la coordinación de
  este agente) quedó una fila real en `fee_prices` (`id=8`, `scope=default`,
  `valid_from=2027-09-01`, `created_by`=el admin del seed, `created_at`
  2026-09-28 ~02:56 UTC) — evidentemente un INSERT de diagnóstico corrido sin
  `BEGIN … ROLLBACK`. `fee_prices` es append-only incluso para `postgres`
  (`forbid_change` no distingue rol), así que **no se puede borrar** ni por
  este agente ni por nadie desde la app.
- No es bloqueante: `valid_from` es un año entero en el futuro (2027-09) y no
  interfiere con ningún test ni con el seed de 2026. Se documenta acá como
  recordatorio operativo: cualquier verificación manual contra esta base
  (`docker exec ... psql`) tiene que correr dentro de una transacción con
  `ROLLBACK`, sin excepción — un `INSERT` real en una tabla append-only no
  tiene forma de deshacerse después.

### 3. `generate_monthly_fees`: el branch "sin precio resoluble" es estructuralmente inalcanzable una vez activada la facturación

- `supabase/migrations/20260927130000_billing.sql`, función
  `private.generate_monthly_fees`, líneas ~352-368 (`raise exception 'No hay
  un valor de cuota vigente para %'`).
- `settings_billing_guard` exige, para activar la facturación, que exista un
  `fee_prices` con `scope = 'default'` y `valid_from <= billing_start_period`.
  Esa fila es append-only: nadie (ni `admin`, ni `service_role`, ni
  `postgres`) puede actualizarla o borrarla — `fee_prices_no_change` dispara
  `forbid_change()` sin condicionar por rol. `fee_price_for` cae a ese
  `default` sin ninguna condición adicional (`or fp.scope = 'default'`) para
  cualquier categoría o tipo de socio, en cualquier período `>= valid_from`.
  Consecuencia: una vez que la activación tuvo éxito, **no existe ningún
  socio ni ningún período para el que `fee_price_for` pueda devolver null**, y
  por lo tanto ese `raise` nunca se ejecuta en producción bajo el flujo normal
  (activar → generar).
- No es una vulnerabilidad ni un bug funcional — es una consecuencia correcta
  y probablemente intencional del diseño append-only — pero es codigo muerto
  del lado feliz, y **no se puede ejercer con un test automatizado** contra
  una base ya activada (que es el estado permanente de este stack local,
  activado por el seed, sin `db:reset` disponible para este agente). Documentado
  como `it.skip` en `tests/db/billing.test.ts` (la sección "un socio sin
  precio resoluble…") con la explicación completa, en vez de forzar un DELETE
  que la propia base garantiza que nunca sucede.
- Si algún día se quiere una prueba real de este camino, hace falta correrla
  contra una base recién migrada, ANTES de aplicar el seed (que activa la
  facturación) — no es alcanzable con el flujo de test actual, que exige no
  resetear la base compartida.

### 4. `settings_update`: un `UPDATE` sin privilegio no lanza excepción, devuelve `UPDATE 0`

- `supabase/migrations/20260925*.sql` (slice 1), policy `settings_update` (`USING (is_admin())`).
- No es un bug — es el comportamiento estándar de RLS con `USING` sin `WITH CHECK` violado — pero es una trampa real para quien escriba un test (o código de app) esperando que un `UPDATE` sin privilegio tire una excepción: en este camino, Postgres/PostgREST devuelven éxito con 0 filas afectadas, no un error. El modelo de TypeScript (`billing.model.ts`) ya lo maneja bien en apariencia (usa `.select().maybeSingle()` en otros lugares de este mismo slice para distinguir "0 filas" de un error real, ver `payments.model.ts`/`fees.model.ts`); vale la pena que quien revise `settings.model.ts`/`billing.actions.ts` confirme que `activateBilling` no asume que un fallo de permiso siempre lanza.

## Qué NO se cubrió y por qué

- Exportación real a CSV: fuera de alcance (slice 3); `log_export` se probó como el gancho que es.
- Subida real de un comprobante a Storage vía `createSignedUploadUrl`/`uploadToSignedUrl` end-to-end: se probó `objectExists`/el flujo de modelos con mocks; no hay Storage real disponible desde los tests de `tests/db/` para una subida binaria real.
- El hallazgo 3 de arriba (missing price), por las razones explicadas.

## Cómo se corrió

```
npm run typecheck
npx vitest run
```

Sin `npm install`, sin `db:reset`, sin tocar `supabase/migrations/**` ni `src/**`.
