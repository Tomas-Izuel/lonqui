# 03 — Review: UI expresiva (flujo, charts y motion)

**Veredicto final: APPROVED** (re-review de los 3 hallazgos corregidos —
ver "Re-review" al final del documento. El cuerpo original de la revisión
queda abajo sin editar, como registro).

## Re-review (después de la corrección de los bloqueantes)

El hilo principal reportó tres correcciones puntuales sobre los hallazgos 1,
2 y 3 de abajo. Las revisé de nuevo, read-only, contra el código real:

### Hallazgo #1 (bloqueante) — RESUELTO

`src/views/members/member-account-section.tsx:96` ahora llama
`<MemberAccountAnswer account={account} variant="plain" />`.
`member-account-answer.tsx` agregó la prop `variant?: 'card' | 'plain'`
(default `'card'`, el que sigue usando `member-quick-view-sheet.tsx:91`, que
no vive dentro de ningún contenedor con marco propio). Con `'plain'`, el
componente pierde `rounded-xl`/`border`/`shadow-raised` y en su lugar hace
`-mx-4 -mt-4 px-4 pt-4 pb-3` para sangrar a los bordes del `p-4` que ya pone
`Panel` — el resultado es una banda de color de ancho completo pegada abajo
del encabezado "Cuenta", sin borde ni sombra propios: ya no hay tarjeta
dentro de tarjeta. Confirmé leyendo `panel.tsx` (el `<header>` de "Cuenta"
termina antes del `<div className="p-4">` que envuelve `children`, así que la
banda no pisa las esquinas redondeadas de la sección) y con `npm run build`
(compila, ninguna otra pantalla usa `variant="plain"` de forma indebida —
`money-summary-strip.tsx` sigue sin usar `Panel` en absoluto, como ya
verifiqué en la ronda anterior). **Correcto.**

### Hallazgo #2 (bloqueante) — RESUELTO

Las cuatro funciones puras (`parsePaymentOverlay`, `paymentOverlayValue`,
`parseQuickViewParam`, `isPlainLeftClick`) se movieron a
`src/views/shared/overlay-values.ts`, un módulo nuevo **sin** `'use client'`.
`src/app/(panel)/cobranza/nuevo/page.tsx:4` ahora importa
`paymentOverlayValue` desde `@/views/shared/overlay-values`, no desde
`overlay-params.ts`. `overlay-params.ts` (que sigue con `'use client'` en la
línea 1, porque sus hooks sí necesitan el navegador) re-exporta esas mismas
cuatro cosas al final del archivo (`overlay-params.ts:119-125`) para que el
código cliente existente (`payment-overlay-host.tsx`, `member-picker.tsx`,
`member-list.tsx`, etc.) no tenga que cambiar su import.

Verifiqué con un barrido completo que **todo** importador de
`@/views/shared/overlay-params` es un Client Component (`'use client'` en la
primera línea) y que el único importador de `@/views/shared/overlay-values`
es el propio `page.tsx` (un módulo puro, sin directiva, es seguro de importar
desde cualquier lado). `npm run typecheck`, `npm run lint` y `npm run build`
(Turbopack, `next build`) están limpios con este cambio — y a diferencia de
la ronda anterior, ahora el arreglo es estructural (ya no depende de que
Turbopack "no haya fallado esta vez"): `overlay-values.ts` nunca entra al
mecanismo de client-reference porque nunca lleva la directiva. **Correcto,
y es exactamente el mismo patrón que ya salvó a `chart-format.ts`/
`chart-kit.tsx`** (el nit #8 de abajo queda parcialmente resuelto de paso:
ahora hay dos ejemplos documentados del mismo patrón en el repo).

### Hallazgo #3 (mayor) — RESUELTO

`set()` en `useOverlayParam` (`overlay-params.ts:72-93`) ya no escribe la
marca con `queueMicrotask`: solo deja `pendingMark = name` (variable de
módulo) antes de `router.push`/`router.replace`. Quien escribe la marca de
verdad es un `useEffect` nuevo (`overlay-params.ts:65-70`) que corre en el
render donde `value` (el `searchParams.get(name)` real) ya refleja el param
— es decir, después de que Next confirmó la navegación, no en base a un
supuesto de orden de microtasks. Esto elimina la carrera de raíz: la
decisión de escribir la marca ahora depende de un efecto observable (el
valor del param cambió) y no de una suposición sobre cuándo corre
internamente `history.pushState` dentro de `router.push`.

