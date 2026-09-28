# 02 — Fixes de backend del code review (slice 1: padrón, roles, auditoría)

Agente: `senior-backend-engineer`. Fecha: 2026-09-27. Alcance: `src/models/**`,
`src/controllers/**`, `src/services/**`, en respuesta a `03-review.md`. No se
tocó `src/views/**`, `src/app/**`, `supabase/migrations/**`, `src/lib/**` ni
`tests/**` (en paralelo un agente de frontend adapta vistas/pages a las firmas
nuevas de los hallazgos 3, 4, 6 y 8; el hilo principal ya aplicó la migración
`20260927120000_review_fixes.sql`; `test-engineer` escribe la suite en
paralelo).

`npm run typecheck` y `npm run lint` en verde para todo `src/`. Los únicos
errores de `typecheck` son en `tests/` (fuera de mi alcance): ver "Para
test-engineer" al final.

---

## Blocker 1 — Open redirect (`isInternalRedirectPath`)

**Archivos**: `src/models/app-users.model.ts`, `src/controllers/auth.actions.ts`.

Se borró la función `isInternalRedirectPath` (la copia vieja, vulnerable a
`/\evil.com`) de `app-users.model.ts`. `auth.actions.ts` (`signIn` y
`changePassword`) ahora importa la única fuente, `isInternalRedirectPath` de
`@/lib/safe-redirect.ts` (ya escrita por el hilo principal antes de esta
tanda, no se tocó). Los dos call sites (`redirect(mustChangePassword ? ... :
isInternalRedirectPath(next) ? next : '/')`) no cambiaron de forma, solo el
origen del import.

**Regla para el futuro**: cualquier redirect basado en un `next` de query
string tiene que pasar por `@/lib/safe-redirect.ts`. No crear una segunda
copia local "por las dudas".

## Blocker 3 (parte modelo) — Responsable de pago que cambia de grupo

**Archivo**: `src/models/members.model.ts` (`translateMemberError`).

El hilo principal ya agregó el trigger `members_clear_responsible_on_group_change`
(migración de fixes) que pone `is_payment_responsible = false` cuando cambia
`family_group_id`, en la misma transacción del `UPDATE`. Por eso `updateMember`
**no** escribe `is_payment_responsible` — ya no hacía falta, y agregarla sería
una segunda fuente de la misma verdad que el trigger ya resuelve.

Se agregaron dos traducciones defensivas a `translateMemberError` (el trigger
cubre el camino normal; esto es la red para una carrera o un futuro camino de
escritura que toque el flag sin pasar por el trigger):

- `23514` con el CHECK `members_responsible_has_group` → `DomainError('El
  responsable de pago no puede quedar sin grupo familiar', { field:
  'familyGroupId' })`.
- `23505` con el índice único `members_one_responsible_per_group` →
  `DomainError('Ese grupo familiar ya tiene un responsable de pago', { field:
  'familyGroupId' })`.

**Para test-engineer [DB]**: mover al responsable de un grupo a otro grupo /a
ningún grupo y verificar `is_payment_responsible = false` tras el `UPDATE`
(ya lo pide `03-review.md`); el `field: 'familyGroupId'` de las dos
`DomainError` de arriba solo se ejercita forzando el `UPDATE` directo contra
Postgres sin pasar por el trigger (p. ej. con una sesión que solo actualiza
`is_payment_responsible`), porque por la app normal el trigger ya lo evita.

## Major 4 — URL del certificado firmada al click, no al render

**Archivos**: `src/controllers/members.controller.ts`,
`src/controllers/members.actions.ts`, `src/models/medical-clearances.model.ts`.

- `members.controller.ts`: `getMemberPage` ya no llama a `getSignedUrl`.
  `MemberDetail.medicalClearanceUrl` queda **siempre `null`** (el modelo ya lo
  devolvía así; se sacó el paso que lo pisaba en el controller). El tipo no
  cambió (instrucción del pipeline: no tocar `types.ts` para esto).
- `medical-clearances.model.ts`: nueva `getMedicalClearanceById(id):
  Promise<MedicalClearance | null>` y el schema `getMedicalClearanceUrlSchema
  = { memberId: number; clearanceId: number }` (`.strict()`).
