# 01 — Tareas: UI expresiva (flujo, charts y motion)

Depende de `00-architecture.md` — no se repiten acá los porqués, solo el qué,
quién y cómo se prueba. **El hilo principal corre `npm install motion` antes
de Ola 0** (`recharts` ya está en `package.json`; `motion` no — §3.4 de
`00-architecture.md`). Ningún agente (ni de Ola 0 ni de Ola 1) instala
dependencias, escribe migraciones, ni resetea la base. El corte de archivos es
por directorio: dos agentes nunca escriben en el mismo archivo.

## Orden de ejecución

```
Ola 0 (hilo principal, contratos) ──▶ Ola 1 (frontend × 4 + backend × 2, en paralelo)
                                          │
                                          ▼
                                   test-engineer + code-reviewer (en paralelo)
```

`F0` (comps del inicio antes del build completo) es **condicional**: solo
corre si Tomás confirma la pregunta 2 de `00-architecture.md` §11. Si no la
confirma, Ola 1 arranca directo con la especificación de este documento.

---

## Ola 0 — Contratos (hilo principal, antes de repartir)

No son tareas de agente. Se aplican una sola vez y de eso depende que las
cuatro slices de Ola 1 no inventen cada una su propia forma para lo mismo.

### C1 — `src/views/shared/motion.ts` (archivo nuevo)

Vocabulario de motion único, consumido por las 4 slices de frontend. Sin
componentes, sin JSX — solo constantes, un tipo y un hook:

```ts
export const DURATION = { feedback: 0.12, state: 0.2, overlay: 0.35, focal: 0.6 } // segundos, para motion
export const EASE_ENTER = [0.16, 1, 0.3, 1] as const   // llegada, confiada, sin rebote
export const EASE_EXIT = [0.4, 0, 1, 1] as const        // salida, más rápida que la entrada
export const SPRING_OVERLAY = { type: 'spring', stiffness: 380, damping: 32 } // cierre del sheet

/** Wrapper sobre `useReducedMotion` de `motion/react`: además de la lectura
 *  boolean ya provista por la librería, expone `motionProps(full, reduced)`
 *  que devuelve `reduced` (sin desplazamiento espacial) cuando el sistema lo
 *  pide, sin que cada componente reimplemente el `if`. */
export function useMotionPreference(): { reduced: boolean; pick: <T>(full: T, reduced: T) => T }
```

### C2 — `src/views/shared/overlay-params.ts` (archivo nuevo)

El contrato más importante de todo el pipeline: es lo único que decide si el
botón atrás cierra un overlay compartido de forma segura. Firma exacta:

```ts
/** Lee/escribe UN query param de la URL actual sin tocar los demás. Abrir
 *  (`set`) usa `router.push` y deja una marca propia en `history.state`
 *  (p. ej. `{ __overlay: name }`) para que `useCloseOverlay` sepa que ESTE tab
 *  empujó esa entrada. */
export function useOverlayParam(name: string): {
  value: string | null
  set: (value: string) => void
  clear: () => void
}

/** Cierra el overlay `name`: si `history.state.__overlay === name` (esta
 *  pestaña lo abrió), hace `router.back()`; si no (deep-link, refresh, o el
 *  usuario borró el param a mano), hace `router.replace()` quitando el param.
 *  Nunca deja a alguien "atrapado": si no hay overlay abierto, es un no-op. */
export function useCloseOverlay(name: string): () => void
```

**Criterio de aceptación no negociable** (lo prueba `test-engineer` con
Testing Library + `MemoryRouter`/mocks de `next/navigation`, no requiere
base de datos): abrir con `set`, cerrar con el resultado de `useCloseOverlay`
en la MISMA sesión de navegación → el historial vuelve a la entrada anterior
(`back()`). Montar el hook con el param YA presente en la URL (simulando un
deep-link) y cerrar → usa `replace()`, nunca `back()` (que sacaría a la
persona de la app o a una página anterior ajena al overlay).

### C3 — `src/views/shared/hero-figure.tsx` (archivo nuevo)

```ts
export function HeroFigure(props: {
  label: string
  /** Ya formateado (`formatCentsCompact` u otro) — el componente no conoce `money.ts`. */
  value: string
  href?: string
  /** Cuenta desde 0 una sola vez por `sessionKey` (usa `sessionStorage`); en
   *  renders siguientes con la misma key, muestra `value` directo. */
  countUp?: { sessionKey: string }
}): React.ReactElement
```

Tipografía **proporcional** (nunca `tabular-nums`) a ≥48px, `label` en el
tamaño de `label`/`body-sm` de `DESIGN.md` arriba del valor — es un stat-tile,
no un kicker (`00-architecture.md` §3.6): la distinción entre los dos la debe
poder explicar cualquier agente que lo use, así que va en el JSDoc del
componente.

### C4 — `src/views/shared/chart-format.ts` (archivo nuevo)

