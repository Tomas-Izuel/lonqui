# 00 — Imputación libre de meses: un pago dice qué meses paga

Pipeline `2026-10-29-imputacion-libre-meses`. Planner: `feature-planner`, 2026-10-29, en plan
mode. **Cero código de producción acá**: el SQL de §9 es el boceto que el hilo principal copia a
la migración; lo demás son contratos para los agentes. Reemplaza la decisión "balance forward"
de `2026-10-24-pago-por-meses` (§2 de ese doc la dejaba explícitamente fuera) y el punto 4 de
`2026-10-24-carga-inicial-meses` §3.

## 1. Problema y contexto

Hoy un pago **no está atado a meses**. `payments` es un pozo por socio; la cobertura de cada
cargo se deriva en `private.member_fee_coverage` repartiendo ese pozo del cargo más viejo al más
nuevo (período, saldo anterior antes que cuotas, social antes que deporte, id). La grilla del
formulario de pago muestra ese reparto y deja elegir **hasta** qué mes se paga: la selección es
un rango que arranca en el primer mes adeudado.

Los usuarios ahora quieren **marcar meses sueltos** en cualquier caso: pagar mayo y julio, y que
junio, agosto, septiembre… queden adeudados. Verifiqué la lectura del hilo principal y es
correcta: **con el modelo actual es irrepresentable**. Si un socio debe mayo–noviembre y paga
$20.000, no hay dónde guardar "fue mayo y julio": `member_fee_coverage` siempre va a caer en
mayo y junio porque la única información que existe es el total pagado. No alcanza con cambiar la
grilla; hace falta que la base sepa **a qué mes fue cada peso**.

Constraints que mandan (CLAUDE.md): deuda derivada, nunca guardada; agregaciones en RPC; nada se
borra (un pago se anula); auditoría por triggers con actor `auth.uid()` (escrituras con el
cliente de sesión, RPC `SECURITY INVOKER`); permisos (`private.can`), no roles; idempotencia por
`batchId`; montos en centavos; períodos en hora de Argentina; ingresos de caja aislados de la
deuda; superficie Operate, mobile first, voluntarios no técnicos.

## 2. Chequeo de alcance

