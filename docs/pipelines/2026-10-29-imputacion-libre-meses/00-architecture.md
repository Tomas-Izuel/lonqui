# 00 — Imputación explícita por cuota: `payment_allocations` y saldo anterior por mes

Pipeline `2026-10-29-imputacion-libre-meses`, **v2** (planner: `feature-planner`, 2026-10-29, plan
mode). Reemplaza a `00-architecture-v1-descartada.md` (imputación por MES + pozo repartido en la
lectura + saldo con tramo), que el usuario rechazó por ambigua: *"¿está pago julio?" salía de
combinar tres reglas calculadas al leer*. Lo relevado del repo en la v1 (§3) sigue vigente y se
reusa acá. **Cero código de producción**: el SQL de §9 es el boceto que el hilo principal copia a
la migración; lo demás son contratos para los agentes.

El modelo de esta v2 lo **aprobó el usuario** (diagrama del artifact). Este documento no lo
re-litiga: lo baja a tierra contra el schema real, señala riesgos concretos y diseña **la migración
de datos sobre producción**, que es lo crítico.

---

## 1. Problema y contexto

Hoy un pago es un pozo por socio: `payments` no dice qué cubrió; la cobertura de cada cargo se
deriva al leer (`private.member_fee_coverage`, balance forward). "Pagó mayo y julio, junio sigue
debiendo" es irrepresentable. El saldo anterior vive en UNA fila de `fees` con un tramo
(`from_period`/`to_period`) que `payment_month_options` expande al leer, repartiendo el total en
partes enteras.

El modelo aprobado invierte la carga: **todo queda escrito al registrar**, nada se reparte al leer.

- `fees`: una fila por socio, por mes y por concepto (lo que se debe). El saldo anterior pasa a ser
  **una fila `opening_balance` por mes** con su período real.
- `payments`: sin cambios (el cobro).
- `payment_allocations` (nueva): "este pago cubrió esta cuota con tantos centavos". Append-only.
- `fee_status` / `payment_credit` (vistas): pagada / parcial / adeudada por cuota; saldo a favor
  por pago. Deuda del socio = Σ `pending_cents`. Todo derivado, nada almacenado.

Constraints que mandan (CLAUDE.md): deuda derivada; agregaciones en RPC; nada se borra; auditoría
por triggers con `auth.uid()`; permisos (`private.can`), no roles; idempotencia por `batch_id`;
centavos; hora de Argentina; caja aislada de la deuda; Operate, mobile first.

**Hay producción con datos reales.** CLAUDE.md dice "solo hay stack local por ahora": está
desactualizado. Verificado en `.github/workflows/ci.yml`: el job `deploy-migrations` corre en
cada push a `main` (después de `build` y `db`) `supabase link` + `supabase db push --linked
--dry-run` + `supabase db push --linked --skip-vault --yes` contra el proyecto hosted
(`vars.SUPABASE_PROJECT_REF`, plan free), y Vercel despliega la app en paralelo. El proyecto está
vinculado también en esta máquina (`supabase/.temp/project-ref` existe). La carga inicial está en
curso (`billing_start_period = 2026-11-01`; hoy 2026-10-29): hay saldos anteriores con tramo y
pagos históricos cargados. **Esa historia tiene que sobrevivir intacta.**

## 2. Chequeo de alcance

Contrato 2.2 (registro de pagos; estado de cuenta: meses adeudados, deuda total, último pago,
historial). Imputar un pago a cuotas concretas es la forma fiel de "meses adeudados". Entra en
Fase 1; es un cambio de diseño decidido por el usuario, no de alcance. Fuera: mover una imputación
ya registrada (se anula el pago y se recarga), imputar un saldo a favor a mano, descuentos,
importador de Excel, egresos.

## 3. Lo que relevé (verificado contra el repo, 2026-10-29)

- **MCP de Supabase local: caído** (`ECONNREFUSED`). Trabajé desde `supabase/migrations/**` y el
  código. **El SQL de §9 no se corrió contra ninguna base.** Context7 MCP: no conectado; para
  `supabase db push` leí la fuente del CLI (abajo). Skills: `supabase-postgres-best-practices`
  (`schema-constraints`, `lock-advisory`, `security-rls-performance`), `supabase` (checklist: vistas
  con `security_invoker`, UPDATE pide SELECT, DEFINER en `private` con chequeo en el cuerpo,
  grants explícitos), `impeccable` (`reference/operate.md`). CLI local: `supabase 2.118.0`.
- **Cómo aplica una migración `supabase db push` (fuente, `apps/cli-go/pkg/migration/file.go`,
  rama `develop`).** `ExecBatch` arma UN `pgconn.Batch` con todas las sentencias del archivo
  (`parser.SplitAndTrim` corta por `;` fuera de `$$`) **más el `insert` en
  `supabase_migrations.schema_migrations`**, y lo manda en una sola ida (protocolo extendido, un
  `Sync` al final). En ese protocolo todo lo que va antes del `Sync` corre en un **bloque de
  transacción implícito**: si una sentencia falla, el servidor descarta las que siguen y revierte
  todo, **incluida la fila de versión**. Es decir: **cada archivo es una transacción**, sin
  `begin`/`commit` explícitos (ninguna migración del repo los usa, y no hace falta). **Excepción
  que corta la transacción**: `isPipelineIncompatible` saca del batch —y ejecuta sueltas, cerrando
  el batch anterior— las sentencias que empiezan con `CREATE [UNIQUE] INDEX CONCURRENTLY`, `DROP
  INDEX CONCURRENTLY`, `REINDEX … CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM` o `CLUSTER`. Un `CREATE
  INDEX` / `DROP INDEX` sin `CONCURRENTLY` queda adentro. **La migración de §9 no usa ninguna de
  esas**: es una sola transacción de punta a punta, y la verificación que `raise exception` al
  final revierte hasta la primera sentencia.
- **Schema vigente** (la definición más nueva manda; inventario completo en §6.6):
  - `fees` (`20260927130000` + `20261024170000`): `kind` monthly / opening_balance / adjustment;
    `fees_one_monthly_per_period (member_id, period, discipline_id) nulls not distinct where
    kind='monthly'`; `fees_one_opening_balance (member_id) where kind='opening_balance' and
    voided_at is null`; `fees_immutable` (incluye `from_period`, `to_period`);
    `fees_void_guard` (BEFORE UPDATE: exige `can('payments.void')`, pone `voided_by :=
    auth.uid()`); `fees_opening_balance_guard` (BEFORE INSERT, DEFINER: fija `period := inicio −
    1`, valida tramo ≤ 36 meses y `< inicio`); CHECKs `fees_opening_span_*`; grant de INSERT
    `(member_id, kind, amount_cents, description, from_period, to_period)` — **sin `period`**;
    grant de UPDATE `(voided_at, voided_by, void_reason)`; policy de INSERT solo
    `kind='opening_balance' ∧ created_by = auth.uid()`; UPDATE solo con `payments.void`.
  - `payments` (`20260927130100`): `batch_id` + único `(batch_id, member_id)`; inmutable salvo
    anulación y comprobante; `payments_member_not_voided_idx`; sin trigger AFTER INSERT.
  - `private.member_fee_coverage` / `member_balance` (`20260927130200`): balance forward; las usan
    `member_fee_statement`, `debt_by_category`, `member_accounts`, los campos calculados
    `member_balance_cents` / `member_debt_status` / `member_months_due` del padrón (filtro
    `debt`), `dashboard_summary` (vía `member_balance`).
  - `month_collection`, `daily_collection`, `cash_month_summary`, `dashboard_summary` (cobranza),
    `monthly_history`: por `paid_on` y `cargos − pagos`. No miran cobertura por cargo.
  - `payment_month_options` (`20261024170000`): celdas `opening_balance` (tramo expandido, reparto
    en partes enteras con el resto en el último mes), `monthly`, `projected` (precio + saldo a
    favor en orden), `pre_system` (12 meses previos, solo sin saldo vigente y con `joined_on ≤
    inicio`). Ventana `period >= first_due`.
  - `register_payment_batch` (`20261024170000`, INVOKER): lock por `batch_id`; reintento devuelve
    el lote con `opening_balance_fee_id` (join `fees.created_at = payments.created_at`); inserta el
    saldo con tramo y después UN insert de `payments`.
  - `generate_monthly_fees` / `generate_pending_fees` (`20260927130000`, DEFINER, pg_cron 03:05
    UTC del día 1): no tocan pagos.
  - `correct_member_joined_on` (`20261015120100`): bloquea si hay cuota mensual no anulada antes
    del mes nuevo; los saldos no bloquean.
  - `private.permissions_for_role` (`20261013120000`): `payments.register` para admin y editor;
    `payments.void` solo admin; `payments.read` los tres.
- **Seed** (`supabase/seed.sql`): dos saldos **sin tramo** (`insert into fees (member_id, kind,
  amount_cents)`, sin `period`: el guard lo fija), pagos como `postgres` (uno anulado con
  `voided_by` de relleno `00000000-…`), `generate_pending_fees('cron')` ANTES de los pagos.
