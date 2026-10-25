# 01 — Tareas: carga inicial por meses

Plan: `00-architecture.md` (manda). Este plan es una propuesta: no se reparte nada hasta que el usuario
lo apruebe. Ningún agente toca `supabase/migrations/`, resetea la base ni corre `npm install`.

Orden: T1 (hilo principal) fija contratos y migración → T2 y T3 en paralelo → T4 en paralelo con
T2/T3 apenas existan T1 y los contratos de §Contratos (los tests de DB necesitan la migración
aplicada en el stack local).

## Contratos que fija el hilo principal antes de repartir (T1)

- `PaymentMonthOption.openingFrom: ISODate | null` en `src/models/types.ts` (comentario: NULL en una
  celda `opening_balance` = saldo viejo sin tramo; `period` en una celda con tramo es el mes real).
- RPC `payment_month_options`: columna nueva `opening_from date` (§5.4 de la arquitectura).
- `EntryState` (lo implementa T3): `{ selection, preOpen, overrideCents, overrideInvalid, custom,
  expanded: boolean, picked: boolean }`; `initialEntry(options, status, { expanded: boolean })`.
- `MonthStrip` props nuevas: `onRange?: (anchor: number, over: number) => void` (arrastre en vivo),
  `preMode`/`fresh` los resuelve `MonthEntry`, no la tira.
- Props nuevas de formularios: `billingStarted: boolean` en `PaymentForm` y `GroupPaymentForm`
  (lo calcula `register-payment-sheet.tsx` desde `billing`).

---

## T1 — Migración, tipos generados y contrato  [lane: schema, HILO PRINCIPAL]

**Archivos propios:** `supabase/migrations/20261024170000_opening_balance_months.sql`,
`src/lib/supabase/database.types.ts` (regenerar con `npm run db:types`), `src/models/types.ts`
(solo `PaymentMonthOption.openingFrom` y su comentario).
**No toca:** nada de `src/views/`, `src/controllers/`, `tests/`.

**Contenido de la migración** (skill: `.claude/skills/supabase-postgres-best-practices/SKILL.md`,
`references/security-privileges.md`, `references/schema-constraints.md`; y `.claude/skills/supabase/`):

1. `alter table public.fees add column from_period date, add column to_period date;`
2. CHECKs (boceto): 
   `fees_opening_span_shape`: `(from_period is null) = (to_period is null)`;
   `fees_opening_span_kind`: `from_period is null or kind = 'opening_balance'`;
   `fees_opening_span_order`: `from_period is null or (from_period <= to_period and to_period <= period)`;
   `fees_opening_span_month_start`: ambas `= date_trunc('month', x)::date`;
   `fees_opening_span_max`: `to_period <= (from_period + interval '35 months')::date`.
   Filas existentes: todas NULL, valida instantáneo.
3. `drop trigger fees_immutable` + `create trigger fees_immutable ... private.protect_immutable_columns(`
   la lista actual `+ 'from_period', 'to_period')`.
4. `grant insert (from_period, to_period) on public.fees to authenticated;` (sin update).
5. `create or replace function private.fees_opening_balance_guard()`: mismo cuerpo +, para
   `kind = 'opening_balance'` con tramo: mensajes amigables (`check_violation`) "Los meses del saldo
   anterior no son válidos" y "El saldo anterior solo cubre meses anteriores a MM/YYYY". `period` sigue
   siendo `inicio − 1`. Sigue SECURITY DEFINER, `search_path = ''`.
6. `create or replace function public.register_payment_batch(...)`: copia EXACTA de la vigente
   (`20261024120000_payment_months.sql`) cambiando solo el insert de `fees` para incluir
   `from_period, to_period` (`from_p`, `to_p`). Mismo `revoke`/`grant` (create or replace los conserva).
7. `drop function public.payment_month_options(bigint[])` + `create function` con la columna de salida
   `opening_from date` al final y el cuerpo vigente (`20261024150000_payment_months_before_start.sql`)
   más: CTE `opening_span` (de `member_fee_coverage` ⨝ `public.fees` por `fee_id`, con
   `from_period is not null`, sin anuladas), `opening_cells` (`generate_series(from_period, to_period,
   '1 month')`, monto `total / n`, el último mes `total − (n−1) × (total / n)`, `covered` repartido en
   orden con `least(monto, cubierto − acumulado previo)`), `charged` sin los saldos con tramo,
   `first_due` sobre la unión, y el filtro de `billed` (celdas del saldo siempre visibles si
   `current_period < start_period`; si no, `period >= first_due`). Misma firma de entrada,
   `security invoker`, `stable`, `perform private.require_permission('payments.register')`.
   Re-otorgar: `revoke execute ... from public, anon; grant execute ... to authenticated`.
