# 02 — Desarrollo backend B2: Padrón (modelos, controller, actions)

Agente: `senior-backend-engineer`. Tarea B2 de `01-tasks.md`. Lee esto junto con
`00-architecture.md` §6.1, §6.5, D2, D4, D7, D11, §7.2, §7.3.

## Archivos entregados

- `src/models/members.model.ts`
- `src/models/family-groups.model.ts`
- `src/models/medical-clearances.model.ts`
- `src/controllers/members.controller.ts`
- `src/controllers/members.actions.ts`
- `src/services/storage.service.ts`

No toqué nada fuera de esta lista (ni `types.ts`, ni `session.controller.ts`,
ni `supabase/**`, ni `views/**`/`app/**`). `src/models/types.ts` ya traía todo
lo que necesitaba (`Member`, `MemberSummary`, `MemberDetail`, `MemberFilters`,
`Page`, `FamilyGroup`, `FamilyGroupSummary`, `FamilyGroupMember`,
`MedicalClearance`, `MedicalClearanceStatus`, `MemberStatusEvent`, etc.): no
tuve que pedir ningún tipo nuevo.

`npm run typecheck` y `npm run lint` verdes para estos seis archivos (los
errores que quedan en el árbol son de B1: `users.actions.ts`,
`users.controller.ts`, `app-users.model.ts`, y un error preexistente de
`.next/types/validator.ts` que no toqué). `npm test` sigue en 0 archivos (no
escribo tests).

Probé varias de las queries más riesgosas contra la base local real (stack
levantado, seed con 11 socios / 12 categorías / 3 disciplinas / 1 grupo
familiar) con un script descartable fuera del repo: el embed
`categories(name, discipline_id, disciplines(name))`, la normalización de
búsqueda ("nunez" encuentra "Núñez Test"), el filtro `or=` de keyset (página 1
→ página 2 continúa exactamente donde corresponde), el filtro por disciplina
vía subquery de categorías, y `createSignedUploadUrl` / `exists()` reales
contra el bucket `attachments`. El script no quedó en el repo.

## Contratos expuestos (para F2)

### `src/controllers/members.controller.ts` (lecturas, `server-only`)

```ts
getPadron(filters: MemberFilters): Promise<Page<MemberSummary>>
getMemberPage(id: number): Promise<MemberDetail>
```

Ambas llaman `requireSession()` (no `requireRole`: la lectura del padrón es
para cualquier rol activo, incluido `consulta`, por la matriz §6.5). Si
`id` no existe, `getMemberPage` tira `DomainError` con `status: 404`
("El socio no existe"); mapeenlo a `notFound()` en la page si quieren ese
comportamiento.

`getMemberPage` es la ÚNICA función que resuelve `medicalClearanceUrl` (URL
firmada de 60 s), y solo si `currentMedicalClearance.storagePath` no es null.
`getPadron`/`searchMembers` NUNCA firman URLs (ítem de performance: firmar 30
URLs por página sería un round-trip por fila).

### `src/controllers/members.actions.ts` (`'use server'`)

**Convención de firma (decisión mía, la necesitan para consumir esto bien):**
Todas las actions reciben **un objeto plano** (`unknown`, se valida adentro
con Zod `.strict()`) y devuelven `Promise<ActionResult<T>>`. Ninguna usa la
variante `(prevState, formData)` + `useActionState`. Motivo: CLAUDE.md exige
`react-hook-form` en todos los formularios, y RHF ya maneja su propio estado
de envío (`formState.isSubmitting`) llamando a la action desde
`handleSubmit(async (data) => { const r = await createMember(data); ... })`.
Agregar `useActionState` encima sería un segundo mecanismo para lo mismo.
Si en algún punto F2 necesita un `<form action={...}>` sin RHF (no debería,
dado CLAUDE.md), avisen y agrego la variante — no la escribí especulativamente.

