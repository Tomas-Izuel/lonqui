# 02 — Desarrollo backend B3: padrón, categorías múltiples, estado de cuenta, filtro de deuda

Agente: `senior-backend-engineer` (B3). Tarea: `01-tasks.md` sección **B3**, contra
`00-architecture.md` **§13 (Revisión 3)**, en particular §13.2, §13.6, §13.7.

Nota de proceso: esta corrida se cortó dos veces por límite de gasto de la API
(no por error propio) y se retomó con el mismo alcance; entre cortes el hilo
principal corrió `db:reset` de nuevo (solo cambió la precarga de
`member_accounts`) y los `user_id`/ids de la base local cambiaron — la
verificación de este documento es contra el estado final de la base, releída
después del segundo corte.

## Archivos tocados (todos dentro de mi ownership declarado)

- `src/models/members.model.ts` — reescrito: alta/edición sin `memberType`/
  `categoryId`, padrón con embed de `member_categories`, filtro de deuda.
- `src/models/member-categories.model.ts` — **nuevo**: pertenencia a
  categorías (`listMemberships`, `setMemberCategories`, `closeMembership`,
  `changeCategory`, `assertCategorySelection`).
- `src/models/catalogs.model.ts` — modificado solo `setCategoryActive`: cuenta
  inscripciones abiertas de `member_categories`, no `members.category_id`
  (ya no existe la columna).
- `src/controllers/members.controller.ts` — `getPadron` decide `includeDebt`
  por permiso; `getMemberPage` devuelve `MemberPageData` (ficha + cuenta +
  facturación).
- `src/controllers/members.actions.ts` — nuevas actions `setMemberCategories`,
  `leaveCategory`, `changeCategory`; `loadMoreMembers` también decide
  `includeDebt` por permiso.

No toqué `supabase/**`, `tests/**`, `src/models/types.ts`, `src/views/**`,
`src/app/**`, ni archivos de B1/B2/B4.

## Contexto de partida y cambio de fondo

`members.category_id` ya no existe (migración
`supabase/migrations/20260927125000_member_categories.sql`, aplicada). La
pertenencia vive en `public.member_categories`: filas-intervalo (`joined_on`/
`left_on`), una inscripción abierta por **disciplina** (no por categoría:
ascender de 5ta a 6ta es cerrar una fila y abrir otra en el mismo deporte).
`members.member_type` es una columna derivada por trigger
(`private.sync_member_type`, AFTER INSERT/UPDATE en `member_categories`):
`practicing` ⇔ al menos una inscripción abierta. `authenticated` no tiene
grant de INSERT/UPDATE sobre esa columna — la app nunca la manda, ni en el
alta ni en la edición.

La única escritura en bloque es la RPC `public.set_member_categories(
target_member_id, category_ids, effective_on)` (SECURITY INVOKER, valida
`can('members.write')` en el cuerpo): cierra las inscripciones abiertas que no
están en la lista nueva y abre las que faltan, en una transacción, y rechaza
dos categorías de la misma disciplina en la lista.

## Contratos que consumí (fijados en `types.ts`, no los toqué)

`MemberCategoryRef`, `MemberCategoryMembership`, `SetMemberCategoriesInput`,
`LeaveCategoryInput`, `MemberSummary.categories`, `MemberDetail.categories` /
`.categoryHistory`, `MemberPageData` (`{ member, account, billing }`).

## Contratos que expuse (no estaban fijados, son míos)