Extrae de `history-chart.tsx` (sin cambiarle el comportamiento) el
formateador de ticks del eje en notación compacta (`formatAxisTick`, hoy
privado ahí) y el estilo/markup base del tooltip (`role="status"`,
`aria-live="polite"`, la clase de sombra flotante-baja de `DESIGN.md`). Sirve
para que `category-debt-chart.tsx` (C5) no reinvente el mismo tooltip con otra
sombra.

### C5 — `src/views/payments/category-debt-chart.tsx` (archivo nuevo)

El único chart nuevo que consumen DOS slices de frontend a la vez (inicio y
cobranza) — por eso se fija acá y no dentro de ninguna de las dos. Sigue
`00-architecture.md` D4: magnitud → forma de barra, un solo hue secuencial
(reusar `--color-status-in-debt`, nunca una paleta categórica de 8 tonos: la
"identidad" de cada categoría ya la da el texto de la fila, no hace falta un
color por categoría).

```ts
export function CategoryDebtChart(props: {
  rows: DebtByCategoryRow[]        // ya tipado en models/types.ts, sin cambios
  variant: 'compact' | 'full'
  /** compact: barra inline detrás de cada fila (para el panel "Padrón" del inicio).
   *  full: recharts BarChart horizontal real, ordenado desc, arriba de una
   *  DataList — la propia DataList existente en `debt-by-category-view.tsx`
   *  queda como la tabla accesible equivalente que pide `dataviz`. */
})
```

`variant="compact"` reemplaza uno a uno `CategoryRow` en
`src/views/dashboard/padron-rows.tsx` (import de solo lectura desde el slice
de inicio); `variant="full"` se monta en `debt-by-category-view.tsx` (slice
de cobranza, que además es dueño del archivo).

### C6b — `src/views/shared/responsive-sheet.tsx`: gesto de cierre por arrastre (D8)

Contrato + implementación, hecho por el hilo principal (o delegado a una
tarea corta y dedicada de Ola 1 si el hilo principal prefiere no escribir la
interacción de gesto a mano — pero NUNCA repartido junto con F-cobranza o
F-socios, que solo lo consumen). Sin cambio de props públicas de
`ResponsiveSheet` (`open`, `onOpenChange`, `title`, `description`, `footer`,
`children`): la rama `< md` gana un handle arrastrable
(`motion.div drag="y" dragConstraints={{ top: 0 }} dragElastic`) que llama
`onOpenChange(false)` al superar un umbral de desplazamiento/velocidad en
`onDragEnd`. El `drag` se acota al handle visual de arriba del sheet, nunca a
`children` completo (evita competir con el scroll interno de un formulario
largo). Handle con `aria-label` ("Arrastrar para cerrar"); `Esc` y el botón de
cerrar existente siguen funcionando sin tocar el drag (nunca el único
camino). Con `prefers-reduced-motion`, el `drag` se desactiva
(`useMotionPreference` de C1) y el cierre queda solo por botón/`Esc`/backdrop.
Se hereda gratis en los ~10 consumidores existentes de `ResponsiveSheet`
(sheets de ajustes, el overlay de pago, la vista rápida) sin que ninguno de
ellos lo toque. Sin dependencia nueva (`vaul` queda descartada, D8).

### C6 — `src/views/shell/nav-items.ts`: reorden (D7)

Reordenar `REGISTRY` a Inicio (rank 0) → Socios (1) → Cobranza (2) → Usuarios
(3) → Ajustes (4) → Auditoría (5). Un diff de una línea por destino, cero
lógica nueva (`getNavItems`/`getMobileNav` no cambian). Se hace acá y no en
Ola 1 para que ningún agente de frontend dependa de en qué orden termina la
navegación.

### C7 — Firma congelada de los dos overlays globales

Para que `app-shell.tsx` (Ola 1, F-shell) pueda escribir su JSX sin esperar a
que F-cobranza y F-socios terminen sus componentes, se congela ACÁ el nombre,
la ruta de archivo y la firma (cero props, cada uno lee su propio query param
con C2):

```ts
// src/views/payments/payment-overlay-host.tsx (dueño: F-cobranza)
export function PaymentOverlayHost(): React.ReactElement | null

// src/views/members/member-quick-view-sheet.tsx (dueño: F-socios)
export function MemberQuickViewSheet(): React.ReactElement | null
```

Con C1-C7 aplicados (y commiteados aparte si hace falta un checkpoint), arranca
Ola 1.

---

## F0 — Comps del inicio (condicional, ver pregunta 2 de `00-architecture.md`)

- **Lane:** `frontend-react-craftsman`, corre SOLO antes de F-inicio y solo si
  Tomás lo confirma.
- **Objetivo:** 2-3 propuestas estáticas (no interactivas) del panel inicial
  con la cifra hero + los dos charts nuevos, mismo proceso que ya se usó para
  la versión actual del inicio (`impeccable shape`, comp elegido por Tomás
  2026-09-28 — repetirlo, no inventar un proceso nuevo).
- **Salida:** las propuestas + la elegida por Tomás quedan documentadas en
  `.impeccable/surfaces/route.md` (sección de decisión), igual que la ronda
  anterior. F-inicio arranca recién con la propuesta elegida, no con este
  documento a ciegas.
