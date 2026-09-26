# 02 — Desarrollo backend: B1 (autenticación, sesión y usuarios internos)

Agente: `senior-backend-engineer`. Lane `backend`, tarea **B1** de
`01-tasks.md`. Sin tests (los escribe `test-engineer`), sin migraciones (las
escribe el hilo principal). `npm run typecheck` y `npm run lint` en verde.

## Archivos

Todos nuevos (el slice arrancó sin estos archivos):

- `src/models/app-users.model.ts` — usuarios internos, schemas Zod, las dos
  RPC de contraseña temporal (D8).
- `src/services/auth-admin.service.ts` — adapter sobre la Admin API de Auth.
  Única puerta a `createAdminClient()` en este slice.
- `src/controllers/auth.actions.ts` — `signIn`, `signOut`, `changePassword`.
- `src/controllers/users.controller.ts` — `listUsers` (lectura, cruza
  `app_users` con Auth).
- `src/controllers/users.actions.ts` — `createUser`, `completeUser`,
  `resetUserPassword`, `changeUserRole`, `setUserActive`.
- `scripts/bootstrap-admin.mjs` — bootstrap del primer admin (D9).

No toqué `src/models/types.ts`, `session.controller.ts`, `lib/**`,
`views/**`, `app/**`, `supabase/**`, `tests/**`. Todas las escrituras de
dominio van con el cliente de sesión (`lib/supabase/server.ts`); el admin
client (`createAdminClient()`) solo se usa dentro de `auth-admin.service.ts` y
en `bootstrap-admin.mjs`.

## Nota sobre concurrencia durante el desarrollo (resuelta)

Mientras trabajaba noté modificaciones a `src/models/app-users.model.ts` y a
`scripts/bootstrap-admin.mjs` que yo no había hecho en el momento en que
aparecieron. Causa: lancé un sub-agente (`fork`) solo para **investigar**
tres puntos puntuales de Next 16 / supabase-js (redirect en Server Actions,
paginación de `listUsers`, `current_password`), pero al heredar todo mi
contexto (incluida la consigna original de implementar B1 completo), terminó
implementando y verificando los mismos archivos en paralelo conmigo en vez de
solo reportar. No fue un segundo agente externo ni un problema de la
orquestación del pipeline. Revisé todo lo que escribió, adopté lo que era
correcto (algunas ideas eran mejores que las mías: `isInternalRedirectPath`
exportado del modelo para poder testearse solo, y que `completeUser` no le
vuelva a pedir el email al admin), corregí lo que no (el `.upsert()` con
columnas sin grant de UPDATE, la validación de email con `.trim()` en el
orden equivocado, la traducción demasiado amplia de `23514`), y dejé el
estado final coherente, revisado archivo por archivo y verificado contra la
base local. Al final ambos llegamos independientemente al mismo hallazgo
sobre `current_password` (ver más abajo), lo cual le da más confianza al
resultado, no menos.

## Contratos expuestos

### `app-users.model.ts`

```ts
// Schemas (Zod v4, todos .strict() salvo signInSchema que no necesita serlo
// pero lo es igual)
appRoleSchema no se exporta; APP_ROLES: readonly ['admin', 'editor', 'consulta']
signInSchema: { email, password, next? }
changePasswordSchema: { currentPassword, newPassword, confirmPassword, next? }
  // .refine: confirmPassword === newPassword (field: confirmPassword)
  // .refine: newPassword !== currentPassword (field: newPassword) — chequeo
  //   rápido sin red; la barrera real es confirm_password_changed() comparando
  //   el hash en la base.
createAppUserSchema: { email, displayName, role }
completeAppUserSchema: { userId, email, displayName, role }
  // el email viaja en el input porque el port de authAdmin (ver más abajo) no
  // expone un getUserById; la UI lo saca de la fila `incomplete` que ya le
  // devolvió listUsers.
resetUserPasswordSchema: { userId }
changeUserRoleSchema: { userId, role }
setUserActiveSchema: { userId, isActive }

isInternalRedirectPath(next: string | null | undefined): next is string
  // exportada del modelo (no vive inline en la action) para que sea una
  // unidad que el test-engineer pueda probar sola sin server-only ni Next.

// Lecturas (cliente de sesión)
getAppUser(userId): Promise<AppUser | null>
getAppUserByEmail(email): Promise<AppUser | null>
listAppUsers(): Promise<AppUser[]>

// Escrituras (cliente de sesión)
upsertAppUser({ userId, email, displayName, role, createdBy }): Promise<void>
updateAppUser(userId, { displayName?, role?, isActive? }): Promise<void>
markPasswordReset(userId): Promise<void>          // RPC mark_password_reset
confirmPasswordChanged(): Promise<void>            // RPC confirm_password_changed
```

