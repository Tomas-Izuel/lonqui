# 03 — Review: Registrar pago por meses, con "desde cuándo"

Pipeline `2026-10-24-pago-por-meses`. Reviewer: `code-reviewer`, 2026-10-24. Evidencia primaria: el diff real contra `main` más los archivos nuevos sin trackear; los `02-development-*.md` se usaron como mapa, no como verdad.

## Veredicto (ronda 3, final): **APPROVED**

Los tres puntos de la ronda 2 están cerrados y verificados en el código; no aparecieron regresiones. `npm test`: 76 archivos, **1495 tests verdes** (con la base levantada), 1 salteado preexistente; `npm run typecheck` y `npm run lint` limpios (0 errores, 9 warnings preexistentes en `tests/`). Queda un nit no bloqueante (R3-1) para una pasada posterior.

---

## Ronda 3 — Re-review acotada (`month-entry.tsx`, `month-strip.tsx`, `month-selection.ts`)

### Cerrado y verificado

- **R2-1 (regresión del total corregido).** `MonthStripPreSystem` suma `onChange?(cents, valid)`; `OpeningTotalField.onChange` (`month-strip.tsx`) calcula `valid` y `cents` una sola vez y, si hay `onChange`, lo llama y **retorna** sin tocar `onOverrideChange`/`onValidityChange`. Los tres consumidores:
  - **`MonthEntry`** (`month-entry.tsx`): `onChange: (cents, valid) => update({ ...entry, overrideCents: cents, overrideInvalid: !valid })` → un solo `onEntryChange` + un `onAmountChange` por tecla, los dos con el mismo `next`. `onOverrideChange: () => {}` es un no-op que la tira nunca invoca porque `onChange` tiene precedencia. OK.
  - **Grupo** (`group-payment-form.tsx:257`): hereda `MonthEntry`; `setEntries((prev) => ({ ...prev, [id]: next }))` se llama una vez por evento. `anyInvalidOverride` (`:136`) sigue deshabilitando el envío (`:328`). OK.
  - **Ficha** (`opening-balance-months.tsx:148-156`): no pasa `onChange`, cae al fallback `onOverrideChange(cents)` + `onValidityChange(valid)`. Son `setOverrideCents` y `setTotalValid`, **dos `useState` independientes**: cada setter reemplaza solo su propio slice, así que el segundo no puede pisar al primero (el problema de la ronda 2 era un único objeto `entry` reconstruido desde un closure viejo). `onTap` resetea los dos y `totalValid` frena el submit (`:72`, `:179`). Confirmado: no pisa nada.
- **R2-2 (`extendToDueMonths`).** `month-selection.ts:100-111`: solo actúa si la selección arranca en `pre_system`; calcula las opciones efectivas con la selección **nueva** (override ya anulado por el `onTap`, consistente con el `update` que sigue) y corre `end` hacia adelante hasta la última `monthly` que quedó elegible; nunca acorta. `MonthEntry.onTap` lo aplica solo en toques a celdas previas, después de `tapCell` sobre las efectivas. Caso primario del brief: tocar julio → `{jul..sep}` → octubre (`monthly`, pago por crédito) queda debiendo en las efectivas → `{jul..oct}` → "4 meses · julio a octubre · $10.000". Tests nuevos (`month-selection.test.ts:513-570`, 7 casos): extiende con deuda sin crédito, no extiende con pozo de sobra, el caso del review, override menor que el pozo no extiende, idempotente, `null`, no acorta un `end` posterior.
- **R2-3.** `coverageForAmount(rawOptions, …)` con `const options = optionsForSelection(rawOptions, …)`: sin reasignar el parámetro. OK.
- `payment-form.tsx`, `group-payment-form.tsx`, `opening-balance-months.tsx` y `member-account-section.tsx` sin cambios desde la ronda 2 (mtime); el resto de lo aprobado no se tocó.

### R3-1. NIT (no bloqueante) — La pista de `derived === 0` sigue mandando a la ficha cuando hay celdas tocables

**Dueño:** F1, en una pasada posterior. `month-entry.tsx:189-193`. Con `extendToDueMonths` el caso de la ronda 2 queda resuelto para meses `monthly`; sobrevive solo cuando el mes actual todavía es `projected` (el 1° antes de que corra el cron) y el saldo anterior iguala al pozo: la tira muestra "este mes" tocable y la pista dice "Indicá desde cuándo debía desde la ficha". Cambiar el texto cuando las opciones efectivas tienen celdas del sistema elegibles ("Marcá hasta qué mes paga").