- **Modelos / vistas**: `fees.model.ts` (`createOpeningBalanceFromMonths` inserta UNA fila con
  tramo, sin `period`; `voidFee` = UPDATE directo), `payments.model.ts` (`registerPayment` arma
  `items[].opening_balance {from_period, to_period, amount_cents, description}`; `voidPayment` =
  UPDATE directo), `accounts.model.ts` (`getOpeningBalance` con `.maybeSingle()` — **rompe con más
  de una fila**; mapea `payment_month_options` columna por columna, `opening_from ?? null`),
  `month-selection.ts` (selección de RANGO; `splitOpeningTotal`), `opening-balance-months.tsx`
  (ficha: "Indicar desde cuándo debía"), `member-account-section.tsx` ("Ya tiene un saldo anterior
  cargado: $X"), `member-fee-statement.tsx` ("Saldo anterior · hasta <mes>").
- **Tests que fijan invariantes** (`tests/db/`, un solo fork: `poolOptions.forks.singleFork`):
  `accounts.test.ts`, `opening-balance-months.test.ts` (un saldo vigente por socio, tramo
  inmutable, paridad `splitOpeningTotal` TS/SQL), `register-payment-batch.test.ts`,
  `payment-month-options*.test.ts`, `cash-isolation.test.ts`, `grants-and-lockdown.test.ts`
  (ninguna función de `private` ejecutable por PUBLIC; sin DELETE para `authenticated`; sin
  `has_role` en objetos nuevos), `member-joined-on.test.ts`. Fixtures:
  `payment-months-fixtures.ts` (`insertOpeningBalanceFee` manda `period '2000-01-01'` confiando
  en que el guard lo pisa — **con el guard nuevo ya no lo pisa**, ver T4).

## 4. Pushback: riesgos concretos del modelo aprobado y cómo los resuelvo

1. **El único `(payment_id, fee_id)` no sirve en un libro append-only.** Un pago puede imputarse
   dos veces a la misma cuota en momentos distintos: pago X marcado a agosto (`marked`), el resto a
   junio parcial (`oldest_first`); un admin anula agosto → X recupera crédito → se reimputa a junio
   (`credit`) → segunda fila (X, junio). Con el índice único la reimputación fallaría o habría que
   editar la fila vieja. **Decisión: sin unicidad; índices simples por `payment_id` y por
   `fee_id`.** Dos filas del mismo par son dos momentos. Los topes (Σ por cuota ≤ monto, Σ por pago
   ≤ monto) los hace cumplir el guard, no un índice.
2. **"Nunca conviven deuda y saldo a favor" no se puede garantizar solo desde la RPC.** Hay cuatro
   caminos que crean crédito o deuda: registrar un pago (RPC), generar cuotas (cron), cargar un
   saldo anterior desde la ficha (INSERT directo de la app en `fees`) y anular una cuota (UPDATE
   directo). Si la imputación vive solo en `register_payment_batch`, la ficha y la anulación la
   saltean, y un INSERT por PostgREST directo también. **Decisión: el motor de imputación son
   triggers**, como todo lo que es invariante en este repo: AFTER INSERT en `payments` (marcados
   primero, resto al más viejo), AFTER INSERT en `fees` (statement, aplica el crédito del socio a
   las cuotas nuevas: cron, saldo anterior, futuros ajustes) y AFTER UPDATE de anulación en `fees`
   (la plata liberada vuelve a crédito y se reimputa). La RPC solo le pasa al trigger qué meses se
   marcaron, por un GUC local a la transacción (`lonqui.marked_periods`), el mismo mecanismo que ya
   usa `correct_member_joined_on`. Consecuencia buena: `authenticated` **no tiene INSERT** en
   `payment_allocations`; escriben solo funciones DEFINER de `private` y el guard las valida igual.
3. **Un mes marcado que ya está pago** (otro operador lo cobró, o el crédito previo lo cubrió al
   crear el saldo anterior en el mismo lote): ¿error o salteo? El error frena un cobro con alguien
   esperando por una condición que el operador no puede ver; el salteo manda la plata al mes
   adeudado más viejo, que es exactamente lo que haría el operador con la pantalla fresca.
   **Decisión: se saltea** (el guard igual impide sobre-imputar). Pregunta 1 de §12.
4. **Las cuotas de `fees` para el saldo anterior no son "una cuota mensual" para el generador ni
   para `correct_member_joined_on`**: el cron solo crea `kind='monthly'` desde el inicio, y la
   corrección de alta solo mira `monthly`. No hay doble cobro posible de un mes previo. Lo que sí
   cambia: `months_due` de un socio con saldo de 10 meses pasa de 1 a 10 (hoy cuenta la fila con
   tramo como un mes). Es el arreglo que el modelo por mes trae de regalo; se informa a la Comisión.
5. **Los saldos viejos sin tramo** (seed; en producción puede haber cero o alguno cargado por
   `createOpeningBalance` "solo monto" antes del 24/10): ya son "una fila = un mes" con `period =
   inicio − 1` y el total. **Decisión: no se convierten.** Convertirlos inventaría meses que nadie
   declaró; quedan como la deuda del mes anterior al inicio por $X. La verificación de la
   migración cuenta cuántos hay y lo deja en el log. Pregunta 2.
6. **La ventana de despliegue tiene una dirección peligrosa.** Vercel despliega al push; la
   migración llega minutos después (CI `build` + `db` + `deploy-migrations`). En esos minutos el
   **código nuevo corre contra el schema viejo**: `register_payment_batch` viejo ignora
   `opening_months` y `marked_periods` (`jsonb_to_recordset` descarta claves desconocidas) → el
   pago se registra como pozo (nunca se pierde plata: el backfill lo imputa), pero los meses de
   saldo anterior marcados **no se crean** y nadie se entera. **Decisión: detección de schema en
   el modelo**: `getPaymentMonthOptions` exige la columna nueva `before_joined`; si no viene, el
   formulario no se abre ("El sistema se está actualizando. Probá en unos minutos"). La dirección
   inversa (código viejo contra schema nuevo) es segura salvo dos pantallas (§8, compatibilidad).
7. **La migración corre dentro del pipeline del CLI**: nada de `CONCURRENTLY`, `VACUUM`,
   `CLUSTER` ni `ALTER SYSTEM` en el archivo (§3), o la transacción se parte en pedazos y la
   verificación deja de proteger lo anterior. Hay un comentario al tope del archivo que lo dice.
8. **El guard de `fees` para el saldo tiene que seguir aceptando filas sin `period`** (el seed y
   el código viejo insertan sin período): `period null → inicio − 1`, como hoy. Y tiene que
   **rechazar un tramo** desde ahora, con mensaje legible: el código viejo de la ficha en la ventana
   recibe "recargá la página".

## 5. Opciones y descarte

### 5.1 Dónde vive el motor de imputación

| Opción | Pro | Contra |
|---|---|---|
| **A. Triggers en `payments` (insert) y `fees` (insert, anulación); la RPC pasa los marcados por GUC local (recomendada)** | Vale por todos los caminos, PostgREST directo incluido; `authenticated` sin INSERT en la tabla; una sola definición del orden "más viejo primero"; los tests existentes que insertan pagos y cuotas como `postgres` siguen viendo cobertura | Un GUC para pasar intención a un trigger (precedente: `lonqui.joined_on_correction`) |
| B. Solo en `register_payment_batch` + llamadas explícitas en el generador y en la anulación | Sin GUC | La ficha (INSERT directo) y PostgREST directo dejan crédito y deuda conviviendo; la anulación es un UPDATE directo del modelo: habría que convertirla en RPC |
| C. Constraint trigger diferido al commit sobre `payments` | Orden garantizado (marcados antes) | Los tests de base corren en `begin … rollback` y nunca comitean: no verían ninguna imputación |

### 5.2 Qué hacer con los saldos con tramo ya cargados

| Opción | Pro | Contra |
|---|---|---|
| **A. Anular cada tramo vigente (motivo fijo, actor sistema) e insertar una fila por mes con el mismo reparto que hoy; cobertura verificada mes a mes (recomendada)** | Nada se borra; la ficha muestra los mismos meses pagos/adeudados que ayer; la verificación aborta si un centavo se mueve | ~N×10 filas de auditoría `system`; hay que desactivar `fees_void_guard` durante la conversión (acotado, dentro de la transacción) |
| B. Dejar los tramos y expandirlos en la lectura para siempre | Sin conversión | Dos modelos conviviendo; `fee_status` tendría que inventar filas; es la v1 que se descartó |
| C. Borrar los tramos e insertar los meses | Limpio | Prohibido: nada se borra |

### 5.3 Saldos sin tramo

| Opción | Pro | Contra |
|---|---|---|
| **A. Quedan como están: una fila = la deuda del mes `inicio − 1` (recomendada)** | Cero riesgo; ya cumplen "una fila por mes"; agregar meses anteriores después es insertar filas | Un saldo de $30.000 figura como "octubre 2026 · $30.000" |
| B. Convertirlos en N meses hacia atrás a la cuota de hoy | "Debe desde" más realista | Inventa meses que nadie declaró; el resto no divisible |

### 5.4 Qué manda el formulario

| Opción | Pro | Contra |
|---|---|---|
| **A. `marked_periods: date[]` por ítem; la base decide los montos por cuota (recomendada)** | La UI no manda pendientes que pueden estar viejos; "Otro monto" y "mes parcial" caen solos (marcados en orden hasta donde alcanza) | La UI simula la regla para el preview (misma regla, en TS puro, testeada) |
| B. `allocations: [{fee_id, amount}]` explícitas | Control total | La UI tendría que conocer `fee_id` de cuotas que todavía no existen (saldo anterior del mismo lote) y pendientes frescos; más superficie para inconsistencias |

### 5.5 Selección en la grilla

Igual que la v1 §5.5: **conjunto de celdas** (tocar alterna; arrastrar pinta o despinta según la
celda de partida). Checkboxes y "rango con huecos" descartados.

## 6. Arquitectura recomendada

### 6.1 Postgres (hilo principal; SQL completo en §9)

**`fees`: saldo anterior por mes.**
- `fees_one_opening_balance` pasa de `(member_id)` a **`(member_id, period)`** `where kind =
  'opening_balance' and voided_at is null`. Mismo nombre: el modelo ya traduce ese 23505.
- `fees_opening_balance_guard` (BEFORE INSERT, DEFINER): para `opening_balance` exige facturación
  activa y monto > 0; **rechaza `from_period`/`to_period`** ("El saldo anterior se carga mes por
  mes. Recargá la página…"); `period null → inicio − 1` (seed, código viejo); `period` día 1,
  `< inicio` y `≥ inicio − 36 meses`; descripción por defecto "Saldo anterior · MM/YYYY".
- Grants: **`grant insert (period)`** a `authenticated` (la ficha inserta N filas con su mes);
  **`revoke insert (from_period, to_period)`** (nadie carga tramos nunca más; las columnas quedan
  por la historia de las filas anuladas). `fees_immutable` sigue igual.
- `private.split_opening_total(total, n) → bigint[]`: partes enteras, resto en la última. Espejo de
  `splitOpeningTotal` (TS). La usan la conversión y la expansión del payload viejo del lote.

**`public.payment_allocations`** — "este pago cubrió esta cuota con tantos centavos".
- `id`, `payment_id → payments (restrict)`, `fee_id → fees (restrict)`, `amount_cents > 0`,
  `source in ('marked', 'oldest_first', 'credit', 'backfill')`, `created_by uuid default
  auth.uid()`, `created_at`.
- Índices `(payment_id)` y `(fee_id)`. **Sin único** `(payment_id, fee_id)` (§4.1).
- Append-only: trigger `forbid_change` BEFORE UPDATE OR DELETE y BEFORE TRUNCATE, ambos `enable
  always` (valen con `session_replication_role = replica`, como `audit_log`). Sin grant de UPDATE
  ni DELETE para nadie; **sin grant de INSERT para `authenticated` ni `service_role`**: escriben
  solo las funciones DEFINER del motor.
- Guard BEFORE INSERT (DEFINER, `private.payment_allocations_insert_guard`): bloquea el pago y la
  cuota (`for update`); pago y cuota existen y están vigentes; mismo socio; Σ imputado a la cuota
  (por pagos no anulados) + nuevo ≤ monto de la cuota; Σ imputado del pago (a cuotas no anuladas)
  + nuevo ≤ monto del pago. Dentro de un INSERT de varias filas, el guard ve las filas anteriores
  del mismo statement (un test lo prueba).
- RLS: SELECT con `payments.read`. Sin policy de INSERT (no hay grant). FORCE RLS. `enable_audit`.

**Vistas (`security_invoker = true`, PG 17):**
- `public.fee_status`: por cuota **vigente**: `fee_id, member_id, period, kind, category_id,
  discipline_id, amount_cents, paid_cents` (Σ imputaciones de pagos no anulados), `pending_cents`,
  `status` ('paid' | 'partial' | 'due').
- `public.payment_credit`: por pago **vigente**: `payment_id, member_id, paid_on, amount_cents,
  allocated_cents` (Σ imputado a cuotas no anuladas), `credit_cents`.
- Grant SELECT a `authenticated`, `service_role`. PostgREST las expone; se leen por socio.

**Motor (funciones DEFINER en `private`, sin EXECUTE para nadie):**
- `private.apply_credit(p_member_id, p_source) → integer`: bloquea la fila del socio; `credits` =
  pagos vigentes con `credit_cents > 0` por `(paid_on, id)`; `pendings` = cuotas vigentes con
  `pending_cents > 0` por `(period, saldo antes que cuota, discipline_id nulls first, id)`;
  acumulados de ambos y **solape de intervalos** → un INSERT de imputaciones con `source`. Es LA
  definición de "del más viejo al más nuevo", también para el backfill.
- `private.allocate_marked(p_payment_id, p_periods date[]) → integer`: bloquea al socio; recorre
  las cuotas vigentes con pendiente > 0 de esos meses en el mismo orden; imputa `least(resto,
  pendiente)` como `'marked'` hasta agotar el pago. Un mes marcado sin pendiente se saltea (§4.3).
- Triggers:
  - `payments_allocate_on_insert` (AFTER INSERT, row): si `lonqui.marked_periods` trae meses para
    `new.member_id` → `allocate_marked`; después `apply_credit(member, 'oldest_first')`. Un pago
    que nace anulado (seed) no imputa.
  - `fees_apply_credit_on_insert` (AFTER INSERT, **statement**, `referencing new table`):
    `apply_credit(m, 'credit')` por socio distinto de las filas insertadas. Cubre al generador, al
    saldo anterior (lote y ficha) y a cualquier `adjustment` futuro.
  - `fees_apply_credit_on_void` (AFTER UPDATE OF voided_at, row, `when old null and new not
    null`): `apply_credit(new.member_id, 'credit')`. La plata de las imputaciones a la cuota anulada
    vuelve a ser crédito (la vista no las cuenta) y se reimputa a la adeudada más vieja. Las filas
    viejas quedan. Auditoría: las imputaciones nuevas llevan `actor = auth.uid()` del admin que
    anuló y `source = 'credit'`.
  - Anular un **pago**: nada que hacer. Sus imputaciones quedan y `fee_status` las ignora.

**Funciones redefinidas (misma firma, `create or replace`, grants conservados):**
- `private.member_fee_coverage`: `covered_cents` = Σ imputaciones de pagos no anulados (0 si la
  cuota está anulada). `member_fee_statement` y `debt_by_category` **no cambian de cuerpo**.
- `private.member_balance`: `charged`, `paid`, `balance = charged − paid` (idéntico: Σ pendiente −
  Σ crédito = cargos − pagos); `months_due` = meses distintos con pendiente > 0; `oldest_due_period`
  = el más viejo. `member_accounts`, campos calculados del padrón, `dashboard_summary`,
  `monthly_history`, `month_collection`, `daily_collection`, `cash_month_summary`, `log_export`:
  **sin cambios**.
- `public.register_payment_batch` (misma firma y retorno): ítems
  `{ member_id, amount_cents, marked_periods: date[] | null, opening_months: [{period,
  amount_cents}] | null, opening_balance: {from_period, to_period, amount_cents, description} |
  null }`. `opening_balance` (forma vieja) se **expande** con `split_opening_total` a
  `opening_months`: el código viejo sigue funcionando. Flujo: validar → insertar filas
  `opening_balance` por mes (el trigger de `fees` aplica crédito previo) → `set_config
  ('lonqui.marked_periods', jsonb, true)` → UN insert de `payments` (el trigger imputa) → limpiar
  el GUC → devolver. `opening_balance_fee_id` = `min(id)` de las filas de saldo creadas para ese
  socio en el lote (null si no hubo); el reintento por `batch_id` las recupera por `created_at`.
- `public.payment_month_options` (**drop + create**: cambian las columnas): celdas desde
  `fee_status` agrupada por mes (`monthly` / `opening_balance`), `projected` como hoy (crédito =
  Σ `payment_credit`, aplicado en orden como preview de lo que hará el generador), `pre_system` =
  los 12 meses previos **que no tengan fila de saldo vigente** (así se agregan meses más atrás),
  solo con `joined_on ≤ inicio`. Sale `opening_from`; entra **`before_joined boolean`** (`period <
  mes de joined_on`, solo `pre_system`). Ventana `period >= first_due` (con huecos, un mes pago
  posterior al primero adeudado se ve "pagado", no elegible); antes del inicio se ven todas las
  celdas del saldo.

**Migración de datos (misma transacción, en este orden):** foto → DDL → conversión de tramos →
backfill → verificación (aborta) → triggers del motor → RPC → grants. §7.

### 6.2 Reglas, una sola vez

1. **Registrar**: marcados en orden (período; social antes que deporte) hasta donde alcanza el
   monto (el último queda parcial) → el resto al más viejo adeudado sin marcar → el resto queda como
   crédito del pago. Un adelanto (mes sin cuota) nunca recibe una imputación: es crédito.
2. **Generar cuotas** (cron): tras crear las cuotas del mes, el crédito de los pagos más viejos se
   imputa a las cuotas más viejas pendientes (`credit`).
3. **Anular una cuota**: sus imputaciones quedan inertes; el crédito liberado se reimputa
   (`credit`) a la adeudada más vieja. **Anular un pago**: sus imputaciones quedan inertes; las
   cuotas vuelven a parcial/adeudada; nada se reimputa (no hay plata).
4. **Saldo anterior**: una fila por mes, `period` real `< inicio`. "Desde cuándo debía" = crear
   filas; "más atrás" = agregar filas; "me equivoqué" = anular las filas que sobran (admin, motivo,
   una por una) — ya no hace falta anular todo y recargar.
5. **Invariante**: nunca conviven `Σ pending > 0` y `Σ credit > 0` en un socio (lo garantizan los
   tres triggers; un test lo recorre en todos los caminos).
6. Identidades: `Σ pending − Σ credit = cargos − pagos`; `Σ allocated + Σ credit = Σ pagos
   vigentes`; por cuota `paid ≤ amount`; por pago `allocated ≤ amount`.

### 6.3 Meses previos y fecha de alta (decisión previa del usuario, vigente)

`J` = mes de `members.joined_on`, `F` = primer mes previo marcado, `P` = último mes previo (antes
del inicio: el mes actual; después: inicio − 1), `W` = primer mes de la ventana de 12.

- Meses a crear = todas las celdas `pre_system` de `[min(F, max(J, W)), P]` (las que ya tienen
  fila no son `pre_system` y no se vuelven a crear). Si `J < F`, la deuda corre desde el alta y los
  meses sin marcar "quedan debiendo". Si `J > F` (placeholder `2026-10-01` de los importados, o
  fecha mal cargada), arranca en `F` y **la UI avisa** (no bloquea): "Marcaste meses anteriores a la
  fecha de alta (octubre 2026). Si pagó esos meses, la fecha de alta está mal: corregila desde la
  ficha", link a `/socios/[id]/editar`. `before_joined` lo marca la RPC.
- El pago imputa solo lo marcado; los demás meses creados quedan adeudados.
- `correct_member_joined_on`: sin cambios. Mover el alta hacia atrás a un mes `≥ inicio` genera
  esas cuotas en la próxima corrida y el crédito del socio (si lo hay) las cubre solo; mover hacia
  adelante por encima de un saldo anterior ya cargado **no bloquea** (es una inconsistencia que la
  UI muestra con el mismo aviso; bloquear sería una política nueva: pregunta 3).
- En la ficha ("Indicar desde cuándo debía" / "Agregar meses anteriores") rige la misma regla, sin
  pago.

### 6.4 Modelos, controllers, vistas (MVC)

- `src/models/types.ts` (hilo principal): ver §10.
- `fees.model.ts`: `createOpeningBalanceMonths({ memberId, months: [{period, amountCents}] })` → UN
  insert de N filas con `period` explícito (sin tramo, sin `description`: la pone el guard);
  traduce 23505 `fees_one_opening_balance` → "Ya hay un saldo anterior cargado para <mes>". Se
  elimina `createOpeningBalanceFromMonths` y `openingBalanceMonthsSchema`; `createOpeningBalance`
  (monto suelto) se elimina si ninguna vista lo usa (hoy ninguna).
- `payments.model.ts`: `paymentItemSchema` suma `markedPeriods?: ISODate[] | null` (≤ 60, día 1,
  únicos) y `openingMonths?: OpeningMonth[] | null` (≤ 36, día 1, únicos, montos enteros > 0);
  manda `marked_periods` / `opening_months`; **ya no manda `opening_balance`**. Traduce los
  mensajes nuevos (23514 no crudo → `DomainError`). `listPaymentsForMember` embebe
  `payment_allocations(amount_cents, source, fee:fees(period, kind, voided_at))` y descarta las
  de cuotas anuladas → `Payment.allocations`.
- `accounts.model.ts`: `getOpeningBalances(memberId) → Fee[]` (vigentes, por `period`); mapeo de
  `payment_month_options` sin `opening_from`, con `before_joined`; **detección de schema** (§4.6).
- `audit.model.ts`: etiqueta para `payment_allocations` ("imputación de $X a <cuota> del pago del
  DD/MM").
- `payments.actions.ts`: `createOpeningBalanceMonths` reemplaza a `createOpeningBalanceFromMonths`
  (valida `toPeriod < inicio` como hoy, ahora por cada mes). Sin actions nuevas.
- Vistas: §6.5. Sin servicios nuevos, sin rutas nuevas, sin cambios de permisos.

### 6.5 Flujo

1. Abrir el overlay → `getPaymentFormData` → `member_accounts` + `payment_month_options` (N socios,
   una llamada cada una). Si falta `before_joined` → "El sistema se está actualizando".
2. Tocar/arrastrar → `month-selection` deriva: `markedPeriods` (meses marcados con cuota, previos
   incluidos), `openingMonths` (previos de `[from, P]` con su monto: precio o total corregido
   repartido con `splitOpeningTotal`), monto = Σ pendiente efectivo de lo marcado, "queda
   debiendo".
3. Registrar → `register_payment_batch` → una transacción: filas de saldo → trigger (crédito previo)
   → pagos → trigger (marcados, resto al más viejo) → auditoría con `auth.uid()`.
4. Reintento (mismo `batchId`) → `already_registered`, sin tocar nada.
5. Lecturas: ficha, padrón, listados y panel leen por sus RPC de siempre; la ficha además lista
   `openingBalances` y, por pago, "Cubre may y jul".

### 6.6 Inventario: todo lo que hoy deriva cobertura o deuda, y qué le pasa

| Objeto (migración vigente) | Hoy | Con el modelo nuevo |
|---|---|---|
| `private.member_fee_coverage` (130200) | balance forward por cargo | **Redefinida**: Σ imputaciones vigentes por cuota. Misma firma |
| `private.member_balance` (130200) | cargos − pagos; `months_due` por acumulado | **Redefinida**: mismos totales; `months_due`/`oldest` desde `fee_status`. Misma firma |
| `member_balance_cents` / `member_debt_status` / `member_months_due` (130200) | vía `member_balance` | Sin cambios (filtro `debt` del padrón incluido) |
| `public.member_accounts` (130200) | vía `member_balance` | Sin cambios |
| `public.member_fee_statement` (130200) | vía `member_fee_coverage` | Sin cambios de cuerpo; ahora una línea por mes de saldo |
| `public.debt_by_category` (130200) | vía `member_fee_coverage` | Sin cambios; bucket `opening_balance` cuenta `distinct member` |
| `public.dashboard_summary` (130200) | `member_balance` + `paid_on` | Sin cambios |
| `public.monthly_history` (130200) | cargos ≤ P − pagos ≤ fin P | Sin cambios (deuda "como se sabe hoy") |
| `public.month_collection` (130200), `daily_collection` (120000), `cash_month_summary` (131013) | por `paid_on` | Sin cambios |
| `public.payment_month_options` (141024170000) | expansión del tramo + balance forward | **Drop + create**: desde `fee_status`; sin `opening_from`, con `before_joined`; `pre_system` por mes sin fila |
| `public.register_payment_batch` (141024170000) | tramo + pagos | **Replace**: meses + marcados; payload viejo expandido |
| `private.generate_monthly_fees` / `generate_pending_fees` (130000) | crea cuotas | Sin cambios; el trigger de `fees` aplica crédito |
| `private.fees_opening_balance_guard` (141024170000) | fija `period`, valida tramo | **Replace**: por mes; rechaza tramo |
| `private.fees_void_guard` (130000) | permiso + actor | Sin cambios; se **desactiva** solo durante la conversión |
| `public.correct_member_joined_on` (141015120100) | bloquea por `monthly` | Sin cambios |
| Anulación de pago (`payments_update_guard`, 130100) | marca el pago | Sin cambios; sus imputaciones quedan inertes |
| Anulación de cuota (`fees_void_guard`) | marca la cuota | + trigger `fees_apply_credit_on_void` |
| Carga de saldo anterior: `fees.model.ts` + lote | una fila con tramo | N filas por mes (`period` con grant) |
| `fees_one_opening_balance` | `(member_id)` | `(member_id, period)` |
| `log_export`, `cash_*`, `sponsor_*`, `keep_alive` | — | Sin cambios |

## 7. La migración de datos (lo crítico)

Archivo único `supabase/migrations/20261029120000_payment_allocations.sql`, una transacción
(§3). Orden y por qué:

0. `set local statement_timeout = '10min'` (por si el proyecto hosted tiene un tope bajo para
   `postgres`; con ~250 socios tarda segundos).
1. **Foto** (`private.allocation_migration_snapshot()`): tablas temporales `mig_fees` (cada cargo
   vigente con su cobertura por la fórmula de hoy, escrita inline para no depender de la función que
   se redefine después), `mig_cells` (cada mes de cada tramo con su monto por partes enteras y su
   cobertura repartida del más viejo al más nuevo: la fórmula de `payment_month_options` de hoy),
   `mig_members` (cargos y pagos vigentes por socio). Se toma **antes de tocar nada**.
2. **DDL**: helper `split_opening_total`; índice `fees_one_opening_balance` nuevo; guard nuevo;
   grants de `fees`; tabla `payment_allocations` + guard + RLS + auditoría; vistas; funciones del
   motor (**sin crear todavía los triggers**: la conversión y el backfill no deben disparar
   `apply_credit`).
3. **Conversión** (`private.migrate_opening_spans()`): por cada `opening_balance` vigente con tramo,
   en orden de `id`: (a) `alter table public.fees disable trigger fees_void_guard` (dentro de la
   función, una vez; `fees_immutable` y la auditoría siguen activas); (b) UPDATE que anula la fila:
   `voided_at = now()`, `voided_by = '00000000-0000-0000-0000-000000000000'` (el mismo uuid de
   relleno que usa el seed para anulaciones sin usuario; la columna no tiene FK), `void_reason =
   'Convertido a saldo anterior por mes (migración 20261029120000)'`; (c) INSERT de N filas
   `opening_balance` con `period` = cada mes del tramo, `amount_cents` = `split_opening_total`,
   `description = 'Saldo anterior · MM/YYYY'`, **`created_by` y `created_at` copiados de la fila
   original** (quién la cargó y cuándo siguen siendo verdad; la fila de auditoría del INSERT dice
   `system` y la fecha real de la migración); (d) re-enable del guard. Anular ANTES de insertar: la
   fila con tramo tiene `period = inicio − 1` y chocaría con el índice nuevo cuando `to_period =
   inicio − 1`. Idempotente: sin tramos vigentes no hace nada.
4. **Backfill** (`private.backfill_allocations()`): si `payment_allocations` está vacía, un INSERT
   set-based: pagos vigentes por socio ordenados por `(paid_on, id)` con acumulado; cargos vigentes
   (ya convertidos) ordenados por `(period, saldo antes que cuota, discipline_id nulls first, id)`
   con acumulado; imputación = solape de intervalos, `source = 'backfill'`, `created_by = null`. Lo
   que sobra queda como crédito (sin fila). Reproduce exactamente la cobertura por cargo de hoy:
   Σ por cargo del solape con cada pago = solape con `[0, Σ pagos)` = `member_fee_coverage`. El
   guard valida cada fila (si una se pasara del tope, aborta todo).
5. **Verificación** (`private.allocation_migration_verify()`), `raise exception` ante cualquier
   diferencia, siempre con ids (nunca nombres):
   - cada cargo de `mig_fees` sin tramo: `fee_status.paid_cents` (0 si anulado) = cobertura vieja;
   - cada celda de `mig_cells`: existe exactamente una fila `opening_balance` vigente para
     `(socio, mes)` con `amount_cents` = monto de la celda y `paid_cents` = cobertura de la celda;
   - por socio: Σ `pending_cents` = `max(0, cargos − pagos)` viejo; Σ `credit_cents` = `max(0, pagos
     − cargos)` viejo;
   - por socio: Σ montos de los tramos anulados = Σ montos de las filas nuevas (las vigentes de
     `opening_balance` que no estaban en `mig_fees`);
   - por pago: `allocated ≤ amount`; ninguna imputación apunta a una cuota o pago anulado;
   - global: Σ imputado + Σ crédito = Σ pagos vigentes; cuenta de filas anuladas = tramos vigentes
     de la foto; `raise notice` con cuántos saldos sin tramo quedaron tal cual.
   Después, `drop table` de las temporales.
6. **Triggers del motor** (recién ahora), **RPC** (`payment_month_options` drop+create,
   `register_payment_batch` replace, `member_fee_coverage`, `member_balance`), **grants** y el
   `revoke execute on all functions in schema private from public, anon` de siempre, más el revoke
   explícito de las funciones del motor y de migración a `authenticated` y `service_role`.

**Idempotencia**: el CLI no vuelve a correr un archivo versionado; si alguien lo forzara
(`migration repair`), `create table public.payment_allocations` falla en la primera sentencia y la
transacción no deja nada. Las funciones de datos (3, 4) además son no-op si ya corrieron. Las
funciones de migración quedan en `private` (sin EXECUTE para nadie) **para que el test de base las
pruebe con fixtures propias**.

**Locks**: `alter table … disable trigger` y `drop index` toman locks exclusivos sobre `fees`
durante la transacción (segundos). Una escritura concurrente espera; una lectura del panel espera
en el `drop index`. Por eso la ventana es fuera del horario de carga.

**Transaccionalidad**: §3. Regla escrita en el encabezado del archivo: ninguna sentencia de primer
nivel puede empezar con `CREATE/DROP INDEX CONCURRENTLY`, `REINDEX … CONCURRENTLY`, `VACUUM`,
`ALTER SYSTEM` ni `CLUSTER`.

### 7.1 Procedimiento de release

**Antes de mergear (en esta máquina, con la contraseña de Postgres del proyecto hosted,
`SUPABASE_DB_PASSWORD`; el proyecto ya está vinculado):**

```bash
# 1. Backup de datos de producción (es también EL backup previo: el plan free no tiene PITR).
#    Contiene datos personales de menores: queda en el scratchpad, cifrado, y se borra a los 30 días.
mkdir -p /private/tmp/claude-501/-Volumes-SSD-Work-lonqui/01bf675d-b836-44c7-b8ee-c33e4e87cb06/scratchpad/prod-dump
npx supabase db dump --linked --data-only --use-copy \
  -x supabase_migrations.schema_migrations,supabase_migrations.seed_files \
  -f /private/tmp/claude-501/-Volumes-SSD-Work-lonqui/01bf675d-b836-44c7-b8ee-c33e4e87cb06/scratchpad/prod-dump/prod-data.sql \
  -p "$SUPABASE_DB_PASSWORD"
# (el dump empieza con `SET session_replication_role = replica`: los triggers no corren al restaurar;
#  pg_dump incluye los setval de las secuencias)

# 2. Base local con el schema de producción (todas las migraciones MENOS la nueva), sin seed.
npm run db:start
npx supabase db reset --no-seed --version 20261024170000

# 3. Restaurar los datos de producción en local.
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
  -f /private/tmp/claude-501/-Volumes-SSD-Work-lonqui/01bf675d-b836-44c7-b8ee-c33e4e87cb06/scratchpad/prod-dump/prod-data.sql

# 4. Foto de control independiente de la migración (se compara a mano después).
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c "
  select m.id, b.charged_cents, b.paid_cents, b.balance_cents
  from public.members m cross join lateral private.member_balance(m.id) b order by m.id" \
  > /private/tmp/claude-501/-Volumes-SSD-Work-lonqui/01bf675d-b836-44c7-b8ee-c33e4e87cb06/scratchpad/prod-dump/balances-antes.txt

# 5. Aplicar SOLO la migración nueva, por el mismo camino que usa el CI (mismo ExecBatch).
npx supabase migration up --local
#    Si la verificación aborta, el error nombra socio/cargo por id: se corrige el SQL y se repite 2–5.

# 6. Comparar la foto (balance_cents tiene que ser idéntico fila por fila) y mirar el libro.
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c "
  select m.id, b.charged_cents, b.paid_cents, b.balance_cents
  from public.members m cross join lateral private.member_balance(m.id) b order by m.id" \
  | diff - /private/tmp/claude-501/-Volumes-SSD-Work-lonqui/01bf675d-b836-44c7-b8ee-c33e4e87cb06/scratchpad/prod-dump/balances-antes.txt && echo "balances idénticos"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select source, count(*), sum(amount_cents) from public.payment_allocations group by 1;
  select count(*) filter (where voided_at is not null and from_period is not null) as tramos_anulados,
         count(*) filter (where voided_at is null and from_period is null) as filas_por_mes
  from public.fees where kind = 'opening_balance';
  select count(*) from (select member_id from public.fee_status group by 1 having sum(pending_cents) > 0
    intersect select member_id from public.payment_credit group by 1 having sum(credit_cents) > 0) x;  -- tiene que dar 0"

# 7. Suite completa contra la base migrada con datos reales (los tests crean sus propios socios).
npm test
```

**Mergear**: fuera del horario de carga (noche o fin de semana), avisando a la Comisión que no
registre pagos durante 15 minutos. El CI aplica la migración (`--dry-run` primero, queda en el
log); Vercel despliega en paralelo. Orden real: **el código nuevo llega unos minutos antes que el
schema**; lo cubre la detección de schema (§4.6) y el gate del formulario.

**Después del release (SQL Editor del dashboard, solo lectura):** las mismas tres consultas del
paso 6; `select count(*) from public.audit_log where table_name = 'payment_allocations'`;
`billing_runs` sin filas nuevas; abrir la ficha de un socio con saldo convertido y una con saldo a
favor; registrar un pago de prueba marcando dos meses sueltos y anularlo (motivo "prueba de
release").

**Rollback.**
- Falla la migración (verificación o cualquier sentencia): la transacción se revierte entera y la
  versión no se registra; la base queda como estaba. El código nuevo en Vercel queda bloqueado por
  el gate ("se está actualizando") y la ficha sigue funcionando con `getOpeningBalances` (lee filas
  de `fees` de siempre). Se corrige el SQL y se vuelve a pushear (mismo archivo: no quedó
  registrado). Si hiciera falta volver el código: Vercel → Instant Rollback a la build anterior.
- Falla después (algo que la verificación no cubre): migración hacia adelante, nunca a mano:
  (1) drop de los tres triggers del motor; (2) restaurar `payment_month_options` y
  `register_payment_batch` de `20261024170000`, `member_fee_coverage` y `member_balance` de
  `20260927130200`, el guard de `20261024170000`, el índice `(member_id)`; (3) por cada socio con
  filas por mes creadas por la conversión: insertar una fila con tramo nueva (`from` = mes más
  viejo, `to` = más nuevo, monto = Σ) y anular las filas por mes (motivo "reversión …");
  (4) `drop view`, `drop table payment_allocations`. La plata nunca cambia (`cargos − pagos` es
  invariante en las dos direcciones); se pierde solo la intención de las imputaciones hechas
  entre medio.

## 8. Transversales

- **Permisos**: todo con `payments.register` (celdas, registrar, saldo anterior) y `payments.void`
  (anular). `consulta` lee `fee_status`, `payment_credit` y `payment_allocations` con
  `payments.read`. Nada por rol.
- **Auditoría**: `payment_allocations` auditada; actor `auth.uid()` (triggers DEFINER no lo
  cambian); el cron deja `system`; el backfill y la conversión `system`; cada imputación lleva
  `source`. Anular pago/cuota ya audita.
- **Nada se borra**: tabla sin UPDATE/DELETE/TRUNCATE para nadie (`enable always`); los tramos
  convertidos quedan anulados con motivo; corregir una imputación = anular el pago y recargar.
- **Dinero**: centavos; Σ y KPIs en SQL; el cliente solo suma pendientes para el monto a enviar y
  el preview.
- **Zona horaria**: `private.club_today()`; nada nuevo.
- **Datos personales**: ids en errores y logs; el dump de producción vive cifrado y se borra.
- **Concurrencia**: `apply_credit`/`allocate_marked` bloquean al socio; el guard bloquea pago y
  cuota. Un deadlock es posible si un admin anula una cuota en el mismo segundo en que un editor
  registra un pago del mismo socio (la anulación toma la fila de la cuota antes que al socio;
  el lote al revés): Postgres aborta uno a 1 s, el reintento (mismo `batchId`) registra. Aceptado.
- **Fallas**: RPC de lectura falla → `ErrorState`; escritura falla → todo revertido; mensajes del
  guard y del motor viajan como `DomainError`. Deadlock (40P01) → error genérico + reintento.
- **Cache**: `revalidatePath('/', 'layout')` en toda escritura, como hoy.
- **Compatibilidad en la ventana** (minutos): *código viejo + schema nuevo*: el lote funciona
  (payload viejo expandido; sin marcados = más viejo primero, lo de hoy); la grilla vieja ve las
  celdas del saldo sin `opening_from` y las rotula "Saldo anterior · $X" (cosmético); **la ficha
  de un socio con dos o más meses de saldo da error** (`getOpeningBalance().maybeSingle()`) y
  **cargar saldo desde la ficha vieja da error genérico** (grant de tramo revocado). *Código nuevo +
  schema viejo*: el formulario no abre (gate); la ficha lista saldos (funciona); cargar saldo desde
  la ficha nueva falla con 42501 (sin grant de `period`): nada se escribe. Por eso: ventana corta y
  fuera de horario.
- **Caja aislada**: ninguna función tocada lee `cash_movements`; `cash-isolation.test.ts` sigue.
- **Performance**: `fee_status` es un lateral por cuota con índice por `fee_id`; `member_balance`
  por socio es una lectura indexada; `dashboard_summary` recorre ~250 socios × ~12 cuotas. Nada
  supera `max_rows`.
- **Seed**: funciona sin cambios (saldos sin `period` → `inicio − 1`; los pagos disparan el motor;
  el pago anulado no imputa).

## 9. SQL propuesto (lo copia el hilo principal; `supabase/migrations/20261029120000_payment_allocations.sql`)

**No se corrió contra ninguna base.** Estilo de las migraciones vigentes. El hilo principal lo
aplica con `npm run db:reset`, corre `tests/db/`, y antes de mergear sigue §7.1 contra el dump de
producción. Puntos a mirar primero: el `referencing new table` del trigger de statement, los
`#variable_conflict use_column`, y que ninguna sentencia de primer nivel sea de las que cortan el
pipeline.

```sql
-- =============================================================================
-- Imputación explícita por cuota y saldo anterior por mes.
--
-- Pipeline: docs/pipelines/2026-10-29-imputacion-libre-meses/ (00-architecture §6–§9).
--
-- Hasta acá un pago era un pozo por socio y la cobertura se derivaba al leer
-- (balance forward); el saldo anterior era UNA fila con tramo. Desde acá:
--   * fees: el saldo anterior es una fila por mes (period real, < inicio).
--   * payment_allocations: "este pago cubrió esta cuota con tantos centavos".
--     Append-only. Escriben solo las funciones DEFINER del motor (triggers).
--   * fee_status / payment_credit: pagada/parcial/adeudada por cuota, saldo a
--     favor por pago. Deuda = Σ pending. Nada almacenado.
--   * Motor: al insertar un pago (marcados primero, resto al más viejo), al
--     insertar cuotas (crédito a las nuevas) y al anular una cuota (su plata
--     vuelve a crédito y se reimputa).
--   * Datos: cada tramo vigente se anula (motivo fijo, actor sistema) y se
--     reemplaza por sus meses; cada pago vigente queda imputado como el
--     sistema lo mostraba hoy ('backfill'). Si un centavo cambia, aborta.
--
-- TRANSACCIÓN: supabase db push manda el archivo entero en un pipeline con un
-- solo Sync: es UNA transacción implícita, y la fila de versión va adentro.
-- Nada acá puede empezar con CREATE/DROP INDEX CONCURRENTLY, REINDEX
-- CONCURRENTLY, VACUUM, ALTER SYSTEM ni CLUSTER: el CLI saca esas sentencias
-- del pipeline y partiría la transacción.
--
-- Reversa: ver 00-architecture §7.1 (migración hacia adelante).
-- =============================================================================

set local statement_timeout = '10min';

-- -----------------------------------------------------------------------------
-- 1. Foto de la cobertura vigente, ANTES de tocar nada. Fórmulas inline: las
--    funciones que las definían se redefinen más abajo. Tablas temporales de la
--    sesión; la verificación (sección 9) las lee y las borra.
-- -----------------------------------------------------------------------------
create function private.allocation_migration_snapshot()
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute 'drop table if exists pg_temp.mig_fees';
  execute 'drop table if exists pg_temp.mig_cells';
  execute 'drop table if exists pg_temp.mig_members';

  -- Cobertura por cargo: balance forward (20260927130200).
  create temp table mig_fees as
  with paid as (
    select p.member_id, sum(p.amount_cents)::bigint as total
    from public.payments p
    where p.voided_at is null
    group by p.member_id
  ),
  ordered as (
    select
      f.id, f.member_id, f.kind, f.period, f.amount_cents, f.from_period, f.to_period,
      sum(f.amount_cents) over (
        partition by f.member_id
        order by f.period, case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id
      ) as cumulative
    from public.fees f
    where f.voided_at is null
  )
  select
    o.member_id, o.id as fee_id, o.kind, o.period, o.amount_cents, o.from_period, o.to_period,
    greatest(0, least(o.amount_cents, coalesce(p.total, 0) - (o.cumulative - o.amount_cents)))::bigint as covered_cents
  from ordered o
  left join paid p on p.member_id = o.member_id;

  -- Celdas por mes de cada tramo: reparto y cobertura de payment_month_options (20261024170000).
  create temp table mig_cells as
  with months as (
    select
      s.member_id, s.fee_id, gs::date as period, s.amount_cents as total, s.covered_cents as total_covered,
      row_number() over (partition by s.fee_id order by gs) as k,
      count(*) over (partition by s.fee_id) as n
    from pg_temp.mig_fees s
    cross join generate_series(s.from_period, s.to_period, interval '1 month') gs
    where s.kind = 'opening_balance' and s.from_period is not null
  ),
  sized as (
    select m.*, (case when m.k < m.n then m.total / m.n else m.total - (m.n - 1) * (m.total / m.n) end)::bigint as cell
    from months m
  )
  select
    s.member_id, s.fee_id, s.period, s.cell as amount_cents,
    greatest(0, least(s.cell, s.total_covered - (s.k - 1) * (s.total / s.n)))::bigint as covered_cents
  from sized s;

  create temp table mig_members as
  select
    m.id as member_id,
    coalesce((select sum(f.amount_cents) from public.fees f where f.member_id = m.id and f.voided_at is null), 0)::bigint as charged_cents,
    coalesce((select sum(p.amount_cents) from public.payments p where p.member_id = m.id and p.voided_at is null), 0)::bigint as paid_cents
  from public.members m;
end;
$$;

select private.allocation_migration_snapshot();

-- -----------------------------------------------------------------------------
-- 2. Reparto de un total en n partes enteras, el resto en la última. Espejo
--    exacto de splitOpeningTotal (TS); un test de DB compara los dos.
-- -----------------------------------------------------------------------------
create function private.split_opening_total(total bigint, n integer)
returns bigint[]
language sql
immutable
set search_path = ''
as $$
  select case when n <= 0 then '{}'::bigint[] else
    array(
      select (case when k < n then total / n else total - (n - 1) * (total / n) end)::bigint
      from generate_series(1, n) k
      order by k
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. fees: el saldo anterior es una fila por mes.
-- -----------------------------------------------------------------------------

-- Un saldo vigente por socio Y MES (antes: uno por socio). Mismo nombre: el
-- modelo ya traduce este 23505.
drop index public.fees_one_opening_balance;
create unique index fees_one_opening_balance
  on public.fees (member_id, period) where kind = 'opening_balance' and voided_at is null;

-- period ya no lo fija la base: viene del mes real (la ficha y el lote lo
-- mandan). Sin period (seed, código viejo) sigue siendo inicio − 1.
grant insert (period) on public.fees to authenticated;
-- El tramo no se carga nunca más. Las columnas quedan por la historia de las
-- filas anuladas (y su CHECK e inmutabilidad siguen).
revoke insert (from_period, to_period) on public.fees from authenticated;

create or replace function private.fees_opening_balance_guard()
returns trigger
language plpgsql
-- DEFINER: la invariante no depende de la RLS de quien escribe (review B4).
security definer
set search_path = ''
as $$
declare
  start_period date;
begin
  if new.kind <> 'opening_balance' then
    return new;
  end if;

  select billing_start_period into start_period from public.settings where id = 1;
  if start_period is null then
    raise exception 'Primero activá las cuotas en Ajustes' using errcode = 'check_violation';
  end if;
  if new.amount_cents <= 0 then
    raise exception 'El saldo anterior tiene que ser mayor a cero' using errcode = 'check_violation';
  end if;
  if new.from_period is not null or new.to_period is not null then
    raise exception 'El saldo anterior se carga mes por mes. Recargá la página y volvé a intentar'
      using errcode = 'check_violation';
  end if;

  -- Compat: sin período = el mes anterior al inicio (seed, código anterior).
  if new.period is null then
    new.period := (start_period - interval '1 month')::date;
  end if;
  if new.period <> date_trunc('month', new.period)::date then
    raise exception 'El mes del saldo anterior no es válido' using errcode = 'check_violation';
  end if;
  if new.period >= start_period then
    raise exception 'El saldo anterior solo cubre meses anteriores a %', to_char(start_period, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;
  if new.period < (start_period - interval '36 months')::date then
    raise exception 'El saldo anterior no puede ir más de 36 meses atrás' using errcode = 'check_violation';
  end if;

  new.description := coalesce(nullif(btrim(new.description), ''), 'Saldo anterior · ' || to_char(new.period, 'MM/YYYY'));
  new.fee_price_id := null;
  new.category_id := null;
  new.discipline_id := null;
  return new;
end;
$$;

comment on column public.fees.from_period is
  'Histórico: tramo de los saldos anteriores cargados antes de 20261029120000, hoy anulados. Ninguna fila nueva lo usa.';

-- -----------------------------------------------------------------------------
-- 4. payment_allocations
-- -----------------------------------------------------------------------------
create table public.payment_allocations (
  id bigint generated always as identity primary key,
  payment_id bigint not null references public.payments (id) on delete restrict,
  fee_id bigint not null references public.fees (id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  -- marked: el operador marcó el mes; oldest_first: el resto del pago, al
  -- más viejo; credit: saldo a favor aplicado después (generador, anulación
  -- de cuota); backfill: la migración que imputó la historia.
  source text not null check (source in ('marked', 'oldest_first', 'credit', 'backfill')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.payment_allocations is
  'Qué cuota cubrió cada pago y con cuántos centavos. Append-only. Un pago puede imputarse dos veces a la misma cuota en momentos distintos (sin índice único a propósito). Una imputación a una cuota o pago anulados queda inerte: fee_status y payment_credit las ignoran.';

create index payment_allocations_payment_id_idx on public.payment_allocations (payment_id);
create index payment_allocations_fee_id_idx on public.payment_allocations (fee_id);

-- Historia: ni UPDATE, ni DELETE, ni TRUNCATE, para nadie, incluso con
-- session_replication_role = replica (como audit_log).
create trigger payment_allocations_no_change
  before update or delete on public.payment_allocations
  for each row execute function private.forbid_change();
create trigger payment_allocations_no_truncate
  before truncate on public.payment_allocations
  for each statement execute function private.forbid_change();
alter table public.payment_allocations enable always trigger payment_allocations_no_change;
alter table public.payment_allocations enable always trigger payment_allocations_no_truncate;

-- Invariantes, válidas por cualquier camino:
--   - pago y cuota existen, están vigentes y son del mismo socio;
--   - Σ imputado a la cuota (pagos no anulados) + nuevo <= monto de la cuota;
--   - Σ imputado del pago (cuotas no anuladas) + nuevo <= monto del pago.
-- Bloquea pago y cuota: dos escrituras sobre la misma cuota se serializan y la
-- segunda ve la primera (también dentro de un INSERT de varias filas).
create function private.payment_allocations_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay record;
  fee record;
  fee_paid bigint;
  pay_allocated bigint;
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

  select f.id, f.member_id, f.period, f.amount_cents, f.voided_at
  into fee
  from public.fees f
  where f.id = new.fee_id
  for update;
  if not found then
    raise exception 'La cuota no existe' using errcode = 'foreign_key_violation';
  end if;
  if fee.voided_at is not null then
    raise exception 'Una cuota anulada no recibe imputaciones' using errcode = 'check_violation';
  end if;
  if fee.member_id <> pay.member_id then
    raise exception 'El pago y la cuota son de socios distintos' using errcode = 'check_violation';
  end if;

  select coalesce(sum(a.amount_cents), 0) into fee_paid
  from public.payment_allocations a
  join public.payments p on p.id = a.payment_id
  where a.fee_id = new.fee_id and p.voided_at is null;
  if fee_paid + new.amount_cents > fee.amount_cents then
    raise exception 'La cuota de % ya está paga, o le falta menos de lo imputado', to_char(fee.period, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(a.amount_cents), 0) into pay_allocated
  from public.payment_allocations a
  join public.fees f on f.id = a.fee_id
  where a.payment_id = new.payment_id and f.voided_at is null;
  if pay_allocated + new.amount_cents > pay.amount_cents then
    raise exception 'Lo imputado supera el monto del pago' using errcode = 'check_violation';
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
-- Sin policy de INSERT: nadie inserta desde la app. Escribe el motor (DEFINER).

revoke all on public.payment_allocations from anon, authenticated, service_role;
grant select on public.payment_allocations to authenticated, service_role;

select private.enable_audit('public.payment_allocations');

-- -----------------------------------------------------------------------------
-- 5. Vistas: UNA definición de "pagada / parcial / adeudada" y de "saldo a
--    favor". security_invoker: valen las RLS de fees, payments y allocations.
-- -----------------------------------------------------------------------------
create view public.fee_status with (security_invoker = true) as
select
  f.id as fee_id,
  f.member_id,
  f.period,
  f.kind,
  f.category_id,
  f.discipline_id,
  f.amount_cents,
  coalesce(a.paid, 0)::bigint as paid_cents,
  (f.amount_cents - coalesce(a.paid, 0))::bigint as pending_cents,
  case
    when coalesce(a.paid, 0) >= f.amount_cents then 'paid'
    when coalesce(a.paid, 0) > 0 then 'partial'
    else 'due'
  end as status
from public.fees f
left join lateral (
  select sum(al.amount_cents) as paid
  from public.payment_allocations al
  join public.payments p on p.id = al.payment_id
  where al.fee_id = f.id and p.voided_at is null
) a on true
where f.voided_at is null;

create view public.payment_credit with (security_invoker = true) as
select
  p.id as payment_id,
  p.member_id,
  p.paid_on,
  p.amount_cents,
  coalesce(a.allocated, 0)::bigint as allocated_cents,
  (p.amount_cents - coalesce(a.allocated, 0))::bigint as credit_cents
from public.payments p
left join lateral (
  select sum(al.amount_cents) as allocated
  from public.payment_allocations al
  join public.fees f on f.id = al.fee_id
  where al.payment_id = p.id and f.voided_at is null
) a on true
where p.voided_at is null;

revoke all on public.fee_status, public.payment_credit from anon, authenticated, service_role;
grant select on public.fee_status, public.payment_credit to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Motor de imputación (DEFINER, sin EXECUTE para nadie: lo llaman triggers).
-- -----------------------------------------------------------------------------

-- Crédito de los pagos más viejos a las cuotas pendientes más viejas, por
-- solape de acumulados. UN insert; el guard valida cada fila. Bloquea al socio.
create function private.apply_credit(p_member_id bigint, p_source text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform 1 from public.members m where m.id = p_member_id for update;

  insert into public.payment_allocations (payment_id, fee_id, amount_cents, source)
  with credits as (
    select pc.payment_id, pc.credit_cents,
           sum(pc.credit_cents) over (order by pc.paid_on, pc.payment_id) as hi
    from public.payment_credit pc
    where pc.member_id = p_member_id and pc.credit_cents > 0
  ),
  pendings as (
    select fs.fee_id, fs.pending_cents,
           sum(fs.pending_cents) over (
             order by fs.period, case fs.kind when 'opening_balance' then 0 else 1 end, fs.discipline_id nulls first, fs.fee_id
           ) as hi
    from public.fee_status fs
    where fs.member_id = p_member_id and fs.pending_cents > 0
  )
  select
    c.payment_id,
    f.fee_id,
    least(c.hi, f.hi) - greatest(c.hi - c.credit_cents, f.hi - f.pending_cents),
    p_source
  from credits c
  join pendings f on least(c.hi, f.hi) > greatest(c.hi - c.credit_cents, f.hi - f.pending_cents)
  order by f.hi, c.hi;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Los meses marcados, en orden, hasta donde alcanza el pago. Un mes marcado
-- sin pendiente (otro operador lo cobró, o el crédito previo lo cubrió) se
-- saltea: la plata sigue al más viejo adeudado (apply_credit, después).
create function private.allocate_marked(p_payment_id bigint, p_periods date[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay record;
  f record;
  remaining bigint;
  take bigint;
  n integer := 0;
begin
  select p.id, p.member_id, p.amount_cents into pay from public.payments p where p.id = p_payment_id;
  perform 1 from public.members m where m.id = pay.member_id for update;

  select pay.amount_cents - coalesce(sum(a.amount_cents), 0) into remaining
  from public.payment_allocations a
  join public.fees fe on fe.id = a.fee_id
  where a.payment_id = p_payment_id and fe.voided_at is null;

  for f in
    select fs.fee_id, fs.pending_cents
    from public.fee_status fs
    where fs.member_id = pay.member_id and fs.period = any (p_periods) and fs.pending_cents > 0
    order by fs.period, case fs.kind when 'opening_balance' then 0 else 1 end, fs.discipline_id nulls first, fs.fee_id
  loop
    exit when remaining <= 0;
    take := least(remaining, f.pending_cents);
    insert into public.payment_allocations (payment_id, fee_id, amount_cents, source)
    values (p_payment_id, f.fee_id, take, 'marked');
    remaining := remaining - take;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Trigger de payments: los meses marcados llegan por un GUC local a la
-- transacción que solo register_payment_batch setea
-- ({"<member_id>": ["2026-05-01", ...]}); sin GUC, todo al más viejo.
create function private.payments_allocate_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  marked jsonb := nullif(current_setting('lonqui.marked_periods', true), '')::jsonb;
  periods date[];
begin
  if new.voided_at is not null then
    return null;
  end if;
  if marked is not null and marked ? new.member_id::text then
    select array_agg(x::date) into periods
    from jsonb_array_elements_text(marked -> new.member_id::text) x;
    perform private.allocate_marked(new.id, periods);
  end if;
  perform private.apply_credit(new.member_id, 'oldest_first');
  return null;
end;
$$;

-- Trigger de fees (statement): cuotas nuevas (cron, saldo anterior, ajustes)
-- absorben el crédito del socio.
create function private.fees_apply_credit_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m bigint;
begin
  for m in select distinct i.member_id from inserted i where i.voided_at is null loop
    perform private.apply_credit(m, 'credit');
  end loop;
  return null;
end;
$$;

-- Trigger de fees (row): anular una cuota libera su plata, que se reimputa.
create function private.fees_apply_credit_on_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_credit(new.member_id, 'credit');
  return null;
end;
$$;

-- (Los triggers se crean en la sección 10, DESPUÉS de convertir y backfillear:
--  esos pasos no deben disparar el motor.)

-- -----------------------------------------------------------------------------
-- 7. Conversión: cada tramo vigente se anula y se reemplaza por sus meses.
--    Nada se borra. fees_void_guard exige un usuario con payments.void y no
--    hay sesión: se desactiva SOLO acá, dentro de la transacción; la auditoría
--    y fees_immutable siguen activas. Idempotente: sin tramos, no hace nada.
-- -----------------------------------------------------------------------------
create function private.migrate_opening_spans()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  s record;
  months integer;
  parts bigint[];
  n integer := 0;
begin
  if not exists (
    select 1 from public.fees f where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is not null
  ) then
    return 0;
  end if;

  execute 'alter table public.fees disable trigger fees_void_guard';

  for s in
    select f.id, f.member_id, f.amount_cents, f.from_period, f.to_period, f.created_by, f.created_at
    from public.fees f
    where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is not null
    order by f.id
  loop
    months := ((extract(year from s.to_period) - extract(year from s.from_period)) * 12
              + (extract(month from s.to_period) - extract(month from s.from_period)))::integer + 1;
    parts := private.split_opening_total(s.amount_cents, months);

    -- Primero anular (la fila con tramo ocupa (socio, inicio − 1) en el índice nuevo).
    update public.fees
    set voided_at = now(),
        voided_by = '00000000-0000-0000-0000-000000000000',
        void_reason = 'Convertido a saldo anterior por mes (migración 20261029120000)'
    where id = s.id;

    insert into public.fees (member_id, kind, period, amount_cents, description, created_by, created_at)
    select
      s.member_id,
      'opening_balance',
      (s.from_period + make_interval(months => k - 1))::date,
      parts[k],
      'Saldo anterior · ' || to_char((s.from_period + make_interval(months => k - 1))::date, 'MM/YYYY'),
      s.created_by,
      s.created_at
    from generate_series(1, months) k;

    n := n + 1;
  end loop;

  execute 'alter table public.fees enable trigger fees_void_guard';
  return n;
end;
$$;

select private.migrate_opening_spans();

-- -----------------------------------------------------------------------------
-- 8. Backfill: cada pago vigente imputado como el sistema lo mostraba hoy.
--    Pagos por (paid_on, id) y cargos por (period, saldo, deporte, id) son dos
--    acumulados; la imputación es el solape de intervalos. El remanente queda
--    como crédito. Solo si no hay ninguna imputación todavía.
-- -----------------------------------------------------------------------------
create function private.backfill_allocations()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if exists (select 1 from public.payment_allocations) then
    return 0;
  end if;

  insert into public.payment_allocations (payment_id, fee_id, amount_cents, source, created_by)
  with pays as (
    select p.id, p.member_id, p.amount_cents,
           sum(p.amount_cents) over (partition by p.member_id order by p.paid_on, p.id) as hi
    from public.payments p
    where p.voided_at is null
  ),
  charges as (
    select f.id, f.member_id, f.amount_cents,
           sum(f.amount_cents) over (
             partition by f.member_id
             order by f.period, case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id
           ) as hi
    from public.fees f
    where f.voided_at is null
  )
  select p.id, c.id, least(p.hi, c.hi) - greatest(p.hi - p.amount_cents, c.hi - c.amount_cents), 'backfill', null::uuid
  from pays p
  join charges c
    on c.member_id = p.member_id
   and least(p.hi, c.hi) > greatest(p.hi - p.amount_cents, c.hi - c.amount_cents)
  order by p.member_id, c.hi, p.hi;

  get diagnostics n = row_count;
  return n;
end;
$$;

select private.backfill_allocations();

-- -----------------------------------------------------------------------------
-- 9. Verificación. Cualquier diferencia aborta la migración entera (es una
--    transacción): mejor no migrar que migrar cambiando la deuda de alguien.
--    Mensajes con ids, nunca nombres.
-- -----------------------------------------------------------------------------
create function private.allocation_migration_verify()
returns void
language plpgsql
set search_path = ''
as $$
declare
  bad record;
  legacy integer;
begin
  -- (1) Cargos sin tramo: la cobertura es la misma.
  select s.member_id, s.fee_id, s.covered_cents as old_cents, coalesce(fs.paid_cents, 0) as new_cents
  into bad
  from pg_temp.mig_fees s
  left join public.fee_status fs on fs.fee_id = s.fee_id
  where s.from_period is null and coalesce(fs.paid_cents, 0) <> s.covered_cents
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: el cargo % (socio %) cambió de cobertura: % → %',
      bad.fee_id, bad.member_id, bad.old_cents, bad.new_cents;
  end if;

  -- (2) Cada mes de cada tramo: una fila vigente con el mismo monto y la misma cobertura.
  select c.member_id, c.fee_id, c.period, c.amount_cents, c.covered_cents,
         fs.fee_id as new_fee_id, fs.amount_cents as new_amount, fs.paid_cents as new_paid
  into bad
  from pg_temp.mig_cells c
  left join public.fee_status fs
    on fs.member_id = c.member_id and fs.period = c.period and fs.kind = 'opening_balance'
  where fs.fee_id is null or fs.amount_cents <> c.amount_cents or fs.paid_cents <> c.covered_cents
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: el mes % del saldo % (socio %) no coincide: monto %/%, cubierto %/%',
      bad.period, bad.fee_id, bad.member_id, bad.amount_cents, bad.new_amount, bad.covered_cents, bad.new_paid;
  end if;

  -- (3) Por socio: deuda y crédito idénticos a cargos − pagos.
  select m.member_id, (m.charged_cents - m.paid_cents) as old_balance,
         coalesce((select sum(fs.pending_cents) from public.fee_status fs where fs.member_id = m.member_id), 0) as pending,
         coalesce((select sum(pc.credit_cents) from public.payment_credit pc where pc.member_id = m.member_id), 0) as credit
  into bad
  from pg_temp.mig_members m
  where coalesce((select sum(fs.pending_cents) from public.fee_status fs where fs.member_id = m.member_id), 0)
          <> greatest(0, m.charged_cents - m.paid_cents)
     or coalesce((select sum(pc.credit_cents) from public.payment_credit pc where pc.member_id = m.member_id), 0)
          <> greatest(0, m.paid_cents - m.charged_cents)
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: socio % con saldo viejo %, pendiente nuevo % y crédito nuevo %',
      bad.member_id, bad.old_balance, bad.pending, bad.credit;
  end if;

  -- (4) Por socio: Σ tramos anulados = Σ filas nuevas por mes.
  select o.member_id, o.old_total, coalesce(nw.new_total, 0) as new_total
  into bad
  from (
    select s.member_id, sum(s.amount_cents) as old_total
    from pg_temp.mig_fees s where s.kind = 'opening_balance' and s.from_period is not null
    group by s.member_id
  ) o
  left join (
    select f.member_id, sum(f.amount_cents) as new_total
    from public.fees f
    where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is null
      and not exists (select 1 from pg_temp.mig_fees s where s.fee_id = f.id)
    group by f.member_id
  ) nw on nw.member_id = o.member_id
  where coalesce(nw.new_total, 0) <> o.old_total
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: socio % con tramos por % y filas por mes por %',
      bad.member_id, bad.old_total, bad.new_total;
  end if;

  -- (5) Por pago: nunca más de su monto; nada apunta a algo anulado.
  select p.id, p.amount_cents, sum(a.amount_cents) as allocated
  into bad
  from public.payments p
  join public.payment_allocations a on a.payment_id = p.id
  group by p.id, p.amount_cents
  having sum(a.amount_cents) > p.amount_cents
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: el pago % quedó imputado por % sobre un monto de %',
      bad.id, bad.allocated, bad.amount_cents;
  end if;
  if exists (
    select 1 from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    join public.fees f on f.id = a.fee_id
    where p.voided_at is not null or f.voided_at is not null
  ) then
    raise exception 'Migración de imputaciones: hay imputaciones a pagos o cuotas anulados';
  end if;

  -- (6) Global: Σ imputado + Σ crédito = Σ pagos vigentes.
  if (select coalesce(sum(a.amount_cents), 0) from public.payment_allocations a)
     + (select coalesce(sum(pc.credit_cents), 0) from public.payment_credit pc)
     <> (select coalesce(sum(p.amount_cents), 0) from public.payments p where p.voided_at is null) then
    raise exception 'Migración de imputaciones: Σ imputado + Σ crédito ≠ Σ pagos vigentes';
  end if;

  select count(*) into legacy
  from public.fees f
  where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is null
    and exists (select 1 from pg_temp.mig_fees s where s.fee_id = f.id);
  raise notice 'Migración de imputaciones: % saldos sin tramo quedaron como una fila del mes anterior al inicio', legacy;

  execute 'drop table pg_temp.mig_fees';
  execute 'drop table pg_temp.mig_cells';
  execute 'drop table pg_temp.mig_members';
end;
$$;

select private.allocation_migration_verify();

-- -----------------------------------------------------------------------------
-- 10. Triggers del motor (recién ahora).
-- -----------------------------------------------------------------------------
create trigger payments_allocate_on_insert
  after insert on public.payments
  for each row execute function private.payments_allocate_on_insert();

create trigger fees_apply_credit_on_insert
  after insert on public.fees
  referencing new table as inserted
  for each statement execute function private.fees_apply_credit_on_insert();

create trigger fees_apply_credit_on_void
  after update of voided_at on public.fees
  for each row
  when (old.voided_at is null and new.voided_at is not null)
  execute function private.fees_apply_credit_on_void();

-- -----------------------------------------------------------------------------
-- 11. Lecturas sobre el libro (mismas firmas; create or replace conserva grants).
-- -----------------------------------------------------------------------------
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
  select
    f.id,
    f.period,
    f.kind,
    f.description,
    f.amount_cents,
    case when f.voided_at is not null then 0::bigint
      else coalesce((
        select sum(a.amount_cents)
        from public.payment_allocations a
        join public.payments p on p.id = a.payment_id
        where a.fee_id = f.id and p.voided_at is null
      ), 0)::bigint
    end,
    f.category_id,
    f.discipline_id,
    f.voided_at,
    f.void_reason,
    row_number() over (order by f.period, case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id)
  from public.fees f
  where f.member_id = p_member_id;
$$;

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
    select count(distinct fs.period)::integer as months, min(fs.period) as oldest
    from public.fee_status fs
    where fs.member_id = p_member_id and fs.pending_cents > 0
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

-- payment_month_options: celdas desde fee_status por mes. Sale opening_from
-- (no hay tramos), entra before_joined (solo pre_system: mes anterior al mes
-- de alta). pre_system = los 12 meses previos SIN fila de saldo vigente.
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
      coalesce((select sum(pc.credit_cents) from public.payment_credit pc where pc.member_id = m.id), 0)::bigint as credit_cents
    from public.members m
    where m.id = any (payment_month_options.member_ids)
  ),
  cells as (
    select
      fs.member_id,
      fs.period,
      case when bool_or(fs.kind = 'opening_balance') then 'opening_balance' else 'monthly' end as kind,
      sum(fs.amount_cents)::bigint as amount_cents,
      sum(fs.paid_cents)::bigint as covered_cents,
      sum(fs.pending_cents)::bigint as pending_cents
    from public.fee_status fs
    join target t on t.id = fs.member_id
    group by fs.member_id, fs.period
  ),
  first_due as (
    select c.member_id, min(c.period) as period
    from cells c
    where c.pending_cents > 0
    group by c.member_id
  ),
  billed as (
    select c.*
    from cells c
    left join first_due fd on fd.member_id = c.member_id
    where c.period >= coalesce(fd.period, current_period)
       -- Carga inicial: mientras no empezó la facturación se ve todo el saldo, también lo pago.
       or (c.kind = 'opening_balance' and current_period < start_period)
  ),
  projected as (
    select
      t.id as member_id,
      gs::date as period,
      private.member_fee_price_at(t.id, gs::date) as amount_cents,
      t.price_today,
      t.credit_cents
    from target t
    cross join generate_series(greatest(start_period, current_period), horizon, interval '1 month') gs
    where t.status = 'active'
      and not exists (
        select 1 from public.fees f
        where f.member_id = t.id and f.kind = 'monthly' and f.period = gs::date
      )
  ),
  projected_covered as (
    -- Preview de lo que hará el generador: el crédito, en orden.
    select
      p.member_id,
      p.period,
      p.amount_cents,
      greatest(0, least(
        p.amount_cents,
        p.credit_cents - (sum(p.amount_cents) over (partition by p.member_id order by p.period) - p.amount_cents)
      ))::bigint as covered_cents,
      (p.amount_cents = p.price_today) as priced_at_today
    from projected p
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
    where t.joined_period <= start_period
      and not exists (
        select 1 from public.fees f
        where f.member_id = t.id and f.kind = 'opening_balance' and f.voided_at is null and f.period = gs::date
      )
  )
  select b.member_id, b.period, b.kind, b.amount_cents, b.covered_cents, b.pending_cents,
         b.period = current_period, false, false
  from billed b
  union all
  select pc.member_id, pc.period, 'projected', pc.amount_cents, pc.covered_cents,
         (pc.amount_cents - pc.covered_cents)::bigint, pc.period = current_period, pc.priced_at_today, false
  from projected_covered pc
  union all
  select ps.member_id, ps.period, 'pre_system', ps.amount_cents, 0::bigint,
         ps.amount_cents, ps.period = current_period, true, ps.before_joined
  from pre_system ps
  order by 1, 2;
end;
$$;

-- register_payment_batch: ítems
--   { "member_id", "amount_cents",
--     "marked_periods": ["2026-05-01", ...] | null,
--     "opening_months": [{ "period": "2026-03-01", "amount_cents": 1000000 }, ...] | null,
--     "opening_balance": { from_period, to_period, amount_cents, description } | null   -- forma vieja, se expande }
-- Mismo retorno. opening_balance_fee_id = la primera fila de saldo del socio en el lote.
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
  om jsonb;
  from_p date;
  to_p date;
  ob_amount bigint;
  months integer;
  parts bigint[];
  om_count integer;
  om_distinct integer;
  om_bad integer;
  mp_count integer;
  mp_distinct integer;
  mp_bad integer;
  first_id bigint;
  ob_members bigint[] := '{}';
  ob_ids bigint[] := '{}';
  marked jsonb := '{}'::jsonb;
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

  -- Reintento: el lote ya existe. Las filas de saldo del lote comparten
  -- created_at con los pagos (misma transacción); se devuelve la primera.
  if exists (select 1 from public.payments p where p.batch_id = register_payment_batch.batch_id) then
    return query
    select p.member_id, p.id, p.amount_cents,
           (select min(f.id) from public.fees f
             where f.member_id = p.member_id and f.kind = 'opening_balance' and f.created_at = p.created_at),
           true
    from public.payments p
    where p.batch_id = register_payment_batch.batch_id
    order by p.id;
    return;
  end if;

  select s.billing_start_period into start_period from public.settings s where s.id = 1;

  for item in
    select x.member_id, x.amount_cents, x.marked_periods, x.opening_months, x.opening_balance
    from jsonb_to_recordset(items)
      as x(member_id bigint, amount_cents bigint, marked_periods jsonb, opening_months jsonb, opening_balance jsonb)
  loop
    if item.member_id is null then
      raise exception 'Elegí el socio' using errcode = 'check_violation';
    end if;
    if item.amount_cents is null or item.amount_cents <= 0 then
      raise exception 'El monto tiene que ser mayor a cero' using errcode = 'check_violation';
    end if;

    -- Meses marcados: forma (el motor decide los montos).
    if item.marked_periods is not null and jsonb_typeof(item.marked_periods) <> 'null' then
      if jsonb_typeof(item.marked_periods) <> 'array' then
        raise exception 'Los meses marcados no son válidos' using errcode = 'check_violation';
      end if;
      select count(*), count(distinct p.value),
             count(*) filter (where p.value is null or (p.value)::date <> date_trunc('month', (p.value)::date)::date)
      into mp_count, mp_distinct, mp_bad
      from jsonb_array_elements_text(item.marked_periods) p;
      if mp_bad > 0 or mp_count > 60 or mp_count <> mp_distinct then
        raise exception 'Los meses marcados no son válidos' using errcode = 'check_violation';
      end if;
      if mp_count > 0 then
        marked := marked || jsonb_build_object(item.member_id::text, item.marked_periods);
      end if;
    end if;

    -- Saldo anterior: forma nueva (por mes) o vieja (tramo, expandida).
    om := null;
    if item.opening_months is not null and jsonb_typeof(item.opening_months) = 'array' then
      om := item.opening_months;
    elsif item.opening_balance is not null and jsonb_typeof(item.opening_balance) = 'object' then
      from_p := (item.opening_balance ->> 'from_period')::date;
      to_p := (item.opening_balance ->> 'to_period')::date;
      ob_amount := (item.opening_balance ->> 'amount_cents')::bigint;
      if from_p is null or to_p is null or from_p > to_p
         or from_p <> date_trunc('month', from_p)::date
         or to_p <> date_trunc('month', to_p)::date
         or to_p > (from_p + interval '35 months')::date then
        raise exception 'Los meses del saldo anterior no son válidos' using errcode = 'check_violation';
      end if;
      if ob_amount is null or ob_amount <= 0 then
        raise exception 'El saldo anterior tiene que ser mayor a cero' using errcode = 'check_violation';
      end if;
      months := ((extract(year from to_p) - extract(year from from_p)) * 12
                + (extract(month from to_p) - extract(month from from_p)))::integer + 1;
      parts := private.split_opening_total(ob_amount, months);
      select jsonb_agg(jsonb_build_object(
               'period', to_char((from_p + make_interval(months => k - 1))::date, 'YYYY-MM-DD'),
               'amount_cents', parts[k],
               'description', item.opening_balance ->> 'description'))
      into om
      from generate_series(1, months) k;
    end if;

    if om is not null then
      if start_period is null then
        raise exception 'Primero activá las cuotas en Ajustes' using errcode = 'check_violation';
      end if;
      select count(*), count(distinct (m ->> 'period')),
             count(*) filter (
               where (m ->> 'period') is null
                  or (m ->> 'period')::date <> date_trunc('month', (m ->> 'period')::date)::date
                  or (m ->> 'period')::date >= start_period
                  or (m ->> 'amount_cents') is null
                  or (m ->> 'amount_cents')::bigint <= 0
             )
      into om_count, om_distinct, om_bad
      from jsonb_array_elements(om) m;
      if om_count = 0 or om_count > 36 or om_count <> om_distinct then
        raise exception 'Los meses del saldo anterior no son válidos' using errcode = 'check_violation';
      end if;
      if om_bad > 0 then
        raise exception 'El saldo anterior solo cubre meses anteriores a % y cada mes tiene que ser mayor a cero',
          to_char(start_period, 'MM/YYYY') using errcode = 'check_violation';
      end if;

      -- Solo columnas con grant de INSERT. El guard valida y pone la descripción
      -- por defecto; el trigger de fees aplica el crédito previo del socio.
      with ins as (
        insert into public.fees (member_id, kind, period, amount_cents, description)
        select item.member_id, 'opening_balance', (m ->> 'period')::date, (m ->> 'amount_cents')::bigint,
               nullif(btrim(m ->> 'description'), '')
        from jsonb_array_elements(om) m
        returning id
      )
      select min(id) into first_id from ins;

      ob_members := ob_members || item.member_id;
      ob_ids := ob_ids || first_id;
    end if;
  end loop;

  -- Los meses marcados viajan al trigger de payments por un GUC local a la transacción.
  perform set_config('lonqui.marked_periods', marked::text, true);

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

  perform set_config('lonqui.marked_periods', '', true);

  return query
  select p.member_id, p.id, p.amount_cents, ob.fee_id, false
  from public.payments p
  left join unnest(ob_members, ob_ids) as ob(m_id, fee_id) on ob.m_id = p.member_id
  where p.batch_id = register_payment_batch.batch_id
  order by p.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Grants. El drop se llevó los de payment_month_options; create or replace
--     conservó los de register_payment_batch, member_fee_coverage y
--     member_balance (se repiten igual). Ninguna función de private para
--     PUBLIC; a mano las que las RPC INVOKER necesitan. El motor y las
--     funciones de migración: para nadie (las disparan triggers / las corre la
--     migración y el test como postgres).
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
  private.member_fee_coverage(bigint),
  private.member_balance(bigint),
  private.split_opening_total(bigint, integer)
to authenticated, service_role;

revoke execute on function
  private.apply_credit(bigint, text),
  private.allocate_marked(bigint, date[]),
  private.payments_allocate_on_insert(),
  private.fees_apply_credit_on_insert(),
  private.fees_apply_credit_on_void(),
  private.payment_allocations_insert_guard(),
  private.migrate_opening_spans(),
  private.backfill_allocations(),
  private.allocation_migration_snapshot(),
  private.allocation_migration_verify()
from public, anon, authenticated, service_role;
```

Notas para el hilo principal al aplicar:

- `npm run db:reset` (base vacía + seed): la conversión y el backfill no hacen nada; el seed
  inserta saldos sin `period` (→ `inicio − 1`) y pagos que disparan el motor. Si el seed falla,
  lo primero a mirar es el trigger de statement con `referencing new table`.
- Un `referencing new table` no se puede crear como `security definer` en el `create trigger`;
  lo DEFINER es la función, y así está.
- Si `tests/db/opening-balance-months.test.ts` "paridad TS/SQL" falla por un centavo,
  `split_opening_total` no es idéntico a `splitOpeningTotal`: revisar `k < n`.
- `npm run db:types`: `database.types.ts` suma `payment_allocations`, `fee_status`,
  `payment_credit` y la firma nueva de `payment_month_options`. El CI compara el diff.
- Después, §7.1 contra el dump de producción, antes de mergear. Si el MCP local responde,
  `get_advisors` (RLS, `search_path`, vistas sin `security_invoker`).

## 10. Contratos (`src/models/types.ts`, los fija el hilo principal)

```ts
/** De dónde salió una imputación. */
export type PaymentAllocationSource = 'marked' | 'oldest_first' | 'credit' | 'backfill'

/** Una imputación de un pago a una cuota VIGENTE (las de cuotas anuladas no se listan). */
export type PaymentAllocation = {
  feeId: number
  period: ISODate
  kind: FeeKind
  amountCents: number
  source: PaymentAllocationSource
}

export type Payment = {
  // ...igual que hoy...
  /** Vacío si el pago está anulado o es todo saldo a favor. */
  allocations: PaymentAllocation[]
}

export type PaymentMonthOption = {
  // sale `openingFrom`
  /** Solo 'pre_system': el mes es anterior al mes de la fecha de alta. false en el resto. */
  beforeJoined: boolean
}

/** Un mes de saldo anterior a crear: `period` YYYY-MM-01, antes del inicio. */
export type OpeningMonth = { period: ISODate; amountCents: number }
// se elimina OpeningBalanceMonths

export type MemberAccountDetail = {
  account: MemberAccount
  statement: FeeStatementLine[]
  payments: Payment[]
  /** Filas de saldo anterior VIGENTES, por mes ascendente. Vacío si no tiene. */
  openingBalances: Fee[]
}

export type AuditedTable = /* ... */ | 'payment_allocations'
```

`registerPaymentSchema` (modelo): `items[].markedPeriods?: ISODate[] | null` (≤ 60, día 1, únicos);
`items[].openingMonths?: OpeningMonth[] | null` (≤ 36, día 1, únicos, enteros > 0). Desaparece
`items[].openingBalance`. `RegisterPaymentResult` no cambia. `createOpeningBalanceMonthsSchema`
(fees.model): `{ memberId, months: OpeningMonth[] }` con las mismas reglas.

`src/lib/dates.ts`: `periodListLabel(periods: ISODate[]): string` — vacío → `''`; uno →
`formatPeriod`; contiguos → `periodRangeLabel(first, last)`; sueltos → "mayo, julio y septiembre
2026" (año una vez si es el mismo; si cambia, cada mes con su año desde el cambio).

`src/views/shared/labels.ts`: etiquetas de `PaymentAllocationSource` ("marcado", "al más viejo",
"saldo a favor", "historial") y de la tabla `payment_allocations` ("Imputaciones").

## 11. Grilla y ficha (brief para `frontend-react-craftsman`)

Hereda `.impeccable/surfaces/route.md` y `route-caja.md` (Operate; Linear / Mercado Pago). El
agente de caja actualiza `route-caja.md` (párrafo del overlay y el anti-objetivo de "imputación
libre"); el de ficha, `route-socios-id.md` (saldo anterior por mes). Mobile first: 390 px, una mano.

**Grilla (`MonthStrip`) como conjunto.**
- **Tocar alterna** una celda elegible (`pendingCents > 0`); Enter/Espacio igual; `aria-pressed`
  es la verdad. **Arrastrar pinta**: la celda de partida decide (sin marcar → marca; marcada →
  desmarca) sobre `[ancla, actual]` y sobre la selección que había al empezar; fuera del rango no
  cambia nada. Mouse arma al entrar en otra celda; dedo al mantener 250 ms (ya existe).
- **Celdas**: "debe", "falta $X" (parcial: elegible por lo que falta), "pagado" (no elegible),
  "este mes", "adelanto", "cubierto" (proyectado con crédito), "antes del sistema", "queda
  debiendo" (previo de `[from, P]` sin marcar). Un ícono por estado, nunca solo color.
- **Adelantos**: elegibles solo cuando no queda ningún mes con cuota adeudado sin marcar
  (previos de `[from, P]` incluidos). Atenuados y `aria-disabled` antes; tocarlos muestra
  `role="status"` "Para adelantar meses, primero marcá los que debe." Es regla de UI: la base
  mandaría ese dinero al adeudado más viejo igual (regla 1 de §6.2), y la grilla no debe prometer
  otra cosa.
- **Meses previos**: tocar uno lo marca; `from = min(primer previo marcado, mes de alta si es
  anterior y está en la ventana)`; los previos de `[from, P]` sin marcar dicen "queda debiendo";
  total de `[from, P]` editable (`OpeningTotalField`, "Total de la deuda desde <from> (N
  meses)"), repartido con `splitOpeningTotal`. Si hay marcados con `beforeJoined`: aviso debajo
  con `AlertCircle`, texto de §6.3 y link "Corregir fecha de alta" → `/socios/[id]/editar`. No
  bloquea.
- **Monto** = Σ pendiente efectivo de lo marcado (previos: su parte). **"Otro monto"**: la grilla
  muestra en vivo la regla de la base: marcados en orden ("cubre $A de $B" en el último), después
  los no marcados adeudados en orden ("se cubre"), después adelantos ("cubierto"), y "Queda saldo
  a favor de $X" al pie. Sin nada marcado = todo al más viejo (celda por celda).
- **Resumen**: "3 meses · mayo, julio y septiembre 2026" (`periodListLabel`); contiguos → "mayo a
  junio". "Queda debiendo N meses · $X" = lo adeudado no marcado (previos de `[from, P]`
  incluidos; adelantos no) menos lo que el remanente de "Otro monto" cubre. Éxito: "Cubre may,
  jul y sep" / "Pago a cuenta".
- **Ayuda**: "Tocá cada mes que pagó, o mantené apretado y arrastrá." (coarse) / "…o arrastrá."
  (fine). Desaparece "Tocá el primer y el último mes".
- **Selección inicial**: activo → el adeudado más viejo con cuota; de baja → todos los adeudados;
  antes del inicio → el mes actual (previo). Como hoy.
- **Crédito previo** (`balanceCents < 0`) al marcar previos: la base lo aplica a las filas nuevas
  del más viejo al más nuevo; la grilla lo muestra así (las primeras del tramo "cubierto" por
  crédito, pendiente = 0, no elegibles). Si cubre todo lo marcado, el botón se deshabilita y
  manda a la ficha (ya existe).
- **Gate de schema**: si `getPaymentFormData` devuelve el error "se está actualizando", el sheet
  muestra `ErrorState` con "Reintentar". Sin modales nuevos.
- Grupo familiar: lo mismo por integrante, un `batchId`, grilla compacta y colapsada por defecto.
- Verificación manual (no hay jsdom): iOS y Android reales a 390 px: scroll vertical sobre la
  grilla, mantener y pintar, pintar al revés, seis toques sueltos, teclado, VoiceOver/TalkBack.

**Ficha (`/socios/[id]`, pestaña de cuenta).**
- "Saldo anterior" como bloque: "Saldo anterior · marzo a junio 2026 · $40.000 · 2 meses pagos"
  (resumen desde `openingBalances` + `statement`), y en el estado de cuenta una línea por mes
  ("Saldo anterior · marzo 2026", estado pagado/parcial/adeudado, "Anular" para admin, una por fila).
- Botón "Indicar desde cuándo debía" (sin filas) o "Agregar meses anteriores" (con filas y con
  celdas `pre_system` disponibles): la misma grilla, solo previos, tocar fija `from`
  (`min(tocado, mes de alta si es anterior)`), tramo hasta `P`, total editable, mismo aviso de
  fecha de alta; "Cargar saldo anterior de $X (N meses)".
- Lista de pagos: cada fila suma "Cubre may y jul 2026" / "Saldo a favor $X" (desde
  `payment.allocations` y `amountCents − Σ allocations`); anulado tachado, sin detalle.
- `member-fee-statement.tsx`: etiqueta "Saldo anterior · <mes>" (ya no "hasta").

## 12. Preguntas abiertas

**Para el usuario (cortas, con default; no frenan):**

1. Mes marcado que ya está pago al registrar (otro operador, o crédito previo): se saltea y la
   plata va al adeudado más viejo; no es error. Default: sí.
2. Saldos viejos sin tramo: quedan como una fila del mes `inicio − 1`, no se convierten. Default:
   sí (antes del release se cuenta cuántos hay en producción; si son 0, es moot).
3. Mover la fecha de alta hacia adelante por encima de un saldo anterior ya cargado: no bloquea,
   la UI avisa. Default: sí (bloquear sería una política nueva).
4. Sin índice único `(payment_id, fee_id)` (§4.1). Default: sí.
5. Release: ¿quién corre §7.1 (hace falta `SUPABASE_DB_PASSWORD`)? ¿Noche de semana o fin de
   semana? El dump con datos de menores queda cifrado 30 días. Default: lo corre Tomás; viernes a
   la noche.
6. `createOpeningBalance` (saldo "solo monto", sin meses): se elimina de la app (ninguna vista lo
   usa). Default: sí.
7. Anular un saldo de N meses es N anulaciones con motivo (una por fila). ¿Alcanza por ahora, o
   se quiere "Anular todos los meses del saldo anterior" (otro pipeline)? Default: alcanza.

**Para la Comisión (informativas):**

- "Debe desde / N meses" pasa a contar los meses del saldo anterior (un socio que debía 10 meses
  figuraba como 1 mes; ahora 10). La deuda en pesos no cambia.
- Con meses sueltos, "Debe desde" muestra el mes más viejo sin pagar aunque haya meses posteriores
  pagos: que lo sepan antes de que un socio pregunte por qué debe junio si pagó julio.
- Cada pago dice qué meses cubrió. Un pago cargado al mes equivocado se anula (admin) y se recarga.

## 13. Texto de CLAUDE.md a reemplazar (lo hace el hilo principal al aprobar)

**Sección "Comandos", párrafo "Solo hay stack local por ahora."** → reemplazar por:

> **Hay producción.** El proyecto hosted (plan free, `sa-east-1`) tiene datos reales del club.
> El CI (`.github/workflows/ci.yml`, job `deploy-migrations`) aplica las migraciones con
> `supabase db push --linked` en cada push a `main`, después de `build` y `db`; Vercel despliega
> en paralelo, así que **el código nuevo llega unos minutos antes que el schema**: toda migración
> tolera convivir con el código anterior y con el nuevo, y toda migración con datos se ensaya
> antes contra un dump de producción (procedimiento en
> `docs/pipelines/2026-10-29-imputacion-libre-meses/00-architecture.md` §7.1). `.mcp.json`
> apunta al MCP del stack local (`http://127.0.0.1:54321/mcp`, necesita `npm run db:start`); a
> propósito no apunta al MCP hosted sin `project_ref`. El plan free no tiene PITR: el dump previo
> al release es el backup.

**Sección "Cuotas", párrafos "Imputación: balance forward (2026-10-24)" y "Saldo anterior con
tramo (2026-10-24, …)"** → reemplazar por:

> **Imputación explícita por cuota** (2026-10-29, pipeline `2026-10-29-imputacion-libre-meses`).
> `payment_allocations (payment_id, fee_id, amount_cents, source)` dice qué cuota cubrió cada pago.
> Append-only (sin UPDATE/DELETE/TRUNCATE para nadie, `enable always`), auditada, **sin INSERT para
> `authenticated`**: escriben solo los triggers del motor (`private.apply_credit`,
> `private.allocate_marked`), que son DEFINER en `private`. Reglas: al registrar, los meses
> marcados en orden (social antes que deporte) hasta donde alcanza, el resto al adeudado más
> viejo, el resto queda como saldo a favor del pago (`source` marked / oldest_first); el
> generador y la anulación de una cuota reimputan el crédito (`credit`); anular un pago deja sus
> imputaciones inertes. `fee_status` (pagada/parcial/adeudada por cuota) y `payment_credit`
> (saldo a favor por pago) son LA definición; `member_fee_coverage`, `member_balance`,
> `payment_month_options` y todo lo demás salen de ahí. Invariante: nunca conviven deuda y saldo a
> favor en un socio. Sin índice único `(payment_id, fee_id)`: un pago puede imputarse dos veces a
> la misma cuota en momentos distintos. Una imputación equivocada se corrige anulando el pago y
> cargando otro: nunca se mueve. La grilla marca meses sueltos (tocar alterna, arrastrar pinta);
> los adelantos solo cuando no queda nada adeudado sin marcar.
>
> **Saldo anterior por mes** (2026-10-29). Una fila `opening_balance` por socio y mes
> (`fees_one_opening_balance (member_id, period)`), con `period` real anterior al inicio (hasta 36
> meses atrás). "Desde cuándo debía" = crear filas (desde la fecha de alta si es anterior al primer
> mes marcado; si es posterior, desde el marcado y la UI avisa); "más atrás" = agregar filas;
> equivocarse = anular las filas que sobran (admin, motivo). Los tramos (`from_period`/`to_period`)
> son historia: las filas que los tenían están anuladas con motivo "Convertido a saldo anterior
> por mes (migración 20261029120000)" y reemplazadas por sus meses con el mismo reparto (partes
> enteras, resto en el último: `private.split_opening_total` = `splitOpeningTotal`). Un saldo sin
> tramo (viejo) sigue siendo una fila del mes anterior al inicio.

**Sección "Trampas conocidas"** → agregar:

> - **`supabase db push` corre cada archivo como UNA transacción implícita** (pipeline con un solo
>   `Sync`, la fila de versión adentro). La cortan las sentencias que empiezan con `CREATE/DROP
>   INDEX CONCURRENTLY`, `REINDEX … CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM` o `CLUSTER`: no van en
>   una migración con datos.

**Sección "Modelo de datos"**: donde dice "cargos por período, pagos con adjunto y anulación"
agregar "imputaciones de pagos a cuotas (`payment_allocations`)".

## 14. Estrés del plan (grilling contra mí mismo)

1. *¿Por qué triggers y no la RPC?* Porque hay cuatro caminos que crean deuda o crédito y tres no
   pasan por la RPC. Y porque los tests de base ya insertan pagos y cuotas como `postgres`: con el
   motor en triggers siguen viendo cobertura sin tocar fixtures.
2. *¿Un INSERT directo de `payments` por PostgREST?* Imputa al más viejo (trigger). Nunca queda
   crédito con deuda.
3. *¿El GUC puede quedar sucio?* Es local a la transacción (`is_local = true`) y la RPC lo limpia
   igual. Otra transacción no lo ve.
4. *¿Dos lotes al mismo socio?* `allocate_marked`/`apply_credit` toman la fila del socio: el
   segundo espera y recalcula con el libro fresco. Un mes ya pago se saltea.
5. *¿El backfill puede dar distinto?* Solo si la cobertura nueva no reproduce la vieja; entonces
   aborta sin dejar nada. Se ensaya antes contra el dump (§7.1).
6. *¿Y si la transacción del CLI no fuera una?* Lo verifiqué en la fuente (§3). La única forma de
   partirla es una sentencia de la lista negra, y el archivo no tiene ninguna.
7. *¿Seguridad?* Tabla con RLS forzada y solo SELECT; vistas `security_invoker`; motor DEFINER en
   `private` sin EXECUTE para nadie; guard DEFINER con locks; RPC INVOKER como hoy.
8. *¿`consulta` ve imputaciones?* Sí, con `payments.read`, como ve pagos.
9. *¿Rompe `cash-isolation.test.ts`?* No: nada tocado lee caja.
10. *¿`months_due` cambia?* Sí, para los saldos convertidos (de 1 a N). Es el arreglo que el
    modelo por mes trae; informado.
11. *¿El pago anulado del seed?* El trigger lo ignora (`voided_at` ya puesto).
12. *¿La ventana de despliegue?* Minutos, fuera de horario, con gate en el formulario. Dos
    pantallas del código viejo fallan contra el schema nuevo (ficha con saldo de varios meses;
    cargar saldo desde la ficha) y ninguna pierde plata.
13. *¿Deadlock admin-anula vs editor-cobra?* Posible, raro, auto-resuelto en 1 s, el reintento
    registra. Documentado; no vale una RPC nueva para anular cuotas.
14. *¿Y los 1.000+ filas de auditoría de la conversión?* Son el rastro de "nada se borra"; con
    ~250 socios es una tarde de carga. Aceptado.

## 15. Correcciones post-review (hilo principal, 2026-10-29)

El SQL de §9 es el que se propuso. **La migración vigente es la de
`supabase/migrations/20261029120000_payment_allocations.sql`**, que difiere en lo siguiente
(detalle y verificación en `03-review.md` y `03-tests.md`):

- **B1**: `fees_apply_credit_on_void` es `after update on public.fees … when (old.voided_at is null
  and new.voided_at is not null)`, sin `of voided_at`. La app anula con `set void_reason` y el guard
  BEFORE pone `voided_at`, así que un trigger `update of voided_at` no disparaba nunca.
- **B2**: nuevo `private.payments_apply_credit_on_void()` + trigger `payments_apply_credit_on_void`.
  Anular un pago **sí** reimputa el crédito de los demás pagos del socio. Corrige lo que dicen §6.2.3
  ("nada se reimputa") y §6.6.
- **H1** (T4): los cuatro bloqueos del motor y del guard son `for no key update`. Con `for update`,
  dos lotes concurrentes del mismo socio se trababan contra el `KEY SHARE` del FK
  `payments → members`.
- **M3**: durante la ventana código nuevo + schema viejo, la ficha y `/caja/pagos` **no** caen: los
  lectores reintentan sin el embed ante `PGRST200` y muestran los pagos sin "Cubre…". Corrige §8.
- m4 `lock_timeout = '30s'`; m5 `order by member_id` en el trigger de cuotas y en el INSERT del lote;
  el reintento del lote filtra `voided_at is null`; el payload viejo expandido ya no copia la
  descripción del tramo.
- m7 (saldos viejos sin tramo que vuelven a ofrecer meses previos) quedó como paso 7 de
  `04-release.md`. m8 es la regla elegida por el usuario.