8. Cierre de siempre: `revoke execute on all functions in schema private from public, anon;` y los
   grants de las funciones de `private` que las policies/RPC INVOKER necesitan.
9. Cabecera con la reversa (§10.7 de la arquitectura) y el orden de despliegue (migración primero).

**Verificación del hilo principal:** `npm run db:reset`; probar a mano en transacción revertida:
(a) pago ene–mar con inicio 2026-11 → saldo ene..oct, pago 3 meses; (b) segundo `payment_month_options`
devuelve ene..oct reales, ene–mar pagas, abr..oct adeudadas; (c) fila vieja sin tramo → celda única con
`opening_from` NULL; (d) `service_role` y `authenticated` con los grants esperados. Antes de mergear:
consulta de solo lectura en prod con el conteo de saldos anteriores vigentes (pregunta 1 del plan).

---

## T2 — Modelos  [lane: backend, `senior-backend-engineer`]

**Archivos propios:** `src/models/accounts.model.ts`, `src/models/fees.model.ts`.
**No toca:** `src/models/types.ts` (contrato, T1), `src/models/payments.model.ts`,
`src/controllers/**`, `src/views/**`, `tests/**`, migraciones.
**Dependencias:** T1 (tipos regenerados con `opening_from` y las columnas nuevas).
**Skills:** `supabase` (`.claude/skills/supabase/`), `supabase-postgres-best-practices`; Context7 antes
de tocar la API de supabase-js/Zod v4.

**Meta y aceptación:**
- `getPaymentMonthOptions` mapea `opening_from` → `openingFrom` (`null` si la columna es null o falta,
  por si el cliente corre contra una RPC vieja unos minutos). Sin otros cambios de forma.
- `createOpeningBalanceFromMonths` (ficha) inserta `from_period` y `to_period` con
  `fromPeriod`/`toPeriod` del input, además de monto y descripción. `createOpeningBalance` (por
  monto, sin meses) sigue insertando sin tramo (fila legacy: es el caso "solo monto" y debe seguir
  andando).
- El mapeo de errores (`translateOpeningBalanceError`) cubre los mensajes nuevos de los CHECK/guard:
  los que ya vienen redactados en español pasan tal cual como `DomainError`; un `23514` crudo
  (CHECK sin mensaje amigable) se traduce a "Los meses del saldo anterior no son válidos". Nunca
  `err.message` crudo.
- Sin controllers nuevos; `payments.actions.ts` ya pasa `fromPeriod`/`toPeriod`.
- Sin PII en logs.

**Contratos a respetar:** `PaymentMonthOption` (con `openingFrom`), `OpeningBalanceMonths`,
`CreateOpeningBalanceFromMonthsInput`.
**Fuera de alcance:** cambiar `registerPayment` (el JSON ya lleva las fechas), backfill, importador.

---

## T3 — Vistas: selección, arrastre, grilla colapsable  [lane: frontend, `frontend-react-craftsman`]

**Archivos propios (todos):**
`src/views/payments/month-selection.ts`, `src/views/payments/month-drag.ts` (nuevo),
`src/views/payments/use-month-drag.ts` (nuevo), `src/views/payments/month-strip.tsx`,
`src/views/payments/month-entry.tsx`, `src/views/payments/payment-form.tsx`,
`src/views/payments/group-payment-form.tsx`, `src/views/payments/register-payment-sheet.tsx`,
`src/views/members/opening-balance-months.tsx`.
**No toca:** `src/models/**`, `src/controllers/**`, `tests/**`, migraciones, `src/views/shared/**`
(si hace falta un primitivo nuevo, lo reporta), `src/views/members/member-account-section.tsx`
(salvo que cambie una prop; en ese caso lo reporta).
**Dependencias:** T1 (tipo `openingFrom`). Los contratos de §Contratos y de §7.1 de la arquitectura.
Se puede hacer en dos pasos secuenciales dentro del mismo agente (A: lógica pura + tira; B: formularios),
sin partir archivos entre agentes.
**Skills (obligatorias, con ruta):** `impeccable` — leer `.claude/skills/impeccable/reference/craft-floor.md`
y `reference/operate.md` antes de editar; `vercel-react-best-practices`
(`.claude/skills/vercel-react-best-practices/`); `web-design-guidelines` antes de cerrar;
`frontend-design`; Context7 para APIs de React 19 / Pointer Events. Comentarios en español rioplatense.

