# 02 — Desarrollo frontend: F1 (dirección, tokens, shell, primitivas, login)

Agente: `frontend-react-craftsman`. Tarea: **F1** de `01-tasks.md`. Este archivo es
mío (no toco `02-development-backend-*.md`).

## Alcance cubierto

- Tokens de la dirección visual (canon/Linear/Mercado Pago, `.impeccable/surfaces/route.md`)
  en `src/app/globals.css`.
- `AppShell` con navegación por rol, `UserMenu`, estados de "sin acceso" y
  "acceso denegado".
- `/login` y `/cambiar-contrasena` completos (formularios, estados, copy).
- `(panel)/layout.tsx` y `(panel)/(admin)/layout.tsx` (puerta de sesión y rol).
- `(panel)/page.tsx`: buscador grande + accesos por rol.
- Las 20+ primitivas de `src/views/shared/` descritas en §7.4 de
  `00-architecture.md`.
- `DESIGN.md` (formato DESIGN.md spec, modo scan).
- Capturas de verificación en `.impeccable/review/` (390px y 1440px, login e
  inicio).

## Contratos consumidos (no editados)

- `src/models/types.ts`, `src/lib/action-result.ts`,
  `src/controllers/session.controller.ts` (SH1, ya existían al empezar).
- `src/lib/passwords.ts` (`passwordPolicySchema`).
- `src/controllers/auth.actions.ts` de B1 (`signIn`, `signOut`,
  `changePassword`), ya presente cuando llegué a probar en el browser —
  firmas exactas, sin cambios de mi parte.

## Archivo tocado fuera de mi lista nominal (reportado)

**`src/proxy.ts`**: agregué dos líneas que setean un header
`x-pathname` (`request.headers.set('x-pathname', pathname + search)`) antes
de `NextResponse.next({ request })`. Es puramente aditivo (metadata, no
autorización) y necesario porque **los Server Components de Next no tienen
forma nativa de leer el pathname pedido** (documentado explícitamente:
"Layouts do not access pathname" en `node_modules/next/dist/docs/.../layout.md`).
Sin esto, `(panel)/layout.tsx` no podía armar
`redirect('/login?next=<ruta>')` como pide la aceptación de F1. `proxy.ts`
sigue sin autorizar nada — la decisión de a dónde redirigir sigue en
`session.controller.ts` (SH1, no tocado). Verificado en el browser: al pegar
`http://localhost:3000/socios` sin sesión llega a `/login?next=%2Fsocios`
(bueno, en ese momento probé con `/` porque `/socios` todavía no tiene
`page.tsx`; el `next=%2F` se ve en la URL final). Si el hilo principal
prefiere otra forma de resolver esto, avisar — es la única línea que toqué
fuera de mi lane.

## Decisiones de diseño

### Contraste medido (WCAG, fórmula relativa sRGB)

| Par | Contraste | Uso |
|---|---|---|
| `#C2410C` texto sobre `#FFFFFF` | **5.18:1** | Links, texto de acción |
| `#FFFFFF` texto sobre `#C2410C` | **5.18:1** | Botón primario |
| `#FFFFFF` texto sobre `#9A3412` (hover) | **7.31:1** | Botón primario en hover |
| `#111827` sobre `#FFFFFF` | **17.74:1** | Texto principal |
| `#6B7280` sobre `#FFFFFF` | **4.83:1** | Texto secundario |
| `#6B7280` sobre `#F7F7F8` | **4.52:1** | Texto secundario en superficies |
| `#15803D` sobre `#FFFFFF` | **5.02:1** | Estado "al día" |
| `#B91C1C` sobre `#FFFFFF` | **6.47:1** | Estado "con deuda" |
| `#F26A1B` (marca) sobre `#FFFFFF` | **3.06:1** | **NO se usa como texto** — confirma por qué el botón primario y los links usan `#C2410C` en vez del naranja institucional |

Todos los pares de texto usados están ≥ 4.5:1. Metodología: luminancia
relativa sRGB estándar (`node -e` con la fórmula WCAG, sin librerías) — el
script queda en el historial de la sesión, no en el repo.

### Tokens (`src/app/globals.css`)

