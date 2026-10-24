# 00 — Arquitectura: Registrar pago por meses, con "desde cuándo"

Pipeline `2026-10-24-pago-por-meses`. Planner: `feature-planner`, 2026-10-24. Implementa el
brief aprobado `00-design-brief.md` (manda sobre este documento donde se contradigan en lo
que es diseño; este documento manda en lo técnico). **Cero código de producción acá**: el
SQL de §9 lo copia el hilo principal a la migración; lo demás son contratos.

## 1. Problema y contexto

- La Comisión piensa en meses; el formulario de pago habla en montos (`AmountField` + chips
  "1/2/3 meses / Toda la deuda"). Nadie ve qué meses cubre un pago.
- La facturación arrancó en 2026-10; los importados tienen `joined_on = 2026-10-01`. Un pago
  "por julio–septiembre" no tiene cargo contra qué imputarse: queda saldo a favor y octubre
  se lo come. La herramienta existente ("Cargar saldo anterior" por monto, en la ficha) está
  fuera del flujo de cobro.
- Decisiones ya tomadas (brief): balance forward se mantiene; meses primero, monto derivado;
  grupo familiar con el mismo patrón; deuda previa = saldo anterior creado desde la tira;
  valor por mes = cuota de hoy, total editable; sin tablas nuevas ni cambios a `fees`/`payments`.

Constraints del repo que aplican: deuda derivada (nunca guardada); totales que se muestran
salen de RPC; escrituras del dominio con el cliente de sesión (actor = `auth.uid()`);
idempotencia por `batchId`; nada se borra; permisos, no roles (`private.can`).

## 2. Chequeo de alcance