---

## Ronda 2 — Re-review del diff actualizado

### R2-1. BLOCKER (regresión) — El total corregido del saldo anterior se pierde en los formularios de pago

**Dueño:** F1. **Dónde:** `src/views/payments/month-entry.tsx:132-133`, disparado por `src/views/payments/month-strip.tsx:249-263` (`OpeningTotalField.onChange`).

`OpeningTotalField` llama en el mismo evento, en orden, `onOverrideChange(cents)` y después `onValidityChange(valid)`. En `MonthEntry` los dos handlers cierran sobre el `entry` de **este render**:

```ts
onOverrideChange: (cents) => update({ ...entry, overrideCents: cents }),
onValidityChange: (valid) => onEntryChange({ ...entry, overrideInvalid: !valid }),
```

El segundo `onEntryChange` recibe `{ ...entry, overrideInvalid }` con el `entry` viejo (sin el override recién tipeado). React batchea los dos `setEntry(objeto)` y gana el último: **`overrideCents` vuelve al valor anterior en cada tecla**. Mientras tanto `update()` ya llamó a `onAmountChange(derivado con el override)`, así que el campo `amountCents` del formulario y el botón sí muestran el monto corregido.

**Escenario.** Jul–sep a $10.000 = $30.000; el socio debía $25.000 en total. El tesorero corrige "Total del saldo anterior" a 25.000. El botón dice "Registrar pago de $25.000", pero `entry.overrideCents` sigue `null`: al enviar, `entryOpeningBalance` manda `amountCents: 3.000.000` (la suma). Se crea un saldo anterior de **$30.000** y un pago de **$25.000**: el socio queda debiendo $5.000 que no debía, sin ningún aviso. En el formulario de grupo pasa lo mismo (`setEntries` con el objeto completo, gana el último). La ficha (`opening-balance-months.tsx:148-156`) **no** tiene el problema: usa dos `useState` independientes.

**Fix.** Un solo cambio de estado por evento. La opción más simple: que `OpeningTotalField` emita las dos cosas juntas (`onOverrideChange(cents, valid)`, o un objeto `{ cents, valid }`) y `MonthEntry` haga un único `update({ ...entry, overrideCents, overrideInvalid: !valid })`; la ficha adapta los dos setters en una línea. Alternativa: `onEntryChange` con updater funcional `(prev) => ...` en los dos formularios. Y para `test-engineer`: hoy no hay forma de atrapar esto sin DOM; si F1 extrae la transición de `EntryState` a una función pura (`applyOverride(entry, cents, valid)`), se pinnea con un unit test de dos líneas.

### R2-2. MINOR — Tocar un mes previo deja el mes actual en "debe" y el monto en $0 con una pista que manda a la ficha, cuando la salida es tocar octubre

**Dueño:** F1. **Dónde:** `src/views/payments/month-entry.tsx:121-125` y `:186-191`.

Con las opciones efectivas, en el caso primario del brief (crédito $20.000, oct `monthly` pago, nov/dic cubiertos) tocar julio da: saldo anterior $30.000 que se come todo el pozo, oct/nov/dic pasan a "debe"/"adelanto" (correcto y honesto), pero `tapCell` corre con el `end` anterior (enero, un adelanto) → `end` = último `pre_system` → selección jul–sep → derivado **$0** y el aviso *"El saldo a favor ya cubre esos meses. Indicá desde cuándo debía desde la ficha."* El tesorero ve octubre en rojo y una pista que lo saca del flujo, cuando con un toque más en octubre llega al número correcto ("4 meses · julio a octubre · $10.000", verificado). El brief dice literal *"Tocar julio marca julio–septiembre (+ octubre si lo debe)"*: en las opciones efectivas octubre **sí** se debe. **Fix:** en `onTap` de una celda previa, calcular las opciones efectivas con el saldo anterior **nuevo** y, cuando el `end` anterior era un adelanto o no existía, dejar `end` en la última celda `monthly` que haya quedado elegible (el mes actual) en vez del último `pre_system`. Y cambiar la pista de `derived === 0` cuando las efectivas tienen celdas del sistema elegibles ("Marcá hasta qué mes paga"); dejar la de la ficha solo cuando no las hay.

### R2-3. NIT — `coverageForAmount` reasigna su parámetro