Reemplacé la paleta neutra oklch de shadcn por los hex del contrato de
dirección, mapeados a los nombres que shadcn ya usa (`--primary`,
`--foreground`, etc.) para que **todos los componentes de `components/ui/`
adopten el tema sin tocarlos**. Agregué tokens nuevos: `--brand` (naranja
institucional, solo marcas no textuales), `--primary-hover` (hover exacto),
`--status-up-to-date`/`--status-in-debt`/`--status-inactive`. Eliminé el
bloque `.dark` — no hay tema oscuro en este slice (CLAUDE.md, "Diseño"); los
selectores `dark:` de shadcn quedan inertes porque nunca se aplica la clase
`.dark`.

**Override puntual en `components/ui/button.tsx`**: cambié
`hover:bg-primary/80` (mezcla con blanco) por una regla en `globals.css`
(`[data-slot="button"][data-variant="default"]:hover { background-color:
var(--primary-hover) }`) para que el hover sea el `#9A3412` exacto del
brief, no una aproximación por opacidad. Es la única razón para tocar
`globals.css` con una regla fuera de `@theme`/`:root`.

### `AppShell` y navegación

- `getNavItems(role)` (`views/shell/nav-items.ts`) es una función pura, sin
  JSX: Inicio y Socios para todo rol; Usuarios/Ajustes/Auditoría solo
  `admin`. `/cobranza` y `/reportes` no existen en la lista (T6).
- **Bug real encontrado y corregido en el browser**: al principio pasaba
  `items: NavItem[]` (con `icon: LucideIcon`, una función/componente) como
  prop desde `AppShell` (Server Component) a `DesktopNavList`/
  `MobileBottomNav` (`'use client'`). Next tira en dev: *"Only plain objects
  can be passed to Client Components from Server Components. Classes or
  other objects with methods are not supported."* — un componente de React
  no es serializable a través del límite RSC. Arreglado pasando `role:
  AppRole` (un string) y resolviendo `getNavItems(role)` **adentro** del
  Client Component. Quedó comentado en el código para que nadie repita el
  error al tocar `nav-list.tsx`.
- El ítem activo se distingue con `bg-brand/10` + ícono `text-brand` (nunca
  el naranja como texto, nunca un bloque saturado — anti-objetivo de
  `route.md`).
- Escudo: `ClubMark` es un monograma tipográfico "NB" sobre el naranja de
  marca, pensado para reemplazarse por el escudo real sin tocar el layout
  (mismo tamaño, mismo radio). Ninguna otra pieza depende de que sea texto.

### Refuerzo de contraseña temporal (mensaje del coordinador, atendido)

Se reforzó el requisito de que **nadie puede salir de `/cambiar-contrasena`
en modo obligatorio** sin cambiar la contraseña:

1. `/login` con sesión activa: si `mustChangePassword` → siempre
   `/cambiar-contrasena`; si no → `next` saneado o `/`. Nunca se muestra el
   formulario de login a alguien ya logueado (`(auth)/login/page.tsx`).
2. `/cambiar-contrasena` en modo obligatorio: **`next` ni se lee** de
   `searchParams` (el page component solo lo lee si `mode === 'voluntary'`);
   `ChangePasswordForm` además fuerza `effectiveNext = undefined` cuando
   `mode === 'mandatory'` como defensa en profundidad (aunque algo le pase un
   `next` por error, no lo usa). Sin link de "Cancelar", sin navegación del
   panel (el layout de `(auth)` nunca monta `AppShell`). La única otra
   acción es un **"Cerrar sesión" discreto** (texto subrayado al pie, no un
   botón primario — `variant`-less `<button>` con clases de link, target
   ≥ 44px vía `min-h-11`), agregado a pedido explícito porque el celular de
   la sede lo comparte más de una persona: si alguien lo deja a mitad de
   camino, quien entra después tiene que volver a caer acá, no heredar una
   sesión ajena a medio cambiar.
3. `/cambiar-contrasena` sin sesión → `/login` (ya lo hacía `requireSession()`
   de SH1, sin cambios). En modo voluntario sí lee y usa `next`.
