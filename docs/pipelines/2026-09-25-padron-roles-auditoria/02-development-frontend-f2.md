# 02 — Desarrollo frontend F2 (padrón: listado, ficha de ingreso, ficha del socio, baja/reactivación, grupo familiar, apto físico)

Agente: `frontend-react-craftsman`. Tarea **F2** de `01-tasks.md`. Este archivo es
mío (no toco `02-development-backend-*.md` ni los otros `02-development-frontend-*.md`).

## Archivos entregados

**`src/app/(panel)/socios/**`:**
- `page.tsx` — listado (`/socios`)
- `loading.tsx`, `error.tsx` — cubren también `/socios/nuevo` (Next hereda el
  boundary más cercano)
- `nuevo/page.tsx` — alta
- `[id]/page.tsx` — ficha del socio
- `[id]/editar/page.tsx` — edición
- `[id]/not-found.tsx`, `[id]/error.tsx`, `[id]/loading.tsx` — cubren también
  `/socios/[id]/editar`

**`src/views/members/**`:**
- `member-list-view.tsx` — vista del padrón (PageHeader, SearchInput,
  FilterBar, DataList, paginación)
- `members-pagination.tsx` — cliente, "Ver más"
- `medical-clearance-notice.tsx` — aviso compacto de apto físico para el listado
- `member-form.tsx` — formulario de alta y edición (un solo componente, dos modos)
- `member-detail-view.tsx` — composición de la ficha del socio
- `family-group-section.tsx` — cliente, panel de grupo familiar + responsable de pago
- `medical-clearance-section.tsx` — cliente, panel de apto físico + subida
- `member-status-actions.tsx` — cliente, baja/reactivación con `ReasonDialog`

No toqué `views/shared/**`, `views/shell/**`, backend, `supabase/**`, `tests/**`.

## Contratos consumidos (no editados)

- `src/controllers/members.controller.ts` (B2): `getPadron(filters)`,
  `getMemberPage(id)` — ambas `requireSession()`, sin rol específico.
- `src/controllers/members.actions.ts` (B2): `createMember`, `updateMember`,
  `withdrawMember`, `reactivateMember`, `createFamilyGroup`,
  `setPaymentResponsible`, `prepareMedicalClearanceUpload`,
  `confirmMedicalClearance`, `createMedicalClearance`,
  `updateMedicalClearance`. Todas reciben un objeto plano y devuelven
  `ActionResult<T>` (no `useActionState`), tal como documentó B2.
- `src/models/catalogs.model.ts` (B3): `listDisciplines({ includeInactive })`
  — llamado **directo desde las pages** (`/socios/nuevo`, `/socios/[id]/editar`,
  `/socios`), como indicó B3 en su dev log (lectura plana, sin wrapper de
  controller).
- `src/models/family-groups.model.ts` (B2): `listFamilyGroups()` — mismo
  criterio, llamado directo desde las pages.
- `src/lib/supabase/client.ts`, `src/lib/dates.ts`, `src/lib/errors.ts`
  (`isDomainError`) — lectura, sin editar.
- Primitivas de F1: `PageHeader`, `Panel`, `DataList`, `SearchInput`,
  `FilterBar`, `Pagination`, `StatusPill`/`MemberStatusPill`, `EmptyState`/
  `ErrorState`/`LoadingList`, `ReasonDialog`, `FormField*`
  (`TextField`/`PasswordField`/`TextareaField`/`SelectField`/`CheckboxField`/
  `DateField`/`PhoneField`/`DniField`), `Dni`, `DateText`/`DateTimeText`,
  `WhatsAppLink`, `labels.ts`. Usadas tal cual — ninguna faltó.

## Primitivas que faltaron (ninguna bloqueante)

No pedí ninguna primitiva nueva a `views/shared/`. Dos cosas que sí faltaron
y resolví localmente, documentadas para que quede claro por qué no están en
`shared/`:

- **Barra de progreso de subida real (por bytes).** `supabase-js`
  (`storage-js` 2.x, confirmado con Context7) implementa `uploadToSignedUrl`
  sobre `fetch`, que no expone eventos de progreso — solo XHR los tiene. Hice
  un progreso **por etapas** (`compressing` → `uploading` → `saving`, cada una
  con su texto y un spinner), no un porcentaje. Si se necesitara progreso real
  por bytes habría que reemplazar `uploadToSignedUrl` por un `XMLHttpRequest`
  manual contra la `signedUrl` — no lo hice porque no está pedido
  explícitamente y duplica lo que ya hace la librería.
- **Badge de apto físico específico del dominio**
  (`medical-clearance-notice.tsx`). Es un componente chico pero acoplado al
  vocabulario de `MedicalClearanceStatus`; lo dejé en `views/members/` (no en
  `shared/`) porque solo lo usan estas dos pantallas (listado y, en una forma
  distinta y más completa, la ficha) — no es un primitivo de propósito
  general como `StatusPill`.

## Decisiones de diseño

### `/socios`: "Ver más" sin una Server Action de lectura nueva

`members.actions.ts` (B2) solo expone **mutaciones** (`'use server'`); la
lectura del padrón es `getPadron` del **controller**, `server-only`, no
llamable desde un Client Component. Pedir una nueva Server Action de lectura
hubiera sido tocar un archivo de B2 (fuera de mi lane) o pedirlo como
dependencia cruzada — en vez de eso, la paginación por cursor se resuelve
**enteramente en el servidor**: `page.tsx` lee `pages` de `searchParams`
(cuántas tandas mostrar) y encadena `getPadron` esa cantidad de veces,
acumulando el keyset internamente (`loadAccumulatedPage`). El único código
cliente es `MembersPagination`, que sube `pages` en la URL en cada click de
"Ver más" (usando el `Pagination` primitivo de F1 con `onLoadMore` ignorando
el cursor que le pasan, porque no lo necesita).

Costo: cada click re-pide desde la página 1 hasta la actual (`O(pages)`
round trips a Postgres), acotado por `MAX_ACCUMULATED_PAGES = 40` y
`LIST_PAGE_SIZE = 50` — con el máximo contractual de 1.000 socios activos son
como mucho 20 tandas reales. A la escala real del club (200–250 socios) esto
es irrelevante.

**Quirk conocido, no bloqueante:** `FilterBar`/`SearchInput` (F1) limpian el
param `cursor` al cambiar un filtro, pero no conocen mi param `pages` (no lo
podían conocer, es mío). Si alguien clickeó "Ver más" varias veces y después
cambia un filtro, `pages` queda con el valor viejo: la próxima carga trae de
entrada varias tandas del nuevo filtro en vez de una sola. Nunca es
**incorrecto** (nunca faltan ni sobran filas mal filtradas, nunca hay error),
solo puede traer de entrada más filas de las de una página — y con
`LIST_PAGE_SIZE=50` y categorías reales de ~15–20 socios, en la práctica el
loop corta enseguida porque `nextCursor` da `null` antes de agotar `pages`.
Documentado acá en vez de tocar `FilterBar`/`SearchInput` (no son míos).

### `/socios/nuevo` y `/socios/[id]/editar`: mismo `MemberForm`, sin modales

Un solo componente (`mode: 'create' | 'edit'`), sección por sección con
`Panel`s **hermanos** (nunca anidados): Datos personales, Tipo de socio
(disciplina→categoría condicionales), Grupo familiar, Fecha de alta (solo en
alta), Notas. El anti-objetivo del brief ("modales" en `/socios/nuevo`) se
respeta: crear un grupo familiar nuevo se resuelve con un **campo
condicional inline** (`familyGroupChoice === '__new__'` revela 3 campos en el
mismo formulario), no un modal — al enviar, si se eligió "crear grupo nuevo",
primero se llama `createFamilyGroup` y recién con el id resultante se llama
`createMember`/`updateMember`.

**Zod en el cliente, duplicado a propósito.** El schema real vive en
`members.model.ts` (B2, `server-only`, no importable desde un Client
Component). Escribí un schema propio en `member-form.tsx` que refleja las
mismas reglas de coherencia (DNI/pendiente, practicante/categoría, fechas no
futuras) para dar el error sin ida y vuelta al servidor — la autoridad real
sigue siendo el servidor, y los errores de `DomainError.field` que vuelven
(p. ej. "Ya hay un socio con ese DNI") se inyectan con `form.setError` +
`form.setFocus` igual que en `login-form.tsx`/`change-password-form.tsx` (F1).