**Meta y aceptación (spec del `test-engineer`; la lógica pura se prueba en Node):**

*Lógica pura (`month-selection.ts`, §7.1):*
- `splitOpeningTotal(T, n)`: suma exacta T; n−1 partes iguales a `floor(T/n)`; el último absorbe el resto;
  n = 1 devuelve `[T]`.
- `openingSpan`: null sin selección o si arranca en celda del sistema; con previas, `from` = inicio de la
  selección y `to` = última celda `pre_system`, aunque la selección termine antes.
- `openingBalanceFromSelection`: ene–jun marcados con previas ene..oct → `fromPeriod` enero, `toPeriod`
  octubre, monto = Σ de 10 meses (o el override).
- `derivedAmountCents`: ene–jun de 10 previas a $10.000 → $60.000; con saldo a favor de $20.000 → $40.000;
  con override de $85.000 sobre 10 meses → 6 partes del reparto; selección que llega hasta P ≡ comportamiento
  anterior (`max(0, saldo − pozo) + sistema`).
- `debtAfterPayment`: ene–jun de 10 → `{ months: 4, cents: 40_000_00 }`; adelantos no cuentan; marcar hasta P → 0.
- `tapCell` `'free'`: `fresh` reemplaza el valor por defecto; tocar-tocar da rango; tocar un marcado
  intermedio lo vuelve final; tocar el final achica; único marcado → `null`; `'to_end'` (default) idéntico al
  de hoy (la ficha no cambia); celdas del sistema sin cambios (incluida la conservación del inicio previo).
- `dragSelect`: hacia adelante y hacia atrás da el mismo rango; recorta no elegibles; ancla en el sistema se
  corre a la primera celda del sistema elegible; `null` si no hay elegibles.
- `cellTone`/`selectionSummary`/`coverLabel`: celda `opening_balance` con `openingFrom` cuenta como mes y se
  pinta como `monthly`; la legacy conserva "Saldo anterior · $X" y no cuenta como mes.
- `coverageForAmount` con span: recorre desde F; pre anteriores a F no entran.
- `extendToDueMonths` eliminado; ningún import queda colgado.
- `month-drag.ts` (máquina pura): mouse arma al entrar a otra celda; touch arma solo tras `armed`; movimiento
  > tolerancia antes de armar = descarta (scroll); `up` sin arrastre = tap; `cancel` cierra el estado.

*UI (§7.2–§7.5):*
- Pago individual antes del inicio: grilla expandida por defecto; después del inicio y en grupo: colapsada
  con `summaryText` + botón "Cambiar" (`aria-expanded`, `aria-controls`, ≥ 44 px). "Otro monto" abre la grilla.
- Arrastre con mouse y dedo (mantener apretado ~250 ms en touch); scroll vertical normal antes de armar;
  el `click` posterior a un arrastre se descarta; selección y total del pie siguen en vivo; resumen
  `role="status"`.
- Celdas previas dentro de F..P sin marcar muestran ícono + "queda debiendo"; línea "Queda debiendo N meses ·
  $X" cuando corresponde; `OpeningTotalField` rotulado con su alcance y la pista de pagó/queda debiendo.
- Avisos de saldo existente con y sin `openingFrom` (§7.4), solo con la grilla abierta.
- Ficha: sin arrastre, `preMode: 'to_end'`, mismo comportamiento que hoy.
- Formularios: `method="POST"` intactos; el resultado de `entryOpeningBalance` sigue siendo
  `{ fromPeriod, toPeriod, amountCents }`; el cuerpo enviado a `registerPayment` no cambia de forma.
- 390 px: sin scroll horizontal, targets ≥ 44 px, foco visible, contraste AA, sin emoji ni glifos como
  íconos (`lucide-react`), numerales tabulares en montos.

**Contratos a respetar:** `PaymentMonthOption`, `OpeningBalanceMonths`, `Selection` (rango contiguo),
`CoverageResult`, props de `MonthStrip`/`MonthEntry` listadas arriba. Sin fetch en vistas; las Server
Actions se importan desde `*.actions.ts`.
**Fuera de alcance:** auto-scroll al arrastrar, editar un saldo existente, ampliar la ventana previa,
modal de confirmación, cambios en el panel/reportes.
**Entrega:** `02-development-frontend.md` con lo hecho y la lista de la verificación manual (§11).

