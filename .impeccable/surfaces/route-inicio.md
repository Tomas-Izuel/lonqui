---
version: 5
slug: "route-inicio"
primary_target: "route:/"
related_targets: []
---

# Panel inicial — de la ronda de composición a la definitiva (F3)

## Ronda 2 (2026-09-28): redundancia y accesos de la cabecera

Revisión del coordinador sobre capturas reales a 390/1440 con datos de demo
(~200 socios), sobre lo construido en v4 (abajo). Tres correcciones, sin
tocar nada fuera de `src/views/dashboard/**`:

1. **Los accesos de la cabecera eran chips, no botones.** `size="sm"` de
   shadcn ya daba 44px técnicos, pero el ancho de contenido (una palabra:
   "Pago", "Alta") y el padding chico los hacían LEER como chips. Ahora son
   botones con la etiqueta completa ("Registrar pago", "Ficha de ingreso"),
   en grilla de 2 columnas que llena el ancho a 390 y ancho automático lado
   a lado desde `sm`. "Registrar pago" es la acción primaria; "Ficha de
   ingreso" es `outline`.
2. **Se borraron los `Panel`s "Este mes" y "Deuda" enteros — eran
   redundancia pura, no una segunda lectura del mismo dato.** "Deuda"
   repetía "N socios deben" (ya en el `supporting` de la `HeroFigure`, con
   el mismo link) Y "Deuda de socios dados de baja" (ya en "Otros
   pendientes" del panel "Qué hay que resolver"). "Este mes"
   (efectivo/transferencia/cantidad de pagos) repetía la relación
   cobrado/cuotas que ya cubre el medidor del hero. Efectivo/transferencia
   pasaron a una barra fina de 2 segmentos + texto directo ("Efectivo $X ·
   Transferencia $Y · N pagos") debajo del medidor, dentro del mismo bloque
   sobre `bg-brand-soft`. **Estructura final**: hero → "Qué hay que
   resolver" → "Evolución" → "Padrón". `month-rows.tsx` se borró entero
   (era el único consumidor de `MonthDetailRows`); `DebtDetailRows` se sacó
   de `debt-rows.tsx` por el mismo motivo (sin consumidor).
3. **Los puntos de "meses de atraso" leían ruidosos con moras largas**
   ("●●●●●● +3" al lado de "9 meses" — la misma cifra tres veces). Se sacó
   el contador "+N": ahora son como mucho 6 puntos llenos y nada más: el
   número exacto sigue en el texto, los puntos solo dan una lectura rápida
   de severidad sin sumar otro número a mirar.

## v4 (2026-09-28): pipeline `2026-09-28-ui-expresiva` — hero figure, charts, stagger

Tomás, después de ver el sistema funcionando: "home es todo números, ni un
gráfico, ni una animación, poco atractiva". No reabre la decisión de v3 (la
composición sigue siendo "Qué hay que resolver", plata → pendientes → este
mes → deuda → evolución → padrón): ejecuta esa misma composición con menos
"planilla" y más lectura de un vistazo, sobre los contratos que fijó el
hilo principal (`motion.ts`, `hero-figure.tsx`, `chart-kit.tsx`,
`overlay-params.ts`, `01-tasks.md` de ese pipeline).

- **La plata (`MoneySummaryStrip`) ya no es dos líneas de texto sueltas.**
  "Deuda total" pasó a ser la única `HeroFigure` de la página (tipografía
  proporcional ≥48px, cuenta desde 0 una sola vez por sesión de browser,
  `sessionStorage`) con el medidor lineal de "% de las cuotas del mes
  cobrado" al lado (relleno recortado a 100%, el número sigue leyendo el
  valor real si excede). Las dos comparten un único bloque sobre
  `bg-brand-soft` — la única superficie no blanca del panel entero, a
  propósito, para que el ojo aterrice ahí primero a 390px.