- `members.actions.ts`: nueva action

  ```ts
  export async function getMedicalClearanceUrl(
    input: unknown,
  ): Promise<ActionResult<{ url: string }>>
  ```

  `requireRole()` sin roles (cualquier rol activo, misma exigencia que ver la
  ficha) → `getMedicalClearanceUrlSchema.safeParse` → busca el apto por
  `clearanceId`, verifica `clearance.memberId === input.memberId` (nunca
  confiar en que el `clearanceId` que llega es del socio que dice ser) y que
  tenga `storagePath` → `getSignedUrl(storagePath, 60)`.

  Mensajes: `'No encontramos ese apto físico'` (no existe o es de otro
  socio), `'Este apto no tiene certificado adjunto'` (cargado solo con fecha).

**Contrato para frontend**: el botón "Ver certificado" llama a esta action al
click (no antes) y abre `result.data.url` en una pestaña nueva. Si
`medicalClearanceUrl` seguía usándose en alguna vista, ya no sirve: siempre es
`null`.

## Major 5 — "Ver más" del padrón como Server Action

**Archivos**: `src/models/members.model.ts`, `src/controllers/members.actions.ts`.

Nuevo schema en el modelo:

```ts
export const loadMoreMembersSchema = z.object({
  filters: memberFiltersSchema, // subconjunto de MemberFilters, validado
  cursor: z.string().min(1),
}).strict()
```

`memberFiltersSchema` valida `q`, `categoryId`, `disciplineId`, `status`
(`'active' | 'inactive' | 'all'`), `memberType`, `debt` — el mismo shape de
`MemberFilters` menos `cursor`/`limit` (que la action fija ella misma).

Nueva action:

```ts
export async function loadMoreMembers(
  input: unknown,
): Promise<ActionResult<Page<MemberSummary>>>
```

`requireRole()` sin roles (cualquier rol activo, misma exigencia que
`getPadron`) → valida → `searchMembers({ ...filters, cursor })`. No hay
cambios en `searchMembers` ni en `getPadron`/`members.controller.ts`: la
page inicial sigue leyendo del Server Component como antes.

**Contrato para frontend**: reemplazar el `pages=N` en la URL por un Client
Component que acumula `items` en estado (mismo patrón que `AuditList`) y pide
la página siguiente llamando a esta action con `{ filters, cursor:
page.nextCursor }`.

## Major 6 — `listFamilyGroups()` sin N+1

**Archivo**: `src/models/family-groups.model.ts`.

Antes: `listFamilyGroups()` traía los ids de grupo y llamaba a
`getFamilyGroup(id)` por cada uno (dos queries cada una → 1 + 2·N).

Ahora: una sola consulta con embed de PostgREST, compartida por
`getFamilyGroup` y `listFamilyGroups`:

```
id, name, payer_contact_name, payer_contact_phone, notes,
members(id, first_name, last_name, status, is_payment_responsible)
```

`mapFamilyGroupRow` (nueva función privada) arma `FamilyGroupSummary` a partir
de esa fila — mismo cálculo de `label`/`missingResponsible` que antes, pero
ordena los integrantes en TS (`localeCompare('es')`) porque el embed no trae
un `order` propio por columna aparte del de la tabla principal. `getFamilyGroup`
y `listFamilyGroups` quedan en una sola query cada una.

Sin cambios en la firma pública de ninguna de las dos funciones ni en
`FamilyGroupSummary` (`types.ts` no se tocó).

## Minor 8 — `/auditoria` sin pegarle a la Admin API en cada render

**Archivo**: `src/controllers/audit.controller.ts`.

Nueva función:

```ts
export async function listAuditActorOptions(): Promise<{ userId: string; displayName: string }[]>
```

`requirePanelAccess('admin')` → `listAppUsers()` (modelo, cliente de sesión,
RLS) → mapea a `{ userId, displayName }`, ordenado por nombre (`es`). Las
altas incompletas (sin fila en `app_users`) quedan afuera solas, sin filtrar
nada a mano — antes `listUsers()` (`users.controller.ts`) las traía de Auth y
la page las filtraba por `authStatus === 'ok'`.

**Contrato para frontend**: la page de auditoría reemplaza
`listUsers()` (de `users.controller`) por `listAuditActorOptions()` (de
`audit.controller`) para armar el select "Usuario". Ya no hace falta cruzar
con Auth para esta pantalla.

## Minor 9 — `completeUser` no confía en el email del browser

**Archivos**: `src/services/auth-admin.service.ts`, `src/controllers/users.actions.ts`.