---

## T4 — Tests  [lane: test-engineer, dueño único de `tests/`]

**Archivos propios:** `tests/db/opening-balance-months.test.ts` (nuevo),
`tests/db/payment-month-options.test.ts`, `tests/db/payment-month-options-before-start.test.ts`,
`tests/db/register-payment-batch.test.ts`, `tests/db/payment-months-fixtures.ts`,
`tests/db/grants-and-lockdown.test.ts` (solo si hace falta cubrir el grant nuevo),
`tests/views/payments/month-selection.test.ts`, `tests/views/payments/month-drag.test.ts` (nuevo),
`tests/views/payments/payment-views.render.test.ts`, `tests/models/accounts.model.test.ts`,
`tests/models/fees.model.test.ts`, `tests/views/members/member-account-section.test.ts` (si cambia algo).
**No toca:** código de producción (un test que revela un bug es un hallazgo para el agente dueño).
**Dependencias:** T1 (migración aplicada local), T2, T3.
**Skills:** `supabase-postgres-best-practices` (`.claude/skills/supabase-postgres-best-practices/`);
datos inventados, nunca los CSV reales.

**Solo se prueba contra base real (`tests/db/`, se saltean sin Docker):**
- Columnas/CHECKs: tramo con una sola mitad, día ≠ 1, desde > hasta, `to_period > period`, > 36 meses,
  tramo en `kind = 'monthly'` → rechazados; insert del código viejo (sin tramo) sigue andando.
- Guard: mensajes amigables; `period` = inicio − 1; `to_period >= inicio` rechazado con el texto de siempre.
- Inmutabilidad: `update` de `from_period`/`to_period` falla incluso con `payments.void` (solo cambia la
  anulación); `authenticated` puede insertar las columnas y no actualizarlas; sin `grant delete`.
- Auditoría: la fila del saldo anterior queda con las columnas nuevas y el actor = `auth.uid()`.
- `register_payment_batch`: guarda el tramo; reintento con el mismo `batch_id` idempotente; saldo y pagos
  atómicos si falla un ítem; rol sin `payments.register` rechazado.
- `payment_month_options`:
  - flujo completo de la carga inicial: ene–mar histórico → celdas ene..oct reales (kind `opening_balance`,
    `opening_from` = enero), ene–mar pagas, abr..oct adeudadas; segundo pago abr–jun deja jul..oct adeudadas;
  - reparto con total no múltiplo (p. ej. $100.000 en 3 meses): Σ celdas = total, resto en el último mes;
    total corregido ≠ n × cuota;
  - cobertura parcial dentro del tramo (pago que cae a mitad de mes);
  - fila vieja sin tramo → celda única, `opening_from` NULL, mismo comportamiento de antes;
  - saldo anulado → vuelven las `pre_system` y los pagos quedan como saldo a favor;
  - antes del inicio las celdas pagas se ven; después del inicio se ocultan las anteriores al primer adeudado;
  - grupo familiar (varios `member_ids` en una llamada); socio de baja; alta posterior al inicio sin previas;
  - Σ celdas del saldo = Σ `fees.amount_cents` y deuda total / `member_balance` sin cambios (la deuda sigue
    derivada); `service_role` y `authenticated` con EXECUTE, `anon` sin él.
  - Paridad TS/SQL: `splitOpeningTotal` contra el reparto de la RPC con varios (total, n).
- Un saldo vigente por socio (`fees_one_opening_balance`) sigue valiendo con tramo.

**En Node (sin base):** todo lo listado como "lógica pura" y la máquina de arrastre en T3; render estático
de `MonthStrip`/formularios: grilla expandida antes del inicio y colapsada después / en grupo con resumen y
botón "Cambiar" (`aria-expanded`), "queda debiendo" en celdas previas, avisos de saldo existente, ayuda de
arrastre. La interacción de punteros real (touch, scroll) no es testeable sin DOM: queda en la verificación
manual de §11 y el informe lo declara.

**Entrega:** `03-tests.md` con `SUITE GREEN` o los hallazgos.

---

## Revisión y cierre

`code-reviewer` revisa el diff completo (contratos, RLS/grants, retrocompatibilidad de la migración,
mobile-first, accesibilidad del arrastre). Nada se commitea hasta `APPROVED` + `SUITE GREEN`. El hilo
principal integra, corre `npm run db:reset`, `npm run typecheck`, `npm run lint`, `npm test` y la
verificación manual de §11 antes de pedir el merge (fuera del horario de carga del club).