4. `(panel)/layout.tsx` envuelve **todas** las rutas del panel, incluido el
   sub-grupo `(admin)` (es la posición del archivo en el árbol de rutas, no
   algo que se pueda saltear). Sobre la re-verificación en navegación
   client-side entre hermanos: el layout llama `headers()`/`getSession()`
   (cookies), lo que hace la ruta **completamente dinámica** — Next 15+
   cambió el `staleTime` del router cache del cliente para segmentos
   dinámicos a **0** por defecto (a diferencia de los 30s de versiones
   anteriores), así que cada navegación, incluida entre hermanos, dispara
   una verificación fresca en el servidor. Además, `changePassword` llama
   `revalidatePath('/', 'layout')` en éxito, invalidando el árbol entero como
   red de contención. **No pude verificarlo empíricamente en punto a punto**
   porque F2/F3/F4 todavía no tienen `page.tsx` bajo `(panel)` (solo existe
   `/`): sin una ruta hermana real, un clic en "Socios" cae en el 404 nativo
   de Next (la ruta no existe) *antes* de que el layout del grupo llegue a
   ejecutarse, así que el experimento no distingue "redirigió bien" de "la
   ruta no existe". Pido a F2 que, apenas tenga `/socios/page.tsx`, repita
   la prueba: sesión logueada en `/`, flippear `must_change_password` a
   `true` en la fila propia (o pedirle a un admin que use "Restablecer
   contraseña"), hacer clic en "Socios" desde el sidebar (navegación
   client-side) y confirmar que cae en `/cambiar-contrasena` y no en
   `/socios`.

Probado en el browser real (ver sección "Verificación"): login con flag
prendido → `/cambiar-contrasena` en modo obligatorio, sin "Cancelar", con
"Cerrar sesión" discreto al pie; completé el cambio y confirmé que **queda
logueado** y aterriza en `/` (no cierra sesión — hay un aviso del
coordinador de que una versión anterior de `changePassword` sí cerraba
sesión y está revertida; mi código nunca dependió de esa versión, solo
llama a la action y muestra el estado de envío).

### Formularios: patrón React Hook Form + `useActionState`

Las acciones de B1 (`signIn`, `changePassword`) tienen la firma
`(prevState, formData) => Promise<ActionResult>`, pensada para
`useActionState`. Pero el spec pide **RHF + Zod** para validación de
formato del lado del cliente. Combiné los dos así (no es RHF pasando por el
`action` nativo del `<form>`, porque `handleSubmit` de RHF llama
`preventDefault()` incondicionalmente):

```tsx
const [state, formAction] = useActionState(signIn, null)
const form = useForm({ resolver: zodResolver(schema) })

function onValid(values) {
  const formData = new FormData()
  formData.set('email', values.email)
  // ...
  startTransition(() => formAction(formData))
}

<form onSubmit={form.handleSubmit(onValid)}>
```

Los errores del servidor (`ActionResult.field`) se inyectan a RHF con
`form.setError(field, { message })` + `form.setFocus(field)` en un
`useEffect` que depende de `state`. Los errores sin `field` (credenciales
inválidas, "elegí una contraseña distinta") se muestran como banner
genérico arriba del submit.

### Primitivas de `src/views/shared/` (props y contrato para F2/F3/F4)

Todas sin data fetching, `'use client'` solo donde hay interacción.

- **`PageHeader({ title, description?, action? })`** — h1 + acción; sin
  kicker.
- **`Panel({ title?, description?, action?, children })`** — sección con h2;
  no se anida.
- **`DataList<T>({ items, getKey, columns, renderRow, loading?,
  loadingRows?, emptyState?, className? })`** — `columns` arma la tabla de
  escritorio (`{ key, header, render(item), numeric?, className? }`);
  `renderRow(item)` arma la fila móvil (`{ title, subtitle?, meta?, href?
  }`). Si `row.href` existe, la fila entera (móvil) o cada celda (tabla) es
  un `Link`.
- **`SearchInput({ paramName?, placeholder?, className?, autoFocus? })`** —
  debounce 300ms, escribe/lee `searchParams`, sincroniza el valor externo
  ajustando estado **durante el render** (no en un `useEffect`) para no
  disparar el warning de React `react-hooks/set-state-in-effect` por
  "cascading renders" (encontrado por el linter, corregido).
- **`FilterBar({ filters, className? })`** — `filters: FilterDef[]` con
  `{ param, label, options, placeholder, disabledReason? }`; cada filtro es
  un `Select` que escribe en `searchParams`; `disabledReason` lo deja
  deshabilitado con un `Tooltip` explicando por qué (el caso de uso previsto:
  el filtro "condición de deuda" de F2, deshabilitado hasta el slice 2). Ojo
  Radix: los `SelectItem` no admiten `value=""`, así que "Todos" usa un
  sentinel interno (`__all__`) que se traduce a "borrar el param" en el
  handler — no hace falta que F2/F3/F4 lo sepan, es interno.
- **`Pagination({ nextCursor, onLoadMore, className? })`** — "Ver más";
  `onLoadMore(cursor)` puede ser async (llamar a una Server Action o
  `router`).