`src/views/payments/month-selection.ts:206-207`: `const rawOptions = options; options = optionsForSelection(...)`. Funciona, pero reasignar un parámetro para que el resto del cuerpo "parezca" igual confunde al que lo lee después. Una `const eff` y usarla abajo. Dueño F1.

### Verificado en la ronda 2

**`effectiveOptions` y el monto derivado (hallazgo 1).** Comprobé la corrección analíticamente y contra los casos pedidos. Definiciones: `paidPoolCents` = Σ `coveredCents` de las celdas del sistema + `max(0, credit − Σ covered de las projected)`. Con `B` = cargos viejos totalmente pagados fuera de la ventana, en los dos regímenes da **`pool = paid − B`**: con crédito, Σ covered(monthly en ventana) = Σ amount(monthly en ventana) y el resto es exactamente `C`; con deuda, Σ covered = `paid − B` y el crédito es 0. Después, el saldo anterior `A` (el cargo más viejo) consume el pozo primero y lo que sobra se reparte en orden. Monto = `max(0, A − pool) + Σ pending(efectivas ≤ end)`; desarrollado da **`max(0, A + Σ amount(ventana ≤ end) − pool)`**, que es la condición real `paid + X ≥ A + B + Σ amount(≤ end)`. Es equivalente a la forma cerrada de la ronda 1 cuando `end` incluye toda la ventana y la generaliza cuando no.

- **La limitación que anotó F1 (meses viejos pagados fuera de la ventana no entran al pozo):** es correcta y no cambia nada. Esos meses aportan `+B` al cargo y `+B` a la cobertura y se cancelan: `pool = paid − B` ya los descuenta. El único efecto es visual: si `A > pool`, en la cuenta real esos meses viejos quedan sin cobertura hasta que se pague `X` (y `X` ya incluye re-cubrirlos); la tira no puede mostrarlos porque no están en la ventana, pero el toast "Todavía debe $X" (`resultingAccountMessage`) y el número del botón son exactos.
- **Saldo anterior mayor que el pozo** (`A` = $50.000, pozo $30.000): neto $20.000, ninguna celda del sistema cubierta, jul–oct = $30.000; real `30.000 + X ≥ 60.000` → $30.000. OK.
- **Crédito más allá del horizonte** (`C` = $100.000, 7 proyectadas cubiertas = $70.000): el pozo suma los $30.000 que no caen en ninguna celda; `A` = $30.000 deja las 7 cubiertas, derivado $0, mensaje de ir a la ficha (correcto: no hay pago que registrar). OK.
- **Mes parcial en la ventana** (oct cubierto $4.000, deuda): pozo $4.000; `A` = $30.000 → neto $26.000, oct vuelve a $10.000; jul–oct = $36.000; real `4.000 + X ≥ 40.000`. OK.
- **"Otro monto" menor y mayor** sobre las efectivas: $5.000 → oct parcial "cubre $5.000 de $10.000", sobrante 0; $25.000 → oct, nov cubiertos y dic parcial (balance forward sigue más allá de lo marcado); $100.000 → siete meses y "Queda saldo a favor de $30.000". OK.
- **Índices estables.** `effectiveOptions` es un `map` 1:1 (mismo largo y orden, celdas `pre_system` por referencia); `MonthStrip` recibe las efectivas y `onTap(index)` vale en las dos; `coverageForAmount` devuelve índices sobre las efectivas; `tapCell` corre sobre las efectivas (una celda que recupera pendiente pasa a ser tocable) y `closePreSystem`/`defaultSelection` sobre las de la RPC, que es lo correcto porque sin saldo anterior son las mismas. Tests nuevos de `effectiveOptions` (`month-selection.test.ts:273-337`): largo/orden/referencias, no muta, conservación del pozo, mayor/menor que el pozo.
- **DB de punta a punta** (`register-payment-batch.test.ts:511-552`): 3 cuotas de saldo + pago de 4 → cubierto hasta el 3er mes después del actual; con pago de 2 → solo hasta el siguiente; un peso menos → parcial. Es el número que promete la UI, probado contra `payment_month_options` después del lote.