```ts
createMember(input: unknown): Promise<ActionResult<{ id: number }>>
updateMember(id: number, input: unknown): Promise<ActionResult<void>>
withdrawMember(input: unknown): Promise<ActionResult<void>>       // solo admin
reactivateMember(input: unknown): Promise<ActionResult<void>>     // solo admin
createFamilyGroup(input: unknown): Promise<ActionResult<{ id: number }>>
setPaymentResponsible(input: unknown): Promise<ActionResult<void>>
prepareMedicalClearanceUpload(input: unknown): Promise<ActionResult<{ path: string; token: string; signedUrl: string }>>
confirmMedicalClearance(input: unknown): Promise<ActionResult<{ id: number }>>
createMedicalClearance(input: unknown): Promise<ActionResult<{ id: number }>>   // apto sin adjunto
updateMedicalClearance(id: number, input: unknown): Promise<ActionResult<void>>
```

Formas de `input` esperadas (= lo que valida cada Zod schema, ver "Schemas"
más abajo para los mensajes exactos):

- `createMember`: `{ firstName, lastName, dni?, dniPending?, birthDate?, address?, phone?, email?, memberType, categoryId?, familyGroupId?, notes?, joinedOn }`.
- `updateMember`: igual sin `joinedOn` (ni `status`, que nunca estuvo).
- `withdrawMember` / `reactivateMember`: `{ memberId, effectiveOn, reason, notes? }`.
- `createFamilyGroup`: `{ name?, payerContactName?, payerContactPhone?, notes? }`.
- `setPaymentResponsible`: `{ groupId, memberId }`.
- `prepareMedicalClearanceUpload`: `{ memberId, mimeType, sizeBytes }` (mimeType ∈ `image/jpeg|image/png|image/webp|application/pdf`).
- `confirmMedicalClearance`: `{ memberId, path, expiresOn, originalFilename?, notes? }` (`path` = el que devolvió `prepareMedicalClearanceUpload`).
- `createMedicalClearance`: `{ memberId, expiresOn, notes? }` (sin adjunto).
- `updateMedicalClearance`: `{ expiresOn?, notes? }` (solo esas dos columnas tienen grant de UPDATE).

**Decisión: no hay `assignFamilyGroup` separado.** `00-architecture.md` §7.2
lo lista, pero `family_group_id` ya es una columna editable de `members` (con
grant de UPDATE) y viaja dentro de `updateMember`. Un action aparte hubiera
sido indirección sin valor (CLAUDE.md). Si F2 quiere "unir al grupo X" desde
el panel del grupo familiar (no desde el formulario completo del socio),
puede llamar `updateMember(memberId, { ...restoDeLosCamposActuales,
familyGroupId })` — ojo que el schema es `.strict()` y pide el objeto
completo, no un patch parcial (ver "Decisiones" más abajo).

### `src/services/storage.service.ts`

```ts
createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string; path: string }>
getSignedUrl(path: string, ttlSeconds: number): Promise<string>
objectExists(path: string): Promise<boolean>
```

Con el cliente de sesión (nunca admin): las policies de `storage.objects`
aplican con el rol de quien sube. Verificado con Context7 (`@supabase/storage-js`
2.117.2, la versión instalada): `createSignedUploadUrl` **no acepta un TTL por
llamada** — la vigencia del token de subida es config del proyecto, no un
parámetro de esta API. El contrato de B2 (`createSignedUploadUrl(path) →
{signedUrl, token, path}`) ya no pedía TTL, así que no hay divergencia, pero
si `00-architecture.md` §7.5/D11 asumía "10 min para subir" configurable por
código, no lo es: es un valor fijo del lado del servidor de Storage.

## Schemas Zod (mensajes exactos, para que F2 sepa qué van a ver)

Todos `.strict()`. Viven en los modelos (`members.model.ts`,
`family-groups.model.ts`, `medical-clearances.model.ts`) y las actions los
importan — no hay ningún schema ni constante definida en `members.actions.ts`
(la única exportación ahí son funciones async, como pide CLAUDE.md).