### `auth-admin.service.ts` (puerto sobre la Admin API)

```ts
export class AuthAdminError extends Error { readonly code?: string }
createWithPassword(email, password): Promise<{ userId: string }>
setPassword(userId, password): Promise<void>
ban(userId): Promise<void>     // ban_duration: '876000h' (100 años; no existe un "para siempre" literal)
unban(userId): Promise<void>   // ban_duration: 'none'
listAuthUsers(): Promise<{ id: string; email: string }[]>   // pagina hasta agotar
```

### `auth.actions.ts`

```ts
signIn(prevState: ActionResult | null, formData: FormData): Promise<ActionResult>
signOut(): Promise<void>
changePassword(prevState: ActionResult | null, formData: FormData): Promise<ActionResult>
```

Firmas exactamente como las pidió F1 (pensadas para `useActionState`).

### `users.controller.ts` / `users.actions.ts`

```ts
listUsers(): Promise<AppUserListItem[]>   // requireRole('admin') adentro

createUser(input: unknown): Promise<ActionResult<{ userId: string; temporaryPassword: string }>>
completeUser(input: unknown): Promise<ActionResult<{ userId: string; temporaryPassword: string }>>
resetUserPassword(input: unknown): Promise<ActionResult<{ temporaryPassword: string }>>
changeUserRole(input: unknown): Promise<ActionResult<void>>
setUserActive(input: unknown): Promise<ActionResult<void>>
```

`input: unknown` a propósito: son Server Actions invocables por red: el tipo
estático del parámetro no es la barrera de seguridad (un cliente arbitrario
puede mandar cualquier JSON), así que se documenta como no confiable y se
valida siempre con `.safeParse()` del schema correspondiente (exportado por
`app-users.model.ts` con el nombre `Create/Complete/ResetUserPassword/
ChangeUserRole/SetUserActive` + `Schema` / `...Input` para el tipo). F3 puede
tipar sus llamadas con esos `*Input` para autocompletado.

## Requisito reforzado por Tomás (mid-task): bloqueo total con contraseña temporal

Mensaje del coordinador durante el desarrollo: mientras `must_change_password`
esté prendido, el usuario no puede hacer nada más que cambiar la contraseña.
Estado final, verificado:

1. **`signIn`**: con credenciales válidas y `must_change_password` prendido →
   `redirect('/cambiar-contrasena')` **ignorando `next` por completo** (ni
   siquiera se lo pasa como query param). `next` solo se usa cuando el login
   fue "normal" (flag apagado).
2. **`changePassword`**: se captura `session.mustChangePassword` **antes** de
   tocar nada (con `requireSession()`, al principio de la action). Si ese
   valor era `true` (modo obligatorio), el éxito redirige **siempre a `/`**,
   ignorando `next` — es la salida de "sin acceso a nada", no una navegación
   que el usuario eligió. Si era `false` (modo voluntario, desde el menú),
   respeta `next` si es una ruta interna. Código: `redirect(!session.mustChangePassword
   && isInternalRedirectPath(next) ? next : '/')`.
3. **Las cinco actions de `users.actions.ts`** llaman `requireRole('admin')`
   como primera línea dentro del `try`. `requireRole` (en `session.controller.ts`,
   no es mío pero lo leí) ya tira `PermissionError` si `session.mustChangePassword`
   es `true`, **antes** de mirar el rol — confirmado leyendo su código: sin
   necesidad de un chequeo extra de mi parte. Cualquier admin con contraseña
   temporal pendiente que intente crear un usuario, resetear una contraseña,
   etc., recibe `PermissionError('Tenés que cambiar tu contraseña antes de
   seguir.')` antes de tocar la base.

Criterio de aceptación para `test-engineer`: cubrir los tres puntos de arriba,
especialmente el de `changePassword` con `next` presente y flag prendido (no
debe ir a `next` bajo ninguna circunstancia).

## `changePassword` deja al usuario logueado en el panel (corregido)

