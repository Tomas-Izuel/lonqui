# 01 — Tareas: padrón, roles y auditoría (slice 1)

Deriva de `00-architecture.md` (revisado con las respuestas T1–T8 de Tomás:
**usuarios con contraseña temporal y cambio obligatorio, sin mail**). Cada
tarea declara **lane**, **archivos que posee en exclusiva** y **archivos que
no puede tocar**. Dos agentes sobre el
mismo archivo colisionan en silencio: el corte es por directorio y es disjunto.
Los criterios de aceptación son el spec del `test-engineer`; lo marcado
**[DB]** solo se prueba contra la base local (`tests/db/`).

Idioma: comentarios y copy en español rioplatense, identificadores en inglés.

## Orden de ejecución

```
Paso 0  (hilo principal)  S1..S4 migraciones + config + seed + tipos   ─┐
Paso 0  (hilo principal)  SH1 contratos (types.ts, action-result, session.controller)
Paso 0  (hilo principal + Tomás)  D0 ronda de dirección visual (impeccable)  ─┘
Paso 1  (paralelo)        B1 auth+usuarios │ B2 padrón │ B3 ajustes+auditoría │ F1 dirección+shell+shared+login
Paso 2  (paralelo, tras F1 y su B)  F2 padrón │ F3 usuarios+auditoría │ F4 ajustes
Paso 3  (paralelo)        test-engineer │ code-reviewer
```

B1–B3 no dependen entre sí porque `session.controller.ts` y `types.ts` los
fija el hilo principal antes. F2–F4 dependen de F1 (primitivas y dirección) y
de su contraparte backend (actions y controllers que consumen).

---

## Lane `schema` — hilo principal (los agentes no tocan `supabase/**`)

### S1 — `0001_foundation`: privilegios, `private`, roles, auditoría

**Debe contener** (en prosa; el SQL lo escribe el hilo principal con la skill
`supabase-postgres-best-practices` cargada):
- Extensiones: `pg_trgm`, `unaccent` en `extensions`. (`pg_cron` recién en el
  slice 2.)
- Schema `private`; `grant usage on schema private to authenticated`; revoke
  de `anon`/`public`.
- **Política de privilegios**: `alter default privileges for role postgres in
  schema public revoke all on tables/sequences/functions from anon,
  authenticated` (y lo mismo para `supabase_admin` si aplica), para que
  ninguna tabla nueva nazca con DELETE otorgado. Cada tabla después otorga lo
  suyo explícito. Documentar en el encabezado por qué (hallazgo §3 de
  `00-architecture.md`).
- Helpers `private.current_app_role()`, `private.has_role(variadic text[])`,
  `private.is_admin()`, `private.club_today()`, `private.normalize_text(text)`
  (immutable), `private.set_updated_at()`,
  `private.protect_immutable_columns()` (TG_ARGV con nombres de columna).
- `public.app_users` con CHECK de rol, `must_change_password` (default
  true) y `password_changed_at` **sin grant de UPDATE para nadie**, trigger
  guard anti-lockout (`private.app_users_guard()`), RLS (SELECT fila propia
  por `auth.uid()` **directo**, sin `has_role`, o admin) + grants por columna
  según la matriz §6.5, `enable_audit`.
- `private.password_markers` (no expuesta, **no auditada**), y las dos RPC
  de D8: `public.mark_password_reset(uuid)` (SECURITY DEFINER; `is_admin()`
  o claim `service_role`; guarda `sha256(auth.users.encrypted_password)` y
  prende el flag) y `public.confirm_password_changed()` (SECURITY DEFINER;
  solo `auth.uid()`; apaga el flag únicamente si el hash actual difiere del
  marker). Ambas con `revoke execute from public, anon`, `set search_path =
  ''`. `private.current_app_role()` devuelve null con el flag prendido.
- `public.audit_log` con índices (BRIN `occurred_at`, btree `(table_name,
  record_id)`, `actor_id`), RLS (SELECT `admin`), **sin grants de escritura
  para nadie**, `private.audit_row_change()` (SECURITY DEFINER; actor de
  `auth.uid()` → `app.actor_id` → null con `actor_source`; `changed_fields`;
  omite UPDATE sin cambios; `record_id` como texto de la PK),
  `private.audit_log_guard()` BEFORE UPDATE/DELETE con `raise exception`, y
  `alter table … enable always trigger`; `private.enable_audit(regclass)`
  idempotente.