- **"Los socios más atrasados" entra con una animación escalonada**
  (`staggerDelay`, techo ≤ 400ms combinado, opacidad sola con
  `prefers-reduced-motion`) y cada fila visualiza los meses de atraso con
  puntos además del texto (`MonthsBehindDots`, decorativo, nunca reemplaza
  el número). Un click plano sobre la fila abre la vista rápida
  (`?ver=<id>`) en vez de navegar de una — Cmd/Ctrl/clic del medio siguen
  yendo directo a la ficha.
- **El gráfico de evolución dejó de "romperse" al tocarlo.** La causa real
  no era visual: sin `isAnimationActive` explícito, recharts volvía a
  animar las barras en CADA re-render, incluido el que dispara el propio
  hover del tooltip — se sentía como que el gráfico "saltaba". Ahora usa
  `useChartEntrance()` (`chart-kit.tsx`): se dibuja una vez al montar y
  queda quieto. También suma un dominio de eje Y con margen (nunca el pico
  pegado al borde) y los colores/tooltip compartidos de `chart-kit`.
- **"Socios y deuda por categoría" pasó de una columna de números a
  `CategoryDebtChart` (compacto)**: una barra de magnitud detrás de cada
  fila (mismo componente que usa `/cobranza`, contrato C5 del pipeline,
  dueño F-cobranza) — de un vistazo se ve quién debe más, no hay que leer
  doce números para compararlos.
- **"Pago" en la cabecera dejó de navegar a `/cobranza/nuevo`**: abre el
  overlay global de cobranza (`?pagar=buscar`) encima de la página actual.
  "Alta" no cambió (sigue yendo a `/socios/nuevo`, fuera del alcance de
  overlays de este pipeline).

Detalle completo (decisiones de color/contraste del medidor, por qué no se
reutilizó `Panel` para el bloque de plata, y los archivos tocados) en
`docs/pipelines/2026-09-28-ui-expresiva/02-development-frontend-inicio.md`.

## Decisión final (v3, 2026-09-28)

**Tomás eligió la variante B — "Qué hay que resolver".** Es el contenido
definitivo de `/` desde F3 fase 2: `src/app/(panel)/page.tsx` +
`src/views/dashboard/dashboard-content.tsx`. Las rutas de comparación
(`/inicio-propuestas/**`) y las otras dos composiciones (A y C) se
borraron — este documento queda como el registro de por qué se hizo así,
no como un menú vigente.