- `createMemberSchema` / `updateMemberSchema` (`members.model.ts`):
  - DNI: `dni` regex `^[0-9]{7,8}$`; si falta y `dniPending` no es `true` →
    `'El DNI es obligatorio. Si todavía no lo tenés, marcá "DNI pendiente"'`
    (`field: 'dni'`). Si `dni` y `dniPending: true` juntos → error también en
    `dni`.
  - `memberType: 'practicing'` sin `categoryId` → `'Un socio practicante
    necesita una categoría'` (`field: 'categoryId'`); `'non_practicing'` CON
    `categoryId` → error en el mismo campo (el CHECK de la base es simétrico,
    así que lo reflejo).
  - `birthDate` futura → `'La fecha de nacimiento no puede ser futura'`
    (`field: 'birthDate'`).
  - Solo en `createMemberSchema`: `joinedOn` obligatorio, futuro → error en
    `joinedOn`. Puede ser una fecha PASADA (carga histórica): no lo restrinjo
    a "hoy".
  - `email` con `z.email()` (Zod v4); se guarda en minúsculas (lo hago en el
    modelo antes del INSERT/UPDATE, así nunca choca con el CHECK `email =
    lower(email)` de la base).
- `statusEventSchema` (`members.model.ts`): `reason` mínimo 3 caracteres
  (trim), `effectiveOn` fecha ISO. `eventType` NO es parte de este schema: lo
  fija la action (`withdrawMember` pasa `'withdrawal'`, `reactivateMember`
  pasa `'reactivation'`) para que no se pueda mandar `'admission'` a mano
  (esa la crea solo el trigger de alta).
- `familyGroupInputSchema`, `setPaymentResponsibleSchema` (`family-groups.model.ts`).
- `prepareUploadSchema`, `confirmClearanceSchema`,
  `createClearanceWithoutFileSchema`, `updateClearanceSchema`
  (`medical-clearances.model.ts`).

## Errores de Postgres traducidos a `DomainError`

- **DNI duplicado** (`members_dni_key`, `23505`) → `'Ya hay un socio con ese
  DNI'`, `field: 'dni'`.
- **CHECK `members_practicing_has_category`** (defensivo; Zod ya lo frena
  antes) → `'La categoría no corresponde con el tipo de socio elegido'`,
  `field: 'categoryId'`.
- **Trigger de `member_status_events`** (`check_violation`, `23514`), los
  cuatro mensajes exactos que tira la base, envueltos tal cual en
  `DomainError` (ya están en español pensados para el usuario, no los
  reescribo):
  - `'El socio ya está dado de baja'` (sin `field`).
  - `'El socio ya está activo'` (sin `field`).
  - `'La fecha no puede ser futura'` → `field: 'effectiveOn'`.
  - `'La fecha no puede ser anterior a la fecha de alta'` → `field: 'effectiveOn'`.
- **RPC `set_family_payment_responsible`**: `'El socio no pertenece a ese
  grupo familiar'` → `DomainError`, `field: 'memberId'`.
- Cualquier otro error de Postgres (incluida cualquier violación de CHECK que
  no reconozco) se relanza tal cual: la sube `failure()` de
  `action-result.ts`, que lo loguea server-side y devuelve el mensaje
  genérico. Nunca se le muestra al usuario el texto crudo de una constraint.

## `searchMembers`: cómo quedó armado

