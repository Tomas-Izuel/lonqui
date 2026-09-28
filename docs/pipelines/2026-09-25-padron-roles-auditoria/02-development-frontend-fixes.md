# Fixes de finish review (frontend) — slice 1

Disposición del revisor: `fix`. Este archivo documenta los fixes materiales
aplicados sobre el slice 1 (padrón, roles, auditoría), en el orden de
prioridad del encargo. Escrito para un LLM sin memoria de esta corrida.

Verificación: `npm run typecheck`, `npm run lint`, `npm run build` en verde.
Capturas reales en `.impeccable/review/screens-fix/` (390×844 y 1440×900,
`npm run build && npx next start -p 3211` +
`BASE_URL=http://localhost:3211 node scripts/capture-screens.mjs --out
.impeccable/review/screens-fix`): el script confirma `overflow horizontal
... @390: 0px` en las 8 rutas del panel. `impeccable detect --json src/views
src/components/ui` solo reporta 1 hallazgo, preexistente y fuera de alcance
(ver "No tocado" al final).

## 1. `/usuarios` a 390px: título a ancho 0

**Antes:** `DataListRow.meta` vivía a la derecha de la fila, `shrink-0`, sin
tope de ancho. En `/usuarios` `meta` cargaba `RolePill` + `UserStatusBadges`
(pills `whitespace-nowrap`, algunas largas: "Debe cambiar la contraseña") +
el menú de acciones, todo apretado en esa columna fija. El título/subtítulo
(`min-w-0 flex-1`) se veía forzado a colapsar a 0 para que el bloque de la
derecha entrara.

**Causa real:** el bug es estructural de `DataList`, no de una vista: CUALQUIER
`meta` con contenido que no envuelve puede repetir esto en cualquier pantalla
futura.

**Fix (`src/views/shared/data-list.tsx`):** se dividió `DataListRow` en dos
slots con contratos distintos:
- `meta` (opcional): ahora vive DEBAJO del subtítulo, en la misma columna
  flexible que el título (`min-w-0 flex-1 flex-col`) — nunca al lado. Un badge
  que no envuelve compite por ancho contra el título si están en el mismo eje
  horizontal; en la misma columna vertical no compite, solo envuelve
  (`flex flex-wrap`) o cae debajo.
- `actions` (opcional, NUEVO campo): fijo a la derecha, `shrink-0`, pensado
  para un menú de fila (ícono/botón chico, ancho previsible). Es lo único que
  puede convivir con el título sin arriesgar empujarlo a 0.

Esto hace la fila estructuralmente segura: el título tiene prioridad real
(`min-w-0 flex-1` en la única columna que crece) y nada a su lado puede
forzarlo a 0, sin importar cuánto contenido traiga `meta`.

**Callsite (`src/views/users/users-view.tsx`):** `renderRow` ahora pasa
`meta: <RolePill/> + <UserStatusBadges/>` (debajo del email) y
`actions: actionsFor(u)` (el menú, a la derecha). Verificado en captura real
a 390px: nombre y email completos, rol/estado debajo, menú siempre visible a
la derecha.

**Impacto en otros consumers de `DataList`:** `MemberListView` y `AuditList`
también usaban `meta` (pill de estado + aviso de apto físico; fecha/hora). Con
el cambio estructural, ese contenido pasó de "a la derecha" a "debajo del
subtítulo" — verificado en capturas de `/socios` y `/auditoria`: se lee bien,
sin overflow, y es coherente con el patrón mobile-first de fila con badges
abajo (más común en Operate que un badge flotando a la derecha compitiendo
con el texto).

## 2. Targets ≥ 44px en móvil

- **`src/components/ui/input.tsx`** (línea 10): `h-8` (32px) → `h-11` (44px),
  flat, sin variante responsive. Se decidió flat (no `sm:h-9`) para no
  arriesgar un "leak" de altura reducida en desktop hacia consumidores que YA
  overridean con un `h-11`/`h-12` sin prefijo (`search-input.tsx`,
  `home-search.tsx` — este último explícitamente fuera de alcance, no se
  tocó): `cn`/tailwind-merge no colapsa un override plano contra un grupo con
  modificador (`sm:`) distinto, así que una base responsive hubiera dejado
  esos search inputs en 36px en desktop sin que nadie lo pidiera. Con `h-11`
  flat en la base, cualquier override existente sigue ganando exactamente
  igual que antes.