- **Skills:** `impeccable` (`reference/shape.md`).
- Si Tomás NO confirma esta tarea, F-inicio usa directamente la especificación
  de D4/§8 de `00-architecture.md`.

---

## Ola 1 — Paralela, sin archivos compartidos

### F-shell — Shell: overlays montados, nav, motion del indicador activo

- **Lane:** `frontend`.
- **Archivos propios:** `src/views/shell/app-shell.tsx`, `src/views/shell/nav-list.tsx`.
- **No toca:** `nav-items.ts` (ya resuelto en C6), ningún archivo de
  `views/payments/**` o `views/members/**` (solo IMPORTA los dos componentes
  de C7).
- **Contratos a honrar:** C1 (motion), C7 (los dos overlays, cero props).
- **Objetivo y criterios de aceptación:**
  - `AppShell` monta `<PaymentOverlayHost />` y `<MemberQuickViewSheet />` una
    sola vez (no dentro de `main`, para que sobrevivan a la navegación entre
    páginas hermanas sin remontarse — ver riesgo de layouts que no se
    re-ejecutan, CLAUDE.md).
  - El indicador del destino activo (barra lateral y barra inferior) anima su
    posición con `motion` (`layoutId` compartido entre ítems) en vez de
    aparecer/desaparecer de golpe; con `prefers-reduced-motion` se recorta a
    un cambio de color sin desplazamiento (usa `useMotionPreference` de C1).
  - Ningún cambio de comportamiento de navegación fuera de la animación del
    indicador: los hrefs, el filtro por rol y el algoritmo de `getMobileNav`
    no se tocan.
- **Dependencias:** C1, C7. No depende de que F-cobranza/F-socios hayan
  TERMINADO sus componentes — solo de que existan como archivos con la firma
  de C7 (el `tsc` del final del pipeline es quien verifica que compilan
  juntos).
- **Fuera de alcance:** cualquier cambio a `nav-items.ts` (ya está en C6).
- **Skills:** `impeccable` (`reference/craft-floor.md`, `reference/animate.md`), `vercel-react-best-practices`.

### F-inicio — Panel inicial: hero figure, charts, stagger

- **Lane:** `frontend`.
- **Archivos propios:** todo `src/views/dashboard/**`
  (`dashboard-header.tsx`, `dashboard-content.tsx`, `money-summary-strip.tsx`,
  `padron-rows.tsx`, `debt-rows.tsx`, `history-chart.tsx`, `month-rows.tsx`,
  `priority-extras.tsx`, `dashboard-helpers.ts`, `history-table.tsx`,
  `run-failed-notice.tsx`, `billing-inactive-notice.tsx`), `src/app/(panel)/page.tsx`
  si hace falta un ajuste menor. `.impeccable/surfaces/route.md` (sección del
  panel inicial y el anti-objetivo de shell de "métrica-héroe", ver
  `00-architecture.md` §10).
- **No toca:** `src/views/payments/**` (solo IMPORTA `CategoryDebtChart` de
  C5, `variant="compact"`, sin modificarlo), `src/views/members/**`,
  `src/views/shell/**`.
- **Contratos a honrar:** C1 (motion), C3 (`HeroFigure`), C4 (`chart-format.ts`),
  C5 (`CategoryDebtChart`, solo lectura).
- **Objetivo y criterios de aceptación:**
  - Chip "Pago" de `dashboard-header.tsx` deja de ser `<Link href="/cobranza/nuevo">`:
    usa `useOverlayParam('pagar').set('buscar')` (C2). Chip "Alta" NO cambia
    (sigue siendo navegación real a `/socios/nuevo` — no está en el alcance
    de overlays, `00-architecture.md` D1).
  - `MoneySummaryStrip` se reescribe sobre `HeroFigure`: "Deuda total" es la
    cifra hero (`href="/cobranza/deuda"`, todo número sigue siendo un link),
    con `countUp={{ sessionKey: 'inicio-deuda-total' }}` — cuenta una sola vez
    por sesión de browser, no en cada visita a `/` (criterio verificable:
    montar dos veces en el mismo `sessionStorage` → la segunda vez el valor
    aparece de una, sin animación de conteo). "Cobrado en \<mes\>... (%)" baja
    a una fila compacta al lado/debajo, mismo contenido que hoy, menor
    jerarquía visual.
  - "Qué hay que resolver" → `TopDebtorsList`: entrada en stagger (delay entre
    filas, techo total ≤ 400ms combinado — son 5 filas como mucho, no hace
    falta más). Con `prefers-reduced-motion`, aparecen sin stagger (opacidad
    directa). Cada `TopDebtorRow` (`debt-rows.tsx`) deja de ser un `<Link>`
    directo a `/socios/[id]`: sigue siendo un enlace real (accesibilidad,
    modificadores, clic medio) pero un click plano hace `preventDefault` y
    abre `?ver=<id>` (vista rápida, mismo hook `useOverlayParam` de C2, mismo
    patrón que F-socios usa en `member-list.tsx` — no lo reinventa acá).
  - `HistoryChart` gana `isAnimationActive` gateado a "primer montaje de esta
    instancia" (no en cada re-render por hover — la trampa de recharts
    documentada en `00-architecture.md` §5.3), `animationDuration` en el rango
    `focal` de C1 (600ms). Con `prefers-reduced-motion`, `isAnimationActive={false}`.
  - Panel "Padrón": `CategoryList`/`CategoryRow` migran a
    `<CategoryDebtChart rows={byCategory} variant="compact" />`. El
    `<details>` de "ver las N categorías restantes" se conserva si no entran
    todas en el primer scroll (mismo criterio que hoy).
  - Ningún panel queda anidado dentro de otro (piso de calidad, sin cambios).
  - `route.md` actualizado: la sección "Forma" del panel inicial ya no dice
    "Sin tarjetas de número grande" — describe la cifra hero + charts como
    quedaron construidos.