- **Keyset** por `(last_name, first_name, id)` ascendente. Cursor = base64url
  de `[lastName, firstName, id]` de la última fila de la página. Se arma con
  un filtro `or=` de PostgREST (`last_name.gt.X, and(last_name.eq.X,
  first_name.gt.Y), and(last_name.eq.X, first_name.eq.Y, id.gt.Z)`), porque
  supabase-js no soporta comparación de tuplas nativamente. **Los valores se
  citan siempre** (`pgQuote`: comillas dobles + escape de `\` y `"`) porque la
  API de PostgREST no escapa nada del lado del cliente — un apellido con
  coma, punto o paréntesis rompería el filtro sin esto (verificado contra
  `docs.postgrest.org`, sección "Reserved characters"). Un cursor corrupto
  (manipulado a mano) se ignora silenciosamente y arranca de la primera
  página, no tira 500.
- `limit`: default 30, tope 100 (`clampLimit`), pido `limit + 1` filas para
  saber si hay página siguiente sin un `count` aparte.
- `status`: default `'active'`; `'all'` no filtra; cualquier otro valor exacto.
- `disciplineId`: **dos queries** (primero traigo los `id` de `categories`
  de esa disciplina, después `.in('category_id', ids)`), en vez de un embed
  `!inner` con filtro. Es más simple y con ~15 categorías totales no es un
  problema de performance; si el catálogo creciera mucho, ahí sí valdría la
  pena el embed inner.
- `q`: normalizo en TS igual que `private.normalize_text` de la base
  (`.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()`) y
  `ilike` sobre `search_text` (usa el índice GIN trgm). Probado contra la
  base real: "nunez" encuentra "Núñez Test".
- `debt`: se acepta en `MemberFilters` y se ignora a propósito (comentado en
  el código) — depende de `fees`/`payments` del slice 2.
- `medicalClearanceStatus` **sin N+1**: una sola query extra
  `medical_clearances` con `.in('member_id', idsDeMenoresDeLaPagina)`,
  ordenada por `expires_on desc`, quedándome con el primer valor visto por
  socio (el vigente). Los mayores de edad ni entran a esa query (siempre
  `not_required`).

## Edad, "menor" y estado del apto físico

- `calculateAge(birthDate, today)`: comparación de componentes `Y-M-D` sin
  pasar por `Date` (evita corrimientos de huso horario). `today` siempre sale
  de `toClubDate()` (zona del club), nunca de `new Date()` directo.
- `isMinor = age !== null && age < 18`; sin `birthDate` → `isMinor: false`
  (documentado también en el comentario de `MemberSummary.isMinor` en
  `types.ts`, que ya traía esa convención escrita).
- `medicalClearanceStatus`: `not_required` si no es menor (sin importar si
  tiene o no un apto cargado); si es menor, `missing` sin apto, `expired` si
  `expiresOn < hoy`, `expiring` si vence en ≤ 30 días, `valid` en el resto.
  Mismo cálculo lo usan `searchMembers` y `getMemberDetail` (una sola
  implementación, `deriveMedicalClearanceStatus`, no exportada).

## Grupo familiar

- El responsable de pago SIEMPRE es un integrante del grupo (columna
  `members.is_payment_responsible`, no algo aparte); el "contacto de pago"
  libre (`payerContactName`/`payerContactPhone`) vive en `family_groups` para
  el caso del padre/madre que paga y no es socio (D4).
- `FamilyGroupSummary.missingResponsible`: `true` si NINGÚN integrante
  **activo** tiene `isPaymentResponsible`. Un responsable dado de baja deja al
  grupo "sin responsable" aunque su fila siga con el flag en `true` (así lo
  pide §00-architecture D4) — la baja no limpia el flag, es la UI la que
  avisa.
- `FamilyGroupSummary.label`: `name` del grupo, o si no tiene, el apellido del
  responsable activo, o `'Grupo familiar'` si tampoco hay eso.
- `listFamilyGroups()` hace 1 + 2N queries (N = cantidad de grupos). Con el
  volumen esperado (dígitos de familias, no de socios) es aceptable; **no**
  es apto para un listado que creciera a cientos de filas — si eso pasara
  algún día, ahí sí valdría una vista o RPC de agregación.

## Apto físico: flujo de subida (D11)

1. `prepareMedicalClearanceUpload({ memberId, mimeType, sizeBytes })`: valida
   Zod (MIME de la lista de S4, tamaño ≤ 10 MiB), arma la ruta en el servidor
   (`buildMedicalClearancePath`, `medical-clearances/<memberId>/<uuid>.<ext>`,
   `crypto.randomUUID()`), pide la URL de subida firmada con el cliente de
   sesión. El browser sube DIRECTO a Storage con `uploadToSignedUrl` (no pasa
   por ningún Server Action ni función de Vercel: el archivo nunca cruza el
   límite de 4,5 MB de body).
2. `confirmMedicalClearance({ memberId, path, expiresOn, originalFilename?,
   notes? })`: rechaza si `path` no empieza con
   `medical-clearances/<memberId>/` (evita que confirmen un archivo de otro
   socio) y si `objectExists(path)` da `false` (evita filas que apuntan a
   nada). Recién ahí inserta la fila.
3. `createMedicalClearance({ memberId, expiresOn, notes? })`: el caso "vieron
   el papel, solo cargan la fecha" — mismo modelo, `storagePath: null`.

`getMemberPage` (controller) es quien firma la URL de lectura (60 s), no el
modelo: así `medical-clearances.model.ts` no sabe nada de Storage (seam limpio
para testear con mocks del modelo sin tocar Storage, y viceversa).

## Decisiones y trade-offs

1. **Todos los inputs de `updateMember` son obligatorios (mismo shape que el
   alta), no un patch parcial.** Coincide con "F2: `/socios/[id]/editar` mismo
   formulario que alta" (01-tasks.md, F2). Si en algún momento quieren un PATCH
   de un solo campo (ej. solo cambiar el teléfono desde otra pantalla), hace
   falta un schema nuevo — avisen antes de asumir que `updateMember` lo
   soporta.
2. **`is_payment_responsible` NO es parte de `createMemberSchema`/
   `updateMemberSchema`**, aunque la columna tiene grant de UPDATE. Motivo:
   ponerlo en `true` a mano rompe la garantía atómica de "el anterior se
   limpia" que sí da la RPC `set_family_payment_responsible` (el UPDATE
   directo solo tiene la protección del índice único parcial, que rechazaría
   un segundo responsable pero no reasigna limpiamente). Cambiar el
   responsable SIEMPRE pasa por `setPaymentResponsible`.
