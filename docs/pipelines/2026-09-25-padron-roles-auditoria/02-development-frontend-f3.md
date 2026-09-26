# 02 — Desarrollo frontend: F3 (usuarios y auditoría)

Agente: `frontend-react-craftsman`. Tarea **F3** de `01-tasks.md`. Este archivo es
mío (no toco `02-development-backend-*.md` ni los otros `02-development-frontend-*.md`).

## Alcance cubierto

- `/usuarios` (solo admin): listado, alta con contraseña temporal, completar
  alta incompleta, cambiar rol, restablecer contraseña, activar/desactivar.
  `TemporaryPasswordDialog` de una sola vista.
- `/auditoria` (solo admin, solo lectura): filtros (tabla, usuario, rango de
  fechas, id de registro), lista keyset con "Ver más", detalle expandible con
  antes/después por campo.
- Estados de carga y error (`loading.tsx`/`error.tsx`) en ambas rutas.

## Archivos

Todos nuevos (el slice arrancó sin estos archivos), dentro de mi lane
exclusivo:

- `src/app/(panel)/(admin)/usuarios/page.tsx`, `loading.tsx`, `error.tsx`
- `src/app/(panel)/(admin)/auditoria/page.tsx`, `loading.tsx`, `error.tsx`
- `src/views/users/`: `users-view.tsx`, `user-status.tsx`, `user-row-menu.tsx`,
  `create-user-dialog.tsx`, `complete-user-dialog.tsx`, `change-role-dialog.tsx`,
  `toggle-active-dialog.tsx`, `reset-password-dialog.tsx`,
  `temporary-password-dialog.tsx`
- `src/views/audit/`: `audit-labels.ts`, `audit-filters.tsx`,
  `audit-date-range-filter.tsx`, `audit-list.tsx`, `audit-detail-sheet.tsx`

No toqué `views/shared/**`, `views/shell/**`, ningún `.controller.ts`/
`.model.ts`, `supabase/**` ni `tests/**`.

## Contratos consumidos (no editados)

- `AppUserListItem`, `AuditEntry`, `AuditEntryDetail`, `AuditFilters`,
  `AuditedTable`, `Page<T>` de `src/models/types.ts`.
- `listUsers()` (`users.controller.ts`) y `createUser`/`completeUser`/
  `resetUserPassword`/`changeUserRole`/`setUserActive` (`users.actions.ts`) de B1.
- `getAuditPage`/`getAuditEntry` (`audit.controller.ts`) de B3.
- `requireRole` de `session.controller.ts` (SH1).
- Primitivas de `views/shared/`: `PageHeader`, `DataList`, `StatusPill`/
  `RolePill`, `EmptyState`/`ErrorState`/`LoadingList`, `FilterBar`,
  `SearchInput`, `Pagination`, `DateTimeText`, `auditOpLabels`,
  `memberStatusEventLabels`, `appRoleLabels`/`appRoleDescriptions`.

## Decisiones de diseño y arquitectura

### `TemporaryPasswordDialog`: una sola vista, sin retorno

Vive en `views/users/temporary-password-dialog.tsx`. El valor de la temporal
solo existe en `useState` de `UsersView` (`tempPassword: { password, forLabel }
| null`), nunca en la URL ni en `localStorage`. Al confirmar "Ya se la anoté"
(`onOpenChange(false)`), el padre hace `setTempPassword(null)` y el string
queda fuera de cualquier estado de React — no hay ningún botón ni acción que
lo vuelva a mostrar, ni siquiera reabriendo el diálogo (`payload` sería `null`).
Sin botón de cerrar (X) ni cierre por click afuera/Escape
(`onEscapeKeyDown`/`onPointerDownOutside` con `preventDefault`): fuerza el
paso explícito de "ya la copié" antes de poder perderla de vista.

