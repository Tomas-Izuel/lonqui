# 03 — Revisión (code-reviewer)

Rama `fix/pago-por-meses-antes-del-inicio`. Alcance revisado: migración `20261024150000_payment_months_before_start.sql` y las vistas `month-selection.ts`, `month-strip.tsx`, `month-entry.tsx`, `member-account-section.tsx`, `opening-balance-months.tsx`. Se ignoró `tests/`.

## Verificado y correcto

- **Migración**: `diff` contra `20261024120000_payment_months.sql` muestra solo lo declarado: se saca `start_period > current_period` del early return, `price_today` con fallback, e `is_current` en `pre_system`. Misma firma y mismo `returns table`, así que `create or replace` conserva los grants (`authenticated`, sin `public`/`anon`). No crea funciones en `private`, por lo que no hace falta repetir el `revoke`. Sigue siendo INVOKER con `require_permission`.
- **`is_current` en `pre_system`**: después del inicio nunca es true (`pre < start <= current`). `cellTone` devuelve `pre_system` antes de mirar `isCurrent` y `isAdvance` solo mira `projected`, así que ningún consumidor cambia. El único lector nuevo es `isBeforeStart`.
- **Matemática antes del inicio** (sin cargos, solo `pre_system` y `projected`). Selección inicial `{actual, actual}`: `derived = X` y el saldo anterior de X con pago X deja saldo 0. Con saldo a favor C: `derived = max(0, X − C)`, y el mensaje de éxito da 0 (`balance + X − (X − C)`). `effectiveOptions` reparte el resto del pozo entre las proyectadas.
- **Después del inicio**: sin cambios de comportamiento. `isBeforeStart` es false, el pliegue sigue con `onToggle`, y `keepsPre` da el mismo resultado que el `isPre ? null` anterior.
- **Reglas de toque y override**: volver a tocar el primer mes previo marcado desmarca, y el override se descarta (`isPre` es true). Tocar una celda no previa conserva el override si la selección sigue arrancando en un mes previo. Con la celda no elegible devuelve la selección igual y `keepsPre` la respeta.
- **Socio con saldo anterior vigente**: la RPC no le devuelve `pre_system`, por lo que `isBeforeStart` es false y usa el flujo normal sobre la celda `opening_balance`.
- **Grupo**: cada integrante llama a `initialEntry` y `MonthEntry` con sus propias opciones, sin estado compartido.
- **Reglas del repo**: sin lógica de datos en vistas; formularios con `method="post"`; targets `min-h-11` y `min-h-16`; estado con ícono y texto además del color; sin kicker; copy en rioplatense; centavos enteros.

## Hallazgos

### 1. MAJOR — La selección inicial usa el último mes previo, no el mes actual
`src/views/payments/month-selection.ts` (`defaultSelection`, ~líneas 68-72), con el mismo supuesto en `tapCell` (~línea 97) y en `month-strip.tsx`.

El código asume que el mes actual es `lastPreSystemIndex`. Eso solo vale si el inicio es el mes siguiente. `activateBillingSchema` y `settings_billing_guard` aceptan cualquier mes futuro.

Escenario: hoy octubre 2026, inicio enero 2027.
- La RPC trae `pre_system` de ene 2026 a dic 2026, con `isCurrent` solo en octubre.
- `defaultSelection` hace `current = lastPreSystemIndex` y marca `{dic, dic}`.
- El formulario propone cobrar solo diciembre (un mes que todavía no venció) como saldo anterior, y octubre queda sin marcar. Eso rompe el "más viejo primero" y el copy "este mes".
- Tocar octubre marca octubre–diciembre. El saldo anterior incluye así noviembre y diciembre, que aún no se deben.
- La línea "Las cuotas arrancan en enero 2027" es correcta, pero la tira ofrece meses futuros como deuda.

Arreglo: en `defaultSelection` usar el índice de la celda `pre_system` con `isCurrent`, no `lastPreSystemIndex`.

Decidir una de dos opciones para los previos posteriores al actual:
- (a) la RPC no los devuelve (`pre_system` solo hasta `least(start − 1, current)`), que es lo más coherente con "lo que debe hoy";
- (b) el tope de la selección es el mes actual.

La opción (a) obliga a revisar `lastPre` en `month-entry.tsx` (`startPeriod: addMonths(lastPre.period, 1)`), que hoy deriva el inicio del último previo. Con (a) ese cálculo daría el mes siguiente al actual y no el inicio real. El inicio real hay que pasarlo explícito. Hoy el texto "Las cuotas arrancan en …" depende de esa derivación y saldría mal. No hay test que cubra inicio a 2 o más meses.

### 2. MINOR — Ventana de 12 meses: si el mes actual queda fuera, el modo "antes del inicio" no se activa
`month-selection.ts` (`isBeforeStart`) y la RPC (`start − 12 months`).

Con el inicio a 13 meses o más, ninguna celda previa trae `isCurrent`. `isBeforeStart` es false y se vuelve al pliegue "¿Debe meses de antes de…?", sin el mes actual cobrable. Es un caso extremo y degrada sin romper. Alcanza con anotarlo en el dev log, o resolverlo junto con el hallazgo 1 acotando la ventana a `least(start, current + 1)` hacia atrás.

### 3. MINOR — El fallback de precio pisa un valor "0" legítimo
Migración, CTE `target`: `coalesce(nullif(member_fee_price_at(..., current_period), 0), member_fee_price_at(..., greatest(current_period, start_period)))`.

`member_fee_price_at` devuelve 0 tanto para "sin valor configurado" como para un valor real de $0. Hoy no existe un valor $0 en datos reales, pero el contrato permite diferenciar por categoría. Un socio exento hoy y con valor desde el inicio vería sus celdas previas al valor de noviembre. No bloquea. Dejar comentado el supuesto (0 = sin valor) en la migración o distinguir "sin fila" de "fila en 0".