- `member-categories.model.ts`:
  - `setMemberCategoriesSchema`, `leaveCategorySchema`: validan estructura
    (ids positivos, sin repetidos, fecha ISO no futura); existencia/actividad
    de la categoría y "una por disciplina" las valida la base (RPC + trigger)
    y se traducen acá.
  - `changeCategorySchema` / `ChangeCategoryInput = { membershipId,
    newCategoryId, effectiveOn }`: no está en el contrato fijo de `types.ts`
    (la arquitectura solo pide la *acción* `changeCategory`, no un tipo en el
    vocabulario del dominio) — lo definí en el modelo, como
    `CreateMemberInput`/`UpdateMemberInput` en `members.model.ts`.
  - `listMemberships(memberId): Promise<MemberCategoryMembership[]>` — toda
    la historia, desc por `joined_on, id`.
  - `openMemberships(history): MemberCategoryRef[]` — helper puro (sin I/O)
    para no repetir el filtro `leftOn === null` en cada consumidor.
  - `assertCategorySelection(supabase, categoryIds): Promise<void>` — chequeo
    previo (mismo espíritu que `memberDniExists`): antes de insertar el socio,
    corta si hay una categoría inexistente, inactiva o dos de la misma
    disciplina, con los mismos mensajes y `field: 'categoryIds'` que la
    traducción de errores de la RPC. Evita que una selección inválida deje un
    socio a medio cargar en el alta.
  - `setMemberCategories(input: SetMemberCategoriesInput): Promise<void>` —
    llama a la RPC.
  - `closeMembership(input: LeaveCategoryInput): Promise<{ memberId:
    number }>` — UPDATE de `left_on`/`left_reason` con `.is('left_on', null)`
    en el `where` + `.select().maybeSingle()`: 0 filas (id inexistente o ya
    cerrada) → `DomainError` genérico, sin depender del mensaje del trigger
    para ese caso puntual (mismo patrón que `updateMember`/`updateFamilyGroup`
    del slice 1). Devuelve `memberId` porque `LeaveCategoryInput` no lo trae y
    la action necesita revalidar `/socios/[id]`.
  - `changeCategory(input): Promise<{ memberId: number }>` — lee la
    inscripción por `membershipId` (tiene que estar abierta), valida la nueva
    categoría con `assertCategorySelection`, rechaza si `newCategoryId` es de
    otra disciplina (`DomainError('Elegí una categoría del mismo deporte',
    { field: 'newCategoryId' })` — decisión mía: la arquitectura describe esta
    acción como "cierra y abre en la misma disciplina", así que un
    `newCategoryId` de otro deporte se corta acá en vez de dejar que
    `set_member_categories` lo acepte como "agregar un deporte nuevo mientras
    cierro otro", que sería un comportamiento sorpresa para lo que la UI llama
    "cambiar de categoría"), arma la lista de categorías abiertas con la
    categoría de esa inscripción reemplazada por la nueva, y llama a
    `setMemberCategories`.

- `members.model.ts`:
  - `createMemberSchema` ahora pide `categoryIds: number[]` (vacío = no
    practicente) en vez de `memberType`/`categoryId`; dedupe de ids a nivel
    Zod, existencia/actividad/disciplina a nivel `assertCategorySelection`
    (no puede ser Zod puro: necesita consultar `categories`).
  - `updateMemberSchema` ya no acepta `categoryIds`: los deportes se cambian
    SOLO con la action `setMemberCategories` (`.strict()` rechaza la clave
    con el error de formato genérico si alguien la manda).
  - `createMember`: 1) chequeo de DNI, 2) `assertCategorySelection`, 3)
    INSERT del socio (sin `member_type` ni `category_id`), 4)
    `assignCategories` (alias de `setMemberCategories` de
    `member-categories.model.ts`) con `effectiveOn = joinedOn`. Si el paso 4
    falla (carrera real: alguien desactivó la categoría entre el paso 2 y el
    4), el socio YA quedó cargado — el insert del paso 3 ya hizo commit en su
    propia conexión/transacción — y se tira `DomainError('Se cargó el socio
    pero no sus deportes: agregalos desde la ficha')`, tal como pide la
    arquitectura. Es un residual aceptado, documentado, igual que el de
    `newFamilyGroup` huérfano del slice 1.
  - `updateMember`: sin `member_type`/`category_id` en el UPDATE.
  - `searchMembers(filters, options?: { includeDebt?: boolean })`: el
    segundo parámetro NO es parte de `MemberFilters` (fijo en `types.ts`) — lo
    decide el controller/action según `payments.read` de la sesión, nunca el
    cliente. Con `includeDebt`, agrega `member_debt_status`,
    `member_balance_cents`, `member_months_due` al select y honra
    `filters.debt`; sin él, ni pide esas columnas ni aplica el filtro (se
    ignora, como hacía antes el comentario "se ignora a propósito" que ahora
    se borró porque el filtro SÍ está implementado, solo que condicionado).
  - Filtro de categoría/disciplina: embed `member_categories!inner(...)` +
    `.eq`/`.in` sobre `member_categories.category_id` + `.is('member_categories.left_on',
    null)` cuando hay filtro; embed simple (sin `!inner`) + el mismo `.is(...)`
    cuando no lo hay (recorta qué inscripciones se listan por fila, sin
    excluir a nadie). Verificado contra la base real que esto arma un JOIN y
    ambas condiciones se evalúan sobre la MISMA fila embebida (ver
    "Verificación contra la base" abajo): una categoría vieja ya cerrada NO
    hace matchear a un socio que ya no juega ahí.
  - `getMemberDetail`: `categories`/`categoryHistory` vienen de
    `listMemberships`/`openMemberships` de `member-categories.model.ts`, no de
    un embed en el select de `members` (ya no hay una FK category_id que
    embeber desde `members`).