**Resto de los hallazgos de la ronda 1.**
- #2 (reintento): los dos formularios usan `result.data.totalCents`, sin label, y avisan con `toast.warning` si el saldo anterior del reintento no quedó cargado (`payment-form.tsx:168-174`, `group-payment-form.tsx`). OK.
- #3: `createOpeningBalanceFromMonths` (action) lee `getBillingStatus()` y rechaza `toPeriod >= startPeriod` con el mismo texto que la RPC. OK.
- #4: `OpeningTotalField` tiene `aria-invalid`, mensaje "Ingresá un monto válido" y resetea el texto cuando cambia la selección (por `key` de períodos). Correcto en sí; la regresión está en cómo lo consume `MonthEntry` (R2-1).
- #6: la nota de adelanto excluye `isCurrent`. OK. #13: "Agregar nota" con `min-h-11`. OK. El texto "antes del sistema" de cada celda previa pasó al `sr-only` y el año se muestra siempre en esas celdas. OK.
- #8 (SQL): el reintento devuelve el `opening_balance_fee_id` con un `left join` por `created_at = p.created_at` (misma transacción → mismo `now()`). Correcto; el join no filtra `voided_at`, lo cual está bien (el saldo sí se creó). #12: `from_p`/`to_p` tienen que ser día 1. #11: comentario sobre `register ⊂ read`. OK.
- #10: schemas compuestos con `openingBalanceMonthsBase.extend(...)` y un `refine` compartido. OK.
- #5 (año en el resumen) decidido y escrito en el brief; #9 (cast de `receiptPath`/`notes`) se mantiene con justificación. Aceptado.
- `00-architecture.md` §10 tiene la "Corrección post-review" con la regla y el ejemplo que tiene que dar bien.

---

## Ronda 1 (2026-10-24, veredicto original: CHANGES REQUESTED)

Un bloqueante de corrección de dinero en la lógica pura de la tira (`derivedAmountCents` / `coverageForAmount`): cuando el socio tiene saldo a favor y se marcan meses "antes del sistema" junto con meses proyectados, el saldo a favor se descuenta dos veces y el formulario cobra de menos mientras le dice al tesorero "Cubre jul–ene". El resto del trabajo (SQL, modelos, actions, UI) está en buen nivel y se detalla abajo.

## Alcance revisado

`git diff --stat main` (sin `ci.yml`, `Logo.png` ni `2026-10-15-importacion-padron/`, que son de antes):

```
.impeccable/surfaces/route-caja.md            |   6 +-
.impeccable/surfaces/route-socios-id.md       |   2 +-
src/controllers/payments.actions.ts           |  88 +++++++--
src/lib/dates.ts                              |  13 +
src/lib/supabase/database.types.ts            |  10 +
src/models/accounts.model.ts                  |  42 +++
src/models/fees.model.ts                      |  57 +++++
src/models/payments.model.ts                  | 134 +++++++------
src/models/types.ts                           |  39 +++
src/views/members/member-account-section.tsx  | 134 ++++---------
src/views/members/member-detail-view.tsx      |   1 +
src/views/payments/group-payment-form.tsx     | 138 +++++++------
src/views/payments/payment-form.tsx           | 138 +++++++------
src/views/payments/register-payment-sheet.tsx |  21 +-
tests/** (5 modificados)
```

Nuevos: `supabase/migrations/20261024120000_payment_months.sql`, `src/views/payments/{month-selection.ts,month-strip.tsx,month-entry.tsx}`, `src/views/members/opening-balance-months.tsx`, `tests/db/{payment-month-options,register-payment-batch}.test.ts`, `tests/db/payment-months-fixtures.ts`, `tests/views/payments/month-selection.test.ts`.

`npm run typecheck`: limpio. `npm run lint`: 0 errores, 9 warnings preexistentes en `tests/` (`no-unused-vars`).

Skills aplicadas como lentes: `supabase-postgres-best-practices`, `supabase` (checklist de seguridad), `vercel-react-best-practices`, `impeccable` (`craft-floor.md`, `operate.md`), `web-design-guidelines`.

---

## Hallazgos (de mayor a menor severidad)

### 1. BLOCKER — El saldo a favor se descuenta dos veces cuando se marcan meses previos junto con meses proyectados

**Dueño:** F1 (`src/views/payments/month-selection.ts`, y `month-entry.tsx`/`month-strip.tsx` para que la tira lo refleje). **El espec también está mal:** `00-architecture.md` §10 (`derivedAmountCents`) define exactamente lo implementado; el hilo principal tiene que corregir §10 y `test-engineer` los fixtures (ver hallazgo 11).

**Dónde:** `src/views/payments/month-selection.ts:127-138` (`openingNetCents` + `derivedAmountCents`) y `:145-189` (`coverageForAmount`).

