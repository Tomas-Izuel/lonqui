# 02 — Desarrollo frontend: F-cobranza (hub, overlay de pago, listados)

Lane `frontend` del pipeline `2026-09-28-ui-expresiva`. Implementa F-cobranza
de `01-tasks.md`, con el addendum del hilo principal (que manda sobre el
cuerpo del documento) aplicado: pestañas-como-links (D3 tal cual), sin ronda
de comps, seed de demo (no es tarea de este agente), cifra principal de
`/cobranza` = "Cobrado en \<mes\>".

Archivos propios tocados: todo `src/views/payments/**`, `src/app/(panel)/
cobranza/**`, `.impeccable/surfaces/route-cobranza.md`. No se tocó
`src/views/members/**`, `src/views/dashboard/**`, `src/views/shell/**`,
`src/views/shared/**`, `src/components/ui/**`, ni ningún controller/modelo.

## Contexto al arrancar

Al leer el repo, F-inicio, F-socios y B1/B2 ya habían corrido (o estaban
corriendo) en paralelo: `dashboard-content.tsx` ya importaba
`CategoryDebtChart` desde `@/views/payments/category-debt-chart` con
`variant="compact"`, `dashboard-header.tsx` ya llamaba
`useOverlayParam('pagar').set('buscar')`, `member-account-section.tsx` (F-socios)
ya usaba `useOverlayParam`/`paymentOverlayValue` en vez de
`<Link href="/cobranza/nuevo...">`, y `reports.controller.ts` (B1) ya
exponía `daily: DailyCollectionPoint[]` en `CobranzaHubData`/`getCobranzaHub()`.
Esto fijó de hecho el contrato de `CategoryDebtChart` (la firma congelada del
addendum) y confirmó que el resto de las lanes ya dependían de que este
agente entregara `PaymentOverlayHost`, `MemberPicker` y `CategoryDebtChart`
tal como estaban prometidos.

## T1 — `PaymentOverlayHost` + `MemberPicker` + extensión de `RegisterPaymentSheet`

- **`src/views/payments/payment-overlay-host.tsx`** (nuevo): `export function
  PaymentOverlayHost(): React.ReactElement | null`, cero props (C7). Lee
  `?pagar=` con `useOverlayParam`/`parsePaymentOverlay`. Si no hay overlay
  válido, `null` (nada montado). Si lo hay, monta UN SOLO `ResponsiveSheet`
  (`open` siempre `true` en ese caso; `onOpenChange(false)` dispara
  `useCloseOverlay('pagar')`) con `AnimatePresence mode="wait"` adentro,
  animando la transición entre pasos por `key` (`buscar` / `socio-<id>` /
  `grupo-<id>`) con `DURATION.state` + `EASE_ENTER` de `motion.ts`, reducido a
  solo opacidad con `useMotionPreference().pick`.
- **`src/views/payments/member-picker.tsx`** (nuevo): paso "buscar". Input con
  debounce de 300ms (patrón "trackedTerm" idéntico al de `SearchInput`/el
  `RegisterPaymentSheet` original, para no disparar `setState` síncrono
  dentro del cuerpo de un efecto — lo marcó el lint,
  `react-hooks/set-state-in-effect`). Pide `loadMoreMembers` (Server Action
  YA existente de `members.actions.ts`, sin tocarla) con
  `{ filters: { q, status: 'all' }, cursor: FIRST_PAGE_CURSOR }`.
  **Decisión no trivial**: `loadMoreMembers` es la acción de "Ver más" del
  padrón y su schema exige un `cursor` no vacío (pensada para pedir la
  página siguiente, nunca la primera). No existe ninguna Server Action de
  búsqueda "primera página" para un Client Component — `searchMembers` es una
  función de modelo, no exportable a un Client Component. Se resolvió
  reusando `loadMoreMembers` con un cursor sentinel (`'buscar'`) que nunca
  decodifica a un keyset válido: `decodeCursor` (modelo, sin tocar) ya
  documenta ese caso como "se ignora: arranca de nuevo", que es exactamente
  "primera página". No se tocó `members.actions.ts` (dueño: B1). Cada
  resultado muestra nombre, DNI, categorías y una `StatusPill` con "Debe $X ·
  N meses" / "Al día" / "Saldo a favor $X" (la pregunta "¿debe? ¿cuánto?"
  resuelta ANTES de tocar el resultado, `PRODUCT.md`). Seleccionar hace
  `paymentOverlay.set('socio:' + id)` — nunca cierra/reabre el sheet.