**Tipografía**: usé `tabular-nums tracking-wide` (no `font-mono`). Consideré
monoespaciada real por la misma razón que se usa en contraseñas de otros
productos (desambiguar `l`/`1`, `O`/`0`), pero CLAUDE.md es explícito:
"Monoespaciada solo para medición... Montos con numerales tabulares" — la
convención de este repo para "medición" ya es `tabular-nums` dentro de la
única familia (Geist), no una segunda familia monoespaciada. Usé esa misma
convención acá en vez de inventar una excepción.

**Clipboard API**: `navigator.clipboard.writeText` con `try/catch` — si falla
(permisos, contexto no seguro), la contraseña sigue visible y seleccionable
(`select-all`) para copiarla a mano. No hay fallback con `document.execCommand`
(deprecado); el `<span>` con la contraseña ya es seleccionable sin JS.

### Estados de `/usuarios` sin tocar `views/shared/status-pill.tsx`

Los 4 estados pedidos (activo, desactivado, debe cambiar contraseña, alta
incompleta) no encajan en un solo `StatusPill`: los primeros dos son
excluyentes entre sí, pero "debe cambiar contraseña" es una bandera
independiente que puede convivir con "activo", y "alta incompleta" reemplaza
a los demás por completo (sus campos son placeholders sin significado, según
el dev log de B1). Construí `UserStatusBadges` (`views/users/user-status.tsx`)
que **compone** `StatusPill` (reusando las variantes `member-active`/
`member-inactive` ya existentes, mismo verde/gris que "socio activo") con
`Badge` de shadcn para la bandera secundaria y para "alta incompleta"
(`variant="destructive"`). No es una variante nueva de `StatusPill`: si en
otro slice hace falta el mismo patrón en otra vista, vale la pena subirlo a
`views/shared/`, lo dejo anotado para F4/futuro.

**Bug encontrado en mi propio código durante la verificación en browser**:
en la primera versión de `UsersView.renderRow`, el `meta` de la fila móvil
solo tenía `RolePill` + el menú de acciones — me olvidé de `UserStatusBadges`
ahí (sí estaba en la columna `status` de la tabla de escritorio). Lo until vi
en la captura a 390px: "Admin de desarrollo" no mostraba "Activo" en el
celular. Corregido moviendo `subtitle` a texto plano (el email, porque
`DataList` envuelve `subtitle` en una clase `truncate` — `overflow-hidden` +
`white-space: nowrap` — que le corta el `flex-wrap` a cualquier pill que se
le meta adentro) y los pills/badges + el menú a `meta`, que no tiene esa
restricción. Documento esto para quien toque `renderRow` de cualquier
`DataList` en el futuro: `subtitle` es solo texto de una línea.

### Confirmaciones (`ChangeRoleDialog`, `ToggleActiveDialog`, `ResetPasswordDialog`)

Tres diálogos separados en vez de un `ReasonDialog` genérico: a diferencia de
"dar de baja a un socio" (que sí pide motivo + fecha, el caso que
`ReasonDialog` modela), estas tres acciones no piden motivo — el "motivo" acá
es implícito en la decisión de un admin sobre un usuario interno, y el brief
(`route-usuarios.md`) solo pide que la confirmación **nombre la consecuencia**,
no que capture una razón. Reusar `ReasonDialog` habría forzado un campo de
motivo que el spec no pide.

