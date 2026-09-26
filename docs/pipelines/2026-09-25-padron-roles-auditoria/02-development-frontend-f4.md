# 02 — Desarrollo frontend: F4 (Ajustes)

Agente: `frontend-react-craftsman`. Tarea **F4** de `01-tasks.md`. Archivo propio
(no toco `02-development-backend-*.md` ni los `02-development-frontend-f1/f3.md`
de otros agentes).

## Alcance cubierto

`/ajustes` (solo admin): disciplinas con sus categorías como lista con
encabezados (no tarjetas anidadas), alta/edición en sheet desde abajo,
activar/desactivar con aviso de socios activos, reorden manual con
botones subir/bajar, sección "Datos del club". Estados vacío, cargando y
error. Sin nada de valores de cuota (slice 2).

## Archivos

Todos nuevos (el slice arrancó sin `views/settings/**` ni la ruta):

- `src/app/(panel)/(admin)/ajustes/page.tsx` — Server Component, llama a
  `getSettingsPage()` (B3) y renderiza `SettingsPageView`. Cero imports de
  `@supabase/*` (CLAUDE.md).
- `src/app/(panel)/(admin)/ajustes/loading.tsx` — skeleton vía `LoadingList`
  dentro de los mismos `Panel` que la página real (Suspense automático de
  Next para el segmento mientras resuelve `getSettingsPage()`).
- `src/app/(panel)/(admin)/ajustes/error.tsx` — boundary de error de la ruta.
  Client Component obligatorio de Next: **no puede importar `@/lib/log`**
  (`server-only`) — lo intenté primero y rompía el build; el error de
  servidor ya queda logueado del lado del servidor antes de llegar acá.
  Mensaje genérico + "Reintentar" (`reset()`).
- `src/views/settings/settings-page-view.tsx` — orquestador, Server
  Component (cero estado, cero `'use client'`): arma `PageHeader` + dos
  `Panel` hermanos (nunca anidados) — "Disciplinas y categorías" y "Datos
  del club" — y el `EmptyState` cuando no hay ninguna disciplina.
- `src/views/settings/discipline-group.tsx` — `'use client'`. Una
  disciplina: encabezado (nombre, `StatusPill`, subir/bajar, menú
  Editar/Activar-Desactivar) + `<ul>` de `CategoryRow` + "Nueva categoría".
- `src/views/settings/category-row.tsx` — `'use client'`. Misma lógica que
  `DisciplineGroup` para una categoría, con el aviso de socios activos al
  desactivar.
- `src/views/settings/discipline-form-sheet.tsx` /
  `src/views/settings/category-form-sheet.tsx` — `'use client'`. Sheet desde
  abajo (`side="bottom"`) para crear/editar, según si reciben `discipline`/
  `category` o no. Controlados desde afuera (`open`/`onOpenChange`).
- `src/views/settings/confirm-toggle-dialog.tsx` — `'use client'`.
  Confirmación simple (sin motivo) para desactivar; ver "Decisiones" abajo.
- `src/views/settings/new-discipline-button.tsx` — `'use client'`. Botón +
  sheet de alta, autocontenido (no anidado en ningún menú). Se reusa como
  acción del `Panel` y como acción del `EmptyState` (con `label` distinto:
  "Nueva disciplina" / "Cargar disciplina").
- `src/views/settings/club-settings-form.tsx` — `'use client'`. Formulario
  de `clubName` con RHF + Zod.

No toqué nada fuera de `src/app/(panel)/(admin)/ajustes/**` y
`src/views/settings/**`, como pedía el lane.

## Contratos consumidos (no editados)

- `src/models/types.ts`: `Discipline`, `Category`, `DisciplineWithCategories`,
  `Settings`.
- `src/controllers/settings.controller.ts`: `getSettingsPage()` (B3) — trae
  `{ settings, disciplines }` con `includeInactive: true`.