- `members.controller.ts`:
  - `getPadron(filters)`: `requirePanelAccess()` (lectura del slice 1, sin
    cambios) + `searchMembers(filters, { includeDebt:
    session.permissions.includes('payments.read') })`.
  - `getMemberPage(id): Promise<MemberPageData>`: `requirePanelAccess()` +
    `Promise.all([getMemberDetail(id), getBillingStatus(), includeAccount ?
    getMemberAccountDetail(id) : Promise.resolve(null)])`. `account` es
    `null` solo por falta de permiso (hoy los tres roles tienen
    `payments.read`, así que en la práctica siempre viene con datos; queda
    listo para cuando haya roles configurables sin ese permiso).

- `members.actions.ts`:
  - `setMemberCategories(input)`, `leaveCategory(input)`,
    `changeCategory(input)`: las tres con `requirePermission('members.write')`
    (no `requireRole`: toda regla nueva del slice de cuotas chequea permisos,
    CLAUDE.md T12), Zod, y `revalidatePath('/socios')` +
    `revalidatePath('/socios/${memberId}')`.
  - `loadMoreMembers`: ahora also decide `includeDebt` con
    `session.permissions.includes('payments.read')` (antes no existía el
    concepto).
  - `createMember`/`updateMember`: se mantienen con `requireRole('admin',
    'editor')` tal como pide la tarea (deuda documentada de roles→permisos
    del slice 1, no la resuelvo yo).

- `catalogs.model.ts`: `setCategoryActive(id, false)` cuenta con
  `member_categories` (embed `!inner` a `members` filtrando `status = eq.active`
  y `left_on is null`), no con `members.category_id` (columna eliminada).

## Reglas de negocio, invariantes y errores implementados

