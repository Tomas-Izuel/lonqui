# 03 — Tests: UI expresiva (ronda de `test-engineer`)

Cobertura sobre lo que el hilo principal pidió puntualmente para esta pasada:
el arreglo de `reports.controller.test.ts`, las piezas puras de Ola 0
(`overlay-params.ts`, `motion.ts`, `chart-format.ts`, `account-format.ts`),
B1 (`getMemberQuickView`, `getDailyCollection`) y la RPC
`public.daily_collection`. No se tocó `src/**` ni `supabase/migrations/**`.

## 1. Fix: `tests/controllers/reports.controller.test.ts`

`getCobranzaHub` ahora también resuelve `daily` (`getDailyCollection`) en el
mismo `Promise.all` que `collection`/`billing`. Se agregó el mock
`getDailyCollectionMock` al mock de `@/models/reports.model` y se actualizó:

- El test "devuelve collection + billing" → ahora también afirma `daily` en
  el objeto devuelto.
- Un test nuevo que prueba que las tres llamadas arrancan en paralelo (con
  tres promesas controladas a mano: se verifica que las tres mocks fueron
  invocadas ANTES de resolver ninguna) — si `daily` se pidiera en cascada
  después de esperar `collection`/`billing`, este test lo detecta; el viejo
  `toEqual` no lo hubiera hecho.

## 2. `src/views/shared/overlay-params.ts` — `tests/views/shared/overlay-params.test.ts` (nuevo)

Pure functions (`parsePaymentOverlay`, `paymentOverlayValue`,
`parseQuickViewParam`, `isPlainLeftClick`): cubiertas directo, incluidos los
bordes (`socio:0`, `socio:-5`, `socio:abc`, click con modificador o botón del
medio).

**Los hooks** (`useOverlayParam`/`useCloseOverlay`) SÍ se probaron, con un
truco: `react-dom/server`'s `renderToStaticMarkup` (ya viene con `react-dom`,
sin instalar nada) da un render real donde `useCallback` no tira "Invalid
hook call", capturando el resultado en una variable externa. `next/navigation`
se mockeó controlando `useRouter`/`usePathname`/`useSearchParams` desde el
test, y `window.history` se stubbeó a mano (`vi.stubGlobal`) con un `state`
mutable.

### Actualización tras el fix de `code-reviewer` (race real en `set()`)

`code-reviewer` encontró que la escritura de la marca vía `queueMicrotask`
caía en la entrada de historial ANTERIOR (verificado en un navegador real por
el hilo principal): `set()` corría antes de que `router.push`/`replace` de
Next confirmara la navegación. El fix: `set()` deja constancia con un
`pendingMark` a nivel de módulo, y un `useEffect` DENTRO de `useOverlayParam`
es quien escribe la marca en `history.state`, en el próximo render, una vez
que `value` ya refleja el param. Las funciones puras se movieron a
`src/views/shared/overlay-values.ts` (sin `'use client'`: las usa también un
Server Component, la redirección de `/cobranza/nuevo`); `overlay-params.ts`
las re-exporta.

Esto cambia lo que se puede probar sin jsdom: `renderToStaticMarkup` (como
cualquier render a string del lado del servidor) **no ejecuta efectos**. No es
una limitación de mi setup, es cómo funciona React — no hay forma de correr
un `useEffect` sin un renderer que haga commit de verdad (`react-dom/client` +
`act()`, que a su vez necesitan `document`). Se actualizó
`tests/views/shared/overlay-params.test.ts` para reflejar el contrato nuevo y
probar lo que SÍ es alcanzable sin esa dependencia:

- `set()` llama a `push`/`replace` con el href correcto, y **no** escribe la
  marca de forma sincrónica (se afirma `historyState` sigue `null` después de
  `set()` — antes se afirmaba lo contrario, que ahora sería falso y es
  justamente el bug que arregló el fix).
- `useCloseOverlay` ante `history.state` YA marcado (se simula ese estado a
  mano, como si el efecto ya hubiera corrido) → `back()`.
- `useCloseOverlay` ante `history.state` sin marcar (deep link/recarga) →
  `replace()`, nunca `back()`.
- Abrir un overlay con el otro ya abierto (`?pagar=buscar` en la URL) →
  `replace()`, nunca `push()` (no se apila).
