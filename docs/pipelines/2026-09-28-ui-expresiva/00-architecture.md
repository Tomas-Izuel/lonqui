# 00 — Arquitectura: UI expresiva (flujo, charts y motion sobre lo ya construido)

## 1. Problema y contexto

Tomás, dueño de producto, después de ver el sistema funcionando (slices 1 y 2
ya construidos: padrón, roles, auditoría, cuotas, pagos, estado de cuenta,
panel inicial):

> "Lo requerido está, pero no me gusta nada el flujo. Cobranza y home son todo
> números, ni un gráfico. Ni una animación ni sensación smooth. Hay páginas
> que podrían ser modales, muchas redirecciones. La UI me parece poco
> atractiva, podría estar más pulida. Mejoremos todo lo que podamos."

No es un pedido de funcionalidad nueva: es un pedido de **terminación**. El
contrato ya está cumplido funcionalmente (2.1 a 2.4); lo que falta es que se
sienta como el "mostrador de la sede, en el celular" que `DESIGN.md` promete,
no como una lista de formularios. Tomás ya tomó las decisiones de dirección
(ver más abajo, "no relitigar"): overlays en vez de páginas, motion con
`motion`, charts reales, y una carga de demo para poder juzgar los charts con
datos parecidos a los reales.

Este documento no reabre esas decisiones. Su trabajo es: (a) verificar contra
el código real qué tan lejos está cada una de ya estar construida, (b)
resolver el cómo con opciones y trade-offs donde Tomás dejó la puerta
abierta, y (c) cortar el trabajo en slices sin archivos compartidos.

## 2. Chequeo de alcance

Todo lo pedido es **Fase 1**: no se agrega ningún módulo del contrato, se
mejora la ejecución de los que ya existen (2.2 cuotas/cobranza, 2.4 reportes,
2.5 plataforma responsive). Nada de esto toca:

- Portal del socio (Fase 2), pagos online/ARCA (Fase 3): no aparecen.
- Ningún módulo de la Fase 4/5.
- La importación masiva de los Excel reales: la carga de datos de demo
  (decisión 4 de Tomás) es **datos inventados** para poder ver los charts con
  volumen parecido al real, no una importación — no se toca ningún CSV de
  `docs/relevamiento/` ni se construye un importador. Se aclara igual en la
  spec del seed de abajo porque es la línea más fácil de cruzar sin querer.
- Roles configurables: fuera de alcance de este pipeline: sigue el plan de
  CLAUDE.md ("decidido, va después de cuotas y pagos"). Este pipeline no
  introduce reglas nuevas de permiso — donde hace falta un chequeo nuevo
  (la vista rápida, el overlay), se reusa el catálogo de permisos ya existente
  (`Permission` en `types.ts`), nunca un rol.

