# 02 — Desarrollo frontend: F-inicio (panel inicial)

Lane `frontend-react-craftsman`, slice **F-inicio** de `01-tasks.md`
(archivos propios: `src/views/dashboard/**`, `src/app/(panel)/page.tsx` si
hacía falta, `.impeccable/surfaces/route.md` y `route-inicio.md`). Ejecuta la
especificación del **Addendum del hilo principal** al final de `01-tasks.md`
(que manda sobre el cuerpo del documento) más el criterio suelto del
coordinador para esta tarea puntual.

Motivo (`00-architecture.md` §1): Tomás, después de ver el sistema
funcionando: *"home es todo números, ni un gráfico, ni una animación,
sensación poco atractiva"*. No es funcionalidad nueva — es terminación sobre
la composición ya elegida el 2026-09-28 ("Qué hay que resolver", ver
`route-inicio.md` v3).

## Qué se tocó

Todo dentro de `src/views/dashboard/**` (dueño exclusivo de esta slice) más
`.impeccable/surfaces/route.md` y `route-inicio.md`:

- `dashboard-header.tsx` — reescrito.
- `money-summary-strip.tsx` — reescrito entero.
- `debt-rows.tsx` — reescrito (`TopDebtorRow`/`TopDebtorsList`), `DebtDetailRows` sin cambios de comportamiento.
- `history-chart.tsx` — reescrito sobre `chart-kit.tsx`.
- `padron-rows.tsx` — se sacó `CategoryRow`/`CategoryList` (migró a `CategoryDebtChart`).
- `dashboard-content.tsx` — cablea `CategoryDebtChart`, actualiza el docblock.
- `.impeccable/surfaces/route.md` — sección "Panel inicial" (bullet "Forma") y el anti-objetivo "métrica-héroe" en la sección "Shell".
- `.impeccable/surfaces/route-inicio.md` — nueva sección v4 con el resumen de este pipeline.

No se tocó `src/app/(panel)/page.tsx`: no hizo falta ningún ajuste (las
firmas de `DashboardHeader`/`DashboardContent` no cambiaron desde su punto de
vista).

**No se tocó** (por contrato): `src/views/payments/**` — `CategoryDebtChart`
se **importa** (solo lectura) desde `src/views/payments/category-debt-chart.tsx`
con la firma congelada del addendum (`rows`, `variant: 'compact' | 'full'`,
`limit?`). Ese archivo lo escribe F-cobranza en paralelo; al momento de
cerrar esta slice todavía no existía en el árbol, así que
`npm run typecheck` marca un único error esperado
(`Cannot find module '@/views/payments/category-debt-chart'` en
`dashboard-content.tsx(2,35)`) — es la dependencia cruzada documentada en
`01-tasks.md` ("F-inicio... solo IMPORTA `CategoryDebtChart` de C5"), no un
bug de esta slice. El resto del repo tipa limpio.

## Contratos consumidos (Ola 0 / addendum)

- `src/views/shared/motion.ts`: `DURATION`, `EASE_ENTER`, `staggerDelay`, `useMotionPreference`, `useCountUpOnce` (este último ya integrado adentro de `HeroFigure`, no se llama directo).
- `src/views/shared/overlay-params.ts`: `useOverlayParam('pagar').set('buscar')` (cabecera), `useOverlayParam('ver').set(id)` + `isPlainLeftClick` (fila de atrasado).
- `src/views/shared/hero-figure.tsx`: `HeroFigure({ label, cents, href, countUpKey, tone, supporting })` — firma ya actualizada por el hilo principal (recibe `cents: number`, no un string).
- `src/views/shared/chart-kit.tsx`: `CHART_COLORS`, `AXIS_PROPS`, `formatAxisTick`, `shortMonth`, `ChartTooltipFrame`, `TooltipRow`, `useChartEntrance`.
- `src/views/payments/category-debt-chart.tsx` (C5, dueño F-cobranza): `CategoryDebtChart({ rows, variant, limit? })`, solo lectura.
- Tokens de `globals.css` (hilo principal): `bg-canvas`, `bg-brand-soft`, `shadow-raised`, `shadow-lifted`, `--color-status-up-to-date`/`--color-status-in-debt` (ya existían), `--color-chart-track`/`--color-chart-brand` (usados indirectamente vía `chart-kit`).