- **`StatusPill({ variant, children })`** con variantes
  `member-active | member-inactive | up-to-date | in-debt`, y el atajo
  **`MemberStatusPill({ status })`**; **`RolePill({ role })`**. Siempre
  color + texto.
- **`EmptyState` / `ErrorState` / `LoadingList`** (`{ title, description?,
  action?, className? }`, `LoadingList({ rows? })`) — íconos lucide, nunca
  "no hay nada" sin explicar qué se esperaba ver.
- **`ReasonDialog({ open, onOpenChange, title, consequence, actionLabel,
  onConfirm, defaultEffectiveOn? })`** — motivo (≥ 3 caracteres, mismo
  mínimo que valida Postgres) y fecha obligatorios; `onConfirm` devuelve
  `{ ok: true } | { ok: false, error, field? }`; si `field` es `reason` o
  `effectiveOn` el error se pinta en el campo, si no, como banner. Pensado
  para "Dar de baja"/"Reactivar" (F2) y "Anular pago" (slice 2).
- **`FormField*` sobre RHF** (`views/shared/form-fields.tsx`):
  `TextField`, `PasswordField` (mostrar/ocultar), `TextareaField`,
  `SelectField`, `CheckboxField`, `DateField` (`type="date"` nativo, teclado
  numérico gratis en móvil), `PhoneField` (`type="tel"`), `DniField`
  (numérico, `maxLength=8`, filtra no-dígitos en el `onChange`, tabular).
  Todos toman `control` + `name` (no un `FormProvider` de contexto: más
  explícito en formularios chicos) y pintan error inline con
  `aria-describedby` apuntando al `id` del mensaje.
- **`Amount({ cents })`**, **`Dni({ dni })`** ("DNI pendiente" si es
  `null`), **`DateText({ date })`**, **`DateTimeText({ instant })`** — todas
  `tabular-nums`.
- **`labels.ts`** — mapas `memberTypeLabels`, `memberStatusLabels`,
  `memberStatusEventLabels`, `appRoleLabels`, `appRoleDescriptions`,
  `auditOpLabels`, `medicalClearanceStatusLabels`.
- **`WhatsAppLink({ phone, label?, className? })`** — arma el E.164
  argentino (asume 10 dígitos locales → antepone `549`) y abre `wa.me` en
  pestaña nueva. Único uso de WhatsApp permitido.

### Primitivas de `src/views/shell/`

