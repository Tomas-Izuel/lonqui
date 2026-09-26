# 02 — Desarrollo backend: B3 (ajustes y auditoría)

Agente: `senior-backend-engineer`. Lane `backend`, tarea **B3** de
`01-tasks.md`. Sin tests (los escribe `test-engineer`), sin migraciones (las
escribe el hilo principal).

## Archivos

Creados, todos nuevos (el slice arrancó sin estos archivos):

- `src/models/catalogs.model.ts` — disciplinas y categorías.
- `src/models/audit.model.ts` — lectura de `audit_log`.
- `src/models/settings.model.ts` — singleton `settings`.
- `src/controllers/settings.controller.ts` — lectura combinada de `/ajustes`.
- `src/controllers/settings.actions.ts` — Server Actions de `/ajustes`.
- `src/controllers/audit.controller.ts` — lectura de `/auditoria`.

No toqué `src/models/types.ts`, `session.controller.ts`, `app-users.model.ts`,
`members.model.ts`, `family-groups.model.ts`, `medical-clearances.model.ts`,
ni nada de `supabase/**`. Todas las escrituras van con el cliente de sesión
(`lib/supabase/server.ts`); no usé `createAdminClient()` en ningún lado.

## Contratos expuestos (para F3 y F4)

### `catalogs.model.ts`

```ts
listDisciplines(options?: { includeInactive?: boolean }): Promise<DisciplineWithCategories[]>
// Ordenadas por sort_order, name; categorías anidadas con el mismo orden.
// includeInactive=false (default): solo disciplinas Y categorías activas —
// es lo que usan los selects de alta/edición de un socio (F2).
// includeInactive=true: todo, para /ajustes (F4).

createDiscipline(input: { name: string }): Promise<Discipline>
updateDiscipline(id: number, patch: { name: string }): Promise<Discipline>
setDisciplineActive(id: number, isActive: boolean): Promise<Discipline>
reorderDisciplines(orderedIds: number[]): Promise<void>
// sort_order = índice en el array. La UI arma orderedIds a partir del orden
// que el usuario dejó (drag & drop u ordenar arriba/abajo).

createCategory(input: { disciplineId: number; name: string }): Promise<Category>
updateCategory(id: number, patch: { name: string }): Promise<Category>
setCategoryActive(id: number, isActive: boolean): Promise<{ category: Category; activeMemberCount: number }>
// activeMemberCount: SIEMPRE viaja (0 al activar). Al desactivar, es el
// conteo de socios activos hoy en esa categoría — la UI arma el aviso, la
// baja NO se impide (pregunta C6 a la Comisión, todavía abierta).
reorderCategories(disciplineId: number, orderedIds: number[]): Promise<void>
// El .eq('discipline_id', disciplineId) evita que un id de otra disciplina
// se cuele en el reorder.

// Schemas Zod exportados (importalos en las actions, no los reimplementes):
createDisciplineSchema, updateDisciplineSchema,
createCategorySchema, updateCategorySchema, reorderSchema
```

### `settings.model.ts`

```ts
getSettings(): Promise<Settings>
updateSettings(patch: { clubName: string; billingStartPeriod: string | null }): Promise<Settings>
updateSettingsSchema // Zod .strict(); billingStartPeriod: z.iso.date().nullable() + refine "termina en -01"
```

Diseño: `updateSettingsSchema` pide **los dos campos siempre**, no un patch
parcial. La UI de `/ajustes` es un formulario de "Datos del club" con ambos
campos visibles a la vez (spec F4: "sección Datos del club con `club_name`");
un update parcial habría exigido inventar semántica de "campo ausente = no
tocar" sin que el spec la pidiera. Si F4 necesita patch parcial, avisar y lo
ajusto (cambio de una línea).

### `audit.model.ts`

```ts
getAuditPage(filters: AuditFilters): Promise<Page<AuditEntry>>
getAuditEntry(id: number): Promise<AuditEntryDetail | null>
```