3. **Traducción de errores por texto exacto, no por prefijo/regex laxo.** Uso
   `Set` con los cuatro mensajes literales del trigger de `member_status_events`.
   Si el hilo principal cambia el texto de un `raise exception` en una
   migración futura, esto se desincroniza en silencio (el error cae al path
   genérico en vez de traducirse) — lo marco acá para que quien toque esas
   migraciones lo tenga presente.
4. **Storage con cliente de sesión, siempre.** Ni `prepareMedicalClearanceUpload`
   ni `confirmMedicalClearance` usan `createAdminClient()`. Confirmado que la
   policy de INSERT de `storage.objects` exige `has_role('admin','editor')`,
   así que si algún día alguien intenta llamar esto sin el rol correcto, falla
   en la base igual que en la app (defensa en profundidad real).

## Lo que necesita base real para probarse [DB] (spec para `test-engineer`)

- Traducción de los 4 mensajes de `member_status_events` + DNI duplicado +
  CHECK practicante/categoría, con roles reales (`editor` no puede
  withdraw/reactivate; `admin` sí).
- `searchMembers`: keyset estable en ambas direcciones con datos que fuerzan
  el desempate por `first_name` e `id` (dos socios con mismo apellido), y con
  acentos (ya probado ad-hoc contra la base local con el seed real: "nunez" →
  "Núñez Test"; falta el test formal en `tests/db/`).
- `medicalClearanceStatus` en el listado: un menor sin apto (`missing`), uno
  con apto vencido, uno por vencer (≤ 30 días) y uno vigente, más un mayor de
  edad con un apto cargado igual (tiene que dar `not_required` sin importar
  el apto).
- `setPaymentResponsible`: RPC atómica — dos llamadas concurrentes a distintos
  miembros del mismo grupo no deberían dejar dos responsables (índice único
  parcial + lo que gane la RPC).
- `confirmMedicalClearance` rechazando un `path` con prefijo de OTRO
  `memberId`, y uno que no existe en Storage (mock o bucket real).
- Grants por columna: `updateMember` no puede escribir `status`/`joinedOn` ni
  aunque alguien lo intente pegándole a PostgREST directo (ya lo cubre S3,
  pero conviene un test de integración desde el modelo con claims reales de
  `editor`).
- Ningún log de `members.actions.ts`/modelos contiene DNI, nombre completo,
  domicilio, teléfono ni email — solo ids (revisar `log.ts` no se llama nunca
  con esos campos desde estos archivos; lo verifiqué a mano, no hay ningún
  `log.*` en estos seis archivos porque los errores no reconocidos se
  relanzan tal cual y los logea `toApiError` en `errors.ts`, que ya solo
  loguea el objeto de error, no datos que yo le agregue).

## Pedidos de schema al hilo principal

Ninguno. El schema de S3/S4 cubre todo lo que necesitaba tal cual está.

## Fuera de alcance (documentado, no implementado)

- `assignFamilyGroup` como action separada (ver "Decisión" arriba).
- Cuotas, pagos, deuda (`debt` se acepta y se ignora).
- Importación de CSV, exportación.
- Cualquier variante `(prevState, formData)`/`useActionState` de las actions.