- **Dependencias:** Ola 0 completa. No depende de F-cobranza/F-socios.
- **Fuera de alcance:** tocar `dashboard_summary`/`monthly_history`/
  `debt_by_category` (RPCs sin cambios, `00-architecture.md` §7.5); agregar
  una RPC nueva para una serie diaria/semanal (no pedido, fuera de alcance).
- **Skills:** `impeccable` (`reference/operate.md`, `reference/animate.md`,
  `reference/craft-floor.md`), `dataviz` (antes de tocar `HistoryChart` o
  montar `CategoryDebtChart`), `vercel-react-best-practices`,
  `web-design-guidelines` antes de cerrar.

### F-cobranza — Hub, overlay de pago, listados

- **Lane:** `frontend`.
- **Archivos propios:** todo `src/views/payments/**` (incluye crear
  `payment-overlay-host.tsx`, `member-picker.tsx`, extender
  `register-payment-sheet.tsx`, `category-debt-chart.tsx` YA CREADO en C5 —
  acá se usa, no se recrea —, reescribir `cobranza-hub-view.tsx`,
  `debt-by-category-view.tsx`, y el pulido de motion de
  `month-payments-view.tsx`/`member-accounts-listing-view.tsx`; BORRAR
  `payment-form-page.tsx`), `src/app/(panel)/cobranza/**` (reescribir
  `nuevo/page.tsx` como redirect puro, borrar `nuevo/loading.tsx`).
  `.impeccable/surfaces/route-cobranza.md`.
- **No toca:** `src/views/members/**`, `src/views/dashboard/**`,
  `src/views/shell/**`.
- **Contratos a honrar:** C1, C2, C4, C5 (ya construido en Ola 0), C7
  (`PaymentOverlayHost` con la firma congelada).
- **Objetivo y criterios de aceptación:**
  - `PaymentOverlayHost`: lee `?pagar=` con `useOverlayParam('pagar')` (C2).
    Tres modos por el valor: `buscar` (muestra `MemberPicker`), `socio:<id>`,
    `grupo:<id>` (ambos delegan directo en `RegisterPaymentSheet` con el id
    parseado). Valor inválido o ausente → no renderiza nada (`null`).
  - `MemberPicker`: input con debounce sobre `searchMembers` (Server Action ya
    existente, sin cambios); al tocar un resultado, hace
    `useOverlayParam('pagar').set('socio:' + id)` — NO cierra y reabre el
    sheet, la transición entre "buscar" y "socio:id" es una animación de
    `AnimatePresence` (`state`, 200-300ms) dentro del mismo overlay ya abierto.
  - `RegisterPaymentSheet`: `onDone` deja de llamar a un `router.push` fijo —
    usa `useCloseOverlay('pagar')()` y `router.refresh()`. El pago de grupo
    familiar (`GroupPaymentForm`) sigue andando sin cambios internos (el
    componente ya es agnóstico de cómo se abrió — **criterio de regresión
    explícito**: un pago de grupo con 3+ integrantes marcados, montos
    editados por fila, se registra igual que hoy, un `payments` por socio con
    el mismo `batch_id`).
  - `cobranza-hub-view.tsx`: el panel "Registrar pago" con buscador propio
    desaparece — un botón (`payments.register`) hace
    `useOverlayParam('pagar').set('buscar')`. "Este mes" gana `HeroFigure`
    para "Cobrado en \<mes\>" + una barra apilada de 2 segmentos
    (efectivo/transferencia, etiqueta directa en cada uno, sin leyenda
    aparte). "Listados" pasa de filas-con-chevron a una barra de pestañas
    visual (`components/ui/tabs.tsx` reestilizado como navegación, cada
    "tab" es un `<Link>` real a su ruta — **criterio de aceptación**: click
    del medio / `Cmd+click` abre en pestaña nueva, igual que cualquier link;
    el indicador de tab activa anima su posición con `motion`, mismo
    mecanismo que F-shell usa en la navegación principal, mismo módulo C1).
  - `/cobranza/nuevo/page.tsx`: se reescribe para `redirect()` (servidor, sin
    JS) a la URL de vuelta (`volver` saneado con `safeRedirectPath`, ya
    existe) con `?pagar=socio:<id>` o `?pagar=grupo:<id>` agregado — nunca
    renderiza `PaymentFormPage` (que se borra). Un link viejo guardado
    (`/cobranza/nuevo?socio=5&volver=/socios/5`) sigue funcionando: abre
    `/socios/5` con el overlay ya abierto.
  - `debt-by-category-view.tsx`: monta `<CategoryDebtChart rows={rows} variant="full" />`
    arriba de la `DataList` existente, que se conserva tal cual (es la tabla
    accesible que pide `dataviz`).
  - `route-cobranza.md` actualizado según `00-architecture.md` §10.
