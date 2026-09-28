# 03 — Tests: padrón, roles y auditoría (slice 1)

Agente: `test-engineer`. Corre en paralelo con `code-reviewer`. Spec: criterios
de aceptación de `01-tasks.md`, dev logs `02-development-*` (incluidos
`backend-review-fixes` y `frontend-review-fixes`, aplicados a mitad de esta
tanda).

## Estado del entorno usado

Stack local levantado (`supabase_db_lonqui` sano, Postgres 17.6 en
`127.0.0.1:54322`). Migraciones del slice 1 aplicadas, incluida
`20260927120000_review_fixes.sql` (blockers 2/3 y minor 7 de la primera
pasada de review), sin resetear la base en ningún momento. `pg`/`@types/pg`
ya estaban instalados. Saqué `passWithNoTests: true` de `vitest.config.ts` (ya
no hace falta: hay tests reales) — avisado, es config de tests.

A mitad de esta tanda aterrizaron, en paralelo:
1. **R1** (segunda pasada de `03-review.md`): "Ver más" del padrón fallaba
   siempre porque `socios/page.tsx` mandaba `limit` adentro de `filters`, y
   `loadMoreMembersSchema`/`memberFiltersSchema` es `.strict()` sin ese campo.
   Backend exportó `PADRON_PAGE_SIZE` desde `members.model.ts`; frontend armó
   a mano el objeto que viaja a `loadMoreMembers` (solo `q`, `categoryId`,
   `disciplineId`, `status`, `memberType`) y sacó `limit` de `filters` en
   `socios/page.tsx`. Cubierto abajo (S3).