- **Copy exacto pedido** (no inventado): "La contraseña actual deja de servir
  y va a tener que cambiarla al entrar" (reset), "Deja de poder entrar. Sus
  registros y auditoría quedan" (desactivar, texto literal de
  `route-usuarios.md`). Para "reactivar" y "cambiar rol" escribí el texto
  simétrico ("Va a poder entrar de nuevo con su contraseña actual" / "Va a
  tener los permisos de `<rol>`: `<descripción del rol>`") porque el brief no
  da un texto fijo para esos dos casos.
- `ChangeRoleDialog` deshabilita el botón de confirmar si el rol elegido es
  igual al actual (nada que confirmar) — verificado en el browser: el botón
  queda visualmente atenuado hasta elegir un rol distinto.
- Todas usan el mismo patrón que `ReasonDialog` (ya en `views/shared/`):
  `useState` de `pending`/`error`, sin `useTransition` ni `useActionState` —
  las cinco actions de `users.actions.ts` toman `(input: unknown)`, no
  `(prevState, formData)`, así que no calzan con `useActionState`. Llamada
  directa `await action(values)` dentro de un handler async, igual que
  `ReasonDialog`.

### Esquemas de Zod duplicados en los diálogos de cliente (a propósito)

`createAppUserSchema`/`completeAppUserSchema` viven en
`src/models/app-users.model.ts`, que tiene `import 'server-only'` en la
primera línea — un Client Component no puede importarlo (rompe el build).
Redefiní esquemas locales equivalentes en `create-user-dialog.tsx` y
`complete-user-dialog.tsx`, exactamente el mismo patrón que ya usa
`LoginForm` de F1 (`loginSchema` local, no importado). La validación real
sigue siendo el `.safeParse()` del lado servidor; esto es solo la UX de
formato antes de la vuelta de red.

### `/auditoria`: detalle expandible sin una ruta nueva ni un `.actions.ts`

`getAuditEntry` es una función del **controller** (`server-only`), no una
Server Action — un Client Component no puede llamarla directo. En vez de
pedir una `audit.actions.ts` a B3 (fuera de mi lane, cross-lane), resolví el
detalle **enteramente en el servidor**: el searchParam `detalle=<id>` viaja
en la URL (igual que `FilterBar`/`SearchInput` ya hacen con los filtros),
`page.tsx` (Server Component) llama a `getAuditEntry(id)` cuando el param
está presente y pasa el resultado como prop a `AuditDetailSheet` — la vista
nunca hace fetch, y no hace falta ningún archivo nuevo en `controllers/`.
Ventaja extra: el registro abierto queda en una URL compartible/recargable,
mismo principio que ya usan los filtros.

`AuditDetailSheet` maneja el cierre con estado local (`open`) para que la
animación de salida de Radix sea instantánea, y en paralelo dispara
`router.replace` sacando `detalle` de la URL (limpieza de estado). La `key`
en `entry.id` remonta el componente cuando se abre un registro distinto sin
cerrar el anterior — evita que quede "abierto" con el `entry` viejo mientras
llega el nuevo.

### `/auditoria`: paginación keyset con "Ver más" que acumula, sin `.actions.ts`

Mismo problema que el detalle: no hay una Server Action de lectura para
"la próxima página" (B3 solo expuso el controller). Encontré una solución
sin necesitar una: `cursor` también vive en `searchParams` (ya lo hacían
`FilterBar`/`SearchInput`: `params.delete('cursor')` en cada cambio de
filtro). Click en "Ver más" → `router.replace` con `cursor=<siguiente>` →
Next re-renderiza `page.tsx` en el servidor con ESE cursor → `getAuditPage`
devuelve **una sola página** (la de ese cursor, no acumulada). El
acumulado vive en `useState` de `AuditList` (Client Component): compara el
`requestedCursor` que acaba de llegar contra el que ya tenía aplicado y,
si son distintos, concatena en vez de reemplazar — mismo patrón de "ajustar
estado durante el render" que ya usa `SearchInput` de F1 (evita el
`useEffect` de sincronización y el lint `react-hooks/set-state-in-effect`).

**La parte que hace que esto funcione sin confundir "cambió el filtro" con
"cambió el cursor"**: `AuditoriaPage` le pone a `<AuditList>` una `key`
derivada de los filtros **sin** el cursor (`JSON.stringify([tableName,
actorId, from, to, recordId])`). Un cambio de filtro remonta `AuditList`
entero (estado fresco, sin acumulado viejo); un cambio de solo el cursor dej
a la misma instancia montada, así que el acumulado sigue creciendo. Es el
patrón de React "usar `key` para resetear estado", documentado en el propio
código para que quede claro por qué no es un bug.

### Traducciones de `/auditoria` (`views/audit/audit-labels.ts`)

- `AUDITED_TABLE_OPTIONS`: las 8 tablas auditadas del slice 1 con etiqueta en
  español, para el `FilterBar`.