Primera vuelta: leí la línea nueva de `CLAUDE.md` ("lo único que cierra la
sesión: 'Cerrar sesión' y el cambio de contraseña") como un requisito, e hice
que `changePassword` llamara `signOut()` tras el éxito. El coordinador
corrigió esto: esa línea de `CLAUDE.md` estaba mal redactada — describía cómo
funciona Supabase, no era un pedido de producto —, y Tomás pidió exactamente
lo contrario: a usuarios no técnicos no hay que sacarlos de la sesión por
cambiar la contraseña. `CLAUDE.md` ya quedó corregido ("Nunca llamar a
`signOut()` después de un cambio de contraseña").

**Estado final** (revertido a la intención original del contrato de
`01-tasks.md`/§7.3): `changePassword` **nunca llama a `signOut()`**. Después
de `updateUser` (y `confirmPasswordChanged()` si el flag estaba prendido),
`revalidatePath('/', 'layout')` y:
- Modo obligatorio (el flag estaba prendido antes de este cambio): siempre a
  `/`, ignorando `next`.
- Modo voluntario (desde el menú, flag ya apagado): a `next` si es una ruta
  interna, si no a `/`.

**Verificado en vivo contra la base local** (usuario de prueba con
`must_change_password = true`, re-auth con la temporal, `updateUser` a una
contraseña nueva, `confirm_password_changed()`, **sin** `signOut`): la sesión
sigue viva con el mismo cliente (`getUser()` devuelve el usuario, no null), y
una lectura de la fila propia con RLS (lo que hace el layout del panel) ya
muestra `must_change_password: false`. `@supabase/ssr` escribe las cookies
nuevas que `updateUser` puede rotar a través del mismo `setAll` del cliente
de sesión del Server Action — no hace falta nada especial para que el
`redirect` final vea la sesión actualizada, se confirmó de punta a punta.
`revalidatePath('/', 'layout')` sigue siendo necesario: sin él, el layout del
panel podría seguir leyendo (por caché) el flag viejo y mandar de nuevo a
`/cambiar-contrasena` con el flag ya apagado en la base.

Sin aviso pendiente para F1 en este punto: el contrato que ya estaba
consumiendo (quedar logueado, `redirect(next interno ?? '/')`) es el que
queda vigente.

## Decisiones y hallazgos importantes

### 1. `current_password` en `auth.updateUser` NO se valida en este stack (hallazgo crítico, verificado)

La arquitectura (D8) y el comentario en `supabase/config.toml` asumen que
`updateUser({ password, current_password })` verifica la contraseña actual
server-side. **Verifiqué esto contra la base local con un usuario de prueba
real y es falso**: GoTrue solo valida `current_password` si el proyecto tiene
prendida la variable de entorno `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD`
(confirmado con Context7 contra la documentación de Supabase — `docker/CONFIG.md`).
Esa variable **no tiene mapeo en `config.toml`** (a diferencia de
`secure_password_change`, que mapea a `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION`,
una variable distinta que solo gobierna el reauth por OTP/mail). Sin ella,
`updateUser` cambia la contraseña sin más, **aceptando cualquier
`current_password`, incluso uno incorrecto**, y también acepta una
`newPassword` igual a la actual sin el error `same_password` que yo esperaba.

Lo probé end to end con un usuario throwaway: `current_password` incorrecto →
sin error; `newPassword === currentPassword` → sin error. Ambos deberían
haber fallado.

**Mitigación implementada** (no requiere tocar `supabase/**`): en
`changePassword`, antes de llamar a `updateUser`, la action hace un
`supabase.auth.signInWithPassword({ email: session.email, password:
currentPassword })`. Si falla, es la contraseña actual incorrecta →
`DomainError('Tu contraseña actual no es correcta', { field: 'currentPassword' })`.
Verifiqué que esta re-autenticación (a) rechaza correctamente una contraseña
incorrecta con `error.code === 'invalid_credentials'`, (b) no rompe ni
reemplaza la sesión existente cuando falla, y (c) no interfiere con el
`updateUser` posterior cuando es correcta. El chequeo de `error.code ===
'invalid_credentials' | 'same_password'` sobre la respuesta de `updateUser`
se mantiene igual (es inocuo hoy, y se vuelve una segunda capa útil el día
que el proyecto hosted prenda esa variable).

**Pedido al hilo principal** (opcional, no bloqueante gracias a la
mitigación): si se quiere que Auth mismo valide `current_password` —
recomendable como defensa en profundidad, sobre todo en el proyecto hosted—,
hay que setear `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD=true`
como variable de entorno cruda en el contenedor de Auth. En local no hay una
clave de `config.toml` para esto (confirmado contra la documentación); en
hosted, revisar si el dashboard de Supabase expone "Custom SMTP"/env vars
adicionales para GoTrue o si hace falta un ticket de soporte. **No es
urgente**: la mitigación en TypeScript cubre el caso hoy.

### 2. `upsertAppUser` no puede ser un upsert real (verificado con un permission denied real)

Un `.upsert(..., { onConflict: 'user_id' })` de supabase-js arma `INSERT ...
ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, created_by =
excluded.created_by, ...`. Postgres exige privilegio de `UPDATE` sobre
**todas** las columnas del `SET`, incluso cuando el conflicto no ocurre en
tiempo de ejecución (falla en la planificación, no en la ejecución).
`authenticated` no tiene grant de `UPDATE` sobre `email` ni `created_by`
(§6.5: son inmutables por diseño). Lo confirmé con `psql` dentro del
contenedor (`docker exec supabase_db_lonqui psql ...`), como `role
authenticated`: un `INSERT ... ON CONFLICT DO UPDATE SET email = ...` falla
con `permission denied for table app_users`, incluso con un `user_id` que no
existía. Un `INSERT` liso con las mismas columnas, en cambio, funciona.

Por eso `upsertAppUser` es un `INSERT` (no un upsert real) a pesar del
nombre, que mantengo porque así lo nombra `00-architecture.md` §7.2 y es el
que usan `createUser`/`completeUser`. Documentado en el JSDoc de la función.
Un conflicto de PK real (userId que ya tiene fila) es una carrera rarísima —
`createUser`/`completeUser` ya chequean antes que la fila no exista — y se
traduce igual a un `DomainError` genérico si pasara.

### 3. Traducción de errores de `app_users`

`translateAppUsersWriteError` (privada del modelo) distingue:
- `23505` (unique_violation) sobre `app_users_email_key` → `DomainError('Ya
  hay un usuario con ese email', { field: 'email' })`. Verificado con
  `psql`: el mensaje de Postgres incluye literalmente
  `"app_users_email_key"`.
- `23514` (check_violation) **solo si el mensaje coincide exactamente** con
  uno de los dos textos de `private.app_users_guard()` (migración
  `20260925120000_foundation.sql`): auto-cambio de rol/actividad, o
  degradación del último admin. Cualquier otro `23514` (no debería pasar:
  Zod ya valida rol y longitud antes) **no** se traduce: queda como falla
  interna, para no filtrar el texto crudo de una constraint de Postgres al
  usuario. Verificado con `psql` simulando a un admin único intentando
  degradarse a sí mismo: el mensaje exacto que devuelve el trigger es
  `'No podés cambiar tu propio rol ni desactivar tu propio usuario'`.

### 4. `resetUserPassword` sobre uno mismo: regla de UX, no de dominio

A diferencia de `changeUserRole`/`setUserActive` (que el trigger
`app_users_guard` rechaza), **no hay ningún trigger que impida que un admin
se resetee la contraseña a sí mismo** vía `mark_password_reset` — es una
regla de producto ("para eso está `changePassword`"), así que el chequeo
`userId === session.userId` vive en la action, no en la base.

### 5. `listUsers` y las filas `incomplete`

`AppUserListItem` (tipo fijo, no lo puedo tocar) no tiene un lugar natural
para "no hay nada que mostrar todavía". Para una fila `incomplete` (existe en
Auth, no en `app_users`) relleno `displayName: ''`, `role: 'consulta'`,
`isActive: false`, `mustChangePassword: true`, `createdAt: ''` como
placeholders sin significado real — la UI **debe** ramificar por
`authStatus === 'incomplete'` y no leer esos campos como datos válidos.
Documento esto para F3 explícitamente porque no es obvio del tipo.

### 6. Bootstrap del primer admin (D9)

`scripts/bootstrap-admin.mjs`, Node ESM puro, sin imports de `src/` (el
generador de temporal se reimplementa ahí, mismo alfabeto que
`lib/passwords.ts` — documentado en el propio script que hay que mantenerlos
sincronizados a mano).

- Idempotente de verdad: si el email ya existe en Auth **y** en `app_users`,
  no toca nada — **ni siquiera vuelve a llamar `mark_password_reset`**. Esto
  importa: si llamara esa RPC en cada corrida, un segundo `--temporary` por
  error contra el proyecto hosted (con el admin ya usando el sistema y su
  propia contraseña puesta) le volvería a exigir cambiarla sin razón. Solo se
  llama `mark_password_reset` en la rama donde la fila se **acaba de crear**.
- `--force-change` (local) y `--temporary` (hosted) no se combinan (el script
  lo rechaza con un mensaje claro).
- **Actor de auditoría**: el INSERT en `app_users` se hace con
  `service_role`, sin `set_config('app.actor_id', ...)`. El plan (D9) pedía
  actor explícito para ese INSERT, pero **no existe una RPC que permita
  fijar `app.actor_id` desde afuera de una función `SECURITY DEFINER`** —
  inventarla no es mío para decidir (toca `supabase/**`). Confirmé contra la
  base que el INSERT queda con `actor_source = 'system'` y `actor_id = null`.
  **Pedido al hilo principal**: si se quiere `actor_source = 'explicit'` acá,
  hace falta una RPC tipo `public.bootstrap_first_admin(user_id, email,
  display_name, actor_id)` (`SECURITY DEFINER`, `revoke execute from public,
  anon`, sin grant siquiera a `authenticated` — sería solo para
  `service_role`) que haga `set_config('app.actor_id', actor_id::text,
  true)` y el INSERT adentro. Lo dejo así, sin inventar el atajo.

**Verificado end to end contra la base local** (`node --env-file=.env.local
scripts/bootstrap-admin.mjs`, sin flags, con flags, dos veces cada uno):
- Corrida en limpio: crea el usuario de Auth, la fila (`role=admin`,
  `must_change_password` según el modo), y si corresponde el marker.
- Segunda corrida con los mismos datos: detecta todo como existente, no
  toca nada, no imprime ninguna contraseña.
- `--temporary`: genera e imprime la temporal una sola vez; confirmé que en
  la segunda corrida **no** se vuelve a imprimir nada (la fila ya existe).
- El login real con la contraseña de `DEV_ADMIN_PASSWORD` contra
  `http://127.0.0.1:54321` con la publishable key funciona
  (`signInWithPassword` sin error, `user.id` correcto).

**Filas de prueba que quedaron en la base local** (no se pueden borrar: `app_users`
no tiene grant de `DELETE` para nadie, y `auth.users` tiene `on delete restrict`
por la FK — es India intencional, "nada se borra"). Si se quiere una base
local limpia, correr `npm run db:reset` (lo corre el hilo principal, no yo):

| email | user_id | rol | must_change_password |
|---|---|---|---|
| `probe-<ts>@example.com` | `4fcdf3e4-...` | admin | false (se cambió en la prueba) |
| `probe-cp-<ts>@example.com` | `656c1148-...` | consulta | false |
| `probe-reauth-<ts>@example.com` | `90782fc1-...` | consulta | false |
| `probe-bootstrap-force@example.com` | `f94e7aff-...` | admin | true |
| `probe-bootstrap-temp@example.com` | `00c6ac2d-...` | admin | true |

Ninguna tiene datos reales ni contraseñas reutilizables fuera de este
ambiente local.

## Criterios de aceptación implementados (spec para `test-engineer`)

- **Cambiar la contraseña deja al usuario logueado en el panel.**
  `changePassword` nunca llama a `signOut()`: en éxito, la sesión con la que
  entró sigue siendo válida (verificado en vivo). Este es el comportamiento
  correcto y final — no confundir con una vuelta atrás mía a mitad de
  desarrollo (ver sección dedicada más abajo), que quedó revertida.
- `signIn`: mismo mensaje genérico (`'Email o contraseña incorrectos'`) para
  password incorrecta y para email inexistente (no autentica en ningún caso,
  no hay branch que los distinga). Con credenciales válidas: si
  `must_change_password` → `/cambiar-contrasena` **ignorando `next`**; si no,
  a `next` **solo** si `next` empieza con `/` y no con `//` (`isInternalRedirectPath`,
  testeable unitariamente sin mocks de Supabase); si no hay `next` válido, a
  `/`. Usuario que autentica bien pero con `is_active = false`: mensaje
  específico (`'Tu usuario está desactivado...'`) **y** `signOut()` antes de
  devolver el error (la sesión no debe quedar viva). **[DB]** para probar el
  mensaje genérico ante usuario inexistente hace falta Auth real (no se
  puede mockear sin falsear el propio punto del test).
- `changePassword`: exige `requireSession()` (nunca `requireRole`, verificado
  leyendo `session.controller.ts`). Zod: `confirmPassword` debe igualar
  `newPassword` (field `confirmPassword`), `newPassword` debe diferir de
  `currentPassword` (field `newPassword`, chequeo de texto, no de hash).
  Re-autentica con `currentPassword` antes de tocar nada (ver hallazgo #1):
  si falla, `DomainError` con `field: 'currentPassword'`, **la sesión
  original sigue viva** (verificado). Éxito: `confirmPasswordChanged()` si el
  flag estaba prendido (**sin** `signOut()`, ver sección "`changePassword`
  deja al usuario logueado en el panel" más arriba — la sesión sigue viva) y
  `revalidatePath('/', 'layout')`, y redirige a `/` (modo obligatorio, ignora
  `next`) o a `next` interno (modo voluntario) / `/` si no hay `next` válido.
  **[DB]**: el camino "RPC informa que el hash no cambió"
  (`error.code === '23514'` de `confirm_password_changed`) solo se puede
  disparar con la base real (requiere que `newPassword` termine siendo
  bit-a-bit igual al hash anterior pese a pasar la re-autenticación — en la
  práctica casi inalcanzable ahora que hay re-auth previo, pero el código
  sigue ahí como red de contención; documentar el test igual como camino
  defensivo, no como flujo esperable).
- `createUser`: sin rol `admin` → `PermissionError` (vía `requireRole`, que
  también corta si `mustChangePassword` está prendido, ver sección de
  arriba). Email inválido o rol fuera del enum → error de validación con
  `field`. Email ya en `app_users` → `DomainError('Ya hay un usuario con ese
  email', field: 'email')` **antes** de tocar Auth (pre-chequeo). Si Auth ya
  tiene ese email pero `app_users` no (alta incompleta ajena) →
  `AuthAdminError` con `code === 'email_exists'` se traduce a un mensaje que
  invita a revisar la lista. Flujo feliz: `{ userId, temporaryPassword }`,
  fila con `must_change_password = true` (default de columna, no seteado a
  mano), `markPasswordReset` llamado. **[DB]**: la carrera de dos altas
  simultáneas con el mismo email (unique violation real) solo se prueba
  contra Postgres.
- `completeUser`: si la fila ya existe → `DomainError`. Si no, genera
  temporal nueva (la anterior es irrecuperable), `setPassword` +
  `upsertAppUser` (INSERT) + `markPasswordReset`.
- `resetUserPassword`: solo `admin`; sobre uno mismo →
  `DomainError` (regla de UX, ver hallazgo #4, sin trigger de por medio: se
  puede testear en unidad mockeando el modelo/servicio).
- `changeUserRole` / `setUserActive`: no pueden aplicarse sobre uno mismo, ni
  degradar/desactivar al último admin activo — **ambas** vía el trigger
  `app_users_guard`, traducido en `updateAppUser`. **[DB]**: es
  fundamentalmente una prueba de trigger; no se puede simular sin Postgres
  real (el mensaje exacto y el momento en que dispara —serializado con
  advisory lock para el caso del último admin— solo se ve ahí). Verifiqué
  manualmente con `psql` que el mensaje es exactamente `'No podés cambiar tu
  propio rol ni desactivar tu propio usuario'`.
- `setUserActive`: actualiza la fila (con sesión, auditado) **antes** de
  banear/desbanear vía Admin API — si el baneo falla, el dominio ya está
  cerrado por RLS (`is_active = false`) independientemente.
- La temporal nunca se loguea (revisé cada `log.error`/`log.warn` que toco:
  ninguno recibe la contraseña, solo `userId`). Ningún log tiene emails.
- **[DB]** Signup público con la publishable key falla (`enable_signup =
  false` en `config.toml`, no lo toqué, no lo verifiqué de nuevo porque no es
  mío — B1 no lo cambia).

## Fuera de alcance (según el encargo)

UI, mails, MFA, captcha, SSO, borrado de usuarios, reautenticación por OTP.
No toqué `session.controller.ts` ni `types.ts` (ya existían, del hilo
principal).

## Pendientes / pedidos al hilo principal (resumen)

1. **Opcional**: `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD=true`
   como env var cruda del contenedor de Auth (no hay clave de `config.toml`
   para esto) — no bloqueante, ya mitigado en TypeScript con re-auth.
2. **Opcional**: una RPC `service_role`-only para que `bootstrap-admin.mjs`
   pueda fijar `app.actor_id` y el INSERT del primer admin quede con
   `actor_source = 'explicit'` en vez de `'system'`. No la escribí yo (toca
   `supabase/**`).
3. Confirmar que no hay dos agentes B1 corriendo en paralelo (ver "Nota sobre
   concurrencia" arriba).
4. La base local quedó con 5 filas de prueba en `app_users` (emails
   `probe-*@example.com`), listadas arriba. Inofensivas, pero conviene un
   `db:reset` antes de una demo real.
