# 02 — Desarrollo frontend: feedback directo de Tomás (ronda post-review)

Corrida sobre lo ya aprobado en `03-review.md`/`03-tests.md` de este mismo
pipeline. No es un slice de `01-tasks.md`: es una tanda de arreglos puntuales
que Tomás pidió después de usar el sistema, más una corrección suya a mitad
de tarea sobre el punto 5. Todo lo de abajo queda en `src/views/**`,
`src/app/(panel)/(admin)/auditoria/page.tsx` y `src/models/audit.model.ts`
(una sola línea, la lista `AUDITED_TABLES`). No se tocó `supabase/**`,
`tests/**`, `src/lib/**` ni otros modelos/controllers, ni el contenido del
panel inicial (`src/app/(panel)/page.tsx`).

## 1. Seguridad: `<form>` sin `method` caía a GET nativo

Causa raíz confirmada: los forms no declaraban `method`. Con JS caído (chunk
500, deploy a mitad de camino), el navegador cae a su comportamiento nativo
—GET con los campos en la query string—, y eso es lo que Tomás vio en el log
(`GET /login?email=...&password=...`).

Se agregó `method="post"` explícito a los 11 `<form>` que faltaban (el
ESLint `no-restricted-syntax` de `eslint.config.mjs` ya lo exige; `npm run
lint` queda en 0 errores):

- `src/views/auth/login-form.tsx`
- `src/views/auth/change-password-form.tsx`
- `src/views/members/medical-clearance-section.tsx`
- `src/views/members/member-form.tsx`
- `src/views/settings/category-form-sheet.tsx`
- `src/views/settings/club-settings-form.tsx`
- `src/views/settings/discipline-form-sheet.tsx`
- `src/views/shared/reason-dialog.tsx`
- `src/views/shell/home-search.tsx`
- `src/views/users/complete-user-dialog.tsx`
- `src/views/users/create-user-dialog.tsx`

**Progressive enhancement real en login y cambio de contraseña**: los dos
únicos forms sobre `useActionState` (`LoginForm`, `ChangePasswordForm`) ahora
llevan también `action={formAction}`, más un `<input type="hidden"
name="next">` (antes `next` solo viajaba a mano dentro de `onValid`, invisible
sin JS). Con JS: `react-hook-form`'s `handleSubmit` sigue ganando la carrera
—llama `preventDefault()` y valida antes de invocar la Server Action a mano
en una transición—, sin cambio de comportamiento. Sin JS: React/Next 16
serializan el `action` de función como un POST nativo a la Server Action
(hidden input con la referencia de la acción), así que el navegador manda el
POST solo, sin ningún JS cargado.

**Verificado con Playwright** (`chromium.newContext({ javaScriptEnabled:
false })`, `admin@lonqui.test` / `DEV_ADMIN_PASSWORD` de `.env.local` contra
`next build && next start -p 3215`): la request de login es `POST
http://localhost:3215/login` (sin query string) y termina en `/` — login
real, sin JS, sin la contraseña en la URL. Con JS habilitado, se confirmó por
separado que la validación de RHF sigue actuando antes de tocar el servidor
(email vacío → "Ingresá un email válido" sin request) y que el ojo de
mostrar/ocultar contraseña alterna `type="password"`/`type="text"`
correctamente en login (mismo componente que usa cambio de contraseña:
`PasswordField`, `src/views/shared/form-fields.tsx`, sin cambios de código —
solo se confirmó el comportamiento).

**Buscador del inicio** (`src/views/shell/home-search.tsx`): es una búsqueda,
no una credencial. `method="get"` y `action="/socios"` explícitos, más
`name="q"` en el `<input>` (antes no lo tenía: sin JS el submit nativo no
armaba ninguna query string). Con JS, `onSubmit` sigue ganando y navega con
`router.push` sin recarga completa.

## 2. "Nuevo usuario" desbordaba el diálogo

