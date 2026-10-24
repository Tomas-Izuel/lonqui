# 01 — Tareas: Registrar pago por meses, con "desde cuándo"

Pipeline `2026-10-24-pago-por-meses`. Reparto por directorio, **sin un solo archivo
compartido entre agentes**. Cada agente lee primero `00-design-brief.md` y
`00-architecture.md` (§6, §8, §9, §10) y escribe su `02-development-<lane>.md` acá.

Orden: **T0 (hilo principal) → B1 ∥ F1 ∥ F2 → T1 ∥ code-reviewer**. F2 codea contra el
contrato de F1 (§F1 "Contrato de `MonthStrip`"); si el hilo principal prefiere menos riesgo,
arranca F2 cuando F1 reporte la tira terminada.

Reglas para todos: ningún agente corre `npm install`, toca `supabase/migrations/**`,
`src/models/types.ts`, `src/lib/dates.ts` ni resetea la base. Comentarios y copy en
rioplatense; identificadores en inglés. Permisos, nunca roles.

---

## T0 — Schema y contratos (hilo principal, no es un agente)

**Archivos:** `supabase/migrations/20261024120000_payment_months.sql` (nuevo),
`src/models/types.ts`, `src/lib/dates.ts`, `src/lib/supabase/database.types.ts` (generado).

1. Migración = el SQL completo de `00-architecture.md` §9 (tres funciones + grants + el
   `revoke execute on all functions in schema private from public, anon`). Leer las notas al
   pie de §9 antes de aplicar (calificación de parámetros por `use_column`).
2. `types.ts`: agregar `PaymentMonthKind`, `PaymentMonthOption`, `OpeningBalanceMonths`,
   `RegisterPaymentResult`; `PaymentFormData` suma `monthOptions: Record<number,
   PaymentMonthOption[]>` (§8, tal cual).
3. `lib/dates.ts`: `periodRangeLabel(from: string, to: string): string` → `"julio 2026"` si
   `from === to`; `"julio a septiembre 2026"` mismo año; `"noviembre 2025 a febrero 2026"` si
   cambia el año. Sin `Date` para los meses (mismo estilo que `formatPeriod`).
4. `npm run db:reset && npm run db:types && npm run typecheck` (va a fallar en
   `getPaymentFormData` hasta que B1 agregue `monthOptions`: esperado).

---

## B1 — Backend: modelos y actions

**Agente:** `senior-backend-engineer`. **Lane:** `backend`.

**Archivos propios (exclusivos):** `src/models/accounts.model.ts`, `src/models/payments.model.ts`,
`src/models/fees.model.ts`, `src/controllers/payments.actions.ts`,
`docs/pipelines/2026-10-24-pago-por-meses/02-development-backend.md`.
**No toca:** `src/views/**`, `src/app/**`, `src/models/types.ts`, `src/lib/**`, `tests/**`,
`supabase/**`, `.impeccable/**`.

**Objetivo.** Un solo camino de escritura de pagos (`register_payment_batch`), lectura de las
celdas (`payment_month_options`), y el saldo anterior por meses de la ficha.

**Qué hacer (ver §6.2–6.3 del 00):**

- `accounts.model.ts`: `getPaymentMonthOptions(memberIds: number[]): Promise<PaymentMonthOption[]>`
  — `supabase.rpc('payment_month_options', { member_ids })`, mapeo snake→camel, `[]` si no hay
  ids. `bigint` llega como `number` por PostgREST (como en `member_accounts`).
- `payments.model.ts`: `registerPaymentSchema.items[]` suma `openingBalance: z.object({
  fromPeriod, toPeriod, amountCents }).strict().nullish()` con períodos `z.iso.date()` que
  terminen en `-01`, `fromPeriod <= toPeriod`, `amountCents` entero positivo; `items` con
  `memberId` únicos (refine, mensaje "El mismo socio aparece dos veces en el lote", path
  `items`). `registerPayment(input): Promise<RegisterPaymentResult>` arma `items` jsonb
  (`member_id`, `amount_cents`, `opening_balance: { from_period, to_period, amount_cents,
  description: openingBalanceDescription(from, to) } | null`) y llama
  `supabase.rpc('register_payment_batch', {...})`. El INSERT batch por PostgREST y el
  `isBatchAlreadyRegistered` por 23505 **se eliminan**: `alreadyRegistered` sale de la fila.
  `openingBalanceFeeIds` = ids no nulos. Traducción de errores según §6.2 (reusar
  `isRawPostgresMessage`; `MIN_PAYMENT_DATE`/mensajes de fecha se mantienen idénticos:
  `tests/views/payments/payment-schema.test.ts` compara textos).