**Qué pasa.** La RPC `payment_month_options` ya aplica el saldo a favor a las celdas `projected` (`covered_cents` > 0, `pending_cents` reducido; `supabase/migrations/20261024120000_payment_months.sql:144-156`). La lógica pura vuelve a usar ese mismo crédito para descontarlo del saldo anterior (`max(0, saldoAnterior − creditCents)`) **y** suma los `pendingCents` ya netos de crédito. Pero crear el saldo anterior **consume** ese crédito (es el cargo más viejo: balance forward lo cubre primero), así que los meses que la tira muestra como "cubierto" dejan de estarlo en cuanto se registra el lote.

**Escenario concreto (es el caso real del brief, problema 2).** Socio importado, alta 2026-10-01, pagó jul–sep ($30.000) que entraron como saldo a favor. Octubre generado y cubierto por ese crédito. RPC: oct `monthly` pending 0, nov y dic `projected` cubiertos (pending 0), ene–abr pending $10.000; crédito restante C = $20.000. El tesorero abre "¿Debe meses de antes de octubre 2026?", toca julio (saldo anterior A = $30.000) y toca enero. La tira dice "4 meses · julio a enero" (oct/nov/dic no se pueden marcar porque están "pagado"/"cubierto") y el botón "Registrar pago de $20.000" (= max(0, 30.000 − 20.000) + pending(ene) 10.000). Se registra. Estado real: cargos $40.000 (saldo 30.000 + oct 10.000), pagos $50.000 → crédito $10.000 → cubre solo noviembre. **El socio quedó cubierto hasta noviembre; el sistema le dijo al tesorero "Cubre jul–ene". Faltan $20.000.**

Fórmula cerrada correcta para el monto, con A = saldo anterior elegido (o el total corregido) y C = `creditCents`:

```
X = max(0, A − C
          + Σ pendingCents de las celdas del sistema en [primera celda del sistema .. end]
          + Σ coveredCents de las celdas `projected` en ese mismo rango)
```

Chequeos: con C = 0 (hay deuda) da lo de hoy (A + pendientes); solo meses previos da max(0, A − C) como hoy; en el escenario de arriba da 30.000 − 20.000 + 10.000 + 20.000 = $40.000, que es lo correcto.

**Fix sugerido (sin implementar).** La forma honesta es que la tira deje de mentir, no solo el número: cuando hay saldo anterior elegido, `MonthEntry` arma **opciones efectivas** re-corriendo balance forward en orden de período con un solo pozo (el crédito y las coberturas que vinieron de la RPC) insertando el saldo anterior como el cargo más viejo; las celdas `projected` que pierdan cobertura vuelven a "adelanto"/"debe" y se vuelven elegibles, `derivedAmountCents` y `coverageForAmount` operan sobre esas opciones efectivas y la fórmula de arriba sale sola. Como mínimo, `derivedAmountCents` y `coverageForAmount` tienen que sumar también el `coveredCents` de los `projected` del rango (la fórmula), y la celda "cubierto" tiene que dejar de mostrarse como tal cuando el saldo anterior elegido se come ese crédito. `00-architecture.md` §10 y la nota de §4.4 se reescriben con esto.

### 2. MAJOR — En un reintento (`alreadyRegistered`) el momento de éxito muestra el monto y la cobertura del formulario, no lo que quedó registrado

**Dueño:** F1. **Dónde:** `src/views/payments/payment-form.tsx:168-171`, `src/views/payments/group-payment-form.tsx:197-202`.

`onSuccess?.(cents, hasStrip ? (months ? \`Cubre ${months}\` : 'Pago a cuenta') : undefined)` usa `cents` (lo que se iba a mandar) y `coverLabel(options, entry.selection)` (la selección actual), incluso cuando `result.data.alreadyRegistered` es `true` y la RPC devolvió lo que se había cargado la primera vez (que puede ser otro monto y sin saldo anterior, porque el reintento **no toca nada**).

**Escenario.** Primer envío $10.000 (solo octubre) commitea pero la respuesta se pierde; el formulario muestra el error genérico. El tesorero abre el pliegue, toca julio (ahora $40.000 con saldo anterior jul–sep) y vuelve a enviar con el mismo `batchId`. La RPC devuelve el pago de $10.000 con `already_registered = true`; el toast dice "El pago ya estaba registrado" pero el check grande dice **"$40.000 · Cubre jul–oct"**. El saldo anterior nunca se creó. Con el monto derivado de meses, cambiar la selección entre intentos es mucho más probable que antes.