### 4. NIT — La línea explicativa se repite por integrante en el pago de grupo
`month-strip.tsx` (~líneas 136-140): con N integrantes, la misma frase aparece N veces en pantalla de 390 px. Mostrarla una sola vez arriba del grupo, o solo en el primer integrante.

### 5. NIT — Comentario obsoleto en la migración original
Según el comentario del `create function` en `20261024120000`, con inicio futuro "no devuelve nada". Ya no es cierto, pero esa migración es inmutable. Alcanza con que el comentario de la nueva migración lo diga, y lo dice.

### 6. NIT — Detalles menores de vista
- `opening-balance-months.tsx`: la ficha no pasa `beforeStart` a la tira y repite la explicación en su propio `<p>`. Es correcto, no se duplica, pero son dos fuentes del mismo texto.
- `month-entry.tsx`: `closePreSystem` queda sin uso antes del inicio. Sigue usándose después, así que no es código muerto.

## Cobertura que le pido a test-engineer

- `isBeforeStart`, `defaultSelection` y `tapCell` antes del inicio: seleccionar el mes actual, desmarcar el primer mes marcado, desmarcar con extensión a proyectadas y tocar una proyectada.
- **Inicio a 2 o más meses** (hallazgo 1). Hoy el test lo marcaría rojo.
- Override: se descarta al desmarcar y al tocar una celda previa; se conserva al tocar una celda posterior.
- Saldo a favor C con `{actual, actual}`: `derived = max(0, X − C)` y las proyectadas cubiertas por C pasan a pendientes en `effectiveOptions`.
- DB: `payment_month_options` con inicio futuro (celdas `pre_system` con `is_current` solo en el mes actual, `projected` desde el inicio, fallback de precio) y con inicio pasado (sin `is_current` en previas). Un socio con saldo anterior vigente no recibe `pre_system`.
- `member-account-section`: el botón "Indicar desde cuándo debía" aparece con inicio futuro.

## Bloqueantes

1. Hallazgo 1: `defaultSelection`, `tapCell` y `startPeriod` de la tira asumen que el mes actual es el último previo. Con inicio a 2 o más meses la selección inicial es un mes futuro.

## Lo bueno

- Cambio mínimo en la RPC: `create or replace` fiel, con grants preservados.
- El caso común (inicio el mes siguiente) funciona. La matemática de montos, el saldo a favor y el mensaje de éxito cierran en $0.
- El comportamiento posterior al inicio queda intacto.
- Buen estado accesible: la celda "este mes" tiene ícono y texto, y lectura para pantalla "este mes, antes del sistema".

CHANGES REQUESTED

---

## Ronda 2

Revisado: la migración actualizada y los diffs de `month-selection.ts`, `month-entry.tsx`, `month-strip.tsx`, `payment-form.tsx`, `group-payment-form.tsx` y `register-payment-sheet.tsx`. Se ignoró `tests/`.

### Hallazgos de la ronda 1

1. **Resuelto.** `defaultSelection` y `tapCell` usan `currentPreSystemIndex` (la celda previa con `isCurrent`). `tapCell` toma ese índice como tope y cae a `lastPreSystemIndex` solo si no hay mes actual (después del inicio), que es lo de siempre. La migración acota `pre_system` a `least(start − 1, current)`, así que con inicio a 2 o más meses los meses futuros ya no se ofrecen. El `startPeriod` real viaja desde `billing.startPeriod` (sheet → `PaymentForm`/`GroupPaymentForm` → `MonthEntry` → `MonthStrip`), y "Las cuotas arrancan en…" y el pliegue ya no dependen de `lastPre + 1`.
2. **Resuelto.** La ventana de 12 meses cuenta hacia atrás desde el tope (`least(...) − 11 meses`), por lo que el mes actual siempre entra.
3. **Resuelto.** El supuesto 0 = sin valor quedó documentado en la migración.
4. **Resuelto.** `BeforeStartNote` se muestra una vez bajo "Integrantes" en el pago de grupo, y `hideBeforeStartNote` se activa solo si hay `startPeriod`. Si faltara, cada tira muestra su línea, sin quedar sin explicación.

### Regresiones buscadas

- **Después del inicio**: la ventana de `pre_system` es idéntica (`least = start − 1`, de `start − 12` a `start − 1`). `isBeforeStart` es false, el pliegue sigue con `onToggle` y `tapCell` conserva el comportamiento anterior. Sin cambios.
- **`startPeriod` opcional**: los tres puntos de uso (`register-payment-sheet`, `PaymentForm` y `GroupPaymentForm`) lo pasan. El fallback derivado solo queda como red de seguridad y el comentario avisa de su límite.
- **Grupo**: por integrante, `initialEntry` y `isBeforeStart` evalúan sus propias opciones. La nota única aparece si al menos un integrante está antes del inicio.
- **Reglas del repo**: sin hallazgos (MVC, `method`, 44px, copy, centavos).

### Observaciones (no bloquean)

- NIT: con inicio a 2 o más meses el saldo anterior que se crea queda con período `start − 1` (lo fija `fees_opening_balance_guard`), aunque cubra hasta el mes actual. Es de la ronda anterior y no cambia el monto ni la deuda derivada. Vale una línea de nota en el dev log.
- Cobertura pendiente para test-engineer: el caso de inicio a 2 o más meses en `defaultSelection`/`tapCell` y en la RPC (`pre_system` termina en el mes actual, `is_current` solo ahí).

Sin bloqueantes.

APPROVED