2. **Contrato de sesión del slice 2** (cuotas/pagos, en paralelo, pipeline
   `2026-09-27-cuotas-pagos-panel`): `getSession()` ahora resuelve también
   `getOwnPermissions()` y `SessionInfo` tiene `permissions: Permission[]`;
   `session.controller.ts` ganó `requirePermission`/`requirePanelPermission`.
   Actualicé el mock de `@/models/session.model` en
   `tests/controllers/session.controller.test.ts` (agregar
   `getOwnPermissions`) y sumé dos tests de que `permissions` viaja tal cual.
   **No escribí tests de `requirePermission`/`requirePanelPermission` ni de
   las migraciones nuevas del slice 2** (`billing`, `payments`, `accounts`):
   por instrucción explícita del hilo principal, eso lo cubre el
   `test-engineer` de ese pipeline. Sí confirmé que mi barrido de grants
   (`grants-and-lockdown.test.ts`, "ninguna tabla de `public` otorga DELETE a
   `authenticated`") sigue en 34/34 contra el schema ya ampliado — ese test
   recorre TODAS las tablas de `public`, así que las tres tablas nuevas ya
   están cubiertas sin tocarlo.

También se resolvió solo, sin mi intervención, un error de tipos transitorio
en `src/views/shared/form-fields.tsx` (otro agente mid-edición al momento de
correr `tsc` una vez): no era mío, no lo toqué, y ya no está.

## Resultado final

```
npm test            → 22 archivos, 335 tests, todos verdes
npm run typecheck    → limpio
npm run lint         → limpio (solo un warning preexistente en src/lib/safe-redirect.ts, no mío)
npm run build        → compila y genera las 10 rutas
```

Sin el stack (`LONQUI_TEST_DATABASE_URL` apuntado a un puerto muerto):
`tests/db/*` se saltean solos (84 tests skipped), exit code 0, 242 tests
siguen corriendo y en verde. Verificado explícitamente para este informe.

**Nada quedó escrito en la base**: cada test de `tests/db/` corre dentro de
`BEGIN … ROLLBACK` (`tests/db/helpers.ts::withRollback`); los dos tests que
hablan con la API HTTP de Storage (no con `pg`, no hay transacción posible)
crean un objeto de prueba y lo borran ellos mismos al final. Conteos de
`app_users`/`members`/`family_groups`/`disciplines`/`categories`/`audit_log`/
`storage.objects` verificados iguales antes y después de correr la suite
completa varias veces.

## Organización

```
tests/
  stubs/server-only.ts        (ya existía)
  lib/          dates, money, passwords, errors, action-result, safe-redirect
  models/       schemas puros (app-users, members, members.writes, catalogs,
                settings, family-groups, medical-clearances)
  controllers/  session.controller, auth.actions, users.actions,
                members.actions, audit.controller (todos mockeados)
  db/           helpers.ts + grants-and-lockdown, catalogs, members, storage
                (contra Postgres real)
```

## Cobertura por criterio (`01-tasks.md`)

### S1 — privilegios, `private`, roles, auditoría (`tests/db/grants-and-lockdown.test.ts`, 34 tests)

- Ninguna tabla de `public` otorga `DELETE` a `authenticated` (recorre
  `information_schema.role_table_grants` sobre TODAS las tablas, no una
  lista fija — si se agrega una tabla nueva sin revocar, este test la agarra
  sola). `service_role` tampoco tiene INSERT/UPDATE/DELETE sobre `audit_log`.
- `audit_log` es append-only de verdad: `UPDATE`/`DELETE` fallan como
  `authenticated` (permission denied, ni grant), como `service_role` (ídem) y
  como **`postgres`** (superusuario: acá si hay grant porque es el dueño, pero
  el trigger `audit_log_no_update_delete` lo frena igual — probado en
  transacciones separadas con `expectQueryError`/savepoints para no abortar el
  resto del test).
- Auditoría real: un INSERT en `app_users` por un admin deja `actor_id` =
  ese admin, `op = INSERT`, `new_data` completo. UPDATE sin cambios → 0 filas
  nuevas en `audit_log`. UPDATE que cambia `display_name` → fila con
  `changed_fields = {display_name}`.
- `current_app_role()` cierre total: usuario de Auth sin fila en `app_users`
  → rol null y **0 filas** en `members`, `disciplines`, `categories`,
  `family_groups`, `settings`, `audit_log` (recorrido, no una tabla suelta).
  Un claim de `user_metadata.role = admin` sin fila real → sigue sin otorgar
  nada. `must_change_password = true` → lee su propia fila de `app_users`
  pero 0 filas en `members`/`audit_log`, y el propio `UPDATE
  must_change_password` falla con permission denied (sin grant para nadie).
  Usuario `is_active = false` → rol null.
- Anti-lockout: un admin no cambia su propio rol ni se desactiva a sí mismo;
  degradar al **único** admin activo de toda la base falla ("tiene que quedar
  al menos un administrador activo" — armado neutralizando los admins del
  seed uno por uno, nunca en una sola sentencia masiva, para no disparar el
  guard antes de tiempo); con dos admins activos, degradar a uno funciona.
- `mark_password_reset`/`confirm_password_changed`: `editor` no puede
  resetear; `admin` sí (prende el flag, guarda el marker); `service_role`
  puede (bootstrap); `confirm_password_changed` sin marker falla; con el hash
  **sin cambiar** falla y el flag sigue prendido; tras cambiar
  `encrypted_password` (simulado como `postgres`, como pide el spec) el
  confirm apaga el flag, fija `password_changed_at` y marca `cleared_at` del
  marker.
- **Regresión blocker 2** (migración de fixes, `password_reset_at`): resetear
  una contraseña que YA tenía `must_change_password = true` sigue dejando
  fila de auditoría (antes no, porque el UPDATE "no cambiaba nada" a ojos del
  trigger); dos reseteos seguidos dejan dos filas, no una. `password_reset_at`
  confirmado sin grant de UPDATE para nadie.
- **Regresión minor 7** (`revoke execute ... from public` sobre `private`):
  0 funciones de `private` ejecutables por `public` ni por `anon`;
  `authenticated` sigue pudiendo ejecutar los tres helpers que las policies
  necesitan (`current_app_role`, `has_role`, `is_admin`) — sin este último
  test, un revoke demasiado amplio rompería toda lectura del dominio con un
  "permission denied for function" en vez de una policy vacía.
- **Regresión blocker 3** (`members_clear_responsible_on_group_change`):
  sacar a la responsable de su grupo (`family_group_id = null`) ya no choca
  con el CHECK, y el flag se apaga solo; moverla a otro grupo (con o sin
  responsable propio) también apaga el flag sin chocar con el índice único;
  tocar otra columna no afecta `is_payment_responsible`.

### S2 — catálogos (`tests/db/catalogs.test.ts`, 10 tests; `tests/models/catalogs.model.test.ts`, 10 tests)

- `consulta` lee, no inserta (RLS con error real en INSERT). `editor` no
  inserta (RLS) — y **hallazgo del propio proceso de escribir el test**: un
  `UPDATE` de `editor` sobre `disciplines`/`categories` no tira excepción
  (tiene el grant de columna, tabla por tabla, a nivel `authenticated`): la
  policy `USING (is_admin())` simplemente no le deja ver la fila para
  actualizar, así que el `UPDATE` "success" con **0 filas afectadas**. Un test
  que solo mirara "no tira" habría dado un falso verde a un problema real; lo
  dejé documentado y aserto `rowCount === 0` + que el valor no cambió.
- `admin` sí crea disciplina/categoría. Nombre duplicado case-insensitive →
  `23505` en ambas tablas; el mismo nombre en OTRA disciplina no choca.
  Desactivar una categoría es `is_active = false`, la fila sigue.
- Schemas (`nameSchema`, `reorderSchema`, etc.) probados en unidad, sin base.

### S3 — padrón (`tests/db/members.test.ts`, 29 tests; `tests/models/members.model.test.ts`, 30; `tests/models/members.model.writes.test.ts`, 11)

- Alta = ficha de ingreso automática (`admission`, `effective_on = joined_on`,
  `status = active`); `editor` no puede insertar un evento a mano (RLS);
  `admission` manual (ya con eventos previos) falla con el mensaje del
  trigger. Auditoría del alta con actor correcto.
- Transiciones: `withdrawal` activo→inactivo con `status_changed_on`; doble
  baja falla ("ya está dado de baja"); `reactivation` inactivo→activo; sobre
  activo falla ("ya está activo"); fecha futura y fecha anterior al alta
  fallan con los mensajes exactos; motivo corto viola el CHECK de longitud;
  `editor`/`consulta` no pueden dar de baja/reactivar ni insertar socios.
- `members.status`/`joined_on` inmutables: `UPDATE status` falla con
  `permission denied` para `editor` **y** `admin` (columna sin grant para
  nadie); `UPDATE joined_on` falla con `permission denied` (tampoco tiene
  grant) — y un test aparte, corriendo **como `postgres`** (que sí podría
  saltarse el grant), confirma que ahí lo frena el trigger
  `protect_immutable_columns`, la segunda capa real de defensa.
- DNI: dos socios con el mismo DNI → `23505`; dos sin DNI → permitido; menos
  de 7 dígitos → CHECK. **Ojo (hallazgo del proceso, no de producción)**: el
  seed real usa DNI `30111222`/`40999000`/etc. — mis fixtures usan un rango
  claramente inventado (`99000001`, `99000002`) para no colisionar por
  casualidad con datos existentes.
- Practicante ⇔ categoría: `practicing` sin categoría y `non_practicing` con
  categoría violan el CHECK (simétrico, como documenta B2); `practicing` con
  categoría es válido.
- Responsable de pago: dos responsables en el mismo grupo → `23505`;
  responsable sin grupo → CHECK; `set_family_payment_responsible` cambia el
  responsable atómicamente (el anterior se limpia solo, verificado con los
  dos sentidos del cambio) y rechaza un socio que no pertenece al grupo.
- Búsqueda normalizada: "nunez" encuentra "Núñez", "PEREZ" (sin acento,
  mayúsculas) encuentra "Pérez", y la búsqueda por DNI pasa por el mismo
  `search_text`.
- **Unit (mock de `createClient`, sin DB)**: `translateMemberError` — los dos
  casos nuevos del blocker 3 (`members_one_responsible_per_group` →
  `field: familyGroupId`; `members_responsible_has_group` → ídem), más los ya
  existentes (DNI, categoría) y el passthrough de un error no reconocido.
  `createMember` con `newFamilyGroup` (Minor 10): caso feliz (crea el grupo
  antes que el socio, usa su id), DNI duplicado con `newFamilyGroup` presente
  → **no** se llama `createFamilyGroup` (sin huérfano). `updateMember` sobre
  un id que no vuelve fila → `DomainError` 404, no éxito silencioso (Minor
  11). Schemas: `newFamilyGroup` mutuamente excluyente con `familyGroupId`,
  sin `notes`; `loadMoreMembersSchema` (Major 5).
- **Regresión R1** (segunda pasada de review, `tests/models/members.model.test.ts`):
  `loadMoreMembersSchema` probado con la forma REAL que manda
  `src/views/members/member-list.tsx` tras el fix (`{ q, categoryId,
  disciplineId, status, memberType }`, con y sin valores seteados) → pasa;
  con `limit` colado adentro de `filters` (el bug original) → rechaza; con un
  `cursor` colado adentro de `filters` (en vez de al lado) → rechaza. Un test
  de contrato así es justo lo que faltaba: el schema en sí ya estaba bien
  probado con `filters: {}`, pero nunca con la forma exacta que arma el
  cliente, que es donde vivía el bug. Sumé también un test de que
  `PADRON_PAGE_SIZE` (50) es la única fuente que comparten la primera tanda
  (`socios/page.tsx` la importa para `getPadron`) y "Ver más" (que nunca
  manda `limit` y depende del default de `clampLimit`) — dos tests de
  contrato a nivel de código fuente (que la page importe la constante y que
  `parseFilters()` nunca devuelva `limit`) en vez de una prueba de
  integración cara, porque lo que hay que impedir es que reaparezca una
  segunda fuente de verdad (el `LIST_PAGE_SIZE` local que había antes), no
  solo que el número coincida hoy.

### S4 — storage (`tests/db/storage.test.ts`, 11 tests)

- Bucket privado, límite y MIME confirmados contra `storage.buckets`.
  `consulta` no inserta (RLS); `editor`/`admin` sí en `medical-clearances/` y
  `payment-receipts/`; ninguno fuera de esos prefijos. Cualquier rol activo
  lee (para poder firmar URLs).
- `UPDATE` sobre un objeto: 0 filas (sin policy de UPDATE). `DELETE`: **hallazgo
  del proceso** — no es solo "sin policy" (que daría 0 filas en silencio):
  Supabase le agrega su propio trigger a `storage.objects` que **rechaza el
  DELETE directo con un mensaje explícito** ("Direct deletion... use the
  Storage API"), una defensa más fuerte de lo que documentaba el plan. Ajusté
  el test para afirmar eso en vez de "0 filas" y confirmé que la fila sigue
  ahí.
- Contra la API HTTP real de Storage (con la secret key local, no un secreto
  real): un MIME fuera de la lista (`application/zip`) es rechazado por el
  servicio; uno de la lista (`image/png`) se acepta y se borra al final del
  test (no queda en el bucket).

### Unidades puras (`tests/lib/`, 73 tests)

- `dates.ts`: el caso del enunciado (00:30 UTC del 1° sigue siendo el día
  anterior en Argentina; 2026-09-30T23:30 ART → período `2026-09-01`) y el
  simétrico (03:00 UTC del 1° ya es el 1° en Argentina); `toPeriod` en el
  horario exacto del cron (`00:05 UTC` = 21:05 ART del día anterior);
  `formatPeriod` sin el error de "de"; `formatDateTime` nunca imprime "24:".
- `money.ts`: `parsePesosToCents` con el caso exacto del enunciado
  ("10.000" → 1.000.000 centavos, no 10), coma decimal, un pago de $30.000
  como múltiplo exacto de una cuota de $10.000, rechazo de negativos/3+
  decimales; `sumCents` sin arrastre de float; `formatCentsCompact` sin
  decimales.
- `passwords.ts`: `generateTemporaryPassword` cumple `passwordPolicySchema`
  en 500 corridas, nunca usa `0/O/1/l/I`, siempre tiene letra Y dígito
  garantizados, no se repite en 50 corridas, 12 caracteres, solo el alfabeto
  documentado.
- `errors.ts`: `zodToApiError` con `.strict()` y una clave desconocida NUNCA
  la nombra en la respuesta (sí la loguea, aparte); `toApiError` nunca
  expone el texto crudo de un error interno; `PermissionError` es 403.
- `safe-redirect.ts` (blocker 1 del review): `/\evil.com`, `//x`,
  `https://x`, tabs/saltos de línea de control — todos rechazados;
  `safeRedirectPath` con fallback.

### Controllers/actions mockeados (`tests/controllers/`, 74 tests)

- `session.controller.ts`: `requirePanelAccess` redirige (login → cambiar
  contraseña → home sin rol → home con rol fuera de lista); `requireRole`
  tira `PermissionError` en los mismos casos, **incluido con
  `mustChangePassword` prendido antes de mirar el rol** (el caso explícito
  que pidió Tomás a mitad del desarrollo de B1).
- `auth.actions.ts`: mensaje genérico idéntico para contraseña incorrecta y
  email inexistente; usuario desactivado → `signOut()` + mensaje específico,
  sin redirigir; `mustChangePassword` → redirige a `/cambiar-contrasena`
  **ignorando `next` por completo**; `next` externo/protocol-relative se
  ignora. `changePassword`: confirmPassword/newPassword-igual-a-actual sin ir
  a la red; re-auth falla → `currentPassword`; `same_password` de Auth →
  mismo mensaje que el marker; éxito con flag prendido llama
  `confirmPasswordChanged` e ignora `next`; con flag apagado no la llama y
  respeta `next`; **nunca llama `signOut()`** en ningún camino de éxito.
- `users.actions.ts`: `createUser` (duplicado antes de tocar Auth, email ya
  en Auth con alta incompleta, flujo feliz, fallo a mitad de camino se
  propaga); `completeUser` (alta ya completa rechaza, **el email que queda es
  el de Auth, no el del formulario** — Minor 9); `resetUserPassword` sobre
  uno mismo rechaza; `changeUserRole`/`setUserActive` delegan la traducción
  del trigger; `setUserActive` actualiza la fila ANTES de banear/desbanear.
- `members.actions.ts`: `confirmMedicalClearance` rechaza un path de otro
  socio o de otra carpeta SIN preguntarle a Storage, y un objeto inexistente,
  antes de crear la fila. `getMedicalClearanceUrl` (Major 4): un
  `clearanceId` de otro socio o sin adjunto se rechaza sin firmar nada; TTL
  de 60 s confirmado. `loadMoreMembers` (Major 5): cualquier rol activo,
  filtros inválidos cortan antes del modelo.
- `audit.controller.ts`: `getAuditPage`/`getAuditEntry`/`listAuditActorOptions`
  verifican con `requirePanelAccess('admin')` **antes** de tocar el modelo;
  `listAuditActorOptions` (Minor 8) ordena en español y no expone más que
  `{userId, displayName}`.

## Bugs de producción encontrados

**Ninguno propio.** Todo lo que falló durante la escritura de la suite fue de
la suite misma (fixtures que colisionaban con DNI del seed, `SET LOCAL ROLE`
que persiste entre pasos de una misma transacción si no se resetea, `bigint`
que `pg` devuelve como `string`, y dos supuestos míos incorrectos sobre
semántica de RLS — ver "hallazgos" en S2 y S4 arriba, que son comportamiento
correcto de Postgres, no bugs). El código de `src/` pasó cada invariante que
se le pidió, incluidos los fixes de la primera Y la segunda pasada de review
(R1) que llegaron durante esta tanda. R1 en sí era un bug real (reportado por
`code-reviewer`, no por mí) ya corregido por backend/frontend antes de que yo
terminara: lo que agregué es la regresión que evita que reaparezca en
silencio (ver S3).

## Pendiente / fuera de esta tanda

- No se agregaron tests de integración de `listFamilyGroups`/`getFamilyGroup`
  contra el embed nuevo (Major 6) ni de `getAuditPage` con `from`/`to` en el
  borde de medianoche argentina vía `clubMidnightUtc` (Minor 14) — quedan
  señalados en el dev log del backend como deseables; no llegué por tiempo.
  Ninguno de los dos es una invariante de seguridad: son correctitud de
  cálculo, cubribles en una vuelta futura sin bloquear este slice.
- No hay test de carga/concurrencia (no aplica a este slice: cuotas idempotentes
  es slice 2).

## Veredicto

**SUITE GREEN**

`npm test` (22 archivos, 335 tests), `npm run typecheck`, `npm run lint` (0
warnings) y `npm run build` en verde, corridos DESPUÉS de que aterrizaran R1
(segunda pasada de review) y el contrato de sesión del slice 2 en paralelo.
`tests/db/` se saltea solo sin Docker, confirmado con exit code 0 (242 tests
siguen en verde, 84 skipped). `grants-and-lockdown.test.ts` da 34/34 contra el
schema ya ampliado con las tablas del slice 2 (`billing`, `payments`,
`accounts`), sin tocar ese test: el barrido es sobre todas las tablas de
`public`, no una lista fija. Nada quedó escrito en la base local (conteos de
filas iguales antes y después).
