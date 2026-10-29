# 01 — Tareas: imputación libre de meses

Borrador del `feature-planner` (2026-10-29). Se reparte **después** de que el usuario apruebe
`00-architecture.md`. Corte por directorio, sin un solo archivo compartido entre agentes. Todo
agente de implementación corre en `sonnet`, en paralelo donde las dependencias lo permiten.

Orden: **T0 (hilo principal) → T1 ∥ T2 ∥ T3 → T4 ∥ `code-reviewer`**. Nada se commitea hasta
`APPROVED` y `SUITE GREEN`.

---

## T0 — Schema, contratos y docs (hilo principal, lane `schema` + `shared`)

**Ningún agente toca esto.**

Archivos que posee:
- `supabase/migrations/20261029120000_payment_allocations.sql` (SQL de `00-architecture.md` §9).
- `src/lib/supabase/database.types.ts` (regenerado con `npm run db:types`).
- `src/models/types.ts`: `PaymentMonthOption` suma `creditCoveredCents: number` y
  `beforeJoined: boolean`; nuevo `PaymentAllocationInput = { period: ISODate; amountCents:
  number }`. Nada más cambia de forma.
- `src/lib/dates.ts`: `periodListLabel(periods: ISODate[]): string` — vacío → `''`; uno →
  `formatPeriod`; contiguos → `periodRangeLabel(first, last)`; no contiguos → meses largos
  separados por coma y " y " antes del último, con el año una sola vez al final si todos lo
  comparten ("mayo, julio y septiembre 2026"), si no cada uno con su año ("noviembre 2025, enero
  y marzo 2026": el año se escribe cuando cambia respecto del anterior).
- `CLAUDE.md`: reemplazar los dos párrafos indicados en `00-architecture.md` §13.

Pasos: aplicar la migración con `npm run db:reset` (revisar las notas de §9: orden de secciones,
tabla temporal, mensajes), `npm run db:types`, correr `npm test` para ver qué tests de `tests/db/`
y `tests/views/` quedan rojos **por diseño** (los que fijaban el rango) y pasarle la lista a T4.
Si el MCP local responde, `get_advisors` sobre la tabla y las funciones nuevas.

Criterios de aceptación (los prueba T4 contra la base):
- La migración corre entera sobre el seed y sobre un dump de producción sin disparar la
  verificación de §9 sección 8.
- `has_table_privilege('authenticated', 'public.payment_allocations', 'DELETE') = false`; ídem
  `UPDATE`; `service_role` sin INSERT; `anon` sin nada. Columna `source` sin grant de INSERT.
- `payment_allocations_no_change` rechaza UPDATE y DELETE incluso como `postgres`.
- Las funciones nuevas de `private` no son ejecutables por `public`/`anon`
  (`grants-and-lockdown.test.ts`).

---

## T1 — Backend: modelo y controller de pagos (`senior-backend-engineer`, lane `backend`)

**Posee**: `src/models/payments.model.ts`, `src/models/accounts.model.ts`,
`src/controllers/payments.actions.ts`.
**No toca**: `src/models/types.ts`, `src/lib/**`, `src/views/**`, `supabase/**`, `tests/**`,
`src/models/fees.model.ts`, `src/models/reports.model.ts`.

Objetivo: que `registerPayment` mande las imputaciones a `register_payment_batch` y que
`getPaymentMonthOptions` traiga las dos columnas nuevas, con los errores nuevos traducidos.

Qué hacer:
1. `payments.model.ts`: `paymentItemSchema` suma `allocations: z.array(allocationSchema).max(60)
   .nullish()` con `allocationSchema = { period: YYYY-MM-01 (mismo `periodSchema` que
   `fees.model`: reexportarlo o duplicar el refine con el mismo texto "El mes no es válido"),
   amountCents: int > 0 }` y dos refines sobre el ítem: períodos únicos ("Los meses imputados no
   son válidos") y Σ `amountCents` de las imputaciones ≤ `amountCents` del ítem ("Lo imputado
   supera el monto del pago"), ambos con `path: ['items']`. `registerPayment` arma
   `allocations: [{ period, amount_cents }] | null` por ítem. `translateRegisterError`: los
   mensajes del guard ("El mes MM/YYYY no tiene cuota generada…", "El mes MM/YYYY ya está
   pago…", "Lo imputado supera el monto del pago", "Un pago anulado no se imputa", "Los meses
   imputados no son válidos") ya caen en el `23514 && !isRawPostgresMessage` → `DomainError` con
   `field: 'items'`; verificar que `isRawPostgresMessage` no los considere crudos (traen
   `MM/YYYY`, revisar su regex) y agregar casos explícitos si hace falta.
2. `accounts.model.ts`: `PaymentMonthOptionRow` suma `credit_covered_cents` y `before_joined`
   (opcionales en el tipo de fila, como `opening_from`); el mapeo pone `creditCoveredCents:
   row.credit_covered_cents ?? 0` y `beforeJoined: row.before_joined ?? false`.
3. `payments.actions.ts`: sin cambio de firma. Solo si el `familyGroupId` check necesita algo (no
   debería). No agregar actions.
4. Escribir `02-development-backend.md` en la carpeta del pipeline.

Criterios de aceptación (T4 los prueba con mocks en `tests/models/` y `tests/controllers/`):
- Un ítem sin `allocations` o con `null` sigue siendo válido y la RPC recibe `allocations: null`.
- Períodos repetidos, día ≠ 1, monto 0, más de 60, Σ > monto → `invalid` con el texto y
  `field: 'items'`, sin llamar a la RPC.
- Un `PostgrestError` 23514 con "El mes 05/2026 ya está pago…" → `DomainError` con ese texto.
- `getPaymentMonthOptions` mapea `credit_covered_cents`/`before_joined` y tolera que falten.

Contratos: `PaymentAllocationInput`, `PaymentMonthOption` (T0). Firma de `registerPayment` y
`RegisterPaymentResult` sin cambios.

Skills: `supabase` (`.claude/skills/supabase/SKILL.md`), `vercel-react-best-practices` (solo
por los Server Actions). Sin Context7: no hay API nueva.

---

## T2 — Frontend: grilla de meses y formularios de pago (`frontend-react-craftsman`, lane `frontend`)

**Posee**: `src/views/payments/month-selection.ts`, `month-strip.tsx`, `month-entry.tsx`,
`month-drag.ts`, `use-month-drag.ts`, `payment-form.tsx`, `group-payment-form.tsx`,
`register-payment-sheet.tsx`, y el brief `.impeccable/surfaces/route-caja.md`.
**No toca**: `src/views/members/**` (T3), `src/views/shared/**`, `src/models/**`,
`src/controllers/**`, `src/lib/**`, `tests/**`, `supabase/**`.

Objetivo: la grilla pasa de rango a conjunto; el formulario manda `allocations`; adelantos
solo cuando no queda nada con cargo adeudado; aviso de fecha de alta; "Otro monto" con la regla
de §6.3.

### F1 — `month-selection.ts` (lógica pura, sin React ni `Date`; es el spec de T4)

Tipos y funciones (los índices son sobre el array **completo** de opciones; "efectivas" = mismo
largo y orden):

- `Selection = number[]` — índices marcados, ordenados ascendente, sin repetidos. `null` deja de
  existir: vacío = `[]`. `isMarked(selection, i)`.
- `isSelectable(o)` = `pendingCents > 0` (igual). `cellTone(o)`: `pending = 0 ∧ creditCovered >
  0` → `'covered'` (también en `monthly`/`opening_balance`, no solo `projected`); `pending = 0`
  sin crédito → `'paid'`; resto igual que hoy.
- `isCharged(o)` = `kind ∈ {monthly, opening_balance}` ∨ (`pre_system` dentro del tramo de la
  selección). `advancesAllowed(options, selection)` = no existe celda `isCharged ∧ isSelectable ∧
  !isMarked` (los previos del tramo sin marcar cuentan como adeudados). Una celda `projected`
  es **tocable** solo si `advancesAllowed`; `cellTone` no cambia, pero `MonthStrip` la atenúa y
  le pone `aria-disabled`.
- `toggleCell(options, selection, index, opts: { preSystemOpen }) → { selection, blocked?:
  'advance' }`: no elegible → igual; `pre_system` con el pliegue cerrado → igual; `projected`
  sin `advancesAllowed` → igual y `blocked: 'advance'` (la UI muestra el aviso); si no, alterna.
  Desmarcar un mes con cargo cuando hay adelantos marcados **desmarca también los adelantos**
  (si no, quedarían marcados adelantos con un adeudado sin marcar, que la base no respetaría).
- `paintRange(options, base, anchor, over) → Selection`: `mode` = `base` no contiene `anchor` →
  `'mark'`, si no `'unmark'`; aplica a `[min, max]` sobre `base` (fuera del rango no cambia);
  solo celdas elegibles; `pre_system` solo con pliegue abierto (recibe `opts`); `projected` solo
  si al terminar `advancesAllowed`. En `'unmark'` vale la misma regla de arrastre de adelantos.
- `defaultSelection(options, status)`: activo → `[primer índice elegible con cargo]` (sin
  `pre_system`), o `[]`; de baja → todos los elegibles con cargo; antes del inicio → `[mes actual
  previo]` si es elegible. Igual que hoy en espíritu.
- `firstJoinedIndex(options)`: índice de la primera `pre_system` con `beforeJoined === false`
  (`-1` si no hay previas). `openingSpan(options, selection) → { from, to } | null`: `null` si no
  hay `pre_system` marcada; `from = min(primer previo marcado, firstJoinedIndex si ≠ -1)`;
  `to = último índice pre_system`. `beforeJoinedWarning(options, selection) → boolean`: hay un
  previo marcado con `beforeJoined`.
- `splitOpeningTotal` (igual). `openingBalanceFromSelection(options, selection, override?)`:
  `fromPeriod = options[from].period`, `toPeriod = options[to].period`, `amountCents = override
  ?? Σ amount F..P`.
- `effectiveOptions(options, selection, ctx: { openingBalanceOverrideCents?, creditCents })`:
  sin tramo → `options`. Con tramo: las previas F..P toman su parte del reparto como `amount`.
  Lo **explícito** (`coveredCents − creditCoveredCents`) de cada celda queda fijo; el **pozo
  móvil** = Σ `creditCoveredCents` de todas las celdas no previas + `max(0, creditCents − Σ
  creditCoveredCents de las projected)`; se re-reparte en orden de período (previas del tramo
  primero, después el resto) sobre `amount − explícito`; `coveredCents = explícito + crédito
  nuevo`, `creditCoveredCents = crédito nuevo`, `pendingCents = amount − covered`. Las previas
  fuera de F..P no cambian.
- `derivedAmountCents(options, selection, ctx)` = Σ `pendingCents` (efectivas) de las marcadas.
- `allocationsFromSelection(options, selection, ctx) → PaymentAllocationInput[]`: por cada
  marcada **con cargo** (monthly, opening_balance, pre_system dentro de F..P) con pendiente
  efectivo > 0: `{ period, amountCents: pendingCents }`. Las `projected` marcadas **no** van (son a
  cuenta). Si todo lo marcado es `projected`, devuelve `[]`.
- `coverageForAmount(options, selection, amountCents, ctx) → { allocations, fullyCovered: number[],
  partial: { index, cents } | null, creditCovered: number[], creditPartial: { index, cents } |
  null, leftoverCents }` ("Otro monto"): primero las marcadas con cargo en orden (imputación
  explícita, hasta el pendiente efectivo de cada una); el remanente recorre las **no marcadas**
  elegibles con cargo en orden y después las `projected` en orden (crédito derivado); lo que
  sobra es `leftoverCents`. Las previas solo dentro de F..P.
- `debtAfterPayment(options, selection, ctx, otherAmountCents?)`: Σ pendiente efectivo de las
  celdas con cargo no marcadas (previas de F..P incluidas; adelantos no), menos lo que el
  remanente de "Otro monto" cubre si `otherAmountCents` viene. Devuelve `{ months, cents }`.
- `selectionSummary(options, selection) → { monthsCount, rangeLabel, hasOpeningBalance }` con
  `periodListLabel` de los meses marcados (contiguos → rango). `summaryText` igual.
  `coverLabel` para el éxito: contiguos "may–jul"; sueltos "may, jul y sep" (abreviados, el año
  solo si cambia).
- Se eliminan: `tapCell`, `dragSelect`, `closePreSystem` (se reemplaza por `unmarkPreSystem(options,
  selection)` que quita las previas), `optionsForSelection` (alias), `preCellRole` pasa a
  recibir `Selection[]` (misma semántica: `'owed'` = previa de F..P sin marcar).

### F2 — `month-drag.ts` + `use-month-drag.ts`

- El efecto `arm` ya existe; el hook suma `onDragStart(anchor)` al armar (mouse: al entrar en
  otra celda; dedo: al vencer el temporizador) y sigue emitiendo `onRange(anchor, over)` en vivo.
  `MonthEntry` guarda en un `ref` la selección base y el modo al `onDragStart` y aplica
  `paintRange(options, base, anchor, over)` en cada `onRange`. Un mantener-apretado sin mover
  no cambia nada (el `click` que sigue es el toque normal: alterna).
- Nada más cambia en la máquina de estados; sus tests actuales deberían seguir verdes.

### F3 — `month-strip.tsx`

- `aria-pressed` = marcada. Celda `projected` no habilitada por `advancesAllowed`: `aria-disabled`,
  atenuada, sigue en el orden de tabulación; al tocarla (o `onTap` devuelve `blocked`) la tira
  muestra una línea `role="status"` "Para adelantar meses, primero marcá los que debe." que
  desaparece al cambiar la selección.
- Estado "cubierto" en celdas con cargo (`cellTone = 'covered'`): mismo ícono que hoy.
- Ayuda: "Tocá cada mes que pagó, o mantené apretado y arrastrá." (coarse) / "Tocá cada mes que
  pagó, o arrastrá." (fine). Desaparece "Tocá el primer y el último mes".
- Aviso de fecha de alta (prop `joinedWarning: { joinedPeriod, memberId } | null`): debajo de la
  grilla, texto de `00-architecture.md` §6.4 con un `<Link>` a `/socios/${memberId}/editar`
  (texto "Corregir fecha de alta"), `text-sm`, ícono `AlertCircle`. No bloquea.
- `OpeningTotalField`: rótulo "Total de la deuda desde <from> (N meses)" donde `from` sale de
  `openingSpan` (ya puede ser anterior al primer marcado); la pista "Pagó X meses · $Y. Queda
  debiendo Z meses · $W." igual.
- "Otro monto": celdas marcadas "cubre $A de $B" / "se cubre", y **no marcadas** que absorben el
  remanente también "se cubre" (ícono de cubierto, borde punteado), para que el operador vea
  dónde cae la plata.

### F4 — `month-entry.tsx`, `payment-form.tsx`, `group-payment-form.tsx`, `register-payment-sheet.tsx`

- `EntryState.selection: Selection` (array). `initialEntry` igual. `picked` y `fresh` desaparecen.
- `entryAllocations(options, entry, creditCents)` → `allocationsFromSelection` en modo meses;
  en "Otro monto" → `coverageForAmount(...).allocations`.
- Los formularios mandan `items: [{ memberId, amountCents, openingBalance, allocations }]`.
  Grupo: por integrante.
- Línea "Queda debiendo…" con `debtAfterPayment` (en "Otro monto" pasa el monto tipeado).
- Éxito: "Cubre may, jul y sep" / "Pago a cuenta" (sin meses con cargo marcados).
- `blocked` del botón: igual que hoy (`overrideInvalid` o derivado ≤ 0 en modo meses).
- `resultingAccountMessage` no cambia (deuda total = cargos − pagos).

### F5 — Brief

Actualizar `.impeccable/surfaces/route-caja.md`: en el párrafo del overlay, reemplazar desde
"Tocar un mes marca todo hasta ese mes desde el más viejo adeudado…" hasta "…al registrar se
crea el saldo anterior y el pago en una sola transacción." por la descripción de §7 de
`00-architecture.md` (tocar alterna, arrastrar pinta, adelantos condicionados, aviso de alta,
resumen con lista, "Otro monto" con cubre / se cubre / saldo a favor). En anti-objetivos,
reemplazar "una pantalla de imputación libre de meses (sigue prohibido elegir meses sueltos…)"
por "pagar un adelanto debiendo un mes con cargo (los adelantos son a cuenta y se marcan solo
cuando no queda nada adeudado sin marcar); mover una imputación ya registrada".

Criterios de aceptación (spec para T4, `tests/views/payments/`):
- `toggleCell` alterna; una pagada/cubierta no cambia nada; `projected` bloqueada mientras haya
  cargo adeudado sin marcar y habilitada cuando se marca el último; desmarcar un cargo desmarca
  los adelantos.
- `paintRange` marca o desmarca según el ancla, no toca celdas fuera del rango, respeta
  elegibilidad y el pliegue.
- `openingSpan`: `from` = min(primer previo marcado, primer previo con `beforeJoined = false`);
  con `joined_on` posterior a todos los marcados `from` = primer marcado y `beforeJoinedWarning =
  true`; con `joined_on` anterior a la ventana `from` = primer marcado o índice 0 según el caso.
- `effectiveOptions`: conservación (explícito fijo; Σ crédito nuevo ≤ pozo; el pozo se cuenta una
  vez); CASO DEL REVIEW de 2026-10-24 adaptado: crédito $20.000, oct pago explícito, nov y dic
  cubiertos por crédito, saldo jul–sep $30.000 marcando jul, ago, sep → el crédito se corre a
  jul–ago, sep queda pendiente $10.000, nov y dic vuelven a adelanto; marcar sep → derivado
  $10.000; `allocationsFromSelection` = `[sep $10.000]` (jul y ago quedan cubiertos por el pozo).
- `allocationsFromSelection` nunca incluye `projected`; Σ = `derivedAmountCents` cuando no hay
  adelantos marcados; con adelantos, Σ allocations + Σ adelantos = derivado.
- `coverageForAmount`: monto exacto de lo marcado → allocations = marcadas, sin remanente; menos →
  última marcada parcial; más → remanente a las no marcadas con cargo en orden, luego adelantos,
  luego `leftoverCents`; mayo+julio marcados con $25.000 → mayo y julio explícitos, $5.000 "se
  cubre" en junio (parcial).
- `debtAfterPayment` con mayo y julio marcados de mayo–noviembre: 5 meses · $50.000.
- `selectionSummary`: "3 meses · mayo, julio y septiembre 2026"; contiguos → "3 meses · mayo a
  julio 2026". `coverLabel`: "may, jul y sep".
- Render (sin jsdom, los tests de render existentes): la celda bloqueada lleva `aria-disabled`,
  el aviso de alta linkea a `/socios/<id>/editar`, la ayuda nueva reemplaza a la vieja.
- Verificación manual (lo reporta el agente en `02-development-frontend-caja.md`): iOS y Android
  reales a 390 px: scroll vertical sobre la grilla, mantener apretado y pintar, pintar al revés,
  seis toques sueltos, teclado, VoiceOver/TalkBack anuncian "marcado" y el resumen.

Contratos: `PaymentMonthOption` (con `creditCoveredCents`, `beforeJoined`),
`PaymentAllocationInput`, `periodListLabel` (T0). `MonthStrip` sigue siendo 100 % controlado.
Primitivas de `src/views/shared/` (`Button`, `states`, `form-fields`, `labels`) sin cambios.

Skills (obligatorias, con ruta): `impeccable` — leer antes de editar
`.claude/skills/impeccable/reference/craft-floor.md` y `reference/operate.md`; `frontend-design`
(`.claude/skills/frontend-design/`) para decisiones dentro del mundo ya elegido;
`web-design-guidelines` antes de cerrar; `vercel-react-best-practices`. Context7 solo si tocan una
API de react-hook-form que no esté ya en estos archivos.

Dependencias: T0 (tipos y `periodListLabel`). Corre en paralelo con T1 y T3.

Fuera de alcance: reimputar pagos, imputar saldo a favor a mano, cambiar la ventana de 12 meses,
tocar `member-period-strip.tsx` o `member-fee-statement.tsx` (siguen leyendo `statement`).

---

## T3 — Frontend: ficha del socio (`frontend-react-craftsman`, lane `frontend`)

**Posee**: `src/views/members/opening-balance-months.tsx`, `src/views/members/member-account-section.tsx`.
**No toca**: `src/views/payments/**` (T2; **importa** de `month-selection.ts` y `month-strip.tsx`
las funciones nuevas: coordinarse con T2 por el contrato de F1, no por el código), el resto.

Objetivo: "Indicar desde cuándo debía" aplica la regla de fecha de alta y muestra el aviso.

Qué hacer:
- `opening-balance-months.tsx`: la selección pasa a `Selection[]`; tocar una previa la marca
  como `F` (reemplaza la selección: acá no hay pago, solo "desde cuándo"); el tramo es
  `openingSpan` (`from = min(F, firstJoinedIndex)`, `to = P`); la tira recibe `joinedWarning`
  cuando `beforeJoinedWarning`; el texto "Tocá el primer mes que debe: se marcan todos hasta…"
  se mantiene y se le agrega "Si la fecha de alta es anterior, la deuda arranca ahí." Preselección:
  si `firstJoinedIndex ≠ -1`, la selección inicial es esa celda (la deuda desde el alta).
- `member-account-section.tsx`: sin cambios de lógica; solo si el aviso necesita el `memberId`
  (ya lo tiene) o un link que hoy no pasa.
- Escribir `02-development-frontend-ficha.md`.

Criterios de aceptación (T4, `tests/views/members/`): con `joined_on` anterior al primer tocado el
botón dice "Cargar saldo anterior de $X" con X = Σ desde el mes de alta; con `joined_on`
posterior, X = Σ desde el tocado y aparece el aviso con link a `/socios/<id>/editar`; la
preselección respeta `firstJoinedIndex`.

Skills: las mismas de T2.

Dependencias: T0; contrato F1 de T2 (firmas). Si T2 no terminó, T3 codifica contra las firmas de
F1 y el hilo principal integra.

---

## T4 — Tests (`test-engineer`, dueño único de `tests/`)

**Posee**: todo `tests/**`. **No toca** `src/**` ni `supabase/**` (un bug es un hallazgo para el
agente dueño, nunca un parche).

Corre después de T1–T3, en paralelo con `code-reviewer`. Entrega `03-tests.md` (y `03-tests-db.md`
si separa) con `SUITE GREEN` o la lista de hallazgos.

### Base (`tests/db/`, solo con Docker; cada caso en `withRollback`, datos inventados)

Nuevo `tests/db/payment-allocations.test.ts` (fixtures de `payment-months-fixtures.ts`; sumar
`callBatch` con `allocations` y un lector del libro `select * from private.member_period_ledger($1)`
como `postgres`):

1. **Meses sueltos**: cuotas may–nov ($10.000), lote con `allocations` may y jul por $20.000 →
   `payment_month_options`: may y jul `pending 0` (`credit_covered 0`), jun/ago/sep/oct/nov
   `pending 10.000`; `member_accounts`: `balance 50.000`, `months_due 5`, `oldest_due_period =
   junio`; `member_fee_statement`: may y jul `paid`, resto `due`; `debt_by_category` suma 50.000.
2. **Identidad**: para varios escenarios (sueltos, parcial, con crédito, con tramo), Σ
   `pending_cents` del libro = `greatest(0, charged − paid)` y Σ `credit_covered` ≤ pagos.
3. **Pago a cuenta** (sin `allocations`): comportamiento de hoy, del más viejo al más nuevo;
   mezcla: mayo y julio explícitos + $5.000 a cuenta → junio `pending 5.000`, `credit_covered
   5.000`.
4. **Anular el pago** apaga sus imputaciones: las filas siguen existiendo (`count` igual), el
   libro vuelve a "debe"; anular la **cuota** de un mes imputado: la imputación queda como
   sobrante y el pozo cubre el siguiente adeudado (deuda total correcta).
5. **Guard**: imputar a un mes sin cargo (projected, o previo sin saldo) → 23514 "no tiene cuota
   generada"; Σ > monto → "Lo imputado supera…"; segundo lote imputando un mes ya imputado →
   "ya está pago…"; pago anulado → "Un pago anulado no se imputa"; por PostgREST directo como
   `editor` (insert en la tabla) los mismos mensajes; `consulta` → 42501; `created_by` ajeno →
   rechazado por la policy.
6. **Inmutable / sin borrado / auditado**: UPDATE y DELETE rechazados como admin (42501) y como
   postgres (`forbid_change`); `has_table_privilege` DELETE false para `authenticated`; INSERT no
   incluye `source`; una fila INSERT en `audit_log` con `actor_id` del editor y `new_data.period`.
7. **Saldo anterior con tramo + meses sueltos**: tramo ene–oct, pago marcando ene y mar → esas
   celdas `pending 0`, feb pendiente; segundo pago abr y jun; anular el saldo y recargarlo desde
   marzo → las imputaciones de abr y jun siguen cubriendo abr y jun, la de ene queda sobrante y el
   pozo cubre mar (el mes más viejo del tramo nuevo); recargar un tramo que incluye ene → ene
   vuelve a estar paga sin cargar nada.
8. **Lote atómico**: una imputación inválida en el segundo ítem deja el lote entero sin nada
   (ni saldo ni pagos ni imputaciones). Reintento por `batch_id` no duplica imputaciones.
9. **`before_joined`**: con `joined_on` en el 5.º mes de la ventana, las 4 primeras `pre_system`
   traen `true`, el resto `false`; con `joined_on` anterior a la ventana todas `false`.
10. **Concurrencia** (dos clientes `pg`): dos lotes imputando junio del mismo socio → uno pasa, el
    otro recibe "ya está pago…"; nunca Σ explícito > cargo.
11. **Backfill**: sobre fixtures con cuotas, saldo con tramo y pagos sin imputar, correr el mismo
    SQL del backfill (copiado de la migración, como `postgres`) y comprobar que `source =
    'backfill'`, Σ por pago ≤ monto, Σ por mes = cobertura previa, y que la foto de
    `member_fee_statement` y `member_accounts` es idéntica antes y después. Además: la migración ya
    corrió sobre el seed: comprobar que **todo** pago vigente del seed tiene Σ imputado =
    `least(amount, lo que cubría)` y ninguno `source = 'marked'`.
12. **Grants**: `payment_month_options` y `register_payment_batch` solo `authenticated`;
    `member_period_charges`/`member_period_ledger` sin EXECUTE para `anon`/`public`
    (`grants-and-lockdown.test.ts` ya recorre `private`: verificar que las ve).

Actualizar: `payment-month-options.test.ts` y `opening-balance-months.test.ts` (columnas nuevas
en `MonthRow`; los casos de balance forward siguen valiendo para pagos sin imputar);
`accounts.test.ts` ("saldo de arranque cuenta como un ítem adeudado": con tramo ahora cuenta sus
meses; el caso sin tramo sigue en 1); `register-payment-batch.test.ts` (sumar un caso con
`allocations` y uno con `allocations: null`); `cash-isolation.test.ts` (debe seguir verde sin
cambios: si cambia, es un hallazgo).

### Unidad (`tests/views/payments/`, `tests/models/`, `tests/lib/`)

- `month-selection.test.ts`: reescribir contra F1 (criterios de T2). Casos nombrados arriba más:
  conservación del pozo bajo `effectiveOptions` para 20 totales distintos; `paintRange` en ambos
  sentidos y con celdas no elegibles en el medio; `advancesAllowed` con previas del tramo sin
  marcar → `false`.
- `month-drag.test.ts`: sin cambios salvo el efecto/evento nuevo de `onDragStart`.
- `payment-schema.test.ts`, `payments.model.test.ts`: `allocations` válidas/inválidas; `items`
  enviados a la RPC con `allocations`; traducción de los mensajes nuevos.
- `accounts.model.test.ts`: mapeo de las dos columnas nuevas con y sin ellas.
- `tests/lib/dates.test.ts`: `periodListLabel` (vacío, uno, contiguos, sueltos mismo año, sueltos
  con cambio de año).
- `tests/views/members/`: lo de T3. Render tests existentes (`carga-inicial.render.test.ts`,
  `payment-views.render.test.ts`): ajustar fixtures (`creditCoveredCents`, `beforeJoined`).

Skills: `supabase-postgres-best-practices` y `supabase` para los tests de base; sin Context7 salvo
API nueva de vitest (no la hay).

---

## Lo que NO entra en ningún slice

- Reimputar o "mover" un pago; imputar un saldo a favor viejo a un mes elegido; pagar un adelanto
  debiendo un mes con cargo; ampliar la ventana de 12 meses previos; importar los Excel; tocar
  `monthly_history`, `dashboard_summary`, `month_collection`, caja, el generador o pg_cron;
  cambios de permisos o roles.