No se agregó ninguna primitiva nueva a `src/views/shared/`: todo lo que hacía
falta ya estaba fijado en Ola 0. `debt-rows.tsx` gana un helper chico
(`MonthsBehindDots`) que queda local a `views/dashboard/` porque es
específico de "meses de atraso" — no hay un segundo consumidor hoy; si
`/cobranza` alguna vez necesita el mismo patrón, ahí sí amerita subir a
`shared/`.

## Decisiones de diseño

**Por qué el bloque de plata no reutiliza `Panel`.** `Panel` fuerza
`bg-card` (blanco) — es la superficie neutra de todo el resto del panel. El
addendum pide "ambas [cifra + medidor] dentro de un único Panel, posiblemente
sobre `bg-brand-soft`". En vez de forzar `bg-brand-soft` por encima de
`bg-card` con una clase de más prioridad (frágil: dos utilidades de Tailwind
v4 compitiendo por la misma propiedad sin garantía de cuál "gana" en el CSS
generado), `MoneySummaryStrip` reproduce el mismo lenguaje visual de `Panel`
a mano (`rounded-xl border border-border/70 shadow-raised`) pero con
`bg-brand-soft` en vez de `bg-card`. No es un panel anidado: es el único
bloque de nivel superior de la página con este tratamiento, exactamente como
pide el brief ("la única superficie que no es blanca, a propósito"). El
resto de la página (incluido "Qué hay que resolver" con su propio `<Panel>`)
sigue blanco.

**`HeroFigure` con `tone="debt"`** sobre `bg-brand-soft`: el rojo de estado
(`#B91C1C`, 6,47:1 sobre blanco) se midió también contra `#FEF3EC`
(`--brand-soft`) — al ser un tono casi blanco (L muy alta), el contraste
cae apenas (~6,3:1 estimado), sigue sobrando AA para texto grande y para
texto normal. `--muted-foreground` (`#5F6673`) ya está documentado en
`globals.css` como válido sobre `--brand-soft` (comentario existente:
"5,3:1 ... y sobre --brand-soft"), así que el `label`/`supporting` de
`HeroFigure` (que usan `text-muted-foreground`, sin cambios del componente)
no necesitaban ajuste.

**El medidor de cobranza del mes (`CollectionMeter`), no un gráfico.** Según
la skill `dataviz` (`choosing-a-form.md`): *"A single ratio against a
limit → Meter"* — "% de las cuotas del mes cobrado" es exactamente eso, no
amerita un chart de recharts. El relleno usa `--color-status-up-to-date`
(mismo verde que ya significa "cobrado"/"al día" en toda la app) y el riel
es el mismo tono al 15% de opacidad — "un paso más claro de la misma rampa"
(dataviz: *"the unfilled track is a lighter step of the same ramp"*) sin
inventar un segundo hue. Puede pasar el 100% (se cobran meses viejos con el
pago de hoy, ya documentado en `route.md`): el ancho del relleno se recorta
a 100% con `Math.min(pct, 100)`, pero el **número** (`{pct}%`, puede leer
"134%") es lo que comunica el excedente — la barra sola no. La barra es
`aria-hidden` (decorativa): el porcentaje ya está en el texto de arriba y
los montos exactos abajo, un segundo rol/etiqueta ahí solo duplicaría el
anuncio del lector de pantalla. Todo el bloque es un único `<Link>` a
`/cobranza/pagos?mes=<period>` (mismo destino que ya tenía la fila vieja) —
"todo número es un link" se mantiene.