Contrato 2.2: registro de pagos y estado de cuenta ("meses adeudados, deuda total, último pago,
historial"). Imputar un pago a meses concretos es la forma más fiel de "meses adeudados"; entra en
Fase 1. **Es un cambio de requerimiento decidido por el usuario** (2026-10-29) que revierte una
decisión de diseño de hace cinco días, no un cambio de alcance contractual: no agrega módulos, no
toca portal, pagos online ni reportes nuevos. Lo que queda afuera y no se construye: reimputar un
pago ya cargado (mover un pago de un mes a otro), imputar explícitamente un saldo a favor viejo a
un mes elegido, descuentos, importar las planillas.

## 3. Lo que relevé (verificado contra el repo, 2026-10-29)

- **MCP de Supabase: no respondió** (`ECONNREFUSED`, stack local apagado). Trabajé desde las
  migraciones y el código. **El SQL de §9 no se corrió contra ninguna base**: el hilo principal
  tiene que aplicarlo con `npm run db:reset`, correr `tests/db/` y ajustar lo que no compile.
- **Context7**: no hizo falta. No se usa ninguna API de librería nueva: `supabase.rpc(...)`,
  react-hook-form y Zod v4 se usan exactamente como ya están en el repo. Sí revisé el changelog
  de Supabase (`https://supabase.com/changelog.md`, breaking changes 2026): ninguno toca funciones
  de Postgres, RLS, triggers ni RPC vía PostgREST de la forma en que este plan los usa.
- **Skills**: `supabase-postgres-best-practices` (`schema-constraints`, `lock-advisory`,
  `security-rls-performance`, `schema-foreign-key-indexes`), `supabase` (checklist: INVOKER
  salvo necesidad real, DEFINER en `private` con chequeo en el cuerpo, UPDATE pide SELECT,
  grants explícitos), `impeccable` (`reference/operate.md`: componentes con todos sus estados,
  nada de modales como primer recurso, consistencia de vocabulario). `grilling` lo apliqué contra
  mi propia propuesta (§11).
- **Patrón de referencia** (web): un pago que cancela varias facturas y una factura cancelada por
  varios pagos se modela con una tabla de **aplicación de pagos** (payment → allocation →
  invoice) donde la fila guarda el monto aplicado; el saldo abierto se **deriva** de lo no
  aplicado, nunca se guarda; lo que sobra queda "a cuenta" (unallocated / on account), que es lo
  que hacen Oracle AR, Access Financials y cualquier libro de cuentas corrientes. Fuentes:
  [SQL Server Central – Invoice and Payments](https://sqlservercentral.com/?p=198394),
  [Access programmers – apply payments](https://www.access-programmers.co.uk/forums/goto/post?id=863626),
  [Oracle OPERA – Managing AR invoice payments](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_accounts_receivable_managing_ar_invoice_payments.htm),
  [Access Financials – allocate receipt](https://help-collect.theaccessgroup.com/en/articles/15656425-allocate-receipt).
  Ninguna fuente habla de ledgers append-only; esa parte la impone CLAUDE.md y la resuelvo con
  inmutabilidad + "la anulación del pago apaga sus imputaciones" (§6.1).
- **Schema vigente** (la definición más nueva manda):
  - `fees` (`20260927130000_billing.sql` + `20261024170000_opening_balance_months.sql`):
    `kind` monthly / opening_balance / adjustment; `fees_one_opening_balance` (un saldo vigente
    por socio); el guard fija `period = inicio − 1` y valida el tramo `from_period/to_period`
    (inmutable, ≤ 36 meses, `to < inicio`); grant de INSERT por columna
    `(member_id, kind, amount_cents, description, from_period, to_period)`.
  - `payments` (`20260927130100_payments.sql`): `batch_id` + índice único `(batch_id, member_id)`;
    inmutable salvo anulación y comprobante; policy de INSERT `payments.register ∧ created_by =
    auth.uid()`; `payments_member_not_voided_idx`.
  - `private.member_fee_coverage` / `member_balance` (`20260927130200_accounts.sql`): balance
    forward, UNA definición; la usan `member_fee_statement`, `debt_by_category`,
    `member_accounts` (vía `member_balance`), los campos calculados `member_balance_cents` /
    `member_debt_status` / `member_months_due` del padrón.
  - `month_collection`, `daily_collection`, `cash_month_summary`, `dashboard_summary`,
    `monthly_history`: cobranza por `paid_on` y deuda total = cargos − pagos. **No miran la
    cobertura por cargo**: no cambian.
  - `payment_month_options` (`20261024170000`): celdas `opening_balance` (con tramo, una por mes,
    reparto en partes enteras con el resto en el último mes), `monthly`, `projected`
    (precio proyectado + saldo a favor aplicado en orden), `pre_system` (12 meses previos, solo
    sin saldo vigente y con `joined_on` ≤ inicio). Ventana contigua: `period >= first_due`.
  - `register_payment_batch` (`20261024170000`): INVOKER, advisory lock por `batch_id`, crea el
    saldo anterior del ítem (con tramo) y después UN insert de `payments`.
  - `correct_member_joined_on` (`20261015120100`): mover la fecha de alta hacia atrás **no genera
    cuotas antes del inicio de la facturación** (`generate_pending_fees` arranca en
    `billing_start_period` y `generate_monthly_fees` devuelve 0 para períodos anteriores). Los
    meses de un saldo anterior son siempre `< inicio` y las cuotas mensuales siempre `>= inicio`:
    **no puede haber doble cobro de un mes previo** por mover `joined_on`. El riesgo que
    señaló el hilo principal no existe por construcción; lo que sí existe es el caso de mover
    `joined_on` hacia atrás a un mes `>= inicio` (genera cuotas de esos meses, como hoy, y es lo
    correcto).
  - Permisos: `private.can('payments.register')` para leer celdas y registrar; `payments.void`
    para anular (solo admin); `payments.read` para estados de cuenta.
- **Vistas**: `month-selection.ts` (toda la lógica de selección es de **rango**: `Selection =
  {startIndex, endIndex}`, `tapCell`, `dragSelect` que fuerza `lo` al primer mes elegible,
  `effectiveOptions` que re-corre balance forward con el pozo pagado, `coverageForAmount` que
  sigue más allá de lo marcado); `month-strip.tsx` (celdas con ícono + texto, `aria-pressed`,
  `OpeningTotalField`); `month-drag.ts` + `use-month-drag.ts` (máquina de estados pura:
  mouse arma al entrar en otra celda, dedo por mantener apretado 250 ms); `month-entry.tsx`
  (`EntryState`, resumen, "Otro monto", "Queda debiendo"); `payment-form.tsx` /
  `group-payment-form.tsx`; `members/opening-balance-months.tsx` ("Indicar desde cuándo debía",
  solo tocar, `preMode: 'to_end'`); `member-account-answer.tsx` ("Debe desde <mes> · N meses"
  sale de `oldestDuePeriod` / `monthsDue`).
- **Modelos / controllers**: `accounts.model.ts` mapea `payment_month_options` columna por
  columna (una columna extra no rompe nada); `payments.model.ts` arma `items` para la RPC y
  traduce 23505/23514/42501; `payments.actions.ts` `getPaymentFormData` ya trae `monthOptions`
  por socio en una sola RPC.
- **Tests que fijan invariantes hoy** (`tests/db/`): `accounts.test.ts` (pago parcial cubre el
  más viejo primero; saldo a favor nunca es deuda; `sum(debt_by_category) = total_debt`),
  `opening-balance-months.test.ts` (tramo, reparto, paridad `splitOpeningTotal` TS/SQL, un saldo
  vigente, inmutabilidad), `register-payment-batch.test.ts` (idempotencia, atomicidad, crédito
  previo + saldo anterior), `payment-month-options*.test.ts`, `cash-isolation.test.ts` (foto
  idéntica de todas las funciones de deuda antes/después de mover caja), `grants-and-lockdown`.
  En `tests/views/payments/`: `month-selection.test.ts` (rango), `month-drag.test.ts`, render
  tests.
- **Datos reales**: la carga inicial está en curso (`billing_start_period = 2026-11-01`, hoy
  2026-10-29): los pagos históricos ya cargados crearon saldos anteriores con tramo y están
  cubiertos del más viejo al más nuevo. Es exactamente lo que el backfill tiene que preservar.

## 4. Pushback: lo que no cierra tal como se pidió, y cómo lo resuelvo

1. **"La deuda total sigue siendo cargos − pagos" solo vale si un pago no puede imputarse a un
   mes que no tiene cargo.** Si se permite pagar diciembre (sin cuota generada) debiendo junio,
   el socio queda con $10.000 de deuda y $10.000 a favor a la vez; `cargos − pagos = 0` lo
   mostraría "al día" con un mes adeudado. Habría que redefinir deuda = Σ pendiente por mes,
   crédito = Σ no aplicado, y tocar `dashboard_summary`, `monthly_history`, `debt_status`, los
   filtros del padrón y la pantalla de "Al día". **Decisión recomendada: la imputación explícita
   solo existe sobre meses con cargo** (cuota generada, mes de un saldo anterior con tramo, o la
   celda única del saldo viejo). Un adelanto sigue siendo "a cuenta": se aplica solo, del más
   viejo al más nuevo, como hoy. La grilla deja marcar adelantos **únicamente** cuando no queda
   ningún mes con cargo adeudado sin marcar, así lo que se ve es lo que la base hace. Con eso la
   identidad Σ pendiente = max(0, cargos − pagos) se conserva (demostración en §6.2) y ningún
   KPI cambia de definición. Lo marco como pregunta 2 de §12: si la Comisión quiere "pagar
   diciembre debiendo junio", es otro pipeline (deuda y crédito simultáneos).
2. **"Otro monto" no puede quedar "sin asignar hasta que se use".** Si un pago a cuenta queda
   flotando sin aplicarse, la ficha diría "Debe $10.000 · 1 mes" y "Saldo a favor $5.000" a la
   vez; para una Comisión que piensa en "¿cuánto debe?" eso es una contradicción. Además, la
   cuota generada por el cron tiene que absorber el saldo a favor sola (es lo que hoy significa
   "saldo a favor" en el sistema). **Decisión: lo no imputado se aplica en la lectura, del mes
   adeudado más viejo al más nuevo, después de las imputaciones explícitas.** Las imputaciones
   son hechos inmutables; la aplicación del crédito es una vista derivada, como hoy. §6.2.
3. **El backfill no es estrictamente necesario** (la regla derivada "del más viejo al más nuevo"
   sobre pagos sin imputar reproduce exactamente lo que se ve hoy). Pero sin backfill la historia
   cargada se comportaría distinto a lo nuevo cuando aparece un cargo más viejo (se "movería").
   **Decisión: backfill**, como pidió el usuario, con `source = 'backfill'` para que el libro
   diga que esas imputaciones las hizo la migración y no una persona, y con una **verificación
   dentro de la misma migración** que aborta si la cobertura de un solo cargo cambia (§9).
4. **`months_due` y `oldest_due_period` cambian para los saldos anteriores con tramo**, y es un
   arreglo, no un daño colateral: hoy `member_balance` cuenta el saldo con tramo como UN mes
   (`count(distinct period)` sobre `fees`), así que un socio que debe 10 meses previos aparece
   como "Debe desde octubre 2026 · 1 mes". Con el libro por mes pasa a "Debe desde enero 2026 ·
   10 meses". La deuda en pesos no cambia. Pregunta 1 de §12 (default: hacerlo).
5. **La regla de la fecha de alta no puede restringir las celdas, solo avisar.** Los importados
   tienen `joined_on = 2026-10-01` como placeholder y son indistinguibles de un alta real de
   octubre. Si la grilla ocultara los meses anteriores al alta, la carga inicial dejaría de poder
   cargar julio–septiembre. Por eso la regla es la que pidió el usuario: la fecha de alta corre
   el "desde cuándo" hacia atrás cuando es anterior al primer mes marcado, y cuando es posterior
   **avisa** (no bloquea) que hay que completarla. §6.4.
6. **No hay reimputación.** Un pago cargado a mayo que debió ser junio se anula (admin, con
   motivo) y se vuelve a cargar; igual que hoy con el monto. Permitir "mover" una imputación sería
   un UPDATE sobre historia. Lo digo explícito porque va a ser el primer pedido que llegue.

## 5. Opciones y descarte

### 5.1 Dónde guardar "qué meses paga un pago"

| Opción | Pro | Contra |
|---|---|---|
| **A. `payment_allocations (payment_id, period, amount_cents)`, por MES (recomendada)** | Es el vocabulario de la grilla (una celda = un mes); sirve igual para cuotas, meses de un saldo anterior con tramo y la celda del saldo viejo; sobrevive a anular y recargar el saldo anterior (los meses son los mismos aunque cambie el `fee_id`); dos deportes en un mes se cubren adentro del mes con el orden de siempre; el pozo no imputado sigue fluyendo | Una imputación a un mes cuyo cargo se anula después queda "sobrante" y vuelve al pozo (es lo deseable: la plata no se pierde) |
| B. `payment_allocations (payment_id, fee_id, amount_cents)`, por CARGO | Lo clásico en AR (factura ↔ pago) | Un mes con dos deportes son dos filas que la UI tendría que repartir; un saldo anterior con tramo es UN `fee_id` para 10 meses: habría que inventar una sub-clave de mes; anular y recargar el saldo anterior deja imputaciones huérfanas (FK a un cargo anulado); no hay `fee_id` para un adelanto |
| C. Una fila de `fees` por mes del saldo anterior + imputación por cargo | Modelo uniforme | Ya descartado en `2026-10-24-carga-inicial-meses` §5.1 (rompe `fees_one_opening_balance`, el guard, la anulación por fila, auditoría ×10) |
| D. Guardar los meses en `payments` como `jsonb`/`date[]` | Sin tabla nueva | Montos por mes sin tipo ni CHECK; imposible indexar o sumar en SQL con garantías; una columna mutable disfrazada |
| E. Reemplazar la deuda derivada por un saldo por mes almacenado | Lecturas triviales | Prohibido por CLAUDE.md ("un saldo almacenado es un saldo que se desincroniza") |

### 5.2 Qué pasa con lo no imputado (pago a cuenta, sobrantes)

| Opción | Pro | Contra |
|---|---|---|
| **A. Se aplica en la lectura, del mes adeudado más viejo al más nuevo, después de lo explícito (recomendada)** | Una sola definición de "cubierto"; el saldo a favor sigue absorbiendo la próxima cuota solo; `debt_status` y los KPIs no cambian; "falta $X" ya existe como estado | Un crédito puede "moverse" si aparece un cargo más viejo (hoy también pasa, y está asumido) |
| B. La RPC persiste imputaciones automáticas para el remanente al registrar | El libro cuenta todo | No puede imputar a meses futuros (no hay cargo), así que igual necesita la regla derivada: dos mecanismos para lo mismo; el libro mezcla intención del operador con decisiones de la máquina |
| C. Queda sin aplicar hasta que alguien lo impute | Control total | Deuda y crédito simultáneos en la ficha; el cron no absorbe el saldo a favor; hace falta una pantalla de "aplicar saldo" (fuera de alcance) |

### 5.3 Imputación a meses sin cargo (adelantos)

| Opción | Pro | Contra |
|---|---|---|
| **A. No se persiste: un adelanto es a cuenta y la grilla solo lo deja marcar cuando no queda nada con cargo adeudado (recomendada)** | Conserva `deuda = cargos − pagos`; cero cambios en KPIs, historia mensual y filtros; lo que se ve es lo que pasa | "Pagar diciembre debiendo junio" no existe (ver §4.1) |
| B. Se persiste y la deuda pasa a Σ pendiente por mes con crédito aparte | Permite cualquier combinación | Redefine deuda, crédito y `debt_status`; toca `dashboard_summary`, `monthly_history`, padrón, listados y los tests que los fijan. Otro pipeline |

### 5.4 Historia ya cargada

| Opción | Pro | Contra |
|---|---|---|
| **A. Backfill del más viejo al más nuevo, `source = 'backfill'`, verificado en la migración (recomendada)** | El libro queda uniforme; la historia no se mueve si aparece un cargo más viejo; el usuario lo pidió | Migración de datos en producción (set-based, idempotente por índice único, abortable por la verificación) |
| B. Sin backfill: los pagos viejos quedan a cuenta | Cero datos que transformar | Dos semánticas conviviendo; las celdas viejas dirían "cubierto" en vez de "pagado" |

### 5.5 Selección en la grilla

| Opción | Pro | Contra |
|---|---|---|
| **A. Conjunto de celdas: tocar alterna; arrastrar "pinta" (marca o desmarca según la celda de partida) (recomendada)** | Es el estándar (selección múltiple de un calendario); un toque = un mes; arrastrar sigue sirviendo para seis meses seguidos | Hay que pasar un estado base al arrastre (lo resuelve el hook) |
| B. Rango + "huecos" tocando dentro | Menos cambios en `tapCell` | Dos modelos mentales en la misma grilla; los huecos no se ven como decisión |
| C. Checkboxes clásicos | Obvio | Rompe la celda ya publicada (ícono + estado) y duplica el `aria-pressed` |

## 6. Arquitectura recomendada

### 6.1 Postgres (hilo principal, migración `supabase/migrations/20261029120000_payment_allocations.sql`, SQL en §9)

**Tabla `public.payment_allocations`** — "este pago cubrió este mes con tantos centavos".

- `id`, `payment_id → payments (restrict)`, `period date` (día 1, CHECK), `amount_cents bigint
  > 0`, `source text` ('marked' = lo marcó el operador, default; 'backfill' = la migración),
  `created_by uuid default auth.uid()`, `created_at`.
- Índice único `(payment_id, period)` (es también el índice de la FK). No hace falta índice por
  `period`: el libro se arma por socio (`payments_member_not_voided_idx` → allocations por
  `payment_id`).
- **Inmutable y sin borrado para nadie**: trigger `forbid_change` (`before update or delete`),
  igual que `fee_prices`; sin grant de UPDATE ni DELETE. **La anulación del pago apaga sus
  imputaciones sin tocarlas**: toda lectura une `payment_allocations` con `payments` y filtra
  `voided_at is null`. No hay nada que "anular" en la fila de imputación: el único interruptor es
  el del pago, que ya existe, ya es auditado y ya es solo de `payments.void`.
- **Guard `before insert` (SECURITY DEFINER en `private`, como `fees_opening_balance_guard`)**:
  bloquea la fila del socio (`for update`, serializa con otro lote, una baja y una corrección de
  alta) y la del pago; rechaza pago inexistente o anulado; Σ imputaciones del pago ≤ monto del
  pago; **el mes tiene que tener cargo vigente** (`private.member_period_charges`: cuota
  generada, mes del tramo del saldo anterior o celda del saldo viejo), si no "El mes MM/YYYY no
  tiene cuota generada: se cobra a cuenta"; y **Σ imputaciones explícitas vigentes al mes ≤ cargo
  del mes**, si no "El mes MM/YYYY ya está pago, o le falta menos de lo imputado. Actualizá la
  pantalla". Son invariantes: valen también por PostgREST directo.
- RLS: SELECT con `payments.read`; INSERT con `payments.register ∧ created_by = auth.uid()`.
  Grant de INSERT por columna `(payment_id, period, amount_cents)`: `source` no se puede mandar
  desde la app (solo la migración escribe 'backfill'). `select` para `authenticated,
  service_role`. `enable_audit`.

**Funciones nuevas en `private` (INVOKER, STABLE):**

- `member_period_charges(member_id)` → `(period, kind, charged_cents, opening_cents,
  monthly_cents, opening_fee_id, opening_from)`: UNA definición de "qué se debe cada mes". Cuotas
  no anuladas sumadas por período; saldo anterior con tramo expandido en celdas con la regla de
  reparto vigente (partes enteras, resto en el último mes); saldo viejo sin tramo = una celda en
  su período.
- `member_period_ledger(member_id)` → por mes: `charged_cents`, `allocated_cents` (imputado por
  pagos no anulados), `explicit_covered_cents = least(charged, allocated)`,
  `credit_covered_cents`, `covered_cents`, `pending_cents`, más `opening_*`. El **pozo** = pagos
  no anulados − Σ explícito aplicado (incluye pagos a cuenta, sobrantes y lo imputado a cargos
  después anulados) fluye del mes más viejo al más nuevo sobre `charged − explicit_covered`.

**Funciones redefinidas (misma firma, `create or replace`, grants conservados):**

- `private.member_fee_coverage`: por cargo, desde el libro. Saldo anterior con tramo = Σ de sus
  celdas; dentro de un mes, lo cubierto se reparte entre las cuotas en el orden de siempre (saldo,
  social, deportes por id). `member_fee_statement` y `debt_by_category` **no cambian**.
- `private.member_balance`: `charged/paid/balance` como hoy (cargos − pagos); `months_due` y
  `oldest_due_period` desde el libro (`pending > 0`). `member_accounts`, los campos calculados
  del padrón y los listados **no cambian** de firma.
- `public.register_payment_batch` (misma firma, mismo retorno): cada ítem admite
  `"allocations": [{ "period": "2026-05-01", "amount_cents": 1000000 }]`. Valida forma (array,
  día 1, > 0, sin meses repetidos, ≤ 60, Σ ≤ `amount_cents`), inserta los pagos como hoy y
  después UN insert de imputaciones; el guard hace el resto. El saldo anterior del mismo ítem se
  inserta antes, así las imputaciones a sus meses encuentran el cargo en la misma transacción.
  Reintento por `batch_id`: igual que hoy, no toca nada.

**Redefinida con columnas nuevas (`drop` + `create` en la misma transacción, re-grant):**

- `public.payment_month_options`: celdas desde el libro. Nuevas columnas
  `credit_covered_cents` (cuánto de lo cubierto es crédito aplicado y no imputación explícita:
  la celda dice "cubierto" en vez de "pagado") y `before_joined` (solo `pre_system`: el mes es
  anterior al mes de `joined_on`). Ventana igual que hoy (`period >= first_due`, y todo el tramo
  mientras no empezó la facturación): con huecos, un mes pago posterior al primer adeudado se
  muestra como "pagado" no elegible.

**No cambian**: `payments`, `fees` y sus triggers, `month_collection`, `daily_collection`,
`cash_month_summary`, `dashboard_summary`, `monthly_history`, `member_fee_statement`,
`debt_by_category`, `member_accounts`, `log_export`, el generador mensual, pg_cron.

### 6.2 La regla, una sola vez

Para un socio, meses ordenados del más viejo al más nuevo:

1. **Imputación explícita primero**: cada mes recibe lo que los pagos no anulados le imputaron,
   hasta su cargo (`explicit_covered = min(cargo, imputado)`). Lo imputado de más (cargo anulado,
   cargo menor) no se pierde: cae al pozo.
2. **El pozo** = Σ pagos no anulados − Σ explicit_covered. Fluye del mes adeudado más viejo al
   más nuevo sobre lo que cada mes todavía tiene sin cubrir. Lo que sobra después de todos los
   cargos es **saldo a favor** y se aplica a los meses proyectados en el mismo orden (como hoy).
3. `pendiente(mes) = cargo − explicit − crédito`. Identidad: Σ cubierto = Σ explicit +
   min(pozo, Σ huecos) = min(pagos, cargos), así que **Σ pendiente = max(0, cargos − pagos)** y
   **saldo a favor = max(0, pagos − cargos)**: la deuda total, `debt_status`, `total_debt_cents`,
   `inactive_debt_cents` y `credit_cents` valen exactamente lo mismo que hoy. El backfill no cambia
   ni un centavo (lo verifica la migración).

Consecuencias que la UI tiene que mostrar:

- **Mes pagado a medias** ("falta $X"): por imputación parcial ("Otro monto" menor a lo marcado),
  por crédito que no alcanzó, o por una cuota generada a un valor mayor al adelanto. La celda
  sigue elegible por el resto.
- **Mes cubierto por crédito** ("cubierto"): `credit_covered > 0 ∧ pending = 0`. No elegible.
- **Mes pagado** ("pagado"): explícito. No elegible.
- Marcar un mes que se mostraba cubierto por crédito es imposible (no elegible). Si otro
  operador lo imputa explícito a la vez, el crédito se corre al siguiente mes adeudado: la plata
  no se pierde y el libro queda coherente.

### 6.3 "Otro monto" (decisión 2 del usuario)

El monto tipeado se imputa **a los meses marcados, en orden, hasta el pendiente de cada uno**;
lo que sobra queda **a cuenta** (sin fila) y la base lo aplica en la lectura al mes adeudado más
viejo que no esté marcado, y después a los proyectados; lo que sobra de todo eso es saldo a
favor. La grilla muestra en vivo las tres cosas con vocabulario distinto: "cubre $A de $B" en el
marcado parcial, "se cubre" en los no marcados que absorben el remanente, y "Queda saldo a favor
de $X" en la línea del pie. Sin nada marcado (socio sin tira, o todo desmarcado) el pago es
100 % a cuenta: el comportamiento de hoy, celda por celda.

### 6.4 Meses previos y fecha de alta (decisión 1 del usuario)

Sea `J` = mes de `members.joined_on` ("fecha de alta" en la UI; se corrige por
`correct_member_joined_on`), `F` = primer mes previo marcado, `P` = último mes previo (antes del
inicio: el mes actual; después: inicio − 1), `W` = primer mes de la ventana de 12.

- **Tramo del saldo anterior**: `from = min(F, max(J, W))`, `to = P`. Si la fecha de alta es
  anterior al primer mes marcado, la deuda corre desde la fecha de alta (acotada a la ventana);
  los meses entre `from` y `P` que no se marcan quedan adeudados ("queda debiendo"). Si la fecha
  de alta es posterior al primer mes marcado (el placeholder de los importados, o una fecha mal
  cargada), el tramo arranca en `F` **y la UI avisa**: "Marcaste meses anteriores a la fecha de
  alta (octubre 2026). Si pagó esos meses, la fecha de alta está mal: corregila desde la ficha",
  con link a `/socios/[id]/editar`. No bloquea.
- La RPC marca `before_joined = true` en las celdas `pre_system` con `period < J`. Con eso la
  vista calcula `from` y el aviso sin un campo nuevo en `MemberAccount`.
- **Pago**: cubre solo lo marcado (imputaciones explícitas a esos meses). Un segundo pago
  histórico marca cualquier mes del tramo todavía pendiente (abril y junio, salteando mayo).
- **`fees.from_period/to_period`** siguen inmutables; el reparto en partes enteras con el resto en
  el último mes (`splitOpeningTotal`) sigue igual y ahora vive en `member_period_charges`. El
  total corregido a mano (`OpeningTotalField`) sigue siendo el total del tramo.
- **Anular y recargar el saldo anterior** (único camino para cambiar "desde cuándo"): las
  imputaciones a meses del tramo viejo **se conservan por mes**; si el tramo nuevo incluye esos
  meses, quedan pagos sin volver a cargar nada; si no los incluye, caen al pozo y se aplican al
  más viejo. Mejor que hoy, donde todo el pago pasa a saldo a favor.
- **Cron y `joined_on`**: no hay doble cobro posible (§3). Si alguien corrige `joined_on` hacia
  atrás a un mes `>= inicio`, la próxima corrida genera esas cuotas y los pagos a cuenta las
  cubren del más viejo; las imputaciones explícitas a meses posteriores no se mueven (es lo que
  el usuario pidió).
- En la ficha ("Indicar desde cuándo debía", sin pago) rige la misma regla: tocar un mes previo
  fija `F`; `from = min(F, max(J, W))`; mismo aviso si `F < J`.

### 6.5 Modelos, controllers, vistas (MVC)

- `src/models/types.ts` (contrato, hilo principal): `PaymentMonthOption` suma
  `creditCoveredCents: number` y `beforeJoined: boolean`; nuevo
  `PaymentAllocationInput = { period: ISODate; amountCents: number }`; el ítem de
  `registerPayment` suma `allocations?: PaymentAllocationInput[] | null`. `RegisterPaymentResult`
  no cambia.
- `src/lib/dates.ts` (hilo principal): `periodListLabel(periods: string[]): string` → "mayo",
  "mayo a julio 2026" si son contiguos (reusa `periodRangeLabel`), "mayo, julio y septiembre
  2026" si no; año una sola vez si es el mismo.
- `accounts.model.ts`: mapea las dos columnas nuevas. `payments.model.ts`: `paymentItemSchema`
  con `allocations` (array ≤ 60, períodos día 1 únicos, montos enteros > 0, Σ ≤ `amountCents`),
  los manda en `items`; traduce los dos mensajes nuevos del guard (23514 con texto propio ya
  pasa por `isRawPostgresMessage`). `payments.actions.ts`: sin cambio de firma.
- Vistas: `month-selection.ts` pasa de rango a conjunto (§7); `month-strip.tsx` (toggle, pintar,
  "cubierto", adelanto deshabilitado con motivo, aviso de alta); `month-entry.tsx` (base del
  arrastre, resumen con lista de meses, `allocationsFromSelection`); `payment-form.tsx` y
  `group-payment-form.tsx` mandan `allocations`; `members/opening-balance-months.tsx` (regla
  de `J`, aviso); `member-account-section.tsx` (link a editar en el aviso).
- Sin servicios nuevos, sin rutas nuevas, sin cambios de permisos.

### 6.6 Flujo

1. Abrir el overlay → `getPaymentFormData` → `member_accounts` + `payment_month_options` (una
   llamada cada una, N socios).
2. Tocar/arrastrar → `month-selection` deriva: imputaciones (meses con cargo marcados, por su
   pendiente efectivo), saldo anterior (`from/to/total`) si hay previos marcados, monto = Σ, y
   "queda debiendo".
3. Registrar → `registerPayment({ batchId, items: [{ memberId, amountCents, openingBalance,
   allocations }] })` → `register_payment_batch` → una transacción: saldo anterior → pagos →
   imputaciones (guard) → auditoría con `auth.uid()`.
4. Reintento (mismo `batchId`) → lock → `already_registered`, sin tocar nada.
5. Lecturas: ficha, padrón, listados y panel leen el libro por sus RPC de siempre.

## 7. Grilla: de rango a conjunto (brief para `frontend-react-craftsman`)

Hereda `.impeccable/surfaces/route-caja.md` y `route.md` (Operate, naranja y blanco, Linear /
Mercado Pago). **El agente actualiza `route-caja.md`**: el párrafo del overlay ("Tocar un mes
marca todo hasta ese mes…") y el anti-objetivo "una pantalla de imputación libre de meses" se
reemplazan por lo de abajo. Mobile first: se verifica a 390 px, con una mano, antes que nada.

- **Tocar alterna** una celda elegible (`pendingCents > 0`). Enter/Espacio igual. `aria-pressed`
  sigue siendo la verdad.
- **Arrastrar pinta**: la celda de partida decide el modo (si estaba sin marcar, el arrastre
  marca; si estaba marcada, desmarca) y se aplica al rango entre ancla y celda actual **sobre la
  selección que había al empezar** (las celdas fuera del rango no cambian). Mouse arma al entrar
  en otra celda; dedo por mantener apretado (250 ms, igual que hoy). `pointercancel` deja lo que
  hubiera. El `click` posterior se descarta (ya resuelto).
- **Adelantos** (`projected`): elegibles solo cuando no queda ningún mes con cargo adeudado sin
  marcar (incluidos los previos del tramo). Antes de eso se ven con su estado ("adelanto") pero
  atenuados y `aria-disabled`; tocarlos muestra una línea `role="status"`: "Para adelantar meses,
  primero marcá los que debe." Marcar el último adeudado los habilita sin recargar.
- **Meses previos**: tocar uno lo marca (si es el más viejo marcado pasa a ser `F`); los previos
  entre `from` y `P` sin marcar dicen "queda debiendo" (ya existe). Si hay marcados con
  `beforeJoined`, debajo de la grilla: el aviso de §6.4 con el link.
- **Resumen**: "3 meses · mayo, julio y septiembre" (`periodListLabel`); "6 meses · enero a
  junio" si son contiguos. El momento de éxito dice "Cubre may, jul y sep".
- **Ayuda** bajo la grilla: "Tocá cada mes que pagó, o mantené apretado y arrastrá" (coarse) /
  "Tocá cada mes que pagó, o arrastrá" (fine). Desaparece "Tocá el primer y el último mes".
- **Celdas**: "pagado" (explícito), "cubierto" (crédito), "debe", "falta $X", "este mes",
  "adelanto", "antes del sistema", "queda debiendo". Un ícono distinto por estado (ya existe),
  nunca solo color; un mes `cubierto` lleva el mismo ícono de `covered` de hoy.
- **Selección inicial**: activo → el mes con cargo adeudado más viejo; de baja → todos los
  adeudados con cargo (sin adelantos); antes del inicio → el mes actual (previo). Igual que hoy.
- **"Otro monto"**: §6.3; la grilla se abre y muestra cubre / se cubre / saldo a favor.
- **"Queda debiendo N meses · $X"**: Σ pendiente efectivo de los meses con cargo no marcados +
  los previos del tramo no marcados, menos lo que el remanente de "Otro monto" cubre. Es la
  línea que defiende al operador que marcó de menos.
- Pago de grupo: lo mismo por integrante, grilla compacta y colapsada por defecto (como hoy).
- Ficha ("Indicar desde cuándo debía"): sigue sin pago y sin arrastre; tocar fija `F`; el tramo
  es `from..P` por la regla de §6.4; mismo aviso de fecha de alta.
- Estados: carga, vacío, error y envío ya existen y no cambian. Sin modales nuevos.
- Verificación manual obligatoria (no hay jsdom): iOS y Android reales, scroll vertical sobre la
  grilla, mantener apretado y pintar, pintar al revés (desmarcar), teclado, lector de pantalla.

## 8. Transversales

- **Permisos**: todo con `payments.register` (leer celdas, registrar, imputar); `consulta` lee
  `payment_allocations` con `payments.read` (ve estados de cuenta, como lee `payments`) y no
  escribe. Anular sigue siendo `payments.void`. Nada por rol.
- **Auditoría**: `payment_allocations` auditada por trigger; actor `auth.uid()` (la RPC es
  INVOKER); el backfill queda como `system`. Anular un pago ya deja su rastro; sus imputaciones
  no se tocan.
- **Nada se borra**: tabla sin UPDATE ni DELETE, `forbid_change` para todos. Cambiar una
  imputación = anular el pago y cargar otro.
- **Dinero**: centavos; la única suma del cliente sigue siendo la del monto a enviar (y ahora las
  imputaciones por celda, que son los pendientes que la RPC devolvió); Σ, deuda, KPIs en SQL.
- **Zona horaria**: `private.club_today()`; nada nuevo con `new Date()`.
- **Datos personales**: nada nuevo viaja ni se loguea (ids y períodos).
- **Concurrencia**: lock por `batch_id` (reintentos) + fila del socio (`for update` en el guard:
  dos operadores imputando el mismo mes del mismo socio se serializan; el segundo recibe "ya está
  pago… actualizá la pantalla").
- **Fallas**: RPC de lectura falla → `ErrorState` del sheet; escritura falla → todo revertido;
  reintento con el mismo `batchId`. Mensajes del guard viajan como `DomainError`.
- **Cache**: `revalidatePath('/', 'layout')` en toda escritura, como hoy.
- **Migración**: aditiva + backfill verificado en la misma transacción (aborta si un cargo cambia
  de cobertura). Compatible hacia atrás para el código viejo (ítems sin `allocations` siguen
  funcionando: a cuenta = comportamiento de hoy). Orden de despliegue: **migración antes que el
  código nuevo**. El código nuevo contra el schema viejo no falla: `jsonb_to_recordset` ignora la
  clave `allocations` y el pago queda registrado **a cuenta**, sin error y sin perder plata, pero
  perdiendo la imputación que el operador marcó. Por eso se migra primero y fuera del horario de
  carga. Reversa: restaurar las cuatro funciones anteriores (20261024170000 y 20260927130200),
  `drop table payment_allocations` (se pierde la intención del operador, nunca la plata: la deuda
  total no depende de la tabla).
- **Caja aislada**: `cash_movements` no entra en ninguna función tocada; `cash-isolation.test.ts`
  sigue pasando tal cual (foto antes/después con el mismo schema).
- **Performance**: el libro por socio son tres consultas indexadas; `payment_month_options` para
  un grupo de 6 corre 6 libros. `debt_by_category` corre un libro por socio activo (~250): igual
  orden que hoy (`member_fee_coverage` ya era por socio). Nada supera `max_rows`.

## 9. SQL propuesto (lo copia el hilo principal; nombre sugerido `20261029120000_payment_allocations.sql`)

**No se corrió contra ninguna base.** Lo escribí con el mismo estilo de las migraciones vigentes;
el hilo principal lo aplica con `npm run db:reset`, corre `tests/db/` y corrige lo que haga
falta. Puntos que conviene mirar primero al aplicarlo: la tabla temporal (`supabase migration
up` corre cada archivo en una transacción, así que la foto vive hasta el final; si no fuera así,
igual se dropea explícitamente), los nombres de las CTE (ninguna se llama `rows`, que es palabra
clave) y los `#variable_conflict use_column`.

```sql
-- =============================================================================
-- Imputación explícita de pagos a meses.
--
-- Pipeline: docs/pipelines/2026-10-29-imputacion-libre-meses/ (00-architecture §6, §9).
--
-- Hasta acá un pago era un pozo por socio y la cobertura de cada cargo se
-- derivaba del más viejo al más nuevo (balance forward). Un pago no podía
-- decir "fue mayo y julio, junio sigue debiendo". Desde acá:
--   * payment_allocations: "este pago cubrió este MES con tantos centavos".
--     Por mes, no por cargo: es el vocabulario de la grilla, sirve igual para
--     cuotas y para los meses de un saldo anterior con tramo, y sobrevive a
--     anular y recargar el saldo (los meses son los mismos aunque cambie el id).
--     Append-only, sin UPDATE ni DELETE para nadie. La anulación del pago apaga
--     sus imputaciones sin tocarlas: toda lectura filtra payments.voided_at.
--   * private.member_period_charges: qué se debe cada mes (UNA definición).
--   * private.member_period_ledger: por mes, imputado explícito primero y el
--     pozo no imputado (pagos a cuenta, sobrantes) del más viejo al más nuevo.
--     Σ pendiente = max(0, cargos − pagos): la deuda total no cambia de definición.
--   * member_fee_coverage, member_balance, payment_month_options y
--     register_payment_batch se redefinen sobre el libro.
--   * Backfill: cada pago vigente queda imputado como el sistema lo mostraba
--     hoy (del más viejo al más nuevo). La migración aborta si la cobertura de
--     UN cargo cambia.
--
-- Solo se imputa a meses con cargo vigente: un adelanto queda a cuenta y se
-- aplica solo (§4.1 del pipeline).
--
-- Reversa: restaurar payment_month_options y register_payment_batch de
-- 20261024170000, member_fee_coverage y member_balance de 20260927130200;
-- drop de las funciones y la tabla nuevas (se pierde la intención del
-- operador, nunca la plata: la deuda no depende de la tabla).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Foto de la cobertura vigente, ANTES de tocar nada. La verificación final
--    (sección 7) compara contra esto y aborta la migración si algo cambió.
-- -----------------------------------------------------------------------------
create temp table imputacion_old_coverage as
select m.id as member_id, cv.fee_id, cv.covered_cents
from public.members m
cross join lateral private.member_fee_coverage(m.id) cv;

-- -----------------------------------------------------------------------------
-- 1. Cargos por mes: UNA definición de "qué se debe en cada mes".
--    Cuotas no anuladas sumadas por período (dos deportes = un mes); saldo
--    anterior con tramo expandido en una celda por mes con la regla de reparto
--    de 20261024170000 (partes enteras, el resto en el último mes); saldo viejo
--    sin tramo = una celda en su período (inicio − 1).
-- -----------------------------------------------------------------------------
create function private.member_period_charges(p_member_id bigint)
returns table (
  period date,
  kind text,
  charged_cents bigint,
  opening_cents bigint,
  monthly_cents bigint,
  opening_fee_id bigint,
  opening_from date
)
language sql
stable
set search_path = ''
as $$
  with monthly as (
    select f.period, sum(f.amount_cents)::bigint as cents
    from public.fees f
    where f.member_id = p_member_id and f.voided_at is null and f.kind <> 'opening_balance'
    group by f.period
  ),
  opening as (
    select f.id, f.period, f.amount_cents, f.from_period, f.to_period
    from public.fees f
    where f.member_id = p_member_id and f.voided_at is null and f.kind = 'opening_balance'
  ),
  opening_span as (
    select o.id, gs::date as period, o.from_period,
           row_number() over (partition by o.id order by gs) as k,
           count(*) over (partition by o.id) as n,
           o.amount_cents as total
    from opening o
    cross join generate_series(o.from_period, o.to_period, interval '1 month') gs
    where o.from_period is not null
  ),
  opening_cells as (
    select s.id, s.period, s.from_period,
           (case when s.k < s.n then s.total / s.n else s.total - (s.n - 1) * (s.total / s.n) end)::bigint as cents
    from opening_span s
    union all
    select o.id, o.period, null::date, o.amount_cents
    from opening o
    where o.from_period is null
  )
  select
    coalesce(oc.period, mo.period),
    case when oc.id is not null then 'opening_balance' else 'monthly' end,
    (coalesce(oc.cents, 0) + coalesce(mo.cents, 0))::bigint,
    coalesce(oc.cents, 0)::bigint,
    coalesce(mo.cents, 0)::bigint,
    oc.id,
    oc.from_period
  from opening_cells oc
  full outer join monthly mo on mo.period = oc.period
  order by 1;
$$;

-- -----------------------------------------------------------------------------
-- 2. payment_allocations (antes que el libro: una función `language sql` se
--    valida al crearse y el libro la lee).
-- -----------------------------------------------------------------------------
create table public.payment_allocations (
  id bigint generated always as identity primary key,
  payment_id bigint not null references public.payments (id) on delete restrict,
  period date not null check (period = date_trunc('month', period)::date),
  amount_cents bigint not null check (amount_cents > 0),
  -- 'marked': el operador marcó el mes en la grilla. 'backfill': la migración
  -- que repartió los pagos previos del más viejo al más nuevo. Sin grant de
  -- INSERT sobre esta columna: desde la app siempre es 'marked'.
  source text not null default 'marked' check (source in ('marked', 'backfill')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.payment_allocations is
  'Qué MES cubrió cada pago y con cuántos centavos. Append-only: una imputación equivocada se corrige anulando el pago (que apaga sus imputaciones) y cargando otro. Lo no imputado queda a cuenta y se aplica en la lectura del mes más viejo al más nuevo.';

-- Un pago imputa a un mes una sola vez. Es también el índice de la FK.
create unique index payment_allocations_payment_period_key
  on public.payment_allocations (payment_id, period);

-- Historia: ni UPDATE ni DELETE, para nadie (igual que fee_prices).
create trigger payment_allocations_no_change
  before update or delete on public.payment_allocations
  for each row execute function private.forbid_change();

-- Invariantes (valen también por PostgREST directo):
--   - el pago existe y no está anulado;
--   - Σ imputaciones del pago <= monto del pago;
--   - el mes tiene cargo vigente (cuota generada, mes del tramo del saldo
--     anterior o la celda del saldo viejo): un adelanto no se imputa, queda a
--     cuenta y se aplica solo;
--   - Σ imputaciones explícitas vigentes al mes <= cargo del mes.
-- DEFINER (review B4): la invariante no depende de la RLS de quien escribe.
-- Bloquea la fila del socio: dos operadores imputando el mismo mes del mismo
-- socio se serializan y el segundo ve la imputación del primero.
create function private.payment_allocations_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay record;
  already bigint;
  cell record;
  explicit_in_period bigint;
begin
  select p.id, p.member_id, p.amount_cents, p.voided_at
  into pay
  from public.payments p
  where p.id = new.payment_id
  for update;

  if not found then
    raise exception 'El pago no existe' using errcode = 'foreign_key_violation';
  end if;
  if pay.voided_at is not null then
    raise exception 'Un pago anulado no se imputa' using errcode = 'check_violation';
  end if;

  perform 1 from public.members m where m.id = pay.member_id for update;

  select coalesce(sum(a.amount_cents), 0) into already
  from public.payment_allocations a
  where a.payment_id = new.payment_id;
  if already + new.amount_cents > pay.amount_cents then
    raise exception 'Lo imputado supera el monto del pago' using errcode = 'check_violation';
  end if;

  select c.charged_cents into cell
  from private.member_period_charges(pay.member_id) c
  where c.period = new.period;
  if not found or cell.charged_cents <= 0 then
    raise exception 'El mes % no tiene cuota generada: se cobra a cuenta', to_char(new.period, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(a.amount_cents), 0) into explicit_in_period
  from public.payment_allocations a
  join public.payments p on p.id = a.payment_id
  where p.member_id = pay.member_id and p.voided_at is null and a.period = new.period;
  if explicit_in_period + new.amount_cents > cell.charged_cents then
    raise exception 'El mes % ya está pago, o le falta menos de lo imputado. Actualizá la pantalla y volvé a intentar', to_char(new.period, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger payment_allocations_insert_guard
  before insert on public.payment_allocations
  for each row execute function private.payment_allocations_insert_guard();

alter table public.payment_allocations enable row level security;
alter table public.payment_allocations force row level security;

create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using ((select private.can('payments.read')));
create policy payment_allocations_insert on public.payment_allocations
  for insert to authenticated
  with check (
    (select private.can('payments.register'))
    and created_by = (select auth.uid())
  );

revoke all on public.payment_allocations from anon, authenticated, service_role;
grant select on public.payment_allocations to authenticated, service_role;
grant insert (payment_id, period, amount_cents) on public.payment_allocations to authenticated;

select private.enable_audit('public.payment_allocations');

-- -----------------------------------------------------------------------------
-- 3. El libro por mes. Imputación explícita primero (hasta el cargo del mes);
--    el pozo = pagos no anulados − Σ explícito aplicado (pagos a cuenta,
--    sobrantes, lo imputado a un cargo después anulado) fluye del mes más viejo
--    al más nuevo sobre lo que cada mes todavía tiene sin cubrir.
--    Identidad: Σ covered = min(pagos, cargos) → Σ pending = max(0, cargos − pagos).
-- -----------------------------------------------------------------------------
create function private.member_period_ledger(p_member_id bigint)
returns table (
  period date,
  kind text,
  charged_cents bigint,
  opening_cents bigint,
  monthly_cents bigint,
  allocated_cents bigint,
  explicit_covered_cents bigint,
  credit_covered_cents bigint,
  covered_cents bigint,
  pending_cents bigint,
  opening_fee_id bigint,
  opening_from date
)
language sql
stable
set search_path = ''
as $$
  with charges as (
    select * from private.member_period_charges(p_member_id)
  ),
  explicit as (
    select a.period, sum(a.amount_cents)::bigint as allocated
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    where p.member_id = p_member_id and p.voided_at is null
    group by a.period
  ),
  paid as (
    select coalesce(sum(p.amount_cents), 0)::bigint as total
    from public.payments p
    where p.member_id = p_member_id and p.voided_at is null
  ),
  lines as (
    select
      coalesce(c.period, e.period) as period,
      coalesce(c.kind, 'monthly') as kind,
      coalesce(c.charged_cents, 0)::bigint as charged,
      coalesce(c.opening_cents, 0)::bigint as opening,
      coalesce(c.monthly_cents, 0)::bigint as monthly,
      coalesce(e.allocated, 0)::bigint as allocated,
      least(coalesce(c.charged_cents, 0), coalesce(e.allocated, 0))::bigint as explicit_covered,
      c.opening_fee_id,
      c.opening_from
    from charges c
    full outer join explicit e on e.period = c.period
  ),
  pooled as (
    select
      l.*,
      (select paid.total from paid) - sum(l.explicit_covered) over () as pool,
      coalesce(sum(l.charged - l.explicit_covered) over (order by l.period rows between unbounded preceding and 1 preceding), 0) as gap_before
    from lines l
  ),
  applied as (
    select
      p.*,
      greatest(0, least(p.charged - p.explicit_covered, p.pool - p.gap_before))::bigint as credit_covered
    from pooled p
  )
  select
    a.period, a.kind, a.charged, a.opening, a.monthly, a.allocated,
    a.explicit_covered,
    a.credit_covered,
    (a.explicit_covered + a.credit_covered)::bigint,
    (a.charged - a.explicit_covered - a.credit_covered)::bigint,
    a.opening_fee_id,
    a.opening_from
  from applied a
  order by a.period;
$$;

-- -----------------------------------------------------------------------------
-- 4. Backfill: cada pago vigente queda imputado como el sistema lo mostraba
--    hoy. Pagos ordenados por (paid_on, id) y meses con cargo por período son
--    dos secuencias acumuladas; la imputación de un pago a un mes es el solape
--    de sus intervalos [acumulado anterior, acumulado). Lo que sobra (saldo a
--    favor) no se inserta: sigue siendo a cuenta. Corre como postgres: la
--    auditoría lo registra como 'system'.
-- -----------------------------------------------------------------------------
insert into public.payment_allocations (payment_id, period, amount_cents, source, created_by)
with cells as (
  select
    m.id as member_id,
    c.period,
    c.charged_cents,
    sum(c.charged_cents) over (partition by m.id order by c.period) as c_hi
  from public.members m
  cross join lateral private.member_period_charges(m.id) c
  where c.charged_cents > 0
),
pays as (
  select
    p.id,
    p.member_id,
    p.amount_cents,
    sum(p.amount_cents) over (partition by p.member_id order by p.paid_on, p.id) as p_hi
  from public.payments p
  where p.voided_at is null
),
overlap as (
  select
    p.id as payment_id,
    c.period,
    least(p.p_hi, c.c_hi) - greatest(p.p_hi - p.amount_cents, c.c_hi - c.charged_cents) as cents
  from pays p
  join cells c on c.member_id = p.member_id
)
select o.payment_id, o.period, o.cents::bigint, 'backfill', null::uuid
from overlap o
where o.cents > 0
order by o.payment_id, o.period;

-- -----------------------------------------------------------------------------
-- 5. Cobertura por cargo y saldo, sobre el libro (mismas firmas; create or
--    replace conserva los grants).
-- -----------------------------------------------------------------------------

-- Por cargo: el saldo anterior con tramo = Σ de sus celdas; dentro de un mes,
-- lo cubierto se reparte entre sus cuotas en el orden de siempre (saldo
-- anterior, social, deportes por id). Anulados con cobertura 0, como hoy.
create or replace function private.member_fee_coverage(p_member_id bigint)
returns table (
  fee_id bigint,
  period date,
  kind text,
  description text,
  amount_cents bigint,
  covered_cents bigint,
  category_id bigint,
  discipline_id bigint,
  voided_at timestamptz,
  void_reason text,
  sort_key bigint
)
language sql
stable
set search_path = ''
as $$
  with ledger as (
    select * from private.member_period_ledger(p_member_id)
  ),
  -- Lo cubierto de un mes que corresponde a las cuotas (no al saldo): la celda
  -- del saldo anterior va primero en el orden del mes.
  monthly_covered as (
    select l.period, (l.covered_cents - least(l.opening_cents, l.covered_cents))::bigint as cents
    from ledger l
  ),
  ordered as (
    select
      f.*,
      row_number() over w as rn,
      sum(f.amount_cents) filter (where f.voided_at is null) over (
        partition by f.period
        order by case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id
        rows between unbounded preceding and current row
      ) as cum_in_period
    from public.fees f
    where f.member_id = p_member_id
    window w as (order by f.period, case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id)
  )
  select
    o.id,
    o.period,
    o.kind,
    o.description,
    o.amount_cents,
    case
      when o.voided_at is not null then 0::bigint
      when o.kind = 'opening_balance' then
        coalesce((select sum(least(l.opening_cents, l.covered_cents)) from ledger l where l.opening_fee_id = o.id), 0)::bigint
      else
        greatest(0, least(
          o.amount_cents,
          coalesce((select mc.cents from monthly_covered mc where mc.period = o.period), 0)
            - (o.cum_in_period - o.amount_cents)
        ))::bigint
    end,
    o.category_id,
    o.discipline_id,
    o.voided_at,
    o.void_reason,
    o.rn
  from ordered o;
$$;

-- Totales como hoy (cargos − pagos); meses adeudados y el más viejo desde el
-- libro: un saldo anterior con tramo cuenta sus meses, no "1".
create or replace function private.member_balance(p_member_id bigint)
returns table (
  charged_cents bigint,
  paid_cents bigint,
  balance_cents bigint,
  months_due integer,
  oldest_due_period date,
  last_payment_on date,
  last_payment_cents bigint
)
language sql
stable
set search_path = ''
as $$
  with paid as (
    select coalesce(sum(p.amount_cents), 0)::bigint as total
    from public.payments p
    where p.member_id = p_member_id and p.voided_at is null
  ),
  charged as (
    select coalesce(sum(f.amount_cents), 0)::bigint as total
    from public.fees f
    where f.member_id = p_member_id and f.voided_at is null
  ),
  last_payment as (
    select p.paid_on, p.amount_cents
    from public.payments p
    where p.member_id = p_member_id and p.voided_at is null
    order by p.paid_on desc, p.id desc
    limit 1
  ),
  due as (
    select count(*)::integer as months, min(l.period) as oldest
    from private.member_period_ledger(p_member_id) l
    where l.pending_cents > 0
  )
  select
    charged.total,
    paid.total,
    charged.total - paid.total,
    due.months,
    due.oldest,
    (select lp.paid_on from last_payment lp),
    (select lp.amount_cents from last_payment lp)
  from charged, paid, due;
$$;

-- -----------------------------------------------------------------------------
-- 6. payment_month_options: celdas desde el libro. Columnas nuevas (drop + create):
--      credit_covered_cents  cuánto de lo cubierto es crédito aplicado (no
--                            imputación explícita): la celda dice "cubierto";
--      before_joined         solo pre_system: el mes es anterior al mes de alta.
--    Con huecos, un mes pago posterior al primer adeudado se muestra "pagado".
-- -----------------------------------------------------------------------------
drop function public.payment_month_options(bigint[]);

create function public.payment_month_options(member_ids bigint[])
returns table (
  member_id bigint,
  period date,
  kind text,
  amount_cents bigint,
  covered_cents bigint,
  pending_cents bigint,
  is_current boolean,
  priced_at_today boolean,
  opening_from date,
  credit_covered_cents bigint,
  before_joined boolean
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
  if start_period is null then
    return;
  end if;

  return query
  with target as (
    select
      m.id,
      m.status,
      date_trunc('month', m.joined_on)::date as joined_period,
      coalesce(
        nullif(private.member_fee_price_at(m.id, current_period), 0),
        private.member_fee_price_at(m.id, greatest(current_period, start_period))
      ) as price_today,
      exists (
        select 1 from public.fees f
        where f.member_id = m.id and f.kind = 'opening_balance' and f.voided_at is null
      ) as has_opening_balance,
      coalesce((select sum(p.amount_cents) from public.payments p
                where p.member_id = m.id and p.voided_at is null), 0)::bigint as paid_cents
    from public.members m
    where m.id = any (payment_month_options.member_ids)
  ),
  ledger as (
    select t.id as member_id, l.period, l.kind, l.charged_cents, l.covered_cents, l.pending_cents,
           l.credit_covered_cents, l.opening_from
    from target t
    cross join lateral private.member_period_ledger(t.id) l
    where l.charged_cents > 0
  ),
  first_due as (
    select l.member_id, min(l.period) as period
    from ledger l
    where l.pending_cents > 0
    group by l.member_id
  ),
  billed as (
    select l.*
    from ledger l
    left join first_due fd on fd.member_id = l.member_id
    where l.period >= coalesce(fd.period, current_period)
       -- Carga inicial: mientras no empezó la facturación se ve todo el tramo, también lo pago.
       or (l.kind = 'opening_balance' and current_period < start_period)
  ),
  credit as (
    -- Lo que sobra después de cubrir todos los cargos (identidad del libro):
    -- va a los proyectados, del más viejo al más nuevo.
    select
      t.id as member_id,
      greatest(0, t.paid_cents - coalesce((select sum(l.charged_cents) from ledger l where l.member_id = t.id), 0))::bigint as credit_cents
    from target t
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
    select
      t.id as member_id,
      gs::date as period,
      t.price_today as amount_cents,
      (gs::date < t.joined_period) as before_joined
    from target t
    cross join generate_series(
      least((start_period - interval '1 month')::date, current_period) - interval '11 months',
      least((start_period - interval '1 month')::date, current_period),
      interval '1 month'
    ) gs
    where not t.has_opening_balance
      and t.joined_period <= start_period
  )
  select b.member_id, b.period, b.kind, b.charged_cents, b.covered_cents, b.pending_cents,
         b.period = current_period, false, b.opening_from, b.credit_covered_cents, false
  from billed b
  union all
  select pc.member_id, pc.period, 'projected', pc.amount_cents, pc.covered_cents,
         (pc.amount_cents - pc.covered_cents)::bigint, pc.period = current_period, pc.priced_at_today,
         null::date, pc.covered_cents, false
  from projected_covered pc
  union all
  select ps.member_id, ps.period, 'pre_system', ps.amount_cents, 0::bigint,
         ps.amount_cents, ps.period = current_period, true, null::date, 0::bigint, ps.before_joined
  from pre_system ps
  order by 1, 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. register_payment_batch: cada ítem admite "allocations". Cuerpo de
--    20261024170000 más la validación de forma y UN insert de imputaciones
--    después de los pagos (el guard hace el resto). El saldo anterior del ítem
--    se inserta antes: sus meses ya tienen cargo cuando llegan las imputaciones.
--    items:
--      [{ "member_id": 12, "amount_cents": 2000000,
--         "opening_balance": { ... } | null,
--         "allocations": [{ "period": "2026-05-01", "amount_cents": 1000000 },
--                         { "period": "2026-07-01", "amount_cents": 1000000 }] | null }]
-- -----------------------------------------------------------------------------
create or replace function public.register_payment_batch(
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
  alloc_count integer;
  alloc_distinct integer;
  alloc_sum bigint;
  alloc_bad integer;
begin
  if not private.can('payments.register') then
    raise exception 'No tenés permiso para registrar pagos' using errcode = 'insufficient_privilege';
  end if;

  if register_payment_batch.batch_id is null then
    raise exception 'El identificador del lote no es válido' using errcode = 'check_violation';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'Cargá al menos un pago' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(items) = 0 then
    raise exception 'Cargá al menos un pago' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('lonqui.payment_batch:' || register_payment_batch.batch_id::text));

  if exists (select 1 from public.payments p where p.batch_id = register_payment_batch.batch_id) then
    return query
    select p.member_id, p.id, p.amount_cents, f.id, true
    from public.payments p
    left join public.fees f
      on f.member_id = p.member_id
     and f.kind = 'opening_balance'
     and f.created_at = p.created_at
    where p.batch_id = register_payment_batch.batch_id
    order by p.id;
    return;
  end if;

  select s.billing_start_period into start_period from public.settings s where s.id = 1;

  for item in
    select x.member_id, x.amount_cents, x.opening_balance, x.allocations
    from jsonb_to_recordset(items) as x(member_id bigint, amount_cents bigint, opening_balance jsonb, allocations jsonb)
  loop
    if item.member_id is null then
      raise exception 'Elegí el socio' using errcode = 'check_violation';
    end if;
    if item.amount_cents is null or item.amount_cents <= 0 then
      raise exception 'El monto tiene que ser mayor a cero' using errcode = 'check_violation';
    end if;

    -- Forma de las imputaciones (el guard valida el fondo).
    if item.allocations is not null and jsonb_typeof(item.allocations) <> 'null' then
      if jsonb_typeof(item.allocations) <> 'array' then
        raise exception 'Los meses imputados no son válidos' using errcode = 'check_violation';
      end if;
      select count(*), count(distinct (a ->> 'period')),
             coalesce(sum((a ->> 'amount_cents')::bigint), 0),
             count(*) filter (
               where (a ->> 'period') is null
                  or (a ->> 'period')::date <> date_trunc('month', (a ->> 'period')::date)::date
                  or (a ->> 'amount_cents') is null
                  or (a ->> 'amount_cents')::bigint <= 0
             )
      into alloc_count, alloc_distinct, alloc_sum, alloc_bad
      from jsonb_array_elements(item.allocations) a;
      if alloc_bad > 0 or alloc_count > 60 or alloc_count <> alloc_distinct then
        raise exception 'Los meses imputados no son válidos' using errcode = 'check_violation';
      end if;
      if alloc_sum > item.amount_cents then
        raise exception 'Lo imputado supera el monto del pago' using errcode = 'check_violation';
      end if;
    end if;

    if item.opening_balance is not null and jsonb_typeof(item.opening_balance) = 'object' then
      if start_period is null then
        raise exception 'Primero activá las cuotas en Ajustes' using errcode = 'check_violation';
      end if;
      from_p := (item.opening_balance ->> 'from_period')::date;
      to_p := (item.opening_balance ->> 'to_period')::date;
      ob_amount := (item.opening_balance ->> 'amount_cents')::bigint;

      if from_p is null or to_p is null or from_p > to_p
         or from_p <> date_trunc('month', from_p)::date
         or to_p <> date_trunc('month', to_p)::date then
        raise exception 'Los meses del saldo anterior no son válidos' using errcode = 'check_violation';
      end if;
      if to_p >= start_period then
        raise exception 'El saldo anterior solo cubre meses anteriores a %', to_char(start_period, 'MM/YYYY')
          using errcode = 'check_violation';
      end if;
      if ob_amount is null or ob_amount <= 0 then
        raise exception 'El saldo anterior tiene que ser mayor a cero' using errcode = 'check_violation';
      end if;

      insert into public.fees (member_id, kind, amount_cents, description, from_period, to_period)
      values (
        item.member_id,
        'opening_balance',
        ob_amount,
        nullif(btrim(item.opening_balance ->> 'description'), ''),
        from_p,
        to_p
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

  -- Imputaciones: un solo INSERT; el guard valida mes con cargo, tope del mes
  -- y Σ <= monto. created_by toma el default (la policy exige auth.uid()).
  -- jsonb_array_elements sobre un `null` JSON tira un error crudo: se
  -- normaliza a [] antes (el loop ya rechazó cualquier otra forma no-array).
  insert into public.payment_allocations (payment_id, period, amount_cents)
  select p.id, (a ->> 'period')::date, (a ->> 'amount_cents')::bigint
  from jsonb_to_recordset(items) as x(member_id bigint, allocations jsonb)
  join public.payments p
    on p.member_id = x.member_id and p.batch_id = register_payment_batch.batch_id
  cross join lateral jsonb_array_elements(
    case when x.allocations is not null and jsonb_typeof(x.allocations) = 'array' then x.allocations else '[]'::jsonb end
  ) a
  order by p.id, (a ->> 'period')::date;

  return query
  select p.member_id, p.id, p.amount_cents, ob.fee_id, false
  from public.payments p
  left join unnest(ob_members, ob_ids) as ob(m_id, fee_id) on ob.m_id = p.member_id
  where p.batch_id = register_payment_batch.batch_id
  order by p.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Verificación del backfill: la cobertura de cada cargo es la misma que
--    antes de la migración. Si no, se aborta todo (la migración es una
--    transacción): mejor no migrar que migrar cambiando la deuda de alguien.
-- -----------------------------------------------------------------------------
do $$
declare
  bad record;
  over_allocated record;
begin
  select o.member_id, o.fee_id, o.covered_cents as old_cents, cv.covered_cents as new_cents
  into bad
  from imputacion_old_coverage o
  join lateral private.member_fee_coverage(o.member_id) cv on cv.fee_id = o.fee_id
  where cv.covered_cents <> o.covered_cents
  limit 1;
  if found then
    raise exception 'Backfill de imputaciones: la cobertura del cargo % (socio %) cambió de % a %',
      bad.fee_id, bad.member_id, bad.old_cents, bad.new_cents;
  end if;

  select p.id, p.amount_cents, sum(a.amount_cents) as allocated
  into over_allocated
  from public.payments p
  join public.payment_allocations a on a.payment_id = p.id
  group by p.id, p.amount_cents
  having sum(a.amount_cents) > p.amount_cents
  limit 1;
  if found then
    raise exception 'Backfill de imputaciones: el pago % quedó imputado por % sobre un monto de %',
      over_allocated.id, over_allocated.allocated, over_allocated.amount_cents;
  end if;
end;
$$;

drop table imputacion_old_coverage;

-- -----------------------------------------------------------------------------
-- 9. Grants. El drop se llevó los de payment_month_options; create or replace
--    conservó los de register_payment_batch, member_fee_coverage y
--    member_balance (se repiten igual). Ninguna función de private para PUBLIC;
--    a mano las que las RPC INVOKER necesitan. El guard es de trigger: no
--    necesita EXECUTE.
-- -----------------------------------------------------------------------------
revoke execute on function
  public.payment_month_options(bigint[]),
  public.register_payment_batch(uuid, date, text, text, text, jsonb)
from public, anon;

grant execute on function
  public.payment_month_options(bigint[]),
  public.register_payment_batch(uuid, date, text, text, text, jsonb)
to authenticated;

revoke execute on all functions in schema private from public, anon;

grant execute on function
  private.member_period_charges(bigint),
  private.member_period_ledger(bigint),
  private.member_fee_coverage(bigint),
  private.member_balance(bigint)
to authenticated, service_role;
```

Notas para el hilo principal al aplicar:

- El orden de las secciones importa y ya está en el orden correcto: cargos (1) → tabla y guard
  (2) → libro (3, `language sql` se valida al crearse y lee la tabla) → backfill (4, usa solo
  cargos y el guard) → redefiniciones (5–7) → verificación (8) → grants (9).
- La foto de la sección 0 se toma con la función **vieja**, que todavía existe en ese punto.
- Un `period` o `amount_cents` con forma inválida dentro de `allocations` (texto que no es
  fecha) falla con el error crudo del cast (22007/22P02), que la app muestra como error interno;
  Zod lo frena antes y por PostgREST directo es un abuso, no un flujo. Aceptado.
- Si `tests/db/opening-balance-months.test.ts` ("paridad TS/SQL") falla por un centavo, el
  reparto de `member_period_charges` no es idéntico al de `splitOpeningTotal`: revisar `k < n`.
- Correr `npm run db:reset`, `npm run db:types` y `npm test`. `database.types.ts` tipa `items`
  como `Json`: nada cambia para el cliente.
- Después de aplicar en local, correr `get_advisors` (MCP) y revisar que la tabla nueva no
  aparezca con "RLS disabled" ni la función pública sin `search_path`.

## 10. Contratos (los fija el hilo principal en `src/models/types.ts` y `src/lib/dates.ts`)

```ts
export type PaymentMonthOption = {
  // ...todo lo de hoy...
  /** Cuánto de coveredCents es crédito aplicado (pago a cuenta o saldo a favor), no una imputación explícita. */
  creditCoveredCents: number
  /** Solo 'pre_system': el mes es anterior al mes de la fecha de alta (ver §6.4). false en el resto. */
  beforeJoined: boolean
}

/** Un mes con cargo al que el pago se imputa explícitamente. Período `YYYY-MM-01`. */
export type PaymentAllocationInput = { period: ISODate; amountCents: number }
```

`registerPaymentSchema` (modelo): `items[].allocations?: PaymentAllocationInput[] | null` (≤ 60;
períodos únicos y día 1; montos enteros > 0; Σ ≤ `amountCents`). `src/lib/dates.ts`:
`periodListLabel(periods: ISODate[]): string`.

Lógica pura (`src/views/payments/month-selection.ts`, contrato completo en `01-tasks.md` §F1):
`Selection = number[]` (índices marcados, ordenados, sobre el array completo de opciones);
`toggleCell`, `paintRange`, `advancesAllowed`, `openingSpan` (con `beforeJoined`), `effectiveOptions`
(explícito fijo, crédito móvil), `derivedAmountCents`, `allocationsFromSelection`,
`coverageForAmount`, `debtAfterPayment`, `selectionSummary` (lista), `coverLabel`,
`beforeJoinedWarning`.

## 11. Estrés del plan (grilling contra mí mismo)

1. *¿Por qué por mes y no por cargo, si todo AR lo hace por factura?* Porque acá la "factura"
   es el mes: la grilla, el tramo del saldo anterior y la deuda por categoría hablan de meses, y
   dos deportes en un mes ya se cubren en orden adentro del mes. Y porque anular y recargar el
   saldo anterior cambia el `fee_id` pero no los meses. Lo único que se pierde es imputar a un
   deporte y no al otro dentro del mismo mes, que nadie pidió.
2. *¿Qué pasa si el guard rechaza porque el crédito ya cubría el mes?* No puede: el guard compara
   contra lo **explícito** del mes, no contra el crédito. El crédito se corre. Era el bug de la
   primera versión de este plan (el pago recién insertado contaba como crédito y "cubría" su
   propio mes antes de imputarse).
3. *¿Dos operadores pagan junio del mismo socio a la vez?* Fila del socio bloqueada en el guard;
   el segundo espera y ve la imputación del primero → "ya está pago… actualizá la pantalla".
4. *¿Un adelanto de $10.000 a diciembre y en diciembre la cuota vale $12.000?* Es a cuenta: el
   crédito cubre $10.000 y la celda dice "falta $2.000". Igual que hoy.
5. *¿El backfill puede fallar en producción?* Solo si la cobertura nueva no reproduce la vieja; en
   ese caso **aborta sin dejar nada** (una transacción). Se prueba antes contra un dump local de
   producción (pg_dump mensual del contrato, 6.3) además del seed.
6. *¿Y si corren el código nuevo contra el schema viejo?* El pago se registra a cuenta (las claves
   desconocidas del JSON se ignoran). No se pierde plata ni falla; se pierde la imputación. Por
   eso: migración primero.
7. *¿Seguridad?* Sin superficie nueva fuera de una tabla con RLS, grants por columna, guard
   DEFINER en `private` con el chequeo de pago/socio, sin UPDATE/DELETE. Las RPC siguen INVOKER.
8. *¿Un `consulta` puede leer imputaciones?* Sí, con `payments.read`, igual que lee pagos.
9. *¿Rompe `cash-isolation.test.ts`?* No: la foto se toma antes y después con el mismo schema, y
   caja no entra en ninguna función.
10. *¿Y el padrón filtrado por deuda?* `member_debt_status` sigue siendo `cargos − pagos`.
11. *¿"Debe desde" puede retroceder para socios ya cargados?* Sí, en los que tienen saldo anterior
    con tramo (de "octubre 2026 · 1 mes" a "enero 2026 · 10 meses"). Es un arreglo visible;
    pregunta 1.
12. *¿La grilla a 390 px con 6 toques en vez de tocar-tocar?* Seis toques de 44 px son dos
    segundos; mantener apretado y pintar sigue existiendo. Mejor que explicar "tocá el primero y
    el último".

## 12. Preguntas abiertas

**Para el usuario (cortas, con default; no frenan):**

1. `months_due` / "Debe desde" pasan a contar los meses del tramo del saldo anterior (hoy un
   saldo de 10 meses cuenta 1). Default: sí.
2. Adelantos siguen a cuenta: no se puede pagar diciembre debiendo junio (§4.1). Default: sí.
3. Lo no imputado ("Otro monto", sobrantes) se aplica al mes adeudado más viejo en la lectura
   (§6.3). Default: sí.
4. Fecha de alta anterior a la ventana de 12 meses previos: el tramo arranca en la ventana (el
   total sigue siendo editable). Default: sí; subir a 24 es una línea en la RPC si lo piden.
5. El aviso de fecha de alta linkea a `/socios/[id]/editar` y no bloquea. Default: sí.
6. Backfill con `source = 'backfill'` (y no dejar la historia a cuenta). Default: sí.

**Para la Comisión:** una sola, informativa: con meses sueltos, "Debe desde" muestra el mes más
viejo sin pagar aunque haya meses posteriores pagos; conviene que lo sepan antes de que un socio
pregunte por qué figura debiendo junio si pagó julio.

## 13. Texto de CLAUDE.md a reemplazar (lo hace el hilo principal al aprobar)

Reemplazar el párrafo **"Imputación: balance forward (2026-10-24)"** y el párrafo
**"Saldo anterior con tramo (2026-10-24, …)"** de la sección Cuotas por:

> **Imputación explícita por mes** (2026-10-29, pipeline
> `2026-10-29-imputacion-libre-meses`). Un pago dice qué meses paga:
> `payment_allocations (payment_id, period, amount_cents)`, append-only, sin UPDATE ni DELETE,
> auditada; la anulación del pago apaga sus imputaciones sin tocarlas (toda lectura filtra
> `payments.voided_at`). Solo se imputa a meses con cargo vigente (cuota generada, mes del
> tramo del saldo anterior, celda del saldo viejo); lo no imputado (pago a cuenta, sobrantes,
> adelantos) **se aplica en la lectura del mes adeudado más viejo al más nuevo** y después a los
> proyectados. Σ pendiente por mes = max(0, cargos − pagos): la deuda total sigue siendo cargos
> − pagos no anulados. `private.member_period_charges` (qué se debe cada mes) y
> `private.member_period_ledger` (explícito primero, crédito después) son LA definición; todo
> lo demás (`member_fee_coverage`, `member_balance`, `payment_month_options`) sale de ahí. La
> grilla del formulario marca meses sueltos (tocar alterna, arrastrar pinta); los adelantos solo
> se marcan cuando no queda ningún mes con cargo adeudado sin marcar. Una imputación equivocada
> se corrige anulando el pago y cargando otro: nunca se mueve.
>
> **Saldo anterior con tramo** (2026-10-24, actualizado 2026-10-29). El saldo guarda su tramo
> (`fees.from_period`/`to_period`, inmutables) y se reparte mes por mes en partes enteras con el
> resto en el último. En la carga inicial el tramo arranca en `min(primer mes previo marcado,
> max(mes de la fecha de alta, inicio de la ventana))`: si la fecha de alta es anterior al primer
> mes marcado, la deuda corre desde la fecha de alta y los meses sin marcar quedan adeudados;
> si es posterior, el tramo arranca en el primer marcado y la UI avisa que hay que corregir la
> fecha de alta (link a la ficha). El pago cubre solo los meses marcados. Para cambiar desde
> cuándo debía, el saldo se anula (admin) y se vuelve a cargar: las imputaciones a meses del
> tramo viejo se conservan por mes. Un saldo sin tramo (los viejos) sigue siendo una sola celda.

Y en la tabla de rutas / sección Diseño no cambia nada. En `.impeccable/surfaces/route-caja.md`
el agente de frontend reemplaza el párrafo del overlay y el anti-objetivo (§7).