Leí `tests/views/shared/overlay-params.test.ts` actualizado: documenta
honestamente que `renderToStaticMarkup` no ejecuta efectos, así que el test
no puede reproducir de punta a punta "abrir con `set()` y que la marca quede
escrita" — prueba por separado que `set()` empuja el href correcto sin marcar
todavía, y que `useCloseOverlay` reacciona bien a los dos estados posibles de
`history.state` (marcado → `back()`, no marcado → `replace()`). Es una
limitación real de las herramientas instaladas (falta `jsdom`/
`@testing-library/react`), no un descuido, y coincide con lo que ya había
señalado en la ronda anterior.

El hilo principal reportó verificación manual en navegador real (`next
start`) cubriendo exactamente los dos escenarios que pedí en el hallazgo
original: abrir y cerrar con el botón atrás en la misma pestaña (vuelve a la
página anterior, un segundo "atrás" sale del panel — consistente con dos
entradas de historial reales) y un deep-link viejo
(`/cobranza/nuevo?socio=620&volver=/socios/620` → `/socios/620?pagar=socio:620`
con el diálogo abierto) cerrado con `replace()` (`history.length` sin
cambios). Dada la corrección estructural (ya no es un supuesto de timing,
es una reacción a un efecto observable) más esa verificación manual, doy el
hallazgo por resuelto. **Correcto.**

### De paso, sin que se pidiera: el nit #6 (handle de arrastre) también se resolvió

`src/views/shared/responsive-sheet.tsx` cambió el `<div>` decorativo del
handle por un `<button type="button" onClick={() => onOpenChange(false)}
aria-label="Cerrar" className="flex h-11 shrink-0 ...">` — ahora es un
elemento interactivo real (nombre accesible, foco de teclado, `Enter`/
`Espacio` nativos) que además sigue disparando el drag vía
`onPointerDown={(event) => dragControls.start(event)}`, y el área de toque
pasó a `h-11` (44px), cumpliendo el piso. Verificado leyendo el archivo
completo: el pill visual sigue siendo el mismo indicador chico, solo cambió
el elemento que lo envuelve. **Resuelto.**

### Estado de los minors restantes (#4, #5, #7, #8) — ninguno bloquea

No fueron tocados en esta vuelta (no se pidió) y siguen tal como se
documentaron:

- **#4** (`payment-overlay-host.tsx:44`, `PaymentOverlayHost` en silencio
  cuando falla el permiso con el overlay ya abierto por URL): sigue ahí.
  Es una mejora de UX para un caso borde (link compartido sin permiso), no
  una falla de seguridad ni de datos — **no hace falta bloquear el commit
  por esto**, pero es barato de resolver (un `useEffect` que llama `close()`
  cuando `target` es válido y `canRegister` es falso) y vale la pena en la
  misma pasada si el agente de frontend vuelve a tocar este archivo pronto.
- **#5** (`member-picker.tsx:23,71`, cursor mágico como sentinel de "primera
  página"): sigue ahí. Es deuda técnica menor y una sugerencia de test para
  `test-engineer`, no algo que deba resolver este pipeline — **no bloquea**.
- **#7** (línea de `revoke` redundante en la migración): cosmético, **no
  bloquea**; si se toca la migración por otro motivo, vale sacarla o
  comentarla.
- **#8** (el addendum describe C4 como un solo archivo, se construyeron dos):
  puramente documental, **no bloquea**; una línea en `00-architecture.md`
  alcanza, y ahora que el mismo patrón se repitió para `overlay-values.ts`
  hay más razón para documentarlo como convención, no como excepción.

**Ninguno de los cuatro es "barato y vale la pena antes de commitear" al
punto de bloquear** — son follow-ups razonables, no defectos activos. Mi
recomendación: mergear con estos cuatro anotados como deuda conocida, y que
#4 sea lo primero que se levante si alguien vuelve a tocar
`payment-overlay-host.tsx`.

### Verificación de conjunto

`npm run typecheck`, `npm run lint`, `npm run build` (Turbopack) y `npm test`
(45 archivos, 716 tests + 1 skip) están **todos verdes** contra el estado
actual del árbol. No quedan bloqueantes abiertos.

---

## Cuerpo original de la revisión (referencia, sin editar)

## Alcance revisado

`git diff --stat HEAD` (excluyendo `package-lock.json`): 71 archivos
modificados (+1544/-765) más los nuevos sin trackear: `overlay-params.ts`,
`motion.ts`, `chart-format.ts`, `chart-kit.tsx`, `hero-figure.tsx`,
`category-debt-chart.tsx`, `daily-collection-chart.tsx`, `cobranza-tabs.tsx`,
`member-picker.tsx`, `payment-overlay-host.tsx`, `member-quick-view-sheet.tsx`,
`member-account-answer.tsx`, `member-period-strip.tsx`, `panel-session.tsx`,
`auth-card.tsx`, la migración `supabase/migrations/20260928120000_daily_collection.sql`
y `supabase/seed-demo.sql`.