**Gap conocido: sin link a la ficha del socio con el DNI duplicado.**
El brief pide "DNI duplicado se dice en el campo... con link a esa ficha".
El `ActionResult` de `createMember`/`updateMember` (B2) solo trae
`{ error, field }`, no el id del socio existente con ese DNI. Muestro el
mensaje ("Ya hay un socio con ese DNI") pero no puedo armar el link sin ese
dato. Si se quiere ese link, es un cambio en `members.actions.ts`/`.model.ts`
(B2) para que la `DomainError` lleve el id, o una búsqueda adicional en el
cliente por DNI (que hoy no tiene una lectura expuesta para eso). Reportado
como dependencia cruzada, no implementado.

**Bug real encontrado y corregido: React Strict Mode rompe el guard de
"primer render" al precargar la categoría en edición.** Mi primer intento
para "no perder la categoría precargada cuando `disciplineId` llega con
valor inicial en edición" usaba un flag booleano (`useRef(true)`, puesto en
`false` dentro del propio effect). Funciona con un solo montaje, pero Next
en desarrollo corre con **React Strict Mode** (default `true`), que
**invoca los effects de montaje dos veces** a propósito para exponer efectos
impuros. La primera invocación pone el flag en `false` y no limpia; la
**segunda invocación** ya encuentra el flag en `false` y SÍ limpia
`categoryId` — vaciando el select justo después de cargar la página de
edición. Lo reproduje en el browser real: `/socios/[id]/editar` con un socio
practicante mostraba "Categoría: Elegí una categoría" en vez de la categoría
real. La solución correcta es comparar contra el **valor anterior guardado
en un ref** (inicializado con el valor actual, no con un booleano):

```tsx
const previousDisciplineId = useRef(disciplineId)
useEffect(() => {
  if (previousDisciplineId.current !== disciplineId) {
    form.setValue('categoryId', '')
    previousDisciplineId.current = disciplineId
  }
}, [disciplineId])
```

Esta comparación da lo mismo sin importar cuántas veces Strict Mode repita el
effect (primera y segunda invocación comparan `disciplineId` contra sí mismo
→ no limpia), y sigue funcionando correctamente cuando el usuario cambia de
verdad la disciplina. Verificado en el browser después del fix: la categoría
precargada ("Juveniles") se mantiene al abrir `/socios/[id]/editar`.
**Para quien toque `member-form.tsx` después:** un flag `useRef(true)` +
"ponelo en `false` la primera vez que corre el effect" NO es un guard válido
contra el doble-invoke de Strict Mode — comparar contra un valor guardado sí.

### Ficha del socio: piezas cliente chicas, nunca toda la página

`member-detail-view.tsx` es Server Component (cero data fetching, recibe
`MemberDetail` + `role` ya resueltos). Client Components solo donde hace
falta interacción:
- `MemberStatusActions` — baja/reactivación, envuelve `ReasonDialog` (F1) con
  el consequence text exacto del brief para la baja
  ("Deja de generar cuota desde el mes siguiente. La ficha queda en el
  sistema.") y uno análogo para la reactivación (no está en el brief textual,
  lo redacté en el mismo tono).
- `FamilyGroupSection` — lista de integrantes con `setPaymentResponsible`
  (RPC atómica de B2) por fila; sin grupo, un texto con link a "Editar" (ahí
  se asigna, no hay action separada — decisión de B2 documentada en su dev
  log).
- `MedicalClearanceSection` — estado + "Ver certificado" (URL firmada ya
  resuelta por el controller) + formulario de subida **inline** (no modal:
  `operate.md`, "exhaust inline / progressive alternatives first" — reservé
  el único modal permitido, `ReasonDialog`, para baja/reactivación).

Botones de baja/reactivación con `variant="outline"` (nunca rojo prominente,
como pide el brief); "Editar" también `outline`. Ninguna palabra "eliminar"
en ningún lado del slice.

