# 02 — Desarrollo frontend: F-shell

Slice **F-shell** del pipeline `2026-09-28-ui-expresiva` (ver `00-architecture.md`
y el **Addendum del hilo principal** al final de `01-tasks.md`, que manda sobre
el cuerpo del documento). Implementa: shell del panel sobre el lienzo nuevo
(`--canvas`), los dos overlays globales montados en `AppShell`, el indicador de
navegación animado, el gesto de arrastre para cerrar `ResponsiveSheet` (D8/C6b)
y el pulido de las primitivas de `components/ui/**` que uso el resto de las
slices. `nav-items.ts` **no se tocó** (pedido explícito de Tomás, C6 no
aplica).

## Archivos

### `src/views/shell/app-shell.tsx`
- Monta `<PaymentOverlayHost />` y `<MemberQuickViewSheet />` (C7) **una sola
  vez**, fuera de `<main>`, envueltos en `<Suspense fallback={null}>`
  (`useOverlayParam` usa `useSearchParams`, que exige un límite de Suspense).
  Ambos ya existen con la firma congelada (verificado antes de importarlos):
  `src/views/payments/payment-overlay-host.tsx` y
  `src/views/members/member-quick-view-sheet.tsx`.
- Rediseño para el lienzo (`bg-canvas` en `body`, ya en `globals.css` del
  hilo principal, consumido tal cual):
  - Barra lateral de escritorio: pasó de `bg-sidebar`/`border-sidebar-border`
    (gris casi idéntico al lienzo nuevo, no se despegaba) a `bg-card`
    (blanco) + `border-border` — ahora sí se lee como superficie propia
    contra el gris de fondo.
  - Barra superior móvil y barra inferior: `bg-background/85 backdrop-blur-md`
    (antes `bg-background` opaco). Texto e íconos siguen en tinta/tinta-
    secundaria sólidas (nunca sobre el blur en sí), así que el contraste AA
    no se resintió — no hay texto pintado directamente sobre la superficie
    translúcida, solo sobre los glifos/labels de siempre.
- `<ViewTransition>` (React 19.2/Next 16, importado de `'react'`) envuelve
  `{children}` dentro de `<main>`. **Sin `name`**: activa el crossfade que ya
  vive en `globals.css` para `::view-transition-old(root)` /
  `::view-transition-new(root)` (180ms) en cada navegación entre páginas del
  panel — no hace falta nombrarlo porque no es un morph de un elemento
  puntual, es el crossfade de "cambió la página". Confirmado en
  `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`: **"View
  transitions work in the App Router with no configuration"** — no hace falta
  ningún flag en `next.config.ts` (ver sección "Para el hilo principal" abajo).
- Ahora envuelve todo en `<PanelSessionProvider>` (ver más abajo, pedido de
  seguimiento del hilo principal).
- `AppShellSession` ganó `permissions: Permission[]`.

### `src/views/shell/panel-session.tsx` (archivo nuevo, pedido de seguimiento)
Contexto + hooks para que los overlays globales (montados en `AppShell`,
fuera de cualquier `page`, sin props de sesión) sepan qué puede hacer el
usuario sin volver a pedir la sesión:

```ts
export function PanelSessionProvider({ permissions, children }): JSX.Element
export function usePanelPermissions(): Permission[]
export function useHasPermission(permission: Permission): boolean
```

`AppShell` lo monta una vez con `session.permissions`. `MemberQuickViewSheet`
y `PaymentOverlayHost` (dueños: F-socios/F-cobranza) pueden importar
`useHasPermission('payments.register')` desde `@/views/shell/panel-session`
para ocultar "Registrar pago" a `consulta`. **Esto es ocultar un botón, no la
defensa real** — la Server Action de registrar pago sigue verificando el
permiso del lado del servidor (`requirePermission`), que es lo único que
importa contra alguien que le pega a PostgREST directo.

`src/app/(panel)/layout.tsx` pasa `permissions: session.permissions` a
`AppShell` (antes solo mandaba `displayName`/`role`).

