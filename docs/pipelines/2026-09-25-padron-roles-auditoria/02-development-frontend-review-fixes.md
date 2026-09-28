# 02 — Frontend: fixes del code review (03-review.md)

Agente: `frontend-react-craftsman`. Corrida sobre `369cd1f` + los fixes de la
finish review ya en el árbol. Alcance: solo `src/app/**` y `src/views/**`, en
paralelo con un agente de backend que sumó `getMedicalClearanceUrl`,
`loadMoreMembers`, `listAuditActorOptions` y `createMember({ newFamilyGroup })`.
Programé contra esas firmas tal cual las dio el orquestador; no toqué
`models/`, `controllers/`, `services/`, `lib/`, `supabase/` ni `tests/`.

## Hallazgos resueltos

### Blocker 1 — open redirect (`/\evil.com`)

- `src/app/(auth)/login/page.tsx`, `src/app/(auth)/cambiar-contrasena/page.tsx`:
  borrado el `sanitizeNext` local duplicado en los dos archivos; ahora usan
  `isInternalRedirectPath` de `@/lib/safe-redirect` (ya escrito por el hilo
  principal). No toqué `UserMenu` ni `ChangePasswordForm`: el primero arma
  `next` a partir de `pathname`/`searchParams` de Next (nunca texto externo) y
  el segundo recibe `next` ya validado por la page — la única fuente de
  validación quedó en un solo lugar, como pedía el hallazgo.

### Major 4 — "Ver certificado" moría a los 60 s

- `src/views/members/medical-clearance-section.tsx`: el botón ya no recibe
  una URL pre-firmada por props. Al click, `handleViewClearance` abre una
  pestaña vacía en el mismo gesto (`window.open('', '_blank')`, con
  `popup.opener = null` para cortar la referencia inversa sin perder la que
  necesitamos para setear `.location.href` después — evita el bloqueador de
  popups sin renunciar a `noopener`), llama `getMedicalClearanceUrl({
  memberId, clearanceId })` y recién ahí asigna la URL real a esa pestaña. Si
  el browser bloqueó el popup igual (`popup` null), navega en la misma
  pestaña en vez de perder el certificado. Estados: botón con `Loader2`
  mientras `viewingClearance`, mensaje `role="alert"` si `getMedicalClearanceUrl`
  falla (permiso revocado a mitad de sesión, archivo borrado, etc).
- El botón ahora se muestra según `currentClearance?.storagePath` (antes
  dependía de la prop `clearanceUrl`, que ya no existe). Saqué la prop
  `clearanceUrl` de `MedicalClearanceSection` y de quien la llama
  (`src/views/members/member-detail-view.tsx`); `MemberDetail.medicalClearanceUrl`
  quedó sin consumidores en la UI.

### Major 5 — "Ver más" del padrón re-encadenaba el keyset entero

- Nuevo `src/views/members/member-list.tsx` (Client Component, mismo patrón
  que `AuditList` en `/auditoria`): mantiene `items`/`nextCursor` en estado,
  columnas y fila (`renderRow`) movidas acá desde `member-list-view.tsx`
  (no se puede pasar esa lógica como prop función de un Server a un Client
  Component — no serializa), y "Ver más" llama la Server Action
  `loadMoreMembers({ filters, cursor })` y concatena el resultado. Sin
  `router.replace` de por medio: un click en "Ver más" ya no dispara
  navegación ni el `loading.tsx` de la page.
- `src/views/members/member-list-view.tsx`: perdió `pageCount` (ya no hace
  falta) y arma `filtersKey = JSON.stringify(filters)` para remontar
  `MemberList` con estado fresco cuando cambia un filtro real de verdad
  (`FilterBar`/`SearchInput` navegan, eso sí re-renderiza la page) y dejarlo
  montado (acumulando) entre renders con los mismos filtros.