**`HeroFigure` es la única cifra grande de la vista** (dataviz: *"Exactly
one per view"*; piso de calidad: nunca una grilla de métrica-héroe). El
medidor, al lado, es deliberadamente secundario: texto de tamaño normal,
sin tipografía de hero. Documentado el matiz en `route.md` (el anti-objetivo
"métrica-héroe" prohibía la plantilla de VARIAS tarjetas, no una sola cifra
hero — quedó ambiguo en la redacción anterior y se aclaró).

**Por qué el fix del gráfico de evolución no era de layout.** Se sospechó
"se ve roto" por escala/legibilidad, pero el síntoma real (confirmado
leyendo cómo funciona `isAnimationActive` en recharts, documentado también
en `00-architecture.md` §5.3) es que el chart viejo NO pasaba
`isAnimationActive` — default `true` — así que **cada re-render** (incluido
el que dispara el propio `Tooltip` al mover el mouse) volvía a animar las
barras desde cero: se sentía como que "saltaba"/"se rompía" al tocarlo, no
al cargar. `useChartEntrance()` (ya escrito en Ola 0) resuelve esto
gateando `isAnimationActive` a "true hasta que termina la primera entrada,
después siempre false". Sumado: dominio de eje Y con 15% de margen
redondeado a $1.000 (antes el pico quedaba pegado al borde superior) y los
colores/tooltip ahora vienen de `chart-kit` en vez de duplicados a mano
(mismo tooltip que usará `CategoryDebtChart`).

**Meses de atraso, visualizados además de escritos.** `MonthsBehindDots`:
hasta 6 puntos llenos en `--color-status-in-debt`, el resto se resume en
"+N" texto (nunca puntos sin fin, que dejarían de leerse a partir de un
mora larga). Es `aria-hidden`: el número real ("8 meses") ya está en texto
al lado — dataviz: "nunca color/forma solo", acá se cumple al revés (nunca
SOLO la forma, el texto manda).

**Stagger de "los más atrasados".** `staggerDelay(index)` de `motion.ts`
(paso de 40ms, techo en 8 filas) sobre como mucho 5 filas (el brief ya
limitaba topDebtors a 5) → delay máximo real ~160ms, bien dentro del techo
de 400ms que pedía la tarea. Con `prefers-reduced-motion`, `useMotionPreference().reduced`
fuerza `delay: 0` y el `initial` pasa de `{opacity:0, y:6}` a solo
`{opacity:0}` (sin desplazamiento espacial, con `pick`) — ninguna fila queda
sin aparecer, solo pierden el movimiento y el escalonado.

**Un click plano en "los más atrasados" abre la vista rápida.** Mismo
patrón que usará `member-list.tsx` (F-socios, contrato C2): sigue siendo un
`<Link href="/socios/[id]">` real — lector de pantalla, Cmd/Ctrl+click, clic
del medio todos funcionan igual que antes — pero `isPlainLeftClick(event)`
más `event.preventDefault()` desvían el click plano a
`useOverlayParam('ver').set(String(memberId))`. Activación por teclado
(Enter sobre el link) dispara un evento de click con `button === 0` y sin
modificadores, así que también abre la vista rápida — coherente con el
mouse, no rompe el camino de teclado.

**`CategoryDebtChart` reemplaza `CategoryList`/`CategoryRow` uno a uno.**
El contrato (C5, firma congelada en el addendum) dice que el propio
componente maneja el corte a `limit` filas + "Ver todas" en su variante
`compact` — por eso `padron-rows.tsx` se achicó (perdió `CategoryRow`,
`CategoryList`, el `<details>` a mano) y `dashboard-content.tsx` monta el
componente directo con `variant="compact"`, sin pasarle `limit` (usa el
default del componente, 6).

## Estados (sin cambios de contrato, verificados)

- **Cuotas no activadas** (`billing.active === false`): `BillingInactiveNotice` sigue siendo lo único que se ve en vez de toda la plata/pendientes — no tocado.
- **Corrida fallida/pendiente** (T1): `RunFailedNotice` sigue como primera fila de "Qué hay que resolver", sin cambios de lógica (`shouldShowRunNotice` en `dashboard-helpers.ts`, no tocado).
- **Sin socios en deuda**: `TopDebtorsList` sigue mostrando el texto plano "Ningún socio activo tiene deuda." (sin lista, sin stagger sobre nada).
- **Sin cuotas generadas este mes pero facturación activa** (`feesCents === 0`): `collectionPct` sigue devolviendo `null`; el medidor nuevo lo muestra como "Sin cuotas" en vez de `0%`/`NaN%`, con la barra vacía.
- **`prefers-reduced-motion`**: cifra hero no cuenta (aparece directo), stagger de atrasados se aplana a fade sin traslación, gráfico de evolución no se dibuja animado (`isAnimationActive: false` desde el primer render).

## Accesibilidad (verificado contra Web Interface Guidelines, skill `web-design-guidelines`)

- Targets de 44px: botones de cabecera (`size="sm"` de shadcn = 44px, patrón ya usado en el repo), filas de `TopDebtorsList` (`min-h-11`), bloque del medidor (excede 44px por contenido, tres líneas + barra).
- Elementos decorativos (`MonthsBehindDots`, la barra del medidor) van `aria-hidden`; el dato real vive en texto visible al lado en ambos casos — nunca color/forma como único portador de información.
- Animación limitada a `opacity`/`transform` (`y`), nunca `transition: all`; todas respetan `prefers-reduced-motion` vía `useMotionPreference`/`useChartEntrance`.
- Los tres links nuevos/tocados (cifra hero, medidor, fila de atrasado) mantienen foco visible (`focus-visible:ring-3`/`focus-visible:bg-muted/50`, patrones ya existentes en el repo) y hover.
- Nada de `<div onClick>`: todo sigue siendo `<Link>`/`<button>` reales.
- Montos con `tabular-nums` (`Amount`); la cifra hero es proporcional a propósito (contrato de `HeroFigure`, no es una columna).

## Verificación

- `npm run typecheck`: limpio salvo el error esperado de `CategoryDebtChart` (dependencia cruzada con F-cobranza, ver arriba) — es el único error en todo el repo al momento de cerrar esta slice.
- `npx eslint` sobre los 6 archivos tocados: sin hallazgos.
- Hook `impeccable` (corre solo tras cada edición): "No deterministic design-quality issues found" en cada archivo.
- `web-design-guidelines`: revisado a mano contra la lista completa (accesibilidad, foco, animación, tipografía, anti-patrones) — sin hallazgos nuevos sobre lo escrito en esta slice.

## Deferrals / seguimiento

- `CategoryDebtChart` (import) todavía no existe en el árbol al cerrar esta slice — lo escribe F-cobranza en paralelo, mismo pipeline. El `tsc` final de la integración es quien confirma que calzan (ya está la firma congelada en el addendum, consumida tal cual).
- `MonthsBehindDots` quedó local a `views/dashboard/debt-rows.tsx`. Si `/cobranza` (F-cobranza) necesita la misma visualización de "meses de atraso" en otro listado, es candidato a subir a `views/shared/` — no se movió preventivamente para no inventar una API sin un segundo consumidor real.
- No se tocó `src/app/(panel)/page.tsx`: no hizo falta ningún ajuste para esta slice.

---

## Ronda 2 (2026-09-28): redundancia y accesos de la cabecera

El coordinador revisó capturas reales a 390/1440 con datos de demo (~200
socios) del resultado de la ronda 1 y pidió tres correcciones, mismo dueño
de archivos (`src/views/dashboard/**` + mis dos briefs), sin tocar nada de
las otras slices en paralelo.

### 1. Accesos de la cabecera: de chip a botón real

**Diagnóstico.** `Button size="sm"` de shadcn ya da `h-11` (44px) técnicos —
no era un bug de altura. Leían "chip" por dos motivos de proporción: ancho
de contenido (`shrink-0` sin `w-full`, una sola palabra "Pago"/"Alta") y
padding horizontal chico (`px-2.5` de `size="sm"`). La combinación se ve
angosta y de baja jerarquía aunque el target táctil ya cumplía el piso.

**Solución.** `dashboard-header.tsx`: las dos etiquetas pasan a texto
completo ("Registrar pago", "Ficha de ingreso" — ya no hace falta el
`title` que las completaba, el texto visible ES la acción completa ahora).
Contenedor: `grid grid-cols-2 gap-2 sm:flex sm:flex-wrap` cuando los dos
accesos están visibles (llena el ancho a 390, ancho automático lado a lado
desde `sm`); si el rol solo habilita uno, `grid-cols-1` (sigue lleno a
390, no se ve un botón huérfano en una grilla de 2). Cada botón:
`h-11 w-full sm:w-auto`, explícito en vez de confiar en el `size` de
shadcn — más legible para quien lea el componente después sin tener que ir
a `button.tsx` a confirmar cuántos px da `size="sm"`. "Registrar pago" es
la variante por defecto (primaria, coherente con Product Principle 2:
"cargar un pago es lo más rápido del sistema"); "Ficha de ingreso" es
`outline`.

### 2. Se borraron los paneles "Este mes" y "Deuda"

**Diagnóstico exacto de la redundancia** (no una sensación general —
cada fila repetida, identificada):
- Panel "Deuda" → `DataRow` "Socios que deben" (valor + link a
  `/cobranza/deuda`) duplicaba EXACTO el `supporting` de la `HeroFigure`
  ("81 socios deben", mismo link `/cobranza/deuda`).
- Panel "Deuda" → `DataRow` "Deuda de socios dados de baja" duplicaba la
  fila con el mismo label/valor/link que ya vive en "Otros pendientes"
  (`PriorityExtras`, dentro de "Qué hay que resolver") cuando
  `inactiveDebtCents > 0`.
- Panel "Este mes" → efectivo/transferencia/cantidad de pagos era
  información nueva (no estaba arriba), pero la relación que sí importaba
  ("cobrado del mes contra las cuotas del mes, con el %") ya la cubría el
  medidor del hero — tener las dos plata del mes en paneles separados
  fragmentaba una sola pregunta en dos lecturas.

**Solución.**
- `dashboard-content.tsx`: se borraron los dos bloques `<Panel title="Este
  mes">`/`<Panel title="Deuda">` completos. Estructura final:
  hero (`MoneySummaryStrip`) → "Qué hay que resolver" → "Evolución" →
  "Padrón".
- `debt-rows.tsx`: se sacó `DebtDetailRows` entero (quedaba sin
  consumidor). Sin esa función, ninguna otra de este archivo usa
  `DataRow`/`DataRowGroup`, así que el import se sacó del todo (verificado
  con `npx eslint`, no queda ningún import sin usar).
- `month-rows.tsx`: **se borró el archivo entero** — `MonthDetailRows` era
  su único export y se quedó sin consumidor. Confirmado con
  `grep -rn "MonthDetailRows\|month-rows"` sobre todo `src/` antes de
  borrar: cero referencias fuera de los dos archivos tocados.
- `money-summary-strip.tsx`: nuevo componente interno `CashTransferBreakdown`
  — una barra fina (`h-1.5`) de 2 segmentos (efectivo en
  `--color-chart-brand`, el naranja institucional como marca NO textual,
  ya documentado en `chart-kit.tsx` para "magnitud sin carga de estado";
  transferencia en `--color-muted-foreground`, la tinta secundaria de
  `DESIGN.md`) más una línea de texto directo ("Efectivo $X ·
  Transferencia $Y · N pagos") — nunca una leyenda aparte, el texto YA
  nombra cada segmento con su monto exacto (dataviz: la barra decorativa es
  `aria-hidden`, el dato real vive en el texto). Vive DENTRO del mismo
  `<Link>` del medidor de cobranza (mismo destino, `/cobranza/pagos?mes=`,
  es la misma pregunta "cómo viene la cobranza de este mes" con más
  detalle debajo). División por cero cubierta: si
  `cashCents + transferCents === 0`, las dos barras miden 0% y el riel de
  fondo (`bg-foreground/10`) sigue visible como track vacío, sin
  `NaN`/`Infinity`.

### 3. Puntos de "meses de atraso": se sacó el contador "+N"

**Diagnóstico.** Con mora larga (9+ meses), la fila leía "9 meses ●●●●●●
+3" — la cifra "9" aparecía dos veces (el texto y el texto del "+3" sumado
a los 6 puntos), más ruido que señal.

**Solución elegida** (de las dos que ofreció el coordinador: recortar a 6
sin contador, o un mini-bar proporcional): se recortó a 6 puntos llenos
como techo visual y se sacó el "+N" entero. Los puntos vuelven a ser
puramente decorativos (`aria-hidden`, ya lo eran) — dan una lectura de
severidad de un vistazo ("está lleno de puntos" = mora larga) sin agregar
un segundo número que leer. Se prefirió sobre la barra proporcional porque
ya hay DOS elementos visuales por fila con la misma información (el texto
"N meses" y los puntos); una tercera pieza (una barra) para el mismo dato
hubiese sido la redundancia que esta misma ronda vino a sacar de otros
lados de la página.

### Verificación

- `npm run typecheck`: limpio, cero errores en todo el repo (ya no hay
  siquiera el error cruzado de `CategoryDebtChart` de la ronda 1 — F-cobranza
  ya lo entregó).
- `npx eslint src/views/dashboard/*.tsx`: limpio.
- Hook `impeccable`: sin hallazgos en cada archivo tocado.
- Verificado a mano que no quedó ninguna referencia colgante a
  `MonthDetailRows`/`month-rows`/`DebtDetailRows` en todo `src/`.

### Archivos tocados en esta ronda

- `src/views/dashboard/dashboard-header.tsx` — reescrito (botones reales).
- `src/views/dashboard/dashboard-content.tsx` — se borraron los paneles "Este mes"/"Deuda", se actualizó el docblock.
- `src/views/dashboard/money-summary-strip.tsx` — se agregó `CashTransferBreakdown`.
- `src/views/dashboard/debt-rows.tsx` — se sacó `DebtDetailRows` y el "+N" de `MonthsBehindDots`.
- `src/views/dashboard/month-rows.tsx` — **borrado**.
- `.impeccable/surfaces/route.md` — bullet "Forma" actualizado con la estructura final y los accesos de la cabecera.
- `.impeccable/surfaces/route-inicio.md` — sección nueva "Ronda 2" (bump a `version: 5`).