Contrato 2.2 (registro de pagos y estado de cuenta) y 2.1 (saldo de arranque: "la deuda previa
al sistema entra como un cargo inicial"). Todo dentro de la Fase 1. Fuera: importar los pagos
2026 de las planillas, imputación libre de meses, descuentos familiares (ya excluidos por el
brief).

## 3. Lo que relevé (verificado contra el repo, 2026-10-24)

- **MCP de Supabase: no respondió** (`ECONNREFUSED`, el stack local está apagado). Trabajé
  desde las migraciones. Nada de lo de abajo depende de datos vivos.
- `supabase/migrations/20260927130000_billing.sql`: `fees` (kinds `monthly`/`opening_balance`/
  `adjustment`), `fees_one_opening_balance` (único por socio, vigente), `fees_opening_balance_guard`
  (fuerza `period = inicio − 1 mes`, exige monto > 0, default de descripción "Saldo anterior al
  sistema", SECURITY DEFINER), `fee_price_for(category, member_type, period)` (redefinida en
  `20261015120000_fee_prices_correction.sql`: desempata por `id desc` — **la vigente es esa**),
  policy `fees_insert` = `payments.register` ∧ `kind = 'opening_balance'` ∧ `created_by = auth.uid()`,
  grant de INSERT **por columna** `(member_id, kind, amount_cents, description)` — `period` no se
  puede mandar (42501).
- `20260927130100_payments.sql`: `payments` con `batch_id`, índice único `(batch_id, member_id)`,
  `payments_paid_on_guard`, policy de INSERT `payments.register` ∧ `created_by = auth.uid()`,
  grant por columna sin `created_by`.
- `20260927130200_accounts.sql`: `private.member_balance`, `private.member_fee_coverage`
  (balance forward, UNA definición), `public.member_accounts` (devuelve `current_fee_cents`
  = cuota generada del mes o la que le tocaría), `public.member_fee_statement`,
  `private.require_permission`. Todas INVOKER + chequeo de permiso en el cuerpo.
- Policies de SELECT que una RPC INVOKER necesita: `members`/`settings`/`categories`/
  `disciplines` (cualquier rol activo), `member_categories` (`members.read`), `fees`/`payments`/
  `fee_prices` (`payments.read`). Admin y editor las tienen todas.
- Hoy `registerPayment` (`src/models/payments.model.ts`) es **un INSERT batch por PostgREST**
  (N filas, mismo `batch_id`); el reintento se detecta por 23505 en `payments_batch_member_key`.
  `createOpeningBalance` (`fees.model.ts`) es otro INSERT por PostgREST, independiente.
- `getPaymentFormData` (`payments.actions.ts`) devuelve `PaymentFormData = { members:
  MemberAccount[], familyGroup, billing }` — sin statement, sin meses.
- Vistas: `payment-form.tsx`, `group-payment-form.tsx`, `register-payment-sheet.tsx`,
  `payment-schema.ts` (espejo cliente de Zod), `member-period-strip.tsx` (tira de 12 meses de
  la ficha: `periodStatus`, íconos por estado), `member-account-section.tsx` (form de saldo
  anterior por monto → `createOpeningBalance`).
- Patrones recientes para RPC pública con permiso en el cuerpo: `generate_pending_fees()` y
  `correct_member_joined_on()` (`revoke ... from public, anon` + `grant ... to authenticated`).
  Toda migración que crea funciones en `private` cierra con `revoke execute on all functions
  in schema private from public, anon` (test en `tests/db/grants-and-lockdown.test.ts`).
- Skills consultadas: `supabase-postgres-best-practices` (`security-privileges`,
  `security-rls-performance`, `lock-advisory`) y `supabase` (checklist: preferir SECURITY
  INVOKER; una DEFINER en `public` es endpoint para todos; UPDATE pide SELECT). No hice falta
  Context7: no hay API nueva de librería, todo espeja usos ya presentes en el repo
  (`supabase.rpc(...)` con `returns table`, react-hook-form, Zod v4).

## 4. Pushback (lo que técnicamente no cerraba y cómo lo resolví)

1. **Dos deportes en un período** = dos filas de `fees`. La tira habla de meses, así que una
   celda = la **suma del período** (`amount`, `covered`, `pending` agregados). El orden de
   cobertura adentro del mes (social antes que deporte, por id) es asunto de
   `member_fee_coverage`, no de la tira. Decidido.
2. **"Precio proyectado" de un mes futuro**: se resuelve con `fee_price_for(categoría,
   'practicing', p)` por cada inscripción abierta HOY (o `('non_practicing', p)` sin
   inscripciones), igual que el fallback de `member_accounts`. Eso ya contempla valores
   programados (`valid_from <= p`). No se proyectan cambios de categoría futuros. La fila trae
   `priced_at_today` para que la celda pueda decir "al valor de hoy" cuando no hay valor
   programado distinto. Decidido.
3. **"Cuota de hoy" del saldo anterior** = la cuota del socio al período actual con sus
   inscripciones de hoy (la misma función). Si no hay precio configurado da 0 y el total es
   editable. Decidido.
4. **Saldo a favor + meses previos** (el caso real de Tomás: el pago "julio–septiembre" ya
   entró y quedó como saldo a favor). Si el socio tiene saldo a favor y se le crea el saldo
   anterior, balance forward lo aplica solo. Para que la tira no le cobre dos veces los mismos
   meses, la lógica pura recibe `creditCents` (= `-balanceCents` si es negativo, ya está en
   `MemberAccount`) y lo descuenta de los meses previos elegidos al derivar el monto. Si el
   monto derivado queda en $0 y no hay otro mes elegido, el formulario de pago no puede
   registrar un pago de $0: muestra "El saldo a favor ya cubre esos meses: indicá desde cuándo
   debía desde la ficha" y deshabilita el botón. Decidido; es un borde.
5. **El saldo anterior por monto (sin meses) en la ficha**: el brief lo reemplaza para socios
   con alta ≤ inicio. Para un socio con alta > inicio no existe "deuda anterior al sistema": si
   la hay, el dato errado es `joined_on` y para eso existe `correct_member_joined_on`.
   **Recomiendo quitar el formulario por monto de la UI** y dejar la action/modelo
   `createOpeningBalance` como pieza interna (la usa el flujo por meses). Marcado como
   pregunta para Tomás (§11); el default del plan es quitarlo.
6. **Idempotencia del saldo anterior en la ficha** (solo saldo, sin pago): un doble toque
   produce 23505 `fees_one_opening_balance` → "Ya tiene un saldo anterior vigente". El botón
   se deshabilita mientras envía y la página se refresca al terminar; alcanza. No agrego RPC
   para eso.
7. **La RPC de escritura no necesita SECURITY DEFINER.** Con INVOKER valen exactamente las
   mismas policies, grants por columna, `created_by default auth.uid()`, triggers y auditoría
   que hoy tiene el INSERT por PostgREST. Una DEFINER acá sería "resolver un permission denied
   saltando RLS", que la skill y CLAUDE.md prohíben.

## 5. Opciones y descarte

### 5.1 Lectura de los meses (de dónde salen las celdas)

| Opción | Pros | Contras |
|---|---|---|
| A. Derivar en TS desde `statement` + `MemberAccount` (`currentFeeCents` × meses) | Cero SQL | Precios programados de meses futuros no están en ningún dato que ya llegue; el cliente armaría totales que se muestran (anti-objetivo del brief); dos implementaciones de "cubierto por saldo a favor" |
| **B. RPC `payment_month_options(member_ids)` (recomendada)** | Una sola definición de celda, reusa `member_fee_coverage` y `fee_price_for`; grupo en UNA llamada; testeable en `tests/db/` | Una función nueva + un helper privado de precio |
| C. Ampliar `member_accounts` con un `jsonb` de meses | Sin llamada extra | Engorda la RPC más usada del sistema (padrón, listados) para una pantalla; jsonb anidado sin tipos |

### 5.2 Escritura (saldo anterior + pagos en una transacción)

| Opción | Pros | Contras |
|---|---|---|
| A. Dos INSERT por PostgREST (fees, después payments) | Sin SQL nuevo | No es atómico: una mala señal entre los dos deja el saldo sin el pago (o viceversa). Rechazada por el brief ("todo o nada") |
| **B. RPC `register_payment_batch(...)` SECURITY INVOKER (recomendada)** | Una transacción; advisory lock por `batch_id` vuelve el reintento un éxito repetido sin tocar el saldo; mismas policies/grants/auditoría que hoy | Reemplaza el INSERT batch del modelo (un solo camino de escritura, mejor) |
| C. RPC SECURITY DEFINER | "Siempre anda" | Saltea RLS, el actor sigue siendo `auth.uid()` pero las policies dejan de ser la defensa; la skill lo prohíbe salvo necesidad real. No hay necesidad |

### 5.3 "Indicar desde cuándo debía" en la ficha

| Opción | Pros | Contras |
|---|---|---|
| **A. Reusar `createOpeningBalance` (PostgREST) con una descripción armada desde los meses (recomendada)** | Cero SQL; `fees_one_opening_balance` ya es la idempotencia | La descripción se arma en TS |
| B. Usar `register_payment_batch` con un ítem sin pago | Un solo camino | Un "lote de pagos" sin pagos es un contrato torcido; `payments.amount_cents > 0` lo impide |

### 5.4 Dónde viven los meses del saldo anterior

Solo en la **descripción** ("Saldo anterior · julio a septiembre 2026"); el `period` lo sigue
fijando el trigger (inicio − 1). Sin columnas nuevas (brief). La RPC igual recibe `from/to` y
valida `to < inicio` para que la descripción no mienta.

## 6. Arquitectura recomendada

### 6.1 Postgres (migración `supabase/migrations/20261024120000_payment_months.sql`, hilo principal)

- `private.member_fee_price_at(member_id, period) → bigint`: suma de `fee_price_for` por
  inscripción abierta, o la social; 0 si no hay precio. STABLE, INVOKER. Grant a
  `authenticated, service_role` (la llama una RPC INVOKER).
- `public.payment_month_options(member_ids bigint[])` → filas `(member_id, period, kind,
  amount_cents, covered_cents, pending_cents, is_current, priced_at_today)`. INVOKER,
  `require_permission('payments.register')`. Ventana por socio:
  - **`opening_balance` / `monthly`**: períodos desde el primero no cubierto (o el actual si
    está al día) en adelante, agregados por período desde `member_fee_coverage` (no anulados).
    Bajo balance forward no hay un mes pago después de uno adeudado, así que la ventana es
    contigua.
  - **`projected`**: solo socio `active`; meses de `max(inicio, actual)` a `actual + 6` sin
    ninguna fila `monthly` (anulada o no: una cuota anulada es definitiva, el cron no la
    vuelve a crear). Precio con `member_fee_price_at(p)`; `covered` = saldo a favor aplicado
    en orden (`greatest(0, paid − charged)` repartido con una ventana acumulada);
    `priced_at_today = (precio(p) = precio(actual))`.
  - **`pre_system`**: solo si hay inicio, **no hay saldo anterior vigente** y
    `date_trunc('month', joined_on) <= inicio`: los 12 meses `inicio−12 .. inicio−1`, monto =
    `member_fee_price_at(actual)`, `pending = amount`, `priced_at_today = true`.
  - Sin facturación activa, o inicio en un mes futuro: **cero filas** (el formulario cae al
    campo de monto, como hoy con cuotas no activadas).
  - Orden: `member_id, period`. El saldo anterior (`inicio − 1`) y el último `pre_system`
    comparten período pero son excluyentes por construcción.
- `public.register_payment_batch(batch_id uuid, paid_on date, method text, receipt_storage_path
  text, notes text, items jsonb)` → filas `(member_id, payment_id, amount_cents,
  opening_balance_fee_id, already_registered)`. **SECURITY INVOKER**, `set search_path = ''`.
  - `items`: `[{ "member_id", "amount_cents", "opening_balance": { "from_period", "to_period",
    "amount_cents", "description" } | null }]`.
  - Chequea `private.can('payments.register')` (mensaje propio) → `pg_advisory_xact_lock(hashtext(
    'lonqui.payment_batch:' || batch_id))` → si ya hay pagos del lote, devuelve los existentes
    con `already_registered = true` y **no toca nada**. Si no: por ítem con `opening_balance`,
    valida (`from <= to`, `to < inicio`, monto > 0) e inserta en `fees` (`kind =
    'opening_balance'`, la descripción que vino, `period` lo pone el trigger); después UN
    `insert ... select from jsonb_to_recordset` en `payments`. Devuelve `payments` del lote
    con el id del saldo creado por socio.
  - Al ser INVOKER: `fees_insert`/`payments_insert` (RLS) y los grants por columna aplican tal
    cual; `created_by` toma el default `auth.uid()`; `audit_row_change` registra actor
    `session`. Un `editor` puede; `consulta` recibe `insufficient_privilege`.
  - Un reintento concurrente del mismo lote espera el lock y encuentra el lote hecho. Un saldo
    anterior creado en paralelo por otra vía choca con `fees_one_opening_balance` (23505) y se
    traduce.
- Cierre: `revoke execute on function ... from public, anon` + `grant ... to authenticated`
  para las dos públicas; `revoke execute on all functions in schema private from public, anon`
  y el grant a mano del helper.
- Sin tablas, sin cambios a `fees`/`payments`, sin índices nuevos (las consultas usan
  `fees_member_period_idx`, `payments_member_not_voided_idx`, `fee_prices_target_idx`).

### 6.2 Modelos (`senior-backend-engineer`)

- `accounts.model.ts`: `getPaymentMonthOptions(memberIds: number[]): Promise<PaymentMonthOption[]>`
  (RPC `payment_month_options`, mapeo a camelCase; vacío si `memberIds` está vacío).
- `payments.model.ts`: `registerPayment(input)` pasa a llamar `register_payment_batch`
  (un solo camino de escritura; el INSERT batch por PostgREST desaparece). `registerPaymentSchema`:
  cada ítem admite `openingBalance: { fromPeriod, toPeriod, amountCents } | null` (periodos
  `YYYY-MM-01`, `from <= to`, `memberId` únicos en el lote). Traducción de errores: 23505
  `fees_one_opening_balance` → "Ya tiene un saldo anterior vigente. Actualizá la pantalla y
  volvé a intentar."; 23505 `payments_batch_member_key` → "El mismo socio aparece dos veces en
  el lote"; 23514 con mensaje redactado (guards y los `raise` de la RPC) → `DomainError` tal
  cual (filtro `isRawPostgresMessage`); 42501 → `PermissionError`; 23503 → "El socio no existe".
  Resultado: `{ paymentIds, totalCents, alreadyRegistered, openingBalanceFeeIds }`.
- `fees.model.ts`: `openingBalanceDescription(fromPeriod, toPeriod)` = `"Saldo anterior · " +
  periodRangeLabel(from, to)`; `createOpeningBalanceFromMonthsSchema` (`memberId`, `fromPeriod`,
  `toPeriod`, `amountCents`) y `createOpeningBalanceFromMonths(input)` que delega en
  `createOpeningBalance` con esa descripción. La RPC de lote usa la **misma** función para la
  descripción: un solo formato.
- `src/lib/dates.ts` (hilo principal, contrato): `periodRangeLabel(from, to)` →
  "julio 2026" / "julio a septiembre 2026" / "noviembre 2025 a febrero 2026".

### 6.3 Controllers (`senior-backend-engineer`, `payments.actions.ts`)

- `getPaymentFormData`: suma `monthOptions: Record<number, PaymentMonthOption[]>` (una sola
  llamada a `getPaymentMonthOptions` con todos los ids; grupo incluido).
- `registerPayment`: sin cambio de firma; el chequeo de grupo (todos los `memberId` del grupo)
  sigue igual; la verificación de `receiptPath` igual.
- Nuevas: `getPaymentMonthOptions({ memberId })` → `ActionResult<PaymentMonthOption[]>`
  (`payments.register`; la ficha la llama al abrir "Indicar desde cuándo debía") y
  `createOpeningBalanceFromMonths(input)` → `ActionResult<{ id: number }>` (`payments.register`,
  `revalidatePath('/', 'layout')`).
- `createOpeningBalance` (por monto) queda exportada pero sin consumidor de UI (ver §4.5).

### 6.4 Vistas (`frontend-react-craftsman`, dos lanes)

- **Lógica pura** `src/views/payments/month-selection.ts` (sin React; importa solo tipos y
  `@/lib/dates`): estado visual de la celda, selección por rango, monto derivado, saldo
  anterior desde la selección, cobertura de "otro monto", resumen. Contrato en `01-tasks.md` §F1.
- **`MonthStrip`** `src/views/payments/month-strip.tsx`: la tira (4 columnas, celdas ≥ 44px,
  ícono + texto, nunca solo color; variantes `default`/`compact`; pliegue "¿Debe meses de
  antes de <mes>?"; total del saldo anterior editable).
- `payment-form.tsx` y `group-payment-form.tsx`: la tira reemplaza monto + chips; "Otro monto"
  como escape; desaparece la confirmación bloqueante de sobrepago; sin filas (`monthOptions`
  vacío para ese socio) → campo de monto como hoy. `register-payment-sheet.tsx`: pasa
  `monthOptions`, momento de éxito con "Cubre ago–oct".
- Ficha: `member-account-section.tsx` cambia "Cargar saldo anterior" por "Indicar desde cuándo
  debía" (nuevo `opening-balance-months.tsx` que carga las opciones al abrir y crea solo el
  saldo). Visible si `openingBalance == null`, facturación activa y vigente, y mes de
  `member.joinedOn` ≤ `billing.startPeriod`.

### 6.5 Flujo (secuencia)

1. Abrir overlay → `getPaymentFormData` → `member_accounts` + `payment_month_options` (una RPC
   cada una, N socios) + grupo + billing.
2. Tocar meses → `month-selection` deriva monto y, si hay meses previos, el saldo anterior
   (`from`, `to`, `amount` = cuota de hoy × meses o el total corregido).
3. Registrar → `registerPayment({ batchId, paidOn, method, items:[{ memberId, amountCents,
   openingBalance }], ... })` → modelo arma la descripción y llama `register_payment_batch` →
   una transacción; triggers auditan con `auth.uid()`.
4. Reintento (doble toque, mala señal) → mismo `batchId` → lock → `already_registered = true`
   → toast "El pago ya estaba registrado".

## 7. Transversales

- **Permisos**: lectura y escritura con `payments.register`; `consulta` no puede ni leer las
  opciones (no abre el formulario). RLS sigue siendo la defensa (INVOKER).
- **Auditoría**: sin cambios; los INSERT de `fees` y `payments` dentro de la RPC disparan
  `audit_row_change` con actor `session`.
- **Nada se borra**: la RPC solo inserta. Un saldo anterior mal creado se anula (admin), como hoy.
- **Dinero**: centavos enteros; la suma de celdas que arma el monto a enviar es la única suma
  del cliente (el brief lo permite explícitamente); todo lo demás sale de la RPC.
- **Zona horaria**: `private.club_today()` en SQL; `billing.currentPeriod` en TS. Nunca
  `new Date()` para decidir un período.
- **Fallas**: RPC de lectura falla → `ErrorState` del sheet (ya existe). Escritura falla →
  todo revertido; el usuario reintenta con el mismo `batchId`.
- **Migración**: solo `create function` + grants; reversa = `drop function` ×3 y volver el
  modelo al INSERT batch. Sin datos que transformar.
- **Cache**: `revalidatePath('/', 'layout')` en toda escritura, como hoy.
- **Datos personales**: nada nuevo viaja ni se loguea.

## 8. Contratos (los fija el hilo principal en `src/models/types.ts`)

```ts
export type PaymentMonthKind = 'pre_system' | 'opening_balance' | 'monthly' | 'projected'

/** Una fila de `payment_month_options`: una celda de la tira de meses del formulario de pago. */
export type PaymentMonthOption = {
  memberId: number
  /** Mes. En 'opening_balance' es su período real (el anterior al inicio de la facturación). */
  period: ISODate
  kind: PaymentMonthKind
  /** Total del período: saldo anterior, suma de cuotas no anuladas, o precio proyectado / de hoy. */
  amountCents: number
  /** Cubierto por pagos ('monthly'/'opening_balance') o por saldo a favor ('projected'). 0 en 'pre_system'. */
  coveredCents: number
  /** amountCents − coveredCents. 0 = pagado o cubierto: la celda no se puede elegir. */
  pendingCents: number
  isCurrent: boolean
  /** 'projected'/'pre_system' valuados con la cuota de hoy (sin valor programado distinto). */
  pricedAtToday: boolean
}

export type OpeningBalanceMonths = { fromPeriod: ISODate; toPeriod: ISODate; amountCents: number }

export type PaymentFormData = {
  members: MemberAccount[]
  /** Celdas por socio. Un socio sin entrada o con [] no tiene tira: el formulario pide el monto. */
  monthOptions: Record<number, PaymentMonthOption[]>
  familyGroup: FamilyGroupSummary | null
  billing: BillingStatus
}

export type RegisterPaymentResult = {
  paymentIds: number[]
  totalCents: number
  alreadyRegistered: boolean
  openingBalanceFeeIds: number[]
}
```

`src/lib/dates.ts`: `periodRangeLabel(from: string, to: string): string`.

## 9. SQL propuesto (lo copia el hilo principal; nombre sugerido `20261024120000_payment_months.sql`)

```sql
-- =============================================================================
-- Pago por meses: celdas de la tira (lectura) y lote atómico saldo anterior +
-- pagos (escritura).
--
-- Pipeline: docs/pipelines/2026-10-24-pago-por-meses/ (§6, §9).
--
-- Sin tablas nuevas ni cambios a fees/payments. Las dos RPC públicas son
-- SECURITY INVOKER: valen las mismas policies, grants por columna, triggers y
-- auditoría (actor = auth.uid()) que el INSERT por PostgREST que reemplazan.
--
-- Reversa: drop de las tres funciones; el modelo vuelve al INSERT batch.
-- =============================================================================

-- Cuota de un socio para un período con sus inscripciones de HOY: suma de los
-- valores por categoría (fee_price_for ya resuelve valores programados) o la
-- social. 0 si no hay valor configurado: la tira lo muestra y el total es
-- editable; el que frena por falta de precio es el generador, no esta lectura.
create function private.member_fee_price_at(p_member_id bigint, p_period date)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select sum(fp.amount_cents)::bigint
     from public.member_categories mc
     join public.categories c on c.id = mc.category_id
     cross join lateral private.fee_price_for(c.id, 'practicing', p_period) fp
     where mc.member_id = p_member_id and mc.left_on is null),
    (select fp.amount_cents
     from private.fee_price_for(null, 'non_practicing', p_period) fp
     where not exists (
       select 1 from public.member_categories mc
       where mc.member_id = p_member_id and mc.left_on is null
     )),
    0
  );
$$;

-- Las celdas de la tira de meses del formulario de pago, para uno o varios
-- socios (un grupo familiar en UNA llamada). Por socio:
--   opening_balance / monthly  períodos desde el primero no cubierto (o el actual
--                              si está al día), agregados por mes desde
--                              member_fee_coverage: UNA definición de cobertura;
--   projected                  solo activos: de max(inicio, actual) a actual+6 sin
--                              fila monthly (anulada o no); precio proyectado;
--                              covered = saldo a favor aplicado en orden;
--   pre_system                 solo sin saldo anterior vigente y con alta en o
--                              antes del mes de inicio: los 12 meses previos, a
--                              la cuota de hoy.
-- Sin facturación activa o con inicio futuro no devuelve nada: el formulario
-- cae al campo de monto.
create function public.payment_month_options(member_ids bigint[])
returns table (
  member_id bigint,
  period date,
  kind text,
  amount_cents bigint,
  covered_cents bigint,
  pending_cents bigint,
  is_current boolean,
  priced_at_today boolean
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  start_period date;
  current_period date := date_trunc('month', private.club_today())::date;
  horizon date := (date_trunc('month', private.club_today()) + interval '6 months')::date;
begin
  perform private.require_permission('payments.register');

  select s.billing_start_period into start_period from public.settings s where s.id = 1;
  if start_period is null or start_period > current_period then
    return;
  end if;

  return query
  with target as (
    select
      m.id,
      m.status,
      m.joined_on,
      private.member_fee_price_at(m.id, current_period) as price_today,
      exists (
        select 1 from public.fees f
        where f.member_id = m.id and f.kind = 'opening_balance' and f.voided_at is null
      ) as has_opening_balance
    from public.members m
    where m.id = any (payment_month_options.member_ids)
  ),
  charged as (
    -- Un mes = la suma de sus cargos no anulados (dos deportes = dos cuotas).
    select
      t.id as member_id,
      cv.period,
      case when bool_or(cv.kind = 'opening_balance') then 'opening_balance' else 'monthly' end as kind,
      sum(cv.amount_cents)::bigint as amount_cents,
      sum(cv.covered_cents)::bigint as covered_cents
    from target t
    cross join lateral private.member_fee_coverage(t.id) cv
    where cv.voided_at is null
    group by t.id, cv.period
  ),
  first_due as (
    select c.member_id, min(c.period) as period
    from charged c
    where c.amount_cents > c.covered_cents
    group by c.member_id
  ),
  credit as (
    select
      t.id as member_id,
      greatest(0,
        coalesce((select sum(p.amount_cents) from public.payments p
                  where p.member_id = t.id and p.voided_at is null), 0)
        - coalesce((select sum(c.amount_cents) from charged c where c.member_id = t.id), 0)
      )::bigint as credit_cents
    from target t
  ),
  billed as (
    select c.member_id, c.period, c.kind, c.amount_cents, c.covered_cents
    from charged c
    left join first_due fd on fd.member_id = c.member_id
    where c.period >= coalesce(fd.period, current_period)
  ),
  projected as (
    select
      t.id as member_id,
      gs::date as period,
      private.member_fee_price_at(t.id, gs::date) as amount_cents,
      t.price_today
    from target t
    cross join generate_series(greatest(start_period, current_period), horizon, interval '1 month') gs
    where t.status = 'active'
      and not exists (
        select 1 from public.fees f
        where f.member_id = t.id and f.kind = 'monthly' and f.period = gs::date
      )
  ),
  projected_covered as (
    select
      p.member_id,
      p.period,
      p.amount_cents,
      greatest(0, least(
        p.amount_cents,
        cr.credit_cents - (sum(p.amount_cents) over (partition by p.member_id order by p.period) - p.amount_cents)
      ))::bigint as covered_cents,
      (p.amount_cents = p.price_today) as priced_at_today
    from projected p
    join credit cr on cr.member_id = p.member_id
  ),
  pre_system as (
    select t.id as member_id, gs::date as period, t.price_today as amount_cents
    from target t
    cross join generate_series(
      start_period - interval '12 months', start_period - interval '1 month', interval '1 month'
    ) gs
    where not t.has_opening_balance
      and date_trunc('month', t.joined_on)::date <= start_period
  )
  select b.member_id, b.period, b.kind, b.amount_cents, b.covered_cents,
         (b.amount_cents - b.covered_cents)::bigint, b.period = current_period, false
  from billed b
  union all
  select pc.member_id, pc.period, 'projected', pc.amount_cents, pc.covered_cents,
         (pc.amount_cents - pc.covered_cents)::bigint, pc.period = current_period, pc.priced_at_today
  from projected_covered pc
  union all
  select ps.member_id, ps.period, 'pre_system', ps.amount_cents, 0::bigint,
         ps.amount_cents, false, true
  from pre_system ps
  order by 1, 2;
end;
$$;

-- Lote de pagos (uno o varios socios de un grupo) con, opcionalmente, el saldo
-- anterior de cada uno, en UNA transacción. items:
--   [{ "member_id": 12, "amount_cents": 3000000,
--      "opening_balance": { "from_period": "2026-07-01", "to_period": "2026-09-01",
--                           "amount_cents": 3000000,
--                           "description": "Saldo anterior · julio a septiembre 2026" } | null }]
-- Idempotente por batch_id: un advisory lock serializa los reintentos del mismo
-- lote y el segundo encuentra el primero hecho (no toca el saldo ni los pagos).
-- INVOKER a propósito: RLS (fees_insert exige kind = 'opening_balance' y
-- created_by = auth.uid(); payments_insert ídem), grants por columna, el guard
-- que fija period y la auditoría funcionan igual que en el INSERT directo.
create function public.register_payment_batch(
  batch_id uuid,
  paid_on date,
  method text,
  receipt_storage_path text,
  notes text,
  items jsonb
)
returns table (
  member_id bigint,
  payment_id bigint,
  amount_cents bigint,
  opening_balance_fee_id bigint,
  already_registered boolean
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  start_period date;
  item record;
  from_p date;
  to_p date;
  ob_amount bigint;
  ob_id bigint;
  ob_members bigint[] := '{}';
  ob_ids bigint[] := '{}';
begin
  if not private.can('payments.register') then
    raise exception 'No tenés permiso para registrar pagos' using errcode = 'insufficient_privilege';
  end if;

  if register_payment_batch.batch_id is null then
    raise exception 'El identificador del lote no es válido' using errcode = 'check_violation';
  end if;
  -- Dos IF, no un OR: SQL no garantiza cortocircuito y jsonb_array_length
  -- sobre un no-array tiraría un error crudo en vez de este mensaje.
  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'Cargá al menos un pago' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(items) = 0 then
    raise exception 'Cargá al menos un pago' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('lonqui.payment_batch:' || register_payment_batch.batch_id::text));

  if exists (select 1 from public.payments p where p.batch_id = register_payment_batch.batch_id) then
    return query
    select p.member_id, p.id, p.amount_cents, null::bigint, true
    from public.payments p
    where p.batch_id = register_payment_batch.batch_id
    order by p.id;
    return;
  end if;

  select s.billing_start_period into start_period from public.settings s where s.id = 1;

  for item in
    select x.member_id, x.amount_cents, x.opening_balance
    from jsonb_to_recordset(items) as x(member_id bigint, amount_cents bigint, opening_balance jsonb)
  loop
    if item.member_id is null then
      raise exception 'Elegí el socio' using errcode = 'check_violation';
    end if;
    if item.amount_cents is null or item.amount_cents <= 0 then
      raise exception 'El monto tiene que ser mayor a cero' using errcode = 'check_violation';
    end if;

    if item.opening_balance is not null and jsonb_typeof(item.opening_balance) = 'object' then
      if start_period is null then
        raise exception 'Primero activá las cuotas en Ajustes' using errcode = 'check_violation';
      end if;
      from_p := (item.opening_balance ->> 'from_period')::date;
      to_p := (item.opening_balance ->> 'to_period')::date;
      ob_amount := (item.opening_balance ->> 'amount_cents')::bigint;

      if from_p is null or to_p is null or from_p > to_p then
        raise exception 'Los meses del saldo anterior no son válidos' using errcode = 'check_violation';
      end if;
      if to_p >= start_period then
        raise exception 'El saldo anterior solo cubre meses anteriores a %', to_char(start_period, 'MM/YYYY')
          using errcode = 'check_violation';
      end if;
      if ob_amount is null or ob_amount <= 0 then
        raise exception 'El saldo anterior tiene que ser mayor a cero' using errcode = 'check_violation';
      end if;

      -- period lo fija fees_opening_balance_guard (inicio − 1); created_by toma
      -- el default. Solo las columnas con grant de INSERT.
      insert into public.fees (member_id, kind, amount_cents, description)
      values (
        item.member_id,
        'opening_balance',
        ob_amount,
        nullif(btrim(item.opening_balance ->> 'description'), '')
      )
      returning id into ob_id;

      ob_members := ob_members || item.member_id;
      ob_ids := ob_ids || ob_id;
    end if;
  end loop;

  insert into public.payments (member_id, amount_cents, paid_on, method, receipt_storage_path, notes, batch_id)
  select
    x.member_id,
    x.amount_cents,
    register_payment_batch.paid_on,
    register_payment_batch.method,
    register_payment_batch.receipt_storage_path,
    register_payment_batch.notes,
    register_payment_batch.batch_id
  from jsonb_to_recordset(items) as x(member_id bigint, amount_cents bigint);

  return query
  select p.member_id, p.id, p.amount_cents, ob.fee_id, false
  from public.payments p
  left join unnest(ob_members, ob_ids) as ob(m_id, fee_id) on ob.m_id = p.member_id
  where p.batch_id = register_payment_batch.batch_id
  order by p.id;
end;
$$;

-- Grants: las públicas solo para authenticated; ninguna de private para PUBLIC
-- (el default no se revoca por schema, CLAUDE.md), y a mano la que la RPC
-- INVOKER necesita.
revoke execute on function
  public.payment_month_options(bigint[]),
  public.register_payment_batch(uuid, date, text, text, text, jsonb)
from public, anon;

grant execute on function
  public.payment_month_options(bigint[]),
  public.register_payment_batch(uuid, date, text, text, text, jsonb)
to authenticated;

revoke execute on all functions in schema private from public, anon;

grant execute on function private.member_fee_price_at(bigint, date) to authenticated, service_role;
```

Notas para el hilo principal al aplicar:

- `#variable_conflict use_column` + parámetros sin prefijo obliga a **calificar los
  parámetros con el nombre de la función** donde haya una columna homónima (`p.batch_id =
  register_payment_batch.batch_id`); sin eso `where p.batch_id = batch_id` compara la columna
  consigo misma y el chequeo de "ya registrado" devuelve TODO. Está así en el SQL; no
  "simplificar".
- `hashtext()` devuelve `int4`; `pg_advisory_xact_lock(bigint)` lo acepta por cast implícito
  (igual que `generate_monthly_fees`).
- Correr `npm run db:reset` y `npm run db:types` después; `database.types.ts` tipa `items`
  como `Json`.

## 10. Lógica pura de la tira (contrato para F1 y los tests)

`src/views/payments/month-selection.ts` (sin React, sin fetch; importa `PaymentMonthOption`,
`MemberStatus` de `@/models/types` y helpers de `@/lib/dates`):

- `cellTone(o): 'pre_system' | 'opening_balance' | 'due' | 'partial' | 'paid' | 'covered' | 'current' | 'advance'`
  — `pre_system`/`opening_balance` por kind; `pending = 0` → `paid` (monthly/opening) o `covered`
  (projected); `0 < covered < amount` → `partial`; `projected` → `current` si `isCurrent` sino
  `advance`; `monthly` → `current` si `isCurrent` sino `due`.
- `isSelectable(o) = o.pendingCents > 0`.
- `Selection = { startIndex: number; endIndex: number } | null`: rango **inclusive sobre el
  array ordenado completo** (incluye celdas no elegibles, que quedan sin marcar aunque estén
  dentro del rango). Las marcadas = `options[i]` con `isSelectable` para `i ∈ [start, end]`.
- `firstSystemIndex(options)`: primer índice elegible que no sea `pre_system` (`-1` si no hay).
- `defaultSelection(options, memberStatus)`: activo → `{ first, first }` con `first =
  firstSystemIndex`; inactivo → desde `firstSystemIndex` hasta la última celda elegible (toda
  la deuda; la RPC ya no le da adelantos). `null` si no hay elegibles.
- `tapCell(options, selection, index, { preSystemOpen })`: celda no elegible → sin cambio.
  Celda `pre_system` → `start = index`; `end` se mantiene salvo que la celda en `end` sea un
  adelanto (`projected` y no `isCurrent`) o no haya `end`: entonces `end = último pre_system`.
  Celda del sistema → `end = index`; `start` se mantiene si es `pre_system` (el pliegue está
  abierto), si no `start = firstSystemIndex`. Siempre termina donde tocaste.
- `closePreSystem(options, selection)`: `start = firstSystemIndex` (o `null` si no hay).
- `selectedOptions(options, selection)`.
- `openingBalanceFromSelection(options, selection, overrideCents?)` → `OpeningBalanceMonths |
  null`: `from` = primer `pre_system` marcado, `to` = último, `amount = overrideCents ??
  suma de amountCents`.
- `derivedAmountCents(options, selection, { openingBalanceOverrideCents?, creditCents })`:
  `max(0, saldoAnterior − creditCents) + suma de pendingCents de las celdas del sistema
  marcadas`. (`creditCents = max(0, −account.balanceCents)`.)
- `coverageForAmount(options, selection, amountCents, { openingBalanceOverrideCents?, creditCents })`
  → `{ fullyCovered: number[]; partial: { index: number; cents: number } | null; leftoverCents:
  number }`: recorre en orden las celdas marcadas (el saldo anterior primero, descontado el
  saldo a favor) y las celdas del sistema **también las no marcadas posteriores** que sean
  elegibles (balance forward sigue más allá de lo elegido); lo que sobra es `leftoverCents`.
- **Corrección post-review (2026-10-24, `03-review.md` hallazgo 1). Lo de arriba sobre
  `creditCents` estaba mal y manda esto:** la RPC ya aplica el saldo a favor a las celdas
  `projected` (`coveredCents`). Crear un saldo anterior **consume** ese crédito primero
  (es el cargo más viejo), así que descontarlo del saldo anterior Y dejar los `projected`
  como cubiertos lo cuenta dos veces. Regla: con saldo anterior elegido, la tira opera
  sobre **opciones efectivas** — se re-corre balance forward en orden de período con un
  solo pozo `creditCents`, insertando el saldo anterior como el cargo más viejo: los
  `projected` que pierden cobertura vuelven a "adelanto"/"este mes" con su `pendingCents`
  real y pasan a ser elegibles. `derivedAmountCents` y `coverageForAmount` operan sobre
  esas opciones. Forma cerrada del monto, con A = saldo anterior (o el total corregido),
  C = `creditCents`: `X = max(0, A − C + Σ pendingCents(celdas del sistema hasta end) +
  Σ coveredCents(projected hasta end))`. Sin saldo anterior elegido, las opciones de la
  RPC ya son las efectivas. Ejemplo que tiene que dar bien: C = $20.000, oct `monthly`
  pago, nov y dic `projected` cubiertos, A = jul–sep $30.000, tocar enero → $40.000,
  "Cubre jul–ene".
- `selectionSummary(options, selection)` → `{ monthsCount, rangeLabel }` con
  `periodRangeLabel` ("3 meses · agosto a octubre"; el saldo anterior vigente cuenta como
  "saldo anterior", no como mes).

## 11. Preguntas abiertas

**Para Tomás (decidibles sin frenar; el plan asume la recomendación):**

1. Quitar de la ficha el "Cargar saldo anterior" por monto para socios con alta > inicio
   (recomendado: sí; para esos el dato a corregir es la fecha de alta).
2. Borde: socio con saldo a favor que ya cubre todos los meses previos elegidos y sin otro
   mes → el formulario de pago no registra (no hay pago) y manda a la ficha. ¿OK?
3. Ventana de 12 meses previos fija (brief). Si alguien debe más, se corrige el total.

**Para la Comisión:** ninguna nueva; el brief ya está confirmado.
