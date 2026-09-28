# 03 — Revisión de código: padrón, roles y auditoría (slice 1)

Revisor: `code-reviewer`. Fecha: 2026-09-27. Diff revisado: `git diff 98dd918`
(commit `369cd1f` + cambios sin commitear de los fixes de la finish review).
`03-tests.md` no había aterrizado al momento de esta revisión; `tests/` solo
tiene `.gitkeep`.

## Veredicto: **CHANGES REQUESTED**

> Actualizado en la **Segunda pasada** (al final de este archivo, 2026-09-27):
> los 3 blockers originales están resueltos y verificados en la base; queda
> **un blocker nuevo**, introducido por el fix del major 5 ("Ver más" del
> padrón falla siempre por validación). El veredicto sigue siendo
> CHANGES REQUESTED por ese único punto.

Tres hallazgos bloquean el commit de los fixes (uno de seguridad en el login,
uno de completitud de auditoría en una migración ya commiteada, uno de
corrección en la edición del socio). El resto del slice está bien construido:
la matriz de grants y RLS coincide exactamente con el plan, la auditoría es
append-only de verdad (verificado como `postgres` y como `service_role`), no
hay `DELETE` para nadie, las capas se respetan, `typecheck` y `lint` en verde.

## Alcance revisado

`git diff --stat 98dd918`: 150 archivos, +16.570 / −115. Código de producción:
4 migraciones (`supabase/migrations/2026092512*.sql`), seed, `config.toml`,
`src/proxy.ts`, `src/lib/{errors,action-result,passwords}.ts`, 9 modelos, 9
controllers, 2 servicios, 27 archivos en `src/app`, 55 vistas, 3 componentes
shadcn ajustados, `scripts/bootstrap-admin.mjs`, `scripts/capture-screens.mjs`,
CI a Node 22. Docs: pipeline completo, `DESIGN.md`, `.impeccable/**`.

Verificado además contra la base local (`supabase_db_lonqui`, con
transacciones que se revirtieron): grants por tabla y por columna para
`anon`/`authenticated`/`service_role`, ACL de todas las funciones de `public`
y `private`, RLS + `force` en las 9 tablas, `UPDATE`/`DELETE`/`INSERT` sobre
`audit_log` como `postgres` y como `service_role`, rol en `user_metadata`,
inserciones cruzadas por rol, y los tres escenarios de falla que aparecen
abajo como hallazgos.

## Hallazgos (de más a menos severo)

### 1. BLOCKER — Open redirect en el login: `/\evil.com` pasa el filtro de `next`

- `src/models/app-users.model.ts:135-137` (`isInternalRedirectPath`),
  `src/app/(auth)/login/page.tsx:9-12` y
  `src/app/(auth)/cambiar-contrasena/page.tsx:7-10` (`sanitizeNext`, duplicado
  dos veces).
- **Qué está mal.** El chequeo es `startsWith('/') && !startsWith('//')`. El
  parser de URLs de los navegadores (WHATWG) trata la barra invertida como
  barra en esquemas especiales: `Location: /\evil.com` resuelve a
  `https://evil.com/`. La validación deja pasar `/\evil.com`, `/\\evil.com` y
  su forma codificada `%2F%5Cevil.com` (que `searchParams` decodifica antes
  de comparar).
- **Escenario.** Alguien manda por WhatsApp a Tesorería
  `https://<dominio-del-club>/login?next=/\evil.com`. Ella ve el login real
  del club, entra con sus credenciales reales, `signIn` hace
  `redirect('/\evil.com')` y termina en un sitio ajeno que imita el panel y
  le vuelve a pedir la contraseña. El `x-pathname` del proxy no es el
  vector (el proxy lo pisa con `headers.set`, no se puede inyectar): el
  vector es el `next` de la URL, que se acepta tal cual.
- **Arreglo.** Una sola función (dejar `isInternalRedirectPath`, borrar los
  dos `sanitizeNext`) que rechace todo lo que no sea una ruta interna
  estricta: `next.startsWith('/') && !/^\/[\/\\]/.test(next)`; o, más
  robusto, `new URL(next, 'http://x').origin === 'http://x'` y devolver
  `pathname + search` reconstruidos. Cubre también el `Cancelar` de
  `ChangePasswordForm` (`href={effectiveNext}`) y el `next` que arma
  `UserMenu`. Test unitario para `test-engineer`: `/socios?q=a` → ok;
  `//evil.com`, `/\evil.com`, `/\\evil.com`, `https://evil.com`,
  `javascript:alert(1)` → rechazados.

### 2. BLOCKER — Restablecer la contraseña de un usuario que todavía tenía la temporal pendiente no deja rastro en la auditoría

- `supabase/migrations/20260925120000_foundation.sql:286-295`
  (`public.mark_password_reset`) + `:398-412` (`private.audit_row_change`
  omite `UPDATE` sin cambios). Reproducido contra la base local: llamar
  `mark_password_reset` como admin sobre un usuario con
  `must_change_password = true` deja `audit_log` con las mismas filas que
  antes.
- **Qué está mal.** La única huella auditable del restablecimiento es el
  `UPDATE app_users SET must_change_password = true`. Si el flag ya estaba
  en `true` (usuario creado y que nunca entró; usuario ya restablecido una
  vez), el trigger de auditoría no ve cambio y no escribe nada. El marker
  nuevo queda en `private.password_markers` (`set_by`, `set_at`), que no se
  audita y que ningún admin puede ver. CLAUDE.md exige que "cambios de
  usuarios" dejen fila; el contrato (2.3) lo promete.
- **Escenario.** El lunes se crea el usuario de Secretaría (flag en `true`).
  El miércoles un admin le restablece la contraseña (rota las credenciales
  de otra persona). En `/auditoria` no existe el evento del miércoles: la
  Comisión no puede saber que se rotó, ni quién lo hizo.
- **Arreglo (hilo principal, migración nueva).** Hacer que el
  restablecimiento cambie siempre algo auditado: agregar
  `app_users.password_reset_at timestamptz` (sin grant de UPDATE para
  nadie, la escribe solo la RPC) y que `mark_password_reset` haga
  `set must_change_password = true, password_reset_at = now()`. El trigger
  registra `changed_fields = {password_reset_at}` con `actor_id` del admin,
  siempre. Alternativa: una `private.audit_event(table, record_id, context)`
  que inserte la fila explícita desde la RPC. Test [DB] para
  `test-engineer`: dos `mark_password_reset` consecutivos sobre el mismo
  usuario producen dos filas de auditoría con el actor correcto.

### 3. BLOCKER — Editar a un responsable de pago y sacarlo del grupo rompe con un error genérico