### `src/views/shell/nav-list.tsx`
- `DesktopNavList` y `BottomNavLink`: el fondo del ítem activo pasó de una
  clase condicional estática a `<motion.span layoutId="desktop-nav-indicator"
  | "mobile-nav-indicator">` (ids separados a propósito: las dos barras están
  siempre montadas —`hidden`/`md:hidden`—, un mismo id intentaría animar un
  salto entre ellas en un resize). Transición `SPRING_INDICATOR` (C1); con
  `useMotionPreference().reduced`, la misma transición baja a `duration: 0`
  (mismo resultado de color, sin desplazamiento espacial — pedido explícito
  del task: "reduced motion → color only").
- Barra inferior: `bg-background/85 backdrop-blur-md` (antes opaca), mismo
  criterio que la barra superior.
- `getNavItems`/`getMobileNav`/`REGISTRY` **sin tocar** (viven en
  `nav-items.ts`, fuera de mi slice).

### `src/views/shared/responsive-sheet.tsx` (C6b)
Gesto de arrastre para cerrar, sin cambiar las props públicas (`open`,
`onOpenChange`, `title`, `description`, `footer`, `children` — ~10
consumidores heredan esto gratis).

- El `<SheetContent>` de Radix queda **sin pintura propia**
  (`bg-transparent border-t-0 shadow-none p-0`, solo posiciona/recorta): todo
  lo visual (fondo, borde superior, sombra, radio) se movió a un
  `motion.div` interno. Motivo: si el fondo quedara en el contenedor de
  Radix (que no se traduce con el arrastre), arrastrar el handle dejaría un
  hueco blanco fijo arriba en vez de revelar el overlay de atrás — el
  contenedor de Radix no se movía, solo su contenido.