- `public.settings` singleton con la fila insertada.

**Aceptación [DB]:**
- `authenticated` **no tiene** DELETE en ninguna tabla de `public` (consultar
  `information_schema.role_table_grants`; se asserta la ausencia).
- Con claims de un usuario sin fila en `app_users`, `current_app_role()` es
  null y toda tabla del dominio devuelve 0 filas.
- Un `UPDATE`/`DELETE` sobre `audit_log` falla como `authenticated`, como
  `service_role` y como `postgres`.
- Un `INSERT` en `app_users` por un admin deja una fila de auditoría con
  `actor_id` = ese admin, `op = 'INSERT'`, `new_data` completo.
- Un `UPDATE` que no cambia nada **no** genera fila; uno que cambia
  `display_name` genera fila con `changed_fields = {display_name}`.
- Desactivar al último admin activo o cambiar el propio rol → error.
- Un rol puesto en `user_metadata` no otorga nada.
- Un admin con `must_change_password = true` **no lee ni escribe** ninguna
  tabla del dominio (incluido `audit_log`) pero sí lee su propia fila de
  `app_users`; `UPDATE app_users set must_change_password` como
  `authenticated` → `permission denied`.
- `confirm_password_changed()` con el hash sin cambiar → error y el flag
  sigue prendido; tras cambiar `encrypted_password` (simulado como
  `postgres` en el test) → apaga el flag, fija `password_changed_at`, marca
  `cleared_at`; sin marker → error. `mark_password_reset` como `editor` →
  error; como `service_role` → permitido.
- `audit_log` nunca contiene `marker` ni nada de `private.password_markers`.
- No hay filas de login/logout en `audit_log` (T8).

### S2 — `0002_catalogs`: disciplinas y categorías

`disciplines`, `categories` (FK indexada, unique por nombre normalizado), RLS
(SELECT activo; INSERT/UPDATE `admin`), grants por columna, `set_updated_at`,
`enable_audit`.

**Aceptación [DB]:** `editor` no inserta ni actualiza; `consulta` solo lee;
nombre duplicado en la misma disciplina (con distinto case) → unique
violation; `is_active = false` es la única "baja".

### S3 — `0003_members`: padrón

`family_groups`, `members` (todas las columnas de §6.1, `search_text`
generado, índices, CHECKs, unique parcial de DNI y de responsable),
`member_status_events` (CHECKs, triggers de transición y de aplicación de
estado, trigger AFTER INSERT en `members` que crea `admission`),
`medical_clearances`, RLS + grants por columna (sin grant de UPDATE de
`members.status`), `protect_immutable_columns('joined_on')`,
`enable_audit` en las cuatro. RPC `public.set_family_payment_responsible(
group_id, member_id)` (SECURITY INVOKER, revoke de `public`/`anon`, dos
updates atómicos).

**Aceptación [DB]:**
- Insertar un socio crea automáticamente el evento `admission` con
  `effective_on = joined_on` y `members.status = 'active'`.
- `withdrawal` sobre un activo → `status = 'inactive'`, `status_changed_on` =
  `effective_on`; segundo `withdrawal` → error; `reactivation` sobre inactivo
  → `active`; `reactivation` sobre activo → error; `admission` manual con
  eventos previos → error; `reason` vacío o de 2 caracteres → error.
- `UPDATE members set status = …` como `editor`/`admin` → `permission
  denied` (columna sin grant); `UPDATE joined_on` → error del trigger.
- `editor` inserta socio pero no inserta eventos; `admin` inserta eventos;
  `consulta` no escribe nada.
- Dos socios con el mismo DNI → error; dos socios sin DNI → permitido.
- `practicing` sin categoría o `non_practicing` con categoría → CHECK.
- Dos responsables en el mismo grupo → unique violation; responsable sin
  grupo → CHECK; la RPC cambia el responsable en una sola transacción.
- Búsqueda: "nunez" encuentra "Núñez", "PEREZ" encuentra "Pérez".
- Cada operación deja su fila de auditoría con el actor correcto.

### S4 — `0004_storage`: bucket y policies

Bucket `attachments` privado con límite y MIME de §6.1; policies sobre
`storage.objects`: INSERT `admin`/`editor` en `bucket_id = 'attachments'` con
`(storage.foldername(name))[1] in ('medical-clearances', 'payment-receipts')`;
SELECT activo; sin UPDATE/DELETE.