- **Una categoría por disciplina, siempre.** La verdad la tiene la base (RPC +
  trigger); la capa TS repite el chequeo ANTES del alta
  (`assertCategorySelection`) para no crear un socio con una selección
  inválida, y traduce el error de la base en la edición
  (`translateSetCategoriesError`, mensaje exacto "Elegí una sola categoría por
  deporte", `field: 'categoryIds'`).
- **Categoría inactiva o inexistente**: mismo patrón, dos mensajes distintos
  ("está dada de baja" / "no existe"), verificados contra la base real (abajo).
- **Ascenso 6ta→5ta en una sola llamada** a `set_member_categories`: cierra la
  vieja y abre la nueva con el mismo `effectiveOn`, sin tocar las demás
  disciplinas abiertas del socio. Verificado.
- **`member_type` derivado**: nunca se manda desde TS (ni en el insert del
  alta ni en ningún UPDATE); se comprobó que cerrar todas las inscripciones lo
  vuelve `non_practicing` y abrir una lo vuelve `practicing`.
- **Filtro de deuda condicionado por permiso, no por rol** (T12): `searchMembers`
  ni pide ni filtra por las columnas calculadas de deuda si `includeDebt` es
  falso. Hoy los tres roles built-in tienen `payments.read`, así que el caso
  "sin permiso" solo se ejerce hoy si el pipeline de roles configurables saca
  ese permiso de algún rol nuevo — el contrato ya lo soporta.
- **Padrón: un socio con dos categorías coincidentes sale una sola vez.**
  Verificado con datos reales del seed (Valentina Ficticia, id 5, con Vóley
  Sub 18 + Fútbol femenino Primera abiertos): la consulta con `!inner` +
  `.eq`/`.in` + `.is(left_on, null)` lo devuelve en una sola fila, con el
  array anidado mostrando ambas categorías (sin filtro) o solo la que matcheó
  (con filtro — ver nota abajo).
- **Una categoría vieja cerrada no contamina el filtro.** Verificado: Joaquín
  Prueba (id 4) tuvo 6ta (id 5) hasta el 2026-06-30 y después 5ta (id 6);
  filtrar por categoría 5 (6ta) HOY no lo trae — solo trae a Bruno, que sigue
  con 6ta abierta.
- **`leaveCategory`/`closeMembership`**: 0 filas afectadas (id inexistente o
  ya cerrada) → `DomainError` genérico ANTES de que el trigger tenga que
  quejarse; con una inscripción realmente abierta, el UPDATE funciona y
  devuelve el `memberId`.
- **`catalogs.setCategoryActive(false)`**: cuenta inscripciones abiertas de
  socios ACTIVOS (no cualquier socio): verificado que un socio `inactive` con
  la categoría abierta NO suma al conteo (Bruno Pérez Test, id 11, `status =
  inactive`, categoría 6ta id 5: el conteo dio 0; con Tomás Ejemplo, id 2,
  activo, categoría 8va id 3: el conteo dio 1).

## Qué necesita una base real para probarse (para `tests/db/`)

Ya lo verifiqué manualmente contra la base local (detalle abajo), pero queda
para `tests/db/` de forma automatizada:

1. RLS + permisos de `member_categories`: `editor` inserta/actualiza,
   `consulta` solo lee, ninguno hace `DELETE`.
2. `set_member_categories` como `consulta` → `insufficient_privilege`.
3. El trigger `member_categories_insert_guard` con categoría inactiva,
   inexistente, `joined_on` anterior al alta del socio o futuro, y "ya
   inscripto en la misma disciplina".
4. El trigger `member_categories_update_guard`: cerrar una vez ok, una segunda
   vez error, `left_on` futuro error.
5. El doble embed (`open_categories`/`match_categories`, ambos alias
   EXPLÍCITOS de `member_categories`): con un socio que tiene una categoría
   vieja cerrada Y una nueva abierta en la misma disciplina (el caso Joaquín
   del seed), filtrando por la categoría vieja no debe aparecer, y filtrando
   por la nueva `open_categories` no debe traer la vieja mezclada. Es el caso
   más frágil de todo B3: lo verifiqué a mano (curl + supabase-js) con una y
   con varias filas de resultado porque el bug de la primera versión (embed
   sin alias conviviendo con uno aliasado) solo aparecía con más de una fila
   — un test automatizado con al menos dos socios en el resultado evita que
   alguien reintroduzca el bug "arreglándolo" solo contra un caso de una fila.
6. Keyset del padrón con un socio de dos deportes: que no aparezca dos veces
   ni rompa el cursor `(last_name, first_name, id)`.
7. `catalogs.setCategoryActive`: el conteo de inscripciones abiertas de
   socios activos, con un socio inactivo en la misma categoría (no debe
   sumar).

## Verificación contra la base real (ids del seed DESPUÉS del segundo db:reset)

Seed real (`member_categories` tras el reset): Tomás Ejemplo (id 2) en 8va
(fútbol masc); Martina Ejemplo (id 3) en Juveniles (fútbol fem); Joaquín
Prueba (id 4) en 6ta hasta 2026-06-30 y en 5ta desde 2026-07-01 (el ascenso);
Valentina Ficticia (id 5) en Vóley Sub 18 desde 2026-02-01 Y Fútbol femenino
Primera desde 2026-04-01 (dos deportes simultáneos); Sofía Inventada (id 6)
tuvo Fútbol femenino Primera hasta 2026-08-31 (hoy no practicante); Mateo Demo
(id 7) en 7ma; Nahuel Muestra (id 9) en 10ma; Camila Núñez Test (id 10) en
Vóley Mayores; Bruno Pérez Test (id 11, socio `inactive`) en 6ta.

Herramientas: `docker exec -i supabase_db_lonqui psql` para inspección directa;
un JWT HS256 armado a mano (mismo secreto que `supabase status`) contra el
usuario admin sembrado, pegándole a PostgREST local (`curl` a
`127.0.0.1:54321/rest/v1`) para probar el embed EXACTO que arma
`members.model.ts`; y un script Node con `pg` dentro de `BEGIN … ROLLBACK`
(mismo patrón que `tests/db/helpers.ts`: `actAs`/`actAsSuperuser` con
`request.jwt.claims`) para ejercer `set_member_categories`/el UPDATE de cierre
como `editor` y `consulta` sin dejar filas. Nada de esto quedó en el repo (se
corrió y se borró).

Resultados (todos como se esperaba, sin sorpresas):

- Filtro por categoría 5 (6ta) vía PostgREST (`member_categories!inner(...)`
  + `.eq('member_categories.category_id', 5)` + `.is('member_categories.left_on',
  is.null)`): devuelve SOLO a Bruno (id 11, 6ta abierta hoy). Joaquín (id 4,
  tuvo 6ta pero la cerró al ascender) NO aparece — confirma que las dos
  condiciones se evalúan sobre la misma fila del JOIN, no de forma
  independiente sobre el array.
- Listado general (embed sin `!inner`, con `.is(left_on, null)`, sin filtro
  de categoría) para Valentina (id 5): una sola fila con `member_categories`
  como array de 2 elementos (Fútbol femenino Primera + Vóley Sub 18).
- Filtro por disciplina (`.in('member_categories.category_id', [5,6])`, las
  dos categorías de fútbol masc que importan acá): Joaquín (5ta, id 6) y
  Bruno (6ta, id 5) aparecen, cada uno una vez, con su lista COMPLETA de
  categorías abiertas (ver "Corrección: doble embed" más abajo — la primera
  versión de este archivo mostraba acá solo la categoría que matcheaba el
  filtro, y el hilo principal lo marcó correctamente como un bug contra
  §13.2, no un trade-off aceptable).
- Campos calculados `member_debt_status`/`member_balance_cents`/
  `member_months_due` sobre `members`: funcionan con el admin sembrado
  (`payments.read`).
- `set_member_categories` como `editor`: abre 10ma + Sub 18 en una llamada;
  una segunda llamada con `{6ta, Sub 18}` cierra 10ma con el `effective_on`
  nuevo, abre 6ta con ese mismo `joined_on`, y deja Sub 18 intacta (mismo
  `joined_on` viejo) — el ascenso en una sola llamada, verificado.
  `member_type` se mantuvo `practicing` en todo momento.
  Cerrar Sub 18 con un UPDATE (`left_on`/`left_reason`, `.is('left_on', null)`
  en el where) afectó 1 fila. Cerrar TODO con `set_member_categories(m, [],
  fecha)` volvió a `member_type = 'non_practicing'`. Reintentar cerrar la
  inscripción ya cerrada afectó 0 filas (el caso que `closeMembership` traduce
  a `DomainError`).
- Como `consulta`: `set_member_categories` → error, mensaje EXACTO "No tenés
  permiso para modificar socios" (el mismo que devuelve mi traductor para
  `42501`, coincide con el mensaje que la propia RPC ya trae armado).