- Keyset por `(occurred_at desc, id desc)`, cursor opaco en base64url. Probé
  el caso límite contra la base local: el seed inserta varias filas de
  auditoría en la misma sentencia y quedan con **el mismo `occurred_at` hasta
  el microsegundo** (varias filas con id 35–42 comparten el instante exacto).
  Un cursor construido a partir de un `Date` de JS pierde precisión (ms vs.
  µs de Postgres) y esas filas empatadas se duplican o se saltan. Por eso el
  modelo **nunca parsea `occurred_at` a `Date`**: lo recibe como el string
  ISO-con-microsegundos que devuelve PostgREST (`2026-09-25T23:54:01.711461+00:00`)
  y lo reusa tal cual en el cursor y en el filtro `.or()` de la página
  siguiente. Verificado contra la base local con `curl` directo a PostgREST
  (página 1 termina en id 37, la página 2 con ese cursor arranca en 36 sin
  gap ni duplicado).
- `from`/`to` de `AuditFilters` se interpretan en la zona del club
  (`America/Argentina/Buenos_Aires`). Como Argentina no tiene horario de
  verano desde 2009, el offset es fijo `-03:00`: convierto el `date` de
  filtro a instante UTC con ese offset fijo (`clubDayStartUtc`,
  `clubDayEndExclusiveUtc`), sin depender de `Intl`/zonas horarias
  dinámicas. `to` es inclusive de todo ese día: filtro con `.lt()` contra la
  medianoche del día siguiente, no con `.lte()` contra el propio día (que
  cortaría a las 00:00).
- `actorName` se resuelve con una query propia a `app_users` (`user_id,
  display_name`) por los ids **de esa página** (no cruza con
  `app-users.model.ts` de B1 a propósito: son lanes en paralelo y esto evita
  un acoplamiento de archivos entre agentes). El admin que llega hasta acá ya
  pasó `requireRole('admin')`, y la policy de `app_users` deja leer cualquier
  fila a un admin, así que la resolución trae todos los nombres de la página
  en una sola vuelta.
- El listado (`AuditEntry`) **no** trae `old_data`/`new_data`/`context`; el
  detalle (`AuditEntryDetail`, `getAuditEntry`) sí, más `context`.