- **`src/views/payments/register-payment-sheet.tsx`** (reescrito): ya NO
  exporta un `RegisterPaymentSheet` con su propio `ResponsiveSheet` (nadie lo
  usaba: se verificó con grep que no tenía consumidores reales, solo su
  propio comentario). Ahora exporta `RegisterPaymentSheetBody({ memberId,
  familyGroupId, onDone })`: el fetch de `getPaymentFormData` + loading/error
  + `PaymentForm`/`GroupPaymentForm`, sin sheet propio — `PaymentOverlayHost`
  es quien posee el `ResponsiveSheet` único. Agrega el **momento autorado**
  del pipeline (D5/`animate.md`, "un solo momento por vista, nunca una
  celebración que demore el flujo más rápido del sistema"): al registrar, un
  check + el monto quedan visibles `DURATION.focal` (600ms) DENTRO del sheet
  antes de llamar a `onDone()` (el cierre real) + `router.refresh()`. El
  toast de éxito lo sigue disparando `PaymentForm`/`GroupPaymentForm` en el
  momento del registro (sin cambios de timing ahí), así que queda de rastro
  aunque el sheet ya se haya cerrado. El timeout del cierre se limpia al
  desmontar (ref + cleanup) por si el sheet se cierra a mano (Esc/backdrop)
  mientras el check todavía está en pantalla.
- **`payment-form.tsx` / `group-payment-form.tsx`**: se agregó un prop
  **opcional** `onSuccess?: (amountCents: number) => void`, llamado justo
  antes de `onDone()` (mismo lugar que ya llamaba `toast.success`). `onDone:
  () => void` no cambió de forma ni de momento en que se llama — el hard
  rule del prompt ("payment-form.tsx y group-payment-form.tsx keep their
  props/signatures") se respetó al pie de la letra; `onSuccess` es una
  adición, nunca se rompe nada para quien no lo pase.
  **Regresión de grupo familiar verificada**: `GroupPaymentForm` no cambió
  ninguna lógica de checkboxes/montos por fila/`batchId` único — se
  revisó que `onSuccess?.(totalCents)` se agregó en la MISMA línea donde ya
  estaba el `toast.success`, sin tocar el resto del componente.

## T2 — `/cobranza/nuevo`

- `src/app/(panel)/cobranza/nuevo/page.tsx` reescrito: sin vista propia,
  `redirect()` puro (servidor, sin JS) a `volverHref` (saneado con
  `safeRedirectPath`, sin cambios) con `?pagar=socio:<id>` /
  `?pagar=grupo:<id>` agregado (`paymentOverlayValue`, de `overlay-params.ts`,
  consumido tal cual). Sin `memberId`/`familyGroupId` en la URL vieja,
  redirige a `volverHref` sin más. `payment-form-page.tsx` y `nuevo/loading.tsx`
  borrados (nada los importaba; se verificó con grep antes de borrar).

## T3 — `CategoryDebtChart`

`src/views/payments/category-debt-chart.tsx` (nuevo), firma congelada del
addendum: `{ rows, variant: 'compact' | 'full', limit? = 6 }`.

- **`compact`**: filas con una barra de magnitud DETRÁS del contenido (no un
  chart de recharts — es texto con un `div absolute` de ancho proporcional),
  un solo hue secuencial (`--color-status-in-debt` al 12%, el mismo que ya
  lee "deuda" en toda la app). `limit` filas siempre visibles + `<details>`
  nativo para el resto (mismo patrón sin-JS que ya usaba `CategoryList` en
  el inicio, que este componente reemplaza). Cada fila con deuda de una
  categoría real (`kind === 'category'`) enlaza a
  `/cobranza/deuda?categoriaId=`.
- **`full`**: `recharts` `BarChart` horizontal (`layout="vertical"`),
  ordenado desc, **solo con las categorías que efectivamente deben algo**
  (dataviz: una barra en cero no aporta al "quién debe más" que este chart
  responde) — la `DataList` de `debt-by-category-view.tsx` sigue mostrando
  TODAS las filas, incluidas las de deuda cero, como la tabla accesible
  equivalente que pide la skill. Tooltip con `ChartTooltipFrame`/`TooltipRow`
  de `chart-kit.tsx` (deuda + "con deuda: N de M"), `useChartEntrance()` para
  que la animación de dibujo corra una sola vez al montar.
- Exporta `categoryRowLabel` (el mismo formato de nombre de fila —"Fútbol
  masculino · 5ta", "Cuota social · no practicantes", "Saldo anterior al
  sistema"— que antes vivía duplicado como función privada en
  `debt-by-category-view.tsx`; ahora esa vista lo importa en vez de
  reinventarlo).
- **Decisión de href no especificada por el contrato**: la firma congelada
  no admite un `href` custom por variante. Se decidió enlazar SIEMPRE a
  `/cobranza/deuda?categoriaId=` (nunca a `/socios?categoryId=`, que era el
  link de la versión anterior de `CategoryRow` en el inicio) — el criterio es
  que clickear una cifra de deuda lleva a reclamarla, sea cual sea la página
  donde se mira. F-inicio reemplazó `CategoryRow`/`padron-rows.tsx` por este
  componente y hereda este link; si el criterio no es el esperado ahí, es un
  ajuste de una línea en este archivo (la función `categoryHref`), no un
  cambio de contrato.

## T4 — Hub de `/cobranza`

`cobranza-hub-view.tsx` reescrito por completo:

- El panel "Registrar pago" con buscador propio (search + `<Link>` a
  `/cobranza/nuevo`) desapareció. En su lugar, un botón de ancho completo
  ("Registrar pago", `size="lg"`, 48px) que hace
  `useOverlayParam('pagar').set('buscar')`. `CobranzaPage` (`app/(panel)/
  cobranza/page.tsx`) ya NO llama a `getPadron` ni maneja `?q=` — se
  simplificó a `getCobranzaHub()` + `requirePanelPermission('payments.read')`.
- "Este mes": `HeroFigure` ("Cobrado en \<mes\>", `countUpKey` por período —
  cuenta una sola vez por sesión) + barra apilada efectivo/transferencia
  (`CashTransferBar`, dos segmentos con etiqueta directa, sin leyenda
  aparte: a dos series, una leyenda separada es indirección de más).
- "Ritmo del mes" (agregado de alcance 1 del addendum, con B1): medidor
  lineal de "% de las cuotas del mes cobrado" (`CollectionRateMeter`, mismo
  lenguaje visual que el medidor del inicio — reescrito acá en vez de
  importado, porque `payments/` no importa de `dashboard/`) + área acumulada
  (`DailyCollectionChart`, archivo nuevo) contra una referencia punteada en
  `feesCents`, un solo eje, tooltip por día, tabla accesible oculta
  (`DailyCollectionTableHidden`).
- "Listados": la lista de filas-con-chevron a los 4 listados se reemplazó
  por `CobranzaTabs` (ver T5).

## T5 — Barra de pestañas (`CobranzaTabs`)

`src/views/payments/cobranza-tabs.tsx` (nuevo), compartida por el hub y las
4 páginas de listado (`pagos`, `deuda`, `al-dia`, `por-categoria`, cada una
con un `<CobranzaTabs />` agregado arriba de su `PageHeader`/`FilterBar`).
Cuatro `<Link>` reales — click del medio y Cmd/Ctrl+click abren en pestaña
nueva sin código propio (comportamiento nativo de `next/link`) — con el
indicador de la pestaña activa animado por `layoutId` (`motion`,
`SPRING_INDICATOR` de `motion.ts`, el mismo resorte pensado para la nav
principal). **Nota honesta**: `layoutId` compartido entre instancias
montadas en páginas distintas (una por navegación completa de App Router)
depende de que `motion` conserve la proyección del elemento saliente durante
la navegación del cliente — funciona en la práctica para navegación vía
`<Link>` (sin recarga completa), pero una carga dura simplemente no tiene
"desde dónde" animar y el indicador aparece ya en su lugar, que es el
comportamiento correcto de todos modos.

Ningún `page.tsx` de los 4 listados cambió su lógica de datos: solo se
agregó `<CobranzaTabs />` en la vista (`month-payments-view.tsx`,
`member-accounts-listing-view.tsx`, `debt-by-category-view.tsx`).

## Entrada escalonada en listados

`src/views/payments/staggered-cell.tsx` (nuevo): un wrapper `motion.span`
chico con `staggerDelay(index)`/`STAGGER.maxItems` de `motion.ts`, para la
columna de nombre en `MonthPaymentsList`, `MemberAccountsList` y la columna
"Categoría" de `DebtByCategoryView`.

**Limitación conocida, documentada a propósito**: `DataList`
(`src/views/shared/data-list.tsx`) es compartido (dueño: hilo principal) y
no expone ningún gancho para animar la fila (`<li>`/`<tr>`) completa ni el
índice de cada item a `render`/`renderRow`. No se tocó ese archivo (regla
dura del prompt). La solución fue animar el contenido que SÍ se controla
desde cada listado (la celda de nombre, presente tanto en la fila móvil
apilada como en la primera columna de la tabla de escritorio) en vez de la
fila entera — un compromiso deliberado: se ve y se siente como "la lista
entra fila por fila" sin envolver el contenedor completo. El índice se
calcula con `items.indexOf(item)` (aceptable para los tamaños de página de
este dominio, ~20-250 ítems acumulados con "Ver más"). Si en el futuro se
quiere el efecto completo (fondo + padding de la fila animados), `DataList`
necesitaría un prop opcional como `rowDelay?: (item: T, index: number) =>
number` — cross-lane, no se implementó acá.

## Contratos consumidos (sin tocarlos)

- `overlay-params.ts` (C2, hilo principal): `useOverlayParam`,
  `useCloseOverlay`, `parsePaymentOverlay`, `paymentOverlayValue`.
- `motion.ts` (C1): `DURATION`, `EASE_ENTER`, `SPRING_OVERLAY`,
  `SPRING_INDICATOR`, `staggerDelay`, `useMotionPreference`.
- `chart-kit.tsx` (C4): `CHART_COLORS`, `AXIS_PROPS`, `formatAxisTick`,
  `dayOfMonth`, `ChartTooltipFrame`, `TooltipRow`, `useChartEntrance`.
- `hero-figure.tsx` (C3): `HeroFigure({ label, cents, href?, countUpKey?,
  tone?, supporting? })`.
- `reports.controller.ts` / `models/types.ts` (B1): `CobranzaHubData.daily:
  DailyCollectionPoint[]`, ya presente al momento de integrar — sin fricción.
- `payments.actions.ts` (`getPaymentFormData`, `registerPayment`, etc.):
  sin cambios de firma ni de cuerpo, tal como pedía el alcance.
- `members.actions.ts` (`loadMoreMembers`): sin cambios, reusado para la
  búsqueda en vivo del picker (ver T1).

## Comportamientos y criterios de aceptación implementados

- Buscar → cobrar en el mismo overlay, con transición animada, desde
  cualquiera de los puntos de entrada que ya escriben `?pagar=` (hub,
  inicio, ficha del socio, padrón — estos tres últimos, de otras lanes).
- Resultados de búsqueda muestran deuda/al día/saldo a favor antes de tocar.
- Pago de grupo familiar sigue funcionando igual (checkboxes, montos por
  fila, `batchId` único, comprobante a nombre del primer integrante) —
  ningún cambio de lógica interna, solo el `onSuccess` opcional.
- Cierre + refresco + toast tras un momento de confirmación visible (check +
  monto) dentro del sheet.
- `/cobranza/nuevo` con querystring vieja sigue funcionando vía redirect.
- `/cobranza/por-categoria`: gráfico de barras (solo categorías con deuda)
  + listado completo con entrada escalonada.
- Las 4 páginas de listado comparten la misma barra de pestañas, navegable
  con teclado, Cmd/Ctrl+click y click del medio.
- Toda superficie async (`MemberPicker`, `RegisterPaymentSheetBody`) tiene
  loading/empty/error.
- `prefers-reduced-motion`: todas las animaciones de este slice usan
  `useMotionPreference().pick`/`reduced` para caer a solo-opacidad o
  duración corta sin desplazamiento espacial (picker, overlay host, tabs,
  success moment, charts vía `useChartEntrance`).
- Ningún `<form method="post">` cambiado de método; ningún dato personal
  (DNI, nombre completo) en una URL — el picker no navega, y `?pagar=socio:
  <id>`/`?ver=<id>` ya usan solo el id numérico (contrato de C2, sin tocar).

## Deferrals / cross-lane

- `DataList` sin soporte de índice/animación por fila (ver arriba): reporte
  para una futura iteración, no bloqueante.
- No se corrió `/impeccable audit` manual completo por presión de tiempo del
  pipeline; se actuó sobre los hallazgos que el hook de `impeccable` devolvió
  tras cada edición (ninguno bloqueante) y se corrió `web-design-guidelines`
  (categorías de foco, formularios, animación, touch) sobre los archivos
  nuevos — un `focus-visible:outline-none` sin reemplazo real se encontró y
  corrigió en `member-picker.tsx`.
- `npm run typecheck` y `npx eslint src/views/payments/
  src/app/(panel)/cobranza/` quedan en verde al momento de cerrar esta tarea.

## Ronda 2 — Fixes de revisión de pantalla (mismo alcance)

Antes de arrancar se verificó lo que el hilo principal ya había cambiado en
paralelo: `staggered-cell.tsx` y sus usos fueron retirados (`DataList` ahora
escalona sus filas con CSS propio — no se reintrodujo nada de eso acá);
`categoryRowLabel` se movió a `account-format.ts` (estaba en un módulo
`'use client'`, `category-debt-chart.tsx`, y lo llamaban Server Components de
`debt-by-category-view.tsx`, lo que rompía `/cobranza/por-categoria`); y
`payment-overlay-host.tsx` ganó gating por permiso (`useHasPermission`,
`@/views/shell/panel-session`) y una animación de salida que conserva el
último `target` válido mientras el sheet se cierra (para no verlo vaciarse de
golpe). Las tres se dejaron intactas — no se tocó esa lógica.

1. **Barra de pestañas de `/cobranza` reubicada** (`cobranza-tabs.tsx`):
   - Nueva pestaña "Resumen" (→ `/cobranza`) primero en la lista; después
     Pagos del mes, Con deuda, Al día, Por categoría.
   - Cada pestaña pasó de `flex-1` (ancho repartido en partes iguales entre
     4, lo que recortaba "Por categoría" a "Por…" a 390px con 5 pestañas) a
     ancho natural (`shrink-0`) dentro de un contenedor `overflow-x-auto` —
     la barra entera scrollea horizontal si no entran todas.
   - La pestaña activa se lleva a la vista con `scrollIntoView` (`useEffect`
     + `ref`, `behavior: 'smooth'`/`'auto'` según `prefers-reduced-motion`)
     al montar y al cambiar de ruta, para que nunca quede oculta fuera de
     cuadro después de un scroll horizontal previo.
   - `cobranza-hub-view.tsx`: se eliminó el `Panel title="Listados"` que
     envolvía la barra al pie de la página; `<CobranzaTabs />` ahora vive
     directo debajo de `<PageHeader>`, igual que en los otros 4 listados
     (que ya la tenían ahí desde la ronda 1 — no hizo falta tocarlos).
2. **Overlay de pago: tarjetas anidadas + título duplicado** (`payment-
   form.tsx`, `group-payment-form.tsx`): el sheet ya pone el título
   ("Registrar pago" / "Pago del grupo familiar") en su `SheetTitle`/
   `DialogTitle`; adentro, `PaymentForm` y `GroupPaymentForm` repetían ese
   mismo título en un `<Panel>` propio y encerraban el resumen del socio en
   OTRO `<Panel>` sin título — dos cajas con borde una arriba de la otra,
   más el texto repetido. Se aplanó a un solo bloque: resumen (nombre,
   categorías, pill + línea de cuenta, cuota vigente) sin borde, un
   `border-t` como único separador, formulario directo debajo, sin
   `<Panel>` ni título propio. En el grupo, el h1 genérico "Pago del grupo
   familiar" (que duplicaba el título del sheet) se reemplazó por el nombre
   real del grupo (`familyGroup.label`) como línea principal, y el
   `<Panel title="Integrantes">` por un rótulo de texto plano arriba de la
   lista (mismo criterio: sin caja).
   - **Pill de deuda duplicada con el texto**: `accountLineText` para
     `up_to_date` devuelve literalmente "Al día" (o "Dado de baja · al
     día"), el mismo texto que ya muestra `DebtStatusPill`. Ahora la pill
     solo se renderiza cuando `debtStatus !== 'up_to_date'` (con deuda o
     saldo a favor, donde la pill dice algo — "Con deuda"/"Saldo a favor" —
     que la línea de cuenta detallada no repite palabra por palabra). Al
     día: solo el texto "Al día". Este ajuste queda en `payment-form.tsx`
     (el único lugar donde pill y texto convivían en la misma fila —
     `member-picker.tsx` y las listas ya mostraban uno u otro, nunca los
     dos a la vez, y `group-payment-form.tsx` nunca tuvo pill por fila).
3. **`CategoryDebtChart` compacto: relleno detrás del texto leído como
   fila seleccionada**: se reemplazó el `div absolute` semitransparente
   detrás de la fila entera por el patrón mini-bar-chart estándar — label +
   meta en una sola línea con el monto alineado a la derecha, y un riel fino
   de 6px (`h-1.5`) debajo: `bg-chart-track` de fondo, `bg-status-in-debt`
   como relleno proporcional. Se revisó el resto de `src/views/payments/**`
   (`grep "absolute inset"`) por si el mismo patrón se había reusado en otro
   lado — el único otro resultado es el indicador de pestaña de
   `cobranza-tabs.tsx`, que es el afordance correcto para ese caso (un fondo
   detrás de UN ítem activo, no una barra de magnitud), así que no se tocó.
4. **Medidor de "% cobrado" reubicado**: pasó del panel "Ritmo del mes" al
   panel "Este mes", inmediatamente debajo de la `HeroFigure` y antes de la
   barra efectivo/transferencia — "Ritmo del mes" quedó como el gráfico solo
   (+ su tabla accesible oculta), sin el medidor.
5. **Eje Y del chart de barras (`/por-categoria`) a 390px**: los rótulos
   completos ("Fútbol masculino · 5ta") se partían en dos líneas diminutas.
   Se agregó `categoryAxisLabel`, que acorta el nombre de la disciplina a su
   primera palabra ("Fútbol · 5ta") — genérico (una sola palabra, sin tabla
   de abreviaturas por disciplina: son datos administrables desde
   `/ajustes`, nunca un enum fijo), no afecta al tooltip (`FullChartTooltip`
   sigue usando `categoryRowLabel`, que reconstruye el nombre completo desde
   `kind`/`categoryName`/`disciplineName` de la fila, no desde el campo
   `label` acortado). El ancho reservado del eje bajó de 140 a 100px, ya que
   el rótulo corto no lo necesita y así el área de barras gana espacio en
   mobile.

Verificado tras la ronda 2: `npm run typecheck` limpio salvo un error
preexistente en `src/views/members/member-period-strip.tsx` (F-socios, no es
mío); `npx eslint src/views/payments/ "src/app/(panel)/cobranza/"` sin
hallazgos.