**Aceptación [DB]:** `consulta` no puede insertar objetos; `editor` sí en el
prefijo válido y no en otro; nadie actualiza ni borra; el bucket rechaza un
MIME fuera de la lista.

### S5 — Config y scripts del hilo principal

- `supabase/config.toml`: `[auth.email] secure_password_change = false`
  (la verificación de la contraseña actual la hace `current_password`; el
  reauth por OTP necesitaría SMTP). **Sin plantillas de mail**: no hay
  invitación ni reseteo por mail en la Fase 1 (T3). SMTP sigue comentado.
  (Recordar: cambios en `[auth.*]` piden `db:stop` + `db:start`.) Anotar en
  el encabezado que en hosted lo mismo se configura en el dashboard.
- `supabase/seed.sql`: disciplinas y categorías conocidas (fútbol masculino
  5ta–10ma, fútbol femenino, vóley sub 18/19/20/mayores) y **socios
  inventados** (nombres falsos, DNI falsos, algunos menores, un grupo
  familiar, uno sin DNI, uno dado de baja).
- `scripts/db-reset.sh`: llama a `node --env-file=.env.local
  scripts/bootstrap-admin.mjs` al final (el script lo escribe B1).
- `.env.example` / `.env.local`: `DEV_ADMIN_EMAIL`, `DEV_ADMIN_PASSWORD`,
  `DEV_ADMIN_NAME`. Quitar de `.env.example` la promesa de que Resend hace
  falta para el reseteo (ya no en la Fase 1); dejar las variables como
  opcionales para la Fase 5.
- `package.json`: `pg` + `@types/pg` en devDependencies (para `tests/db/`),
  `engines.node >= 22` (**confirmado T4**). `npm run db:types` tras las
  migraciones.
- `src/lib/errors.ts`: agregar `PermissionError` (403). `src/lib/passwords.ts`:
  `generateTemporaryPassword()` (12 caracteres, letras y dígitos sin
  ambiguos, `crypto.getRandomValues`) y `passwordPolicySchema` (Zod: ≥ 10,
  letras y dígitos) — es `lib/`, del hilo principal, y lo consumen B1 y F1.

---

## Lane `shared` — hilo principal (contratos)

### SH1 — `src/models/types.ts`, `src/lib/action-result.ts`, `src/controllers/session.controller.ts`

Se escriben **antes** de repartir. Contenido exacto en §7.2 de
`00-architecture.md`:

- `types.ts`: `AppRole = 'admin' | 'editor' | 'consulta'`; `AppUser`
  (incluye `mustChangePassword`, `passwordChangedAt`, `isActive`);
  `AppUserListItem` (`AppUser` + `authStatus: 'ok' | 'incomplete'` para
  altas sin fila); `SessionInfo = { userId, email, displayName, role,
  mustChangePassword }`; `MemberType`,
  `MemberStatus`, `MemberStatusEventType`; `Member` (fila cruda con nombres
  camelCase), `MemberSummary` (`id, fullName, dni | null, memberType, status,
  categoryName | null, disciplineName | null, familyGroupId | null,
  isPaymentResponsible, isMinor, medicalClearanceStatus: 'not_required' |
  'missing' | 'valid' | 'expiring' | 'expired', hasDni`), `MemberDetail`,
  `MemberFilters` (con `debt` preparado), `Page<T>`, `FamilyGroup`,
  `FamilyGroupSummary`, `MedicalClearance`, `Discipline`, `Category`,
  `AuditEntry`, `AuditFilters`, `Settings`. Solo tipos.
- `action-result.ts`: `ActionResult<T>` y `failure(err, context)`.
- `session.controller.ts` (`server-only`): `getSession()` con `cache()`
  (lee la fila propia de `app_users`, que RLS permite aun con el flag
  prendido), `requireSession()`, `requireRole(...roles: AppRole[])` lanzando
  `PermissionError extends DomainError` (status 403) **también cuando
  `mustChangePassword` está prendido**; `PermissionError` exportada desde
  `src/lib/errors.ts` (S5).

---

## Lane `backend` — `senior-backend-engineer`

### B1 — Autenticación, sesión y usuarios internos (contraseña temporal, sin mail)