- **`src/components/ui/select.tsx`** (línea 46): `data-[size=default]:h-8` →
  `data-[size=default]:h-11`. `data-[size=sm]` no se tocó (no se usa en
  ninguna vista, verificado por grep).
- **`src/views/shared/filter-bar.tsx`** (línea 68): se sacó el
  `className="h-9"` del `SelectTrigger` — ahora hereda el `h-11` de la base.
- **`src/views/audit/audit-date-range-filter.tsx`**: mismo ajuste (sin
  override de alto) + fix de ancho, ver punto 3.
- **`src/views/members/family-group-section.tsx`** (línea ~100, "Marcar como
  responsable"): se agregó `h-11` al `className` del `Button size="sm"` —
  mismo patrón ya usado en `discipline-group.tsx` (`size="sm" className="...
  h-11 ..."`).
- **`src/views/shared/form-fields.tsx`** (ojo de mostrar/ocultar contraseña):
  `size="icon-sm"` (28px) → `size="icon-lg"` + `className="size-11"` (ninguna
  variante de tamaño de `Button` llega a 44px), reposicionado `right-0`
  (antes `right-1`) para que quede pegado al borde del input, que ahora
  también mide 44px de alto — encajan exactos. El `pr-10` del input pasó a
  `pr-12` para no tapar el texto con el botón más grande.
- **Checkbox "Todavía no tengo el DNI" (`CheckboxField`,
  `form-fields.tsx`):** antes el `<label>` (`FieldLabel`) envolvía solo el
  texto — clickear el checkbox de 16px o el texto lo togglea, pero el resto
  de la fila no. Se invirtió la composición: ahora `FieldLabel` (el
  `<label>`) envuelve el `Field` completo (checkbox + `FieldContent`), que es
  exactamente el patrón que las clases de `field.tsx` ya preveían
  (`has-[>[data-slot=field]]:rounded-lg border ... w-full`) — la fila entera
  queda como una caja bordeada, clickeable de punta a punta, con
  `min-h-11` explícito en el `Field` interno. `FieldLabel` (label semántico)
  reemplazó a `FieldLabel` anidado por `FieldTitle` (div, sin duplicar el
  `<label>`).
- **`src/views/shell/nav-list.tsx`** (línea 70, `MobileBottomNav`):
  `text-[11px]` (fuera de la escala, y lo marcó el hook de `impeccable` como
  `design-system-font-size`) → `text-xs` (12px, escalón real de Tailwind, ya
  usado en `StatusPill`/`Badge`/avisos en todo el repo). Verificado en
  captura real a 390px con las 5 etiquetas de `admin` (Inicio, Socios,
  Usuarios, Ajustes, Auditoría): entran sin truncar.

**Fuera de esta lista, no tocado:** el botón "Completar alta" en
`user-row-menu.tsx` (`size="sm" className="h-9"`, 36px) no estaba en el
encargo del revisor — se dejó como está para no exceder el alcance del
disposition `fix`. Si se considera material, es un fix de una línea idéntico
al de "Marcar como responsable".

## 3. Auditoría en el idioma del club

`AuditEntry.recordLabel` (poblado por un agente de backend en paralelo,
`src/models/types.ts`) ya existía en el tipo; esta vista no lo consumía
todavía. Se agregó a `src/views/audit/audit-labels.ts`:

- `RECORD_PHRASE`: un complemento por tabla con el nombre del registro
  ("a Ejemplo, Lucía", "la categoría Fútbol masculino · 5ta", "al usuario X"),
  para componer con el verbo de `auditOpLabels` ("Modificó a Ejemplo,
  Lucía").
- `auditRecordPhrase(tableName, recordLabel)`: arma esa frase; sin
  `recordLabel` (todavía `null`, o tabla sin nombre propio como `settings`)
  cae a `auditEntityLabel` genérico ("un socio") — **nunca** al id crudo.
- `auditRecordName(tableName, recordLabel)`: solo el nombre, sin
  preposición — para una columna de tabla que ya tiene su propio verbo al
  lado ("Operación").

`src/views/audit/audit-list.tsx`:
- Columna "Qué" (desktop): `auditRecordName(...)` en vez de
  `auditEntityLabel + " #" + recordId`. El id ya no aparece en el listado.
- Fila móvil: `subtitle` ahora compone
  `"<verbo> <auditRecordPhrase> · <campos traducidos>"`, ej. "Modificó a
  Ejemplo, Lucía · teléfono, domicilio" — verificado en captura real.
  `changedFields` ya se traducía con `auditFieldLabel` (existía desde antes
  de este pase; no hacía falta tocarlo, solo componerlo en la frase nueva).

`src/views/audit/audit-detail-sheet.tsx`: el título ahora usa
`auditRecordPhrase(entry.tableName, entry.recordLabel)` como fallback de
`eventType` (que sigue mandando cuando hay `newData.event_type` — es más
preciso: en el detalle SÍ hay `newData`, a diferencia del listado). El id
("registro #N") ya vivía en la `SheetDescription`, secundario — no hizo
falta tocarlo, ya cumplía el criterio del brief.

**Limitación conocida, documentada a propósito (no un fix silencioso):** en
`member_status_events`, el verbo específico ("Dio de baja", "Reactivó") solo
es derivable con `newData.event_type`, que el LISTADO no trae (por diseño:
`AuditEntry` no incluye `oldData`/`newData`, solo el detalle —
`AuditEntryDetail`— los trae, para no mover jsonb de más en cada página). Por
eso, en el LISTADO, un evento de `member_status_events` compone como
"Creó/Modificó un movimiento de alta o baja de `<recordLabel>`" — honesto con
los datos disponibles, no el "Dio de baja a …" literal del ejemplo del brief
(ese ejemplo SÍ se cumple en el detalle, donde `eventType` está disponible).
Si se quiere el verbo exacto también en el listado, hace falta que el
controller/modelo agregue `event_type` (o una frase ya compuesta) a
`AuditEntry` — cross-lane dependency, no se tocó `models/`.

**Rango de fechas (`audit-date-range-filter.tsx`):** los dos `<input
type="date">` con `w-[8.5rem]` (136px) fijo cortaban el valor
(`mm/dd/yyyy` necesita más espacio del que el navegador reserva con ese
ancho). Se cambió a `min-w-0 flex-1` en el contenedor `w-full sm:w-auto`: a
390px cada input toma la mitad del ancho disponible (bastante más que
136px); en `sm+` vuelve a un ancho fijo (`sm:w-36 sm:flex-none`, 144px,
suficiente para el date picker nativo con más aire que antes). Verificado en
captura real: `mm/dd/yyyy` completo en los dos inputs, lado a lado, sin
recorte.

## 4. Tarjeta anidada en `family-group-section.tsx`

El `<ul>` de miembros del grupo tenía `rounded-lg border border-border`
propio, dentro de un `Panel` que ya trae su propio borde — tarjeta anidada,
prohibida por el piso de calidad. Se sacó el borde/radio y se ajustó el
padding de las filas (`py-2 first:pt-0 last:pb-0`, sin `px-3` — el `Panel`
ya da `p-4`), mismo patrón que la sección "Historia" de
`member-detail-view.tsx`. Verificado en captura real: la lista de
integrantes ahora es divisores simples dentro del `Panel`, sin caja propia.

## 5. Aviso de apto físico ambiguo

`src/views/shared/labels.ts`, `medicalClearanceStatusLabels`: "Falta cargar"
→ "Falta apto físico"; "Vencido" → "Apto vencido"; "Por vencer" → "Apto por
vencer" (coherencia con las otras dos, mismo pedido del revisor). Usado por
`MedicalClearanceNotice` (aviso compacto del padrón) y
`MedicalClearanceSection` (estado en la ficha) — ningún otro archivo los
usaba (verificado por grep), no hizo falta tocar más lugares. Verificado en
captura real de `/socios`: "Falta apto físico" y "Apto vencido" en las filas
correspondientes.

## 6. Filtro de deuda deshabilitado

`src/views/shared/filter-bar.tsx`: se sacó el `Tooltip` (no se abre al
toque, brief lo señala explícito) que envolvía el select deshabilitado. Un
filtro con `disabledReason` ahora se renderiza con una etiqueta visible
arriba (`filter.label`, ej. "Deuda" — antes invisible, solo `aria-label`) y
el motivo como texto siempre visible debajo ("Disponible cuando se activen
las cuotas"), en vez de depender de hover/tooltip. Los filtros SIN
`disabledReason` no cambiaron (sin etiqueta visible, como antes — el
`placeholder` del select ya cumple ese rol cuando el control está habilitado
y su valor es explorable). Import de `Tooltip`/`TooltipContent`/
`TooltipTrigger` retirado del archivo (ya no se usa ahí). Verificado en
captura real de `/socios`, desktop y 390px.

## 7. "Ceiling" del revisor

- **`/socios` móvil, no repetir "Activo":** `member-list-view.tsx`, fila
  móvil: el pill de estado ahora solo se muestra si el filtro activo es
  "Dados de baja" o "Todos" (`filters.status === 'inactive' | 'all'`), o si
  la fila puntual está de baja (defensivo, por si aparece bajo el filtro por
  defecto). Bajo el filtro por defecto ("Activos"), ninguna fila activa
  repite el pill — verificado en captura real. La tabla de escritorio no se
  tocó (no estaba en el pedido, y ahí la repetición cuesta menos que en una
  fila angosta de 390px).
- **`/ajustes` móvil, encabezado apachurrado:** `src/views/shared/panel.tsx`,
  el `<header>` de `Panel` pasó de `flex items-start justify-between` (una
  sola fila siempre) a `flex flex-col gap-3 sm:flex-row sm:items-start
  sm:justify-between` — mismo patrón que `PageHeader`. Título y acción
  apilan en móvil, vuelven a la fila en `sm+`. Es un cambio en un primitivo
  compartido (`Panel`), así que aplica a TODOS los paneles con `action`, no
  solo a "Disciplinas y categorías" — es la misma regla que ya regía
  `PageHeader`, extendida a su análogo de sección. Verificado en captura
  real de `/ajustes` a 390px: "Nueva disciplina" ya no se aplasta contra el
  título.

## No tocado (fuera de alcance de este pase)

- `src/app/(panel)/page.tsx`, `src/views/shell/home-search.tsx`: explícito
  en el encargo, el panel inicial se rediseña en otro pipeline.
- `src/components/ui/button.tsx:26` (`text-[0.8rem]` en `size="sm"`):
  único hallazgo restante de `impeccable detect`, preexistente (no forma
  parte de los archivos tocados en este pase) y no estaba en la lista del
  revisor — se deja como está, señalado acá para que quede a la vista de
  quien decida si merece su propio fix.
- "Completar alta" (`user-row-menu.tsx`, `h-9`/36px): ver nota en el punto 2.
- `DESIGN.md`: no se actualizó la nota que documentaba "11px deliberado" para
  la navegación inferior (fix 2) ni el resto de las decisiones tocadas acá —
  es un derivado que se re-emite desde lo construido; queda para quien
  regenere ese documento.
- Backend/`models`/`supabase/**`/`tests/**`: no tocados, según instrucción.

## Verificación final

```
npm run typecheck   # verde
npm run lint        # verde
npm run build        # verde
node .../impeccable detect --json src/views src/components/ui
  # 1 hallazgo, preexistente (button.tsx:26), ver "No tocado"
npm run build && npx next start -p 3211
BASE_URL=http://localhost:3211 node scripts/capture-screens.mjs \
  --out .impeccable/review/screens-fix
  # 8/8 rutas @390 con overflow horizontal 0px
  # flag de contraseña temporal a mitad de sesión → /cambiar-contrasena: OK
```

Capturas en `.impeccable/review/screens-fix/*.png` (390×844 y 1440×900 por
ruta), revisadas visualmente: `usuarios`, `socios`, `auditoria`, `ajustes`,
`socio` (detalle, grupo familiar sin tarjeta anidada), `socios-nuevo`
(checkbox del DNI como fila completa), `login` (ojo de contraseña).

## Segundo pase: verdict del revisor sobre los fixes anteriores

El revisor confirmó `resolved` en los fixes 1, 2, 3, 5, 6 y 8 de arriba (la
numeración del veredicto no coincide 1:1 con los títulos de este archivo,
pero cubre lo documentado en los puntos 1, 2, 3, 5 y 6, más el "ceiling" del
punto 7). Quedaron dos pendientes, mismo lote de archivos:

### Fix 4 partial — campos cambiados truncados en `/auditoria` a 390px

**Antes:** la fila móvil componía `subtitle` como una sola cadena —"Modificó
a Ejemplo, Lucía · teléfono, domicilio"— y `DataList` envuelve `subtitle` en
un `<span className="truncate ...">` (una sola línea, elipsis). Con una
frase larga (verbo + nombre del registro + campos), el resultado real era
"Modificó al usuario Editora de Prueba · contras…" — Presidencia no podía
leer QUÉ cambió sin abrir el detalle, que es exactamente lo que este fix
tenía que evitar.

**Fix (`src/views/audit/audit-list.tsx`):** se sacaron los campos cambiados
de `subtitle` (que vuelve a ser solo "Modificó a Ejemplo, Lucía", corto y sin
riesgo de recorte) y pasaron a `meta`, en un `<span>` propio con
`w-full line-clamp-2 text-xs text-muted-foreground` — `w-full` lo fuerza a su
propia línea dentro del `flex flex-wrap` de `meta` (no comparte línea con la
fecha), `line-clamp-2` cubre el caso de una lista muy larga de campos sin que
la fila crezca sin límite. Combina las dos alternativas que pidió el
revisor ("en su propia línea" + "line-clamp-2") en vez de elegir una sola.
No se tocó `DataList` ni la columna "Campos cambiados" del escritorio (esa ya
mostraba el texto completo, sin truncar).

Verificado en captura real (`.impeccable/review/screens-fix2/auditoria-390-viewport.png`):
"Modificó al usuario Editora de Prueba" en una línea, "contraseña temporal"
completo en la siguiente, fecha debajo.

### Regresión — `src/views/shared/form-fields.tsx` (`CheckboxField`)

**Causa:** el fix anterior resolvió el target de 44px envolviendo el
`Field` (checkbox + texto) con `FieldLabel`, apoyándose en las clases propias
de `field.tsx` (`has-[>[data-slot=field]]:rounded-lg border ...
*:data-[slot=field]:p-2.5`) — pensadas para un patrón de "checkbox como
tarjeta seleccionable" (con borde, fondo en hover, padding). Aplicado a un
checkbox simple, el resultado visual era una caja con borde redondeado y
alto de input de texto: para un voluntario no técnico parecía un campo para
escribir, y el checkbox de 16px casi no se distinguía adentro.

**Fix:** se reemplazó `FieldLabel` (que trae esa afinidad de tarjeta) por el
`Label` nativo de shadcn (sin esa capa extra), envolviendo directamente el
`Checkbox` y el texto del label, con clases propias mínimas
(`min-h-11 w-fit items-center gap-2 font-normal`) — sin borde, sin radio, sin
fondo de hover, sin padding de tarjeta. `min-h-11` sigue garantizando el
piso de 44px del target completo (checkbox + texto), pero el checkbox vuelve
a verse a su tamaño normal, como un checkbox con label clickeable estándar.
`description` y `error` quedan fuera del `<label>` (no tienen por qué ser
parte del target clickeable) pero con `aria-describedby` intacto y `pl-6`
para alinearse debajo del texto, no del checkbox.

Se sacó el import de `FieldTitle` (ya no se usa en este archivo) y se
agregaron `Label` (`@/components/ui/label`) y `cn` (`@/lib/utils`).

Verificado en captura real (`.impeccable/review/screens-fix2/socios-nuevo-390-viewport.png`):
fila "Todavía no tengo el DNI" sin borde ni fondo propio, checkbox visible a
tamaño normal, toda la fila sigue siendo un target clickeable único.

### Verificación del segundo pase

```
npm run typecheck   # verde
npm run lint        # verde
npm run build        # verde
npx next start -p 3212 &
BASE_URL=http://localhost:3212 node scripts/capture-screens.mjs \
  --out .impeccable/review/screens-fix2
  # 8/8 rutas @390 con overflow horizontal 0px
  # flag de contraseña temporal a mitad de sesión → /cambiar-contrasena: OK
```

Capturas en `.impeccable/review/screens-fix2/*.png`.

## Tercer pase: `Button` (default/sm/icon/icon-sm) bajo 44px, hallado por el documentador

El documentador de `impeccable` encontró que la primitiva `src/components/ui/button.tsx`
seguía con `default` en `h-8` (32px), `sm` en `h-7` (28px), `icon` en `size-8`
(32px) e `icon-sm` en `size-7` (28px) — por debajo de eso heredaban footers
de diálogo (reason, create, complete, change-role, reset, toggle-active),
el paginador (`Ver más`), los "Reintentar" de `error.tsx` y `AccessDenied`,
`WhatsAppLink`, el botón del empty state del padrón, "Nuevo usuario"
(`sm:h-8` a partir de 640px), el menú de fila de `/usuarios` (`sm:size-8` /
`h-9`), "Limpiar filtros", "Copiar" del diálogo de contraseña temporal,
cámara/archivo del apto físico, y el botón de cerrar (X) de todo diálogo y
sheet del sistema (`dialog.tsx`/`sheet.tsx`, que también usan `icon-sm`).

**Fix, en la fuente (`src/components/ui/button.tsx`):** `default`, `sm`,
`icon` e `icon-sm` pasan a 44px — `h-11` los dos primeros, `size-11` los dos
últimos —, **flat, sin compactar por `md:`** a propósito: una variante
responsive en la base (ej. `default: "h-11 md:h-9"`) se filtra, vía
`cn`/tailwind-merge, hacia cualquier override plano que ya exista en el repo
para forzar 44px en TODOS los breakpoints (`className="h-11"`, sin su propio
`md:` — el submit de login, "Guardar" de las fichas, "Marcar como
responsable", etc., varios agregados en los dos pases anteriores de esta
misma finish review). Con una base responsive, esos botones se hubieran
achicado en desktop sin que nadie lo pidiera — mismo riesgo que ya se había
identificado y evitado para `input.tsx`/`select.tsx` en el primer pase. Se
mantuvo la escala tipográfica (`text-[0.8rem]` de `sm`) y los colores
intactos, como pidió el encargo — solo se tocó alto/tamaño.

No se tocaron `xs`, `lg`, `icon-xs`, `icon-lg` (fuera de la lista del
encargo): verificado que `lg` y `xs`/`icon-xs` no se usan en ninguna vista
como botón suelto, e `icon-lg` se usa siempre con su propio override
(`className="size-11"`, ya fijado en pases anteriores) en `discipline-group.tsx`
y `category-row.tsx`.

**Overrides por pantalla, retirados (rompían el nuevo piso):**
- `src/views/users/users-view.tsx`: "Nuevo usuario" — `className="h-11 gap-1.5 sm:h-8"` → `className="gap-1.5"` (hereda el `h-11` flat de `default`).
- `src/views/users/user-row-menu.tsx`: "Completar alta" — se sacó `className="h-9"` de `size="sm"`; el menú de fila (⋮) — se sacó `className="size-11 sm:size-8"` de `size="icon"` (ambos ahora heredan el tamaño flat de la base, sin override).

**Todo lo demás de la lista del reporte (diálogos, paginador, `error.tsx`,
`AccessDenied`, `WhatsAppLink`, empty state, "Limpiar filtros", "Copiar",
cámara/archivo del apto físico, X de cierre de diálogos/sheets) se corrigió
solo con el cambio en `button.tsx`**: son `<Button>` sin override de tamaño
(`size="sm"`/`size="icon-sm"`/default), así que no hicieron falta cambios de
archivo — confirmado por grep, no había overrides de alto/tamaño que
compitieran ahí.

**Verificación:**

```
npm run typecheck   # verde
npm run lint        # verde
npm run build        # verde
npx next start -p 3213 &
BASE_URL=http://localhost:3213 node scripts/capture-screens.mjs \
  --out .impeccable/review/screens-fix3
  # 8/8 rutas @390 con overflow horizontal 0px

# medición real con Playwright (viewport 390 y 1440, sesión logueada):
#   Nuevo usuario:            137x44 (390) / 137x44 (1440)
#   Menú de fila (⋮):          44x44 (390) / 44x44 (1440)
#   Footer de diálogo (Cancelar/Confirmar), computed height: 44px (border-box)
#   X de cierre de diálogo:    44x44 (390)

grep -rn 'h-8\b\|h-9\b\|size-8\b' src/views src/components
  # únicos hits: tamaños de ÍCONO decorativo (UserX/ShieldAlert/Icon/avatar,
  # ninguno un botón), comentarios que documentan el fix, y el propio `lg`
  # de button.tsx (h-9, fuera de alcance, no usado como botón suelto) —
  # ningún botón tocable queda en h-8/h-9/size-8.
```

Capturas en `.impeccable/review/screens-fix3/*.png`.