- Dos categorías de la misma disciplina en la lista (`{5ta, 6ta}`) → error
  EXACTO "Elegí una sola categoría por deporte" (coincide con
  `ONE_CATEGORY_PER_DISCIPLINE` de mi traductor).
- Categoría inactiva (desactivé la 5ta dentro de la misma transacción de
  prueba, con rollback al final): `set_member_categories` como `editor` →
  error EXACTO "La categoría está dada de baja" (coincide con
  `CATEGORY_INACTIVE_MARKER`).
- `catalogs.setCategoryActive`, conteo de inscripciones abiertas de activos
  vía `member_categories?select=id,members!inner(status)&category_id=eq.X&
  left_on=is.null&members.status=eq.active`: categoría 6ta (id 5, solo Bruno,
  `inactive`) → 0; categoría 8va (id 3, Tomás, `active`) → 1.

## Typecheck y lint

- `npx eslint src/models src/controllers` — limpio, sin warnings.
- `npx tsc --noEmit -p .` — mis 5 archivos (`members.model.ts`,
  `member-categories.model.ts`, `catalogs.model.ts`, `members.controller.ts`,
  `members.actions.ts`) sin errores. Errores restantes, TODOS fuera de mi
  ownership (esperado y reportado, no lo arreglo yo):
  - `src/app/(panel)/socios/[id]/page.tsx` y `.../editar/page.tsx`: esperan
    `MemberDetail` de `getMemberPage`, que ahora devuelve `MemberPageData`
    (`{ member, account, billing }`). F2 tiene que leer `data.member` (y
    puede usar `data.account`/`data.billing` para lo que antes no tenía).
  - `src/views/members/member-detail-view.tsx`,
    `member-form.tsx`, `member-list.tsx`: usan los campos viejos
    `categoryName`/`disciplineName`/`categoryId`/`disciplineId` de
    `MemberDetail`/`MemberSummary`, que ahora son `categories:
    MemberCategoryRef[]` (array, uno por deporte). F2 tiene que renderizar la
    lista ("Fútbol masculino · 5ta, Vóley · Sub 18" o "No practicante" si está
    vacío) en vez de un único par disciplina/categoría, y el formulario
    necesita el nuevo bloque de checkboxes por disciplina (§13.6) en vez del
    selector `memberType`/`categoryId`.
  - `src/views/audit/audit-labels.ts`: falta `member_categories` en el
    `Record<AuditedTable, string>` — es la tarea que §13.7 asigna al hilo
    principal ("AUDITED_TABLES del modelo y de la page de /auditoria"); no es
    mía y no la toqué (`audit.model.ts` tampoco es mío, lo modifica B2 según
    01-tasks.md).
  - `src/models/fees.model.ts`: un error de tipos sobre un `insert` que le
    falta `period` — es de B1, no lo toco.
  - `tests/models/members.model.writes.test.ts`: usa el `CreateMemberInput`
    viejo (`memberType`, sin `categoryIds`) — lo tiene que actualizar
    `test-engineer` con el contrato nuevo.