**Posee:** `src/models/app-users.model.ts`, `src/controllers/auth.actions.ts`,
`src/controllers/users.controller.ts`, `src/controllers/users.actions.ts`,
`src/services/auth-admin.service.ts`, `scripts/bootstrap-admin.mjs`.
**No toca:** `session.controller.ts`, `types.ts`, `lib/**` (usa
`lib/passwords.ts` del hilo principal), `views/**`, pages, `supabase/**`,
`tests/**`. **No existe** `app/auth/confirm/route.ts` ni ningún flujo por
mail.

**Objetivo:** login/logout, cambio de contraseña (obligatorio en el primer
login y voluntario después), alta de usuarios con contraseña temporal,
restablecer contraseña por un admin, cambio de rol, activar/desactivar,
bootstrap del primer admin.

**Aceptación:**
- `signIn` con credenciales inválidas devuelve el **mismo** mensaje genérico
  que con email inexistente; con válidas redirige a `/cambiar-contrasena` si
  la fila propia tiene `mustChangePassword`, si no a `next` solo cuando `next`
  es una ruta relativa interna (nunca una URL absoluta).
- `changePassword`: exige sesión (no rol: el flag lo bloquearía); Zod con
  `passwordPolicySchema`; nueva ≠ actual; llama a `auth.updateUser({ password,
  current_password })` con el cliente de sesión; contraseña actual incorrecta
  → `DomainError` con `field: 'currentPassword'`; luego `confirmPasswordChanged()`
  solo si el flag estaba prendido; si la RPC informa que el hash no cambió →
  `DomainError('Elegí una contraseña distinta a la temporal')`; éxito
  revalida el layout y redirige a `/`. **Nunca** loguea ninguna contraseña.
- `createUser({ email, displayName, role })`: sin rol `admin` →
  `PermissionError`; email inválido o rol fuera del enum → error de
  validación con `field`; email ya existente en `app_users` →
  `DomainError('Ya hay un usuario con ese email')`; flujo feliz: genera la
  temporal con `generateTemporaryPassword()`, `authAdmin.createWithPassword`
  (`email_confirm: true`), fila con el **cliente de sesión** (auditada, actor
  = admin, `must_change_password = true`), `markPasswordReset(userId)`, y
  devuelve `{ userId, temporaryPassword }` **una sola vez**. Si Auth crea y
  la fila o el marker fallan → error, el usuario queda sin rol y `listUsers`
  lo muestra como `incomplete`; `completeUser(userId)` regenera la temporal y
  termina el alta.
- `resetUserPassword(userId)`: solo `admin`; no sobre sí mismo (para eso
  está `changePassword`); genera temporal nueva, `authAdmin.setPassword`,
  `markPasswordReset`, devuelve `{ temporaryPassword }` una sola vez.
- `setUserActive(false)` marca `is_active` con sesión **y** banea vía Admin
  API; `true` desbanea. No puede desactivarse a sí mismo (el trigger lo
  rechaza y la action lo traduce a `DomainError`).
- `changeUserRole`: no puede cambiarse el propio rol; el último admin no puede
  degradarse (`DomainError` desde el trigger).
- `listUsers`: cruza `app_users` con `authAdmin.listAuthUsers()` (paginado
  hasta agotar) y marca `incomplete` a los que existen en Auth sin fila.
- `bootstrap-admin.mjs`: idempotente (si el email existe, no falla ni
  rota la contraseña); local: `DEV_ADMIN_PASSWORD` y flag apagado
  (`--force-change` lo prende); hosted (`--temporary`): genera temporal,
  la imprime **una vez** por stdout y prende el flag con
  `mark_password_reset` como `service_role`; inserta `app_users` con actor
  explícito (`app.actor_id`), auditoría con `actor_source = 'explicit'`.
  Falla claro si falta `SUPABASE_SECRET_KEY`. No escribe la contraseña en
  ningún archivo.
- La temporal nunca aparece en logs, en `audit_log`, en la URL ni en
  cookies; el `ActionResult` que la transporta no se cachea.
- **[DB]** Signup público con la publishable key falla (`enable_signup=false`).
- Ningún log contiene emails ni contraseñas.