- `fees.model.ts`: `openingBalanceDescription(fromPeriod, toPeriod)` (`'Saldo anterior · ' +
  periodRangeLabel(...)`), `createOpeningBalanceFromMonthsSchema` (`memberId`, `fromPeriod`,
  `toPeriod`, `amountCents`; mismas reglas de período), `createOpeningBalanceFromMonths(input):
  Promise<Fee>` → `createOpeningBalance({ memberId, amountCents, description })`. `createOpeningBalance`
  y su schema quedan exportados (los usa esto; la UI por monto desaparece en F2).
- `payments.actions.ts`: `getPaymentFormData` agrega `monthOptions` (UNA llamada con todos
  los ids del grupo o el socio; agrupar por `memberId`). Nuevas `getPaymentMonthOptions(input:
  unknown): Promise<ActionResult<PaymentMonthOption[]>>` (schema `{ memberId }` estricto,
  `requirePermission('payments.register')`) y `createOpeningBalanceFromMonths(input):
  Promise<ActionResult<{ id: number }>>` (`payments.register`, `revalidatePath('/', 'layout')`).
  `registerPayment` mantiene firma, chequeo de grupo y verificación del comprobante;
  tipo de retorno `ActionResult<RegisterPaymentResult>`. Docblocks actualizados (hoy dicen
  "una sola sentencia insert con N filas").

**Criterios de aceptación (spec para T1):**

- `registerPayment` llama a `register_payment_batch` con `items` en snake_case y la
  descripción `"Saldo anterior · julio a septiembre 2026"` para `2026-07-01..2026-09-01`;
  sin `openingBalance` manda `opening_balance: null`.
- Schema: rechaza `fromPeriod > toPeriod`, períodos que no son día 1, `amountCents <= 0`,
  dos ítems con el mismo `memberId` (path `items`); acepta ítem sin `openingBalance`.
- Traducciones: 23505 `fees_one_opening_balance` → DomainError con "saldo anterior vigente";
  23514 con texto redactado → DomainError con ese texto; 42501 → `PermissionError`.
- `getPaymentFormData` para un grupo de 3 hace **una** llamada a `payment_month_options` y
  devuelve `monthOptions` con una clave por socio (vacía si la RPC no trajo filas).
- `getPaymentMonthOptions` y `createOpeningBalanceFromMonths` exigen `payments.register`
  (sin permiso → `ok: false`, sin tocar el modelo) y validan con Zod antes del modelo.
- Nada en `src/models/**` importa de views o controllers (lint).

**Skills obligatorias:** `supabase` (`.claude/skills/supabase/SKILL.md`),
`supabase-postgres-best-practices` (`.claude/skills/supabase-postgres-best-practices/`, antes
de leer o traducir cualquier error de la base), `vercel-react-best-practices` para las
Server Actions. Context7 si duda de la API de `supabase.rpc` con `Json`.

**Dependencias:** T0 (tipos y `database.types.ts`). **Fuera de alcance:** vistas, tests,
migraciones, cualquier cambio a `member_accounts`.

---

## F1 — Frontend: tira de meses y formularios de pago

**Agente:** `frontend-react-craftsman`. **Lane:** `frontend`.

**Archivos propios (exclusivos):** todo `src/views/payments/**` — en concreto
`month-selection.ts` (nuevo), `month-strip.tsx` (nuevo), `payment-form.tsx`,
`group-payment-form.tsx`, `register-payment-sheet.tsx`, `payment-schema.ts`; más
`.impeccable/surfaces/route-caja.md` y `docs/pipelines/2026-10-24-pago-por-meses/02-development-frontend-caja.md`.
**No toca:** `src/views/members/**`, `src/views/shared/**` (si necesita una primitiva nueva,
la reporta), `src/controllers/**`, `src/models/**`, `src/app/**`, `tests/**`.

