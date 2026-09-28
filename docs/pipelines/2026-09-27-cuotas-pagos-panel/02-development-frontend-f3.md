# 02 — Desarrollo frontend F3 (panel inicial)

Agente: `frontend-react-craftsman`. Tarea: **F3 — Panel inicial**, primero
la fase de composición pedida por Tomás ("el inicio actual es espacio
desperdiciado, definilo con `/impeccable`") y después, con la variante
elegida, la construcción definitiva. Este documento tiene las dos fases en
orden: **fase 1** (composición, v1 y v2 — más abajo) y **fase 2**
(construcción definitiva de `/`, al final del archivo — leerla primero si
solo importa el estado actual del código).

**v2 (2026-09-28)**: la primera entrega (v1) volvió con feedback del
coordinador — las 3 variantes compartían el mismo primer viewport a 390 y
dos bugs de piso (botones de 20px de alto, una fila-link con costura
visual). Este documento describe la v2 entera; la sección "Bugs
corregidos" tiene el diagnóstico completo de los dos bugs, porque el
proceso para encontrarlos importa tanto como el fix.

## Qué se hizo (v2)

1. Brief + 3 composiciones **con theses distintas visibles en el primer
   viewport**, en `.impeccable/surfaces/route-inicio.md` (leerlo primero —
   tiene la tesis, qué se ve arriba del pliegue, jerarquía completa y
   trade-offs de cada una, más la recomendación y el registro de los dos
   bugs).
2. Maquetas code-led navegables de las 3, en la misma ruta TEMPORAL de v1:
   `src/app/(panel)/inicio-propuestas/[variante]/page.tsx`.
3. Componentes de presentación reescritos en `src/views/dashboard/**` (ver
   "Archivos" — varios de v1 se dividieron o renombraron para eliminar
   contenido duplicado entre la plata de arriba y los `Panel`s de abajo).
4. Capturas Playwright nuevas (reemplazan las de v1) en
   `docs/pipelines/2026-09-27-cuotas-pagos-panel/f3-propuestas/`, más
   mediciones de `boundingBox()` de los targets táctiles (no a ojo).

## Bugs corregidos (con el diagnóstico, no solo el fix)

### 1. Botones ícono a ~20px de alto (piso: 44px mínimo)

Reportado por el coordinador desde las capturas. Medí con Playwright
(`page.locator(...).boundingBox()` sobre el DOM real, servido por el `next
dev` compartido) antes de tocar código: **`{ width: 324, height: 20 }`** —
un botón que se veía casi correcto en una captura chica medía la mitad del
piso.

**Causa**: en v1, los dos accesos eran `<Link className="flex h-11
flex-1 ...">` dentro de un contenedor `flex flex-col gap-2 sm:flex-row`. A
390 (`flex-col`, eje principal = vertical), la clase `flex-1` fija
`flex-basis: 0%` en el eje principal — que en un contenedor en columna ES
la altura. Cuando `flex-basis` no es `auto`, el tamaño mínimo automático de
un ítem flex se calcula por CONTENIDO, no por la propiedad `height`
explícita: el botón se achica al alto de su texto+ícono (~20px),
ignorando `h-11` por completo. `getComputedStyle` lo confirmó:
`{ height: '20px', display: 'flex' }` con la clase `h-11` presente en el
`className` del elemento (no es un problema de que la clase no se
aplicara — es que `flex-basis: 0%` le gana en el cálculo de tamaño).

**Fix**: los dos accesos dejaron de ser `<Link>` con clases de Tailwind a
mano. Ahora son `Button asChild size="icon"` de shadcn (`src/components/
ui/button.tsx`, variante `size="icon"` = `size-11`, que fija ancho Y alto
explícitos, no depende de `flex-grow`/`flex-basis` del contenedor) — el
mismo patrón que ya usa `views/payments/month-selector.tsx`. Server-side
esto también resuelve el pedido del coordinador de que los accesos sean
"chicos y secundarios": un ícono de 44×44 con `outline` es visualmente
mucho más chico que un botón de ancho completo, sin bajar del piso
táctil. Reverificado con `boundingBox()`: `{ width: 44, height: 44 }` en
las 3 variantes (ver "Verificación").

### 2. La fila "Cobrado en septiembre 2026" se veía como una tarjeta suelta

Reportado por el coordinador: "tiene un fondo/sombra que no alinea con las
demás filas". Diagnóstico por bisección, sin tocar el archivo primero —
todo con Playwright, aplicando clases parciales al elemento real en vivo
(`page.evaluate(() => { link.className = '...' })`) y recapturando cada
vez:

1. `getComputedStyle` del `<a>` en su estado normal (sin hover, sin foco,
   `document.activeElement` apuntando al buscador por el `autoFocus`, NO a
   esta fila) reportaba `background: transparent`, `box-shadow: none`,
   `border: ''`, `outline-style: none` — nada que explicara una costura
   visible.
2. Sacar el `className` entero → la costura desaparece.
3. Reponer clase por clase (`rounded-md` sola, `-mx-1 px-1` solas, `block`
   sola, `hover:.../focus-visible:...` solas) → **`rounded-md` SOLA ya
   reproduce la costura**, sin fondo ni borde visibles según
   `getComputedStyle`.

Conclusión: es un artefacto de composición de Chromium (headless, con
`deviceScaleFactor: 2`) al renderizar un `border-radius` sobre un elemento
sin relleno ni trazo propio — no es un estado de CSS inspeccionable con el
objeto de estilo computado, así que revisar solo los estilos no lo iba a
encontrar; hizo falta la bisección visual. **Fix**: se sacó
`-mx-1 rounded-md px-1` del wrapper `<Link>` de `DataRow` — ahora usa
exactamente el mismo patrón que `DataList` (`views/shared/data-list.tsx`,
que nunca tuvo este bug reportado): la fila-link ocupa el ancho entero a
filo, sin inset ni esquinas, y solo se distingue en hover/foco. Efecto
secundario bueno: la fila que navega ahora se ve IDÉNTICA a sus hermanas
en reposo, que era la otra mitad del pedido del coordinador ("no alinea
con las demás filas").

## Rediseño de las 3 composiciones (no solo el bug fix)

El problema de fondo que señaló el coordinador no eran los bugs: era que
**las 3 variantes tenían el mismo primer viewport** (saludo + buscador + 2
botones + "Este mes"), o sea que eran tres densidades de la misma
composición, no tres composiciones. v2 resuelve esto en dos frentes:

1. **La cabecera se achica en las 3 por igual** (no es parte de lo que
   diferencia a las variantes): saludo chico y mudo (ya no es el texto más
   grande de la página), buscador + accesos en una sola fila, nunca un
   `Panel`. Ver `dashboard-header.tsx` (nuevo, reemplaza `task-panel.tsx`
   de v1 — se borró).
2. **La plata va primero, en las 3, pero con dos formatos según quién es
   la protagonista**: `MoneyHeadline` (nuevo — grande, sin tarjeta, la
   protagonista de A) y `MoneySummaryStrip` (nuevo — compacta, una o dos
   líneas, el piso común para B y C, que no compiten con la plata por la
   lista de pendientes o el gráfico).
3. **Lo que sigue después de la plata es lo que de verdad diferencia a las
   3**: en A, el desglose completo sin plegar; en B, una lista priorizada
   de pendientes con monto y link (`priority-extras.tsx`, nuevo); en C, el
   gráfico de evolución con el mes actual destacado (`HistoryChart` ganó
   el prop `highlightCurrent`).

Para que la plata no apareciera duplicada (una vez arriba, en el
headline/strip, y otra vez en el `Panel` "Este mes"/"Deuda" de abajo),
`month-rows.tsx` y `debt-rows.tsx` se reescribieron: `MonthRows` (v1, 5
filas) pasó a `MonthDetailRows` (solo efectivo/transferencia);
`DebtHeadlineRows` (v1, con "Deuda total" incluida) pasó a
`DebtDetailRows` (sin "Deuda total", que ahora vive solo arriba).

## Archivos

**Nuevos en v2:**
- `src/views/dashboard/dashboard-header.tsx` — cabecera compacta (saludo
  chico + `HomeSearch` + hasta 2 `Button size="icon"`). Reemplaza y borra
  `task-panel.tsx` de v1.
- `src/views/dashboard/money-headline.tsx` — `MoneyHeadline`, la
  protagonista de la variante A (deuda total + cobrado/cuotas/barra/%, en
  el tamaño más grande de la escala cerrada).
- `src/views/dashboard/money-summary-strip.tsx` — `MoneySummaryStrip`, la
  versión compacta de la misma plata para B y C.
- `src/views/dashboard/priority-extras.tsx` — `PriorityExtras`, el resto de
  "qué hay que resolver" en variante B (deuda de bajas + aptos vencidos,
  solo si hay algo pendiente).

**Modificados en v2:**
- `src/views/dashboard/data-row.tsx` — fix del bug 2 (ver arriba).
- `src/views/dashboard/month-rows.tsx` — `MonthRows` → `MonthDetailRows`
  (solo efectivo/transferencia; cobrado/cuotas/% se movieron arriba).
- `src/views/dashboard/debt-rows.tsx` — `DebtHeadlineRows` →
  `DebtDetailRows` (sin "Deuda total", que se movió arriba); `TopDebtorsList`
  sin cambios.
- `src/views/dashboard/history-chart.tsx` — nuevo prop `highlightCurrent`
  (variante C): el mes actual con `fill` sólido vía `<Cell>` por punto, el
  resto atenuado con `color-mix(in oklab, ..., transparent 55%)` — mismo
  hex de estado, no una paleta nueva. Un intento de etiqueta directa sobre
  la barra actual (`LabelList` con `content`) no encontraba el punto
  correcto por el shape de props que realmente pasa Recharts 3 a un
  `content` de `LabelList` (no siempre trae `index`; hay que leerlo de
  `payload`) y, corregido eso, el único bar que existe en el seed de
  desarrollo (los otros 11 meses están en $0 y Recharts no dibuja un
  `<path>` para valor 0) no dejaba verificar el resultado — se sacó por
  simplicidad: la bajada de texto debajo del gráfico ("En septiembre 2026
  se cobró...") ya cumple el mismo rol de forma más legible y accesible
  que una etiqueta SVG chica.
- `src/views/dashboard/dashboard-variant-{a,b,c}.tsx` — reescritos enteros
  con la nueva estructura (ver `route-inicio.md` para la jerarquía completa
  de cada uno).
- `.impeccable/surfaces/route-inicio.md` — reescrito (v2 en el frontmatter).
- Capturas reemplazadas en `f3-propuestas/` (mismos nombres de archivo que
  v1, contenido nuevo).

**Sin cambios desde v1** (siguen vigentes): `dashboard-view.tsx`,
`dashboard-helpers.ts` (+ `collectionPct`, nuevo, para no repetir el
cálculo del % en `MoneyHeadline` y `MoneySummaryStrip`),
`billing-inactive-notice.tsx`, `run-failed-notice.tsx`, `history-table.tsx`,
`padron-rows.tsx`, las 3 rutas de `app/(panel)/inicio-propuestas/**`,
`scripts/capture-inicio-propuestas.mjs`.

**No tocados** (verificado de nuevo): `src/app/(panel)/page.tsx`,
`views/shell/**` (Cobranza sigue apagada — `/cobranza` todavía no existe),
`views/shared/**`, `views/payments|members|settings/**`, backend,
`supabase/**`, `tests/**`.

## Contratos consumidos

Sin cambios respecto a v1: `DashboardData`/`DashboardSummary`/
`MonthlyHistoryPoint`/`DebtByCategoryRow`/`MemberAccount`/`BillingStatus`/
`SessionInfo`/`Permission` (`models/types.ts`) vía
`reports.controller.ts::getDashboard()` y
`session.controller.ts::requirePanelAccess()`; `generatePendingFees` de
`billing.actions.ts`.

## Comportamientos de usuario implementados

- **Cabecera** (las 3 variantes): saludo (landmark `h1`, visualmente chico),
  buscador de socios, hasta 2 accesos ícono de 44×44 por permiso
  (`payments.register` → "Registrar pago", `members.write` → "Cargar ficha
  de ingreso"), ocultos por permiso — nunca la defensa real.
- **Plata visible en el primer viewport a 390, en las 3**: deuda total y
  cobrado del mes contra las cuotas del mes (con %), como protagonista
  grande en A o como línea compacta en B/C. Ambos números son link
  (`/cobranza/deuda`, `/cobranza/pagos?mes=<period>`).
- **Variante A**: desglose completo sin plegar — efectivo/transferencia,
  socios que deben, deuda de bajas aparte (T9), los 5 atrasados completos,
  evolución, padrón completo con categorías.
- **Variante B**: Panel "Qué hay que resolver" primero — aviso T1 (si
  `currentPeriodRun` es `failed`/`missing` y hay `billing.configure`,
  como primera fila del panel, no un banner aparte), los atrasados
  ordenados con nombre/meses/monto/link, deuda de bajas y aptos vencidos
  si hay alguno (nunca una fila en cero anunciando "0 problemas").
  Este mes/Deuda quedan como paneles de apoyo, sin repetir la lista.
- **Variante C**: gráfico de evolución en segundo lugar (antes cuarto), mes
  actual con la barra a color pleno y el resto atenuado, bajada de texto
  con el % del mes, tabla de 12 meses plegada VISIBLE (no solo sr-only —
  cualquiera puede pedir el detalle, no solo un lector de pantalla); los 5
  atrasados y las categorías siguen plegados en `<details>` nativo.
- **Estados** (sin cambios de v1): facturación inactiva, aviso T1, loading
  (skeletons), error (boundary con "Reintentar").
- **Accesibilidad**: fix del bug 2 mejora esto también — la fila-link ahora
  tiene el mismo target visual que sus hermanas, sin una costura que
  sugiriera un límite de click distinto al real. Los `<details>` siguen
  siendo nativos (operables por teclado, sin foco atrapado).

## Gaps de datos / rutas encontrados (sin cambios desde v1)

- **`DashboardSummary` no trae "cantidad de pagos"** del mes, que
  01-tasks.md §F3 pide para "Este mes". Existe como
  `MonthCollection.paymentsCount` (shape de `getCobranzaHub()`, no de
  `getDashboard()`). Se sigue omitiendo esa fila.
- **`/socios` todavía no tiene un filtro de estado de apto físico**: los
  links de "Aptos físicos vencidos/faltantes" caen a `/socios` sin
  filtrar (fallback explícito del spec). F2 está agregando el filtro de
  deuda a `/socios` en paralelo (visto en vivo en `socios/page.tsx`
  durante esta ronda); si suma también el de aptos, es un cambio de una
  línea acá.
- **`/socios?debt=`, `/cobranza/deuda`, `/cobranza/deuda?estado=inactive`,
  `/cobranza/pagos?mes=`, `/cobranza/nuevo` no existen todavía** (F1/F2 en
  curso): los `Link` apuntan ahí igual, tal como los especifica
  01-tasks.md — 404 hasta que aterricen, no un bug de esta ronda.
- **El orden fijo de 01-tasks.md §F3** ("Tarea del día → Este mes → Deuda →
  Evolución → Padrón") queda superado en B y C por pedido explícito del
  coordinador (necesitaba theses que se noten en el primer viewport, no
  solo densidades). Cuando se elija una composición, esa sección de
  01-tasks.md necesita reconciliarse con el orden final — señalado en
  `route-inicio.md`, no es algo que yo edite.
- Las capturas siguen con el **seed de desarrollo** (11 socios activos, un
  solo mes con cobros de los 12 de la evolución) — ver el trade-off de la
  variante C en `route-inicio.md` sobre por qué el "mes destacado" no se
  distingue visualmente todavía del resto (los otros 11 meses no dibujan
  barra en absoluto por tener valor $0, no por estar atenuados).

## Verificación

- `npx tsc --noEmit` y `npx eslint` sobre `src/views/dashboard/**` y
  `src/app/(panel)/inicio-propuestas/**`: limpios, en cada paso (no solo al
  final) — los dos bugs se diagnosticaron con Playwright contra el DOM
  real, no adivinando sobre el código.
- **Targets táctiles medidos, no a ojo**: `boundingBox()` de los dos
  accesos ícono en las 3 variantes → `{ width: 44, height: 44 }` en las 3
  (antes: `{ width: 324, height: 20 }` en v1).
- **Bisección del bug de la fila-link**: documentada arriba, reproducida y
  corregida verificando con recortes de la captura antes/después (no solo
  el diff de código).
- Revisé visualmente las 9 capturas nuevas contra el piso de calidad: sin
  kicker, sin tarjetas anidadas, sin métrica-héroe (las dos cifras de A son
  texto de página sin tarjeta/ícono/acento — no el template de "número
  grande + stats de apoyo + acento" que sí está prohibido), montos
  tabulares, estados con texto además de color, 44px en los targets
  (medido).
- No corrí `npm install`, `next build` ni levanté un segundo servidor.
  **Un artefacto no es mío**: el círculo negro con "N" fijo abajo a la
  izquierda en las capturas de 390 es el indicador de desarrollo de
  Next.js 16 (`next dev`), no parte de la UI.
- Borré los scripts de diagnóstico temporales (`scripts/_measure-tmp.mjs`)
  antes de cerrar — no quedan en el repo.

## Fin de la fase 1

Tomás eligió la variante B — "Qué hay que resolver". La construcción
definitiva es la fase 2, documentada a continuación.

---

# Fase 2 — construcción definitiva (2026-09-28)

Tomás eligió **B** y pidió, sobre esa maqueta: accesos de la cabecera con
ícono + texto corto VISIBLE (no solo `aria-label`), el buscador sin perder
el placeholder legible a 390, y la construcción de `/` reemplazando el
inicio actual entero.

## Qué se hizo

1. `src/app/(panel)/page.tsx` reescrito entero: reemplaza el inicio previo
   (buscador + accesos genéricos por rol) por el contenido de B.
2. `src/app/(panel)/loading.tsx` y `src/app/(panel)/error.tsx` (nuevos —
   `/` no tenía su propio par antes; heredaba nada porque era trivial).
3. Cabecera rediseñada (`dashboard-header.tsx`): dos filas — buscador
   completo arriba, accesos ícono+texto abajo — en vez de una fila
   compartida.
4. Limpieza: se borró `src/app/(panel)/inicio-propuestas/**` entero, las
   variantes A y C (`dashboard-variant-a.tsx`, `dashboard-variant-c.tsx`),
   el despachador `dashboard-view.tsx` (ya no hace falta con una sola
   composición), `money-headline.tsx` (exclusiva de A), el export
   `HistoryTableDisclosure` de `history-table.tsx` y el prop
   `highlightCurrent` de `history-chart.tsx` (exclusivos de C), y el script
   `scripts/capture-inicio-propuestas.mjs` (apuntaba a rutas que ya no
   existen).
5. `dashboard-variant-b.tsx` → renombrado a `dashboard-content.tsx`
   (`DashboardVariantB` → `DashboardContent`): ya no hay una "variante B"
   que distinguir de otras, es simplemente el contenido del inicio: dejar
   el nombre "variante B" en el código habría sido confuso para quien lo
   lea sin el contexto de esta ronda.
6. `views/shell/nav-items.ts`: `COBRANZA_ENABLED` de `false` a `true`
   (única línea tocada de `views/shell/**`, autorizado por la tarea —
   `/cobranza` ya existe).
7. Capturas + verificación con Playwright en
   `docs/pipelines/2026-09-27-cuotas-pagos-panel/f3-final/`, con
   `scripts/capture-inicio-final.mjs` (nuevo, reemplaza al de propuestas).
8. `.impeccable/surfaces/route-inicio.md` actualizado con la decisión (v3).

## El pedido de ajuste sobre la cabecera

Tomás pidió explícitamente **"ícono con texto corto (Pago / Alta o
similar), visible, no solo sr-only"** y que el buscador no perdiera el
placeholder legible a 390.

- **Los accesos** pasaron de `Button size="icon"` (44×44, sin texto, solo
  `aria-label`) a `Button size="sm"` con ícono + texto visible ("Pago",
  "Alta") — `size="sm"` en este repo también da 44px de alto siempre (la
  regla de `button.tsx`: "default/sm/icon/icon-sm dan 44px de target
  siempre"), así que el piso táctil no se movió, solo se agregó el texto.
  Sin `aria-label` que lo reemplace: el nombre accesible es el texto visible
  ("Pago"/"Alta"), y un `title` con la acción completa
  ("Registrar pago"/"Cargar ficha de ingreso") para el tooltip en mouse —
  así el nombre accesible cumple WCAG 2.5.3 (Label in Name) trivialmente,
  sin arriesgar un `aria-label` que no contenga el texto visible como
  substring (con "Alta" eso hubiera fallado contra un nombre más largo
  como "Cargar ficha de ingreso", que no contiene la palabra "Alta").
- **El buscador** volvió a ocupar su propia fila completa. Compartir fila
  con dos botones de texto (más anchos que los íconos-solo de la ronda
  anterior) dejaba menos espacio todavía, así que "reacomodar la fila"
  (la alternativa que el coordinador ofreció) era la solución más simple:
  buscador arriba, accesos abajo. Verificado con Playwright: el atributo
  `placeholder` completo ("Buscar un socio por nombre o DNI…") sigue
  presente y visualmente entero a 390 (ver capturas).

## Session/permisos y el estado "sin acceso a reportes"

La page NO usa `requirePanelAccess()` — mismo motivo que el inicio
anterior a este slice (comentario que ya estaba en el código viejo, ahora
también en el nuevo): sin rol activo, ese guard redirige a `/`, que es
ESTA MISMA page — un loop. Se repiten a mano las dos verificaciones que sí
hacen falta (sin sesión → `/login`; contraseña temporal →
`/cambiar-contrasena`) y "sin rol" se resuelve mostrando el estado vacío
en vez de redirigir.

Además, `getDashboard()` (`reports.controller.ts`) exige el permiso
`reports.read` con `requirePanelPermission`, que TAMBIÉN redirige a `/` si
falta — el mismo loop, un nivel más abajo. La page evita llamarla cuando
`session.permissions` no incluye `reports.read` (o no hay rol activo) y en
su lugar muestra la cabecera + un `EmptyState` explicando que el rol no
tiene acceso a los reportes. Hoy los 3 roles fijos (admin/editor/consulta)
tienen `reports.read` — es decir, esta rama no se ejerce con los roles de
hoy — pero es la regla correcta por permiso (T12), no por rol, para
cuando existan roles configurables sin ese permiso. Ningún monto se
muestra en ese caso ("sin `payments.read`/`reports.read`, nada de montos",
pedido explícito): como toda la plata sale de la misma `getDashboard()`,
no llamarla es la forma más simple de garantizarlo (no hay un camino donde
se pida solo una parte de los datos).

## Estados verificados

- **Carga**: `src/app/(panel)/loading.tsx`, skeletons con las mismas
  alturas aproximadas que el contenido real (incluida la del gráfico,
  `h-64`).
- **Vacío**: facturación inactiva → `BillingInactiveNotice` (ya existía);
  sin atrasados → el mensaje propio de `TopDebtorsList` ("Ningún socio
  activo tiene deuda"); sin deuda de bajas ni aptos vencidos →
  `PriorityExtras` devuelve `null` (nunca una fila en cero); sin
  `reports.read` → el `EmptyState` nuevo descripto arriba.
- **Error**: `src/app/(panel)/error.tsx`, boundary con "Reintentar" (mismo
  patrón que el resto del panel).
- **Facturación inactiva** y **generación fallida con "Reintentar" solo
  para `billing.configure`**: sin cambios de comportamiento respecto a la
  fase 1 (`BillingInactiveNotice`, `RunFailedNotice` +
  `shouldShowRunNotice`), ya eran correctos.

## Verificación (con Playwright, no a ojo)

Script: `scripts/capture-inicio-final.mjs`, contra el `next dev` compartido
en `:3000` (login `admin@lonqui.test`). Resultados:

- **Targets táctiles**: los dos accesos ("Pago", "Alta") miden
  `{ height: 44 }` px a 390 y a 1440.
- **Sin overflow horizontal** en ninguno de los dos viewports
  (`document.documentElement.scrollWidth <= clientWidth`).
- **Placeholder del buscador completo**: `"Buscar un socio por nombre o
  DNI…"`, sin cortar, en las dos anchuras.
- **Barra inferior de admin** (390): `Más · Usuarios · Inicio · Cobranza ·
  Socios` — exactamente el orden esperado. Verificado apuntando al
  `<nav>` fijo (`nav.fixed.inset-x-0.bottom-0`), NO al primer `<nav
  aria-label="Navegación principal">` del DOM — `DesktopNavList` comparte
  ese mismo `aria-label` y aparece ANTES en el árbol (oculto por CSS
  `hidden md:flex`, no ausente), así que un selector ingenuo por
  `aria-label` agarra la barra de escritorio aunque esté oculta a 390 y
  reporta los 6 destinos sin agrupar en "Más" — un detalle a tener en
  cuenta para cualquier verificación futura de esta barra.
- **Cero errores de consola** en `/` (los listeners arrancan después del
  login: `/login` tiene un warning de hidratación preexistente,
  `method="post"` vs. `"POST"`, ajeno a esta ronda y a F3).
- `npx tsc --noEmit` y `npx eslint` sobre `src/views/dashboard/**`,
  `src/app/(panel)/page.tsx`, `src/app/(panel)/loading.tsx`,
  `src/app/(panel)/error.tsx` y `views/shell/nav-items.ts`: limpios.
- Confirmé por `grep` que no quedan referencias a los nombres borrados
  (`dashboard-variant-a`, `dashboard-variant-c`, `dashboard-view`,
  `money-headline`, `HistoryTableDisclosure`, `highlightCurrent`,
  `DASHBOARD_VARIANTS`) en `src/` ni en `tests/`.

## Archivos (fase 2)

**Nuevos:**
- `src/app/(panel)/loading.tsx`, `src/app/(panel)/error.tsx`.
- `src/views/dashboard/dashboard-content.tsx` (contenido final, ver arriba
  por qué reemplaza a `dashboard-variant-b.tsx`).
- `scripts/capture-inicio-final.mjs`.
- `docs/pipelines/2026-09-27-cuotas-pagos-panel/f3-final/` (capturas).

**Modificados:**
- `src/app/(panel)/page.tsx` — reescrito entero (ver "Session/permisos"
  arriba para la lógica de guards).
- `src/views/dashboard/dashboard-header.tsx` — cabecera de 2 filas, accesos
  con texto visible.
- `src/views/dashboard/history-table.tsx` — sin `HistoryTableDisclosure`.
- `src/views/dashboard/history-chart.tsx` — sin `highlightCurrent`.
- `src/views/shell/nav-items.ts` — `COBRANZA_ENABLED = true` (única línea).
- `.impeccable/surfaces/route-inicio.md` — decisión final (v3).

**Borrados:**
- `src/app/(panel)/inicio-propuestas/**` (índice + `[variante]/page.tsx` +
  `loading.tsx` + `error.tsx`).
- `src/views/dashboard/dashboard-variant-a.tsx`,
  `dashboard-variant-b.tsx` (renombrado, no simplemente borrado — ver
  arriba), `dashboard-variant-c.tsx`, `dashboard-view.tsx`,
  `money-headline.tsx`.
- `scripts/capture-inicio-propuestas.mjs`.

**No tocado**: `01-tasks.md` (pedido explícito del coordinador — ver nota
abajo), `views/shared/**`, `views/payments|members|settings/**`, backend,
`supabase/**`, `tests/**`, y de `views/shell/**` solo la línea del flag.

## Nota para quien cierre el pipeline

**El orden de contenido de B reemplaza el orden fijo que `01-tasks.md`
§F3 tenía escrito** ("Tarea del día → Este mes → Deuda → Evolución →
Padrón"). El orden real y definitivo, de arriba a abajo, es: cabecera →
plata (`MoneySummaryStrip`) → "Qué hay que resolver" (atrasados + aviso T1
+ otros pendientes) → Este mes → Deuda → Evolución → Padrón. No edité
`01-tasks.md` (pedido explícito), pero esa sección queda desactualizada
respecto al código — quien lo revise debería reconciliarla o marcarla como
superada por esta decisión.

## Gaps de datos / rutas — siguen abiertos

Sin cambios respecto a la fase 1: `DashboardSummary` sigue sin "cantidad
de pagos" del mes (existe en `MonthCollection.paymentsCount`, shape
distinto); `/socios` sigue sin filtro de estado de apto físico (los links
de "Aptos físicos vencidos/faltantes" caen a `/socios` sin filtrar). Ver
la sección de gaps de la fase 1 más arriba para el resto.