**Contratos:** firmas de §7.2; `SessionInfo`; `AppUserListItem`;
`ActionResult`; `authAdmin` port: `createWithPassword(email, password) →
{ userId }`, `setPassword(userId, password)`, `ban(userId)`, `unban(userId)`,
`listAuthUsers() → { id, email }[]`; RPCs `mark_password_reset`,
`confirm_password_changed`.
**Dependencias:** S1, S5, SH1.
**Fuera de alcance:** UI, mails de cualquier tipo, MFA, captcha, SSO,
borrado de usuarios, reautenticación por OTP.
**Skills:** `supabase` (`.claude/skills/supabase/`), `context7` (`@supabase/ssr`,
`supabase-js` Admin API `createUser`/`updateUserById`/`listUsers`,
`updateUser` con `current_password`, Next 16 `redirect`/`revalidatePath`),
`vercel-react-best-practices` para el borde server/client.

### B2 — Padrón: modelos, controller y actions

**Posee:** `src/models/members.model.ts`, `src/models/family-groups.model.ts`,
`src/models/medical-clearances.model.ts`, `src/controllers/members.controller.ts`,
`src/controllers/members.actions.ts`, `src/services/storage.service.ts`.
**No toca:** lo de B1/B3, `types.ts`, `session.controller.ts`, `views/**`,
`app/**`, `supabase/**`, `tests/**`.

**Aceptación:**
- `createMember`: requiere `admin`/`editor`; DNI obligatorio en el schema de
  alta nueva salvo `dniPending = true` explícito; DNI duplicado →
  `DomainError` con `field: 'dni'`; `birthDate` futura → error; practicante
  sin categoría → error con `field: 'categoryId'`; éxito devuelve el id y
  revalida `/socios`.
- `updateMember`: mismos roles; no acepta `status`, `joinedOn` ni claves
  desconocidas (`.strict()` → error genérico de formato, sin nombrar la
  clave).
- `withdrawMember` / `reactivateMember`: solo `admin`; motivo < 3 caracteres →
  error con `field: 'reason'`; fecha futura → error; transición inválida →
  `DomainError` legible ("El socio ya está dado de baja").
- `searchMembers`: filtros combinables (`q`, categoría, disciplina, estado,
  tipo); `debt` se acepta y **se ignora** (documentado) hasta el slice 2;
  keyset estable con `nextCursor`; `limit` acotado (≤ 100); por defecto solo
  activos.
- `getMemberPage`: incluye edad/menor derivados, apto vigente con estado
  (`valid`/`expiring` ≤ 30 días/`expired`/`missing`/`not_required` si ≥ 18),
  URL firmada de 60 s **solo si hay adjunto**, integrantes del grupo,
  historia de estado ordenada.
- `prepareMedicalClearanceUpload`: valida MIME ∈ lista y tamaño ≤ 10 MiB;
  arma la ruta en el servidor (`medical-clearances/<memberId>/<uuid>.<ext>`);
  devuelve `{ path, token, signedUrl }` con vencimiento corto.
- `confirmMedicalClearance`: rechaza un `path` que no empiece con el prefijo
  del `memberId` o que no exista en Storage; crea la fila.
- `setPaymentResponsible`: llama a la RPC; el miembro tiene que pertenecer al
  grupo.
- Ningún log con datos personales; solo ids.
- **[DB]** lo de S3 (transiciones, unicidad, auditoría) se prueba con las
  funciones de modelo usando claims de cada rol.

**Contratos:** §7.2; `Page<MemberSummary>`; `MemberDetail`; `storage` port:
`createSignedUploadUrl(path) → { signedUrl, token, path }`, `getSignedUrl(path,
ttlSeconds) → string`, `objectExists(path) → boolean`.
**Dependencias:** S3, S4, SH1.
**Fuera de alcance:** cuotas, pagos, deuda, importación de CSV, exportación.
**Skills:** `supabase-postgres-best-practices` (antes de cada query),
`supabase` (Storage, RLS), `context7` (supabase-js Storage
`createSignedUploadUrl`, Zod v4), `vercel-react-best-practices`.

### B3 — Ajustes y auditoría: modelos, controllers y actions

**Posee:** `src/models/catalogs.model.ts`, `src/models/audit.model.ts`,
`src/models/settings.model.ts`, `src/controllers/settings.controller.ts`,
`src/controllers/settings.actions.ts`, `src/controllers/audit.controller.ts`.
**No toca:** lo de B1/B2, contratos, `views/**`, `app/**`, `supabase/**`,
`tests/**`.

**Aceptación:**
- Disciplinas/categorías: crear y editar solo `admin`; nombre vacío o
  duplicado (case-insensitive) → `DomainError` con `field: 'name'`;
  desactivar es un update de `is_active`; listado con `includeInactive` para
  `/ajustes` y solo activas para los selects del padrón.