**Objetivo.** La tira reemplaza al monto + chips como entrada principal, en el pago
individual y en el de grupo; "Otro monto" como escape; "desde cuándo" plegado; sin la
confirmación bloqueante de sobrepago.

**Lógica pura** `month-selection.ts`: implementar **exactamente** las funciones y semánticas
de `00-architecture.md` §10 (nombres, firmas y reglas). Sin React, sin fetch, sin `Date`.

**Contrato de `MonthStrip`** (`month-strip.tsx`, lo consume F2 tal cual):

```
<MonthStrip
  options={PaymentMonthOption[]}           // ordenadas como vienen de la RPC
  selection={Selection}
  onTap={(index: number) => void}
  variant="default" | "compact"            // compact: celdas más bajas, sin resumen, para la fila de grupo
  preSystem={{ open: boolean; onToggle: () => void; startPeriod: ISODate;
               overrideCents: number | null; onOverrideChange: (cents: number | null) => void } | null}
                                           // null = sin pliegue (no hay pre_system o no aplica)
  coverage={{ fullyCovered: number[]; partial: { index; cents } | null } | null}
                                           // "otro monto": qué cubre; null = modo meses
  disabled={boolean}
/>
```

- Celdas: nombre corto del mes (`shortMonth`) y año cuando cambia; ícono por estado
  (`lucide-react`, nunca solo color, reusar el criterio de `member-period-strip.tsx`:
  `Check`/`CircleDashed`/`AlertCircle`…); texto: "debe", "falta $X", "este mes", "adelanto",
  "cubierto", "antes del sistema", "Saldo anterior · $X". `sr-only` con mes, año y estado.
  4 columnas, `min-h-11`, sin scroll horizontal a 390px; `aria-pressed` en las marcadas;
  celdas con `pendingCents = 0` deshabilitadas.
- Pliegue "¿Debe meses de antes de <mes de inicio>?" (`<details>`/botón): al abrir muestra los
  `pre_system` en gris y un `AmountField` "Total del saldo anterior" con default = suma de los
  marcados (`overrideCents` null); nota "a la cuota de hoy" cuando `pricedAtToday`.
- Nota bajo la tira "Los meses de adelanto se cobran al valor de hoy" cuando alguna celda
  marcada es `projected` con `pricedAtToday`.

**Formularios:**