- **Dependencias:** Ola 0 completa (necesita C5 ya escrito, no solo su firma).
- **Fuera de alcance:** cualquier cambio a `registerPayment`/`voidPayment`/
  `getPaymentFormData` (controllers/actions sin cambios de firma ni de
  cuerpo — esto es una tarea de vista, no de backend); convertir los 4
  listados en tabs de una sola página (D3, es la recomendación pero NO la
  decisión cerrada — no reestructurar los `page.tsx` de `pagos`/`deuda`/
  `al-dia`/`por-categoria` más allá de que ahora se navega entre ellos con la
  barra de pestañas).
- **Skills:** `impeccable` (`reference/operate.md`, `reference/animate.md`,
  `reference/craft-floor.md`), `dataviz` (para `CategoryDebtChart` full y la
  barra apilada), `supabase` (no toca schema, pero lee `MemberAccount`/
  `PaymentFormData` tal como los expone `payments.controller.ts`),
  `vercel-react-best-practices`, `web-design-guidelines` antes de cerrar.

### F-socios — Vista rápida, padrón, ficha en pestañas

- **Lane:** `frontend`.
- **Archivos propios:** todo `src/views/members/**` (incluye crear
  `member-quick-view-sheet.tsx`, editar `member-list.tsx`,
  `member-account-section.tsx`, reorganizar `member-detail-view.tsx`),
  `src/app/(panel)/socios/**` (ajustes menores si hacen falta, sin tocar
  `getPadron`/`parseFilters`). `.impeccable/surfaces/route-socios.md` y
  `route-socios-id.md`.
- **No toca:** `src/views/payments/**` (usa `useOverlayParam('pagar')` de C2
  para abrir el overlay de pago desde la ficha — nunca importa nada de
  `payments/` para eso), `src/views/dashboard/**`, `src/views/shell/**`.
- **Contratos a honrar:** C1, C2, C7 (`MemberQuickViewSheet`, dueño de esta
  tarea).
- **Objetivo y criterios de aceptación:**
  - **Backend nuevo que esta tarea CONSUME** (ver B1 más abajo):
    `getMemberQuickView(memberId)` en `members.actions.ts`, ya con permiso
    chequeado — la vista no vuelve a chequear el permiso, pero SÍ maneja el
    caso `ActionResult` de error (sin socio encontrado, sin permiso) con un
    estado de error propio, nunca un throw sin capturar.
  - `MemberQuickViewSheet`: lee `?ver=<id>`, pide `getMemberQuickView`,
    muestra nombre, `StatusPill`, categorías (`categoriesLabel`, ya existe),
    `accountLineText` (ya existe, reusado tal cual — **nunca** un segundo
    formato de la línea de cuenta), último pago, y 3 acciones: "Registrar
    pago" (`useOverlayParam('pagar').set('socio:' + id)` — **reemplaza** `ver`
    por `pagar`, nunca los dos a la vez, D2), "WhatsApp"
    (`WhatsAppLink`, ya existe, solo si hay teléfono), "Ver ficha completa"
    (`<Link href="/socios/[id]">` real, cierra el sheet al navegar).
  - `member-list.tsx`: la fila sigue siendo un `<a>`/`<Link>` real con
    `href="/socios/[id]"` (accesibilidad, clic con modificador, clic medio,
    lector de pantalla) pero un click plano sin modificadores hace
    `preventDefault()` y `useOverlayParam('ver').set(String(id))` en su
    lugar — **criterio de aceptación explícito**: `Cmd/Ctrl+click` y clic
    medio siguen abriendo `/socios/[id]` en pestaña nueva sin pasar por la
    vista rápida (mismo patrón que usa `next/link` internamente para no
    robarle los modificadores al navegador).
  - `member-account-section.tsx`: los dos `<Link href="/cobranza/nuevo...">`
    ("Registrar pago", "Pago del grupo") pasan a
    `useOverlayParam('pagar').set('socio:' + memberId)` /
    `set('grupo:' + familyGroupId)`.
  - `member-detail-view.tsx`: se reorganiza en `Tabs` (`components/ui/tabs.tsx`,
    ya existe) — encabezado + `MemberAccountSection` quedan SIEMPRE visibles
    arriba (no entran en ninguna tab); tab "Datos" = Datos personales + Grupo
    familiar + Apto físico; tab "Movimientos" = Cuotas + Pagos; tab
    "Historia" = Historia. Ningún `Panel` queda anidado dentro de otro —
    cada tab contiene los mismos `Panel`s de hoy, sin envolverlos en uno
    nuevo. **Criterio de aceptación**: todo el contenido que hoy existe sigue
    accesible (nada se elimina, solo se reagrupa); el foco de teclado al
    cambiar de tab aterriza en el contenido de la tab, no se pierde.
  - `route-socios.md`: "tocar una fila abre la ficha" → "tocar una fila abre
    la vista rápida; 'Ver ficha completa' abre `/socios/[id]`".
    `route-socios-id.md`: documentar la reorganización en pestañas.