- El `motion.div` interno tiene `drag="y"` pero con `dragListener={false}` +
  `dragControls` (patrón oficial de `motion` para "un handle chico controla
  un elemento más grande"): el handle visual (una barrita de 40×6px arriba)
  solo dispara `dragControls.start(event)` en `onPointerDown`, nunca tiene
  `drag` propio — así no hay doble transform (handle + panel moviéndose cada
  uno por su cuenta) y `children` nunca compite por el gesto con su propio
  scroll interno (un formulario largo se sigue pudiendo desplazar con el
  dedo sin cerrar el sheet).
- `dragConstraints={{ top: 0 }}`, `dragElastic`, umbral de cierre en
  `onDragEnd`: `offset.y > 120px` o `velocity.y > 600px/s` → `onOpenChange(false)`;
  si no llega, `animate(dragY, 0, SPRING_OVERLAY)` (mismo resorte que el
  cierre, no un snap seco).
- `useMotionValue(0)` (`dragY`) se resetea a `0` cuando `open` pasa a `true`
  (no cuando pasa a `false`: resetear en el cierre pisaría la animación de
  salida de Radix, que mantiene el nodo montado durante
  `data-closed:animate-out`).
- `prefers-reduced-motion` (`useMotionPreference`): `drag={false}`, no se
  renderiza el handle, `style` sin `y` — cierre queda solo por botón/Esc/
  backdrop, como pide el piso de calidad.
- Handle con `aria-label="Arrastrar para cerrar"`. No lleva `role="button"`
  a propósito: no es operable por teclado (un gesto de arrastre no lo es en
  ningún sistema), así que darle un rol interactivo sin soporte de teclado
  sería una afirmación falsa para lectores de pantalla — el cierre accesible
  sigue siendo el botón X / Esc / backdrop, todos sin tocar.
- **Sin dependencia nueva**: `motion/react`, ya instalada (`vaul` descartada,
  D8).

### `src/components/ui/*` (primitivas compartidas)
- **`button.tsx`**: `transition-[color,background-color,border-color,box-shadow,transform]
  duration-150 ease-out-expo` (antes `transition-all`, sin curva propia).
  Presionado: `active:scale-[0.98]` sumado al `translate-y-px` que ya existía
  — la combinación es lo que distingue "el dedo está abajo" de un cambio de
  color. `ease-out-expo` es el token `--ease-out-expo` ya definido en
  `globals.css` (namespace `--ease-*` de Tailwind v4, genera la utilidad
  directo, no hace falta `ease-(--ease-out-expo)`).
- **`tabs.tsx`**: indicador activo con `layoutId` compartido (mismo mecanismo
  que `nav-list.tsx`, mismo `SPRING_INDICATOR`/`useMotionPreference` de C1),
  manteniendo la API de Radix intacta (`Tabs`, `TabsList`, `TabsTrigger`,
  `TabsContent`, `tabsListVariants`, mismos props). Como Radix no expone un
  hook de contexto público con el valor seleccionado, cada `TabsTrigger`
  detecta su propio `data-state` con un `MutationObserver` (más barato y más
  correcto que reimplementar la lógica de selección de Radix). Un
  `React.createContext` interno (no exportado) escopa el `layoutId` por
  árbol de `Tabs`, para que dos `<Tabs>` montados a la vez no compitan por el
  mismo id. El mismo `<motion.span>` sirve para las dos variantes (`default`:
  fondo lleno; `line`: barra inferior) vía los selectores
  `group-data-[variant=line]/tabs-list:` que ya existían en el archivo — se
  quitó el `::after` estático que hacía el subrayado de `line` antes (no se
  puede animar un pseudo-elemento con `motion`).
  **Pedido de seguimiento atendido**: `TabsList`/`TabsTrigger` pasaron de
  `h-8` (32px) a `h-11` (44px) — el piso de calidad no hace excepciones para
  "chico". Sin consumidores todavía en el repo (F-socios los agrega en este
  mismo pipeline para `member-detail-view.tsx`), así que no hay riesgo de
  regresión visual medible por mí — el criterio queda para `code-reviewer`.
- **`skeleton.tsx`**: `bg-muted` → `bg-border/70`. Dentro de un `Panel`
  blanco, `bg-muted` (#F7F7F8) es casi invisible contra `bg-card` (blanco);
  `--border` (#E5E7EB) da contraste real tanto sobre el panel como sobre el
  lienzo. **No implementé un shimmer de gradiente en movimiento** (solo el
  pulso de opacidad de Tailwind): eso necesita un `@keyframes`/`--animate-*`
  en `globals.css`, que no toco en este slice. Dejé la receta exacta
  comentada en el archivo — ver "Para el hilo principal" abajo si se quiere
  ese efecto más adelante.
- **`sonner.tsx`**: íconos de estado tintados con los mismos colores de
  `StatusPill` (`success` → `--status-up-to-date`, `error` → `--destructive`,
  `warning` → `--status-in-debt`) en vez de los colores default de la
  librería. `toastOptions.classNames` con `rounded-xl! shadow-lifted!
  border-border!` (sufijo `!`, sintaxis de "important" de Tailwind v4 —
  Sonner inyecta su propio `style` inline por toast, sin forzar la
  especificidad las clases no ganaban). `cn-toast` (la clase que ya estaba)
  no tenía ningún CSS asociado en ningún lado del repo ni de `shadcn/
  tailwind.css` — la dejé por si algo externo la usa, pero el estilo real
  ahora sale de las clases nuevas.
- **`dialog.tsx` / `alert-dialog.tsx` / `sheet.tsx`**: entrada/salida con las
  curvas de C1 en vez de los defaults de `tw-animate-css`: `duration-[350ms]
  ease-out-expo` al abrir (`EASE_ENTER`), `duration-200 ease-in` al cerrar
  (`EASE_EXIT` = `cubic-bezier(.4,0,1,1)`, que es exactamente el `ease-in`
  built-in de Tailwind — no hizo falta un token nuevo). Escala de
  `zoom-in-95`/`zoom-out-95` (95%) a `zoom-in-[.97]`/`zoom-out-[.97]` (97%,
  pedido del task: "scale .97→1"). Mismo tratamiento en los tres para que un
  diálogo, una confirmación y un sheet lateral se sientan del mismo sistema.

### `src/views/shared/page-header.tsx`
`tracking-tight` en el `h1` — el piso de tracking del craft-floor
("display tracking floor -0.04em") no se estaba aprovechando en el título de
página. Sin cambios estructurales (el ritmo grande entre header y el primer
`Panel` lo da el `gap-4` de `AppShell`, que no es mío tocar acá; dentro del
propio componente no había mucho más margen sin inventar un padding que no
pidió nadie).

### `src/views/shared/status-pill.tsx`
`transition-colors duration-150`: un pago que se registra y cambia "Con
deuda" → "Al día" en el mismo `router.refresh()` ahora se ve cambiar de
color en vez de saltar de golpe. Sin cambiar variantes ni el criterio de
"nunca solo color" (el punto + el texto siguen ambos).

### `src/app/(panel)/loading.tsx` y `error.tsx`
Verificado que **son exclusivos de `/`**: todas las demás rutas del panel
(`socios`, `socios/[id]`, `cobranza`, `cobranza/nuevo`, `ajustes`,
`usuarios`, `auditoria`) tienen su propio `loading.tsx`/`error.tsx` más
específico, así que Next nunca usa estos dos para otra cosa (confirmado con
`find`). Actualicé el esqueleto de `loading.tsx` para aproximarse a la nueva
forma del panel inicial (saludo+buscador, cifra hero, franja del mes, lista
de deudores, gráfico de evolución, resumen del padrón) en vez del esqueleto
genérico de antes — mismo orden que el contenido real (operate.md). `error.tsx`
ganó un contenedor centrado (`min-h-[50vh] flex items-center justify-center`)
para no verse pegado arriba en una pantalla vacía.

### `src/app/layout.tsx`
`viewport.themeColor`: `#FFFFFF` → `#F5F5F4` (el lienzo nuevo) — la barra del
navegador en iOS/Android ahora coincide con el fondo real de la página
(craft-floor: "browser surfaces still carry the design").

## Para el hilo principal

1. **`next.config.ts` — no hace falta tocarlo para `ViewTransition`.**
   Verificado en `node_modules/next/dist/docs/01-app/02-guides/view-
   transitions.md`: "View transitions work in the App Router with no
   configuration" (React 19.2 canary ya integrado en Next 16, sin flag
   `experimental.viewTransition`). El repo tiene React 19.2.8 público (sin
   `ViewTransition` exportado en `node_modules/react`), pero Next alía
   `'react'`/`'react-dom'` a su propio build vendorizado
   (`node_modules/next/dist/compiled/react`, que sí lo exporta) para el
   código de `app/**` — confirmado que `tsc --noEmit` del repo entero
   compila limpio con `import { ViewTransition } from 'react'` en
   `app-shell.tsx` gracias a que `@types/react` (19.3.0) ya tipa
   `ViewTransition`.
2. **Shimmer de skeleton (opcional, no bloqueante)**: si se quiere un
   gradiente que se desplaza en vez del pulso de opacidad actual, agregar a
   `globals.css`:
   ```css
   @theme inline { --animate-shimmer: shimmer 1.8s ease-in-out infinite; }
   @keyframes shimmer {
     from { background-position: 200% 0 }
     to { background-position: -200% 0 }
   }
   ```
   y cambiar `skeleton.tsx` a `bg-gradient-to-r from-border/50 via-border
   to-border/50 bg-[length:200%_100%] animate-shimmer motion-reduce:animate-none
   motion-reduce:bg-border/70`. No lo hice yo porque no toco `globals.css`
   en este slice.

## Contratos consumidos (sin editar)

`views/shared/{motion.ts, overlay-params.ts, hero-figure.tsx, chart-kit.tsx,
panel.tsx, data-list.tsx, states.tsx}`, `globals.css`, `nav-items.ts`. Usé
`SPRING_INDICATOR`, `useMotionPreference`, `SPRING_OVERLAY` de `motion.ts`
(C1) y los tokens `--ease-out-expo`/`--canvas`/`--shadow-raised`/
`--shadow-lifted` ya definidos en `globals.css`. `PaymentOverlayHost` y
`MemberQuickViewSheet` se importaron por la ruta/firma congelada de C7,
verificando el export real de cada archivo antes de usarlo (ambos ya
existían al momento de integrar).

## Primitivas nuevas agregadas a `src/views/shell/`

`panel-session.tsx` (`PanelSessionProvider`, `usePanelPermissions`,
`useHasPermission`) — pedido de seguimiento del hilo principal, no estaba en
`01-tasks.md` original. Vive en `views/shell/` (no en `views/shared/`) porque
es específico de cómo `AppShell` resuelve y reparte la sesión, no un
primitivo de presentación reusable fuera del shell.

## Comportamiento visible / accesibilidad implementados

- Overlays de pago y vista rápida del socio sobreviven a la navegación entre
  páginas hermanas del panel sin remontarse (montados fuera de `main`).
- Navegación (lateral y barra inferior): el indicador del destino activo se
  desliza con un resorte entre ítems; con "reducir movimiento" del sistema,
  el cambio es instantáneo (solo color), nunca desaparece la señal de "acá
  estás".
- Transición entre páginas del panel: crossfade corto (180ms), sin
  coreografía; respeta `prefers-reduced-motion` (ya resuelto en
  `globals.css`, heredado).
- `ResponsiveSheet` en móvil: arrastrar el handle hacia abajo lo suelta con
  resorte si no llega al umbral, o cierra el sheet si supera 120px u
  600px/s. Esc, el botón de cerrar y el backdrop siguen cerrando sin usar el
  drag. Con "reducir movimiento", no hay handle ni drag: cierre solo por
  esos tres caminos.
- Diálogos, confirmaciones y sheets abren/cierran con una curva consistente
  en todo el sistema (Linear-esque: entrada confiada, salida rápida).
- Toasts con iconografía de estado consistente con el resto del sistema
  (mismos colores que `StatusPill`).
- Pestañas (`Tabs`) con indicador animado, targets de 44px, API de Radix sin
  cambios — usable con teclado (Radix ya maneja foco/flechas, sin tocar) y
  con `prefers-reduced-motion` (indicador salta sin animar, mismo color).
- `usePanelPermissions()`/`useHasPermission()` disponibles para que los
  overlays globales oculten acciones según el rol — ocultar es UX, la
  defensa real sigue siendo `requirePermission`/RLS del lado del servidor.

## Verificación

`npm run typecheck` (repo completo, 0 errores) y `npx eslint` sobre los 16
archivos de este slice (0 errores/warnings) — corridos varias veces según
avanzaban en paralelo B1/F-cobranza/F-socios, que crean los dos overlays de
C7 que `app-shell.tsx` importa. No corrí `next build`/`next dev` (no me
corresponde verificar visualmente; lo hace el hilo principal).

## Corrección post-review (mismo día)

`code-reviewer` marcó dos problemas reales en el handle de arrastre de
`responsive-sheet.tsx`: el área de toque medía ~18-24px (por debajo del piso
de 44px) y el `aria-label` vivía en un `<div>` sin rol, que no se anuncia de
forma confiable en el árbol de accesibilidad. Arreglado:

- El handle pasó de `<div aria-label="Arrastrar para cerrar">` a un
  `<button type="button" aria-label="Cerrar" onClick={() => onOpenChange(false)}>`
  real — nombre accesible confiable + foco/Enter/Espacio nativos del
  elemento `button`, sin reimplementar manejo de teclado a mano.
- Área de toque `h-11` (44px); el pill visible (`h-1.5 w-10`) sigue siendo el
  mismo indicador chico de antes, centrado dentro del botón.
- El `onPointerDown` que dispara `dragControls.start(event)` convive con el
  `onClick` sin pisarse: `motion` solo cuenta como arrastre un movimiento que
  supera un pequeño umbral de píxeles, así que un tap simple (sin mover el
  dedo) deja pasar el `click` nativo del botón con normalidad.
- Confirmado `npm run typecheck` (repo completo, 0 errores) y
  `npx eslint src/views/shared/responsive-sheet.tsx` (0 errores/warnings)
  después del cambio.

## Scroll contenido en escritorio (mismo día, pedido de Tomás)

`src/views/shell/app-shell.tsx`: en `md+` el documento ya no scrollea — la
lateral queda fija y el scroll vive en la columna de contenido. Móvil sin
cambios (scroll del documento, barra superior `sticky`, inferior `fixed`): a
propósito, en iOS la barra de direcciones solo se colapsa con scroll del
documento, no de un contenedor interno.

- Raíz: `min-h-dvh md:flex` → `md:h-dvh md:overflow-hidden` (fija el layout
  al viewport en escritorio, sin afectar el alto natural en móvil).
- `<aside>`: `md:h-dvh` (alto fijo al viewport, no al contenido); se sacó el
  `overflow-y-auto` del bloque de navegación — nunca scrollea (5-6 destinos
  como mucho, siempre entran) — y se le puso `min-h-0` para que un `flex-1`
  no empuje al `UserMenu` fuera de vista si algún día no entrara. Header del
  escudo y footer del `UserMenu` ganaron `shrink-0` explícito.
- Columna de contenido (el `div` que envuelve `<header>` móvil + `<main>` +
  `<MobileBottomNav>`): `md:h-dvh md:overflow-y-auto` — es el nuevo
  contenedor de scroll real en escritorio. Sumé
  `md:[scrollbar-gutter:stable]` (una página sin scroll y una con scroll ya
  no mueven el contenido centrado unos píxeles al navegar) y un scrollbar
  fino temático, sin tocar `globals.css` (arbitrario en el propio elemento):
  `scrollbar-width:thin` + `scrollbar-color` (Firefox) y
  `::-webkit-scrollbar{,-thumb,-track}` (Chrome/Safari), thumb en
  `--border`, pista transparente — nunca el gris de scrollbar por defecto
  del navegador (craft-floor, "browser surfaces still carry the design").

**Verificado qué más dependía de scroll de ventana en escritorio:**
- `router.push(href, { scroll: false })` de `overlay-params.ts` (C2, no lo
  edito): `scroll: false` solo le dice a Next que NO gestione scroll al
  abrir/cerrar un overlay — no asume dónde vive ese scroll, así que sigue
  sin problema con el contenedor nuevo.
- Restauración de scroll de Next en la navegación normal (sin `scroll:
  false`): confirmado en `node_modules/next/dist/docs/01-app/03-api-
  reference/02-components/link.md` ("Next.js checks if `scroll: false`... it
  identifies the relevant DOM node for navigation and inspects each
  top-level element... continues through siblings until it identifies a
  **scrollable element** that is visible in the viewport") — el algoritmo
  busca el ancestro scrolleable real, no asume `window`, así que encuentra
  la columna de contenido sola.
- `grep -rn "scrollTo\|scrollIntoView\|sticky" src/views src/app`: un solo
  uso real, `src/views/payments/cobranza-tabs.tsx` (`activeRef.current
  ?.scrollIntoView({ inline: 'nearest', block: 'nearest', ... })` — dueño:
  F-cobranza, no lo toco). Ya usa `block: 'nearest'`, que no fuerza scroll
  vertical de página/contenedor si el elemento ya es visible — compatible
  tal cual con el nuevo contenedor, sin cambios necesarios. Ningún otro
  `window.scrollTo` ni elemento `sticky` fuera del `<header>` móvil (que ya
  contemplaba este cambio) en todo `src/views`/`src/app`.

Verificado `npm run typecheck` (repo completo, 0 errores) y `npx eslint
src/views/shell/app-shell.tsx` (0 errores/warnings) después del cambio.

## Deferrals / hallazgos que no me corresponden

- El finding pre-existente de `impeccable` en `button.tsx` (`text-[0.8rem]`
  en la variante `sm`, fuera de la escala de 12/14/16/20/24px) ya estaba
  antes de este slice — no lo toqué porque no es parte del pedido y no quise
  cambiar el tamaño de un botón existente sin que alguien lo pida
  explícitamente. Queda para quien audite el piso de calidad completo.
- El botón de cerrar (X) de `SheetContent` sigue posicionado `absolute
  top-3 right-3` contra el contenedor de Radix (que ya no tiene fondo
  propio): en reposo coincide visualmente con la esquina del panel interno,
  pero durante un arrastre activo se queda fijo en su lugar mientras el
  contenido se desliza debajo — deliberado (más simple, y nadie mira el
  botón de cerrar mientras arrastra), documentado acá por si el
  `code-reviewer` lo señala.