### Apto físico: compresión de imagen y subida directa a Storage

Flujo con archivo: `maybeCompressImage` (canvas, solo si es imagen y pesa
> 2 MB, reescala a máx. 1600px de lado mayor, recodifica a JPEG calidad 0.82)
→ `prepareMedicalClearanceUpload` (Server Action, arma la ruta y la URL
firmada) → `supabase.storage.from('attachments').uploadToSignedUrl(path,
token, file)` **desde el browser** con el cliente de sesión
(`lib/supabase/client.ts`, ya existente) → `confirmMedicalClearance` (Server
Action, valida prefijo + existencia real en Storage). Sin archivo:
`createMedicalClearance` directo (el caso "vieron el papel, cargan solo la
fecha").

**Duplicación necesaria y documentada:** `medical-clearances.model.ts` (B2)
tiene `import 'server-only'` — no se puede importar `MAX_ATTACHMENT_SIZE_BYTES`
ni la lista de MIME permitidos desde un Client Component. Re-declaré esos
valores en `medical-clearance-section.tsx` con un comentario explícito que
dice que tienen que seguir coincidiendo con el bucket `attachments` (S4) si
alguna vez cambian.

"Tomar foto" / "Elegir archivo" son dos `<input type="file">` **ocultos**
(`className="hidden"`, nunca `sr-only` — no deben ser un tab-stop propio,
el botón visible es el control accesible real) disparados por dos botones
con texto visible (no icon-only).

## Verificación en el browser real (admin, `editor@lonqui.test`, `consulta@lonqui.test`)

Usuarios de prueba creados en la base local (inventados, no reales — insertados
directo en `auth.users`/`auth.identities`/`app_users` como pide la tarea, sin
tocar migraciones ni resetear la base):

| Email | Password | Rol |
|---|---|---|
| `editor@lonqui.test` | `lonqui-dev-1234` | `editor` |
| `consulta@lonqui.test` | `lonqui-dev-1234` | `consulta` |

(`admin@lonqui.test` / `lonqui-dev-1234` ya existía, documentado por F1.)

**Advertencia real sobre el entorno compartido:** el browser de
`claude-in-chrome` es **una sola sesión de Chrome compartida entre los
agentes que corren en paralelo** (F2, F3, F4). Durante la verificación
encontré, más de una vez, que mi sesión de login cambiaba sola (de `editor` a
`consulta`, o de vuelta a `admin`) sin que yo hiciera nada — porque otro
agente estaba logueándose con SU usuario de prueba en SU pestaña, pero las
cookies de sesión son del mismo perfil de browser y pisan la sesión activa
para *todas* las pestañas. También encontré mi propio `editor@lonqui.test`
con el rol cambiado a `consulta` en la base a mitad de la verificación —
otro agente debe haber estado probando `changeUserRole` contra mi usuario de
prueba. Lo corregí (`UPDATE app_users SET role = 'editor' ...`) y seguí. Para
quien repita esto: **usar una pestaña/ventana nueva no alcanza para
aislarse** (mismo perfil = mismas cookies); lo que sí ayudó fue cerrar mi
grupo de pestañas y crear uno nuevo (`tabs_close_mcp` + `tabs_context_mcp`),
que a veces (no siempre) abre una ventana de verdad separada. Dejé
`editor@lonqui.test` y `consulta@lonqui.test` en un estado limpio al
terminar (rol correcto, `must_change_password = false`, `is_active = true`).

### Confirmado funcionando (admin)

1. `/socios`: listado con datos del seed real, filtros con placeholders
   correctos ("Activos", "Todas las categorías", etc.), aviso "Falta cargar"/
   "Vencido" en rojo con ícono para menores con apto físico problemático.
2. `/socios/nuevo`: alta completa de un socio practicante (Fútbol femenino →
   Juveniles), con `dniPending` marcado — **creado (`id=12`), redirige a la
   ficha con toast "Ficha creada"**, categoría y edad ("11 años · menor")
   correctas en el encabezado.
3. `/socios/[id]/editar`: formulario precargado (incluido el bug de Strict
   Mode de arriba, ya corregido) — **guardado con toast "Cambios guardados"**,
   vuelve a la ficha.
4. `/socios/[id]`: apto físico — cargué un apto **sin archivo** (fecha
   01/06/2027) sobre un socio con "Falta cargar": pasó a "Vigente · Vence
   01/06/2027" con toast "Apto físico actualizado" (confirma el flujo
   `createMedicalClearance`; no probé la subida con archivo real por no tener
   un archivo de prueba a mano en el entorno del browser, pero el código del
   flujo con archivo usa las mismas tres Server Actions ya verificadas
   individualmente por B2 contra la base real).