- `src/controllers/settings.actions.ts` (B3): `createDiscipline`,
  `updateDiscipline`, `setDisciplineActive`, `reorderDisciplines`,
  `createCategory`, `updateCategory`, `setCategoryActive`,
  `reorderCategories`, `updateSettings`. Firmas exactas, sin cambios de mi
  parte. Ninguna de estas actions tiene la firma `(prevState, formData)` de
  `useActionState` (a diferencia de `signIn`/`changePassword` de B1) — se
  llaman directo (`await action(...)`) con `useState`/`useTransition` local
  para `pending`, igual que el patrón que F1 ya usa en `ReasonDialog`.
- `src/views/shared/`: `PageHeader`, `Panel`, `EmptyState`, `LoadingList`,
  `ErrorState`, `StatusPill`, `TextField` (de `form-fields.tsx`).
- **Atendí el bug de RSC documentado por F1** (nunca pasar una función —
  ej. un `LucideIcon`— de Server a Client Component): todos mis Client
  Components reciben `Discipline`/`Category`/`Settings`/arrays de `number`
  como props, nunca un ícono ni un callback definido en un Server Component.

## Decisiones de diseño y trade-offs

### Estructura: lista con encabezados, no tarjetas anidadas

Un solo `Panel` ("Disciplinas y categorías") contiene un `<ul aria-label="Disciplinas">`
con un `<li>` por disciplina (`DisciplineGroup`); cada uno tiene su propio
`<h3>` + `<ul aria-label="Categorías de {nombre}">` anidado semánticamente
(no visualmente como tarjeta: sin borde ni fondo propio, solo un
`border-l border-border` de 1px para indicar jerarquía — permitido por el
piso de calidad, que prohíbe un `border-left` de más de 1px, no cualquiera).
Separación entre disciplinas con `divide-y divide-border` del `<ul>` padre.
Jerarquía de encabezados sin saltos: `h1` (Ajustes) → `h2` (título de cada
`Panel`) → `h3` (nombre de disciplina). Las categorías son `<span>`, no
encabezados: son filas, no secciones.

### Reorden: subir/bajar, sin drag and drop

`reorderDisciplines`/`reorderCategories` reciben el array COMPLETO de ids en
el nuevo orden (`sort_order` = índice). Cada fila recibe `siblingIds` (el
orden actual completo de sus hermanas) y `position`; al tocar
subir/bajar arma el array con esa posición intercambiada y llama a la
action. Deshabilito el botón en el extremo correspondiente (`disabled` +
`aria-label` explícito, ej. "Subir 6ta"). Sin optimistic UI: tras
`revalidatePath('/ajustes')` (B3) el Server Component se re-renderiza con
el orden fresco — con 3 disciplinas y ~12 categorías la latencia es
imperceptible, verificado en el browser (ver "Verificación").

### Confirmación de desactivar: diálogo propio, no `ReasonDialog`