- `src/models/members.model.ts:556-576` (`updateMember` escribe
  `family_group_id` sin tocar `is_payment_responsible`) y
  `supabase/migrations/20260925120200_members.sql:56-57` (CHECK
  `members_responsible_has_group`). Reproducido: `UPDATE members SET
  family_group_id = null` sobre Lucía Ejemplo (responsable) → `new row for
  relation "members" violates check constraint
  "members_responsible_has_group"`. `translateMemberError` no traduce esa
  constraint → `failure()` → "No pudimos completar la operación".
- **Escenario.** Secretaría edita a la madre de dos socios (responsable del
  grupo "Familia Ejemplo") y elige "Sin grupo" porque los chicos dejaron el
  club. Recibe un error genérico sin ninguna pista, y no hay forma desde la
  UI de quitarle el flag de responsable antes (solo existe "marcar como
  responsable" a otro integrante activo). Variante peor: la mueven a OTRO
  grupo que ya tiene responsable → `23505` del índice parcial, también
  genérico; o a un grupo sin responsable → pasa a ser responsable del grupo
  nuevo sin que nadie lo haya decidido.
- **Arreglo.** La invariante es del dominio, así que va en Postgres (hilo
  principal): trigger `BEFORE UPDATE` en `members` que haga `new.
  is_payment_responsible := false` cuando `new.family_group_id is distinct
  from old.family_group_id`. En el modelo (B2), además, mandar
  `is_payment_responsible: false` cuando cambia el grupo y traducir
  `members_responsible_has_group` y `members_one_responsible_per_group` a
  `DomainError` con `field: 'familyGroupId'` como red. La UI ya avisa "sin
  responsable" en el grupo de origen (`missingResponsible`). Test [DB] para
  `test-engineer`: responsable movido a otro grupo / a ninguno queda con el
  flag en `false` y el grupo viejo queda `missingResponsible`.

### 4. MAJOR — "Ver certificado" muere a los 60 segundos de abrir la ficha

- `src/controllers/members.controller.ts:32-34` genera la URL firmada
  (`getSignedUrl(path, 60)`) al renderizar la page, no al hacer click.
- **Escenario.** Tesorería abre la ficha de un menor en la cancha, lee los
  datos, charla con el padre y a los dos minutos toca "Ver certificado": la
  pestaña nueva muestra un JSON de Storage (`InvalidJWT`/`Object not
  found`). Con el celular de la sede en modo "se queda abierto" es el caso
  normal, no el raro.
- **Arreglo.** Una Server Action `getMedicalClearanceUrl(clearanceId)`
  (requiere rol activo, firma con TTL corto y devuelve la URL) que el botón
  llama al click y abre; o, como mínimo, subir el TTL a 10–15 minutos. El
  plan decía "60 s para abrir" pensando en la firma bajo demanda.

### 5. MAJOR — "Ver más" del padrón re-encadena todo el keyset en cada render

- `src/app/(panel)/socios/page.tsx:50-64` y
  `src/views/members/members-pagination.tsx`.
- **Qué está mal.** `pages=N` en la URL dispara N lecturas secuenciales de
  `getPadron` (cada una con su query de aptos), hasta 40. Con el tope
  contractual de 1.000 socios, ver la página 20 son 20 viajes a Postgres
  encadenados por request. Además, como la navegación cambia los
  `searchParams` de la misma page, Next vuelve a mostrar `loading.tsx`
  (skeleton) y reemplaza la lista entera en cada "Ver más" (a confirmar en
  el browser; `scroll: false` conserva el scroll pero no el contenido).
- **Arreglo.** Exponer la lectura como Server Action de solo lectura
  (`loadMoreMembers(filters, cursor)` en `members.actions.ts`, con
  `requireRole()` sin roles → cualquier rol activo) y acumular en un Client
  Component como hace `AuditList`; o, si se prefiere mantener la URL como
  estado, subir `MAX_LIMIT` del modelo y pedir `limit = pages * 50` en una
  sola query (con `<= 1000` por el `max_rows` de PostgREST).

### 6. MAJOR (rendimiento) — `listFamilyGroups()` hace 1 + 2·N consultas

- `src/models/family-groups.model.ts:91-99` llama a `getFamilyGroup(id)`
  por cada grupo (dos queries cada una). Lo consumen `/socios/nuevo` y
  `/socios/[id]/editar`, las dos pantallas de carga más frecuentes.
- **Escenario.** 60 grupos familiares (hermanos en distintas categorías es
  el caso común) → 121 consultas en paralelo para abrir la ficha de
  ingreso desde el celular con la conexión de la cancha.
- **Arreglo.** Un solo `select` con embed de PostgREST:
  `family_groups(id, name, payer_contact_name, payer_contact_phone, notes,
  members(id, first_name, last_name, status, is_payment_responsible))` y
  derivar `label`/`missingResponsible` en TS. Para el select del formulario
  alcanza incluso con `id, name` + apellido del responsable.

### 7. MINOR — El `alter default privileges` del schema `private` es un no-op

- `supabase/migrations/20260925120000_foundation.sql:41-42`. Verificado:
  la sentencia no crea fila en `pg_default_acl` y todas las funciones de
  `private` (helpers y triggers) tienen `EXECUTE` para `PUBLIC`
  (`has_function_privilege('anon', ..., 'EXECUTE') = true`), salvo las dos
  con `revoke` explícito (`password_hash_marker`, `enable_audit`).
- **Por qué no es grave hoy.** `anon` y `PUBLIC` no tienen `USAGE` sobre el
  schema `private`, y PostgREST no lo expone: no hay forma de invocarlas.
- **Arreglo.** Reemplazar por `revoke execute on all functions in schema
  private from public, anon` al final de la migración de fundación y
  después de cada `create function` en `private` (o un `revoke` explícito
  por función, como ya se hace con `password_hash_marker`). Test [DB]:
  ninguna función de `private` con `EXECUTE` para `anon`.

### 8. MINOR — `/auditoria` pega a la Admin API de Auth en cada render

- `src/app/(panel)/(admin)/auditoria/page.tsx:57-61` llama `listUsers()`
  (users.controller) solo para el select "Usuario"; eso pagina
  `auth.admin.listUsers` con la secret key cada vez que alguien filtra o
  abre un detalle. Acopla además la page de auditoría al controller de
  usuarios.
- **Arreglo.** Usar `listAppUsers()` del modelo (una query con RLS; el
  admin ve todas las filas) y quedarse con `userId`/`displayName`.

### 9. MINOR — `completeUser` confía en el `email` que manda el browser

- `src/controllers/users.actions.ts:98-114`: el `email` entra del cliente y
  se escribe en `app_users.email`, columna inmutable por trigger. Un admin
  con un devtools abierto (o un bug en la fila `incomplete`) deja para
  siempre en `app_users` un email distinto al de `auth.users`.
- **Arreglo.** Resolver el email en el servidor con
  `auth.admin.getUserById(userId)` (nueva función del port
  `auth-admin.service.ts`) y sacar `email` del schema.

### 10. MINOR — El grupo familiar nuevo se crea antes de validar al socio

- `src/views/members/member-form.tsx:221-231`: `createFamilyGroup` corre
  antes de `createMember`. Si el alta falla (DNI duplicado, por ejemplo),
  el grupo vacío queda creado y aparece en el select de todas las fichas
  siguientes; el usuario reintenta y crea otro.
- **Arreglo.** Aceptar `newFamilyGroup: { name, payerContactName,
  payerContactPhone }` como parte del input de `createMember`/`updateMember`
  y crear grupo + socio en el mismo action (o, mejor, una RPC que lo haga
  en una transacción).

### 11. MINOR — Updates sin `.select()` devuelven éxito con 0 filas

- `src/models/members.model.ts:556-576` (`updateMember`),
  `src/models/medical-clearances.model.ts:154-163`,
  `src/models/family-groups.model.ts:123-137`. Un id inexistente o filtrado
  por RLS termina en "Cambios guardados" sin haber tocado nada.
- **Arreglo.** Encadenar `.select('id').maybeSingle()` y lanzar
  `DomainError('El socio no existe', { status: 404 })` cuando no vuelve
  fila.

### 12. MINOR — Tarjetas anidadas dentro de `Panel`

- `src/views/members/member-form.tsx:363` (campos del grupo nuevo en un
  `div rounded-lg border` dentro del `Panel` "Grupo familiar") y
  `src/views/members/medical-clearance-section.tsx:199` (el formulario de
  subida, bordeado, dentro del `Panel` "Apto físico"). El piso de calidad
  y `DESIGN.md` ("Un panel nunca contiene otro") lo prohíben; el fix 4 de la
  finish review corrigió exactamente esto en `family-group-section.tsx`.
- **Arreglo.** Separador (`border-t` + `pt-4`) o fondo `bg-muted/40` sin
  borde ni radio, como en el resto de las secciones.

### 13. MINOR — El detalle de un INSERT en la auditoría muestra columnas internas

- `src/views/audit/audit-detail-sheet.tsx:24-36`: para `INSERT` lista todas
  las claves de `new_data`, incluidas `id`, `search_text` (la columna
  derivada de búsqueda), `created_by`/`uploaded_by` (uuids crudos) y
  `storage_path`. Presidencia ve "search text: lucia ejemplo 30111222".
- **Arreglo.** Excluir en la vista un set fijo (`id`, `search_text`,
  `created_by`, `uploaded_by`, `updated_at`, `created_at`) y resolver
  `category_id`/`family_group_id` a su nombre cuando sea barato; o, mejor,
  que `audit.model.ts` ya entregue los pares `{label, before, after}`
  saneados y la vista no sepa de columnas.

### 14. MINOR — Offset fijo `-03:00` en vez de la zona del club

- `src/models/audit.model.ts:24-40`. Argentina no tiene horario de verano
  hoy, pero el repo fija `America/Argentina/Buenos_Aires` como única
  verdad de zona (CLAUDE.md, Cuotas) justamente para que un cambio de
  política no reviente cálculos. Convertir `from`/`to` a instante con
  `Intl.DateTimeFormat` y `CLUB_TIME_ZONE` (o una helper `clubDayStart(date)`
  en `lib/dates.ts`) deja una sola fuente.

### 15. NIT — Cursor de auditoría sin escapar en el filtro `or`

- `src/models/audit.model.ts:359-361` interpola `cursor.occurredAt` crudo;
  `members.model.ts` sí usa `pgQuote`. Un cursor manipulado no salta la
  RLS, pero rompe la gramática del filtro con un error genérico en vez de
  ignorarse. Envolver con comillas como en el padrón.

### 16. NIT — Varios detalles chicos

- `src/models/members.model.ts:256-262`: el regex de diacríticos está
  escrito con los caracteres combinantes literales (`[̀-ͯ]`); escribirlo
  `/[̀-ͯ]/g` para que se lea.
- `src/views/members/medical-clearance-section.tsx:15,132-135`: la vista
  importa `@/lib/supabase/client` y llama `storage.from(...).uploadToSignedUrl`.
  La subida directa es la decisión D11, pero conviene envolverla en
  `lib/storage-upload.ts` (`uploadToSignedUrl(path, token, file)`) para que
  ninguna vista conozca la API de supabase-js.
- `src/views/shared/data-list.tsx:128-137`: en escritorio cada celda de
  una fila con `href` es un `<Link>` distinto: cinco links idénticos por
  socio para un lector de pantalla. Un solo link en la primera celda y el
  resto con `onClick` de fila (o `<a>` con `tabIndex={-1}`/`aria-hidden`).
- `src/views/shared/search-input.tsx:65`: `role="searchbox"` sobre un
  `input type="search"` es redundante.
- `src/views/shell/club-mark.tsx`: "NB" blanco sobre `#F26A1B` es 3,06:1.
  Es un placeholder decorativo (`aria-hidden`), pero cuando llegue el escudo
  real no repetir el patrón con texto.
- `src/controllers/settings.controller.ts:3` y `settings.actions.ts:5`
  importan `./session.controller` en vez del alias `@/controllers/...` que
  usa el resto.
- `package.json`: `@types/node ^20` con `engines.node >= 22`.
- `src/app/(panel)/(admin)/auditoria/page.tsx:12-21` duplica la lista de
  tablas auditadas que ya vive en `AuditedTable`/`AUDITED_TABLE_OPTIONS`;
  una constante `AUDITED_TABLES` exportada desde el modelo evita que se
  desincronicen.

## Cobertura que falta (para `test-engineer`)

Nada de esto lo escribe el revisor; se lista como hallazgo de cobertura.

1. **[DB] Matriz de RLS y grants** por rol con claims reales (mi verificación
   fue manual): `consulta` no inserta socios; `editor` no inserta eventos;
   `must_change_password = true` cierra `members` y `audit_log` pero deja
   leer la fila propia; `user_metadata.role = 'admin'` no otorga nada
   (probado: 0 filas y `current_app_role()` null); ninguna tabla de `public`
   con `DELETE` para `authenticated`.
2. **[DB] Auditoría append-only** como `authenticated`, `service_role` y
   `postgres` (`UPDATE`, `DELETE`, `TRUNCATE`); y la regresión del hallazgo
   2: dos `mark_password_reset` seguidos → dos filas con actor.
3. **[DB] Hallazgo 3**: responsable movido de grupo.
4. **Unidad**: `isInternalRedirectPath` con los casos del hallazgo 1;
   `generateTemporaryPassword` cumple `passwordPolicySchema` y no repite en
   1.000 corridas; `zodToApiError` no filtra `keys` en `unrecognized_keys`.
5. **Modelos con mocks**: `searchMembers` keyset con dos socios de mismo
   apellido y con acentos; `calculateAge`/`deriveMedicalClearanceStatus` en
   los bordes (cumple 18 hoy, apto vence hoy, vence en 30 y 31 días);
   `getAuditPage` con `from`/`to` en el límite de medianoche argentina.
6. **Actions**: `createUser` con `email_exists` de Auth; alta incompleta
   (fila falla tras crear Auth) → `listUsers` la marca `incomplete`;
   `changePassword` sin `next` en modo obligatorio; `confirmMedicalClearance`
   rechaza `path` de otro socio y `path` inexistente.
7. **Manual/e2e (no automatizable hoy)**: el repro de F2 (`must_change_password`
   puesto en `true` con la sesión abierta + navegación client-side por la
   barra inferior). `requirePanelAccess` en cada page debería cerrarlo,
   pero nadie lo volvió a probar después de ese cambio. Pedir la
   verificación antes del entregable a la Comisión.

## Lo que está bien

- **Postgres es la defensa real, y se nota.** Grants por columna exactos a
  la matriz §6.5 (`status`, `status_changed_on`, `must_change_password`,
  `password_changed_at`, `joined_on` sin escritura para nadie), `force row
  level security` en las 9 tablas, cero `DELETE`, `service_role` sin
  escritura salvo el bootstrap, las dos RPC de contraseña en `public` con
  `revoke` y chequeo en el cuerpo, `password_hash_marker` y `enable_audit`
  cerradas. Verificado en la base, no en el SQL.
- **Auditoría por triggers, append-only también para `postgres`**, con
  `enable always trigger`, `changed_fields` calculados y actor de
  `auth.uid()`. Ninguna escritura del dominio usa `createAdminClient()`;
  el admin client vive solo en `auth-admin.service.ts` y el bootstrap.
- **Capas limpias.** Ninguna page importa `@supabase/*`; ninguna vista
  importa modelos; los `.actions.ts` solo exportan funciones async, con
  `'use server'` en la línea 1; `requireRole` en toda action, `requirePanelAccess`
  en toda page o controller de lectura, `changePassword` con solo
  `requireSession` como pide el plan.
- **Errores.** `DomainError` con `field` donde el usuario puede actuar;
  los mensajes de los triggers se traducen por texto exacto; ningún `catch`
  devuelve `err.message`; `zodToApiError` no nombra claves desconocidas;
  ningún log con datos personales (solo ids).
- **Contraseñas temporales.** Generadas con `crypto.getRandomValues` sin
  sesgo, viajan una sola vez, el diálogo no se cierra por afuera ni por
  Escape, nunca en URL ni en estado persistente. `changePassword` no llama
  `signOut` (sesión que no vence, como se decidió). `confirm_password_changed`
  compara el hash real y es fail-closed.
- **Diseño.** Una sola identidad (Geist, `#C2410C` medido 5,18:1 para
  texto, `#F26A1B` solo en marcas no textuales), sin kicker, sin
  métrica-héroe, sin emoji, numerales tabulares en DNI/fechas, 44px en
  todo lo que se toca (incluida la corrección en `button.tsx`), estados de
  carga/vacío/error en toda ruta, confirmaciones con motivo y fecha para
  baja y reactivación, nunca la palabra "eliminar", WhatsApp solo como
  `wa.me`. Filtros y búsqueda en `searchParams`.
- **Alcance.** Nada de Fase 2+ en código; `/cobranza` y `/reportes` no
  aparecen; sin importador de CSV; `docs/relevamiento/` sigue ignorado y el
  seed es inventado.

## Blockers (deben resolverse antes del commit de los fixes)

1. Hallazgo 1 — open redirect por `/\` en `isInternalRedirectPath` y los dos
   `sanitizeNext` (B1 + F1).
2. Hallazgo 2 — `mark_password_reset` sin rastro auditable cuando el flag ya
   estaba prendido (hilo principal: migración nueva; ya está commiteado en
   `369cd1f`, se corrige hacia adelante).
3. Hallazgo 3 — responsable de pago que cambia de grupo (hilo principal:
   trigger; B2: modelo y traducción).

Los hallazgos 4 a 6 son majors que conviene atender en la misma tanda; no
frenan el commit por sí solos.

---

# Segunda pasada — 2026-09-27

Diff revisado: `git diff 369cd1f` (48 archivos, +1.540 / −489) más los
archivos nuevos sin trackear: `supabase/migrations/20260927120000_review_fixes.sql`,
`src/lib/safe-redirect.ts`, `src/views/members/member-list.tsx` y `tests/**`.
Leídos `02-development-backend-review-fixes.md`,
`02-development-frontend-review-fixes.md` y `03-tests.md` (SUITE GREEN, 326
tests). Corrí yo mismo `npm run typecheck`, `npm run lint` y `npx vitest run`:
los tres en verde (22 archivos, 326 tests).

Verificado contra la base local (`supabase_db_lonqui`), todo dentro de
`BEGIN … ROLLBACK` con savepoints, con `set local role` +
`request.jwt.claims` como lo hace PostgREST: ACL de las 17 funciones de
`private`, grants de `password_reset_at`, dos `mark_password_reset` seguidos
como admin, el trigger del responsable de pago como `editor` (a ningún grupo,
a un grupo que ya tenía responsable, y un UPDATE de otra columna), un INSERT
de `app_users` + `mark_password_reset` como `service_role` (el camino del
bootstrap), y un INSERT de `members` como `editor` (triggers de `private` sin
grant explícito). Además, contra PostgREST con un token real de
`editor@lonqui.test`: el embed `family_groups → members` de `listFamilyGroups`
y las columnas `->>` de `LABEL_COLUMNS` de la auditoría.

## Veredicto de la segunda pasada: **CHANGES REQUESTED**

Un solo blocker, nuevo, introducido por el fix del major 5. Los tres blockers
originales están resueltos y comprobados. Todo lo demás está resuelto o
diferido con justificación razonable.

## Estado por hallazgo

| # | Hallazgo original | Estado | Evidencia |
|---|---|---|---|
| 1 | BLOCKER — open redirect `/\evil.com` | **Resuelto** | Única fuente `src/lib/safe-redirect.ts` (resuelve contra un origen ficticio, rechaza controles y `\`). La copia del modelo se borró; `login/page.tsx`, `cambiar-contrasena/page.tsx` y `auth.actions.ts` importan de ahí. `tests/lib/safe-redirect.test.ts` cubre `/\evil.com`, `//x`, `https://x`, controles. |
| 2 | BLOCKER — reseteo sin rastro en auditoría | **Resuelto** | Migración `20260927120000_review_fixes.sql`: `app_users.password_reset_at` con `clock_timestamp()`. En la base: dos `mark_password_reset` seguidos como admin sobre el editor del seed → **2 filas** en `audit_log` (`{must_change_password,password_reset_at}` y `{password_reset_at}`), `actor_id` = el admin. `password_reset_at` tiene solo `SELECT` para `authenticated`/`service_role`, ningún `UPDATE`. Como `service_role` (bootstrap) también deja fila, con `actor_source = system`. |
| 3 | BLOCKER — responsable de pago que cambia de grupo | **Resuelto** | Trigger `members_clear_responsible_on_group_change` (`BEFORE UPDATE OF family_group_id`). Como `editor`: a `null` → `is_payment_responsible = false`, sin error, auditado como `{family_group_id,is_payment_responsible}`; a un grupo que **ya tiene** responsable → flag `false`, sin `23505`; `UPDATE notes` no toca el flag. `translateMemberError` traduce las dos constraints como red. |
| 4 | MAJOR — "Ver certificado" muere a los 60 s | **Resuelto** | `getMedicalClearanceUrl` (`members.actions.ts`): `requireRole()` sin roles, verifica `clearance.memberId === input.memberId` y `storagePath` antes de firmar; firma 60 s **al click**. `MedicalClearanceSection` abre la pestaña en el gesto de click y le asigna la URL al llegar; error en `role="alert"`, spinner mientras carga. `getMemberPage` ya no firma nada. |
| 5 | MAJOR — "Ver más" re-encadenaba el keyset | **Parcial — REGRESIÓN** | La arquitectura es la correcta (`MemberList` Client Component + `loadMoreMembers` Server Action, sin `pages` en la URL, `Pagination` deshabilita el botón mientras carga). Pero **"Ver más" falla siempre**: ver blocker nuevo abajo. |
| 6 | MAJOR — `listFamilyGroups` 1 + 2·N | **Resuelto** | Un solo `select` con embed `members(...)`, compartido por `getFamilyGroup`/`listFamilyGroups`. Verificado con PostgREST como `editor`: una request devuelve grupo + integrantes. Un único FK `members_family_group_id_fkey` → el embed no es ambiguo. |
| 7 | MINOR — `alter default privileges` no-op en `private` | **Resuelto** | En la base: **0** funciones de `private` con `EXECUTE` para `PUBLIC` o `anon`; solo `club_today`, `normalize_text`, `current_app_role`, `has_role`, `is_admin` para `authenticated`/`service_role`. Los triggers siguen disparando como `editor` (INSERT de `members` con `search_text` y `admission`) y como `service_role` (INSERT de `app_users`): Postgres no exige `EXECUTE` al disparar un trigger. |
| 8 | MINOR — `/auditoria` pegaba a la Admin API | **Resuelto** | `listAuditActorOptions()` en `audit.controller.ts` (`requirePanelAccess('admin')` + `listAppUsers()`); la page ya no importa `users.controller`. |
| 9 | MINOR — `completeUser` confiaba en el `email` del browser | **Resuelto** | `getAuthUserEmail(userId)` en `auth-admin.service.ts`; `completeUser` escribe ese. Nit: `completeAppUserSchema` sigue pidiendo `email` que después se ignora. |
| 10 | MINOR — grupo creado antes de validar al socio | **Parcial (aceptable)** | Alta: `createMember({ newFamilyGroup })` chequea DNI antes y crea el grupo después; `superRefine` rechaza `familyGroupId` + `newFamilyGroup` juntos. Edición: sigue creando el grupo antes de `updateMember` (deferral documentado en el dev log de frontend; `updateMember` no acepta `newFamilyGroup`). Residual de carrera documentado en el código. No bloquea. |
| 11 | MINOR — updates sin `.select()` | **Resuelto** | `updateMember`, `updateMedicalClearance`, `updateFamilyGroup` encadenan `.select('id').maybeSingle()` y tiran `DomainError` 404. |
| 12 | MINOR — tarjetas anidadas en `Panel` | **Resuelto** | `member-form.tsx` (grupo nuevo) y `medical-clearance-section.tsx` (form de subida) pasan a `border-t … pt-*`. |
| 13 | MINOR — columnas internas en el detalle de un INSERT | **Resuelto** | `HIDDEN_FIELDS` en `audit-detail-sheet.tsx` (`id`, `search_text`, `created_by`, `uploaded_by`, `updated_at`, `created_at`). |
| 14 | MINOR — offset `-03:00` fijo | **Resuelto** | `clubMidnightUtc` en `audit.model.ts` con `Intl.DateTimeFormat` + `CLUB_TIME_ZONE`. Revisada la aritmética: correcta. Cobertura pendiente (lo dice `03-tests.md`). |
| 15 | NIT — cursor de auditoría sin escapar | **Resuelto** | `pgQuote` local en `audit.model.ts`, aplicado en los dos usos del `.or()`. |
| 16a | NIT — regex de diacríticos | **Resuelto** | `/[̀-ͯ]/g`. |
| 16b | NIT — vista importa `@/lib/supabase/client` | **Sin resolver (diferido)** | `lib/storage-upload.ts` es del hilo principal. No bloquea. |
| 16c | NIT — cinco links por fila | **Resuelto** | `data-list.tsx`: solo la primera celda es link accesible; el resto `tabIndex={-1}` + `aria-hidden`. |
| 16d | NIT — `role="searchbox"` redundante | **Resuelto** | Quitado. |
| 16e | NIT — `club-mark` contraste | **N/A** | Informativo para cuando llegue el escudo. |
| 16f | NIT — imports relativos de `session.controller` | **Resuelto** | `settings.*` y `audit.controller` usan el alias. |
| 16g | NIT — `@types/node ^20` | **Sin resolver** | `package.json` sigue en `^20` con `engines.node >= 22`. Hilo principal (`npm install`). No bloquea. |
| 16h | NIT — lista de tablas auditadas duplicada | **Parcial** | `AUDITED_TABLES` existe en `audit.model.ts`, pero `auditoria/page.tsx:11` conserva su propio `Set` y `audit-labels.ts` su `AUDITED_TABLE_OPTIONS`. No bloquea. |

## Regresiones nuevas

### R1. BLOCKER — "Ver más" del padrón falla siempre: `limit` no pasa el schema estricto

- `src/app/(panel)/socios/page.tsx:30-37` (`parseFilters` devuelve
  `{ …, limit: LIST_PAGE_SIZE }`) → `src/views/members/member-list-view.tsx:107`
  (pasa ese mismo `filters` a `MemberList`) →
  `src/views/members/member-list.tsx:55` (`loadMoreMembers({ filters, cursor })`)
  → `src/models/members.model.ts:333-350` (`memberFiltersSchema` es
  `.strict()` y **no tiene `limit`**).
- **Qué está mal.** El objeto que viaja a la action lleva `limit: 50`; Zod
  lo rechaza con `unrecognized_keys` (`Unrecognized key: "limit"`, path
  `filters`) y la action devuelve `invalid(...)`. Reproducido con el schema
  literal y el objeto que arma `parseFilters`: falla; sin `limit` (aun con
  claves en `undefined`) pasa. Ningún test lo atrapó porque
  `tests/models/members.model.test.ts:191-216` y
  `tests/controllers/members.actions.test.ts:207-212` prueban
  `loadMoreMembersSchema` con `filters: {}` a mano, nunca con la forma que
  la page produce de verdad.
- **Escenario.** Padrón con los ~250 socios del club (o cualquiera con más
  de 50). Secretaría abre `/socios`, ve los primeros 50 y toca "Ver más": el
  botón gira, y debajo de la lista aparece el mensaje de validación genérico
  de `zodToApiError`. Nunca ve al socio 51 desde el listado; solo por
  búsqueda. Es el caso del primer día con datos reales.
- **Efecto secundario cuando se arregle.** Aunque `limit` pase, `loadMoreMembers`
  llama `searchMembers({ ...filters, cursor })` y `searchMembers` sin `limit`
  usa `DEFAULT_LIMIT = 30` (`members.model.ts:278`): la primera tanda sería de
  50 y las siguientes de 30. Conviene que el tamaño de página sea uno solo.
- **Arreglo (dos lanes).** Backend: agregar `limit: z.number().int().min(1)
  .max(MAX_LIMIT).optional()` a `memberFiltersSchema` (acotado, no abierto) y
  pasarlo a `searchMembers`, **o** fijar en la action el mismo tamaño que la
  page (un `PADRON_PAGE_SIZE` exportado del modelo y usado por los dos).
  Frontend: que `MemberListView`/`MemberList` manden a la action solo las
  claves de filtro (`q`, `categoryId`, `disciplineId`, `status`,
  `memberType`), nunca `cursor`/`limit` "de arrastre". Con cualquiera de las
  dos alcanza; con las dos queda robusto a la próxima clave que alguien sume
  a `MemberFilters`.

No encontré otras regresiones: la matriz de grants sigue igual (verificada),
`audit_log` sigue append-only, ninguna page importa `@supabase/*`, los
`.actions.ts` siguen exportando solo funciones async, ningún `catch` devuelve
`err.message`, ningún log con datos personales, `docs/relevamiento/` sigue
ignorado, nada de Fase 2+ en código.

## Para `test-engineer` (cobertura)

1. **R1, de contrato:** un test que tome el objeto que produce `parseFilters`
   de `socios/page.tsx` (o su forma exacta, con `limit`) y lo pase por
   `loadMoreMembersSchema`. Es el test que habría atrapado el blocker: el
   schema se probó solo con `filters: {}`. Si `parseFilters` no es
   importable desde `tests/`, pedir que se mueva a un módulo testeable.
2. **Tamaño de página estable:** la segunda tanda de `loadMoreMembers` tiene
   el mismo `limit` que la primera (`getPadron`).
3. Lo que `03-tests.md` ya lista como pendiente: `listFamilyGroups`/`getFamilyGroup`
   con el embed (grupo sin integrantes → `members: []`; responsable dado de
   baja → `missingResponsible: true`), y `getAuditPage` con `from`/`to` en
   el borde de medianoche argentina vía `clubMidnightUtc`.

## Notas que no afectan el veredicto

- `MemberDetail.medicalClearanceUrl` (`types.ts:204`) quedó como campo
  muerto: siempre `null`, sin consumidores. Sacarlo en la próxima tanda que
  toque `types.ts`.
- El árbol de trabajo trae también `docs/pipelines/2026-09-27-cuotas-pagos-panel/`
  (`00-architecture.md`, `01-tasks.md`), `.impeccable/surfaces/route-cobranza.md`
  y el párrafo nuevo de "Roles configurables" en `CLAUDE.md`. Son planificación
  del slice siguiente, no código de este: el orquestador decide si entran en
  este commit o en el suyo.

## Blockers (segunda pasada)

1. **R1** — `limit` en `filters` rompe `loadMoreMembers` (frontend: mandar
   solo claves de filtro; backend: aceptar `limit` acotado o fijar el tamaño
   de página en un solo lugar). Después del fix, re-revisión rápida de
   `member-list.tsx`, `member-list-view.tsx`, `members.model.ts` y
   `members.actions.ts`, más el test de contrato del punto 1.

---

# Tercera pasada — 2026-09-27

Dos alcances con veredicto separado. Corrí `npm run typecheck`, `npm run lint`
y `npx vitest run` sobre el árbol completo: los tres en verde (22 archivos,
**335 tests**; los 9 nuevos respecto de la segunda pasada cubren R1 y
`PADRON_PAGE_SIZE`).

## (A) R1 — "Ver más" del padrón: **APPROVED**

- `src/models/members.model.ts:288-291`: `PADRON_PAGE_SIZE = 50` exportado;
  `clampLimit` cae a esa constante cuando no viene `limit`. `memberFiltersSchema`
  y `loadMoreMembersSchema` siguen `.strict()` sin `limit`/`cursor`: el
  tamaño de página lo decide el servidor.
- `src/app/(panel)/socios/page.tsx`: `parseFilters` ya no mete `limit`;
  `getPadron({ ...filters, limit: PADRON_PAGE_SIZE })` solo para la primera
  tanda; `filters` sigue de largo hacia el cliente sin claves extra.
- `src/views/members/member-list.tsx:60-70`: `loadMoreMembers` recibe un
  objeto armado a mano con exactamente `q`, `categoryId`, `disciplineId`,
  `status`, `memberType`. Defensivo contra cualquier clave futura de
  `MemberFilters`.
- Cobertura: `tests/models/members.model.test.ts:219-298` — regresión R1
  (`filters` con `limit` → rechazado), `PADRON_PAGE_SIZE` es la única fuente
  y la page la importa del modelo. El frontend además lo probó en caliente
  (5 → 10 → 11 filas con página de 5).

Sin regresiones nuevas en (A).

## (B) Cimientos del slice 2 (migraciones 0005–0007, seed, contratos): **CHANGES REQUESTED**

Un blocker chico (tres líneas) y cinco minors. El SQL es sólido: la matriz
§6.7 se cumple celda por celda, las invariantes están en Postgres, la deuda se
deriva bien y las dos desviaciones del spec están justificadas.

### Cómo se verificó

`supabase_db_lonqui` tiene las tres migraciones aplicadas **pero no el bloque
de seed del slice 2** (se aplicaron sin `db:reset`: `billing_start_period`
null, `fee_prices`/`fees`/`payments` vacías). No reseteé la base: ejecuté el
bloque de seed **dentro de mi transacción** (como `postgres`, igual que
`db reset`) y corrí toda la batería sobre ese estado, con savepoint por
sentencia y `ROLLBACK` final. Eso además verifica el seed: 2 valores de
cuota, 11 cuotas del mes + 2 saldos de arranque, 5 pagos (1 anulado), una
corrida `cron` ok con `actor_id` null, y 20 filas de `audit_log` con
`actor_source = 'system'`.

Contra PostgREST con tokens reales: `my_permissions()` como `consulta`
devuelve exactamente `{members.read, payments.read, reports.read,
reports.export}`; `members?select=…,member_debt_status&member_debt_status=eq.in_debt`
se acepta como campo calculado; `rpc/member_accounts` admite `order`,
`Range` y `count=exact`; `anon` recibe `42501` en campos calculados y RPCs;
`generate_pending_fees` como `consulta` → "No tenés permiso para generar
cuotas".

### Lo verificado en la base (todo con el resultado esperado)

- **Permisos (§6.8):** `can()`/`my_permissions()` por rol exactos al
  catálogo (admin 12, editor 6, consulta 4); con contraseña temporal
  pendiente → `{}` y todo `can` false; `user_metadata.role = 'admin'` en el
  JWT no otorga nada. Cero funciones de `private` con EXECUTE para
  PUBLIC/anon; cero funciones públicas nuevas ejecutables por `anon`; ningún
  objeto de las tres migraciones (funciones ni policies) usa `has_role`/`is_admin`.
- **Grants:** las cuatro tablas con RLS `enable` + `force`; `authenticated` y
  `service_role` solo SELECT a nivel tabla; grants por columna exactos a
  §6.7; **nadie tiene DELETE**; `billing_runs` sin INSERT para nadie
  (verificado como `admin`); auditoría prendida en `fee_prices`, `fees`,
  `payments` y no en `billing_runs` (0 filas en `audit_log`).
- **`fee_prices`:** `editor` no inserta (RLS); `admin` mes pasado → error;
  mes actual ya generado → "Las cuotas de 09/2026 ya se generaron con otro
  valor; el nuevo aplica desde 10/2026"; mes +2 → OK con `created_by` admin;
  duplicado → `fee_prices_unique_target`; UPDATE/DELETE → `permission
  denied` como admin y `forbid_change` como `postgres`. `fee_price_for`:
  Vóley Mayores este mes 10.000 (default), el que viene 12.000 (categoría);
  no practicante → default.
- **`settings`:** volver a null → error; cambiar con cuotas → error; `editor`
  → 0 filas. `service_role` no tiene UPDATE sobre `settings`, así que el
  bypass `auth.uid() is null` del guard solo alcanza al seed.
- **`fees`:** `editor` carga saldo de arranque → `period = 2026-08-01`
  (inicio − 1), descripción por defecto, `created_by` editor; segundo
  vigente → `fees_one_opening_balance`; `monthly` → RLS; `admin` anula sin
  motivo → error; con motivo → `voided_by` admin, auditado como
  `{void_reason,voided_at,voided_by}`; dos veces → error; `amount_cents`
  inmutable incluso como `postgres`; tras anular se puede cargar otro.
- **`payments`:** `consulta` → RLS; `editor` inserta con `created_by` propio
  y `paid_on` hoy; mismo `(batch_id, member_id)` → 23505; mañana → error;
  monto 0 → CHECK; `editor` anula → "No tenés permiso para anular pagos";
  adjunta comprobante → OK; reemplazar/quitar → error; `admin` anula → OK,
  dos veces → error; `service_role` INSERT → `permission denied`, SELECT sí.
- **Deuda derivada (§6.6) con el seed:** 12345678 pagó 30.000 con un cargo
  de 10.000 → `balance −20.000`, `credit`, `months_due 0`; 48555666 parcial
  → `partial` con `covered 5.000`, `months_due 1`; 50111333 arranque 20.000
  + cuota, pagó 10.000 → arranque `partial`, cuota `due`, `months_due 2`,
  `oldest 2026-08-01`; `month_collection` 55.000 (50.000 efectivo + 5.000
  transferencia, 4 pagos, el anulado excluido); `dashboard_summary`
  `total_debt` 125.000 = solo saldos positivos de activos, `credit_cents`
  20.000 aparte, `pending_periods = {}`; `debt_by_category` suma igual que
  `total_debt_cents` y "No practicantes" al final; `monthly_history(3)`
  con la deuda de agosto = los dos saldos de arranque (50.000).
- **Generación:** `admin` → `ok`, 0 creadas, fila `manual` con su
  `actor_id`; alta tardía del mes + regenerar → 1 cuota con
  `fee_price_id`, `created_by` admin y `audit_log.actor_source = 'session'`.
  **Camino de error (la desviación del spec):** sin precio para el mes →
  `(error, 0, "No hay un valor de cuota vigente para Juveniles")`, **0
  cuotas nuevas** (el período entero se revirtió), **la fila `error` de
  `billing_runs` persiste** con el actor; reintento tras corregir → `ok, 1`.
  Es exactamente lo que el spec quería y lo que relanzar el error habría
  roto: la desviación es correcta.
- **`log_export`** como `consulta` → fila `EXPORT` con su id, `actor_source
  session` y `context {listing, filters, row_count}`; como `anon` →
  `permission denied`.
- `pg_cron`: `lonqui-generate-fees` `5 3 1 * *` y `lonqui-cron-cleanup`
  activos, `username = postgres`; `postgres` local tiene `bypassrls`, así
  que las DEFINER escriben `billing_runs`/`audit_log` con RLS forzada.
- Toda FK de las tablas nuevas tiene índice con esa columna al frente.

### Hallazgos

#### B1. BLOCKER (chico) — el filtro "Tabla" de `/auditoria` ofrece Valores de cuota / Cargos / Pagos y los ignora en silencio

- `src/views/audit/audit-labels.ts:20-22` (`AUDITED_TABLE_OPTIONS` suma
  `fee_prices`, `fees`, `payments`) vs. `src/app/(panel)/(admin)/auditoria/page.tsx:11-20`
  (el `Set` local `AUDITED_TABLES` sigue con las 8 tablas del slice 1) y
  `src/models/audit.model.ts:28-37` (`AUDITED_TABLES` del modelo, ídem).
- **Escenario.** Con el seed reseteado hay 20 filas de auditoría de
  cuotas/pagos. Presidencia abre `/auditoria`, elige "Pagos" en el select:
  la URL queda `?tableName=payments`, `parseFilters` no lo reconoce →
  `tableName: undefined` → la lista muestra **todas** las tablas mientras el
  select dice "Pagos". Un filtro del registro institucional que no filtra.
- **Arreglo.** Agregar las tres tablas a `AUDITED_TABLES` del modelo y que
  la page importe esa constante en vez de su `Set` (cierra también el nit
  16h). Test para `test-engineer`: `AUDITED_TABLE_OPTIONS` ⊆ lo que la page
  acepta.

#### B2. MINOR — anular un cargo como `editor` es un "0 filas" mudo; anular un pago da mensaje

- `20260927130000_billing.sql:543-546` (`fees_update` USING solo
  `payments.void`) vs. `20260927130100_payments.sql:131-134`
  (`payments_update` USING `register or void`, y el trigger da el mensaje).
  Verificado: el UPDATE del editor sobre `fees` no falla, afecta 0 filas.
- **Consecuencia para B2 (backend):** la action de anular cargo tiene que
  encadenar `.select('id').maybeSingle()` y tratar 0 filas como "sin
  permiso / no existe", igual que el minor 11 del slice 1. O alinear la
  policy con la de `payments` para que el mensaje del trigger llegue.

#### B3. MINOR — se puede adjuntar un comprobante a un pago ya anulado

- `20260927130100_payments.sql:99-109`. Verificado: como `admin`, UPDATE de
  `receipt_storage_path` sobre un pago con `voided_at` → OK. Un comprobante
  sobre un pago anulado es ruido en el estado de cuenta y en Storage.
- **Arreglo.** En `attaching`, rechazar si `old.voided_at is not null` (o si
  `voiding` en la misma sentencia).

#### B4. MINOR (a futuro) — los guards leen otras tablas bajo la RLS de quien escribe

- `private.settings_billing_guard` lee `fees` y `fee_prices`;
  `private.fee_prices_insert_guard` lee `fees`; `private.fees_opening_balance_guard`
  lee `settings`. Son INVOKER: el `exists (select 1 from public.fees …)`
  corre con las policies del usuario. Hoy `admin` tiene `payments.read` y
  todo cierra; con roles configurables, un rol con `billing.configure` sin
  `payments.read` vería 0 cuotas y podría cambiar el mes de inicio o fijar
  un precio para un mes ya generado.
- **Arreglo.** `security definer` en esos tres guards (viven en `private`,
  ya sin EXECUTE para PUBLIC): la invariante no debe depender de quién
  escribe. Puede ir en el pipeline de roles, pero conviene dejarlo anotado
  en el SQL.

#### B5. MINOR — `log_export` acepta `listing` y `filters` arbitrarios de cualquier rol

- `20260927130200_accounts.sql:541-562`. Con `reports.export` para los tres
  roles, cualquier sesión puede insertar por PostgREST filas `EXPORT` con
  `table_name` y `context` a gusto (y de cualquier tamaño) en el registro
  append-only. No compromete datos, pero ensucia un registro que no se
  puede limpiar.
- **Arreglo (slice 3, cuando existan los listados):** `listing` contra una
  lista cerrada (`raise` si no está) y un tope de tamaño para `filters`.

#### B6. NITS

- `payments_batch_id_idx` es redundante: es el prefijo de la unique
  `payments_batch_member_key`. `fees_member_not_voided_idx` queda casi
  cubierto por `fees_member_period_idx`; con 250 socios no importa, pero es
  mantenimiento de índices gratis.
- `dashboard_summary.admissions_count` cuenta `admission` **y**
  `reactivation`; el tipo `DashboardSummary.admissionsCount` no lo dice.
  Documentarlo en `types.ts` (o separar `reactivationsCount`).
- `src/models/audit.model.ts` `buildLabelDraft` devuelve `null` para las
  tres tablas nuevas → "un pago"/"un cargo" sin nombre en el listado, y
  `AUDIT_FIELD_LABELS` no tiene sus columnas. Es trabajo de F4/B3 del slice
  2, no de estos cimientos; queda anotado para que no se pierda.
- `01-tasks.md` S1 sigue diciendo que `generate_pending_fees()` "relanza" el
  error; actualizar la tarea al contrato real `(status, fees_created,
  error_message)` para que B1 (backend) no lo implemente de memoria. La
  action tiene que mapear `status = 'error'` → `DomainError(error_message)`
  y `'skipped'` → mensaje informativo.
- **Operativo:** antes de correr el lane de tests y los agentes de desarrollo
  del slice 2, `npm run db:reset`: la base local hoy no tiene el seed del
  slice 2 (`billing_active = false`, tablas vacías). `database.types.ts` sí
  está regenerado.
- Siguen sin resolver del slice 1, sin bloquear: `MemberDetail.medicalClearanceUrl`
  muerto, `@types/node ^20`, wrapper `lib/storage-upload.ts`.

### Contratos (SH1, SH1b, SH2, `lib/dates.ts`)

Coinciden con la spec: `Permission` en el orden de §6.8,
`SessionInfo.permissions`, los 23 tipos de §8.2 con centavos `number` y
fechas ISO, `AuditedTable` + 3, `MemberFilters.debt` sin el comentario viejo.
`getOwnPermissions` fail-closed; `getSession` lo lee en `Promise.all`;
`requirePermission` exige **todos** y hereda las cuatro condiciones de
`requireRole`; `requirePanelPermission` redirige a `/`. `AmountField`
(pesos → centavos, `inputMode="decimal"`, `tabular-nums`, "Ingresá un monto
válido", `role="alert"`), `DebtStatusPill` + variante `credit` con contorno,
`PeriodText`, las cinco tablas de `labels.ts` con los textos exactos.
`addMonths`/`previousPeriod`/`lastDayOfPeriod`/`periodRange` con aritmética
entera. Cobertura pendiente para `test-engineer`: la aceptación de SH1b
(`requirePermission`/`requirePanelPermission` con mocks) y unidades de
`lib/dates.ts` nuevas (`lastDayOfPeriod` en febrero bisiesto, `addMonths`
negativo cruzando año).

### Blockers de (B)

1. **B1** — `/auditoria` no filtra por las tres tablas nuevas que su propio
   select ofrece. Tres líneas: `AUDITED_TABLES` del modelo con las 11 tablas
   y la page importándola.