Nueva función en el servicio: `getAuthUserEmail(userId): Promise<string>`
(`admin.auth.admin.getUserById`). En `completeUser`, el email que se escribe
en `app_users` (columna inmutable por trigger) sale de esta función, no de
`parsed.data.email`. El schema (`completeAppUserSchema`, en
`app-users.model.ts`) **no cambió**: sigue pidiendo `email` porque la UI lo
sigue mostrando/validando como texto en el formulario, pero el valor que
llega del formulario ahora se ignora en el server — es puramente informativo
para quien completa el alta, nunca la fuente de verdad.

## Minor 10 — Grupo familiar nuevo, creado después de validar al socio

**Archivo**: `src/models/members.model.ts`.

`createMemberSchema` acepta ahora:

```ts
newFamilyGroup?: { name?: string | null; payerContactName?: string | null; payerContactPhone?: string | null }
```

(sin `notes`, a propósito: ese campo es de editar un grupo ya creado). Es
mutuamente excluyente con `familyGroupId` — `superRefine` lo rechaza con
`field: 'familyGroupId'` si vienen los dos.

`createMember` ahora:

1. Chequeo previo de DNI (`memberDniExists`, nueva función privada: `select id
   from members where dni = :dni limit 1`) — si ya existe, `DomainError` antes
   de tocar nada más.
2. Si viene `newFamilyGroup`, crea el grupo (`createFamilyGroup` de
   `family-groups.model.ts`, ya importado) y usa su `id` como
   `family_group_id` del insert.
3. Inserta el socio.

**Residual documentado en el código** (comentario arriba de `createMember`):
si el `insert` de `members` falla por una carrera real (dos altas con el
mismo DNI entre el paso 1 y el paso 3 — el índice único de la base la sigue
atajando), el grupo creado en el paso 2 queda huérfano. Es una ventana angosta
que no se resolvió con una RPC transaccional porque el costo no se justifica
para Fase 1; si aparece en producción, se revisa entonces.

**Para test-engineer**: caso feliz (alta con `newFamilyGroup`, verificar que
el socio queda con el `family_group_id` del grupo recién creado); caso DNI
duplicado con `newFamilyGroup` presente (verificar que **no** se crea el
grupo, o sea, `family_groups` no crece); `newFamilyGroup` + `familyGroupId`
juntos → error de validación con `field: 'familyGroupId'`.

## Minor 11 — Updates que no tocan filas ya no son éxito silencioso

**Archivos**: `src/models/members.model.ts` (`updateMember`),
`src/models/medical-clearances.model.ts` (`updateMedicalClearance`),
`src/models/family-groups.model.ts` (`updateFamilyGroup`).