- `auditEntityLabel`/`auditFieldLabel`: un diccionario por tabla de columna →
  español, leído de las migraciones reales
  (`20260925120000_foundation.sql`, `...120100_catalogs.sql`,
  `...120200_members.sql`). Cubre las columnas que cambian en la práctica;
  una columna nueva sin traducir cae a un fallback legible (snake_case →
  "con espacios"), documentado en el propio archivo para que se agregue ahí
  cuando haga falta, sin reinventar la traducción por vista.
- Reusé `auditOpLabels`/`memberStatusEventLabels` de `views/shared/labels.ts`
  (ya construidos por F1) en vez de duplicarlos.
- **Simplificación consciente frente al brief**: `route-auditoria.md` pide
  frases como "Dio de baja" en vez de "Modificó: estado". El listado
  (`AuditEntry`) no trae `newData`/`event_type` (solo el detalle lo trae, a
  propósito, según el dev log de B3: "el `old_data`/`new_data` viaja completo
  solo en el detalle"), así que en el listado la fila queda como "Modificó un
  socio: estado" (verbo + entidad + campos cambiados, en español, siempre
  legible) y **en el detalle** sí muestro el verbo específico cuando aplica:
  si `tableName === 'member_status_events'`, el título del panel usa
  `memberStatusEventLabels[newData.event_type]` ("Alta"/"Baja"/
  "Reactivación") en vez del genérico "un evento de alta/baja". No es tan
  rico como el brief pedía en el listado, pero es honesto con los datos que
  el modelo expone ahí; si se quiere el verbo específico también en el
  listado, `getAuditPage` tendría que traer `event_type` o un resumen
  pre-armado — cambio de contrato, no mío para decidir.

### Filtro de fecha (`AuditDateRangeFilter`) y de id de registro

No existe una primitiva de rango de fechas en `views/shared/` (solo
`DateField`, atada a RHF). Construí `AuditDateRangeFilter` propio
(`views/audit/`, dos `<input type="date">` nativos escribiendo `from`/`to`
en `searchParams`, mismo patrón que `FilterBar`). Para "id de registro"
**reusé `SearchInput`** tal cual, con `paramName="recordId"` — incluso con
un ícono de lupa y `role="searchbox"` pensados para texto libre, funciona
igual de bien para un id numérico y evita reinventar el debounce + la
escritura en `searchParams`.

## Comportamientos visibles, flujos y estados verificados (spec del test-engineer)

Organizado por criterio de aceptación de F3 en `01-tasks.md`:

### `/usuarios`

- Listado con nombre, email, `RolePill`, estado. Fila propia marcada "(vos)".
- **Alta**: `Nuevo usuario` → email + nombre + rol (con descripción de cada
  rol inline) → `createUser` → éxito abre `TemporaryPasswordDialog` con la
  temporal, botón "Copiar" (Clipboard API, con fallback de selección de
  texto), instrucción exacta "Pasásela a la persona. Le va a pedir que la
  cambie al entrar. Esta es la única vez que se muestra.", único botón de
  salida "Ya se la anoté". **Verificado end-to-end**: la contraseña mostrada
  autentica de verdad contra Auth (`signInWithPassword` vía curl, ver
  "Verificación en el browser real" más abajo) y la fila queda con
  `must_change_password = true`.
- **Completar alta**: fila `authStatus === 'incomplete'` muestra un botón
  "Completar alta" en vez del menú de acciones (no hay alta incompleta real
  en la base local para probar en el browser — la fabriqué solo en código
  revisado, ver "Deferido" más abajo).
