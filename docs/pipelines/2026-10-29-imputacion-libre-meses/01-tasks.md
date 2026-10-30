# 01 — Tareas: imputación explícita por cuota y saldo anterior por mes

Borrador del `feature-planner` (2026-10-29, v2). Se reparte **después** de que el usuario apruebe
`00-architecture.md`. Corte por directorio, sin un solo archivo compartido entre agentes. Todo
agente de implementación corre en `sonnet`, en paralelo donde las dependencias lo permiten.

Orden: **T0 (hilo principal) → T1 ∥ T2 ∥ T3 → T4 ∥ `code-reviewer` → ensayo de release (§7.1 del
00) → merge**. Nada se commitea hasta `APPROVED` y `SUITE GREEN`; nada se mergea sin el ensayo
contra el dump de producción.

---

## T0 — Schema, contratos y docs (hilo principal, lanes `schema` + `shared`)

**Ningún agente toca esto.**

Archivos que posee:
- `supabase/migrations/20261029120000_payment_allocations.sql` (SQL de `00-architecture.md` §9).
- `src/lib/supabase/database.types.ts` (`npm run db:types`).
- `src/models/types.ts`: §10 del 00 — `PaymentAllocationSource`, `PaymentAllocation`,
  `Payment.allocations`, `PaymentMonthOption` sin `openingFrom` y con `beforeJoined`,
  `OpeningMonth` (reemplaza `OpeningBalanceMonths`), `MemberAccountDetail.openingBalances: Fee[]`
  (reemplaza `openingBalance`), `AuditedTable` + `'payment_allocations'`.
- `src/lib/dates.ts`: `periodListLabel(periods: ISODate[]): string` (§10).
- `src/views/shared/labels.ts`: etiquetas de `PaymentAllocationSource` y de la tabla
  `payment_allocations`.
- `CLAUDE.md`: §13 del 00 (tres reemplazos y un agregado).

Pasos: aplicar con `npm run db:reset`; `npm run db:types`; `npm test` para ver qué tests quedan
rojos **por diseño** y pasarle la lista a T4; si el MCP local responde, `get_advisors`. **Antes de
mergear**: §7.1 del 00 contra el dump de producción (lo corre quien tenga `SUPABASE_DB_PASSWORD`).

Criterios de aceptación (los prueba T4 contra la base):
- La migración corre entera sobre base vacía + seed y sobre el dump de producción sin disparar
  la verificación.
- `has_table_privilege('authenticated', 'public.payment_allocations', 'INSERT'|'UPDATE'|'DELETE')
  = false`; `service_role` solo SELECT; `anon` nada. `authenticated` con INSERT en `fees.period`
  y **sin** INSERT en `fees.from_period`/`to_period`.
- `payment_allocations_no_change` y `_no_truncate` rechazan UPDATE/DELETE/TRUNCATE incluso como
  `postgres` y con `session_replication_role = replica`.
- Ninguna función nueva de `private` es ejecutable por `public`, `anon`, `authenticated` ni
  `service_role` (motor y migración), salvo `split_opening_total` (authenticated, service_role).
- `fee_status` y `payment_credit` tienen `security_invoker = true`.

---

## T1 — Backend: modelos y controller de pagos (`senior-backend-engineer`, lane `backend`)

**Posee**: `src/models/payments.model.ts`, `src/models/accounts.model.ts`,
`src/models/fees.model.ts`, `src/models/audit.model.ts`, `src/controllers/payments.actions.ts`.
**No toca**: `src/models/types.ts`, `src/lib/**`, `src/views/**`, `src/app/**`, `supabase/**`,
`tests/**`, `src/models/reports.model.ts`, `src/models/members.model.ts`.

Objetivo: el lote manda meses marcados y meses de saldo anterior; la ficha crea saldos por mes y
lista los vigentes; cada pago trae qué cubrió; el formulario no abre contra un schema viejo.