- `getAuditPage`: solo `admin` (el modelo devolvería vacío por RLS, pero el
  controller **lanza** `PermissionError` antes, para no confundir "sin
  acceso" con "sin filas"); filtros por tabla, actor, rango de fechas
  (interpretado en zona del club), `recordId`; keyset por `(occurred_at, id)`;
  cada entrada trae `actorName` resuelto y `changedFields`; el `old_data`/
  `new_data` viaja completo solo en el detalle, no en el listado.
- `updateSettings`: solo `admin`; `billingStartPeriod` primer día de mes o
  null.

**Contratos:** `Discipline`, `Category`, `AuditEntry`, `AuditFilters`,
`Settings`, `Page<T>`.
**Dependencias:** S1, S2, SH1.
**Fuera de alcance:** valores de cuota (slice 2), exportación.
**Skills:** `supabase-postgres-best-practices`, `supabase`, `context7`.

---

## Lane `frontend` — `frontend-react-craftsman`

### D0 — Ronda de dirección visual (hilo principal + Tomás, antes de F1) — **confirmado T5**

No es una tarea de agente. El hilo principal corre `impeccable` con
`node .claude/skills/impeccable/scripts/context.mjs` y la ronda
`concept-seed.mjs --scope direction --mode operate` (decision page), con las
restricciones de §8 de `00-architecture.md` como brief pinneado, y Tomás
elige. El resultado (dirección, seed key, imágenes QUALITY BAR, build path) se
pasa **textual** en el prompt de F1. F1 **no** vuelve a correr la ronda.

### F1 — Dirección, tokens, shell, primitivas compartidas y login

**Posee:** `src/app/layout.tsx`, `src/app/globals.css`, `src/app/(auth)/**`,
`src/app/(panel)/layout.tsx`, `src/app/(panel)/page.tsx`,
`src/app/(panel)/(admin)/layout.tsx`, `src/views/shell/**`,
`src/views/shared/**`, `src/views/auth/**`, `src/components/ui/**` (solo
agregar componentes shadcn que falten, sin `npm install`), `DESIGN.md`,
`.impeccable/**` (mocks, review, sidecar; **no** reescribe los briefs).
**No toca:** `views/members|users|settings|audit/**`, pages de esas rutas,
`models/**`, `controllers/**`, `services/**`, `supabase/**`, `tests/**`,
`next.config.ts`.

**Aceptación (comportamiento visible):**
- Contrato de dirección como comentario HTML, primer hijo del `<body>` del
  root layout; tokens de color en `@theme` de `globals.css` con el naranja de
  texto **medido** ≥ 4,5:1 sobre blanco (valor documentado en `DESIGN.md`);
  una sola familia tipográfica cargada con `next/font`, `font-variant-numeric:
  tabular-nums` en `Amount`, `Dni` y celdas numéricas.
- `AppShell`: navegación filtrada por rol (`consulta` no ve Usuarios/
  Ajustes/Auditoría; `editor` tampoco); móvil con navegación inferior o sheet
  (targets ≥ 44 px), desktop lateral; nombre y rol del usuario; "Cerrar
  sesión" llama a `signOut`.
- `(panel)/layout.tsx`: sin sesión → `redirect('/login?next=<ruta>')`; con
  `mustChangePassword` → `redirect('/cambiar-contrasena')`; con sesión sin
  rol activo → vista "Tu usuario no tiene acceso" + cerrar sesión.
  `(admin)/layout.tsx`: rol ≠ admin → `AccessDenied` (no `notFound`, no
  experimental).
- `/login`: formulario `react-hook-form` + Zod; error inline genérico;
  estado de envío; **sin** link de reseteo: texto "Si olvidaste tu
  contraseña, pedile a un administrador que te asigne una nueva"; sin
  registro.
- `/cambiar-contrasena` (`(auth)`, requiere sesión, sin el shell del panel):
  contraseña actual, nueva y repetir, política dicha antes de fallar
  (10+, letras y números), mostrar/ocultar; en modo obligatorio explica "Te
  asignaron una contraseña temporal. Elegí una tuya para seguir" y no ofrece
  navegación; en modo voluntario (desde el menú del usuario) vuelve a donde
  estaba. Errores inline de `DomainError.field`.
- Navegación: `/cobranza` y `/reportes` **no** aparecen (T6).
- `(panel)/page.tsx`: búsqueda de socios como acción principal (redirige a
  `/socios?q=`) y accesos por rol; sin métrica-héroe ni tarjetas icono+título.
- Primitivas de §7.4 implementadas con estados default/hover/focus/disabled/
  loading/error; `DataList` colapsa a filas apilables < md; `ReasonDialog`
  con motivo obligatorio y botón que nombra la acción; `FilterBar` escribe en
  `searchParams`.
- Cierra con finish review y `impeccable-documenter` → `DESIGN.md`.
- `web-design-guidelines` pasado antes de entregar.

**Contratos:** `SessionInfo` (con `mustChangePassword`), `AppRole`,
`signIn`/`signOut`/`changePassword` de B1, `passwordPolicySchema` de
`lib/passwords.ts`, `ActionResult`.
**Dependencias:** SH1, B1 (para probar login end-to-end; puede empezar con
las firmas), D0.
**Fuera de alcance:** las pantallas de padrón/usuarios/ajustes/auditoría;
tema oscuro; PWA.
**Skills:** `impeccable` (`.claude/skills/impeccable/SKILL.md`,
`reference/new-work.md` para ejecutar la dirección **ya elegida**,
`reference/craft-floor.md` antes de editar, `reference/operate.md`,
`reference/document.md` al final), `frontend-design`, `web-design-guidelines`,
`vercel-react-best-practices`, `context7` (Next 16 `next/font`, Tailwind v4
`@theme`, shadcn, react-hook-form, Zod v4).

### F2 — Padrón: listado, ficha de ingreso, ficha del socio, baja/reactivación, grupo familiar, apto físico

**Posee:** `src/app/(panel)/socios/**`, `src/views/members/**`.
**No toca:** `views/shared/**` (si falta una primitiva, la pide a F1 en el dev
log y usa lo existente), `views/shell/**`, backend, `supabase/**`, `tests/**`.
**Brief:** `.impeccable/surfaces/route-socios.md`, `route-socios-nuevo.md`,
`route-socios-id.md`.

**Aceptación:**
- `/socios`: búsqueda por nombre/DNI con debounce, filtros (categoría,
  disciplina, estado, tipo) en la URL, filtro "condición de deuda" visible
  pero **deshabilitado** con texto "disponible cuando se activen las cuotas";
  cada fila: nombre, DNI (tabular; "DNI pendiente" si falta), categoría,
  estado (`StatusPill`), aviso de apto físico vencido/por vencer para
  menores; "Ver más" keyset; estados vacío ("Todavía no hay socios cargados"
  con acción "Cargar ficha de ingreso" para admin/editor) / cargando / error;
  `consulta` no ve el botón de alta.
- `/socios/nuevo`: formulario de una columna usable con una mano; DNI con
  `inputmode="numeric"`; practicante muestra disciplina → categoría
  dependientes; fecha de nacimiento con teclado numérico; `dniPending`
  como checkbox explícito "Todavía no tengo el DNI"; errores inline de Zod y
  de `DomainError.field`; éxito → ficha del socio con toast.
- `/socios/[id]`: datos personales, edad y "menor" cuando aplica, grupo
  familiar con integrantes y responsable (y contacto de pago), apto físico
  (estado, vencimiento, "Ver certificado" abre la URL firmada en pestaña
  nueva, "Cargar certificado" con subida directa por URL firmada y progreso),
  historia de alta/baja/reactivación, botón WhatsApp (`wa.me`) si hay
  teléfono; acciones por rol: editar (admin/editor), dar de baja / reactivar
  (**solo admin**, `ReasonDialog` con consecuencia explícita); nunca la
  palabra "eliminar".
- `/socios/[id]/editar`: mismo formulario que alta, sin `joinedOn` ni
  `status` editables.
- Subida del certificado: reduce imágenes > 2 MB en el browser (canvas) antes
  de subir; muestra error legible si el tipo no es admitido; no construye
  URLs de Storage por su cuenta.
- Accesibilidad: labels reales, `aria-describedby` en errores, foco al primer
  error, targets ≥ 44 px.

**Contratos:** `MemberSummary`, `MemberDetail`, `MemberFilters`, `Page<T>`,
actions de B2, primitivas de F1.
**Dependencias:** F1, B2.
**Skills:** `impeccable` (`craft-floor.md`, `operate.md`), `web-design-guidelines`,
`vercel-react-best-practices`, `context7` (Next 16 `searchParams`, Server
Actions con `useActionState`, supabase-js `uploadToSignedUrl` en el browser).

### F3 — Usuarios y auditoría

**Posee:** `src/app/(panel)/(admin)/usuarios/**`, `src/app/(panel)/(admin)/auditoria/**`,
`src/views/users/**`, `src/views/audit/**`.
**No toca:** `views/shared/**`, `views/shell/**`, backend, `supabase/**`,
`tests/**`.
**Brief:** `route-usuarios.md`, `route-auditoria.md`.

**Aceptación:**
- `/usuarios`: listado con nombre, email, `RolePill`, estado (activo /
  desactivado / debe cambiar la contraseña / alta incompleta); alta (email,
  nombre, rol) con la explicación "el sistema genera una contraseña
  temporal; pasásela a la persona, le va a pedir cambiarla al entrar"; al
  crear o restablecer, `TemporaryPasswordDialog` muestra la temporal **una
  sola vez** con botón "Copiar", en tipografía tabular, sin que quede en la
  URL, en el estado global ni en el historial del navegador (se descarta al
  cerrar; no hay "volver a ver"); "Restablecer contraseña" con confirmación
  que nombra la consecuencia ("La contraseña actual deja de servir y va a
  tener que cambiarla al entrar"); cambiar rol y activar/desactivar con
  confirmación; el propio usuario no puede cambiarse, desactivarse ni
  restablecerse (UI lo deshabilita y el backend lo rechaza); "Completar
  alta" en los incompletos.
- `/auditoria`: filtros por tabla (etiquetas en español), usuario, rango de
  fechas, id de registro; lista keyset con fecha/hora en zona del club, quién,
  qué tabla/registro, operación, campos cambiados; detalle expandible con
  antes/después por campo (solo los que cambiaron en UPDATE; todo en INSERT);
  estados vacío/cargando/error; solo lectura.

**Contratos:** `AppUserListItem`, `AuditEntry`, `AuditFilters`, actions de
B1 (`createUser`, `completeUser`, `resetUserPassword`, `changeUserRole`,
`setUserActive`), controller de B3.
**Dependencias:** F1, B1, B3.
**Skills:** `impeccable` (`craft-floor.md`, `operate.md`),
`web-design-guidelines`, `vercel-react-best-practices`, `context7`.

### F4 — Ajustes

**Posee:** `src/app/(panel)/(admin)/ajustes/**`, `src/views/settings/**`.
**No toca:** el resto.
**Brief:** `route-ajustes.md`.

**Aceptación:**
- Disciplinas con sus categorías anidadas visualmente (no tarjetas
  anidadas: lista con encabezados), crear/editar inline o en sheet, activar/
  desactivar con aviso si hay socios activos en la categoría; orden manual
  (`sort_order`); sección "Datos del club" con `club_name`; sin valores de
  cuota (slice 2, se deja el lugar sin botón muerto).
- Estados vacío ("Cargá la primera disciplina"), cargando, error.

**Contratos:** `Discipline`, `Category`, `Settings`, actions de B3.
**Dependencias:** F1, B3.
**Skills:** las mismas de F3.

---

## Lane `tests` — `test-engineer` (después de B y F)

Spec = los criterios de arriba. Prioridad: (1) matriz de RLS y grants por rol
vía PostgREST/SQL con claims reales, **incluido el cierre total con
`must_change_password`**; (2) auditoría append-only y actor; (3) las dos RPC
de contraseña (marker, hash sin cambiar, hash cambiado, sin marker, roles);
(4) transiciones de estado; (5) unicidad de DNI y de responsable; (6) actions
de auth y de usuarios (mocks de Admin API con la forma real de respuesta;
`generateTemporaryPassword` cumple política y no repite); (7) `searchMembers`
con acentos y keyset; (8) PII y contraseñas ausentes en logs. Necesita `pg`
instalado por el hilo principal (S5) y **nunca** resetea la base.

## Lane `review` — `code-reviewer` (en paralelo con tests)

Verifica además: ningún `createAdminClient()` fuera de
`services/auth-admin.service.ts` y `scripts/bootstrap-admin.mjs`; ningún
`SECURITY DEFINER` en `public`; grants por columna donde la matriz lo pide;
ausencia de "eliminar" en copy; contraste medido documentado; una sola
identidad visual.