5. `/socios/[id]`: **baja completa** — validación inline del motivo vacío
   ("Contá el motivo (al menos 3 caracteres)"), confirmé con motivo válido →
   `StatusPill` pasa a "Dado de baja", botón cambia a "Reactivar", toast
   "Socio dado de baja". **Reactivación completa** después → vuelve a
   "Activo", toast "Socio reactivado". La sección "Historia" muestra los dos
   eventos nuevos (más el alta original) en orden **más reciente primero**,
   con el actor correcto ("Admin de desarrollo") y fecha/hora exactas.
6. DNI duplicado: intenté crear un socio con el DNI de "Ejemplo, Lucía"
   (`30111222`) → error inline en el campo DNI ("Ya hay un socio con ese
   DNI"), foco automático en el campo, formulario no se envía.

### Confirmado por rol

- **`editor`**: nav solo Inicio/Socios (sin Usuarios/Ajustes/Auditoría);
  `/usuarios` → `AccessDenied` ("No tenés permiso para ver esto"); `/socios`
  muestra "Ficha de ingreso"; `/socios/nuevo` muestra el formulario (no
  bloqueado); en la ficha de un socio ve "Editar" pero **no** ve
  "Dar de baja"/"Reactivar" (correcto: esas son solo `admin`).
- **`consulta`**: nav solo Inicio/Socios; `/socios` **no** muestra "Ficha de
  ingreso"; `/socios/nuevo` → `AccessDenied`; `/socios/[id]/editar` →
  `AccessDenied`; en la ficha de un socio no ve ningún botón de acción (ni
  "Editar" ni "Dar de baja"/"Reactivar") — de solo lectura como pide la
  matriz de roles.
- **`must_change_password` en navegación client-side entre rutas
  hermanas — pedido explícito de F1 para retomar su verificación pendiente.**
  Resultado: **reproduje el caso que F1 no pudo probar, y encontré que
  ROMPE.** Con una sesión de `consulta` ya en `/` (con el flag en `false`),
  cambié `must_change_password` a `true` directo en la base (simulando lo
  que haría "Restablecer contraseña" de un admin) **sin recargar el
  browser**, y clickeé "Socios" en la barra inferior (navegación
  client-side, sin `<a>` de recarga completa). El resultado fue `/socios`
  renderizado con la lista **vacía** (porque RLS le corta todo con el flag
  prendido) **en vez de** un redirect a `/cambiar-contrasena`. Confirmé con
  una consulta directa a la base en el mismo instante que el flag seguía en
  `true`, así que no fue una carrera de re-flip por otro agente. Esto
  contradice la lectura optimista de F1 ("el router cache de Next 15+ tiene
  `staleTime: 0` para segmentos dinámicos, así que cada navegación dispara
  una verificación fresca") — lo más probable es que el **prefetch** de
  `<Link>` (que Next dispara cuando el link entra en viewport, antes del
  click) haya cacheado la respuesta del layout **mientras el flag todavía
  era `false`**, y el click sirvió esa respuesta prefetched sin
  revalidar. **`(panel)/layout.tsx` es de F1** (fuera de mi lane); no lo
  toqué. Reporto el repro exacto para que el hilo principal/F1 lo investigue:
  la corrección probablemente pasa por desactivar el prefetch de los links
  de navegación del panel (`prefetch={false}` en `next/link`) o forzar
  `router.refresh()` en algún punto que invalide el prefetch cacheado — no
  lo decido yo, es su archivo.

## Accesibilidad

- Labels reales (`htmlFor`) en todos los campos (heredado de `FormField*`
  compartidos).
- `aria-describedby` en errores (heredado de los mismos primitivos).
- Foco al primer error: automático por `shouldFocusError` (default de
  `react-hook-form`) en fallos de validación de Zod cliente, y manual
  (`form.setFocus(field)`) para errores de `DomainError.field` que vuelven
  del servidor.
- Targets ≥ 44px: botones con `h-11` en las acciones principales (submit,
  Editar, Dar de baja/Reactivar, Cargar certificado); filas del `DataList`
  con `min-h-11` (heredado).
- Inputs de archivo ocultos con `className="hidden"` (no `sr-only`): no
  agregan un tab-stop redundante, el botón visible con texto es el control
  accesible real.
- Nunca la palabra "eliminar" en ningún string del slice.
- Sin gradientes de texto, sin `border-left` de color, sin sombras duras.
- `MedicalClearanceNotice`/estado del apto físico: siempre texto + ícono,
  nunca solo color (piso de calidad).
- `web-design-guidelines`: revisé checklist completo (fetch de
  `vercel-labs/web-interface-guidelines`) contra mis archivos — sin
  `<div onClick>`, sin `outline-none` sin reemplazo, sin `"..."` literal (todo
  "…" real), autocomplete correcto por campo, confirmación antes de
  baja/reactivación (`ReasonDialog`), estado en la URL (filtros, búsqueda,
  `pages`).
- **Gap heredado de F1, no implementado tampoco acá:** "avisar antes de
  navegar con cambios sin guardar" en `MemberForm`/`MedicalClearanceSection`
  — requiere un guard de navegación de App Router que no existe out-of-the-box
  sin una librería extra (F1 ya documentó esto como mejora futura, no
  bloqueante, para `ChangePasswordForm`/`ReasonDialog`; aplica igual acá).

## Spec para `test-engineer` (comportamientos, keyed a `01-tasks.md` F2)

- **`/socios`**: búsqueda por nombre/DNI con debounce 300ms, escribe/lee
  `?q=`; filtros `categoryId`/`disciplineId`/`memberType`/`status` en la URL;
  filtro `debt` presente y deshabilitado con tooltip "Disponible cuando se
  activen las cuotas"; por defecto `status` no seteado = solo activos;
  `status=inactive` o `status=all` los trae; fila con nombre, DNI (o "DNI
  pendiente"), categoría (o "No practicante" o "Sin categoría"), `StatusPill`,
  aviso de apto físico (solo si `expired`/`expiring`/`missing`, nunca para
  `valid`/`not_required`); "Ver más" (`?pages=N`) acumula sin duplicar ni
  saltear filas (keyset estable); estado vacío real ("Todavía no hay socios
  cargados", con acción "Cargar ficha de ingreso" solo si `role` es
  `admin`/`editor`); estado "sin resultados" con filtros activos (mensaje
  distinto, menciona el término buscado si había uno); botón "Ficha de
  ingreso" solo visible para `admin`/`editor`.
- **`/socios/nuevo`**: `dni` obligatorio salvo `dniPending` (excluyentes
  entre sí, error inline en ambos sentidos); `birthDate` no futura; tipo
  practicante exige categoría (disciplina→categoría dependientes, la
  categoría se limpia al cambiar de disciplina); grupo familiar: "Sin grupo"
  por defecto, elegir uno existente, o "Crear un grupo nuevo" (revela 3
  campos opcionales inline, sin modal) — al enviar arma el grupo antes que el
  socio; `joinedOn` obligatorio, hoy por defecto, no futuro; éxito redirige a
  `/socios/[id]` con toast "Ficha creada"; error de servidor (p. ej. DNI
  duplicado) inline en el campo correspondiente con foco automático; solo
  accesible a `admin`/`editor` (AccessDenied para `consulta`, verificado
  también navegando directo a la URL).
- **`/socios/[id]/editar`**: mismo formulario, sin `joinedOn` ni `status`
  editables (se muestran como texto: "Alta: DD/MM/AAAA · Estado: Activo");
  precarga todos los campos incluida la categoría de una disciplina ya
  elegida (regresión cubierta por el fix de Strict Mode de arriba); éxito
  redirige a la ficha con toast "Cambios guardados"; mismo control de rol que
  el alta.
- **`/socios/[id]`**: encabezado con nombre, `StatusPill`, categoría, edad y
  "menor" si aplica; "Datos personales" (DNI, fecha de nacimiento, domicilio,
  teléfono, email, alta) con botón WhatsApp solo si hay teléfono; "Grupo
  familiar" (sin grupo → texto con link a Editar; con grupo → integrantes con
  su `StatusPill`, badge "Responsable de pago", botón "Marcar como
  responsable" solo para miembros activos sin el flag y solo para
  `admin`/`editor`, aviso rojo si `missingResponsible`, contacto de pago con
  WhatsApp si hay teléfono); "Apto físico" (estado + vencimiento, "Ver
  certificado" abre la URL firmada en pestaña nueva solo si hay adjunto,
  "Cargar certificado" solo para `admin`/`editor` y solo si el estado no es
  `not_required`, formulario inline con fecha + tomar foto/elegir archivo,
  sin archivo guarda solo la fecha, error de tipo/tamaño con el límite dicho
  antes de intentar subir); "Historia" con los eventos más recientes primero,
  actor y fecha/hora; "Editar" (`admin`/`editor`) y "Dar de baja"/"Reactivar"
  (**solo `admin`**) con `ReasonDialog` (motivo ≥ 3 caracteres, fecha, la
  consecuencia exacta del brief para la baja); nunca "eliminar"; ficha
  inexistente (id válido pero sin fila) → estado "Esta ficha no existe" con
  link al padrón, vía `not-found.tsx`; error de red/servidor → estado con
  "Reintentar" (`error.tsx`); carga inicial con skeletons (`loading.tsx`).
- **A11y**: labels reales, `aria-describedby` en errores, foco al primer
  error (cliente y servidor), targets ≥ 44px en botones de acción, ningún
  input de archivo tabulable de más.
- **Bug de plataforma encontrado, no de mi código, para que quede en el
  radar del `code-reviewer`/hilo principal:** el caso de `must_change_password`
  cambiando a mitad de sesión y navegación client-side hacia `/socios` — ver
  sección de arriba. No es reproducible desde mis archivos (no toco sesión ni
  el layout), pero si el `test-engineer` quiere escribir un test de
  integración para esto, el repro exacto está documentado arriba.

## `npm run typecheck` / `lint` / `build`

Los tres en verde al cierre (`rm -rf .next` antes del build final). Un error
real de lint encontrado y corregido durante el desarrollo:
`react-hooks/error-boundaries` ("Avoid constructing JSX within try/catch") en
`/socios/[id]/page.tsx` y `/socios/[id]/editar/page.tsx` — el `try/catch`
solo puede envolver la llamada a datos (`getMemberPage`/`Promise.all`), el
JSX se construye **después**, fuera del bloque. Corregido en los dos
archivos.

`impeccable detect --json` corrido dos veces (antes y después del fix de
Strict Mode) sobre los 15 archivos del slice: `[]` las dos veces.

## Deferido / seguimiento

- Link a la ficha del socio con el DNI duplicado (necesita que
  `createMember`/`updateMember` o su `DomainError` expongan el id existente
  — cambio de B2, no mío).
- Progreso de subida por bytes (necesitaría XHR manual en vez de
  `uploadToSignedUrl`; no implementado, ver justificación arriba).
- "Avisar antes de salir con cambios sin guardar" (heredado como gap de F1,
  no bloqueante).
- **El bug de `must_change_password` + navegación client-side + prefetch de
  `<Link>`**: reproducido y documentado arriba con el repro exacto; la
  corrección vive en `(panel)/layout.tsx` o en cómo navega `nav-list.tsx`
  (ambos de F1), no en mis archivos.
- Quedó un socio de prueba en la base (`F2 Verificacion, Prueba`, id 12,
  Fútbol femenino · Juveniles) de la verificación de alta — dato inventado,
  igual que el resto del seed, no es información real.