- **No hice** el chequeo de rol en `audit.model.ts`: vive en
  `audit.controller.ts`, antes de tocar la base, como pide el spec ("para no
  confundir sin acceso con sin filas"). Si algún día se llama al modelo
  directo sin pasar por el controller, un `editor`/`consulta` recibe página
  vacía por RLS (falla cerrado, pero sin el mensaje claro).

### `settings.controller.ts`

```ts
getSettingsPage(): Promise<{ settings: Settings; disciplines: DisciplineWithCategories[] }>
```

Combina `getSettings()` + `listDisciplines({ includeInactive: true })` en una
sola lectura para `/ajustes` — es la orquestación real que justifica el
controller (CLAUDE.md: "combinar modelos"). Hace `requireRole('admin')`
primero (defensa en profundidad: `(admin)/layout.tsx` ya bloquea la ruta,
pero D10 pide que cada controller re-verifique).

**Los selects de disciplina/categoría del padrón (F2) NO pasan por acá.**
Llamá `listDisciplines({ includeInactive: false })` directo desde
`catalogs.model.ts` en la page de `/socios/nuevo` o `/socios/[id]/editar`: es
una lectura plana, y CLAUDE.md permite que una page llame a un modelo
directo en ese caso. Un wrapper de controller ahí sería indirección sin
valor.

### `audit.controller.ts`

```ts
getAuditPage(filters: AuditFilters): Promise<Page<AuditEntry>>
getAuditEntry(id: number): Promise<AuditEntryDetail | null>
```

Cada una hace `requireRole('admin')` y **después** llama al modelo homónimo.

### `settings.actions.ts` (`'use server'` en la primera línea)

Todas: `requireRole('admin')` → `<schema>.safeParse(input)` → si falla,
`invalid(body.error, body.field)` con `zodToApiError` → si pasa, llama al
modelo → `revalidatePath('/ajustes')` → `success(data)`. El `catch` de cada
una usa `failure(err, 'settings.<nombre>')`.

```ts
createDiscipline(input: unknown): Promise<ActionResult<Discipline>>
updateDiscipline(id: number, input: unknown): Promise<ActionResult<Discipline>>
setDisciplineActive(id: number, isActive: boolean): Promise<ActionResult<Discipline>>
reorderDisciplines(orderedIds: number[]): Promise<ActionResult<void>>
createCategory(input: unknown): Promise<ActionResult<Category>>
updateCategory(id: number, input: unknown): Promise<ActionResult<Category>>
setCategoryActive(id: number, isActive: boolean): Promise<ActionResult<{ category: Category; activeMemberCount: number }>>
reorderCategories(disciplineId: number, orderedIds: number[]): Promise<ActionResult<void>>
updateSettings(input: unknown): Promise<ActionResult<Settings>>
```

`input: unknown` a propósito en las que reciben un objeto: el `.strict()` de
Zod es la validación real, no el tipo de TypeScript en la firma (que no
protege nada en runtime contra un payload manipulado). Los pares
`(id, isActive)` de los toggles también se revalidan con un mini-schema
interno (`z.object({ id, isActive }).strict()`) antes de tocar el modelo.

## Reglas de negocio / invariantes implementados (spec del test-engineer)

Todos verificados leyendo el schema real (`supabase/migrations/20260925120000_foundation.sql`,
`20260925120100_catalogs.sql`) y probados contra la base local (seed
existente: 3 disciplinas, 12 categorías, `settings` con `billing_start_period
= null`, `audit_log` con ~42 filas de seed en `actor_source = 'system'`,
`app_users` todavía vacío en este momento del pipeline).

1. **Nombre de disciplina/categoría vacío o duplicado (case-insensitive) →
   `field: 'name'`.**
   - Vacío / < 2 caracteres: lo atrapa `nameSchema` (Zod), el `ActionResult`
     resultante trae `field: 'name'` vía `zodToApiError` (el path del issue
     es `['name']`).
   - Duplicado: los índices `disciplines_name_key` / `categories_name_key`
     (sobre `lower(btrim(name))`) tiran `23505`; el modelo lo traduce a
     `DomainError('Ya existe una disciplina/categoría con ese nombre', {
     field: 'name' })`. **Confirmado contra la base local**: insertar
     `'  fútbol MASCULINO  '` con la fila seed `'Fútbol masculino'` ya
     cargada da `code: 23505, constraint: disciplines_name_key`; mismo caso
     con `' 5TA '` contra `'5ta'` en `categories_name_key`.
   - **[DB]**: la unicidad en sí (el índice, el trigger, el CHECK de
     longitud) la prueba `tests/db/`; acá solo verifiqué que el código de
     error y el nombre del constraint son los que el modelo espera.

2. **Baja de categoría no bloquea, pero informa.** `setCategoryActive(id,
   false)` siempre devuelve `activeMemberCount` (conteo real de `members`
   activos en esa categoría, `count: 'exact', head: true`). Contra el seed
   actual: categoría `id=6` tiene 1 socio activo, categoría `id=5` tiene 1
   inactivo y 0 activos — verificado con una consulta directa. La UI decide
   qué hacer con el número (avisar, no impedir).

3. **`listDisciplines` — dos vistas de los mismos datos.**
   `includeInactive: false` filtra disciplinas Y categorías inactivas (para
   que un alta nueva no pueda elegir una categoría dada de baja);
   `includeInactive: true` trae todo. Orden `sort_order, name` con
   `localeCompare(..., 'es')` para el desempate por nombre. Verificado el
   embed de PostgREST (`disciplines(...).select('..., categories(...)')`)
   contra la base local: PostgREST no garantiza el orden del array anidado,
   por eso el sort se hace en JS después de traer los datos, no delegado a
   PostgREST.

4. **`getAuditPage`: rol antes que datos.** `audit.controller.ts` llama
   `requireRole('admin')` **antes** de tocar `audit.model.ts`. Si algún test
   quiere probar "un `editor` no ve auditoría", tiene que golpear el
   *controller*, no el modelo (el modelo, llamado con una sesión de
   `editor`, devuelve página vacía por RLS — comportamiento correcto pero
   distinto al 403 que pide el spec).

5. **Keyset de auditoría correcto con timestamps empatados.** Documentado
   arriba (sección `audit.model.ts`). **[DB]**: sería valioso un test en
   `tests/db/` que inserte (o aproveche el seed) varias filas con
   `occurred_at` idéntico hasta el microsegundo y pagine con `limit` chico
   para confirmar cero duplicados/gaps — lo verifiqué a mano con `curl`
   directo a PostgREST local pero no queda como test automatizado (no me
   corresponde escribirlo).

6. **Filtro de fecha de auditoría en zona del club.** `to=2026-09-25` incluye
   toda esa fecha en Argentina (hasta las 02:59:59.999999 UTC del día
   siguiente). **[DB]**: un test bueno sería una fila de auditoría con
   `occurred_at` a las 23:30 hora Argentina de un día D (≈ 02:30 UTC del día
   D+1) y verificar que `to=D` la incluye y `to=D-1` no.

7. **`updateSettings`: `billingStartPeriod` primer día de mes o null.**
   Validado en Zod (`.refine` sobre el string `YYYY-MM-DD`, no solo por el
   CHECK de Postgres) para dar el mensaje de error sin ida y vuelta a la
   base. El CHECK de la migración (`billing_start_period = date_trunc(...)`)
   sigue siendo la defensa real si algo evita el modelo.

## Lo que NO hice (fuera de alcance de B3, o pendiente de otro agente)

- No implementé `fee_prices` ni nada de valores de cuota (slice 2, spec
  explícito).
- No agregué UI ni vistas (`src/views/settings/**`, `src/views/audit/**` son
  de F3/F4).
- No toqué `types.ts`: los tipos que uso (`Discipline`, `Category`,
  `DisciplineWithCategories`, `Settings`, `AuditEntry`, `AuditEntryDetail`,
  `AuditFilters`, `AuditedTable`, `Page`) ya estaban completos para lo que
  necesitaba. Si F3/F4 necesitan un campo más, es un cambio de una línea en
  `types.ts` que le corresponde al hilo principal.
- No escribí `reorderDisciplines`/`reorderCategories` como una sola sentencia
  SQL (`UPDATE ... FROM (VALUES ...)`) porque el modelo no tiene acceso a SQL
  crudo, solo a PostgREST vía supabase-js: hice N `UPDATE`s en paralelo con
  `Promise.all`, cada uno auditado por separado (N filas en `audit_log` por
  un reorder de N ítems). Con 3 disciplinas y ~12 categorías esto es
  irrelevante en volumen; si el club llega a tener muchas más categorías,
  valdría una RPC de reorder atómica — no la agregué sin que hiciera falta
  (CLAUDE.md: no tocar `supabase/**` sin que el hilo principal lo pida).

## Verificación

- `npm run typecheck` — verde.
- `npm run lint` — verde.
- `npm test` — verde (sin archivos de test todavía, esperado: `test-engineer`
  no corrió).
- Contra la base local (`npx supabase status` levantada, seed cargado):
  confirmé disciplinas/categorías del seed, unique violation con nombre
  duplicado case-insensitive en ambas tablas, conteo de socios activos por
  categoría, el embed de PostgREST para `listDisciplines`, y la paginación
  keyset de `audit_log` con timestamps empatados (incluida la razón exacta
  por la que un cursor basado en `Date` de JS la rompería). Usé scripts
  Node descartables con el `pg` que ya está en devDependencies (S5) y
  `curl` directo a PostgREST local; los borré todos al terminar, no quedó
  ningún archivo temporal en el repo.

## Preguntas / follow-ups para el hilo principal

Ninguno bloqueante. Dos observaciones, no urgentes:

- `updateSettingsSchema` exige los dos campos siempre (ver arriba). Si F4
  prefiere un patch parcial, avisen y lo cambio.
- El reorder de disciplinas/categorías queda como N updates paralelos, no
  atómico. Documentado arriba; no pido ninguna migración por ahora.