## Deferrals / lo que el frontend (F2) tiene que adaptar

1. Formulario de alta/edición: reemplazar el selector `memberType` +
   `categoryId` por la sección "Deportes y categorías" (checkboxes agrupados
   por disciplina, radio dentro de cada una) que describe §13.6, mandando
   `categoryIds: number[]` en el alta (`createMember`) y usando las nuevas
   actions `setMemberCategories`/`leaveCategory`/`changeCategory` para la
   edición (no `updateMember`, que ya no acepta esos campos).
2. Ficha (`/socios/[id]`): leer `getMemberPage` como `MemberPageData` (`{
   member, account, billing }`, no `MemberDetail` directo); pintar
   `member.categories` (abiertas) en el encabezado, `member.categoryHistory`
   en el panel "Deportes" con las acciones de baja/cambio de categoría.
3. Padrón: pintar `MemberSummary.categories` (array) en vez de
   `categoryName`/`disciplineName`; los filtros de categoría/disciplina no
   cambian de firma (siguen siendo `categoryId`/`disciplineId` en
   `MemberFilters`). Con un filtro de categoría activo, `categories` sigue
   trayendo TODOS los deportes abiertos del socio (no solo el que matcheó el
   filtro) — ver "Corrección: doble embed" más abajo.

## Corrección: doble embed para separar "quién matchea" de "qué se muestra"

El hilo principal marcó, con razón, que la nota de UX de la primera versión
("con un filtro de categoría activo la fila puede mostrar solo esa categoría")
era un bug contra §13.2 ("cada fila muestra sus categorías"), no un trade-off
aceptable. La instrucción: embeber `member_categories` DOS veces con alias
distinto — uno solo para filtrar (`!inner`), otro para mostrar (todas las
abiertas).