**Fix.** En `alreadyRegistered`, pasar `result.data.totalCents` y un label neutro (o ninguno), y si el ítem llevaba `openingBalance` y `result.data.openingBalanceFeeIds` vino vacío, decir que el saldo anterior no se cargó y mandar a la ficha. Vale para los dos formularios.

### 3. MINOR — El camino de la ficha no valida `toPeriod < inicio de la facturación`; el de la RPC sí

**Dueño:** B1. **Dónde:** `src/models/fees.model.ts:223-229` (`createOpeningBalanceFromMonths`), `src/controllers/payments.actions.ts:200-215`.

`register_payment_batch` rechaza `to_period >= start_period` ("El saldo anterior solo cubre meses anteriores a MM/YYYY", `.sql:272-275`). `createOpeningBalanceFromMonths` delega en `createOpeningBalance` (INSERT por PostgREST) y no chequea nada contra `billing.startPeriod`: una Server Action invocada a mano por un editor logueado con `fromPeriod = '2026-10-01', toPeriod = '2026-12-01'` crea un saldo anterior cuya descripción dice "Saldo anterior · octubre a diciembre 2026" para meses que están dentro del sistema. El `period` lo sigue fijando el trigger (inicio − 1) y la descripción ya era texto libre, así que no rompe la deuda, pero los dos caminos deberían tener la misma regla. **Fix:** en la action (o el modelo) leer `getBillingStatus()` y rechazar con `DomainError` si `toPeriod >= startPeriod`, con el mismo texto de la RPC.

### 4. MINOR — "Total del saldo anterior" es un campo de dinero reinventado y puede quedar desincronizado en silencio

**Dueño:** F1. **Dónde:** `src/views/payments/month-strip.tsx:197-251` (`OpeningTotalField`).

Reimplementa el `$` + `inputMode="decimal"` + `parsePesosToCents` de `AmountField` (`src/views/shared/form-fields.tsx:412`) sin su estado inválido. Si la persona tipea "abc" o "0", `parsePesosToCents` da `null`/0, no se llama a `onOverrideChange`, y **el override anterior sigue vigente** mientras el campo muestra otra cosa: el botón dice "Registrar pago de $30.000" con "0" escrito en el total. Entiendo por qué no usa `AmountField` (no hay `control` de react-hook-form acá), pero hay que mostrar "Ingresá un monto válido" y anular el override cuando el parse falla, o extraer de `form-fields` el par formato/parse para compartirlo. Nit relacionado: `text-primary` para el botón del pliegue es `#C2410C` (5,18:1 según `globals.css:15`), pasa AA; OK.

### 5. MINOR — El resumen lleva año ("3 meses · agosto a octubre 2026") y el brief dice "3 meses · agosto a octubre"

**Dueño:** F1 (o el hilo principal si decide actualizar el brief). **Dónde:** `src/views/payments/month-selection.ts:198-206` (`selectionSummary` usa `periodRangeLabel`). `test-engineer` lo pinneó como está (`03-tests.md`, hallazgo 1). El brief manda; o se quita el año cuando los dos extremos caen en el año actual, o se documenta la decisión en el brief. En la ficha (`opening-balance-months.tsx:165`) el año sí tiene sentido porque es la descripción que se guarda.

### 6. MINOR — Nota "Los meses de adelanto se cobran al valor de hoy" aparece con solo "este mes" marcado

**Dueño:** F1. **Dónde:** `src/views/payments/month-strip.tsx:109` (`showsAdvanceNote` acepta `projected && pricedAtToday` sin excluir `isCurrent`). Si el mes actual todavía no se generó (el 1° temprano), es `projected` con `isCurrent = true`, se marca por defecto y la nota habla de "adelanto" sin que haya ninguno. Excluir `isCurrent`.

### 7. MINOR — Tests que faltan o que pinnean el error (para `test-engineer`)