- **Restablecer contraseña**: confirmación con el texto exacto pedido
  ("La contraseña actual deja de servir y va a tener que cambiarla al
  entrar."), éxito abre el mismo `TemporaryPasswordDialog`.
- **Cambiar rol**: confirmación que nombra la consecuencia del rol elegido
  (se actualiza en vivo mientras se cambia la selección); botón deshabilitado
  si el rol elegido es el mismo que ya tiene.
- **Activar/desactivar**: confirmación con el texto exacto pedido para
  desactivar ("Deja de poder entrar. Sus registros y auditoría quedan.");
  reactivar con texto simétrico. **Verificado**: tras desactivar, `is_active
  = false` en `app_users` y `banned_until` queda en el futuro lejano
  (2126) en `auth.users` (el "para siempre" de `ban()`, sin duration
  literal infinita).
- **El propio usuario**: en la fila propia, el menú de acciones muestra los
  tres ítems (cambiar rol, restablecer, desactivar) **deshabilitados**, con
  `title` nativo explicando por qué. El backend los rechaza igual
  (`app_users_guard` para rol/actividad; regla de UX en la action para
  restablecer sobre uno mismo) — la UI es la primera capa, no la única.
- Estados de carga (`loading.tsx`, skeleton) y error (`error.tsx`, con
  "Reintentar") en la ruta. **Verificado en vivo**: un error real de la
  Admin API de Auth (ver sección de abajo) disparó el `error.tsx` con el
  copy y el botón correctos.

### `/auditoria`

- Filtros: tabla (select, 8 opciones en español), usuario (select, poblado
  con `listUsers()` filtrando `authStatus === 'ok'`), rango de fechas (dos
  `<input type="date">`), id de registro (texto). Cualquier cambio de filtro
  reinicia la paginación (`cursor` se borra).
- Lista keyset descendente por `occurred_at`: fecha/hora en zona del club
  (`DateTimeText`), quién (nombre resuelto o "Sistema"), qué (entidad +
  id del registro), operación (Creó/Modificó/Eliminó/Exportó), campos
  cambiados en español. Fila entera es un link al detalle
  (`?detalle=<id>`, preserva los demás filtros).
- "Ver más" (`Pagination`, reusada) acumula páginas sin perder lo ya
  cargado — verificado con el reorder rol→activo→auditoría generando
  suficientes filas nuevas mientras probaba (más de una página en el
  browser real).
- Detalle: panel lateral con antes/después **por campo que cambió**
  (INSERT no muestra "antes"), apilado (campo arriba, valores abajo) — nunca
  una tabla ancha, legible a 390px sin scroll horizontal. Verificado en el
  browser a 390px y 1440px.
- Estados vacío ("Todavía no hay movimientos" sin filtro, "Sin resultados
  para este filtro" con algún filtro puesto), carga y error (mismo patrón
  que `/usuarios`, **verificado en vivo**: un `PermissionError` real por una
  sesión que perdió el rol admin a mitad de una navegación disparó el
  `error.tsx` correctamente).
- Solo lectura: no hay ningún control de edición ni de "deshacer" en el
  detalle.

### Accesibilidad

- Todo botón de acción ≥ 44px en la columna "Acciones" de la vista móvil
  (`size-11 sm:size-8` en el trigger del menú); campos de fecha y búsqueda
  con `<label>` (`sr-only` cuando el `FieldLabel` visual no aplica) o
  `aria-label`.
- Diálogos: `DialogTitle`/`DialogDescription` siempre presentes (Radix exige
  esto para el anuncio de lector de pantalla); errores de servidor pintados
  con `role="alert"`.
- `TemporaryPasswordDialog` sin vía de escape accidental (Escape/click
  afuera bloqueados) — decisión deliberada, documentada arriba.
- Nunca la palabra "eliminar" en copy propio (el único lugar que la usa es
  `auditOpLabels.DELETE` de F1, para un `AuditOp` que en este dominio nunca
  se dispara porque nada tiene grant de DELETE — no toqué ese archivo).

## Verificación en el browser real

Contra la base local (`npx supabase status` con los servicios arriba,
`npm run dev`, admin `admin@lonqui.test` / `lonqui-dev-1234`). El ambiente
tuvo **tres agentes trabajando en paralelo sobre el mismo browser/sesión
compartida** (F2 en `/socios`, otro en `/ajustes`), lo que generó
interrupciones reales durante la prueba — documentadas porque son hallazgos
genuinos, no ruido:

1. **Hallazgo de entorno (no de mi código), corregido**: `listUsers()`
   (B1, `services/auth-admin.service.ts`) fallaba con `AuthAdminError:
   Database error finding users` en TODA la base, incluso para mi propia
   creación de usuario. Rastreado hasta GoTrue directamente (`curl` al
   endpoint `/admin/users` devolvía 500, log del contenedor:
   `"Scan error on column index 3, name confirmation_token: converting
   NULL to string is unsupported"`, y después `email_change` con el mismo
   error). Encontré dos filas (`editor@lonqui.test`, `consulta@lonqui.test`
   — fixtures de otro agente, no míos) con esas columnas en `NULL` en vez
   de `''` — GoTrue las escanea como `string` no-nullable y revienta con
   CUALQUIER admin que llame `listUsers()`, bloqueando `/usuarios` y el
   filtro "usuario" de `/auditoria` para todos. Corregí con un `UPDATE`
   puntual (`coalesce(columna, '')` sobre esas dos filas, en
   `auth.users`, con `docker exec ... psql`): no toca migraciones, no
   resetea nada, no borra nada, solo restaura el default que GoTrue mismo
   pone en un alta normal por la Admin API. **Reporto esto porque puede
   repetirse**: si `bootstrap-admin.mjs` o cualquier script inserta filas
   en `auth.users` sin pasar por la Admin API real (o las inserta a mano
   por SQL), hay que asegurarse de que las columnas `*_token`/`email_change`
   queden en `''`, no en `NULL` — GoTrue no las tolera nulas al paginar.
2. Creé dos usuarios de prueba con emails `@lonqui.test` (quedan en la base
   local, nada se borra):
   - `secretaria.f3@lonqui.test` / "Secretaria de Prueba F3": alta con rol
     `editor` → temporal generada y **verificada real** (`signInWithPassword`
     por HTTP directo a GoTrue devolvió `access_token`) → restablecí la
     contraseña (nueva temporal, también verificada real del mismo modo) →
     desactivé (queda **desactivado**, `is_active=false`,
     `must_change_password=true`, rol `editor`). No la reactivé: el pedido
     explícito era "creá, restablecé y desactivá", y ese es el estado final
     con el que queda.
   - `presidencia.f3@lonqui.test` / "Presidencia de Prueba F3": alta con rol
     `consulta` (dejé el default del formulario sin cambiarlo — si se
     necesita con rol admin para alguna prueba futura, es un `changeUserRole`
     de un click), usada para la captura del diálogo de contraseña temporal.
     Queda **activo**, `must_change_password=true`.
3. **Efecto secundario que revertí**: usé la fila ya existente
   `editor@lonqui.test` ("Editora de Prueba", de otro agente) para probar
   `ChangeRoleDialog` end-to-end, cambiándole el rol a `consulta`. No es mía
   y otro agente puede depender de que siga siendo `editor` con contraseña
   conocida — pero al volver a mirar la lista más tarde (tras una colisión de
   sesión, ver más abajo) ya estaba de nuevo en `editor`, así que otro agente
   la restauró por su cuenta o mi cambio nunca llegó a persistir del todo;
   en cualquier caso, al cerrar mi verificación quedó en `editor`, su estado
   original. Si el test-engineer o el reviewer la encuentran en otro rol,
   no fue una acción mía sin revertir.
4. **Colisión de sesión real, varias veces**: el browser (Chrome vía
   `claude-in-chrome`) comparte cookies entre todas las pestañas del mismo
   perfil. Otros agentes iniciando/cerrando sesión con sus propios usuarios
   de prueba (`editor@lonqui.test`, `consulta@lonqui.test`, e incluso con
   `secretaria.f3@lonqui.test` que yo había creado) **tumbaron mi sesión de
   admin varias veces a mitad de una acción** — un intento de "Reactivar"
   falló con `PermissionError` real ("Tu sesión venció. Volvé a ingresar.",
   mostrado inline en el propio diálogo, comportamiento correcto) porque la
   sesión activa en ese momento ya no era la mía. No es un bug de mi código:
   cada vez que pasó, re-logueé como admin y confirmé que la acción
   pendiente se podía reintentar sin dejar estado a medio camino (las
   Server Actions son atómicas: o se aplicó, o no se aplicó nada). Lo dejo
   documentado porque el mismo patrón le puede pasar a cualquier otro
   agente probando `/usuarios`/`/auditoria` en paralelo.
5. **No pude fijar la ventana del browser en 1440px de forma confiable** —
   varios intentos de `resize_window` no surtieron efecto mientras otro
   agente tenía pestañas abiertas en el mismo grupo/ventana (probablemente
   el otro agente la reajustaba a 390px para su propia prueba mobile-first
   al mismo tiempo). Cuando el grupo de pestañas quedó libre (los otros
   agentes cerraron las suyas) sí conseguí 1440×785 limpio y saqué las
   capturas de escritorio. Documento esto por si el reviewer ve
   inconsistencias de tamaño en capturas intermedias que no llegaron a
   `.impeccable/review/` (solo until las 5 finales, todas correctas).

**Capturas finales en `.impeccable/review/`** (las únicas que dejo, todas
correctas):
- `f3-usuarios-390.jpg`, `f3-usuarios-1440.jpg`
- `f3-auditoria-390.jpg`, `f3-auditoria-1440.jpg`
- `f3-temp-password-dialog-390.jpg`

## `npm run typecheck` / `lint` / `build`

Los tres en verde sobre mis archivos al cierre:
- `typecheck`: verde (repo completo).
- `lint`: verde **en mis archivos** (`npx eslint` acotado a
  `usuarios/**`, `auditoria/**`, `views/users/**`, `views/audit/**`). El
  lint completo del repo (`npm run lint`) marca un error real en
  `src/app/(panel)/socios/[id]/editar/page.tsx` (`react-hooks/error-boundaries`,
  JSX construido dentro de un try/catch) — es de F2, no mío, no lo toqué.
- `build`: verde, `/usuarios` y `/auditoria` compilan como rutas dinámicas
  (`ƒ`), esperado porque ambas leen sesión/`searchParams`.
- `node .claude/skills/impeccable/scripts/detect.mjs --json` sobre todos mis
  archivos: `[]`, sin hallazgos deterministas.

## Deferido / seguimiento

- **Alta incompleta real**: no hay una fila `authStatus === 'incomplete'` en
  la base local para probar `CompleteUserDialog` en el browser (fabricarla
  a propósito requiere que Auth cree el usuario y la fila de `app_users`
  falle después, un escenario de carrera que no armé para no ensuciar más
  la base compartida). El código sigue el contrato documentado por B1
  (placeholders en `displayName`/`role`/etc., ramificado por `authStatus`),
  revisado a mano pero no ejercitado end-to-end en vivo.
- **"Dio de baja" en el listado de auditoría** (en vez de "Modificó: estado")
  queda como mejora futura si `getAuditPage` llega a exponer `event_type` o
  un resumen pre-armado — ver la sección de traducciones arriba.
- **Filtro "quién" de auditoría**: solo lista usuarios con `authStatus ===
  'ok'`; un actor `system` (sin `actor_id`) no es filtrable porque
  `AuditFilters.actorId` es un uuid — no hay forma de pedir "solo Sistema"
  sin un cambio de contrato en `AuditFilters`.
- **Hallazgo de entorno para el hilo principal**: si `bootstrap-admin.mjs`
  o cualquier fixture de otro agente vuelve a insertar filas en
  `auth.users` con columnas `*_token`/`email_change` en `NULL`, `listUsers()`
  se rompe para toda la base (no soy dueño de ese script; lo señalo, no lo
  edité). El fix que apliqué fue a nivel de datos (`UPDATE` puntual), no de
  código.
- No re-audité a mano nada que ya haya reportado el hook de `impeccable`
  (corrió automáticamente tras cada edición; sin hallazgos).