Las tres ahora encadenan `.select('id').maybeSingle()` tras el `.update()` y
tiran `DomainError(..., { status: 404 })` si no vuelve fila (`'El socio no
existe'`, `'El apto físico no existe'`, `'El grupo familiar no existe'`).
Antes, un id inexistente o bloqueado por RLS terminaba en éxito ("Cambios
guardados") sin haber tocado nada.

**Para test-engineer**: `update` sobre un id inexistente para las tres →
`DomainError` con `status: 404`, no éxito.

## Minor 14 — Zona horaria del club en `audit.model.ts`, sin offset fijo

**Archivo**: `src/models/audit.model.ts`.

Se sacó `CLUB_UTC_OFFSET = '-03:00'` hardcodeado. `clubDayStartUtc`/
`clubDayEndExclusiveUtc` ahora pasan por un helper nuevo, `clubMidnightUtc(date)`,
que usa `CLUB_TIME_ZONE` (importado de `@/lib/dates`, no se tocó ese archivo —
es del hilo principal) con el truco estándar de Intl: formatea un instante
candidato en la zona del club y mide el corrimiento contra la hora buscada,
sin asumir un offset fijo. Si algún día cambia la política de huso horario de
Argentina (o vuelve un DST), esto sigue siendo correcto sin tocar este
archivo.

No se agregó el helper a `lib/dates.ts` (fuera de mi alcance): si en el
futuro otro slice necesita "medianoche de una fecha en una zona IANA como
instante UTC", vale la pena subir `clubMidnightUtc` ahí como
`zonedMidnightUtc(date, timeZone)` genérico — lo dejo señalado para el hilo
principal, no lo hice yo.

**Para test-engineer**: `getAuditPage` con `from`/`to` en el límite de
medianoche argentina (ya lo pedía `03-review.md`) — con este fix el caso de
borde correcto es el mismo que antes en la práctica (Argentina no tiene DST
hoy), pero la implementación ya no depende de que eso siga siendo así.

## Nit 15 — Cursor de auditoría escapado en el filtro `.or()`

**Archivo**: `src/models/audit.model.ts`.

Se agregó un `pgQuote` local (mismo criterio que el de `members.model.ts`,
no se comparte entre archivos a propósito — evita acoplar dos slices por una
función de dos líneas) y se aplicó a `cursor.occurredAt` en el `.or()` del
keyset.

## Nit 16 — sueltos de backend

- `members.model.ts`: el regex de diacríticos pasó de caracteres combinantes
  literales en el código fuente a `/[̀-ͯ]/g` (mismo rango Unicode,
  legible).
- `settings.controller.ts`, `settings.actions.ts`, `audit.controller.ts`:
  `from './session.controller'` → `from '@/controllers/session.controller'`
  (alias, consistente con el resto del código).
- `audit.model.ts`: nueva constante exportada `AUDITED_TABLES` (las 8 tablas
  auditadas, `as const satisfies readonly AuditedTable[]`). Reemplaza la
  necesidad de las dos copias locales en
  `src/app/(panel)/(admin)/auditoria/page.tsx` y
  `src/views/audit/audit-labels.ts` — **no las toqué** (son frontend, fuera de
  mi alcance), pero quien las edite después debería importar esta constante en
  vez de mantener una tercera copia.

---

## Para `test-engineer`

Nada de lo siguiente lo escribí yo; se deja como referencia de qué cambió el
comportamiento observable:

1. `tests/models/app-users.model.test.ts:16` va a fallar en `typecheck`:
   importa `isInternalRedirectPath` de `@/models/app-users.model`, que ya no
   existe ahí (Blocker 1). Ese test tiene que importar de
   `@/lib/safe-redirect` en su lugar — los casos que pedía `03-review.md`
   (`/socios?q=a` ok; `//evil.com`, `/\evil.com`, `/\\evil.com`,
   `https://evil.com`, `javascript:alert(1)` rechazados) siguen siendo
   válidos contra la función nueva, solo cambia el import.
2. `translateMemberError` (members.model.ts): agregar casos para las dos
   `DomainError` nuevas de `members_responsible_has_group` /
   `members_one_responsible_per_group` (ver Blocker 3 arriba).
3. `createMember` con `newFamilyGroup`: casos del Minor 10 (ver arriba).
4. `updateMember`/`updateMedicalClearance`/`updateFamilyGroup` sobre un id
   inexistente → `DomainError` 404 (Minor 11).
5. `getMedicalClearanceUrl`: `clearanceId` de otro socio → rechazado;
   `clearanceId` sin `storagePath` → rechazado; caso feliz → `url` firmada.
6. `loadMoreMembers`: filtros inválidos (clave desconocida, `status` fuera de
   enum) → `invalid()`; caso feliz → misma forma que `searchMembers`.
7. `listFamilyGroups`/`getFamilyGroup`: con el embed nuevo, un grupo sin
   integrantes (`members: []`) y un grupo con el responsable dado de baja
   (`missingResponsible: true` aunque la fila siga con
   `is_payment_responsible = true`) — mismo comportamiento que antes, pero
   ahora depende del embed en vez de dos queries.
8. `clubMidnightUtc`/`clubDayStartUtc`/`clubDayEndExclusiveUtc`
   (`audit.model.ts`, ya no exportadas — probarlas indirectamente vía
   `getAuditPage` con `from`/`to`, como ya pedía `03-review.md`).
9. `listAuditActorOptions` (`audit.controller.ts`): `editor`/`consulta` →
   `PermissionError`/redirect (según se pruebe controller o page); `admin` →
   lista sin altas incompletas.
10. `completeUser`: el email que queda en `app_users` es el de Auth aunque el
    input mande otro (mockear `getAuthUserEmail` para verificarlo).

No se tocó ningún archivo bajo `tests/`.

### Corrida de `npx vitest run` tal como quedó el árbol (verificación, no cambié nada)

296 tests, 6 fallando — los 6 son consecuencia directa y esperada de los
fixes de arriba, no una regresión mía en otro lado:

- **`tests/models/app-users.model.test.ts`** (5 fallos, `describe
  'isInternalRedirectPath'`, líneas 29-51): importa
  `isInternalRedirectPath` de `@/models/app-users.model`, que ya no existe
  ahí (Blocker 1). Ya existe `tests/lib/safe-redirect.test.ts` (13 tests,
  pasa) cubriendo la función real en su ubicación nueva — este bloque de
  `app-users.model.test.ts` queda para borrar.
- **`tests/controllers/users.actions.test.ts`** (1 fallo, `completeUser >
  completa: regenera la temporal...`, línea 168): el mock de
  `@/services/auth-admin.service` (líneas 34-45) no incluye
  `getAuthUserEmail`, así que `completeUser` llama a la versión real
  (`vi.importActual`), que necesita variables de entorno que el test no
  define. Hace falta agregar `getAuthUserEmailMock` al mock (devolviendo el
  email esperado, p. ej. el mismo `'nueva@club.test'` que ya usa el resto del
  `describe`) para que el test siga probando lo mismo que probaba antes, más
  la garantía nueva del Minor 9.

---

## R1 (segunda pasada del review) — "Ver más" del padrón fallaba siempre

**Archivo**: `src/models/members.model.ts` (único cambio; `members.actions.ts`
no necesitó tocarse: `loadMoreMembers` ya llamaba a `searchMembers` sin pasar
`limit`, así que hereda el default nuevo solo).

**Causa**: `socios/page.tsx` armaba `filters` con un `LIST_PAGE_SIZE = 50`
local y lo mandaba tal cual a `loadMoreMembers` (a través de
`MemberListView`/`MemberList`). `memberFiltersSchema` es `.strict()` y nunca
tuvo `limit` como campo — a propósito, según el fix de Major 5 de la primera
pasada — así que `loadMoreMembersSchema.safeParse({ filters: { ..., limit: 50
}, cursor })` rechazaba con `unrecognized_keys` en cada "Ver más". Además,
`searchMembers` sin `limit` caía en `DEFAULT_LIMIT = 30` (un valor distinto
del `50` que la page pedía a mano para la primera tanda), así que aun
arreglando el rechazo las tandas hubieran quedado 50/30/30 en vez de
50/50/50.

**Arreglo**: se reemplazó `DEFAULT_LIMIT` por una constante exportada,

```ts
export const PADRON_PAGE_SIZE = 50
```

`clampLimit` ahora devuelve `PADRON_PAGE_SIZE` cuando no viene `limit` (en vez
de `30`). Como `memberFiltersSchema` sigue sin `limit` ni `cursor` — el
tamaño de página **lo decide el servidor**, nunca el cliente — tanto
`getPadron` (primera tanda, vía `searchMembers(filters)` sin `limit`) como
`loadMoreMembers` (vía `searchMembers({ ...filters, cursor })`, tampoco con
`limit`) terminan en la misma constante. No hizo falta cambiar
`memberFiltersSchema` ni `loadMoreMembersSchema`: ya estaban `.strict()` sin
esos dos campos, que es justo lo que pedía el fix.

**Contrato para frontend**: `socios/page.tsx` y el Client Component de "Ver
más" tienen que importar `PADRON_PAGE_SIZE` de `@/models/members.model` (si
necesitan el número para algo, p. ej. un skeleton) y dejar de mandar `limit`
u otro campo fuera de `q`, `categoryId`, `disciplineId`, `status`,
`memberType` dentro de `filters` — cualquier clave extra sigue siendo
rechazada por `.strict()`, a propósito.

`npm run typecheck` y `npm run lint` en verde. `npx vitest run`: 324/326
(igual que antes de este fix puntual, ver más abajo — las dos fallas que
quedan no son de este cambio). Todos los tests de `members`/padrón
específicamente pasan: `tests/models/members.model.test.ts` (30),
`tests/controllers/members.actions.test.ts` (13), `tests/db/members.test.ts`
(29), `tests/models/members.model.writes.test.ts` (11).

**Nota aparte, no relacionada con este fix ni con mi alcance**: las 2 fallas
que quedan en la corrida completa están en
`tests/db/grants-and-lockdown.test.ts` ("REGRESIÓN minor 7: schema private
sin EXECUTE para PUBLIC"), sobre funciones `settings_billing_guard`,
`payments_paid_on_guard`, `fees_void_guard`, `fees_opening_balance_guard`,
`fee_prices_insert_guard`, `payments_update_guard` — todas del dominio de
cuotas/pagos (pipeline `2026-09-27-cuotas-pagos-panel/`, migraciones que no
tocué). No es nada de este slice ni de este fix; lo dejo anotado para que no
se confunda con una regresión de acá.