- `tests/views/payments/month-selection.test.ts:45-57` (`withPreSystem()`): el fixture tiene `projected` con `coveredCents: 0` y después se le pasa `creditCents: 500_000` o `50 * P`. La RPC nunca produce eso: con crédito > 0 los `projected` vienen cubiertos en orden y las `monthly` pagas. Esa inconsistencia es la razón por la que el hallazgo 1 no saltó; el test de `:221-223` ("nunca descuenta de los meses del sistema") pinnea la fórmula errada. Hace falta un fixture que espeje la RPC (oct `monthly` pending 0, nov/dic `projected` cubiertos, crédito $20.000) con selección jul..ene y la aserción `derivedAmountCents = 40.000`; ídem para `coverageForAmount`.
- `tests/db/register-payment-batch.test.ts` ("deuda derivada tras crear el saldo anterior"): agregar el caso crédito > 0 + saldo anterior + pago que pretende cubrir proyectados, verificando con `payment_month_options` después del lote hasta qué mes quedó cubierto. Es la prueba de extremo a extremo del número que la UI promete.
- Sin test de render para `payment-form.tsx` / `group-payment-form.tsx` / `OpeningBalanceMonths` (`method="post"`, sin `window.confirm`, `alreadyRegistered` no reporta el monto nuevo). `03-tests.md` lo declara; con `renderToStaticMarkup` como `month-selector.test.ts` alcanza.

### 8. NIT — El reintento devuelve `opening_balance_fee_id = null`

**Dueño:** hilo principal (SQL). `supabase/migrations/20261024120000_payment_months.sql:239-246`. Documentado por B1; hoy nadie consume `openingBalanceFeeIds`, pero el hallazgo 2 lo necesita para distinguir "ya estaba, con saldo" de "ya estaba, sin saldo". Un `left join` al `opening_balance` vigente del socio creado en la ventana del lote (`created_at` del pago) alcanza.

### 9. NIT — `(input.receiptPath ?? null) as string`

**Dueño:** hilo principal (SQL) + B1. `src/models/payments.model.ts:343-351`. Declarar `receipt_storage_path text default null, notes text default null` en la firma de la RPC hace que `db:types` los genere opcionales y el cast desaparece. Ojo: cambia la firma para el `revoke`/`grant` (`.sql:319-327`), que nombran los tipos, no los defaults, así que no hay que tocar nada más.

### 10. NIT — Schemas duplicados en `fees.model.ts`

**Dueño:** B1. `src/models/fees.model.ts:49-77`: `openingBalanceMonthsSchema` y `createOpeningBalanceFromMonthsSchema` repiten los tres campos y el `refine`. Con Zod v4: `openingBalanceMonthsSchema` sin `.refine()` como base, `.extend({ memberId })` y un solo `refine` compartido, o `z.object({ memberId }).and(...)`.

### 11. NIT — Las dos RPC asumen `payments.register ⊂ payments.read`

**Dueño:** hilo principal (SQL), para el pipeline de roles configurables. Al ser INVOKER, `payment_month_options` lee `fees`/`payments` bajo RLS de `payments.read`; un rol futuro con `register` sin `read` vería una tira donde todo "debe" (no es fuga, es un número falso), y en `register_payment_batch` el chequeo de "ya registrado" (`.sql:239`) no vería su propio lote → el INSERT chocaría con `payments_batch_member_key` → "El mismo socio aparece dos veces en el lote". Dejarlo anotado en el comentario de la función o exigir las dos permissions.

### 12. NIT — `from_period`/`to_period` no se validan como día 1 en SQL

**Dueño:** hilo principal (SQL). `.sql:265-271`. Zod lo exige (`-01`), pero un PostgREST directo puede mandar `2026-07-15`; la descripción es de todas formas texto que viene del cliente. `date_trunc('month', from_p) = from_p` cierra el borde. Sin impacto en la deuda.

### 13. NIT (preexistente, fuera del alcance) — "Agregar nota" mide 32px

`src/views/payments/payment-form.tsx:259` (`size="sm"` sin `min-h-11`). Ya estaba así en `main`; lo anoto porque el resto del formulario cumple los 44px y queda como único target chico de la pantalla.

---

## Lo que verifiqué y está bien