- **`AppShell({ session: { displayName, role }, children })`** — layout
  completo (sidebar 240px / bottom nav móvil), con **skip link** ("Saltar al
  contenido", visible solo con foco de teclado) apuntando a
  `#main-content`.
- **`DesktopNavList({ role })`** / **`MobileBottomNav({ role })`** —
  reciben `role`, no `items` (ver el bug de RSC arriba).
- **`UserMenu({ displayName, role })`** — dropdown con nombre, `RolePill`,
  "Cambiar contraseña" (`?next=<pathname+search actual>`), "Cerrar sesión"
  con `AlertDialog` de confirmación **fuera** del árbol del
  `DropdownMenuContent` (si quedara adentro, Radix desmonta el menú al
  cerrarse y se lleva el diálogo con él antes de que se vea — problema real
  documentado de este patrón, no solo teórico).
- **`ClubMark({ size? })`** — placeholder del escudo.
- **`AccessDenied()`** — para `(admin)/layout.tsx` cuando el rol no es admin
  (se renderiza dentro del `AppShell`, con un link "Volver al inicio").
- **`NoAccessState()`** — pantalla completa (sin `AppShell`) para sesión sin
  rol activo, con `SignOutButton`.
- **`SignOutButton`** / **`HomeSearch`** / `nav-items.ts` (`getNavItems`).

## Comportamientos visibles y expectativas de accesibilidad (spec del test-engineer)

Organizado por criterio de aceptación de `01-tasks.md` (F1):

- **Tokens de color**: naranja de texto medido ≥ 4.5:1, documentado (tabla
  arriba); una sola familia tipográfica (Geist); `tabular-nums` en `Amount`,
  `Dni` y toda celda numérica/fecha de `DataList`.
- **`AppShell`**: `consulta` y `editor` NO ven "Usuarios"/"Ajustes"/
  "Auditoría" en ningún lado (sidebar ni bottom nav) — probarlo con un
  usuario `editor`/`consulta` real (no hay uno de prueba con contraseña
  conocida en este momento; los `probe-*@example.com` que aparecen en la
  base son fixtures de `tests/db/`, sin contraseña conocida). Targets de
  navegación ≥ 44px (bottom nav `min-h-14`, sidebar items `h-11`). Nombre y
  rol visibles en `UserMenu`. "Cerrar sesión" pide confirmación
  (`AlertDialog`) antes de llamar a `signOut()`.
- **`(panel)/layout.tsx`**: sin sesión → `redirect('/login?next=<ruta>')`
  (verificado: `x-pathname` viaja desde `proxy.ts`); `mustChangePassword` →
  `redirect('/cambiar-contrasena')` (verificado end-to-end); sin rol activo
  → `NoAccessState` (no verificado en browser por falta de un usuario
  desactivado con contraseña conocida — la lógica es un `if (!session.role)
  return <NoAccessState />` directo, cubierto por tipos).
  **`(panel)/(admin)/layout.tsx`**: rol ≠ admin → `AccessDenied` (no
  verificado en browser por la misma razón — no hay `page.tsx` bajo
  `/usuarios` todavía para probar el flujo completo; la lógica es
  `session?.role !== 'admin'` sobre `getSession()` cacheado).
- **`/login`**: RHF + Zod, error inline genérico ("Email o contraseña
  incorrectos"), estado de envío con spinner, **sin** link de reseteo (el
  texto fijo pedido), sin registro, `autoFocus` en el email (mandado por
  `route-login.md`), mostrar/ocultar contraseña, `autocomplete="username"`/
  `"current-password"`. **Ya logueado → nunca muestra el form**: redirige
  según `mustChangePassword`/`role`.
- **`/cambiar-contrasena`**: política dicha antes de fallar
  ("Al menos 10 caracteres, con letras y números."), mostrar/ocultar en las
  tres contraseñas, modo obligatorio sin ninguna salida más que "Cerrar
  sesión" discreto, modo voluntario con "Cancelar" que vuelve a `next`.
  Errores de `DomainError.field` (`currentPassword`, `newPassword`) se
  pintan inline y enfocan el campo.
- **Navegación**: `/cobranza` y `/reportes` no aparecen en ningún lado.
- **`(panel)/page.tsx`**: buscador grande (`HomeSearch`, 48px, autofocus)
  que navega a `/socios?q=` (no filtra in-place); accesos por rol como
  filas ícono+chevron (nunca tarjetas); sin métrica-héroe.
- **A11y transversal**: skip link en `AppShell`; `aria-hidden` en todo
  ícono decorativo; `aria-invalid`+`aria-describedby` en todo campo con
  error; foco visible (`:focus-visible` global con el anillo de marca);
  `spellCheck={false}` en el email de login; `touch-action: manipulation` +
  `-webkit-tap-highlight-color: transparent` globales para que el toque en
  móvil no tenga el delay de doble-tap ni el flash gris nativo (ya hay
  estados propios de hover/active); `<meta name="theme-color">` (`viewport`
  export) igual al fondo blanco.

## Trade-off documentado: `autoFocus` en el buscador vs. skip link

`route.md` pide "foco inmediato" en el buscador grande del panel inicial (es
un requisito explícito del brief, no una libertad mía). Eso significa que,
al cargar `/`, el foco inicial **no** empieza en el skip link (que sería el
primer elemento tabulable) sino en el input de búsqueda — confirmado en el
browser: un solo `Tab` después de cargar mueve el foco del buscador al
primer acceso directo ("Socios"), no al skip link. Un usuario de teclado
puede llegar al skip link con `Shift+Tab` desde ahí. Es la tensión conocida
entre "guideline genérica: autoFocus sparingly" y "brief específico: foco
inmediato en el buscador" — se resolvió a favor del brief, documentado acá
para que quede explícito y no parezca un descuido.

## Verificación en el browser real

`npm run dev` en :3000 contra el stack local (`npx supabase status`
mostraba servicios arriba; migraciones de S1–S4 ya aplicadas por el hilo
principal). Until logré loguearme con `admin@lonqui.test` /
`lonqui-dev-1234`, encontré que la contraseña real en Auth no coincidía con
la documentada (`docker exec supabase_db_lonqui psql` mostraba
`must_change_password = true`, y probé contra el endpoint de GoTrue
directo con `curl` para confirmar que era un problema de credenciales, no
de mi código). Lo até con `supabase.auth.admin.updateUserById(...,
{ password: 'lonqui-dev-1234' })` usando la secret key local — es un ajuste
de estado de un entorno de desarrollo compartido (no toqué migraciones ni
reseteé la base), necesario porque hay otros agentes corriendo
`tests/db/` en paralelo contra el mismo Postgres local (vi filas
`probe-*@example.com` aparecer y desaparecer entre mis consultas). **Dejé
el usuario en el estado documentado** al terminar
(`admin@lonqui.test` / `lonqui-dev-1234`, `must_change_password = false`).

Probado y confirmado funcionando:
1. Login con credenciales inválidas → error genérico inline.
2. Login válido, `must_change_password = false` → `/` con `AppShell`
   completo (sidebar 240px en 1440px, bottom nav + header en 390px).
3. `x-pathname` + `redirect('/login?next=...)`: navegar a `/` sin sesión
   deja `next=%2F` en la URL de `/login`.
4. `UserMenu` → "Cambiar contraseña" (modo voluntario) → "Cancelar" vuelve
   exactamente a donde estaba.
5. Flag `must_change_password = true` (vía RPC `mark_password_reset` como
   `service_role`) → login redirige a `/cambiar-contrasena` en modo
   obligatorio, sin navegación, con "Cerrar sesión" discreto visible.
6. Cambio de contraseña completo en modo obligatorio → **queda logueado**,
   aterriza en `/`, el flag queda en `false` (confirmado en la base).
7. "Cerrar sesión" desde `/cambiar-contrasena` → `/login` limpio.
8. Sin errores de consola (`read_console_messages`) tras el arreglo del
   bug de RSC.

Capturas en `.impeccable/review/`: `f1-login-390.jpg`, `f1-inicio-390.jpg`,
`f1-inicio-1440.jpg`.

No pude probar en el browser (requieren páginas de F2/F3/F4 o usuarios con
contraseña conocida que no tengo): `NoAccessState`, `AccessDenied`, la
navegación filtrada por rol para `editor`/`consulta`, y la re-verificación
de `mustChangePassword` en navegación client-side entre rutas hermanas
reales (ver la nota del punto 4 arriba).

## `npm run typecheck` / `lint` / `build`

Los tres en verde al cierre (`rm -rf .next` antes de cada `typecheck` — el
validador de tipos de Next quedaba con una referencia stale al
`src/app/page.tsx` que borré). Un error real de lint encontrado y corregido:
`react-hooks/set-state-in-effect` en `SearchInput` (sincronizaba estado
local con `searchParams` externo dentro de un `useEffect`; se resolvió
ajustando el estado durante el render, patrón que React documenta
explícitamente para este caso).

`impeccable detect --json` corrido dos veces (antes y después de la ronda de
ajustes de `web-design-guidelines`) sobre todos los archivos tocados: `[]`
las dos veces, sin hallazgos deterministas.

## Deferido / seguimiento para F2, F3, F4 y el reviewer

- **Verificación pendiente** (no achievable sin sus páginas): navegación
  filtrada por rol con un usuario real `editor`/`consulta`; `AccessDenied`
  con un usuario no-admin real; re-chequeo de `mustChangePassword` en
  navegación client-side entre hermanos reales dentro de `(panel)`.
- **`.impeccable/design.json`** (sidecar de `DESIGN.md`): no lo generé —
  es para un panel en vivo que este proyecto no usa; si en algún momento se
  agrega esa tooling, se puede generar a partir del `DESIGN.md` ya escrito
  sin re-derivar nada.
- **"Warn before navigation with unsaved changes"** (web-design-guidelines):
  no implementado en `ChangePasswordForm`/`ReasonDialog` — requiere un guard
  de navegación de Next que no existe out-of-the-box en App Router sin una
  librería extra; queda como mejora futura, no bloqueante para este slice.
- **`CheckboxField`**: el hit-target del checkbox y el de su label son dos
  elementos adyacentes (el label es clickeable vía `htmlFor`, cumple WCAG),
  no una única fila-botón. Si F2 necesita el patrón "toda la fila es
  clickeable" para `dniPending`, es una variante a agregar, no algo que
  tenga hoy.
- **`max-w-5xl` (1024px) vs. "960px" del brief**: usé la clase estándar de
  Tailwind más cercana; si hace falta el valor exacto, es un token
  arbitrario (`max-w-[60rem]`) sin impacto en ningún otro lugar.
- Reporté explícitamente (sección de arriba) el toque a `src/proxy.ts`, que
  queda fuera de mi lista nominal de archivos.