- `payment-form.tsx`: recibe `member`, `options: PaymentMonthOption[]`, `onDone`, `onSuccess`.
  Si `options` está vacío (facturación inactiva, socio de baja al día) → el formulario de hoy
  (monto + fecha + medio), sin chips. Con opciones: tira + resumen ("3 meses · agosto a
  octubre", monto grande, botón "Otro monto") + fecha + medio + comprobante + notas plegadas.
  "Otro monto" abre el `AmountField`; la tira refleja `coverageForAmount` en vivo y, si
  `leftoverCents > 0`, aviso en línea "Queda saldo a favor de $X"; tocar un mes vuelve al
  monto derivado. Monto derivado $0 con solo meses previos → botón deshabilitado y aviso
  "El saldo a favor ya cubre esos meses. Indicá desde cuándo debía desde la ficha". Envío:
  `registerPayment({ ..., items: [{ memberId, amountCents, openingBalance }] })`. Toast de
  éxito con "Cubre ago–oct" (o "Pago a cuenta" si fue otro monto). **Se elimina**
  `needsOverpayConfirm`. `creditCents = Math.max(0, -member.balanceCents)`.
- `group-payment-form.tsx`: por integrante tildado, `MonthStrip variant="compact"` con su
  propia `Selection` (estado por `memberId`), su pliegue si tiene `pre_system`, y "Otro
  monto" por fila; sin opciones → `AmountField` como hoy. Total del lote en vivo = suma de
  los montos por integrante (es la única suma permitida en el cliente). Ítems con
  `openingBalance` por integrante. Se elimina la confirmación de sobrepago.
- `register-payment-sheet.tsx`: pasa `monthOptions[memberId] ?? []` a los formularios;
  `PaymentSuccessMoment` recibe un subtítulo opcional ("Cubre ago–oct") vía `onSuccess(amount,
  label?)`.
- `payment-schema.ts`: sumar el espejo cliente de `openingBalance` (mismos textos que el
  servidor) solo si hace falta validar en el cliente; si no, no tocar.
- `.impeccable/surfaces/route-caja.md`: actualizar el párrafo del overlay (tira en vez de
  monto + chips; sin confirmación de sobrepago; "Otro monto") y reescribir el anti-objetivo:
  **"una pantalla de imputación libre de meses: sigue prohibido elegir meses sueltos; la tira
  muestra en orden lo que la cuenta ya hace (balance forward)"**.

**Criterios de aceptación (spec para T1):**

- `month-selection.ts` (unit, sin DOM): `defaultSelection` activo = primera elegible;
  inactivo = toda la deuda; `tapCell` extiende y acorta terminando donde se toca; celda no
  elegible no cambia nada; tocar `pre_system` corre el inicio y, si el final era adelanto, lo
  deja en el último previo; `derivedAmountCents` suma solo pendientes (parcial = lo que falta)
  y descuenta `creditCents` del saldo anterior sin bajar de 0; `openingBalanceFromSelection`
  usa el override; `coverageForAmount` con monto menor marca una parcial y con monto mayor
  deja `leftoverCents`; `selectionSummary` arma "3 meses · agosto a octubre" y, con un año
  distinto, "noviembre 2025 a febrero 2026".
- `payment-form.tsx` con `options = []` renderiza el campo de monto y envía sin
  `openingBalance`; con opciones envía el monto derivado y el `openingBalance` correcto; el
  botón nombra el monto; ningún `window.confirm`/confirmación bloqueante.
- Todo `<form>` lleva `method="post"`; targets ≥ 44px; `MonthStrip` sin scroll horizontal
  a 390px; estado de carga/vacío/error del sheet intactos.

**Skills obligatorias:** `impeccable` (`.claude/skills/impeccable/`, leer
`reference/craft-floor.md` y `reference/operate.md` antes de editar; actuar sobre lo que
reporte el hook), `web-design-guidelines` antes de cerrar, `vercel-react-best-practices`,
`frontend-design` para el tratamiento de las celdas. Context7 para `react-hook-form`
(`useFieldArray` + estado por fila) si duda.

**Dependencias:** T0 (tipos). B1 en paralelo: codear contra las firmas de §6.3 del 00.
**Fuera de alcance:** la ficha, `MemberPeriodStrip` (no se toca), tests, cualquier RPC.

---

## F2 — Frontend: "Indicar desde cuándo debía" en la ficha

**Agente:** `frontend-react-craftsman`. **Lane:** `frontend`.

**Archivos propios (exclusivos):** `src/views/members/member-account-section.tsx`,
`src/views/members/opening-balance-months.tsx` (nuevo), `.impeccable/surfaces/route-socios-id.md`,
`docs/pipelines/2026-10-24-pago-por-meses/02-development-frontend-ficha.md`.
**No toca:** `src/views/payments/**` (importa `MonthStrip` y `month-selection` por el contrato
de F1), `src/views/members/member-period-strip.tsx`, `member-detail-view.tsx`,
`src/controllers/**`, `src/models/**`, `tests/**`.

**Objetivo.** Reemplazar "Cargar saldo anterior" (por monto) por "Indicar desde cuándo debía"
(por meses) para el caso que lo tiene sentido, con la misma tira.

**Qué hacer:**

- `member-account-section.tsx`: el bloque del saldo anterior pasa a: si `openingBalance != null`
  → texto actual ("Ya tiene un saldo anterior cargado: $X"); si no, y `canRegister &&
  billing.active && billing.startPeriod != null && billing.startPeriod <= billing.currentPeriod
  && joinedOn.slice(0, 7) <= billing.startPeriod.slice(0, 7)` → botón "Indicar desde cuándo
  debía" que monta `<OpeningBalanceMonths />`; si no → nada (se elimina el formulario por
  monto y su schema local; `createOpeningBalance` deja de importarse). Necesita `joinedOn`:
  agregar la prop `joinedOn: ISODate` y pedirle al hilo principal que la pase desde
  `member-detail-view.tsx` (`member.joinedOn`) — ese archivo **no** es de F2: anotarlo en el
  dev log como integración pendiente de una línea.