Leí `00-architecture.md`, `01-tasks.md` completo (incluido el "Addendum del
hilo principal", que confirmé que efectivamente manda sobre lo anterior:
`nav-items.ts` **no** está en el diff, C6 no se aplicó, tal como dice el
addendum) y los siete `02-development-*.md`. Verifiqué contra el código real,
no contra los logs:

- `npm run typecheck` → limpio.
- `npm run lint` → limpio (solo warnings preexistentes en `tests/`, fuera de este diff).
- `npm run build` (`next build`, Turbopack) → compila y genera las 16 rutas sin error.
- `npm test` → verde; la suite creció en vivo mientras `test-engineer` corría
  en paralelo. En un punto intermedio `tests/db/reports.test.ts` tenía 2 tests
  fallando por un fixture propio chocando con un guard preexistente de
  `payments` (no relacionado a este diff) — se lo ruteo a `test-engineer`, no
  bloquea este review.
- Contra el stack local levantado (`mcp__supabase__*`, sin aplicar nada
  nuevo): confirmé que `20260928120000_daily_collection` es la única
  migración nueva aplicada, que `public.daily_collection` es `SECURITY
  INVOKER` (`prosecdef=false`), `STABLE`, con `authenticated: true` / `anon:
  false` / `service_role: false` en `has_function_privilege`, y ejecuté a
  mano el `sum(...) over (order by d.day)` sobre datos reales para confirmar
  que el acumulado corrido es correcto.
- Inspeccioné el bundle compilado (`.next/server/...`) y el runtime de
  `react-server-dom-turbopack` instalado en `node_modules` para confirmar en
  el código fuente el mecanismo exacto detrás del hallazgo 2.

Esta revisión se apoyó también en tres pasadas independientes que hice correr
en paralelo sobre subconjuntos del diff (límites MVC/`'use client'`/`'use
server'`; craft-floor/accesibilidad; firmas de pago y código muerto). Las tres
convergieron en el mismo bloqueante #1. Esta versión consolida esas tres
pasadas y agrega dos hallazgos que ninguna cubría porque su alcance estaba
acotado a `src/views/**`: el bloqueante #2 y el mayor #3, ambos en
`src/app/**` / el runtime de Next, no en `views/`.

## Hallazgos

### 1. [BLOQUEANTE — regla dura del piso de calidad] `MemberAccountAnswer` queda anidada dentro del `Panel` "Cuenta" de la ficha

**Archivos:** `src/views/members/member-account-section.tsx:92-94`,
`src/views/members/member-account-answer.tsx:60`, `src/views/shared/panel.tsx:4-9,23`

```tsx
// member-account-section.tsx:92-94
<Panel title="Cuenta">
  <div className="flex flex-col gap-3">
    <MemberAccountAnswer account={account} />
```

`Panel` pinta `rounded-xl border border-border/70 bg-card shadow-raised`
(`panel.tsx:23`). `MemberAccountAnswer` pinta, con el mismo lenguaje visual,
otro `rounded-xl border border-border/70 bg-brand-soft p-4 shadow-raised`
(`member-account-answer.tsx:60`). Puesto como primer hijo de `<Panel
title="Cuenta">`, el resultado en pantalla es una tarjeta naranja pálida con
sombra y borde propios **dentro de** la tarjeta blanca con sombra y borde de
"Cuenta": exactamente la definición visual de "tarjetas anidadas" que
CLAUDE.md lista entre las reglas duras del piso de calidad, al mismo nivel de
innegociable que la prohibición del kicker. El propio comentario de `Panel`
lo dice textual: *"NO se anida: un `Panel` dentro de otro `Panel` es
exactamente lo que el piso de calidad prohíbe"* (`panel.tsx:4-5`), y
`route-socios-id.md` lista *"tarjetas anidadas (tampoco dentro de una
pestaña)"* como anti-objetivo explícito de esta misma superficie.