- `src/app/(panel)/socios/page.tsx`: reescrita para pedir una sola tanda
  (`getPadron(filters)`, sin el `pages`/`loadAccumulatedPage` de la finish
  review). Eliminado `src/views/members/members-pagination.tsx` (ya sin uso).

### Minor 8 — `/auditoria` pegaba a la Admin API en cada render

- `src/app/(panel)/(admin)/auditoria/page.tsx`: cambiado `listUsers()` por
  `listAuditActorOptions()` de `audit.controller.ts`. Ya no importa
  `users.controller`.

### Minor 10 — el grupo familiar se creaba antes de validar al alta

- `src/views/members/member-form.tsx`: en `mode === 'create'`, `onValid` ya
  no llama `createFamilyGroup` por su cuenta antes de `createMember` — arma
  `newFamilyGroup` (u omite el campo) y lo manda dentro del mismo
  `createMember({ ...shared, joinedOn, familyGroupId, newFamilyGroup })`. Un
  alta que falla (DNI duplicado) ya no deja un grupo vacío huérfano.
- `mode === 'edit'` sigue con el flujo anterior (crear el grupo antes,
  después `updateMember` con el id resultante): el contrato de esta tanda
  solo extendió `createMember`, no `updateMember`. Documentado como
  deferral — si se quiere el mismo arreglo en edición, `updateMember`
  necesita aceptar `newFamilyGroup` (cross-lane, modelo/controller).

### Minor 12 — tarjetas anidadas dentro de un `Panel`

- `src/views/members/member-form.tsx` (bloque "Crear un grupo nuevo") y
  `src/views/members/medical-clearance-section.tsx` (formulario de subida):
  cambiado `rounded-lg border border-border p-3` por `border-t border-border
  pt-3`/`pt-4` — separador, no tarjeta, mismo patrón que
  `family-group-section.tsx`.

### Minor 13 — el detalle de un INSERT mostraba columnas técnicas

- `src/views/audit/audit-detail-sheet.tsx`: nuevo `HIDDEN_FIELDS` (`id`,
  `search_text`, `created_by`, `uploaded_by`, `updated_at`, `created_at`)
  filtrado en `detailRows` para INSERT y UPDATE por igual. El resto de los
  campos ya pasaba por `auditFieldLabel` (etiquetas en español); no tocó
  `audit-labels.ts`.

### Nits (finish review / 03-review.md §16)

- `src/views/shared/data-list.tsx`: en la tabla de escritorio, un socio con
  `href` generaba un `<Link>` por celda (cinco links idénticos por fila para
  un lector de pantalla). Ahora solo la primera celda es un link accesible;
  el resto envuelve el mismo contenido en un `<Link>` con `tabIndex={-1}` y
  `aria-hidden` — sigue siendo clickeable visualmente en toda la fila, pero
  no se repite en el árbol de accesibilidad ni en el tab order.
- `src/views/shared/search-input.tsx`: sacado `role="searchbox"` redundante
  sobre un `<input type="search">`.
- No toqué la vista de apto físico importando `@/lib/supabase/client`
  directo (nit 16): envolver esa llamada en un helper (`lib/storage-upload.ts`)
  vive en `src/lib/**`, fuera de mi lane en esta tanda. Sigue funcionando
  igual que antes; queda para quien tenga ese directorio.

## Validación

- `npm run typecheck`: limpio fuera de `tests/**` (confirmado con
  `npx tsc --noEmit --skipLibCheck | grep -v '^tests/'` → sin salida). Con
  `tests/` incluido queda **un solo error preexistente**, ajeno a este slice
  de frontend: `tests/controllers/session.controller.test.ts:104` pasa
  `role: null` donde el tipo pide `AppRole | undefined`. (Había un segundo,
  `tests/models/app-users.model.test.ts` importando `isInternalRedirectPath`
  desde su ubicación vieja — `test-engineer` ya lo resolvió mientras
  corría esta tanda, moviendo el test a `tests/lib/safe-redirect.test.ts`.)
  No es mío para arreglar (`tests/**` es de `test-engineer`) y **bloquea
  `npm run build`** porque `next build` corre `tsc` sobre todo
  `tsconfig.json` (incluye `tests/`). Reportado como cross-lane.