- `opening-balance-months.tsx` (Client Component): al montarse llama
  `getPaymentMonthOptions({ memberId })` y se queda con las filas `kind === 'pre_system'`
  (carga / error / vacío: "No hay meses anteriores para indicar"). Renderiza `MonthStrip`
  con `preSystem` abierto (sin toggle: acá el pliegue es la pantalla), selección por
  `tapCell`, "Total del saldo anterior" editable (override), `creditCents` desde
  `account.balanceCents` para avisar "Tu saldo a favor de $X va a cubrir parte/todo" vía
  `coverageForAmount`. Botón "Cargar saldo anterior de $X" → `createOpeningBalanceFromMonths({
  memberId, fromPeriod, toPeriod, amountCents })` → toast "Saldo anterior cargado" →
  `router.refresh()`. Errores de campo bajo el control; genérico abajo. `method="post"`.
- `route-socios-id.md`: actualizar la mención a "Cargar saldo anterior".

**Criterios de aceptación (spec para T1):**

- Con `openingBalance == null`, facturación activa y `joinedOn` en o antes del mes de inicio
  → aparece "Indicar desde cuándo debía"; con `joinedOn` posterior → no aparece nada de saldo
  anterior; con `openingBalance` → el texto de "ya tiene".
- `OpeningBalanceMonths` envía `fromPeriod`/`toPeriod` = primero y último mes marcado y
  `amountCents` = override o suma; un `ok: false` con `field: 'amountCents'` cae bajo el campo.
- Sin `createOpeningBalance` (por monto) importado en `src/views/**`.

**Skills obligatorias:** `impeccable` (`reference/craft-floor.md`, `reference/operate.md`),
`web-design-guidelines`, `vercel-react-best-practices`.

**Dependencias:** T0; **F1** (contrato de `MonthStrip` y `month-selection`; si F1 todavía no
aterrizó, codear contra el contrato y declararlo en el dev log). B1 para las dos actions.

---

## T1 — Tests

**Agente:** `test-engineer`. **Lane:** `shared` (dueño único de `tests/**`).

**Archivos propios:** todo `tests/**` (nuevos: `tests/db/payment-month-options.test.ts`,
`tests/db/register-payment-batch.test.ts`, `tests/views/payments/month-selection.test.ts`;
actualizar `tests/models/payments.model.test.ts`, `tests/models/accounts.model.test.ts`,
`tests/models/fees.model.test.ts`, `tests/controllers/payments.actions.test.ts`,
`tests/lib/dates.test.ts`, `tests/views/payments/payment-schema.test.ts` si F1 agregó el
espejo) y `docs/pipelines/2026-10-24-pago-por-meses/03-tests.md`.
**No toca:** `src/**`, `supabase/**`. Un bug real se reporta al agente dueño, no se arregla acá.

**Solo contra la base real (`tests/db/`, `withRollback`, `actAs`), con fixtures inventados:**

- `payment_month_options`:
  - sin facturación activa → 0 filas; inicio futuro → 0 filas;
  - socio con cuotas de oct/nov generadas y un pago parcial de oct → filas: oct `monthly`
    parcial (`covered` > 0, `pending` = falta), nov `due`, después `projected` hasta
    actual + 6 con `priced_at_today = true`; ninguna fila antes de oct;
  - al día con saldo a favor de 1,5 cuotas → actual (si generado) `paid`; primer proyectado
    `covered = amount`, segundo parcial, resto 0;
  - valor de cuota programado para actual + 2 → ese proyectado trae el nuevo monto y
    `priced_at_today = false`;
  - dos deportes en el mismo mes → UNA fila por mes con la suma;
  - socio `inactive` con deuda → solo filas adeudadas, sin `projected`;
  - `pre_system`: con `joined_on` ≤ inicio y sin saldo anterior → 12 filas `inicio−12..inicio−1`
    a `member_fee_price_at(actual)`; con saldo anterior vigente → ninguna; con saldo anterior
    **anulado** → vuelven; con `joined_on` en el mes siguiente al inicio → ninguna;
  - saldo anterior vigente parcialmente cubierto → primera fila `opening_balance` con su
    `pending`; cubierto del todo → no aparece;
  - `consulta` → `insufficient_privilege`; `anon`/`public` sin EXECUTE (`has_function_privilege`);
    la función es INVOKER (`prosecdef = false` en `pg_proc`), ídem `register_payment_batch`.