- Cerrar sin el param en la URL no hace nada (ni back ni replace).

Lo que queda **sin cubrir por un test automatizado** (y por qué es una
limitación real, no negligencia): que el `useEffect` de `useOverlayParam`
efectivamente escriba la marca correcta en el render posterior a un `set()`
real, de punta a punta. Esa parte la verificó a mano el hilo principal en un
navegador real (mencionado en el pedido de esta ronda). Para cubrirla con un
test hace falta `jsdom`/`happy-dom` como `environment` de estos archivos en
`vitest.config.ts` (vía `environmentMatchGlobs`) más `@testing-library/react`
(`render`/`act`, que sí disparan efectos) — **ninguno de los dos está
instalado hoy**. No los instalé (no me corresponde instalar dependencias);
lo dejo señalado para quien lo necesite.

Las funciones puras (`parsePaymentOverlay`, `paymentOverlayValue`,
`parseQuickViewParam`, `isPlainLeftClick`) se re-apuntaron a su origen real,
`@/views/shared/overlay-values`, en vez del re-export de `overlay-params.ts`.

## 3. `src/views/shared/motion.ts` — `tests/views/shared/motion.test.ts` (nuevo)

Solo `staggerDelay` (la única función pura del archivo — el resto son hooks
que dependen de `useReducedMotion`/`sessionStorage`/animación real y no
justifican mockear sin DOM, no estaban en el pedido). Cubre el crecimiento
lineal, el valor exacto en el índice del techo y que MÁS ALLÁ del techo el
delay se achata (no sigue creciendo) — es la propiedad que evita que la
última fila de una lista larga espere de más.

## 4. `src/views/shared/chart-format.ts` — `tests/views/shared/chart-format.test.ts` (nuevo)

`formatAxisTick`, `shortMonth`, `dayOfMonth`. Siguiendo el mismo criterio que
`tests/lib/money.test.ts` para moneda formateada con `Intl`: se afirma con
`toContain`/regex ("compacto, con `$`, sin espacio, sin código ARS") en vez
del string exacto que arme esta versión de ICU. `shortMonth` se prueba con
`timeZone: 'UTC'` explícito (no cruza de mes según el huso del proceso que
corre el test) y que los doce meses no se pisan entre sí. `dayOfMonth` se
prueba con string exacto (no depende de `Intl`, es determinístico).

## 5. `src/controllers/members.actions.ts` — `getMemberQuickView`

Agregado a `tests/controllers/members.actions.test.ts` (mismo archivo,
mismo patrón de mocks en el borde: `requirePermission`, `getMemberAccount` de
`@/models/accounts.model`, y `createClient` con un `.from().select().eq()
.maybeSingle()` encadenado a mano). Cubre exactamente lo que pedía B1:

- Sin sesión (`PermissionError`) → `ActionResult` de error, `getMemberAccount`
  y `createClient` nunca se tocan.
- Exige `payments.read` (no `members.read`).
- `memberId` inválido (`0`, `-1`, `1.5`) → error de Zod antes de tocar el
  modelo.
- Socio inexistente (`getMemberAccount` → `null`) → `{ ok: false, error: 'No
  encontramos ese socio' }`, y la segunda lectura (`members.phone`) ni se
  ejecuta.
- Éxito: junta el `MemberAccount` con el `phone` de la segunda lectura.
- `maybeSingle()` sin fila → `phone: null`, no un 500 (la razón de ser de
  `maybeSingle` en vez de `single`).
- Error de Postgres en la segunda lectura → `ActionResult` de error, nunca
  una excepción sin capturar.

## 6. `src/models/reports.model.ts` — `getDailyCollection`

Agregado a `tests/models/reports.model.test.ts`, mismo `chainableRpc` que ya
usa el archivo para `getMonthCollection`/`getMonthlyHistory`. Cubre: sin
`targetPeriod` llama `daily_collection` con `{}` (nunca calcula el mes en
TS); con `targetPeriod` pasa `{ target_period }`; pide `order('day', {
ascending: true })` explícito (defensivo, mismo criterio que el resto del
archivo); mapeo `day`/`collected_cents`/`cumulative_cents` → camelCase sin
tocar los montos; `data: null` → `[]`; error de Postgres se propaga.

## 7. `tests/db/reports.test.ts` (nuevo) — RPC `public.daily_collection`