**Evidencia de que no es una lectura forzada**: el mismo pipeline resuelve
bien el mismo caso dos veces. En `money-summary-strip.tsx:86-112` (inicio), el
bloque equivalente (`HeroFigure` sobre `bg-brand-soft`, mismo borde/sombra) es
un hermano de nivel superior de `Panel`, nunca su hijo, y el propio comentario
lo explica: *"no es un panel anidado, es el único bloque de nivel superior con
este tratamiento."* En `member-quick-view-sheet.tsx:91`, `MemberAccountAnswer`
se monta directo dentro del `ResponsiveSheet` (que no es un `Panel`), así que
tampoco anida. Solo `member-account-section.tsx` comete el error — es la
única de las tres apariciones de `MemberAccountAnswer` en este pipeline que
queda anidada — y `02-development-frontend-socios.md:93` documenta el cambio
("reemplacé... por `<MemberAccountAnswer account={account} />` como primer
hijo del panel 'Cuenta'") sin notar la inconsistencia con el propio dashboard
del mismo pipeline.

**Escenario de falla concreto**: cualquiera que abra `/socios/<id>` de un
socio con cuenta (la pantalla más usada después del padrón) ve, a 390px, un
marco doble — el borde/sombra de "Cuenta" y, 4px adentro, el borde/sombra/
fondo `bg-brand-soft` de la respuesta central ("Debe $X · N meses" / "Al
día") — justo en la superficie que el pedido de Tomás señaló como la más
importante del sistema.

**Fix sugerido** (no prescriptivo): (a) que `MemberAccountSection` deje de
envolver esa parte en `Panel` y la trate como bloque de nivel superior (mismo
patrón que `MoneySummaryStrip`), con los botones debajo sin tarjeta blanca
extra; o (b) darle a `MemberAccountAnswer` una variante sin marco propio
(`bare`/`inset`, sin `rounded-xl`/`border`/`shadow-raised`/`bg-brand-soft`)
para cuando ya vive dentro de un contenedor con su propio marco, reservando
el tratamiento con marco para cuando se usa suelta (inicio, sheet).

---

### 2. [BLOQUEANTE — límite Server/Client Component roto] `/cobranza/nuevo` llama una función de un módulo `'use client'` desde un Server Component: revienta en runtime justo para el caso de uso que la ruta existe para resolver

**Archivo:** `src/app/(panel)/cobranza/nuevo/page.tsx:4,39`

```tsx
import { paymentOverlayValue } from '@/views/shared/overlay-params'
// ... (sin 'use client': Server Component real — usa `await searchParams`, `redirect()` de servidor)
export default async function RegisterPaymentRedirectPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // ...
  const overlayValue =
    familyGroupId != null ? paymentOverlayValue({ mode: 'grupo', familyGroupId }) : paymentOverlayValue({ mode: 'socio', memberId: memberId as number })
  const separator = volverHref.includes('?') ? '&' : '?'
  redirect(`${volverHref}${separator}pagar=${encodeURIComponent(overlayValue)}`)
}
```

`src/views/shared/overlay-params.ts:1` empieza con `'use client'`.
`paymentOverlayValue` es una función plana (no un componente, nunca se
renderiza como JSX) exportada por ese módulo. Este `page.tsx` la llama
DIRECTO, como función, desde un Server Component. Es exactamente la clase de
bug que este mismo pipeline ya sufrió una vez ("chart-kit/categoryRowLabel") —
salvo que ahí el equipo separó bien lo puro (`chart-format.ts`, sin
directiva) de lo `'use client'` (`chart-kit.tsx`), y acá, en un archivo de
`src/app/` que ninguna de las slices de frontend tenía marcado como "propio"
para revisar con esa lupa (F-cobranza es dueña de `views/payments/**`, no
necesariamente relee cada `page.tsx` con el mismo cuidado), no se hizo.

**Por qué esto no es una sospecha teórica.** Cuando un Server Component
importa un export nombrado de un módulo `'use client'`, el runtime de React
Server Components que usa Next 16 con Turbopack (`react-server-dom-turbopack`)
reemplaza ESE export por una referencia cliente cuyo único comportamiento al
invocarse como función es tirar una excepción. Lo verifiqué leyendo el código
fuente instalado en este repo
(`node_modules/next/dist/compiled/react-server-dom-turbopack/cjs/react-server-dom-turbopack-server.node.development.js`,
función `getReference`, rama genérica de export nombrado):

```js
clientReference = registerClientReferenceImpl(
  function () {
    throw Error(
      "Attempted to call " + String(name) + "() from the server but " + String(name) +
      " is on the client. It's not possible to invoke a client function from the server, " +
      "it can only be rendered as a Component or passed to props of a Client Component."
    )
  },
  target.$$id + "#" + name,
  target.$$async
)
```

Es decir: en cuanto este `page.tsx` reciba `?socio=<id>` o `?grupo=<id>` (el
caso normal — el de "sin ninguno" ya redirige antes sin tocar la línea
problemática), `paymentOverlayValue({...})` va a tirar `Error: Attempted to
call paymentOverlayValue() from the server but paymentOverlayValue is on the
client...`. Como `(panel)/error.tsx` es un error boundary, no es una pantalla
en blanco sino la pantalla de error genérica del panel — pero el efecto real
es que **la ruta que existe específicamente para que un link viejo guardado
siga funcionando** (`/cobranza/nuevo?socio=5&volver=/socios/5`, el criterio de
aceptación explícito de F-cobranza en `01-tasks.md`: *"Un link viejo guardado...
sigue funcionando: abre `/socios/5` con el overlay ya abierto"*) está rota
para exactamente ese caso.

**Por qué `npm run build`/`npm run typecheck` no lo atraparon**: `tsc` no
conoce la semántica de límites RSC (chequeo de tipos, no de runtime), y `next
build` no ejecuta el cuerpo de una route dinámica (usa cookies vía
`requirePanelPermission`, así que Next no la prerrenderiza) — solo la
compila. El error solo aparece cuando la ruta se pide de verdad con esos
parámetros, algo que ni el build ni los tests automatizados ejercitan hoy.

**Fix sugerido**: mover las funciones puras de `overlay-params.ts`
(`paymentOverlayValue`, `parsePaymentOverlay`, `parseQuickViewParam`,
`isPlainLeftClick` — ninguna usa hooks) a un módulo SIN `'use client'`,
exactamente el mismo patrón que ya salvó a `chart-kit.tsx` de este problema
(`chart-format.ts` puro + `chart-kit.tsx` con la parte de hooks/JSX). Los dos
hooks (`useOverlayParam`, `useCloseOverlay`) siguen necesitando `'use client'`
y pueden re-exportar las funciones puras desde ese módulo nuevo, igual que
`chart-kit.tsx` re-exporta `chart-format.ts`.

---

### 3. [MAYOR] `overlay-params.ts`: la marca de `history.state` después de `router.push` depende de un supuesto de timing que ningún test puede probar tal como está escrito

**Archivo:** `src/views/shared/overlay-params.ts:74-78`

```ts
router.push(href, { scroll: false })
// router.push actualiza history de forma asíncrona: la marca va en la
// entrada nueva, no en la anterior.
queueMicrotask(() => writeMark(name))
```

El criterio de aceptación de C2 en `01-tasks.md` llama a esto "el contrato más
importante de todo el pipeline". La corrección depende de que, para cuando
corre el `queueMicrotask`, el `history.pushState` real que hace Next por
dentro de `router.push()` ya haya ocurrido — si no, `writeMark` (que usa
`history.replaceState`) escribe la marca sobre la entrada VIEJA en vez de la
nueva, y el próximo `close()` haría `router.back()` cuando en realidad
correspondería `replace()` (o al revés), sacando a alguien de la app por
error con el botón atrás.

Revisé `tests/views/shared/overlay-params.test.ts` (nuevo, de
`test-engineer`, 12 tests, todos verdes): mockea `useRouter().push` como un
`vi.fn()` que no llama a ningún `history.pushState` real ni modela "entradas
de historial" separadas — `historyState` es una única variable compartida en
el test. Los tests prueban correctamente la LÓGICA de
`markedBy`/`writeMark`/la decisión push-vs-replace, pero **no pueden, por
construcción, detectar una carrera real** entre el `pushState` interno de
Next y el `queueMicrotask` de acá, porque el mock no tiene ninguna noción de
"cuándo" ocurre el pushState real ni de que `pushState` crea una entrada de
historial nueva con su propio `state` independiente de la anterior.

No afirmo que esté roto — el comportamiento conocido de Next (el cambio de
URL vía `router.push` se aplica de forma optimista, sincrónica respecto al
`return` de la llamada, antes de que llegue el payload de la navegación) hace
pensar que probablemente funciona. Pero dado que es el contrato que esta
ronda entera califica como el más delicado, y que ni el build ni el test
nuevo lo verifican contra el router real, esto necesita una **verificación
manual explícita en navegador** antes de mergear: abrir el overlay de pago
desde el inicio, cerrarlo con el botón atrás del celular y confirmar que no
saca del panel; pegar un link con `?ver=123` directo en la barra (deep link)
y cerrar, confirmar que usa `replace()` y no `back()`. No alcanza con "los
tests pasan".

---

### 4. [MENOR] `PaymentOverlayHost` no avisa nada cuando el permiso falla con el overlay ya abierto por URL

**Archivo:** `src/views/payments/payment-overlay-host.tsx:44`

```tsx
if (!target || !canRegister) return null
```

Si alguien sin `payments.register` llega con `?pagar=socio:12` en la URL
(link compartido, refresh, un `back()` mal cerrado), el componente entero
devuelve `null`: no se abre nada, no hay mensaje, y el parámetro queda pegado
en la URL indefinidamente (nadie llama a `close()`). No es un problema de
seguridad (`getPaymentFormData`/`RegisterPaymentSheetBody` vuelven a exigir
el permiso del lado del servidor), pero es una experiencia confusa: tocar
"Pago" no hace nada visible. Sugerencia: si `target` es válido pero
`canRegister` es falso, limpiar el param con `close()` en un efecto, o
mostrar un `ErrorState` breve dentro del sheet en vez de `null`.

### 5. [MENOR] `MemberPicker` reutiliza el cursor de paginación como bandera de "primera página" con un valor mágico

**Archivo:** `src/views/payments/member-picker.tsx:23,71`

```ts
const FIRST_PAGE_CURSOR = 'buscar'
// ...
const result = await loadMoreMembers({ filters: { q: term, status: 'all' }, cursor: FIRST_PAGE_CURSOR })
```

Se apoya en que `decodeCursor` "ignora" un cursor que no decodifica a un
keyset válido y arranca de nuevo — un comportamiento de *fallback* de
`loadMoreMembers`, no una API pensada para "dame la primera página". Funciona
hoy, pero es un acoplamiento implícito a un detalle de implementación ajeno a
este archivo: si `decodeCursor` se vuelve más estricto en el futuro (valida y
lanza en vez de ignorar), esta búsqueda se rompe en silencio. Ruteo a
`test-engineer`: convendría un test que fije el contrato ("`loadMoreMembers`
con un cursor no decodificable siempre se comporta como primera página,
nunca lanza"). Para una ronda futura, considerar que `loadMoreMembers` acepte
`cursor?: string` opcional.

### 6. [NIT] Handle de arrastre del sheet: por debajo del piso de 44px y sin rol interactivo para lectores de pantalla

**Archivo:** `src/views/shared/responsive-sheet.tsx:136-142`

```tsx
<div
  onPointerDown={(event) => dragControls.start(event)}
  aria-label="Arrastrar para cerrar"
  className="flex shrink-0 touch-none cursor-grab justify-center pt-2 pb-1 active:cursor-grabbing"
>
  <span aria-hidden className="block h-1.5 w-10 rounded-full bg-border" />
</div>
```

El área que dispara `onPointerDown` mide aproximadamente `pt-2` (8px) + el
alto del indicador visual `h-1.5` (6px) + `pb-1` (4px) ≈ 18px de alto — muy
por debajo del piso de 44px que CLAUDE.md exige para "todo lo que se toca".
No es crítico (D8 documenta que el drag es "un atajo, nunca el único
camino", y `Esc`/el botón de cerrar nativo de Radix siguen andando), pero al
ser el único punto pensado para iniciar el gesto con el dedo conviene
agrandar el área táctil (padding invisible extra) sin agrandar el indicador
visual. Además, un `<div>` sin `role`/`tabIndex` normalmente queda fuera del
árbol de accesibilidad, así que el `aria-label` probablemente nunca se
anuncia — si la intención es que sirva de algo, conviene `aria-hidden` en vez
de un `aria-label` que no se lee, dado que tampoco es operable por teclado.

### 7. [NIT] `revoke execute on all functions in schema private from public, anon` repetido sin necesidad

**Archivo:** `supabase/migrations/20260928120000_daily_collection.sql:51`

Esta migración no crea ninguna función en `private`, así que la línea final
es redundante (ya la aplicaron migraciones anteriores). No es incorrecta ni
peligrosa — es un no-op defensivo — pero si se vuelve costumbre copiarla en
toda migración "por las dudas", vale un comentario que aclare que acá no hace
falta.

### 8. [NIT] Addendum de `01-tasks.md` dice que C4 es un archivo; se construyeron dos

**Archivos:** `docs/pipelines/2026-09-28-ui-expresiva/01-tasks.md:558-559`,
`src/views/shared/chart-format.ts` (nuevo), `src/views/shared/chart-kit.tsx:1,20`

El addendum dice literal: *"C4 se llama `src/views/shared/chart-kit.tsx` (no
`chart-format.ts`)"*. Lo que se construyó son DOS archivos: `chart-format.ts`
(sin `'use client'`, formateadores puros) y `chart-kit.tsx` (`'use client'`,
re-exporta esos nombres y agrega `ChartTooltipFrame`/`TooltipRow`/
`useChartEntrance`). Esto no es un bug — es la solución correcta al mismo
riesgo del hallazgo #2, aplicada bien acá: `member-period-strip.tsx` (Server
Component) importa `shortMonth` desde `chart-format.ts` directo, nunca desde
`chart-kit.tsx`. Vale una línea en `00-architecture.md`/`01-tasks.md`
documentando el split real, y ojalá el mismo patrón se hubiera repetido para
`overlay-params.ts` (hallazgo #2).

## Nota sobre `npm test` (no es un hallazgo contra este diff, es para `test-engineer`)

Durante gran parte de esta revisión, `tests/db/reports.test.ts` (nuevo, de
`test-engineer`, corriendo en paralelo) tuvo tramos con 2 tests fallando por
"La fecha del pago es demasiado vieja" — un `CHECK`/guard preexistente de
`supabase/migrations/20260927130100_payments.sql`, no algo que esta migración
toque. Es un fixture del test nuevo chocando con ese guard, no un bug de
`daily_collection` ni de ningún archivo de este diff. No lo cuento como
bloqueante de este review, pero el commit final no debería pasar sin que
`test-engineer` devuelva `SUITE GREEN`.

## Bloqueantes

1. **Hallazgo #1** (`member-account-section.tsx:92-94` /
   `member-account-answer.tsx:60`): sacar la tarjeta de `MemberAccountAnswer`
   de adentro del `Panel` "Cuenta" — regla dura del piso de calidad, sin
   excepción, en la superficie que el pedido de Tomás señaló como la más
   importante.
2. **Hallazgo #2** (`src/app/(panel)/cobranza/nuevo/page.tsx:4,39`): dejar de
   llamar una función exportada por un módulo `'use client'`
   (`overlay-params.ts`) desde este Server Component — hoy revienta en
   runtime exactamente para el caso de uso ("link viejo guardado") que esta
   ruta existe para resolver.

El hallazgo #3 (mayor) no bloquea el commit por sí solo, pero **debería
resolverse con una verificación manual en navegador real antes de mergear**,
dado que es el contrato que el propio pipeline califica como el más delicado
y que ningún test automatizado puede probar tal como está escrito hoy. Los
hallazgos #4-#8 son menores/nits y no bloquean.

## Lo que está bien

- **Layering / MVC intacto en el resto del diff**: ningún `page.tsx`/
  `layout.tsx` (salvo el hallazgo #2) importa algo indebido; ningún
  `.actions.ts` exporta algo que no sea una función async ni importa otro
  `.actions.ts`; `members.actions.ts` mantiene `'use server'` en la primera
  línea. `reports.model.ts`/`reports.controller.ts` plumban
  `getDailyCollection`/`daily` sin cruzar capas ni agregar en TypeScript (el
  acumulado viene sumado desde la RPC, nunca reconstruido en JS).
- **El bug histórico "chart-kit/categoryRowLabel" no se repitió en
  `views/`**: `chart-format.ts` (puro, sin `'use client'`) es lo que importan
  los Server Components; `chart-kit.tsx` (`'use client'`) es lo que importan
  los Client Components. Los Server Components que importan de módulos
  `'use client'` (`CategoryDebtChart`, `HeroFigure`, `PaymentOverlayHost`,
  `MemberQuickViewSheet`, `PanelSessionProvider`) los usan siempre como JSX,
  el patrón válido — la única excepción de todo el diff es el hallazgo #2, en
  un archivo de `src/app/` fuera del patrón que el resto del pipeline siguió
  bien.
- **Migración `daily_collection`, verificada en vivo, no solo leída**:
  `SECURITY INVOKER` (`prosecdef=false`), `search_path=''`, `stable`, chequea
  `private.require_permission('payments.read')`, grants correctos
  (`authenticated: true`, `anon: false`) confirmados con
  `has_function_privilege` contra el stack local. Ejecuté el `sum(...) over
  (order by d.day)` con datos de prueba y el acumulado da correcto. El corte
  en `least(fin de mes, private.club_today())` respeta no mostrar días
  futuros como "cero cobrado" y usa la hora argentina. Máximo 31 filas, nunca
  toca `max_rows`.
- **`seed-demo.sql`**: no está referenciado en `supabase/config.toml`
  (`sql_paths = ["./seed.sql"]` sin cambios) ni en ningún script de
  `package.json` — no puede correr como parte de `db:reset`. El apagado/
  prendido de `fee_prices_insert_guard`/`settings_billing_guard` está
  acotado por nombre (nunca `disable trigger all`), documentado con el
  motivo exacto, y vive dentro del único `begin ... commit` del script: si
  algo falla entre el `disable` y el `enable`, la transacción entera
  revierte. Es idempotente (chequeo de DNI `^90000` al inicio), nunca importa
  `docs/relevamiento/`, y los DNI de relleno (90000001-90000200) no
  colisionan con datos reales.
- **Firmas de `PaymentForm`/`GroupPaymentForm` preservadas**: `onDone: () =>
  void` sigue igual en ambos; `onSuccess?: (amountCents: number) => void` es
  aditivo y opcional. `registerPayment`, `voidPayment`, `getPaymentFormData`
  (`payments.actions.ts`) no están en el diff — sin regresión de lógica de
  negocio, ni en el pago individual ni en el de grupo familiar (mismo
  `batchId`, misma lista de filas; solo cambió el envoltorio visual de
  `Panel` a un `div` con separador, evitando además un panel-dentro-de-sheet
  que hubiera existido si se mantenía `Panel` ahí).
- **Código muerto retirado sin huérfanos**: `payment-form-page.tsx`,
  `month-rows.tsx` y `cobranza/nuevo/loading.tsx` están borrados y no quedan
  referencias colgantes en `src/`/`tests/`.
- **Contraste medido, no solo declarado**: recalculé con la fórmula WCAG los
  pares de `globals.css` — `--muted-foreground` 5.78:1 (blanco), 5.29:1
  (canvas/brand-soft), coincidiendo con los números que el propio comentario
  del CSS declara; `--status-in-debt` 5.93:1 sobre `brand-soft`;
  `--status-up-to-date` ~4.6:1 sobre `brand-soft` (pasa AA para texto normal
  por un margen ajustado, y el uso real es en texto grande `text-3xl`/
  `text-4xl`, que solo necesita 3:1 — sin riesgo real, pero vale confirmarlo
  con una herramienta en vez de solo el cálculo manual). `--brand` (3.06:1)
  se usa solo en íconos, nunca como `text-brand` sobre texto real.
- **Dataviz**: un solo hue secuencial en `CategoryDebtChart`/
  `DailyCollectionChart` (nunca paleta categórica), sin `NaN`/división por
  cero (`Math.max(1, ...)`), tabla accesible oculta en los dos charts
  nuevos, `useChartEntrance`/`useCountUpOnce` apagan la animación completa
  con `prefers-reduced-motion` en vez de solo acortarla.
- **Nada se borra / auditoría / permisos**: sin `DELETE`, sin copy nuevo de
  "eliminar"/"borrar" (los hits de grep son comentarios que dicen
  explícitamente "nunca eliminar"), sin `grant delete`, sin lógica de rol
  nueva (todo pasa por el catálogo de permisos ya existente:
  `payments.read`/`payments.register`), sin dato personal en ningún
  `console.log`/`console.error` tocado, sin `<form>` sin `method`.
- **Ficha en pestañas**: revisé `member-detail-view.tsx` completo — ningún
  `Panel` queda anidado dentro de otro; cada `TabsContent` contiene `Panel`s
  hermanos, tal como pide `01-tasks.md` (distinto del hallazgo #1, que es un
  componente *no-`Panel`* con estilo de tarjeta metido dentro de un `Panel`
  real).
- **Cobranza en pestañas-como-links (D3)**: `cobranza-tabs.tsx` usa `<Link>`
  reales a 5 rutas propias (bookmarkeables, con su propio filtro/export),
  indicador animado con `layoutId` + `SPRING_INDICATOR`, desactivado con
  movimiento reducido, scroll horizontal con `scrollIntoView` para que la
  pestaña activa no quede oculta a 390px.
- **44px**: `HeroFigure`, `CobranzaTabs`, filas de `CategoryDebtChart`,
  `member-picker.tsx` (`min-h-14`), botones de `member-account-section`/
  `member-quick-view-sheet` (`h-11`) cumplen el piso — la única excepción es
  el handle de arrastre (hallazgo #6, nit).
- **`ResponsiveSheet`**: las 6 props públicas no cambiaron; el drag se acota
  al handle (`dragListener={false}` + `dragControls`), nunca compite con el
  scroll interno de un formulario largo; con `prefers-reduced-motion` el
  handle no se renderiza y `drag={false}`; `Esc`/el botón de cerrar nativo
  siguen siendo un camino de cierre independiente del gesto.
- **`ViewTransition` sin flag**: confirmé contra
  `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` que Next
  16 no necesita `experimental.viewTransition` — el equipo lo verificó bien y
  no tocó `next.config.ts` de más.
- **Briefs de `.impeccable/surfaces/`** (`route.md`, `route-cobranza.md`,
  `route-socios.md`, `route-socios-id.md`) quedaron actualizados con
  contenido real, no un stub de una línea.
- Compila (`next build`), tipa (`tsc --noEmit`) y lintea limpio.