Causa raíz: el trigger del `Select` de rol (`select.tsx`) tiene
`whitespace-nowrap`; `DialogContent` es un `grid` sin `grid-template-columns`
explícito, así que por default CSS un grid item tiene `min-width: auto` y su
contenido de una sola línea (`"Administrador — Todo: usuarios, ajustes, baja
y reactivación de socios, auditoría"`, una sola opción del combo) estiraba la
pista de la grilla más allá de `max-w-sm` — el diálogo entero se salía de la
card. `line-clamp-1` no alcanza a evitarlo: acota el texto visualmente pero no
el tamaño mínimo que el layout le reserva al contenedor.

Arreglo, en capas:

- **`src/components/ui/select.tsx`**: `SelectItem` acepta ahora un
  `description?: React.ReactNode` que se renderiza como segunda línea,
  **fuera** de `SelectPrimitive.ItemText` (a propósito: Radix solo refleja lo
  que hay adentro de `ItemText` en el trigger vía `SelectValue`, así que una
  descripción larga ahí no se duplica ni empuja el ancho del trigger). Se
  agregó `max-w-[min(24rem,calc(100vw-2rem))]` a `SelectContent` para que el
  propio desplegable no se salga del viewport a 390px con una descripción
  larga.
- **`src/views/shared/form-fields.tsx`** (`SelectField`): `options` acepta
  `description?: string` por opción. Cuando hay un valor elegido, su
  `description` reemplaza la `description` estática del campo como texto de
  ayuda debajo del `Select` (mismo lugar donde ya vivía la `FieldDescription`
  de cualquier otro campo — no se inventó una ubicación nueva). El trigger
  (`SelectTrigger`) suma `min-w-0` junto al `w-full` que ya tenía.
- **`src/views/users/create-user-dialog.tsx`** y
  **`complete-user-dialog.tsx`**: `ROLE_OPTIONS` separa `label` (solo
  "Administrador"/"Editor"/"Consulta") de `description` (el texto de
  `appRoleDescriptions`), en vez de concatenarlos con `—` en un solo string.
- **`src/components/ui/dialog.tsx`** y **`sheet.tsx`**: `[&>*]:min-w-0` en el
  contenedor (`DialogContent`/`SheetContent`), para que NINGÚN hijo directo
  con contenido que no rompe línea pueda volver a forzar el ancho del
  diálogo/sheet más allá de su `max-width` — pedido explícito de Tomás
  ("revisá que ningún diálogo del sistema pueda desbordarse").

Verificado con Playwright a 390px y 1440px: el `DialogContent` mide 358px de
ancho a 390 (390 − 32px de márgenes) y 384px a 1440 (`max-w-sm`) tanto cerrado
como con el desplegable de rol abierto — screenshots en
`.impeccable/review/screens-feedback/usuarios-390.png` /
`usuarios-1440.png` (capturas del listado; el diálogo se verificó en una
corrida de Playwright aparte, no incluida en `capture-screens.mjs`).

## 3. Ojo de mostrar contraseña

Confirmado con Playwright (login, con JS): clickear "Mostrar contraseña"
cambia el `<input>` de `type="password"` a `type="text"`, y "Ocultar
contraseña" lo revierte. Mismo componente (`PasswordField`) en cambio de
contraseña — sin cambios de código, el hallazgo ya estaba resuelto por el
hilo principal.

## 4. `ResponsiveSheet`: sheet abajo en móvil, diálogo centrado desde `md`

Nueva primitiva: **`src/views/shared/responsive-sheet.tsx`**. Un solo punto
de corte para "es escritorio" en todo el panel (`md`, 768px — el mismo que ya
usa `AppShell` para la barra lateral), leído con `useSyncExternalStore` sobre
`matchMedia` (no `useEffect` + `useState`: `matchMedia` ya es una fuente
externa con su propio evento de cambio, y sincronizarla con un efecto que
llama `setState` en el cuerpo dispara un render en cascada que el lint de
`vercel-react-best-practices`/`react-hooks/set-state-in-effect` marca como
error). Sin viewport en el servidor, el primer render es siempre el sheet
desde abajo (el caso más común, el celular de la sede).

API: `{ open, onOpenChange, title, description?, footer, children }`.
`children` es el `<form>` completo con su propio `id` (los botones del
`footer` usan `form="<id>"`, así quedan fuera del árbol scrolleable). El
padding/scroll de la zona de contenido lo pone `ResponsiveSheet` según el
modo (móvil: `px-4 py-4` porque `SheetContent` no trae padding propio;
escritorio: sin padding extra, `DialogContent` ya trae `p-4`) — así el
consumidor no repite ese `if` en cada `*-form-sheet.tsx`.