`setDisciplineActive`/`setCategoryActive` no reciben motivo (firma
`(id, isActive)`), a diferencia de la baja de un socio (F2) que sí lo pide.
Usar `ReasonDialog` (F1) hubiera sido forzar un campo que el backend no
acepta y que el brief no pide ("sin confirmaciones para renombrar; sí para
desactivar" — no dice "con motivo"). Armé `ConfirmToggleDialog`
**dentro de `views/settings/`** (no en `views/shared/`, mi lane no incluye
esa carpeta): confirmación simple con `AlertDialog`, mismo patrón que el
"Cerrar sesión" de `UserMenu` (F1) — vive **fuera** del árbol del
`DropdownMenu` que lo dispara, por la misma razón que documentó F1: Radix
desmonta el menú al cerrarse y se llevaría un diálogo hijo con él antes de
que se vea. Actué solo para **desactivar**; **activar** no pide
confirmación y llama a la action directo (coherente con "sin confirmaciones
para renombrar", que leo como "sin fricción para lo reversible/no
destructivo").

**Seguimiento para el hilo principal / F3**: este patrón de confirmación
simple (sin motivo) es genuinamente reusable — F3 probablemente lo necesita
para "activar/desactivar usuario" y "cambiar rol". No lo puse en
`views/shared/` porque mi lane no incluye esa carpeta («Tus archivos
(exclusivos): `.../ajustes/**` y `views/settings/**`»); si F3 ya no resolvió
esto por su cuenta, valdría promover `ConfirmToggleDialog` a
`views/shared/confirm-dialog.tsx` en una pasada de integración.

### Aviso de socios activos al desactivar una categoría

`setCategoryActive(id, false)` devuelve `{ category, activeMemberCount }` —
el conteo se conoce recién DESPUÉS de ejecutar la baja, no antes (el modelo
no expone un "preview"). Por eso el flujo es: confirmar (sin saber el
número todavía) → ejecutar → mostrar el número en un toast
(`sonner`, `toast.success('Categoría desactivada', { description: 'Tiene N
socios activos hoy.' })`, con `Intl.NumberFormat('es-AR')` para el número).
No impide la baja en ningún momento (spec explícito, y B3 confirma que es
una decisión de la Comisión, pregunta abierta C6). Verificado contra la
base local: la categoría `5ta` (1 socio activo en el seed) mostró
exactamente "Tiene 1 socio activo hoy." al desactivarla y "Categoría
activada" (sin aviso) al reactivarla.

### "Datos del club": solo `clubName` editable

`updateSettingsSchema` (B3) exige **los dos campos siempre**
(`clubName` + `billingStartPeriod`, sin patch parcial). El spec de F4 pide
mostrar únicamente "Datos del club con `club_name`" — nada de valores de
cuota en este slice. En vez de pedirle a B3 un cambio de contrato (que su
dev log ya ofrecía: "si F4 prefiere patch parcial, avisen"), reenvío
`billingStartPeriod` tal cual viene de `settings` (sin exponer un control
para editarlo) junto con el `clubName` nuevo. Resuelve el requisito sin
tocar el backend ni inventar un campo/botón sin función para algo que
"llega en el slice 2, sin botón muerto". El botón "Guardar cambios" se
deshabilita cuando `form.formState.isDirty` es falso (para no permitir un
submit sin cambios) — funciona al cargar la página y al guardar
exitosamente (`form.reset(values)` después del éxito vuelve a marcarlo
`disabled`). **Nota menor de RHF observada en el browser**: si se escribe
un carácter y se borra manualmente hasta volver al valor original,
`isDirty` puede quedar en `true` (RHF no siempre recalcula el dirty-set
byte a byte en cada tecla) — no es un bug funcional (guardar reenvía el
mismo valor, operación idempotente), solo una imprecisión cosmética del
gating, documentada acá por si el reviewer la nota.

### Sin "Valores de cuota" ni botón muerto

El spec dice literalmente "sin botón muerto" para lo que llega en el slice
2. No agregué ningún panel, sección ni botón deshabilitado apuntando a
valores de cuota: directamente no existe en esta página todavía. Se agrega
cuando el slice 2 lo necesite.

### `autoFocus` retirado de los sheets (web-design-guidelines)

Primera versión tenía `autoFocus` en el campo "Nombre" de ambos sheets.
`web-design-guidelines` (corrido antes de cerrar, ver más abajo) marca
"`autoFocus` sparingly — desktop only, single primary input; avoid on
mobile": forzar el teclado apenas sube el sheet es brusco en un celular
(que es el dispositivo de referencia acá — CLAUDE.md, "la sede no tiene
computadora fija, tiene un celular"). Lo saqué y verifiqué en el browser
que Radix igual mueve el foco al campo al abrir el sheet (su manejo de foco
de diálogo/hoja no depende de mi `autoFocus`): tipeé texto inmediatamente
después de abrir "Nueva disciplina" sin clickear el input y quedó en el
campo correcto.

## Comportamientos visibles, estados y expectativas de a11y (spec del test-engineer)

Organizado por criterio de aceptación de F4 (`01-tasks.md`):

- **Listado de disciplinas y categorías**: `/ajustes` muestra cada
  disciplina con su `StatusPill` ("Activa"/"Inactiva") y, debajo, sus
  categorías con la misma pill; disciplinas y categorías inactivas
  **también se listan** (a diferencia de los selects del padrón) porque el
  admin tiene que poder reactivarlas. Orden: `sort_order`, luego nombre.
- **Alta de disciplina**: botón "Nueva disciplina" (acción del `Panel`, o
  "Cargar disciplina" en el `EmptyState` cuando no hay ninguna) abre un
  sheet desde abajo con un campo "Nombre"; error inline si < 2 caracteres
  (client-side, Zod) o si el nombre ya existe case-insensitive (mensaje del
  servidor, `DomainError.field: 'name'`, pintado con `form.setError` +
  `form.setFocus`); éxito → toast "Disciplina creada", sheet se cierra,
  lista actualizada (revalidación del servidor).
- **Edición de disciplina/categoría**: menú de tres puntos → "Editar" abre
  el mismo sheet precargado con el nombre actual; **sin confirmación**
  adicional para guardar (spec explícito); mismos errores inline que el
  alta; éxito → toast "Disciplina/Categoría actualizada".
- **Activar/desactivar**: menú → "Desactivar" (solo si está activa, ítem en
  rojo) abre `ConfirmToggleDialog` con la consecuencia explícita ("Deja de
  aparecer para altas nuevas del padrón... Los socios ya cargados no se ven
  afectados"); confirmar ejecuta la baja y muestra el aviso de socios
  activos si corresponde (categorías). "Activar" (solo si está inactiva) NO
  pide confirmación, ejecuta directo. Nunca se usa la palabra "eliminar" ni
  "borrar" en ningún texto.
- **Reorden**: botones subir/bajar (`ChevronUp`/`ChevronDown`) en cada fila
  de disciplina y de categoría; deshabilitados en los extremos
  (`aria-label` describe qué fila se mueve, ej. "Bajar 6ta"); el orden
  nuevo se refleja tras la revalidación del servidor (sin drag and drop,
  como pide el spec).
- **Nueva categoría**: botón al pie de cada disciplina, abre el sheet de
  categoría con `disciplineId` fijo (no seleccionable — la categoría nace
  dentro de esa disciplina).
- **Datos del club**: formulario de una sola línea (`clubName`); botón
  "Guardar cambios" deshabilitado hasta que el campo cambie; error inline
  si < 2 caracteres; éxito → toast "Datos del club actualizados".
- **Estados vacío/cargando/error**: `EmptyState` "Cargá la primera
  disciplina" (con acción) cuando `disciplines.length === 0` — no
  verificado con datos reales (el seed local trae 3 disciplinas, ver
  "Deferido"), sí verificado por lectura de código y tipos; `loading.tsx`
  (skeleton, no spinner suelto) mientras resuelve `getSettingsPage()`;
  `error.tsx` con mensaje genérico + "Reintentar" (`reset()`) si el
  controller tira.
- **A11y transversal**: todo ícono decorativo con `aria-hidden`; botones de
  ícono con `aria-label` explícito y nombrando la fila afectada; targets de
  44px (`size-11` en los botones de acción de fila, overrideando el
  `icon-lg` de 36px del design system); `<ul>`/`<li>` semánticos con
  `aria-label` describiendo el contenido; foco visible heredado de los
  componentes shadcn (sin overrides); errores de formulario con
  `aria-invalid`+`aria-describedby` (heredado de `TextField`); el
  `DropdownMenuItem` de "Desactivar" usa `variant="destructive"` (color +
  texto, nunca solo color); confirmación de "Desactivar" nombra la
  consecuencia real, nunca dice "eliminar"; `autoFocus` retirado de los
  sheets (mobile-first, ver "Decisiones").

## Verificación en el browser real

`npm run dev` contra el stack local (`npx supabase status` arriba, F1/B3 ya
habían corrido las migraciones S1/S2 con el seed: 3 disciplinas, 12
categorías). Login `admin@lonqui.test` / `lonqui-dev-1234`. Probado y
confirmado funcionando, de punta a punta contra Postgres real:

1. Listado completo de las 3 disciplinas (Fútbol masculino con 6
   categorías, Fútbol femenino, Vóley con 4 categorías) con sus `StatusPill`.
2. Menú de tres puntos por fila → "Editar"/"Desactivar" (o "Activar").
3. **Desactivar categoría "5ta"** (tiene 1 socio activo en el seed) →
   confirmación → toast "Categoría desactivada — Tiene 1 socio activo hoy."
   → pill pasa a "Inactiva" → menú ahora ofrece "Activar" → reactivada sin
   confirmación → toast "Categoría activada", estado restaurado.
4. **Reorden**: bajar "6ta" (swap con "7ma"), confirmado visualmente, y
   subir de vuelta para restaurar el orden original del seed.
5. **Editar categoría**: sheet precargado con "6ta"; probé nombre
   duplicado ("7ma") → error inline exacto del backend ("Ya existe una
   categoría con ese nombre"); corregido a "6ta" → guardado, toast
   "Categoría actualizada".
6. **Nueva disciplina**: sheet abre con foco en el campo (sin `autoFocus`
   explícito, foco de Radix); nombre de 1 carácter → error client-side
   ("El nombre tiene que tener al menos 2 caracteres"); cancelado sin crear
   (no dejé datos de prueba permanentes en la base compartida — no hay
   forma de borrar una disciplina, solo desactivar, y otros agentes corren
   en paralelo contra el mismo Postgres local).
7. **Datos del club**: cambié el nombre a "... (test F4)", guardé (toast
   "Datos del club actualizados", botón vuelve a deshabilitarse), y lo
   restauré a "Club Social y Deportivo Naranja y Blanco" antes de terminar.
8. Sin errores de consola (`read_console_messages`, `onlyErrors: true`)
   tras recargar la página.
9. **Nota sobre el entorno de browser compartido**: en este pipeline varios
   agentes comparten el mismo grupo de pestañas de Chrome — encontré una
   pestaña ajena (`/usuarios`, con un formulario de alta de usuario de
   prueba abierto) que no toqué ni cerré. Cerré únicamente las pestañas que
   yo mismo creé.

## Capturas

`.impeccable/review/f4-ajustes-1440.jpg` (1440×767, escritorio: sidebar
lateral, panel completo con las 3 disciplinas visibles).

`.impeccable/review/f4-ajustes-390.jpg` — **nota de entorno**: el sandbox de
este `claude-in-chrome` no permitió `resize_window` por debajo de ~500-600px
(un piso del entorno, no de la app — confirmado también en las capturas
"390" que dejó F1, que en los metadatos del archivo miden 500×673, no
390×844 literal). La captura que dejo mide **606×729**, que ya cae por
debajo de los breakpoints `sm` (640px) y `md` (768px) de Tailwind usados en
esta vista, así que ejercita la misma rama de layout que un 390 real
(navegación inferior, sin sidebar, filas apiladas). La diferencia con un
390 real es solo de margen horizontal disponible; revisé a mano que los
encabezados de fila usan `flex-wrap` (no un layout rígido de una sola
línea) precisamente para tolerar ese ancho menor sin overflow. Si el
reviewer tiene acceso a un dispositivo/simulador real a 390px, vale la pena
una segunda pasada visual ahí.

## `npm run typecheck` / `lint` / `build`

Los tres en verde al cierre. `impeccable detect --json` corrido dos veces
(antes y después de la ronda de `web-design-guidelines`) sobre los 11
archivos del slice: `[]` las dos veces, sin hallazgos deterministas.

## Deferido / seguimiento

- **`EmptyState` de "Cargá la primera disciplina"**: no lo pude ejercer con
  datos reales porque el seed local ya trae 3 disciplinas y no hay forma de
  vaciarlas sin tocar la base (prohibido). Verificado por lectura de código
  (rama `disciplines.length === 0`) y tipos; el test-engineer puede
  cubrirlo con un fixture propio.
- **`ConfirmToggleDialog`**: candidato a promover a `views/shared/` para que
  F3 lo reuse en "activar/desactivar usuario" — no lo hice yo porque mi
  lane no incluye esa carpeta. Ver sección de decisiones.
- **`billingStartPeriod`**: sigue sin UI (correcto para este slice); el día
  que el slice 2 lo necesite, `ClubSettingsForm` es el lugar natural para
  agregar el campo (ya reenvía el valor actual, así que agregar el control
  es aditivo).
- **"Warn before unsaved changes" en los sheets**: no implementado, mismo
  criterio que F1 documentó para `ChangePasswordForm`/`ReasonDialog` (no hay
  guard de navegación nativo en App Router sin librería extra); los
  formularios acá son de un solo campo, riesgo bajo.
- **Captura a 390px real**: ver nota de entorno arriba — la más cercana
  lograda fue 606px.