Contra el stack local real (Docker levantado, `npm run db:start` ya corrido
por quien lanzó esta tarea). Todo dentro de `BEGIN … ROLLBACK`
(`tests/db/helpers.ts`), sin tocar la base del desarrollador ni los datos de
demo de `seed-demo.sql`.

- **Permisos**: `anon` no puede ejecutarla (sin `EXECUTE`, `42501` antes de
  llegar a chequear `payments.read`); `consulta` (uno de los 3 roles con
  `payments.read` hoy) sí puede.
- **Rango de días**: mes en curso → una fila por día desde el 1 hasta
  `private.club_today()` real (hoy, sin simular), nunca más allá — se
  calculó `today.getDate()` en vez de un número fijo para no depender de en
  qué día corra esta suite. Mes pasado (junio de 2021) → el mes COMPLETO (30
  filas), aunque ya haya pasado hace años.
- **Montos**: pago anulado excluido del día (monto exacto, no "incluye al
  menos" — se aisló con un período viejo, junio de 2021, fuera de la ventana
  de 12 meses de `seed-demo.sql`); un día sin pagos aparece con
  `collected_cents = 0`, no ausente (la curva acumulada no puede tener
  huecos); `cumulative_cents` es EXACTAMENTE la suma corrida de
  `collected_cents` fila por fila, verificado sumando en JS y comparando —
  nunca se asume la aritmética de la RPC, se la contrasta.
- **Hallazgo de implementación, no de bug**: `pg` devuelve las columnas
  `date` (`day`, `private.club_today()`) como objetos `Date` de JS
  construidos en el huso LOCAL del proceso (paquete `postgres-date`), no como
  string ni en UTC. Los tests usan `.getDate()`/`.getMonth()`/`.getFullYear()`
  (los getters locales) para reconstruir el día calendario sin que importe en
  qué huso corra la máquina que ejecuta la suite. No es un bug de la RPC —
  `collected_cents`/`cumulative_cents` sí llegan como `string` (bigint), igual
  que en el resto de `tests/db/`.
- **`grants-and-lockdown.test.ts`**: revisado — hoy enumera tablas de
  `public` (para `DELETE`) y funciones de `private` (para `EXECUTE` de
  `PUBLIC`/`anon`), pero NO enumera funciones de `public`. No había nada que
  extender ahí; el chequeo de `anon` sobre `daily_collection` quedó en
  `tests/db/reports.test.ts`, mismo criterio que ya usa `accounts.test.ts`
  para sus propias 6 RPC (`describe('anon no ejecuta ninguna de las 6 RPC de
  este archivo')`) en vez de centralizarlo.

## 8. `src/views/payments/account-format.ts` — `categoryRowLabel`

`tests/views/payments/account-format.test.ts` (nuevo). Las dos filas
especiales (`social`, `opening_balance`) con texto fijo que ignora cualquier
otro campo; una fila de categoría con disciplina (`"Disciplina · Categoría"`)
y sin disciplina (`disciplineName: null` → solo el nombre, sin `"· "`
colgando).

## 9. `src/views/shell/nav-items.ts` — orden NO tocado

No existía ningún test de este archivo (no es que "el existente no necesitó
tocarse": no había ninguno). Se agregó `tests/views/shell/nav-items.test.ts`
que fija Socios(0) > Cobranza(1) > Inicio(2) — el pedido fechado de Tomás que
el Addendum revierte explícitamente ("C6 NO se aplica") — para `getNavItems`
(desktop) y `getMobileNav` (que Socios quede siempre en el extremo derecho,
el más alcanzable con el pulgar, y nunca en el overflow de "Más").

## 10. Suite completa

```
npm run typecheck   → limpio
npx eslint <archivos tocados/nuevos>   → limpio
npm test             → 45 archivos, 716 tests pasados, 1 skip (pre-existente,
                        tests/db/billing.test.ts, sin relación con esta ronda)
```

(716 en vez de los 715 originales: se sumó un test nuevo al actualizar
`overlay-params.test.ts` tras el fix de la race — ver más arriba.)

Corrido 3 veces seguidas sin flakiness (el test de "mes en curso" depende de
`club_today()` real, no de una fecha simulada, y se calculó contra ella
misma en vez de contra un número fijo).

## Veredicto

**SUITE GREEN**