- **Dependencias:** Ola 0 completa, y B1 (backend) para `getMemberQuickView`
  — puede arrancar en paralelo con B1 escribiendo contra la firma de C7 y el
  tipo `MemberAccount` ya existente; el `tsc` final valida que calzan.
- **Fuera de alcance:** cambiar columnas o filtros del padrón; cambiar
  `getMemberPage`/`getPadron` (controllers sin cambios); dar de baja/reactivar
  desde la vista rápida (esas acciones siguen solo en la ficha completa, con
  su diálogo de motivo — no es una "vista rápida" si arrastra una acción con
  consecuencia).
- **Skills:** `impeccable` (`reference/operate.md`, `reference/animate.md`,
  `reference/craft-floor.md`), `vercel-react-best-practices`,
  `web-design-guidelines` antes de cerrar.

### B1 — `getMemberQuickView` (Server Action)

- **Lane:** `backend`.
- **Archivos propios:** `src/controllers/members.actions.ts` (agrega el
  export nuevo — no toca los exports existentes del archivo).
- **No toca:** `src/models/**` (no hace falta: `getMemberAccount` en
  `accounts.model.ts` ya devuelve exactamente `MemberAccount`), ningún
  archivo de `views/`.
- **Objetivo y criterios de aceptación:**
  ```ts
  'use server'
  export async function getMemberQuickView(memberId: number): Promise<ActionResult<MemberAccount & { phone: string | null }>>
  ```
  Chequea `payments.read` con `requirePermission` (tira `PermissionError` →
  `ActionResult` de error, mismo patrón que el resto de `.actions.ts`), llama
  a `getMemberAccount(memberId)` (modelo existente, sin cambios), devuelve
  error de dominio ("No encontramos ese socio") si es `null`. `MemberAccount`
  **no trae `phone`** (verificado contra `types.ts` y contra lo que selecciona
  la RPC `member_accounts` — el botón "WhatsApp" de la vista rápida lo
  necesita, §7.2 de `00-architecture.md`): esta acción agrega una segunda
  lectura chica, por PK, directa a `members` con el cliente de sesión
  (`select phone from members where id = :id`, misma RLS que ya expone esa
  columna en la ficha completa) — **no** amerita una RPC ni una función de
  modelo nueva (es un `select` de una fila por PK, no una agregación). Dos
  llamadas a Postgres por invocación, nunca más. **Nunca** devuelve datos si
  el permiso falla — esto es lo único de todo el pipeline que un `tests/db/`
  debería tocar (verificar que `consulta` sin `payments.read`, si algún día
  existiera ese caso, no recibe el objeto). Hoy los 3 roles fijos tienen
  `payments.read`, así que el test real y verificable es: sin sesión →
  `PermissionError`; con sesión pero `memberId` inexistente → error de
  dominio, nunca una excepción sin capturar.
- **Dependencias:** ninguna (puede arrancar de inmediato).
- **Fuera de alcance:** cualquier campo que no sea `MemberAccount` + `phone`
  (si la vista rápida necesitara algo más, es una señal para volver a
  `00-architecture.md`, no para estirar el modelo sin documentarlo).
- **Skills:** `supabase` (para confirmar que no hace falta tocar RLS/grants —
  no hace falta, ya están), `vercel-react-best-practices`.

### B2 — `supabase/seed-demo.sql` (script de demo, fuera de migraciones)

- **Lane:** `backend`.
- **Archivos propios:** `supabase/seed-demo.sql` (archivo nuevo).
- **No toca:** `supabase/migrations/**` (prohibido para todo agente),
  `supabase/seed.sql` (el seed real, default, no se toca ni se reemplaza),
  `supabase/config.toml`.