**Por qué B**: de las tres, es la que responde primero la pregunta que más
pesa según `PRODUCT.md` — Tesorería carga pagos con alguien esperando, y
"a quién le tengo que cobrar hoy" es más accionable en el momento que "cómo
venimos en el año" (C) o el resumen sobrio de A. La lista de atrasados con
monto y link, arriba de todo después de la plata, deja a un toque la
acción más frecuente del sistema (Product Principle 2: "cargar un pago es
lo más rápido").

**Ajustes pedidos sobre la maqueta de B** (fase 2, ver el dev log para el
detalle):
- Los accesos de la cabecera pasaron de ícono-solo (44×44, sin texto
  visible) a ícono + texto corto VISIBLE ("Pago", "Alta"), siguiendo
  siendo 44px de alto.
- El buscador volvió a su propia fila completa (en vez de compartir fila
  con los accesos): a 390, con los dos botones al lado, el placeholder se
  cortaba ("Buscar un socio por nombre o DNI…" → "…nomt"). Ahora es
  buscador (fila 1) + accesos (fila 2), cabecera de 2 filas en vez de 1,
  pero sigue sin ser un `Panel`.
- El orden de contenido de B (plata → "Qué hay que resolver" → Este mes →
  Deuda → Evolución → Padrón) **reemplaza** el orden fijo que
  `01-tasks.md` §F3 tenía escrito ("Tarea del día → Este mes → Deuda →
  Evolución → Padrón"). No se editó `01-tasks.md` — queda anotado acá y en
  el dev log para quien cierre el pipeline.

## Lo que sigue de la ronda de composición (histórico)

Todo lo de abajo describe el proceso que llevó a elegir B — las 3
composiciones que se compararon, sus theses, y los dos bugs de piso que se
encontraron y corrigieron en el camino (v2). Se conserva porque explica el
"por qué" de decisiones que ya son permanentes (la cabecera de 2 filas, el
`DataRow` sin `rounded-md`, etc.), no porque siga habiendo 3 opciones.

## v2 (2026-09-28): reescritura de la ronda de composición

Rehecho entero después de la primera revisión del coordinador sobre v1. v1
tenía un problema de fondo — las 3 variantes compartían el mismo primer
viewport a 390 (saludo + buscador + 2 botones + "Este mes") y solo diferían
más abajo del pliegue: eran tres densidades de la misma composición, no
tres composiciones. v2 reescribió la cabecera y las tres theses para que se
noten en el primer viewport, y corrigió dos bugs de piso encontrados en esa
revisión (ver "Bugs corregidos").

Hereda el mundo canon de `.impeccable/surfaces/route.md` (Restrained, Linear
+ Mercado Pago, naranja quemado mudo, Geist, radios de 8px) — esta ronda no
reabre la dirección visual.

## Lo que cambió de fondo

**"El inicio actual es espacio desperdiciado" no es solo el bloque
buscador + 2 botones — es CUALQUIER cosa que no sea plata ocupando el
primer vistazo.** El saludo ("Hola, Admin" / descripción) y el bloque de
accesos directos eran, en v1, tan grandes como o más grandes que la
primera cifra de plata. Correcciones:

- **El saludo se achica y calla.** Sigue siendo un `<h1>` real (hace falta
  el landmark para el lector de pantalla), pero visualmente es una línea
  chica y muda (`text-sm text-muted-foreground`) — ya no es el texto más
  grande de la página. Eso ahora es la plata.
- **El buscador + los 2 accesos dejan de ser un `Panel`.** Son una sola fila
  compacta: el buscador (`HomeSearch`, reutilizado tal cual) y los dos
  accesos como botones ÍCONO de 44×44 (`Button size="icon"`, componente de
  shadcn), no botones de ancho completo con texto. Chicos y secundarios,
  como pidió el coordinador — nunca un bloque de color que compita con la
  plata. Ocultos por permiso (`payments.register`, `members.write`), nunca
  la defensa real.
- **La plata va primero, en las 3 variantes.** Deuda total y cobrado del
  mes (con su relación contra las cuotas del mes) tienen que verse en el
  primer viewport a 390 en las tres, sin excepción — es el piso común,
  independiente de cuál sea la protagonista de cada una. En A es
  literalmente la protagonista (`MoneyHeadline`, grande); en B y C es una
  línea compacta (`MoneySummaryStrip`) que no compite con la lista de
  pendientes o el gráfico.

## Bugs corregidos (código, no solo diseño)

1. **Botones ícono medían ~20px de alto, no 44px.** Root cause: en v1, los
   dos accesos eran `<Link>` con `h-11` DENTRO de un contenedor `flex
   flex-col sm:flex-row` — a 390 (`flex-col`, eje principal vertical) la
   clase `flex-1` (`flex-basis: 0%`) gana sobre la altura explícita: el
   tamaño mínimo automático de un ítem flex en un contenedor en columna se
   calcula por contenido, no por `height`, así que el botón se achicaba al
   alto del texto+ícono (~20px) ignorando `h-11`. Confirmado midiendo con
   Playwright (`boundingBox()` daba `height: 20`) antes de tocar nada.
   **Solución adoptada**: los accesos ahora son `Button asChild size="icon"`
   de shadcn (`size-11` fijo, ancho Y alto, sin depender de `flex-grow` en
   un contenedor en columna) — mismo patrón ya probado en
   `views/payments/month-selector.tsx`. Reverificado con Playwright:
   `{width: 44, height: 44}` en las 3 variantes (ver dev log).
2. **La fila-link "Cobrado en septiembre 2026" se veía como una tarjeta
   suelta dentro del Panel**, con una costura redondeada que las filas
   hermanas (sin link) no tenían. Bisección con Playwright (aplicando
   className parcial en vivo sobre el DOM real, sin tocar el archivo, hasta
   aislar la clase culpable): `rounded-md` SOLO, sobre un `<a>` sin fondo ni
   borde propios, ya alcanza para que Chromium deje una costura visible en
   el borde curvo (headless, con `deviceScaleFactor: 2`) — sin que
   `getComputedStyle` reporte ningún `background`/`border`/`box-shadow`
   detectable; es un artefacto de composición del navegador sobre un
   `border-radius` sin relleno, no un estado CSS que se pueda inspeccionar
   con el objeto de estilo computado. **Solución adoptada**: se sacó
   `-mx-1 rounded-md px-1` del link de `DataRow` — ahora usa exactamente el
   mismo patrón que `DataList` (`views/shared/data-list.tsx`): el link ocupa
   la fila entera a filo, sin inset ni esquinas, y solo se distingue en
   hover/foco (`hover:bg-muted/50 focus-visible:bg-muted/50`). Reverificado
   recortando las capturas nuevas: línea recta, igual que sus hermanas.

## Lo que las tres comparten (piso común, no varía)

- Cabecera compacta: saludo chico + buscador + hasta 2 accesos ícono de
  44×44 por permiso. Nunca un `Panel`.
- Deuda total y cobrado del mes (con su % contra las cuotas del mes)
  visibles en el primer viewport a 390, en las tres.
- Mismo aviso T1 ("No se generaron las cuotas de <mes>" + Reintentar),
  mismo estado de facturación inactiva, mismos roles ocultando botones
  (nunca la defensa real).
- Mismo gráfico de evolución (`recharts`, skill `dataviz`): `Bar` "Cobrado"
  + `Line` "Deuda al cierre" en un solo eje. Colores reutilizados de los
  estados ya validados en toda la app (`status-up-to-date` /
  `status-in-debt`) — uso de estado, no una paleta categórica nueva.
  Mitigación del par rojo/verde: formas de marca distintas, leyenda con
  texto, tooltip con texto y monto, tabla accesible con el mismo dato.
- Sin plantilla métrica-héroe de tarjetas, sin grilla de tarjetas
  icono+título+texto, sin kicker, montos con numerales tabulares, `Panel`s
  que nunca se anidan.

Lo que varía ahora es real: **qué es lo primero que se lee después de la
plata**, no solo cuánto se pliega más abajo.

## Variante A — "Estado de cuenta del club"

**Tesis:** dos cifras grandes y sobrias — deuda total y cobrado del mes con
su barra de proporción contra las cuotas del mes — como texto de página
(sin tarjeta, sin ícono, sin acento), y debajo el desglose completo sin
nada plegado. Responde primero "¿cuánto debemos y cuánto cobramos, con el
detalle ya a la vista?".

**Qué se ve en el primer viewport a 390** (ver
`variante-a-390-viewport.png`): cabecera compacta → **"Deuda total $X" y
"Cobrado en <mes> $Y" en 20/24px (el tamaño más grande de la escala
cerrada, más grande que cualquier título de `Panel`), con la barra y el %**
→ arranca el Panel "Este mes" (efectivo/transferencia). La plata no es una
promesa más abajo: es lo segundo que se lee, entera.

**Jerarquía completa:** cabecera → `MoneyHeadline` (deuda total + cobrado/
cuotas/barra/%) → Panel "Este mes" (efectivo, transferencia) → Panel
"Deuda" (socios que deben, deuda de bajas, los 5 atrasados completos) →
Panel "Evolución" (gráfico + tabla accesible oculta) → Panel "Padrón"
(activos/altas/bajas, aptos, las categorías completas).

**Adaptación a 1440:** una sola columna centrada con la barra lateral fija
(no dos columnas: la comparación de un layout más ancho no gana nada
partiendo `MoneyHeadline` de sus paneles de apoyo). `MoneyHeadline` pasa a
fila horizontal (`sm:flex-row`) en vez de apilada.

**Trade-off:** es la más larga de las tres (**5072px** a 390 con el seed de
desarrollo). Gana en que nada exige un tap extra: todo el detalle está ya
ahí para quien lee toda la pantalla, con la plata resuelta antes que nada.

## Variante B — "Qué hay que resolver"

**Tesis:** después de la plata en una línea compacta, lo primero NO es un
resumen sino una lista priorizada de pendientes con su monto y su link —
a quién llamar (los más atrasados, ordenados), el aviso de generación
fallida si corresponde, y el resto (deuda de bajas, aptos vencidos).
Responde primero "¿qué tengo que hacer hoy?", no "¿cómo estamos?" — la
diferencia real frente a A y C es de INFORMACIÓN, no de densidad.

**Qué se ve en el primer viewport a 390** (ver
`variante-b-390-viewport.png`): cabecera compacta → `MoneySummaryStrip`
("Deuda total $X · Cobrado en <mes> $Y de $Z (N%)", una o dos líneas) →
Panel **"Qué hay que resolver"** con "Los socios más atrasados" (nombre,
meses, monto, link a la ficha — los primeros 4-5 ya visibles) y, si hay,
"Otros pendientes" (aptos vencidos, deuda de bajas). El aviso de corrida
fallida, cuando aplica, es la PRIMERA fila de este mismo Panel — no un
banner aparte.

**Jerarquía completa:** cabecera → `MoneySummaryStrip` → Panel "Qué hay que
resolver" (aviso T1 si aplica + atrasados + otros pendientes) → Panel "Este
mes" (efectivo/transferencia, ahora secundario) → Panel "Deuda" (totales,
sin repetir la lista de atrasados) → Panel "Evolución" → Panel "Padrón".

**Adaptación a 1440:** misma columna única; el Panel "Qué hay que resolver"
es el más alto y va primero, coherente con ser el protagonista.

**Trade-off:** es la más larga de las tres con el seed de hoy
(**5226px** — el seed tiene varios socios atrasados y aptos vencidos, así
que la lista de pendientes es larga por sí sola). Hay una superposición
deliberada: "Deuda de bajas" y "aptos vencidos" aparecen en la lista de
pendientes Y (los aptos) en el Panel "Padrón" más abajo — es el patrón
normal de un digest de alertas arriba + el dato completo abajo, no una
repetición accidental (ver dev log). Gana en foco de acción: quien abre el
inicio para llamar a alguien no tiene que buscar la lista, es lo primero
después de la plata.

## Variante C — "Cómo viene el año"

**Tesis:** después de la plata en una línea compacta, el protagonista es la
evolución mensual — el gráfico sube de cuarto a segundo lugar, con el mes
actual distinguido (barra a color pleno, el resto atenuado — con más de un
mes real de datos; el seed de desarrollo solo tiene un mes con cobros, así
que hoy se ve un solo bar) y una bajada de una línea que dice cómo cerró.
Responde primero "¿venimos bien en el año?", no "¿cuánto debemos hoy?".

**Qué se ve en el primer viewport a 390** (ver
`variante-c-390-viewport.png`): cabecera compacta → `MoneySummaryStrip` →
el gráfico "Cómo viene el año" ya visible con su título, casi completo.
Es la única de las tres donde el gráfico entra en el primer vistazo.

**Jerarquía completa:** cabecera → aviso T1 (si aplica) → `MoneySummaryStrip`
→ Panel "Cómo viene el año" (gráfico con el mes actual destacado + bajada
de texto + "Ver tabla de los 12 meses" plegada) → Panel "Este mes" → Panel
"Deuda" (totales + "Ver los 5 socios más atrasados" plegado) → Panel
"Padrón" (headline + "Ver deuda por categoría" plegado). La divulgación
progresiva de v1 se mantiene para la cola larga (atrasados, categorías):
sostiene la lectura corta que le da sentido a poner el gráfico primero.

**Adaptación a 1440:** misma columna única; a este ancho el ahorro de alto
importa menos, pero mantiene el mismo patrón que a 390 — no hay una regla
distinta por breakpoint que memorizar.

**Trade-off:** con el seed de desarrollo (11 meses en $0, uno con cobros)
el "mes destacado" no se distingue de "los demás meses atenuados" porque
los demás directamente no dibujan barra (valor $0 no renderiza rectángulo
en `recharts`) — el mecanismo de atenuación está verificado por código
(Playwright: el único `<path>` de barra que existe tiene el fill sólido
correcto) pero su efecto visual completo solo se aprecia con el padrón real
(~250 socios, más de un mes con cobros). Es la más corta: **3344px**, un
34% menos que A y un 36% menos que B con el seed de hoy.

## Recomendación

**Variante C**, con **B como alternativa fuerte si Tesorería es quien más
usa el inicio**. El Product Principle 1 ("¿cómo estamos?" en diez segundos)
y el Principle 5 ("autónomo sin el desarrollador") favorecen una lectura de
tendencia rápida sin sacrificar el detalle (un tap). Pero el uso real de
esta pantalla, según `PRODUCT.md`, es sobre todo de **Tesorería y
Presidencia, la primera para cargar pagos con alguien esperando** — para
esa persona, "qué hay que resolver" (variante B) puede ser más accionable
que "cómo viene el año": la pregunta del día no es la tendencia, es "¿a
quién le tengo que cobrar?". Ninguna de las dos es equivocada; la eligen
según qué rol abre el inicio con más frecuencia — dato que no tengo (no es
parte de mi alcance medirlo). A no se recomienda como definitiva: con las
~250 socios y hasta 12 categorías reales, "todo sin plegar" vuelve a la
"vitrina que no es un panel de tarea" que Operate pide evitar — pero es la
más simple de razonar y la más fácil de mantener si la simplicidad pesa
más que el ahorro de scroll.

## Evidencia

Capturas en `docs/pipelines/2026-09-27-cuotas-pagos-panel/f3-propuestas/`
(390 página completa + primer viewport, y 1440), contra `getDashboard()`
con datos reales del stack local (11 socios activos del seed de
desarrollo — no representa el volumen real de ~250, ver trade-offs
arriba). Medidas de targets táctiles (Playwright `boundingBox()`, no a
ojo): los dos accesos ícono miden 44×44px en las 3 variantes.

| Variante | Alto a 390px (página completa) |
|---|---|
| A | 5072px (`variante-a-390.png`) |
| B | 5226px (`variante-b-390.png`) |
| C | 3344px (`variante-c-390.png`) |

`variante-{a,b,c}-390-viewport.png` = lo que se veía sin scrollear en cada
propuesta, en `docs/pipelines/2026-09-27-cuotas-pagos-panel/f3-propuestas/`
(se conservan como registro histórico de la comparación; las capturas de
la page definitiva están en `f3-final/`, ver el dev log).

## Estado (post fase 2)

- `src/app/(panel)/page.tsx` ya es la page definitiva (contenido de B) —
  ver "Decisión final" arriba.
- `/inicio-propuestas/**` y las variantes A/C de `src/views/dashboard/**`
  se borraron.
- El flag `COBRANZA_ENABLED` de `views/shell/nav-items.ts` está prendido.
- Ver `02-development-frontend-f3.md` para los gaps de datos y de rutas que
  siguen abiertos (conteo de pagos del mes ausente en `DashboardSummary`,
  filtro de aptos físicos ausente en `/socios`) y el detalle completo de
  los bugs corregidos en el camino.