- `register_payment_batch`:
  - editor: 2 ítems, uno con `opening_balance` → 1 fila en `fees` (`kind`, `period = inicio − 1`
    puesto por el trigger, `description` la que vino, `created_by = auth.uid()`) + 2 pagos con
    el `batch_id`; retorna `already_registered = false` y el `opening_balance_fee_id`;
  - **atómico**: tercer ítem con `amount_cents = 0` → ninguna fila en `fees` ni `payments`;
  - **idempotente**: misma llamada otra vez → mismas filas, `already_registered = true`,
    `count(fees)`/`count(payments)` sin cambios (el saldo anterior no se duplica);
  - `to_period >= inicio` → check_violation con el texto; `from > to` → check_violation;
    saldo anterior vigente previo → 23505 `fees_one_opening_balance` y nada insertado;
  - `consulta` → `insufficient_privilege` y nada insertado; `created_by` ajeno no puede
    colarse (no hay forma: no es columna del jsonb);
  - auditoría: tras el lote hay filas `INSERT` en `audit_log` para `fees` y `payments` con
    `actor_id` = el editor y `actor_source = 'session'`;
  - `paid_on` futuro → el mensaje del guard (`La fecha del pago no puede ser futura`).
- `grants-and-lockdown` existente debe seguir verde (ninguna función de `private` ejecutable
  por `public`; `member_fee_price_at` con grant a `authenticated`).

**Unit / contrato (sin base):**

- `month-selection.ts`: los casos listados en F1 "Criterios de aceptación" (fixtures de
  `PaymentMonthOption[]` a mano, incluyendo `pre_system`, parcial, `covered`, inactivo).
- `lib/dates.periodRangeLabel`: tres formas.
- `payments.model`: `registerPayment` llama `rpc('register_payment_batch', ...)` con el jsonb
  esperado y la descripción; mapea el retorno; traduce 23505/23514/42501 como en B1.
  `registerPaymentSchema`: los rechazos de B1.
- `accounts.model.getPaymentMonthOptions`: una llamada, mapeo, `[]` con ids vacíos.
- `fees.model`: `openingBalanceDescription('2026-07-01','2026-09-01') ===
  'Saldo anterior · julio a septiembre 2026'`; `createOpeningBalanceFromMonths` delega con
  esa descripción.
- `payments.actions`: `getPaymentFormData` incluye `monthOptions` agrupado, una sola llamada
  al modelo para el grupo; `getPaymentMonthOptions`/`createOpeningBalanceFromMonths` exigen
  permiso y validan.
- `payment-schema.test.ts`: si F1 agregó espejo de `openingBalance`, los textos coinciden.

**Skills:** `supabase-postgres-best-practices` para leer el SQL que prueba; `supabase`.

**Dependencias:** T0 para `tests/db/`; B1/F1/F2 para lo demás. Veredicto `SUITE GREEN` en
`03-tests.md`.

---

## Integración (hilo principal, después de B1/F1/F2)

- Pasar `joinedOn={member.joinedOn}` a `MemberAccountSection` en
  `src/views/members/member-detail-view.tsx` (una línea; F2 lo deja anotado).
- `npm run typecheck && npm run lint && npm test`; verificar a 390px el overlay individual,
  el de grupo y la ficha; probar el doble toque con el mismo `batchId`.
- Si `00-architecture.md` §4.5 (quitar el saldo anterior por monto) se confirma, al cerrar el
  pipeline sube a `CLAUDE.md` como conclusión junto con "la escritura de pagos es
  `register_payment_batch`, no un INSERT".