- **Objetivo y criterios de aceptación:**
  - Corre standalone con `psql "$DB_URL" -f supabase/seed-demo.sql`
    **después** de `npm run db:reset` (que ya corrió `seed.sql`) — el
    encabezado del archivo lo dice explícito, igual que documenta que es
    opcional/aditivo, solo para desarrollo, nunca para el ambiente de la
    Comisión.
  - ~200 socios con nombres/DNI/teléfonos **inventados** (Ley 25.326, mismo
    criterio que `seed.sql`), repartidos en las disciplinas/categorías reales
    ya sembradas por `seed.sql` (no crea disciplinas/categorías nuevas —
    inserta sobre las que ya existen), proporción aproximada 90%
    practicantes/10% no practicantes.
  - Un puñado (5-10) en grupos familiares con responsable de pago.
  - Para cada uno de los últimos 12 períodos: una llamada a
    `private.generate_monthly_fees(period)` (existe, toma el período como
    parámetro explícito — **nunca** intenta simular `now()` o mover
    `club_today()`, que lee la hora real del sistema).
  - Pagos repartidos en esos 12 meses: mezcla de efectivo/transferencia,
    algunos de 1 cuota y otros de 2-3 por adelantado (mismo patrón que
    `seed.sql` ya usa), un pequeño porcentaje (~2-3%) anulado con motivo.
  - Distribución de deuda final variada a propósito: una porción al día, una
    porción con 1-2 meses, un puñado con mora larga (para que "los 5 más
    atrasados" tenga con qué llenarse) y algún caso de saldo a favor.
    Algunas bajas y reactivaciones repartidas en el año (para que "altas y
    bajas del mes" del panel no esté siempre en cero).
  - **Criterio de aceptación verificable**: correr `npm run db:reset` seguido
    de este script no rompe ningún invariante existente (índice único
    `(member_id, period)`, checks de monto ≥0) — si algo choca, el script
    está mal, no la base. `test-engineer` no escribe tests contra este
    archivo (es un script de datos, no una migración), pero sí puede correrlo
    en su verificación manual del resto de la suite si hace falta.
- **Dependencias:** ninguna.
- **Fuera de alcance:** importar cualquier CSV de `docs/relevamiento/`
  (prohibido, CLAUDE.md); tocar `supabase/migrations/**`; agregar el script a
  `package.json`/`db:reset` (queda manual, a propósito).
- **Skills:** `supabase-postgres-best-practices` (antes de escribir cualquier
  INSERT/loop contra las funciones existentes).

---

## Gate final

### test-engineer

Corre después de Ola 1. Sin base de datos nueva que probar (ninguna
migración) — el foco está en:
- `overlay-params.ts`: el criterio de C2 (back seguro vs. replace).
- `getMemberQuickView`: permiso y error de dominio (B1).
- Render de `CategoryDebtChart` en ambas variantes con datos vacíos (0
  categorías con deuda) y con datos reales — nunca un `NaN%`/división por
  cero en el ancho normalizado de la barra `compact`.
- Que ningún consumidor existente de `ResponsiveSheet` (los `*-form-sheet.tsx`
  de ajustes) se rompió — no cambia su contrato de props en este pipeline.
- `ResponsiveSheet` (C6b): el sheet sigue siendo cerrable con `Esc` y con el
  botón de cerrar sin usar el drag; con `prefers-reduced-motion` el drag queda
  desactivado y esos dos caminos siguen andando.
- `nav-items.ts`: el nuevo orden (C6) y que `getMobileNav` sigue calculando
  overflow igual que antes (su propio test ya existente, si lo hay, no
  debería necesitar tocarse — si lo rompe el reorden, es una señal de que el
  test dependía del orden y no de la regla).

### code-reviewer

Chequea en especial: que ningún componente de `views/payments/**` fue tocado
por F-inicio ni F-socios (import-only); que `payment-form.tsx` y
`group-payment-form.tsx` no cambiaron de firma (`onDone: () => void`,
`member`/`familyGroup` — el pipeline entero depende de que sigan
desacoplados de la navegación); que ninguna migración se agregó; que
`useReducedMotion`/`prefers-reduced-motion` está honrado en cada animación
nueva, no solo en las de C1; que ningún panel quedó anidado dentro de otro en
la ficha reorganizada; que las 4 briefs de `.impeccable/surfaces/` listadas en
`00-architecture.md` §10 quedaron actualizadas.

---

## Addendum del hilo principal (2026-09-28, aprobado por Tomás) — MANDA SOBRE LO DE ARRIBA

Respuestas a §11: pestañas-como-links en cobranza (D3 tal cual); sin ronda de
comps (F0 no corre); seed de ~200 socios; cifra principal de `/cobranza` =
"Cobrado en <mes>".

### Cambios a la Ola 0 (ya aplicados por el hilo principal)

- **C6 NO se aplica.** El orden Socios > Cobranza > Inicio es un pedido
  explícito y fechado de Tomás (lo más importante al alcance del pulgar). La
  observación "Inicio debería liderar" salió del hilo principal, no de Tomás.
  `nav-items.ts` no se toca.
- **C1** `src/views/shared/motion.ts` — como se especificó, más
  `SPRING_INDICATOR`, `STAGGER`/`staggerDelay(i)` y `useCountUpOnce(target, key)`.
- **C2** `src/views/shared/overlay-params.ts` — `useOverlayParam(name)`,
  `useCloseOverlay(name)` con `name: 'pagar' | 'ver'`, más
  `parsePaymentOverlay`, `paymentOverlayValue`, `parseQuickViewParam`,
  `isPlainLeftClick`. Abrir un overlay con otro abierto REEMPLAZA la entrada.
- **C3** `src/views/shared/hero-figure.tsx` — **la firma cambió**: recibe
  `cents: number` (no un string: el conteo necesita el número), `label`,
  `href?`, `countUpKey?`, `tone?: 'neutral'|'debt'|'positive'`, `supporting?`.
- **C4** se llama `src/views/shared/chart-kit.tsx` (no `chart-format.ts`):
  `CHART_COLORS`, `AXIS_PROPS`, `formatAxisTick`, `shortMonth`, `dayOfMonth`,
  `ChartTooltipFrame`, `TooltipRow`, `useChartEntrance()`.
- **Tokens nuevos en `globals.css`**: el `body` pasa al lienzo `bg-canvas`
  (#F5F5F4); `Panel` y `DataList` son blancos con `shadow-raised` y
  `rounded-xl`. Utilidades: `bg-canvas`, `bg-brand-soft` (#FEF3EC, admite
  texto tinta, secundario y `primary` con AA), `shadow-raised`,
  `shadow-lifted`, colores `chart-brand` / `chart-track`, `ease-out-expo`.
  `--muted-foreground` pasa a #5F6673 (AA sobre blanco, lienzo y brand-soft).
  Crossfade de `::view-transition-*` de 180ms ya definido.
  **Toda superficie que antes asumía fondo blanco de página** (barra
  superior móvil, barra inferior, sidebar, encabezados sueltos, filas fuera
  de un Panel) tiene que verificarse sobre el lienzo.
- **C5** (`category-debt-chart.tsx`) y **C6b** (drag de `ResponsiveSheet`) NO
  los hace el hilo principal: C5 pasa a F-cobranza (firma congelada abajo,
  F-inicio la importa) y C6b a F-shell.
- **Migración nueva** `20260928120000_daily_collection.sql`:
  `public.daily_collection(target_period date default null)` → `(day date,
  collected_cents bigint, cumulative_cents bigint)`, una fila por día hasta
  hoy, chequea `payments.read`. Tipo `DailyCollectionPoint` en `types.ts`.

### Firma congelada de C5 (dueño F-cobranza, lo importa F-inicio)

```ts
// src/views/payments/category-debt-chart.tsx
export function CategoryDebtChart(props: {
  rows: DebtByCategoryRow[]
  variant: 'compact' | 'full'
  /** compact: cuántas filas mostrar antes de "Ver todas" (default 6). */
  limit?: number
}): React.ReactElement
```

### Agregados de alcance (Tomás aprobó)

1. **Ritmo del mes en `/cobranza`** (F-cobranza + B1): área acumulada de lo
   cobrado día a día contra una línea de referencia en el total de cuotas
   del mes, + un medidor lineal de "% de las cuotas del mes cobrado". B1
   agrega `getDailyCollection(period?)` en `reports.model.ts` y
   `daily: DailyCollectionPoint[]` a `CobranzaHubData` / `getCobranzaHub()`.
2. **Tira de 12 meses en la ficha** (F-socios): arriba de "Movimientos", un
   cuadro por período (pagado / parcial / adeudado / anulado / sin cargo),
   derivado de los datos del estado de cuenta que la ficha ya carga. Con
   texto (tooltip + etiqueta accesible), nunca solo color.
3. **Transiciones entre páginas** (F-shell): `ViewTransition` de React 19.2 /
   Next 16 alrededor del contenido del panel, verificando en
   `node_modules/next/dist/docs/` si hace falta `experimental.viewTransition`
   en `next.config.ts` (F-shell lo reporta; el hilo principal toca la config).

### Slice nueva: F-polish (frontend)

Dueño de `src/views/settings/**`, `src/views/users/**`, `src/views/audit/**`,
`src/views/auth/**`, `src/app/(auth)/**`, `src/app/(panel)/(admin)/**`.
Pulido sobre el lienzo nuevo, estados, motion con C1, login con presencia de
marca. Sin cambios de comportamiento.

### Dueños finales (ningún archivo en dos slices)

| Slice | Archivos |
|---|---|
| hilo principal | `src/views/shared/{motion.ts,overlay-params.ts,hero-figure.tsx,chart-kit.tsx,panel.tsx,data-list.tsx,states.tsx}`, `globals.css`, `types.ts`, migraciones, `next.config.ts`, `package.json` |
| F-shell | `src/views/shell/**` (menos `nav-items.ts`), `src/views/shared/{responsive-sheet,page-header,search-input,filter-bar,pagination,status-pill,reason-dialog,form-fields,whatsapp-link,money,dni,date-text}.tsx`, `src/components/ui/**`, `src/app/(panel)/{layout,loading,error}.tsx`, `src/app/layout.tsx` |
| F-inicio | `src/views/dashboard/**`, `src/app/(panel)/page.tsx`, `.impeccable/surfaces/route.md`, `route-inicio.md` |
| F-cobranza | `src/views/payments/**`, `src/app/(panel)/cobranza/**`, `route-cobranza.md` |
| F-socios | `src/views/members/**`, `src/app/(panel)/socios/**`, `route-socios.md`, `route-socios-id.md`, `route-socios-nuevo.md` |
| F-polish | ver arriba, más `route-{login,ajustes,usuarios,auditoria}.md` |
| B1 | `src/controllers/{members.actions,reports.controller}.ts`, `src/models/reports.model.ts` |
| B2 | `supabase/seed-demo.sql` |