Qué hacer:
1. `payments.model.ts`: `paymentItemSchema` suma `markedPeriods: z.array(periodSchema).max(60)
   .nullish()` (refine: únicos, "Los meses marcados no son válidos") y `openingMonths:
   z.array(openingMonthSchema).max(36).nullish()` (`{ period: YYYY-MM-01, amountCents: int > 0 }`;
   refine: períodos únicos, "Los meses del saldo anterior no son válidos"); desaparece
   `openingBalance`. `registerPayment` manda `marked_periods` (array de strings) y
   `opening_months` (`[{ period, amount_cents }]`) o `null`. `translateRegisterError`: los
   mensajes nuevos de la base ("Los meses marcados no son válidos", "Los meses del saldo anterior
   no son válidos", "El saldo anterior solo cubre meses anteriores a MM/YYYY y cada mes…", "La cuota
   de MM/YYYY ya está paga…", "Lo imputado supera el monto del pago", "El saldo anterior se carga
   mes por mes…") caen en `23514 && !isRawPostgresMessage` → `DomainError` con `field: 'items'`;
   verificar que `isRawPostgresMessage` no los considere crudos. 23505 en `fees_one_opening_balance`
   → "Ya hay un saldo anterior cargado para uno de esos meses". `listPaymentsForMember` y
   `getMonthPaymentsPage`: embed `payment_allocations(amount_cents, source, fee:fees(period, kind,
   voided_at))`, descartar las de cuota anulada, mapear a `Payment.allocations` ordenadas por
   período. Un pago anulado → `allocations: []`.
2. `fees.model.ts`: `createOpeningBalanceMonthsSchema = { memberId, months: OpeningMonth[] }`
   (≤ 36, únicos, día 1, enteros > 0); `createOpeningBalanceMonths` = UN insert de N filas
   `{ member_id, kind: 'opening_balance', period, amount_cents }` (sin `description`: la pone el
   guard; sin tramo). Eliminar `createOpeningBalanceFromMonths`, `openingBalanceMonthsSchema`,
   `openingBalanceDescription`, `createOpeningBalance` (ninguna vista los usa; si alguna los
   importa, es un hallazgo para T2/T3, no un motivo para conservarlos). `translateOpeningBalanceError`
   traduce el 23505 nuevo y los mensajes del guard.
3. `accounts.model.ts`: `getOpeningBalances(memberId): Promise<Fee[]>` (vigentes, `kind =
   'opening_balance'`, `voided_at is null`, orden `period asc`) reemplaza a `getOpeningBalance`
   (`maybeSingle`); `getMemberAccountDetail` devuelve `openingBalances`. `getPaymentMonthOptions`:
   fila sin `opening_from`, con `before_joined`; **gate de schema**: si alguna fila viene sin
   `before_joined` (`undefined`), tirar `DomainError('El sistema se está actualizando. Probá de
   nuevo en unos minutos')`; sin filas (socio sin tira) no es error.
4. `audit.model.ts`: `payment_allocations` en la lista de tablas auditadas y en la derivación de
   etiqueta: "imputación de $X a <cuota del mes MM/YYYY> del pago del DD/MM/YYYY" (resolver
   `fee_id` → período/kind y `payment_id` → `paid_on` en batch, como ya se hace con socios y
   categorías). Sin nombres de socio si la etiqueta no los tenía ya para `payments`.
5. `payments.actions.ts`: `createOpeningBalanceMonths(input)` reemplaza a
   `createOpeningBalanceFromMonths` (valida `requirePermission('payments.register')`, facturación
   activa y `every(period < startPeriod)` con el mismo texto de hoy; `field: 'months'`).
   `registerPayment` y `getPaymentFormData` sin cambio de firma. No agregar actions.
6. Escribir `02-development-backend.md` en la carpeta del pipeline.

Criterios de aceptación (T4 con mocks en `tests/models/` y `tests/controllers/`):
- Un ítem sin `markedPeriods`/`openingMonths` sigue siendo válido y la RPC recibe `null` en los dos.
- Períodos repetidos, día ≠ 1, más de 60 marcados, más de 36 meses de saldo, monto 0 → `invalid`
  con texto y `field: 'items'`, sin llamar a la RPC. Nunca se manda `opening_balance`.
- Un `PostgrestError` 23514 "La cuota de 05/2026 ya está paga…" → `DomainError` con ese texto.
- `getPaymentMonthOptions` mapea `before_joined`; filas sin la columna → `DomainError` "se está
  actualizando"; array vacío → `[]`.
- `getOpeningBalances` devuelve `[]`, una o varias filas en orden; `getMemberAccountDetail` ya no
  tiene `openingBalance`.
- `listPaymentsForMember`: `allocations` ordenadas, sin las de cuotas anuladas; pago anulado → `[]`.
- `createOpeningBalanceMonths` con un mes ≥ inicio → `DomainError` con el mes de inicio en el texto
  y sin insertar.

Contratos: §10 del 00. Firma de `registerPayment` y `RegisterPaymentResult` sin cambios.

Skills: `supabase` (`.claude/skills/supabase/SKILL.md`), `vercel-react-best-practices` (Server
Actions). Context7 solo si tocan una API de PostgREST embed que no esté ya en `members.model.ts`
(el patrón `categories(name, disciplines(name))` ya existe).

---

## T2 — Frontend: grilla y formularios de pago (`frontend-react-craftsman`, lane `frontend`)

**Posee**: `src/views/payments/month-selection.ts`, `month-strip.tsx`, `month-entry.tsx`,
`month-drag.ts`, `use-month-drag.ts`, `payment-form.tsx`, `group-payment-form.tsx`,
`register-payment-sheet.tsx`, `payment-schema.ts`, `month-payments-list.tsx` (solo si muestra
"Cubre…"), y el brief `.impeccable/surfaces/route-caja.md`.
**No toca**: `src/views/members/**` (T3), `src/views/shared/**`, `src/models/**`,
`src/controllers/**`, `src/lib/**`, `tests/**`, `supabase/**`.

Objetivo: la grilla pasa de rango a conjunto; el formulario manda `markedPeriods` y
`openingMonths`; adelantos solo cuando no queda nada adeudado sin marcar; aviso de fecha de alta;
"Otro monto" con la regla de la base (§6.2 del 00); gate de schema.

### F1 — `month-selection.ts` (lógica pura, sin React ni `Date`; es el spec de T4)

Índices sobre el array **completo** de opciones; "efectivas" = mismo largo y orden.

- `Selection = number[]` (marcados, ascendente, sin repetidos; vacío = `[]`). `isMarked`.
- `isSelectable(o)` = `pendingCents > 0`. `cellTone(o)`: `pending = 0` → `'paid'` (monthly /
  opening_balance) o `'covered'` (projected); `pre_system` con `pending = 0` solo en efectivas
  (crédito) → `'covered'`; parcial → `'partial'`; resto como hoy. Desaparece `isLegacyOpening`
  (toda celda `opening_balance` es un mes real).
- `isCharged(o)` = `kind ∈ {monthly, opening_balance}` ∨ (`pre_system` dentro de `[from, P]`).
  `advancesAllowed(options, selection)` = no existe celda `isCharged ∧ isSelectable ∧ !isMarked`.
- `toggleCell(options, selection, index, { preSystemOpen }) → { selection, blocked?: 'advance' }`:
  no elegible → igual; `pre_system` con pliegue cerrado → igual; `projected` sin
  `advancesAllowed` → `blocked`; si no, alterna. Desmarcar un mes con cargo con adelantos marcados
  desmarca los adelantos.
- `paintRange(options, base, anchor, over, opts) → Selection`: modo `'mark'` si `anchor ∉ base`,
  si no `'unmark'`; aplica a `[min, max]` sobre `base`; solo elegibles; `pre_system` solo con
  pliegue abierto; `projected` solo si al terminar `advancesAllowed`.
- `defaultSelection(options, status)`: activo → `[primer elegible con cargo]` (sin `pre_system`)
  o `[]`; de baja → todos los elegibles con cargo; antes del inicio → `[mes actual previo]`.
- `firstJoinedIndex(options)`: índice de la primera `pre_system` con `beforeJoined === false`
  (`-1` si no hay previas). `openingSpan(options, selection) → { from, to } | null`: `null` sin
  `pre_system` marcada; `from = min(primer previo marcado, firstJoinedIndex si ≠ -1)`; `to` =
  último índice `pre_system` (antes del inicio: el mes actual). `beforeJoinedWarning` = hay un
  previo marcado con `beforeJoined`.
- `splitOpeningTotal` (igual). `openingMonthsFromSelection(options, selection, override?) →
  OpeningMonth[]`: todas las `pre_system` de `[from, to]` con su monto (`amountCents`, o el
  reparto del total corregido); vacío sin tramo. **Incluye las no marcadas** (quedan debiendo).
- `effectiveOptions(options, selection, ctx: { openingBalanceOverrideCents?, creditCents })`: sin
  tramo → `options`. Con tramo: las previas de `[from, to]` toman su parte; el crédito
  (`creditCents`) se aplica **solo a esas previas**, del más viejo al más nuevo (`covered`,
  `pending`); nada más se mueve (por invariante, con crédito no hay cuota pendiente).
- `markedPeriodsFromSelection(options, selection) → ISODate[]`: períodos de las marcadas con cargo
  (monthly, opening_balance, pre_system dentro de `[from, to]`). Los `projected` marcados **no**
  van (adelanto = crédito).
- `derivedAmountCents(options, selection, ctx)` = Σ `pendingCents` efectivos de las marcadas
  (adelantos marcados incluidos: su precio).
- `coverageForAmount(options, selection, amountCents, ctx) → { marked: { index, cents }[], partial:
  { index, cents } | null, unmarked: { index, cents }[], advances: { index, cents }[],
  leftoverCents }` ("Otro monto", la regla de la base): marcadas con cargo en orden hasta el
  pendiente efectivo (la última puede quedar parcial); el remanente a las no marcadas con cargo en
  orden; después adelantos en orden; lo que sobra es `leftoverCents`.
- `debtAfterPayment(options, selection, ctx, otherAmountCents?)` → `{ months, cents }`: adeudado
  no marcado (previas de `[from, to]` incluidas; adelantos no) menos lo que el remanente de "Otro
  monto" cubre.
- `selectionSummary(options, selection) → { monthsCount, rangeLabel, hasOpeningMonths }` con
  `periodListLabel`; `summaryText`; `coverLabel` ("may, jul y sep"; contiguos "may–jul").
- Se eliminan: `tapCell`, `dragSelect`, `closePreSystem` (→ `unmarkPreSystem`),
  `optionsForSelection`, `openingBalanceFromSelection`, `isLegacyOpening`. `preCellRole` recibe
  `Selection[]` (misma semántica: `'owed'` = previa de `[from, to]` sin marcar).

### F2 — `month-drag.ts` + `use-month-drag.ts`

El hook suma `onDragStart(anchor)` al armar y sigue emitiendo `onRange(anchor, over)`; `MonthEntry`
guarda en un `ref` la selección base y aplica `paintRange(options, base, anchor, over)` en cada
`onRange`. Mantener apretado sin mover no cambia nada. Sus tests actuales siguen verdes.

### F3 — `month-strip.tsx`

- `aria-pressed` = marcada. `projected` no habilitada: `aria-disabled`, atenuada, en el orden de
  tabulación; al tocarla, `role="status"` "Para adelantar meses, primero marcá los que debe." que
  desaparece al cambiar la selección.
- Ayuda nueva (§11 del 00); desaparece "Tocá el primer y el último mes".
- Aviso de fecha de alta (prop `joinedWarning: { joinedPeriod, memberId } | null`): debajo de la
  grilla, `AlertCircle`, texto de §6.3, `<Link>` "Corregir fecha de alta" → `/socios/${memberId}/editar`.
- `OpeningTotalField`: "Total de la deuda desde <from> (N meses)"; pista "Pagó X meses · $Y. Queda
  debiendo Z meses · $W."
- "Otro monto": marcadas "cubre $A de $B" (parcial) / "pagado"; no marcadas que absorben el
  remanente "se cubre" (ícono de cubierto, borde punteado); adelantos "cubierto".
- Celda con cargo cubierta por crédito en efectivas (previas con crédito): mismo ícono de
  `covered`.

### F4 — `month-entry.tsx`, `payment-form.tsx`, `group-payment-form.tsx`, `register-payment-sheet.tsx`, `payment-schema.ts`

- `EntryState.selection: Selection` (array); `picked` y `fresh` desaparecen.
- Los formularios mandan `items: [{ memberId, amountCents, markedPeriods, openingMonths }]`
  (grupo: por integrante). `markedPeriods` también en "Otro monto" (la base aplica a los
  marcados primero).
- `resultingAccountMessage`: deuda total = cargos − pagos (con `Σ openingMonths` sumado a los
  cargos), como hoy.
- Éxito: "Cubre may, jul y sep" / "Pago a cuenta" / "Saldo anterior cargado · pago a cuenta".
- `openingBalanceFeeIds.length === 0` con `openingMonths` enviados → mismo aviso de hoy.
- Gate: `getPaymentFormData` con error "se está actualizando" → `ErrorState` con "Reintentar" en
  el sheet (no un toast).
- `blocked` del botón: `overrideInvalid`, derivado ≤ 0, o crédito que cubre todo lo marcado
  (manda a la ficha).

### F5 — Brief

`.impeccable/surfaces/route-caja.md`: reemplazar el párrafo del overlay (desde "Tocar un mes
marca todo hasta ese mes…" hasta "…en una sola transacción.") por la descripción de §11 del 00; en
anti-objetivos, reemplazar "una pantalla de imputación libre de meses (…)" por "pagar un adelanto
debiendo un mes con cuota (la base lo mandaría al adeudado más viejo; la grilla no promete otra
cosa); mover una imputación ya registrada".

Criterios de aceptación (spec para T4, `tests/views/payments/`):
- `toggleCell` alterna; pagada/cubierta no cambia; `projected` bloqueada mientras haya cargo
  adeudado sin marcar y habilitada al marcar el último; desmarcar un cargo desmarca adelantos.
- `paintRange` marca o desmarca según el ancla, no toca fuera del rango, respeta elegibilidad y
  pliegue.
- `openingSpan`: `from` = min(primer previo marcado, primer previo con `beforeJoined = false`);
  alta posterior a todos los marcados → `from` = primer marcado y `beforeJoinedWarning = true`.
- `openingMonthsFromSelection`: incluye las no marcadas de `[from, to]`; con total corregido,
  Σ = total y las n−1 primeras iguales; sin previos marcados → `[]`.
- `effectiveOptions`: crédito $20.000 y previas jul–sep marcando jul..sep → jul y ago cubiertas
  por crédito, sep pendiente; derivado = $10.000; `markedPeriodsFromSelection` = `[jul, ago, sep]`
  (la base saltea los pagos); nada fuera del tramo cambia.
- `markedPeriodsFromSelection` nunca incluye `projected`; Σ pendientes de los marcados con cargo
  + Σ adelantos marcados = derivado.
- `coverageForAmount`: monto exacto → marcados completos, sin remanente; menos → último marcado
  parcial; más → no marcados adeudados en orden, después adelantos, después `leftoverCents`;
  mayo+julio marcados con $25.000 debiendo may–nov → mayo y julio completos, junio "se cubre"
  $5.000.
- `debtAfterPayment` con mayo y julio marcados de mayo–noviembre: 5 meses · $50.000.
- `selectionSummary`: "3 meses · mayo, julio y septiembre 2026"; contiguos "3 meses · mayo a julio
  2026". `coverLabel`: "may, jul y sep".
- Render (sin jsdom, los render tests existentes): celda bloqueada con `aria-disabled`; aviso de
  alta con link a `/socios/<id>/editar`; ayuda nueva; `ErrorState` del gate.
- Verificación manual (en `02-development-frontend-caja.md`): iOS y Android reales a 390 px.

Contratos: `PaymentMonthOption` (sin `openingFrom`, con `beforeJoined`), `OpeningMonth`,
`periodListLabel`, etiquetas de `labels.ts` (T0). `MonthStrip` sigue 100 % controlado. Primitivas
de `src/views/shared/` sin cambios.

Skills (obligatorias, con ruta): `impeccable` — antes de editar,
`.claude/skills/impeccable/reference/craft-floor.md` y `reference/operate.md`; `frontend-design`
(`.claude/skills/frontend-design/`); `web-design-guidelines` antes de cerrar;
`vercel-react-best-practices`. Context7 solo si tocan una API de react-hook-form que no esté ya.

Dependencias: T0. Corre en paralelo con T1 y T3.

Fuera de alcance: reimputar pagos; imputar saldo a favor a mano; ventana de 12 meses; tocar
`src/views/members/**`.

---

## T3 — Frontend: ficha del socio y auditoría (`frontend-react-craftsman`, lane `frontend`)

**Posee**: `src/views/members/opening-balance-months.tsx`, `member-account-section.tsx`,
`member-fee-statement.tsx`, `member-payments-list.tsx`, `member-detail-view.tsx`,
`member-account-answer.tsx`, `src/views/audit/audit-labels.ts`, `.impeccable/surfaces/route-socios-id.md`.
**No toca**: `src/views/payments/**` (T2; **importa** de `month-selection.ts` y `month-strip.tsx`
las funciones de F1 — coordinarse por el contrato, no por el código), el resto.

Objetivo: la ficha muestra el saldo anterior por mes, deja cargarlo y ampliarlo, muestra qué
cubrió cada pago, y la auditoría habla de imputaciones.

Qué hacer:
- `member-account-section.tsx`: con `openingBalances.length > 0`: bloque "Saldo anterior · <rango
  con periodListLabel> · $Σ · N meses pagos" (pagos desde `statement`); botón "Agregar meses
  anteriores" si la RPC devuelve celdas `pre_system` (se sabe al abrir: el componente pide las
  celdas y, si no hay, muestra "No quedan meses anteriores para agregar"). Sin filas: "Indicar desde
  cuándo debía", como hoy. Desaparece "Ya tiene un saldo anterior cargado: $X".
- `opening-balance-months.tsx`: `Selection[]`; tocar una previa fija `from = min(tocada,
  firstJoinedIndex)`; tramo hasta `P`; total editable; aviso de fecha de alta con link; llama a
  `createOpeningBalanceMonths({ memberId, months: openingMonthsFromSelection(...) })`; botón
  "Cargar saldo anterior de $X (N meses)". Preselección: `firstJoinedIndex` si ≠ -1. Texto: "Tocá
  el primer mes que debe: se marcan todos hasta <P>. Si la fecha de alta es anterior, la deuda
  arranca ahí."
- `member-fee-statement.tsx`: "Saldo anterior · <mes>" (sin "hasta"); "Anular" por fila (admin).
- `member-payments-list.tsx`: por pago "Cubre may y jul 2026" (`periodListLabel` de
  `allocations`, abreviado si son más de 3: "Cubre 5 meses · ene a may 2026") y, si `amountCents −
  Σ allocations > 0`, "Saldo a favor $X"; anulado: tachado, sin detalle.
- `member-account-answer.tsx`: "Debe desde <mes> · N meses" ya sale de `oldestDuePeriod` /
  `monthsDue`; verificar que el texto no asuma contigüidad ("N meses" y no "<mes> a <mes>").
- `audit-labels.ts`: `payment_allocations` → filtro "Imputaciones", artículo "una imputación",
  verbo para INSERT ("registró la imputación …"); UPDATE/DELETE no existen.
- `route-socios-id.md`: párrafo del saldo anterior por mes y de "Cubre…".
- Escribir `02-development-frontend-ficha.md`.

Criterios de aceptación (T4, `tests/views/members/` render tests existentes +
`tests/views/audit/`): con `joined_on` anterior al primer tocado el botón dice "Cargar saldo
anterior de $X (N meses)" con X = Σ desde el mes de alta; con `joined_on` posterior, X = Σ desde el
tocado y aparece el aviso con link; la preselección respeta `firstJoinedIndex`; la lista de pagos
muestra "Cubre…" y "Saldo a favor…"; la etiqueta de auditoría de `payment_allocations` se arma
sin nombres de socio.

Skills: las mismas de T2.

Dependencias: T0; contrato F1 de T2 (firmas). Si T2 no terminó, T3 codifica contra las firmas de
F1 y el hilo principal integra.

---

## T4 — Tests (`test-engineer`, dueño único de `tests/`)

**Posee**: todo `tests/**`. **No toca** `src/**` ni `supabase/**` (un bug es un hallazgo para el
agente dueño, nunca un parche).

Corre después de T1–T3, en paralelo con `code-reviewer`. Entrega `03-tests.md` con `SUITE GREEN` o
la lista de hallazgos. `tests/db/` corre en un solo fork (vitest `singleFork`): un `alter table …
disable trigger` dentro de `withRollback` no compite con otro archivo.

### Base (`tests/db/`, solo con Docker; cada caso en `withRollback`, datos inventados)

**Fixtures** (`payment-months-fixtures.ts`): `insertOpeningBalanceFee` pasa a recibir `period`
(ya no se puede confiar en que el guard lo pise; para "el viejo sin tramo" mandar `null`/omitir la
columna); nuevo `insertOpeningMonths(client, memberId, [{ period, amountCents }])`;
`insertLegacySpan(client, memberId, from, to, amountCents)` (solo para el test de migración:
`alter table public.fees disable trigger fees_opening_balance_guard`, inserta la fila con tramo y
`period = inicio − 1`, re-enable); `monthOptions` sin `opening_from`, con `before_joined`;
`callBatch` con `marked_periods` / `opening_months` / `opening_balance` (forma vieja); lectores
`feeStatus(client, memberId)` y `paymentCredit(client, memberId)` sobre las vistas como `postgres`;
`allocations(client, paymentId)`.

Nuevo `tests/db/payment-allocations.test.ts`:

1. **Meses sueltos**: cuotas may–nov ($10.000), lote con `marked_periods` may y jul por $20.000 →
   `fee_status`: may y jul `paid`, resto `due`; `allocations` del pago: dos filas `marked`;
   `member_accounts`: `balance 50.000`, `months_due 5`, `oldest_due_period = jun`;
   `payment_month_options`: may y jul `pending 0`, jun..nov `pending 10.000`; `debt_by_category`
   suma 50.000; `member_fee_statement` may y jul `paid`.
2. **Monto que no alcanza**: marcados may, jun, jul con $25.000 → may y jun `paid`, jul `partial`
   (5.000), `allocations` = 3 `marked`; nada `oldest_first`.
3. **Otro monto mayor a lo marcado**: marcado jul con $25.000 debiendo may–nov → jul `marked`
   10.000; may `oldest_first` 10.000; jun `oldest_first` 5.000 (parcial); crédito 0.
4. **Sin marcados** (`marked_periods: null` y payload viejo sin claves nuevas): todo
   `oldest_first` del más viejo; igual que el comportamiento de hoy (`accounts.test.ts`).
5. **Adelanto = crédito**: todo pago y $10.000 de más → ninguna imputación extra;
   `payment_credit.credit_cents = 10.000`; `member_accounts.balance = −10.000`;
   `payment_month_options` proyectado más cercano `covered 10.000`.
6. **Generador imputa crédito**: con crédito 10.000, `private.generate_monthly_fees(mes actual)`
   crea la cuota y aparece una imputación `credit` del pago más viejo con crédito; `fee_status`
   `paid`; crédito 0. Dos deportes: la social/el primer deporte primero en orden estable.
7. **Anular una cuota con imputaciones**: pago X marcado a ago (10.000) y `oldest_first` a jun
   (parcial 5.000); admin anula ago → aparece una imputación `credit` (X, jun) por 5.000 → jun
   `paid`; las filas viejas siguen (count no baja); **(X, jun) tiene dos filas** (sin único);
   `audit_log` con `actor_id` = el admin y `new_data.source = 'credit'`.
8. **Anular un pago**: sus imputaciones quedan (count igual), `fee_status` vuelve a `due`/`partial`,
   `payment_credit` no lo lista; un pago posterior cubre esas cuotas de nuevo.
9. **Invariante "nunca conviven"**: después de cada caso de 1–8 y de 11–13: no existe socio con
   Σ `pending > 0` y Σ `credit > 0`. Y Σ `pending` − Σ `credit` = `member_balance.balance_cents`.
10. **Guard**: imputar (como `postgres`, insert directo) a una cuota anulada / un pago anulado /
    de otro socio → 23514 con el texto; Σ por cuota > monto → "ya está paga…"; Σ por pago >
    monto → "Lo imputado supera…"; **dos filas en el mismo INSERT que juntas superan el monto
    de la cuota → rechazado** (el guard ve la primera).
11. **Mes marcado ya pago se saltea**: marcar may (ya paga) y jul con $10.000 → jul `marked`;
    ningún error.
12. **Saldo anterior por mes en el lote**: `opening_months` mar..jun + `marked_periods` mar y may
    por $20.000 → 4 filas `opening_balance` (period real, `from_period` null, descripción por
    defecto "Saldo anterior · MM/YYYY"), mar y may `paid`, abr y jun `due`; `opening_balance_fee_id`
    = la primera; reintento por `batch_id` devuelve la misma. Crédito previo 10.000 + mismo lote
    → el crédito cubre mar (`credit`, del pago viejo), el pago marcado a mar se saltea y va a may y
    después a abr (`oldest_first`).
13. **Payload viejo** (`opening_balance: {from, to, amount}`): se expande a N filas con
    `split_opening_total`; paridad con `splitOpeningTotal` (TS) para varios `(total, n)`; el pago
    cubre del más viejo. Mezclar `opening_balance` y `opening_months` → gana `opening_months`.
14. **Ficha**: insert directo de N filas como editor (grant de `period`) → ok; con `from_period`
    → 42501; mes ≥ inicio → "solo cubre meses anteriores a MM/YYYY"; más de 36 meses atrás →
    rechazado; mismo mes dos veces → 23505 `fees_one_opening_balance`; agregar meses más atrás
    después → ok y `payment_month_options` deja de ofrecer esos `pre_system`.
15. **`before_joined`**: `joined_on` en el 5.º mes de la ventana → 4 `pre_system` con `true`;
    anterior a la ventana → todas `false`; `pre_system` solo para meses sin fila de saldo.
16. **Inmutable / sin borrado / auditado**: UPDATE, DELETE y TRUNCATE rechazados como admin
    (42501) y como `postgres` (`forbid_change`, también con `session_replication_role = replica`);
    `has_table_privilege` INSERT/UPDATE/DELETE false para `authenticated`; `service_role` solo
    SELECT; INSERT en `audit_log` con `actor_id` del editor para cada imputación del lote.
17. **Grants y lockdown**: `apply_credit`, `allocate_marked`, el guard, los triggers y las cuatro
    funciones de migración sin EXECUTE para `public`, `anon`, `authenticated`, `service_role`;
    `split_opening_total` sí para `authenticated`; vistas con `security_invoker`; `consulta` lee
    `fee_status`/`payment_credit` (0 filas sin `payments.read`); `anon` nada.
18. **Concurrencia** (dos clientes `pg`): dos lotes marcando jun del mismo socio → los dos
    registran, jun queda `paid` una vez, el segundo pago va `oldest_first` a otro mes; nunca Σ
    por cuota > monto.

Nuevo `tests/db/payment-allocations-migration.test.ts` (como `postgres`, en `withRollback`): arma
un escenario **con la forma vieja** y corre las mismas funciones que la migración:
`private.allocation_migration_snapshot()` → `migrate_opening_spans()` → `backfill_allocations()`
→ `allocation_migration_verify()`. Para que el motor no actúe sobre las fixtures, desactivar
`payments_allocate_on_insert`, `fees_apply_credit_on_insert` y `fees_apply_credit_on_void`
(`alter table … disable trigger`) mientras se insertan, y volver a activarlos antes de verificar.
Escenario mínimo (socios distintos, datos inventados):
- A: tramo ene–oct $100.000 (resto no divisible), pagos $30.000 y $45.000 → después: 10 filas por
  mes (`created_by`/`created_at` de la fila original; la fila vieja anulada con el motivo fijo y
  `voided_by = 00000000-…`), imputaciones `backfill` que dejan ene..jul `paid`, ago `partial`
  (5.000), sep y oct `due`; Σ montos nuevos = 100.000.
- B: saldo viejo sin tramo $20.000 + cuota del mes, pago $25.000 → la fila sin tramo **no cambia**
  (mismo id, vigente), saldo `paid`, cuota `partial`.
- C: pago parcial de la única cuota → `partial`; D: saldo a favor (pago > cargos) → crédito, cero
  imputaciones de más; E: pago anulado → sin imputaciones; F: cuota anulada → sin imputaciones a
  ella y el pago cubre la siguiente; G: dos deportes en un mes (social no) + pago de una cuota y
  media → la del `discipline_id` menor `paid`, la otra `partial`; H: grupo familiar de dos socios
  con un `batch_id`, uno con tramo y otro sin → cada uno con lo suyo.
- Asserts: `verify()` no tira; `member_balance` idéntica antes/después para todos; Σ imputado +
  Σ crédito = Σ pagos vigentes; ninguna imputación a anulados; auditoría: una fila UPDATE por
  tramo anulado y una INSERT por mes nuevo, `actor_source = 'system'`; **idempotencia**: correr
  `migrate_opening_spans()` y `backfill_allocations()` de nuevo devuelve 0 y no cambia nada;
  **la verificación aborta** si se altera a mano una imputación entre backfill y verify (insertar
  una fila extra como `postgres` con el guard desactivado → `raise exception` con el id del socio).

Actualizar: `opening-balance-months.test.ts` (reescribir contra "una fila por mes": índice
`(member_id, period)`, sin tramo, grant de `period`, sin grant de tramo, CHECKs del tramo siguen
para filas viejas), `payment-month-options*.test.ts` (sin `opening_from`, con `before_joined`;
`pre_system` por mes sin fila; los casos de balance forward siguen para pagos sin marcar),
`accounts.test.ts` ("saldo de arranque cuenta como un ítem": el sin tramo sigue 1; con meses
cuenta sus meses), `register-payment-batch.test.ts` (forma nueva + forma vieja expandida; "un
solo saldo vigente" pasa a "un solo saldo vigente por mes"), `member-joined-on.test.ts` (un saldo
anterior posterior al alta nueva no bloquea), `grants-and-lockdown.test.ts` (tabla y funciones
nuevas; `fees.period` con INSERT; `from_period`/`to_period` sin INSERT), `cash-isolation.test.ts`
(debe seguir verde sin cambios: si cambia, es un hallazgo), `billing.test.ts` (el generador deja
imputaciones `credit` cuando hay crédito; sin crédito, ninguna).

### Unidad (`tests/views/payments/`, `tests/views/members/`, `tests/models/`, `tests/lib/`)

- `month-selection.test.ts`: reescribir contra F1 (criterios de T2) más: conservación bajo
  `effectiveOptions` para 20 totales distintos; `paintRange` en ambos sentidos con no elegibles en
  el medio; `advancesAllowed` con previas del tramo sin marcar → `false`;
  `openingMonthsFromSelection` incluye no marcadas.
- `month-drag.test.ts`: solo `onDragStart`.
- `payment-schema.test.ts`, `payments.model.test.ts`: `markedPeriods`/`openingMonths` válidos e
  inválidos; `items` enviados a la RPC; nunca `opening_balance`; traducción de mensajes nuevos;
  `allocations` del embed (descarta cuotas anuladas).
- `accounts.model.test.ts`: `before_joined`; gate "se está actualizando"; `getOpeningBalances`.
- `fees.model.test.ts`: `createOpeningBalanceMonths` (N filas, sin `description`, 23505 nuevo).
- `audit.model.test.ts`: etiqueta de `payment_allocations`.
- `tests/lib/dates.test.ts`: `periodListLabel` (vacío, uno, contiguos, sueltos mismo año, cambio
  de año).
- `tests/views/members/`: lo de T3; render tests existentes con fixtures nuevas (`beforeJoined`,
  `openingBalances`, `allocations`).

Skills: `supabase-postgres-best-practices` y `supabase` para los tests de base; sin Context7
salvo API nueva de vitest (no la hay).

---

## Lo que NO entra en ningún slice

- Reimputar o "mover" un pago; imputar un saldo a favor a mano; anular N meses de saldo de una
  vez; ampliar la ventana de 12 meses previos; importar los Excel; tocar `monthly_history`,
  `dashboard_summary`, `month_collection`, caja, el generador o pg_cron; cambios de permisos o
  roles; una RPC para anular cuotas.