**Hallazgo al implementarlo, más grave de lo que parecía a primera vista:**
la primera prueba manual con alias en SOLO uno de los dos embeds (`match:
member_categories!inner(...)` filtrando, `member_categories(...)` — el
nombre por defecto, SIN alias — mostrando) parecía andar bien en una prueba
con un único socio de resultado (`id=eq.4`), pero **fallaba con más de una
fila de resultado**: el filtro `member_categories.left_on=is.null` del embed
SIN alias dejaba de aplicarse, y un socio con una categoría vieja ya cerrada
(Joaquín, que ascendió de 6ta a 5ta) la volvía a mostrar en el array
`open`/`member_categories` junto con la abierta — exactamente el bug que se
estaba corrigiendo, pero ahora en la columna que se MUESTRA, no en el filtro.
Aliasando los DOS embeds explícitamente (`open_categories:member_categories(...)`
+ `match_categories:member_categories!inner(...)`) el problema desaparece en
todos los casos probados, con una y con varias filas de resultado. No llegué
a entender la causa exacta en PostgREST (probablemente algo en cómo resuelve
a qué embed pertenece un filtro cuando hay un nombre sin alias conviviendo con
uno aliasado de la MISMA relación) — lo dejo anotado para `tests/db/` (ítem 5
de la sección de arriba) porque es sutil y no se ve con una sola fila de
prueba, que es como se prueba a mano por defecto.

Cambios en `src/models/members.model.ts`:
- `CATEGORY_DISPLAY_EMBED = 'open_categories:member_categories(category_id,
  left_on, categories(name, discipline_id, disciplines(name)))'` — SIEMPRE en
  el select, con o sin filtro de categoría.
- `CATEGORY_MATCH_EMBED = 'match_categories:member_categories!inner(category_id,
  left_on)'` — solo en el select cuando hay filtro de categoría/disciplina.
- Filtros: `.is('open_categories.left_on', null)` siempre (recorta qué se
  muestra); `.eq('match_categories.category_id', X)` /
  `.in('match_categories.category_id', [...])` +
  `.is('match_categories.left_on', null)` solo cuando hay filtro (deciden qué
  socios entran).
- `SearchRow.open_categories` en vez de `.member_categories`; `mapCategoryEmbed(r.open_categories)`.

**Verificado de nuevo contra la base real** (mismo seed que la corrida
anterior, mismo patrón de JWT armado a mano + `curl` a PostgREST local, y
además con el cliente `@supabase/supabase-js` real apuntando al stack local
para probar la MISMA cadena `.eq()/.in()/.is()` que arma el código):

- Filtro Vóley · Sub 18 (`categoryId=12`): Valentina (id 5) sale UNA fila,
  con `open_categories` mostrando SUS DOS deportes (Fútbol femenino Primera +
  Vóley Sub 18) y `match_categories` mostrando solo el que matcheó (Sub 18) —
  el criterio de aceptación de §13.2 ("cada fila muestra sus categorías") se
  cumple ahora también con un filtro activo.
- Filtro por disciplina fútbol masculino (`.in` categorías 5/6 = 6ta/5ta):
  Bruno (6ta) y Joaquín (5ta, ascendido) aparecen una vez cada uno, cada uno
  con su propia lista completa (en este caso, 1 deporte cada uno) — y
  Joaquín NO arrastra su 6ta vieja ni en el filtro ni en la columna que se
  muestra.
- Listado general sin filtro (solo `open_categories`, sin `match_categories`
  en el select): sigue andando igual que antes, keyset con `order`/`limit`
  sin cambios.

## Deferrals propios (no bloquean, documentados)

- No implementé una restricción explícita de "solo se puede activar/desactivar
  la disciplina cuando..." porque no está en el alcance de B3 (eso es
  `catalogs.model.ts` en general, ya existente).
- `changeCategory` rechaza `newCategoryId` de una disciplina distinta a la de
  la inscripción que se está cambiando (decisión mía, documentada arriba en
  "Contratos que expuse"); si la Comisión pide poder "cambiar de deporte" con
  la misma acción, es un cambio de alcance a confirmar, no algo que
  silenciosamente permití.

## Sin cambios de schema pedidos

No encontré ningún problema de grants, políticas o índices durante esta
tarea: las migraciones `20260927125000_member_categories.sql` y
`20260927130200_accounts.sql` ya traen todo lo que necesité (RPC, campos
calculados, triggers). No hay SQL para pedirle al hilo principal.