- `npm run lint`: 0 errores, 2 warnings (ninguno mío: `safe-redirect.ts`
  tiene un `eslint-disable` que ya no hace falta, y un test de `tests/db/`
  ídem — ambos preexistentes, fuera de mi lane).
- `npm run build`: falla en el paso de `tsc` por los dos errores de
  `tests/` de arriba (el bundling de Next sí compiló: "Compiled successfully").
  Para probar el resto en caliente sin ese bloqueo usé `next dev -p 3214`
  contra el stack local (`npm run db:start` ya corriendo) y corrí
  `BASE_URL=http://localhost:3214 node scripts/capture-screens.mjs --out
  .impeccable/review/screens-review`:
  - Sin overflow horizontal a 390px en ninguna ruta (`socios`,
    `socios/nuevo`, `socio`, `socio/editar`, `usuarios`, `ajustes`,
    `auditoria`).
  - Repro de F2: el script prende `must_change_password` por psql sobre
    `editor@lonqui.test` con la sesión ya abierta, navega por la barra
    lateral y confirma que termina en `/cambiar-contrasena`
    (`✓ flag a mitad de sesión → /cambiar-contrasena`); el propio script
    revierte el flag a `false` al final. Verificado también a mano después:
    `docker exec supabase_db_lonqui psql -U postgres -tAc "select
    must_change_password from public.app_users where
    email='editor@lonqui.test'"` → `f`.
  - Capturas en `.impeccable/review/screens-review/`: padrón, ficha de
    socio (Datos personales / Grupo familiar / Apto físico / Historia como
    secciones hermanas, sin tarjetas anidadas), ficha de ingreso, auditoría
    con el listado de "Campos cambiados" en español.

## Comportamientos user-facing implementados (para QA/tests)

- `/login`, `/cambiar-contrasena`: `next` fuera de una ruta interna estricta
  (`//evil.com`, `/\evil.com`, `/\\evil.com`, `https://…`, `javascript:…`) se
  descarta y cae al fallback (`/` o sin botón "Cancelar" en modo
  obligatorio). `/socios?q=a` y similares se preservan.
- `/socios/[id]`: "Ver certificado" solo aparece si el apto vigente tiene
  adjunto; al click muestra spinner, abre el certificado en una pestaña
  nueva (o navega en la misma si el navegador bloqueó el popup), y si la
  firma falla (permiso, archivo inexistente) muestra el error en la propia
  sección sin romper el resto de la ficha.
- `/socios`: "Ver más" acumula sin recargar la lista ya mostrada ni disparar
  el loading de página completa; cambiar un filtro sí reinicia la lista
  desde cero. Error de red en "Ver más" se muestra debajo de la tabla/lista,
  sin perder lo ya cargado.
- `/socios/nuevo`: elegir "Crear un grupo nuevo" y que el alta falle (p. ej.
  DNI duplicado) ya no dejar un grupo huérfano — el grupo se crea recién
  cuando el socio se valida y se inserta.
- `/auditoria`: el filtro "Usuario" lista los mismos actores que antes
  (activos, con historial), ahora sin pegarle a la Admin API de Auth en
  cada request. El detalle de un alta (`INSERT`) ya no muestra `id`,
  `search_text`, `created_by`/`uploaded_by` ni timestamps crudos.
- Accesibilidad: cada fila de la tabla de escritorio del padrón/auditoría es
  un solo link en el árbol de accesibilidad (antes eran cinco); el buscador
  ya no anuncia un rol redundante.

## Deferrals / cross-lane