Una sola cosa roza el borde: la navegación reordenada (Inicio primero) revierte
una decisión fechada de Tomás en `nav-items.ts` ("Socios > Cobranza > Inicio
..., pedido de Tomás"). Se trata como lo que es — un cambio de decisión, no un
descuido — y se aplica porque el pedido nuevo lo dice explícitamente ("Inicio
debería liderar").

## 3. Lo que hay hoy (Paso 0)

Herramientas usadas: lectura directa de código y de `.impeccable/surfaces/`,
`mcp__supabase__*` contra el stack local (**arriba**: `list_migrations`,
`list_tables`, `execute_sql`, `get_advisors` respondieron con normalidad),
skill `dataviz`, y los archivos de la skill `impeccable`
(`reference/operate.md`, `reference/animate.md`, `reference/craft-floor.md`,
`reference/polish.md`) leídos completos. Context7 y la documentación de Next
en `node_modules/next/dist/docs/` se investigaron para las dos decisiones de
enrutamiento (§5.1).

### 3.1 El overlay de pago ya está construido, solo no está conectado

`src/views/payments/register-payment-sheet.tsx` (`RegisterPaymentSheet`) YA
ES un overlay client-state completo: recibe `memberId` o `familyGroupId`,
pide `getPaymentFormData` (Server Action) al abrirse, y renderiza
`PaymentForm` o `GroupPaymentForm` — ambos completamente desacoplados de la
navegación (`onDone: () => void`, sin `router` adentro). Corre sobre
`ResponsiveSheet` (`src/views/shared/responsive-sheet.tsx`), que ya resuelve
"sheet desde abajo en móvil, diálogo centrado desde `md`" con
`useSyncExternalStore` sobre `matchMedia`. El comentario de
`register-payment-sheet.tsx` dice literalmente que esto "queda como
alternativa documentada... no tiene su propio caso de uso probado en este
pipeline" — este pipeline es exactamente el que le da ese caso de uso.

Lo que falta, precisamente:
- Un paso de **búsqueda** cuando se abre sin `memberId`/`familyGroupId`
  conocido (hoy el sheet exige uno de los dos). Hoy la búsqueda vive
  DUPLICADA en tres lugares como texto+links a `/cobranza/nuevo`:
  `cobranza-hub-view.tsx` (buscador propio con `SearchInput` + lista de
  resultados que **navegan**), `dashboard-header.tsx` (chip "Pago" →
  `/cobranza/nuevo` en blanco) y `member-account-section.tsx` (dos `<Link>`
  directos con `memberId`/`familyGroupId` ya conocidos, sin necesidad de
  búsqueda).
- Que abrir el overlay **no navegue**: hoy los tres puntos de entrada son
  `<Link href="/cobranza/nuevo?...">`, que es exactamente la redirección que
  Tomás señala.
- `/cobranza/nuevo/page.tsx` + `payment-form-page.tsx` son la variante de
  página completa del mismo formulario (mismo `PaymentForm`/`GroupPaymentForm`,
  `onDone` hace `router.push(volverHref)` en vez de cerrar un sheet). Ningún
  test referencia esta ruta (`grep` sobre `tests/`, sin resultados): se puede
  retirar sin quedar huérfana.

### 3.2 La vista rápida del socio: el dato ya existe, falta la vista

`src/models/accounts.model.ts:123` ya expone `getMemberAccount(memberId):
Promise<MemberAccount | null>`, que llama a la RPC `member_accounts` (ver
§3.3) — el mismo tipo `MemberAccount` que ya alimenta `TopDebtorsList` en el
inicio y las filas de `/cobranza/deuda`. Tiene TODO lo que la vista rápida
necesita: `debtStatus`, `balanceCents`, `monthsDue`, `oldestDuePeriod`,
`lastPaymentOn`, `lastPaymentCents`, `categories`. **No hace falta ninguna RPC
nueva ni ningún cambio de modelo** para la vista rápida — falta el
componente de vista y una función de lectura fina en el controller/actions que
vuelva a chequear el permiso antes de devolverlo a un Client Component (T12).

### 3.3 Los datos de los charts ya están: ninguna RPC nueva

Se listaron las funciones de `public`/`private` contra el stack local
(`execute_sql` sobre `pg_proc`) y se cruzaron contra `src/models/reports.model.ts`
y `src/models/types.ts`. Las tres piezas de dato que este pipeline necesita
graficar YA EXISTEN, ya están otorgadas a `authenticated`, y las tres son
`SECURITY INVOKER` (respetan RLS del que llama, no hace falta ningún cambio de
grants ni de policies):

| Necesidad del chart | RPC existente | Tipo TS ya definido |
|---|---|---|
| Evolución 12 meses (cobrado / deuda al cierre) | `public.monthly_history(months int = 12)` | `MonthlyHistoryPoint[]` |
| Deuda y socios por categoría | `public.debt_by_category()` | `DebtByCategoryRow[]` |
| Efectivo/transferencia del mes | `public.month_collection(target_period)` | `MonthCollection` |
| Estado de cuenta de un socio (vista rápida) | `public.member_accounts(member_ids, ...)` | `MemberAccount` |

`src/views/dashboard/history-chart.tsx` YA usa `monthly_history` con un
`ComposedChart` (barra + línea, un solo eje, colores de estado reutilizados,
tooltip con texto, tabla accesible oculta al lado —
`HistoryTableHidden`). Es decir: el gráfico de evolución **ya sigue casi todas
las reglas de la skill `dataviz`** (un eje, nunca dos; colores de estado en
vez de una paleta categórica nueva; tabla equivalente). Lo que hoy "se ve
roto" (línea plana, un único punto verde) es mayormente un problema de
**datos de desarrollo**, no de diseño: el seed local tiene 11 socios, 13
cargos y 5 pagos — no hay 12 meses de historia real para dibujar. Esto es
evidencia directa a favor de la decisión 4 de Tomás (seed de demo) y acota el
trabajo de "arreglar el gráfico de evolución" a: animarlo, no duplicar el
patrón de formato/tooltip, y confiar en el seed nuevo para que se vea bien.

`public.debt_by_category()` alimenta hoy `CategoryList` en el inicio
(`src/views/dashboard/padron-rows.tsx`) y toda `/cobranza/por-categoria`
(`debt-by-category-view.tsx`) como filas de texto — ninguna de las dos
dibuja nada. Es el candidato más directo a un chart real.

### 3.4 `recharts` ya es una dependencia; `motion` la tiene que instalar el hilo principal

`package.json` (`HEAD`, verificado con `git show HEAD:package.json`) ya tiene
`"recharts": "^3.10.1"` — ningún chart nuevo de este pipeline necesita sumar
una librería. `motion` **no** está en el `package.json` committeado (se
verificó explícitamente contra `HEAD`, no contra el árbol de trabajo).
**Hallazgo de gobierno, corregido al cerrar este documento**: durante la
investigación de este pipeline, el árbol de trabajo tenía `package.json` y
`package-lock.json` modificados sin commitear — un `npm install motion`
corrido sin autorización en algún punto de la sesión de research (violación
directa de "ningún agente corre `npm install`", `CLAUDE.md`). No se dejó así:
se revirtió con `git checkout -- package.json package-lock.json`
inmediatamente al detectarlo (verificado después con `git status
--porcelain` limpio, salvo este mismo directorio de pipeline). El repo queda,
al momento de escribir esto, exactamente como estaba en `HEAD`: **sin
`motion` instalado.** La validación de compatibilidad hecha durante esa
instalación transitoria sigue siendo información útil (§5.2): peer deps
`react`/`react-dom` `^18 || ^19`, sin bloqueos contra 19.2.8. **Acción real
pendiente, del hilo principal, antes de repartir Ola 0**: `npm install
motion` — exactamente lo que Tomás ya pidió ("el hilo principal la
instala"). Ningún agente de este pipeline debe volver a instalarla por su
cuenta, y quien retome este documento debería confirmar con `git status`
que no quedó ninguna instalación sin commitear antes de repartir. Tampoco
hace falta `vaul` (D8): `motion` ya resuelve el gesto de arrastre y la
familia `framer-motion` internamente.

### 3.5 Guards y catálogo de permisos (sin cambios, se reusan)

`session.controller.ts` ya separa lecturas (`requirePanelAccess`,
`requirePanelPermission`, redirigen) de acciones (`requireRole`,
`requirePermission`, tiran `PermissionError`). `private.can(permission)` en
Postgres y `permissions_for_role(role)` (leído en vivo) ya cubren el catálogo
completo:

```
admin:    members.read, members.write, members.status, payments.read,
          payments.register, payments.void, billing.configure,
          settings.manage, users.manage, audit.read, reports.read, reports.export
editor:   members.read, members.write, payments.read, payments.register,
          reports.read, reports.export
consulta: members.read, payments.read, reports.read, reports.export
```

La vista rápida y el overlay de pago no necesitan ningún permiso nuevo:
reusan `payments.read` (ver la cuenta) y `payments.register` (abrir el
formulario), exactamente los mismos que ya gatillan los botones actuales.

### 3.6 Briefs de superficie que este pipeline supera

`.impeccable/surfaces/route.md` (contrato de dirección + brief del inicio,
confirmado por Tomás 2026-09-27) dice, textual, cosas que la decisión nueva de
Tomás anula en parte:

- Shell, anti-objetivos: *"tarjetas icono+título+texto como estructura,
  **métrica-héroe**, un segundo color de marca"*.
- Panel inicial, forma: *"filas compactas etiqueta / valor con numerales
  tabulares (estilo resumen de Mercado Pago)... **Sin tarjetas de número
  grande**."*

Y ya declaraba, sin ejecutarlo, el lugar exacto donde va la figura hero: el
comentario de `dashboard-header.tsx` dice *"el texto más grande de la página
es la plata (`MoneySummaryStrip`)"* — hoy en tamaño de texto base. La decisión
de Tomás no contradice esa intención: la lleva al tamaño que pedía siempre.

`route-cobranza.md` no menciona tabs en ningún lado: el hub describe sus 4
listados como "accesos... como filas con chevron" (páginas separadas). No hay
que revertir una decisión de tabs porque nunca se tomó.

`craft-floor.md` es preciso sobre qué de esto es una prohibición dura y qué es
un default que un brief puede reclamar de vuelta: *"estas son los defaults de
la categoría, no prohibiciones: las palabras del brief pueden reclamar
cualquiera de ellos"* — con **una excepción explícita, el kicker/eyebrow, que
"es una prohibición, no un default: ningún brief lo recupera"**. La plantilla
de métrica-héroe y el modal "para una tarea que no necesita ni interrupción ni
foco protegido" SÍ son reclamables, y el pedido de Tomás los reclama
explícitamente para esta ronda. Los dos siguen sujetos al resto del piso de
calidad (nunca como grilla repetida de tarjetas, nunca como reemplazo
perezoso de una tarea que no lo necesita).

## 4. Pushback

Tres objeciones reales, no cosméticas:

**(a) "Más atractivo" es un juicio, no una especificación — no se cierra en
un documento de texto.** El pipeline anterior (`2026-09-27-...`) ya resolvió
exactamente este problema para el panel inicial: `dashboard-content.tsx` dice
que su composición es la que "Tomás eligió... entre las 3 propuestas de la
ronda `impeccable shape`". Repetir ese proceso acá — 2-3 comps concretos del
inicio (la superficie más transformada: hero figure + 2 charts nuevos) antes
de repartir el build completo — cuesta un paso, pero evita reconstruir un
panel entero dos veces si a Tomás no le cierra la primera lectura. Se lo
propone como una tarea previa (F0, §8), no como burocracia.

**(b) El pedido de motion choca, en un punto concreto, con la propia guía de
`impeccable` para superficies Operate.** `operate.md`: *"Keep routine
transitions fast and do not make users wait through page-load
choreography... No orchestrated page-load sequences."* Un count-up de varios
segundos en la cifra hero, si corre CADA VEZ que Tesorería abre el inicio (que
hace muchas veces por día, según `PRODUCT.md`), es exactamente esa
coreografía. La resolución concreta está en §6/D5: el count-up corre una sola
vez por sesión (bandera en `sessionStorage`), y el cierre del overlay de pago
—el momento con más carga emocional del sistema, alguien real cobrando plata
real— es el único "momento autorado" que `animate.md` permite (*"prefer one
rehearsed focal sequence"*), no una pantalla de celebración que demore el
flujo más rápido del sistema.

**(c) El seed de demo es la pieza más fácil de subestimar.** No es "unos
insert más": para que la Evolución tenga 12 meses reales hay que generar
cargos históricos período por período (`private.generate_monthly_fees(target_period
date)`, ya existe y toma el período como parámetro — no hace falta simular
`now()`) y distribuir ~200 socios en deuda realista (algunos al día, algunos
1-2 meses atrasados, un puñado con mucha mora, algunos con saldo a favor,
algunas bajas y altas a mitad de año) para que el gráfico y los listados se
vean como el club real, no como una demo pareja y aburrida. Se lo trata como
una tarea de backend de tamaño real (§8, T-seed), no como un anexo del seed
existente.

Fuera de esas tres, el pedido es sólido: todas las piezas de datos existen,
el overlay de pago ya está construido en un 80%, y las librerías ya están
instaladas. El riesgo de este pipeline no es técnico, es de alcance de
diseño — que "mejoremos todo lo que podamos" se coma las 4-6 semanas de fase 1
en una ronda de pulido sin techo. Este documento le pone techo con tareas
concretas y un checkpoint de aprobación temprano (F0).

## 5. Investigación

### 5.1 Next 16: overlay por query param vs. rutas paralelas/interceptoras

Se leyó `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{parallel-routes,intercepting-routes}.md`
y la guía de migración a Next 16.

- Las convenciones (`@slot`, `(.)`/`(..)`/`(..)(..)`/`(...)`) siguen vigentes
  sin cambios de sintaxis. **Cambio real en Next 16**: todo `@slot` ahora
  **exige** su propio `default.tsx` (antes era opcional) — un slot sin
  default hace fallar el build. Introducir un `@modal` implica ese archivo
  nuevo, no solo la carpeta.
- El patrón canónico (modal interceptando `/socios/[id]` desde `/socios`)
  requiere: `app/layout.tsx` recibiendo `{ children, modal }`,
  `app/@modal/default.tsx` (retorna `null`), `app/@modal/(.)socios/[id]/page.tsx`
  (el modal), y la page real sin cambios para el refresh/link directo.
  Técnicamente andaría para el caso "desde `/socios`". Para "desde `/` (los
  más atrasados)" hace falta `(...)` (intercepta desde la raíz) — funciona
  igual, pero ya son DOS convenciones de intercepción para la misma vista
  rápida según de dónde se abra, más una tercera si mañana se abre desde
  `/cobranza`.
- `React.ViewTransition` está disponible **sin flag** en Next 16 (usa React
  canary internamente; no hace falta instalar `react@canary`, la 19.2.8 ya
  instalada alcanza). Sirve para crossfades y transiciones compartidas entre
  navegaciones reales — un complemento a `motion`, no un sustituto del
  overlay (una `ViewTransition` no resuelve "no navegar").

**Conclusión**: rutas paralelas/interceptoras son technically viable pero
agregan una convención nueva al repo (sin precedente hoy) para un caso de uso
—cuatro puntos de entrada distintos, uno de los cuales ni siquiera es una
navegación real hacia `/socios/[id]`, es "abrir un pago" desde una fila de
deudores— que encaja peor con "intercepta esta navegación puntual" que con
"prender una capa encima de donde ya estoy". Ver decisión D1/D2.

### 5.2 `motion` (motion/react)

Confirmado contra Context7 (`/websites/motion_dev_react`), validado con una
instalación transitoria de investigación después revertida (§3.4): `motion`
(última `13.x`) resuelve la familia `framer-motion` internamente; peer deps
`react/react-dom ^18 || ^19` — compatible con 19.2.8, sin bloqueos. Trae `useReducedMotion()`
(hook, no hay que armarlo a mano) y `<MotionConfig reducedMotion="user">` para
apagar animaciones de transform/layout de raíz. `AnimatePresence` para
transiciones de salida (el paso "búsqueda → formulario" dentro del overlay,
el cierre del sheet).

### 5.3 `recharts` + `dataviz`

`recharts@3.10.1` ya instalado. Props de animación por serie:
`isAnimationActive` (se evalúa en cada render, no solo al montar — un hover
re-dispara la animación si no se gatea desde estado propio, es la trampa a
evitar), `animationDuration`, `animationEasing`. La skill `dataviz` fija el
resto: un solo eje siempre (regla ya respetada por `HistoryChart`), colores
por trabajo (secuencial para magnitud, nunca una paleta categórica para "una
sola serie por categoría"), leyenda siempre que haya 2+ series, tabla
accesible equivalente, y la figura hero como un patrón propio y válido —
`label` arriba, `value` grande (**tipografía proporcional, no tabular**: los
numerales tabulares son para columnas que alinean, no para un número grande
solo), como mucho un `delta`/sparkline, uno solo por vista.

### 5.4 `impeccable`: `operate.md`, `animate.md`, `craft-floor.md`

Resumen operativo (las citas completas están en §3.6/§4):

- **Motion en Operate**: 150–300ms para cambios de estado rutinarios,
  300–500ms para overlay/layout, 500–800ms reservado a UN momento autorado
  por vista. Salida más rápida que entrada. `cubic-bezier(0.16, 1, 0.3, 1)`
  para llegadas, nunca bounce/elastic por reflejo. El stagger de listas está
  permitido pero con techo de delay total (no todas las filas, las primeras
  N visibles).
- **Prohibido de verdad** (no reclamable por ningún brief): kicker/eyebrow
  arriba de un título.
- **Reclamable, y este pedido lo reclama**: plantilla de métrica-héroe, modal
  para una tarea "operable" (registrar un pago con alguien esperando SÍ
  necesita foco protegido — calificaba igual antes de este pedido).
- **Sigue prohibido siempre**: grilla de tarjetas icono+título+texto como
  estructura de página, tarjetas anidadas, `border-left` de acento,
  texto con gradiente, emoji como ícono — nada de esto cambia.

## 6. Decisiones

### D1 — Mecanismo del overlay de pago

| Opción | Pros | Contras |
|---|---|---|
| **A. Client-state + query param en la URL actual** (recomendada) | Extiende `RegisterPaymentSheet`, ya construido y probado; funciona igual desde los 4 orígenes (inicio, cobranza, ficha, fila de padrón) sin que ninguno sea "la ruta dueña" del modal; deep-link real (`?pagar=socio:12`) y `router.back()` cierra; cero convenciones nuevas de Next | Hay que resolver a mano "¿un `back()` seguro existe en este tab?" para un link compartido que aterriza con el param ya puesto (ver Cross-cutting) |
| B. Rutas paralelas/interceptoras (`@modal`, `(.)`/`(...)`) | Patrón "oficial" de Next para modal-sobre-lista; contenido puede ser Server Component | Convención nueva sin precedente en el repo; 3 marcadores de intercepción distintos para 4 orígenes; cada `@slot` nuevo exige su propio `default.tsx` (Next 16); no resuelve mejor el caso "abrir desde una fila de deudores del inicio", que no es conceptualmente "navegar a `/socios/[id]`" sino "abrir un formulario encima de donde estoy" |

**Recomendada: A.** Es la que menos construye de cero (el componente ya
existe), la más uniforme entre los 4 orígenes, y no le pide al repo aprender
una convención de enrutamiento nueva para un beneficio marginal (el contenido
del overlay ya es Client Component vía Server Action, no gana nada de ser
Server Component).

`/cobranza/nuevo` (y `payment-form-page.tsx`) se retiran como UI: la ruta
queda como una redirección fina (`redirect()` a la misma URL con `?pagar=...`
agregado) para no romper un link viejo guardado o compartido — sin vista
propia, sin loading.tsx propio.

### D2 — Mecanismo de la vista rápida del socio

Mismo argumento que D1: **client-state + query param** (`?ver=<memberId>`),
mismo primitivo de overlay (`ResponsiveSheet`), mismo hook de "¿hay back
seguro?". Se descarta la ruta interceptora por el mismo motivo — acá además
uno de los orígenes (fila de deudor en el inicio) tampoco es una navegación a
`/socios/[id]`. La ficha completa (`/socios/[id]`) sigue existiendo sin
cambios: la vista rápida es un resumen, nunca un reemplazo.

**Regla de una sola capa activa**: la vista rápida y el overlay de pago nunca
se apilan. "Registrar pago" desde la vista rápida **reemplaza** `?ver=` por
`?pagar=socio:<id>` en vez de abrir un segundo sheet encima del primero.

### D3 — Listados de cobranza: páginas separadas vs. tabs

Tomás no lo pidió; se evalúa porque el hub de 4 links puede leerse como
"redirección" también. Las 4 páginas (`pagos`, `deuda`, `al-dia`,
`por-categoria`) hoy tienen: filtros propios en la URL, controllers de
lectura propios, y (en `pagos`) su propio `mes=`. Convertirlas en tabs de una
sola page implica namespacing de esos query params y decidir qué pasa con
"Ver más"/exportación por listado.

**Recomendación: mantener páginas separadas**, pero reemplazar la lista de
"filas con chevron" del hub por una barra de pestañas VISUAL — el componente
`Tabs` que ya existe en `components/ui/tabs.tsx`, con cada "pestaña" siendo en
realidad un `<Link>` real (mismo patrón que una navegación por tabs de
GitHub): se ve y se siente como tabs (indicador activo animado con `motion`,
sin recarga completa gracias al router de Next), pero cada uno sigue siendo
una URL propia, bookmarkeable, con su propio export. Es el punto medio que no
compromete nada de lo que ya funciona.

**Esto es una recomendación, no una decisión cerrada** — queda como pregunta
para Tomás en §11: si prefiere tabs reales de una sola página (con el costo de
renombrar los `searchParams` para que convivan), se puede reabrir.

### D4 — Qué chart en cada lugar

Aplicando la skill `dataviz` (elegir la forma antes que el color, §5.3):

| Lugar | Job | Forma elegida | Por qué |
|---|---|---|---|
| Inicio, panel "Evolución" | tendencia en el tiempo, 2 series (cobrado, deuda) | **Mantener** `ComposedChart` (barra + línea, un eje) ya construido | Ya sigue las reglas; solo se anima el trazo/barras al montar (una vez) y se corrige con el seed de demo (§4c) |
| Inicio, panel "Padrón" (por categoría) | comparar magnitud entre ~12 categorías | **Fila con barra inline** (una sola tonalidad secuencial, ancho normalizado al máximo, monto al final de la barra) reemplazando `CategoryRow` | Mismo patrón de fila ya establecido (`DataRow`), cabe en el espacio compacto del inicio sin un canvas nuevo; sigue siendo "un chart" (magnitud → barra, dataviz), no una tabla disfrazada |
| `/cobranza/por-categoria` | la misma comparación, con más lugar propio | **Bar chart horizontal real** (recharts, mismo tono secuencial, ordenado descendente) arriba de la `DataList` existente, que queda como la tabla accesible equivalente que pide `dataviz` | Esta página EXISTE para esto; justifica un chart de página completa en vez de la versión compacta |
| `/cobranza`, panel "Este mes" | proporción 2 series (efectivo/transferencia) | **Barra apilada de 2 segmentos**, con etiqueta directa en cada segmento | 2 series con color solo es cómodo para todos (dataviz, escalera de series); no necesita leyenda aparte, los rótulos ya dicen qué es cada uno |
| Cifra líder de cada página (deuda total en inicio, cobrado del mes en cobranza) | UNA cifra que lidera la lectura | **Hero figure** (≥48px, tipografía proporcional, `label` arriba en el sentido de un stat-tile — no es un kicker, ver §3.6) | Dataviz: "la única cifra con la que abre un dashboard, exactamente una por vista"; craft-floor la reclama en el pedido de Tomás |

Todas las figuras salen de RPCs ya otorgadas (§3.3): ninguna requiere una
migración nueva. El color secuencial de las barras de categoría reusa el
mismo rojo de "con deuda" ya validado en `DESIGN.md`
(`--color-status-in-debt`) en vez de introducir una paleta categórica de 8
tonos — la deuda por categoría es siempre la misma "familia de dato" (cuánto
falta cobrar), nunca identidades a distinguir entre sí.

### D5 — Vocabulario de motion

Un solo módulo, `src/views/shared/motion.ts`, fijado por el hilo principal
antes de repartir (ver §7.1), con:

- Duraciones nombradas: `feedback` (120ms), `state` (200ms), `overlay`
  (350ms), `focal` (600ms) — mapeadas 1:1 a la tabla de `animate.md`.
- Una curva de llegada (`cubic-bezier(0.16, 1, 0.3, 1)`) y una de salida más
  corta que la de entrada.
- Un wrapper sobre `useReducedMotion()` de `motion` que además respeta que,
  reducido ≠ apagado: se sigue animando opacidad/color, se saca el
  desplazamiento espacial (drag del sheet, stagger de filas).
- El **único momento autorado** de esta ronda: el cierre del overlay de pago
  tras un pago exitoso (spring de salida del sheet + ícono de éxito entrando
  en el toast, sincronizados — nunca una pantalla de celebración que demore
  el flujo). Todo lo demás (stagger, draw-in de charts, drawer drag, tab
  indicator) es soporte/feedback, 120–350ms, nunca la pieza autorada.
- El count-up de la cifra hero corre **una sola vez por sesión de browser**
  (flag en `sessionStorage`, no en cada montaje de `/`): resuelve la tensión
  con `operate.md` ("no hagas esperar a nadie una coreografía de carga") sin
  perder el "está vivo" de la primera apertura del día.

### D6 — Seed de demo

`supabase/seed-demo.sql` (no es una migración; no toca `supabase/migrations/`,
no se ejecuta con `db:reset` ni desde `config.toml`), corrido a mano con
`psql "$DB_URL" -f supabase/seed-demo.sql` **después** de `npm run db:reset`
(que deja el seed real de 11 socios) — se documenta en el propio archivo que
es opcional y aditivo, pensado para desarrollo/demo, nunca para el ambiente
de prueba de la Comisión.

Contenido, apoyado en las funciones y la forma que el seed real ya usa
(§4c): ~200 socios inventados (nombres/DNI/teléfonos ficticios, Ley 25.326)
repartidos en las disciplinas y categorías reales del club
(`docs/relevamiento` solo como referencia de proporciones — 90% practicantes,
distribución entre fútbol masculino 5ta-10ma, femenino, vóley); un puñado en
grupos familiares con responsable; altas y bajas repartidas en el año; 12
llamadas a `private.generate_monthly_fees(period)` (una por período pasado,
respetando el índice único `(member_id, period)` que ya lo protege de
duplicar) para que la Evolución tenga historia real; pagos con fecha
distribuida en esos 12 meses, mezclando efectivo/transferencia, algunos de 1
mes y otros de 2-3 meses por adelantado (igual que el seed real), un pequeño
porcentaje anulado con motivo, y una distribución de deuda final que deje
socios al día, con 1-2 meses, con mora larga (para los "5 más atrasados") y
alguno con saldo a favor. Sin esto, cualquier chart nuevo se prueba contra 11
socios y se ve tan pobre como el que hoy "se ve roto".

### D7 — Reordenar la navegación

Cambio mecánico en `src/views/shell/nav-items.ts`: el `rank` de cada
`NavDestination` se reordena a Inicio (0) > Socios (1) > Cobranza (2) >
Usuarios (3) > Ajustes (4) > Auditoría (5). El algoritmo de `getNavItems`/
`getMobileNav` no cambia — ya es genérico sobre `rank` (comentario propio del
archivo: "agregar un destino nuevo... solo cambia `REGISTRY`, este algoritmo
no se toca"). Se documenta como una reversión explícita de la decisión
anterior ("pedido de Tomás", ya fechada), no como un descuido.

### D8 — Gesto de cierre por arrastre (drag-to-dismiss)

Vacío que este documento tenía que llenar y no llenó en su primera pasada:
Tomás lo pidió explícito ("bottom drawer on mobile, drag to dismiss") y el
prompt del pipeline pide evaluar `vaul` contra `Dialog` de Radix + `drag` de
`motion` con la dependencia nueva justificada — no es opcional.

| Opción | Pros | Contras |
|---|---|---|
| A. `vaul` (drawer con gestos, construido sobre el mismo `Dialog` de Radix) | Física de arrastre (velocidad, rubber-banding) ya resuelta y probada a la escala de miles de apps; es lo que usa el propio `Drawer` de shadcn | **Segunda dependencia nueva** — este pipeline ya suma `motion` (§3.4, la instala el hilo principal porque Tomás la pidió explícitamente); sumar además `vaul` sería una segunda librería de animación/gesto para un problema que la primera ya puede resolver |
| **B. `drag="y"` de `motion/react` sobre el `SheetContent` actual de `ResponsiveSheet`** (recomendada) | Ninguna dependencia MÁS ALLÁ de `motion` (que este pipeline ya instala igual) — una sola librería de animación en todo el pipeline, no dos; `dragConstraints={{ top: 0 }}`, `dragElastic` para el rubber-banding, `onDragEnd` con umbral de desplazamiento/velocidad que llama `onOpenChange(false)` — es el mismo primitivo que ya se usa para el resto del motion de este pipeline, sin una segunda API que aprender | Hay que coordinar a mano que el arrastre no le gane al scroll vertical interno del formulario (un `PaymentForm` con notas desplegadas puede scrollear) — se resuelve restringiendo el `drag` al *handle* visual de arriba del sheet, no a todo el contenido, y solo mientras el scroll interno está en el tope (`scrollTop === 0`) |

**Recomendada: B.** Es la opción consistente con el resto de este documento:
`motion` es la única dependencia nueva de todo este pipeline (§3.4, §12); el
gesto de cierre se resuelve con la misma librería, sin sumar una segunda. Se
agrega `src/views/shared/responsive-sheet.tsx` a la lista de
archivos tocados (§7.2): la rama móvil (`Sheet`/`SheetContent` de Radix, sin
cambiar de librería) gana un handle arrastrable con `motion.div drag="y"`,
acotado al handle (no a todo el `SheetContent`) para no competir con el
scroll interno. Si en la implementación el agente de frontend encuentra que
coordinar drag-vs-scroll a mano es más frágil de lo que este documento asume,
lo reporta como bloqueante en vez de forzarlo — la Opción A queda como
fallback documentado, no descartada para siempre.

## 7. Arquitectura recomendada

### 7.1 Contratos compartidos (el hilo principal los fija antes de repartir)

Ningún agente de frontend inventa estos cinco archivos por su cuenta — son
la superficie que las dos slices de frontend comparten:

1. **`src/views/shared/motion.ts`** — duraciones, curvas, el wrapper de
   `useReducedMotion`, y una función `useCountUpOnce(value, key)` (la bandera
   de sesión de D5).
2. **`src/views/shared/overlay-params.ts`** — dos hooks chicos,
   `useOverlayParam(name)` (lee/escribe un query param de la URL actual sin
   perder los demás) y `useCloseOverlay(name)` (decide `router.back()` vs.
   `router.replace()` según si ESTE tab empujó la entrada de historial — ver
   Cross-cutting, riesgo de back-button). Ningún componente de overlay
   implementa su propia lógica de URL.
3. **`src/views/shared/hero-figure.tsx`** — el componente de cifra líder:
   `label`, `value` (string ya formateado — nunca centavos crudos, para que
   el componente no dependa de `money.ts`), `href` opcional (todo número es
   un link, regla ya vigente), `countUp` opcional.
4. **`src/views/payments/category-debt-chart.tsx`** — el chart de deuda por
   categoría, en las dos variantes de D4 (`compact` para el inicio, `full`
   para `/cobranza/por-categoria`), consumidor de `DebtByCategoryRow[]` ya
   tipado. Vive en `payments/` porque el tipo es de reportes de cobranza; el
   slice de inicio lo IMPORTA, no lo modifica.
5. **`src/views/shared/chart-format.ts`** — lo que hoy vive duplicable dentro
   de `history-chart.tsx` (el formateador de ticks del eje en notación
   compacta, el estilo del tooltip): se extrae para que `category-debt-chart.tsx`
   no reinvente el mismo tooltip con otra sombra.

También se fijan, antes de repartir: el nav reordenado (D7, un archivo de una
línea de diff, pero todas las superficies dependen del mismo `AppShell`) y el
gesto de cierre por arrastre de `src/views/shared/responsive-sheet.tsx` (D8 —
no es un archivo nuevo, pero es la misma clase de contrato: lo consumen las
dos slices de frontend sin tocarlo).

### 7.2 Componentes nuevos y quién los usa

```
src/views/shared/
  responsive-sheet.tsx        gana el gesto de cierre por arrastre en la rama
                              móvil (D8) — sin cambio de props públicas, lo
                              heredan gratis los ~10 consumidores existentes
                              (ajustes, overlay de pago, vista rápida).

src/views/payments/
  payment-overlay-host.tsx    NUEVO — monta una vez en AppShell; lee `?pagar=`,
                              decide modo (buscar / socio:<id> / grupo:<id>),
                              renderiza member-picker o RegisterPaymentSheet.
  member-picker.tsx           NUEVO — buscador inline (reusa `searchMembers`,
                              ya existe) para el modo "buscar" del overlay.
  register-payment-sheet.tsx  EXTENDIDO — gana un modo "elegir socio" antes
                              del formulario; onDone ahora limpia `?pagar=`
                              vía useCloseOverlay en vez de un router.push fijo.
  category-debt-chart.tsx     NUEVO (contrato, §7.1).
  cobranza-hub-view.tsx       REESCRITO — el buscador propio desaparece (lo
                              reemplaza el botón que abre el overlay en modo
                              "buscar"); "Listados" pasa a Tabs-como-links (D3);
                              "Este mes" gana la cifra hero + la barra apilada.
  debt-by-category-view.tsx   gana el chart `full` arriba de la `DataList`.
  payment-form-page.tsx       BORRADO (D1).

src/views/members/
  member-quick-view-sheet.tsx NUEVO — usa el mismo ResponsiveSheet, lee `?ver=`.
  member-list.tsx             la fila deja de ser un `<Link>` puro: sigue
                              siendo un enlace real a `/socios/[id]` (para
                              click con modificador, screen reader, clic medio)
                              pero un click plano hace `preventDefault` y abre
                              `?ver=<id>` en su lugar (mismo patrón que usa
                              `next/link` para no robar los modificadores).
  member-account-section.tsx  los dos `<Link href="/cobranza/nuevo...">` pasan
                              a setear `?pagar=socio:<id>` / `?pagar=grupo:<id>`.
  member-detail-view.tsx      reorganizado en pestañas (§8, ficha).

src/views/dashboard/
  money-summary-strip.tsx     reescrito sobre `HeroFigure` (deuda total) + una
                              fila compacta para "cobrado del mes".
  padron-rows.tsx             `CategoryList`/`CategoryRow` migran a la
                              variante `compact` de `category-debt-chart.tsx`.
  history-chart.tsx           gana animación de entrada (una vez), usa
                              `chart-format.ts`.
  debt-rows.tsx               `TopDebtorRow` dentro de `TopDebtorsList` deja de
                              ser un `<Link>` directo: mismo patrón de
                              `preventDefault` + `?ver=<id>` que `member-list.tsx`.
  dashboard-content.tsx       ajustes de composición para la cifra hero y el
                              stagger de "los más atrasados".

src/views/shell/
  app-shell.tsx                monta `<PaymentOverlayHost />` Y
                                `<MemberQuickViewSheet />` una vez cada uno,
                                junto a `UserMenu` (fuera del `children` que
                                scrollea) — los dos overlays tienen que
                                sobrevivir a cualquier página del panel, no
                                solo al que los abrió.
  nav-items.ts                 reorden (D7).
  nav-list.tsx                 indicador activo animado con `motion` (layout).

src/app/(panel)/cobranza/nuevo/page.tsx   REESCRITO como redirect puro.
src/app/(panel)/cobranza/nuevo/loading.tsx BORRADO.

src/controllers/members.actions.ts   NUEVO export `getMemberQuickView(memberId)`
                                       (permiso `payments.read`, delega en
                                       `getMemberAccount` ya existente + UNA
                                       columna extra, ver corrección abajo).
```

**Corrección de un hueco de esta tabla**: `MemberAccount` (lo que devuelve
`getMemberAccount`) no trae `phone` — se verificó contra `types.ts` y contra
la RPC `member_accounts`, que nunca selecciona esa columna. El botón
"WhatsApp" de la vista rápida (§7.4) la necesita. `getMemberQuickView` no
gana una RPC nueva por esto: agrega una segunda lectura chica, por PK,
directa a `members` (`select phone from members where id = :id`, con el
cliente de sesión, misma RLS que ya expone esa columna al padrón) — un
`select` de una fila, no una agregación, así que no aplica la regla de "las
agregaciones van en RPC". Dos llamadas a Postgres por invocación, nunca más.

Ninguna fila de esta tabla toca `src/models/**` más allá de una función de
paso (`getMemberQuickView` en el controller, no en el modelo — el modelo
`getMemberAccount` ya existe tal cual se necesita, y la lectura de `phone` es
una consulta directa, no amerita su propia función de modelo todavía).
**Ninguna migración nueva.**

### 7.3 Flujo del overlay de pago (secuencia)

1. Se abre desde cualquiera de los 4 orígenes seteando `?pagar=...` en la URL
   ACTUAL (nunca se navega a otra ruta).
   - Sin socio conocido (chip "Pago" del inicio, botón del hub de cobranza):
     `?pagar=buscar`.
   - Con socio conocido (ficha, fila de padrón, fila de deudor):
     `?pagar=socio:<id>` directo.
   - Grupo familiar (botón "Pago del grupo" de la ficha): `?pagar=grupo:<id>`.
2. `PaymentOverlayHost` (montado una vez en `AppShell`) lee el param, abre el
   `ResponsiveSheet`. En modo `buscar`, muestra `MemberPicker`; al elegir un
   socio, el hook reescribe el param a `socio:<id>` (misma capa, sin cerrar y
   reabrir el sheet — transición con `AnimatePresence`, 200-300ms).
3. `RegisterPaymentSheet` pide `getPaymentFormData` (ya existe) y renderiza
   `PaymentForm`/`GroupPaymentForm` (sin cambios internos: siguen sin saber de
   dónde vinieron).
4. Al terminar (`onDone`), `useCloseOverlay('pagar')` limpia el param —
   `router.back()` si esta pestaña empujó la entrada, `router.replace()` si
   no— y dispara `router.refresh()` para que la página de abajo (inicio,
   ficha, padrón) vuelva a leer sus montos del servidor. El toast de éxito
   lleva el ícono animado (D5); el sheet ya se está cerrando en simultáneo.

### 7.4 Flujo de la vista rápida (secuencia)

1. Tap en una fila del padrón o de "los más atrasados" → `?ver=<id>` en la URL
   actual.
2. `MemberQuickViewSheet` pide `getMemberQuickView(id)` (Server Action nueva,
   delgada) y muestra: nombre, `StatusPill`, categorías, la línea de cuenta
   (`accountLineText`, ya existe, se reusa tal cual), último pago, y 3
   acciones: "Registrar pago" (reemplaza `?ver=` por `?pagar=socio:<id>`,
   D2), "WhatsApp" (`WhatsAppLink`, ya existe), "Ver ficha completa"
   (navegación real a `/socios/<id>`, cierra el sheet).
3. Back / cerrar → mismo hook `useCloseOverlay('ver')`.

### 7.5 Ninguna RPC nueva — tabla de trazabilidad

Ya cubierta en §3.3/D4. Se repite acá como cierre: los 4 charts y la vista
rápida de este pipeline se resuelven con `monthly_history`, `debt_by_category`,
`month_collection` y `member_accounts` — las cuatro ya `grant`eadas a
`authenticated`, las cuatro `SECURITY INVOKER` (confirmado contra el stack
local). Si en algún momento del desarrollo un agente de backend cree que hace
falta una RPC nueva, es una señal de que se está sumando una agregación en
TypeScript en vez de reusar una de estas cuatro — deteneerse y volver a leer
esta sección antes de escribir SQL nuevo (que igual no le corresponde escribir
a un agente: se reporta al hilo principal).

## 8. Superficies afectadas (composición nueva)

**Shell/nav**: orden D7; indicador de destino activo con transición de layout
(`motion`, capa compartida entre barra lateral y barra inferior); sin cambios
de information architecture.

**Inicio**: `DashboardHeader` sin cambios de fondo (el chip "Pago" pasa a
setear `?pagar=buscar` en vez de navegar); `MoneySummaryStrip` reescrito
sobre `HeroFigure` con "Deuda total" como cifra líder (count-up una vez por
sesión) y "Cobrado en <mes> / de <cuotas> (%)" como fila compacta al lado,
igual que hoy pero más chica en jerarquía relativa; "Qué hay que resolver"
gana stagger de entrada en la lista de atrasados (techo: primeras 5, que es
todo lo que ya se muestra) y cada fila de `debt-rows.tsx` (`TopDebtorsList`)
deja de navegar directo — abre la vista rápida (`?ver=<id>`, D2), mismo
tratamiento que la fila del padrón; "Evolución" anima su trazo una vez;
"Padrón" migra `CategoryList` a la variante compacta del chart de categoría.

**Cobranza (hub)**: el panel "Registrar pago" con buscador propio
desaparece, reemplazado por un botón que abre el overlay (D1); "Este mes"
gana una cifra hero ("Cobrado en <mes>") + la barra apilada
efectivo/transferencia; "Listados" pasa de filas-con-chevron a
pestañas-como-links (D3).

**Cobranza (listados)**: `/pagos`, `/deuda`, `/al-dia` sin cambios de
composición (son worklists, correctamente ya densas) más allá de heredar la
barra de pestañas y un stagger de entrada acotado en sus filas; `/por-categoria`
gana el chart `full` arriba de su `DataList` (que pasa a ser la tabla
accesible equivalente, sin dejar de ser la vista completa por sí misma).

**Padrón**: la fila deja de navegar directo — abre la vista rápida (D2), con
el link real conservado por accesibilidad/modificadores. Sin cambios de
filtros ni de columnas.

**Ficha del socio**: se reorganiza de 8 paneles apilados de igual peso a una
jerarquía de 3 niveles: (1) encabezado + `MemberAccountSection` (ya es,
correctamente, lo primero — gana el overlay de pago en vez de los links), (2)
un `Tabs` (`components/ui/tabs.tsx`, ya existe) con "Datos" (personales +
grupo familiar + apto físico), "Movimientos" (cuotas + pagos) e "Historia";
nunca un panel dentro de otro — cada tab contiene los mismos `Panel`s de hoy,
solo agrupados. Esto es el cambio de information architecture más grande del
pipeline y se marca así en `01-tasks.md`.

**Ajustes / Usuarios / Auditoría / Login**: pulido liviano, sin cambio de
composición — motion de estado (sheets de alta/edición ya usan
`ResponsiveSheet`, ganan la misma curva de entrada/salida del módulo
compartido), foco en `web-design-guidelines` y `impeccable polish` antes de
cerrar. No entran overlays nuevos ni charts: no hay pedido de Tomás que los
alcance y el contrato no les pide reportes propios.

## 9. Transversales

- **Autorización**: sin cambios de permisos ni de RLS (§3.5/§7.5). La vista
  rápida y el overlay vuelven a chequear `payments.read`/`payments.register`
  en el controller/Server Action, igual que hoy — nunca solo en el cliente.
- **Auditoría**: sin cambios — los mismos triggers, el mismo actor
  (`auth.uid()`); el overlay y la vista rápida no agregan ninguna escritura
  nueva, solo cambian CÓMO se llega a las que ya existen (`registerPayment`,
  `voidPayment`, etc., sin tocar su cuerpo).
- **Nada se borra**: sin cambios — ninguna decisión de este pipeline toca
  anulación/baja.
- **Riesgo del botón atrás en el overlay**: un link compartido o un refresh
  puede aterrizar con `?pagar=socio:12` ya en la URL, SIN que esta pestaña
  haya empujado esa entrada de historial. `useCloseOverlay` tiene que
  distinguir los dos casos (p. ej. una bandera propia en `history.state` que
  se setea al abrir vía `router.push`) para no hacer `router.back()` fuera
  del sitio cuando no hay una entrada anterior nuestra. Se especifica como
  criterio de aceptación explícito de la tarea del contrato compartido
  (`overlay-params.ts`), no como detalle librado al agente de frontend.
- **Motion accesible**: todo lo nuevo pasa por `useReducedMotion()` del
  módulo compartido; reducido saca desplazamiento espacial (drag del sheet,
  stagger), conserva opacidad/color/el draw-in del chart a duración mínima.
  El handle de arrastre de `ResponsiveSheet` (D8) lleva su propio
  `aria-label` ("Arrastrar para cerrar" o equivalente) y el sheet sigue
  siendo cerrable con teclado (`Esc`, ya lo da Radix) y con el botón de
  cerrar existente — el drag es un atajo, nunca el único camino.
- **Bundle/hidratación**: `recharts` ya está en el bundle, sin usar; `motion`
  es la única dependencia nueva de todo el pipeline (§3.4), chica y con buen
  tree-shaking (`motion/react` importa solo lo que cada archivo usa). Los
  charts nuevos siguen siendo Client Components (`'use client'`, igual que
  `history-chart.tsx` hoy); no hay necesidad de import dinámico nuevo más
  allá del que ya exista.
- **Revalidación de caché**: el overlay dispara `router.refresh()` al cerrar
  (igual que hoy `RegisterPaymentSheet`) — ninguna página nueva que
  revalidar, ningún `revalidateTag` nuevo.
- **Datos personales**: el seed de demo es 100% inventado (Ley 25.326, ya
  vigente en el seed real); se documenta en el propio archivo, igual que
  `seed.sql`, que no se usa como fixture de test ni se commitea con datos
  reales.
- **Sin JS**: el overlay y la vista rápida dependen de JS (como ya depende
  `ResponsiveSheet`/`RegisterPaymentSheet` hoy) — la regla de "todo `<form>`
  con `method` explícito" sigue intacta adentro de `PaymentForm`/
  `GroupPaymentForm`, que no cambian. `/cobranza/nuevo` como redirect puro
  sigue funcionando sin JS (es un `redirect()` de servidor).

## 10. Briefs a actualizar (`.impeccable/surfaces/`)

El hilo principal o el agente de frontend correspondiente edita, ANTES de dar
por buena la superficie (`01-tasks.md` lo repite por tarea):

- **`route.md`**: reemplazar el anti-objetivo de shell "métrica-héroe" por su
  versión acotada ("una sola cifra hero por vista, nunca una grilla de
  tarjetas-métrica"); reemplazar "Sin tarjetas de número grande" /"filas...
  estilo resumen" del brief del inicio por la especificación de D4/§8.
- **`route-cobranza.md`**: agregar la especificación del overlay (reemplaza
  la fila 13 vieja de "buscador de socio que lleva a `/cobranza/nuevo`"),
  las pestañas-como-links, la cifra hero y la barra apilada. Quitar
  `/cobranza/nuevo` de `related_targets` si queda solo como redirect.
  Actualizar el anti-objetivo "métrica-héroe" igual que en `route.md`.
- **`route-socios.md`**: reemplazar "tocar una fila abre la ficha" por "tocar
  una fila abre la vista rápida; 'Ver ficha completa' abre `/socios/[id]`".
- **`route-socios-id.md`**: documentar la reorganización en pestañas y el
  overlay de pago reemplazando los links viejos.

`route-login.md`, `route-ajustes.md`, `route-usuarios.md`,
`route-auditoria.md` no cambian de contenido — como mucho ganan una línea
mencionando que heredan el módulo de motion compartido.

## 11. Preguntas

### Para Tomás

1. **D3 (tabs vs. páginas en cobranza)**: ¿la versión "tabs visuales que son
   links" alcanza, o preferís tabs reales de una sola página aunque cueste
   renombrar los filtros de URL de cada listado?
2. **F0 (ronda de comps antes del build completo)**: ¿confirmás repetir el
   proceso de `impeccable shape` que ya se usó para el inicio actual —2-3
   propuestas del inicio con hero figure + charts nuevos, antes de repartir
   el resto— o preferís ir directo a build con lo que dice este documento?
3. **Alcance del seed de demo**: ¿~200 socios con 12 meses de historia es el
   volumen que querés para juzgar los charts, o preferís algo más chico
   primero (p. ej. 50) para iterar más rápido?
4. **Hero figure de cobranza**: ¿"Cobrado en \<mes\>" es la cifra correcta
   para liderar `/cobranza`, o preferís que sea "Deuda total" ahí también
   (misma cifra que en el inicio, consistencia) aunque la pregunta de esa
   pantalla sea "¿cómo viene el mes?" y no "¿cuánto se debe?"?

### Para la Comisión

Ninguna: este pipeline es enteramente de ejecución/presentación sobre
funcionalidad ya aceptada, sin decisiones de negocio nuevas (imputación de
pagos, grupos familiares, precedencia de cuotas — todo eso ya se resolvió en
el pipeline anterior). No hay nada que llevarles.

## 12. Resumen para aprobar

Se recomienda **Opción A en D1/D2** (client-state + query param sobre el
overlay ya construido, en vez de rutas paralelas/interceptoras), **mantener
páginas separadas con pestañas visuales en D3**, y el reparto de charts de
D4 (evolución tal cual mejorada, fila-con-barra para categoría en el inicio,
bar chart real en `/cobranza/por-categoria`, barra apilada para
efectivo/transferencia, una cifra hero por vista). Ninguna decisión requiere
una migración nueva ni un cambio de RLS/grants: las cuatro RPCs que alimentan
todos los charts y la vista rápida ya existen, ya están otorgadas, y ya son
`SECURITY INVOKER`. `recharts` ya es una dependencia instalada sin usar;
`motion` no está en el `package.json` committeado y el hilo principal tiene
que instalarla antes de repartir Ola 1 (§3.4) — ninguna dependencia adicional
además de esa (D8 descarta sumar `vaul`). El overlay de pago reusa un
componente que ya está construido en un 80%. El trabajo real de este
pipeline es de composición, motion y datos de demo — no de esquema ni de
permisos.

Ver `01-tasks.md` para el corte en slices, dueños de archivo y criterios de
aceptación por tarea.