Migrados: `src/views/settings/discipline-form-sheet.tsx` y
`category-form-sheet.tsx` (los dos sheets de alta/edición corta que Tomás
señaló). Revisé el resto del sistema: `src/views/audit/audit-detail-sheet.tsx`
es el único otro `Sheet` del repo, pero es un panel de **detalle de solo
lectura** (`side="right"`, ancho completo en móvil) — el patrón "raro en
escritorio" que reportó Tomás es específico del sheet-desde-abajo con un
formulario corto centrado, no aplica a un panel lateral de detalle (convención
estándar en ambos tamaños). Se deja como está.

Verificado con Playwright a 390/1440: en escritorio, "Nueva disciplina" abre
ahora un diálogo centrado de 448px (`sm:max-w-md`, un poco más ancho que
`max-w-sm` para que el campo no quede apretado) con footer de dos botones a
la derecha; en móvil sigue siendo el sheet desde abajo de siempre, sin cambio
visual.

## 5. Navegación inferior móvil — algoritmo genérico por importancia

Corrección de Tomás a mitad de tarea sobre mi primera lectura ("no es mandar
Usuarios/Ajustes/Auditoría a un 'Más' fijo"): la regla real es **máximo 5
espacios en la barra** (contando "Más" si hace falta), **ordenados de menor a
mayor importancia hacia la derecha** (el más importante en el extremo
derecho, al alcance del pulgar). "Más" aparece solo cuando el conjunto de
destinos del rol no entra en 5, y se lleva los menos importantes al extremo
**izquierdo** (el lugar menos alcanzable, coherente con ser lo menos
prioritario).

Implementado en **`src/views/shell/nav-items.ts`** como un algoritmo sobre un
`rank` fijo por destino (0 = más importante), no como casos por rol:

```
Socios(0) > Cobranza(1, apagado) > Inicio(2) > Usuarios(3) > Ajustes(4) > Auditoría(5)
```

- `getNavItems(role)`: todos los destinos del rol, ordenados por `rank`
  ascendente (más importante primero) — lo usa la barra lateral de
  escritorio, de arriba hacia abajo, Socios arriba.
- `getMobileNav(role)`: si el total de destinos del rol entra en
  `MOBILE_MAX_SLOTS` (5), se listan todos, invertidos (menor a mayor
  importancia de izquierda a derecha). Si no entran, se quedan los primeros
  4 por `rank` como ítems propios (mismo orden invertido) y el resto va a
  `overflow`, que la vista muestra como "Más" al extremo izquierdo.

Verificado (con `COBRANZA_ENABLED = false`, la ruta no existe todavía):

- **admin** (5 destinos, sin Cobranza): `Auditoría · Ajustes · Usuarios ·
  Inicio · Socios` — sin "Más" (justo entran los 5). Confirmado por
  Playwright (`nav[aria-label="Navegación principal"]`) y por
  `usuarios-390.png`/`usuarios-1440.png` en
  `.impeccable/review/screens-feedback/`.
- **editor/consulta** (2 destinos): `Inicio · Socios`.
- Desktop: `Socios, Inicio, Usuarios, Ajustes, Auditoría` (admin) — Socios
  arriba, confirmado por Playwright y por `usuarios-1440.png`.

Cobranza queda detrás de `COBRANZA_ENABLED` (una sola constante, comentada,
en `nav-items.ts`): cuando el próximo slice cree la ruta, prenderla ahí solo
agrega el destino al `REGISTRY` con su `rank`; el algoritmo de arriba (barra
lateral, barra inferior, "Más") no se toca. Con el flag prendido, admin pasa
a 6 destinos y el propio algoritmo arma `Más (Ajustes, Auditoría) · Usuarios
· Inicio · Cobranza · Socios` sin ningún cambio adicional — verificado a mano
razonando sobre el algoritmo (no hay forma de probarlo end-to-end sin la
ruta real todavía; queda para que el slice de Cobranza lo confirme con
Playwright cuando la prenda).

`src/views/shell/nav-list.tsx`: `MobileBottomNav` ahora renderiza un botón
"Más" (ícono `MoreHorizontal`) cuando `overflow.length > 0`, que abre un
`Sheet` (`side="bottom"`) con los destinos que no entraron, en el mismo estilo
que la barra lateral de escritorio (fila de 44px, ícono + etiqueta, acento
naranja si es el activo). El botón "Más" también se resalta si la ruta activa
es uno de los destinos agrupados ahí adentro (`overflowActive`), para no
perder la noción de "dónde estoy" cuando la página actual quedó en el sheet.

`src/app/(panel)/page.tsx` sigue llamando a `getNavItems(role)` para los
atajos del panel inicial (filtra `/`) — no se tocó ese archivo ni el
contenido del inicio, solo se verificó que la firma y el orden nuevo (Socios
primero) siguen siendo compatibles.

## 6. Auditoría — blocker B1: `fee_prices`/`fees`/`payments` no filtraban

`AUDITED_TABLES` en `src/models/audit.model.ts` (única línea tocada en
`src/models/**`) ahora incluye `'fee_prices' | 'fees' | 'payments'` — el tipo
`AuditedTable` (`src/models/types.ts`) ya las traía desde el slice de
cobranza, así que no hizo falta tocar el tipo. `AUDITED_TABLE_OPTIONS`
(`src/views/audit/audit-labels.ts`) ya ofrecía "Valores de cuota / Cargos /
Pagos" en el select — el problema era que el filtro nunca hacía match porque
`src/app/(panel)/(admin)/auditoria/page.tsx` validaba contra un `Set` local
desactualizado (las 8 tablas del slice 1), así que `tableName=payments` en la
URL se descartaba en silencio y la page renderizaba sin filtro.

La page ahora importa `AUDITED_TABLES` del modelo y arma su propio `Set`
sobre esa única fuente (`AUDITED_TABLE_SET`), en vez de mantener una lista
paralela. Verificado con Playwright: `GET /auditoria?tableName=payments`
conserva el filtro (antes se perdía).

## Verificación

- `npm run typecheck` — sin errores.
- `npm run lint` — sin errores (el `no-restricted-syntax` de `method` en
  `<form>` queda en 0).
- `npm run build` — build de producción sin errores ni warnings nuevos.
- `npm run build && npx next start -p 3215` +
  `BASE_URL=http://localhost:3215 node scripts/capture-screens.mjs --out
  .impeccable/review/screens-feedback`: `overflow horizontal` en 0px en las 8
  rutas a 390px, y el caso "flag de contraseña a mitad de sesión →
  `/cambiar-contrasena`" sigue pasando.
- Playwright ad hoc (no versionado, corrido desde el directorio del proyecto
  para resolver `playwright` de `node_modules`): login sin JS por POST sin
  query string; validación de RHF con JS antes de tocar el servidor; ojo de
  contraseña; diálogo de "Nuevo usuario" sin desborde a 390/1440 con el
  desplegable de rol abierto; sheet de disciplina como diálogo centrado desde
  `md`; orden de la barra inferior y la barra lateral: capturas revisadas a
  mano, no quedan archivos temporales en el repo (se generaron y borraron
  desde fuera del árbol de git, o están bajo `.impeccable/review/`, que
  `.gitignore` ya excluye).

## Deferido / seguimiento

- `ResponsiveSheet` no migró `audit-detail-sheet.tsx`: es un panel de detalle
  de solo lectura, no un formulario corto — el patrón que reportó Tomás no le
  aplica. Si un futuro slice le suma alguna acción de escritura (por ejemplo,
  un motivo de corrección), vale la pena revisar si sigue siendo un panel
  lateral o si conviene el mismo `ResponsiveSheet`.
- El comportamiento del flag `COBRANZA_ENABLED` (barra con "Más" agrupando
  Ajustes/Auditoría cuando el destino se sume) queda razonado pero no
  ejercitado end-to-end — no hay ruta `/cobranza` todavía. El slice que la
  cree debería correr `capture-screens.mjs` (o Playwright ad hoc) para
  confirmar el orden exacto antes de dar el punto por cerrado.