1. `tests/controllers/session.controller.test.ts:104` bloquea `npm run build`
   (ver arriba) — para `test-engineer`.
2. `updateMember` no acepta `newFamilyGroup` todavía: en edición, elegir
   "Crear un grupo nuevo" sigue creando el grupo antes de guardar al socio.
   Si se quiere cerrar del todo el minor 10, hace falta extender
   `updateMember`/`updateMemberSchema` (backend) para aceptarlo igual que
   `createMember`.
3. `medical-clearance-section.tsx` sigue importando `@/lib/supabase/client`
   directo para `uploadToSignedUrl` (nit 16 del review). Envolverlo en
   `src/lib/storage-upload.ts` queda para quien tenga esa carpeta.

## Addendum — R1 (segunda pasada del review): "Ver más" del padrón siempre fallaba

`memberFiltersSchema` (en `members.model.ts`, `.strict()`) no tiene `limit`:
`socios/page.tsx` metía `limit: 50` dentro del mismo objeto `filters` que
después viajaba tal cual a `MemberListView` → `MemberList` → `loadMoreMembers`,
así que **todo** click en "Ver más" tiraba `invalid` por campo desconocido —
nunca acumulaba nada, solo mostraba el error genérico de `loadError`.

- `src/app/(panel)/socios/page.tsx`: `parseFilters` ya no devuelve `limit`.
  El tamaño de la primera tanda se arma en un objeto aparte, solo para esa
  llamada: `getPadron({ ...filters, limit: PADRON_PAGE_SIZE })` (constante
  nueva del backend, `@/models/members.model`). `filters` — el que se manda
  a la vista y de ahí al cliente — queda siempre sin `limit`.
- `src/views/members/member-list.tsx`: `handleLoadMore` ya no manda `filters`
  tal cual a `loadMoreMembers`. Arma un objeto a mano con exactamente los
  cinco campos que `memberFiltersSchema` espera (`q`, `categoryId`,
  `disciplineId`, `status`, `memberType`) — defensivo contra cualquier campo
  que se cuele en el futuro (un `limit` o un `cursor` de arrastre), no solo
  contra el que causó este bug puntual.
- `member-list-view.tsx` no necesitó cambios: solo reenvía `filters` tal
  cual las recibe de la page, y la page ya no le mete `limit`.

**Probado de verdad**, no solo por tipo: bajé `PADRON_PAGE_SIZE` a `5`
temporalmente (`src/models/members.model.ts`), levanté `next dev -p 3214`
contra el stack local, entré como Admin (sesión ya abierta) y en `/socios`
cliqueé "Ver más" dos veces: 5 → 10 → 11 filas (11 activos en el seed), sin
error, y el botón desapareció al agotarse (`nextCursor: null`). Reverting
confirmado con `grep`: `export const PADRON_PAGE_SIZE = 50` de nuevo, sin
diff pendiente en ese archivo.

**Verificación**: `npm run typecheck` y `npm run lint` en verde para todo lo
que toca este slice. Nota: durante esta segunda pasada aparecieron —y
desaparecieron por sí solos, sin que yo los tocara— errores transitorios en
archivos que no son míos (`src/controllers/session.controller.ts`,
`src/models/members.model.ts` línea de `MemberSummary`, `src/views/audit/audit-labels.ts`,
`src/views/shared/form-fields.tsx`): son ediciones en vivo de otro pipeline
concurrente sobre este mismo árbol (`docs/pipelines/2026-09-27-cuotas-pagos-panel/`,
que suma `debtStatus`/`balanceCents`/`monthsDue` a `MemberSummary`, `fee_prices`/`fees`/`payments`
a `AuditedTable` y `permissions` a `SessionInfo`). No forman parte de R1 ni
del alcance de este pipeline (`2026-09-25-padron-roles-auditoria`); no los
toqué. Si siguen presentes cuando se corra la verificación final de este
pipeline, son del otro equipo, no de este fix.