**SQL (`20261024120000_payment_months.sql`).**
- `#variable_conflict use_column` + parámetros homónimos de columnas (`batch_id`, `paid_on`, `method`, `receipt_storage_path`, `notes`): **toda** referencia a parámetro dentro de una sentencia con tablas en scope está calificada (`register_payment_batch.batch_id` en `:237, :239, :243, :300-304, :311`; `payment_month_options.member_ids` en `:93`). Los OUT params de `returns table` no colisionan con ninguna referencia sin calificar.
- Advisory lock transaccional por `hashtext('lonqui.payment_batch:' || batch_id)` (`:237`), chequeo de lote hecho **después** del lock con snapshot nuevo (READ COMMITTED), y las dos RPC en una sola transacción: el reintento secuencial y el concurrente se comportan bien; la atomicidad saldo + pagos está probada (23 tests en `register-payment-batch.test.ts`).
- Las dos públicas son SECURITY INVOKER (`prosecdef = false`, test), `set search_path = ''`, `revoke ... from public, anon` + `grant ... to authenticated`; `revoke execute on all functions in schema private from public, anon` al cierre y grant a mano de `member_fee_price_at` (trampa de CLAUDE.md). `grants-and-lockdown` sigue verde.
- Los INSERT usan exactamente las columnas con grant por columna (`fees`: `member_id, kind, amount_cents, description`; `payments`: las ocho); `created_by` toma `auth.uid()` por default; `fees_insert`/`payments_insert` aplican tal cual; `fees_opening_balance_guard` fija `period = inicio − 1`. Auditoría por trigger con `actor_source = 'session'` probada.
- Saldo a favor sobre proyectados: `greatest(0, least(amount, credit − (acumulado − amount)))` reparte en orden y nunca supera el crédito (test "1,5 cuotas"). `pre_system` y `opening_balance` comparten período pero son excluyentes por `has_opening_balance` (y un saldo anulado vuelve a habilitar `pre_system`: `fees_one_opening_balance` es parcial sobre `voided_at is null`). El hueco de un mes con `monthly` anulada es consistente con `fees_one_monthly_per_period` (incluye anuladas a propósito).
- `max_rows`: la RPC devuelve por socio deuda + 7 + 12; con 6 integrantes hacen falta ~12 años de deuda acumulada para rozar 1000 filas. No hay agregación en TS sobre esto. Períodos con `private.club_today()`, nunca UTC.

**Modelos y actions.** Escrituras con el cliente de sesión (`lib/supabase/server.ts`), sin `createAdminClient`. `translateRegisterError` traduce 42501 → `PermissionError`, 23505 por índice, 23514 con texto redactado → `DomainError`, y un 23514 crudo (`isRawPostgresMessage`) sube como interno: no se filtra ningún mensaje crudo de Postgres. `payments.actions.ts` solo exporta funciones async; `memberIdSchema` y `groupMonthOptions` quedan privados. `getPaymentFormData` hace una sola RPC de opciones con todos los ids, en paralelo con `member_accounts`. `requirePermission('payments.register')` antes de Zod y Zod antes del modelo en las dos actions nuevas. `periodRangeLabel` sin `Date` para los meses. `zodToApiError` sigue devolviendo solo el primer mensaje y campo.

**Capas y alcance.** Las vistas fetchean solo vía actions; ningún `page.tsx`/`layout.tsx` tocado; `createOpeningBalance` ya no se importa desde `src/views/**`; los modelos no importan de views/controllers. Todo dentro de Fase 1 (contrato 2.1/2.2). La migración la escribió el hilo principal; ningún agente tocó `supabase/**`, `types.ts` ni `dates.ts`. Nada se borra; sin `DELETE`, sin `UPDATE` de montos.

**UI.** `MonthStrip`: celdas `button` con `aria-pressed`, `disabled` para `pending = 0`, ícono distinto por estado + texto + `sr-only` con mes, año y estado (nunca solo color); `min-h-11` compacto / `min-h-16` default; 4 columnas que crecen hacia abajo. Pie fijo con `safe-area-inset-bottom` y los `-mx-4 -mb-4` coinciden con el `p-4`/`px-4` del diálogo y del sheet. Todo `<form>` con `method="post"`, sin `window.confirm`. Carga/vacío/error en `OpeningBalanceMonths` y en el sheet. Botones `h-11`. Numerales tabulares en montos. Sin kicker, sin tarjetas anidadas, sin emoji, sin `rounded-[--var]`. Copy rioplatense, identificadores en inglés. `.impeccable/surfaces/route-caja.md` y `route-socios-id.md` actualizados con el anti-objetivo reescrito como pide el brief.

---

## Bloqueantes antes del commit (estado final, ronda 3)

Ninguno.

1. ~~Hallazgo 1 (doble descuento del saldo a favor)~~ — resuelto y verificado en la ronda 2.
2. ~~R2-1 (el total corregido del saldo anterior se perdía en los formularios de pago)~~ — resuelto y verificado en la ronda 3, en los tres consumidores.

El commit puede hacerse cuando `test-engineer` devuelva `SUITE GREEN` sobre este mismo diff.
