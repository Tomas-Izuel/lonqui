# 00 — Carga inicial por meses: marcar meses sueltos, arrastrar, y que el saldo anterior se pueda seguir cargando

Seguimiento de `2026-10-24-pago-por-meses` y `2026-10-24-pago-por-meses-antes-del-inicio`.
Planner: `feature-planner`, 2026-10-24. **Cero código de producción acá**: los bloques SQL son
bocetos para que el hilo principal escriba la migración.

Verificado contra el repo (el MCP de Supabase no respondió: `ECONNREFUSED`, stack local apagado;
trabajé desde las migraciones y el código).

## 1. Problema

Tomás: *"la gracia es que se pueden cargar pagos anteriores; hoy bloqueábamos meses de antes.
Checkear meses es más intuitivo para este caso."* El club está haciendo la carga inicial AHORA
(~120 socios, facturación arranca 2026-11-01, hoy 2026-10-24). Dos causas, una de cada capa:

1. **Selección (vista).** `tapCell` sobre una celda `pre_system` fuerza el rango hasta la última
   celda previa (`endIndex = lastPre`). Un socio que pagó enero–junio y nada después no se puede
   expresar: marcar enero marca enero–octubre y el pago pasa a cubrir 10 meses. Salida actual:
   "Otro monto", que es justo lo tedioso.
2. **Datos (RPC).** El saldo anterior es UNA fila de `fees` (`kind = 'opening_balance'`, período
   único = inicio − 1, índice `fees_one_opening_balance`: uno vigente por socio) y los meses solo
   viven en `description` (texto). En cuanto el primer pago histórico crea esa fila,
   `payment_month_options` deja de devolver `pre_system` (`has_opening_balance`) y devuelve UNA celda
   "Saldo anterior · $X". El segundo pago histórico (abril–junio después de enero–marzo) no puede
   elegir meses. Es el "bloqueábamos meses de antes".

## 2. Alcance

Contrato 2.1 (saldo de arranque: "la deuda previa al sistema entra como un cargo inicial") y 2.2
(registro de pagos). Fase 1. Fuera: importar los Excel (carga inicial = formularios, CLAUDE.md),
editar un saldo anterior ya cargado, remontar la ventana de 12 meses previos, auto-scroll durante
el arrastre.

## 3. Decisiones ya tomadas por Tomás (no se rediscuten)

1. Semántica de la carga inicial: el primer mes previo marcado = "desde cuándo debía". El saldo
   anterior abarca desde ahí hasta el último previo; el PAGO cubre solo los meses marcados. Pagó
   ene–jun, nada desde entonces: pago de 6 meses, quedan julio–octubre como deuda.
2. La grilla se queda (checkear meses) y es colapsable: cerrada = una línea de resumen + "Cambiar".
3. Arrastrar para marcar varios (mouse y dedo), además de tocar; accesible por teclado/toque.
4. Balance forward se mantiene: los meses se cubren del más viejo al más nuevo.

## 4. Pushback y riesgos (lo que hay que tener presente)

- **Esta semántica crea deuda si el operador marca de menos.** Marcar solo ene–mar de alguien que
  pagó todo deja siete meses adeudados. Es lo que Tomás pidió; la defensa es que la pantalla lo diga
  antes de confirmar: línea fija "Queda debiendo 7 meses · $70.000" (§7.4). No se agrega un diálogo
  de confirmación (Operate: sin modales de primera mano), alcanza con la línea y el botón.
- **Un saldo anterior no se edita** (nada se borra, `fees_immutable`). Si se cargó desde marzo y
  debía desde enero, no hay camino de "agregar enero": hay que anularlo (solo `admin`, con motivo,
  desde el estado de cuenta de la ficha) y volver a cargarlo. Los pagos no se tocan: quedan como
  saldo a favor y el saldo nuevo se los come (§6.5). Es la salida correcta; la alternativa
  (permitir varios saldos anteriores o extender uno) rompe el orden de balance forward (§9).
- **Drag en celular y scroll.** El sheet scrollea vertical y la grilla ocupa buena parte. Un
  `touch-action: none` en las celdas secuestra el scroll. Por eso en touch el arrastre arranca con
  mantener apretado (§7.3). El plan B si falla en un dispositivo real: tocar-tocar (§7.2), que ya
  funciona sin arrastre.
- **Ventana de 12 meses previos.** Alguien que debe desde antes de noviembre 2025 no cabe en la
  grilla. Hoy resuelve con "Otro monto" o la ficha. Subir a 24 es un cambio de una línea en la
  RPC, pero agranda la grilla en celular y nadie lo pidió: queda como pregunta (§12).
- **Ventana de despliegue.** El CI migra y Vercel despliega en paralelo. La migración está pensada
  para que el código VIEJO siga andando (§5.6); el código NUEVO no anda contra el schema viejo
  (inserta `from_period`). Orden seguro: migración primero (§5.6).

## 5. Datos y RPC (hilo principal)

Migración sugerida: `supabase/migrations/20261024170000_opening_balance_months.sql`. Skill
`supabase-postgres-best-practices` aplicada: columnas nullable sin default (sin reescritura),
CHECKs de forma, grants por columna, funciones con el `revoke execute` de siempre.

### 5.1 Opciones evaluadas para guardar los meses del saldo anterior

| Opción | Pro | Contra |
|---|---|---|
| **A. `from_period`/`to_period` nullable en `fees`, solo para `kind='opening_balance'` (recomendada)** | Una fila, un índice único, cobertura (`member_fee_coverage`), estado de cuenta, reportes y `months_due` no cambian. Retrocompatible. Filas viejas = NULL = comportamiento actual | La RPC reparte el total entre los meses (§5.3) |
| B. Una fila `opening_balance` por mes, período real | Cada mes es un cargo; `months_due` exacto | Rompe `fees_one_opening_balance`, el guard (fuerza `period = inicio − 1`), anulación por fila, auditoría x10 por socio, estado de cuenta y reportes ven N filas. Mucho más radio de impacto |
| C. Parsear `description` | Sin migración | Texto libre como dato. Descartada |

### 5.2 Cambios en `fees`

- Columnas `from_period date null`, `to_period date null`.
- CHECKs: ambas nulas o ambas informadas; `from_period <= to_period`; ambas día 1
  (`= date_trunc('month', x)::date`); solo si `kind = 'opening_balance'`; `to_period <= period`
  (el guard fija `period = inicio − 1` ANTES de evaluar los CHECK); span máximo 36 meses (evita un
  `generate_series` descontrolado vía PostgREST directo).
- `fees_immutable`: recrear el trigger (drop + create) sumando las dos columnas a la lista.
- Grant: `grant insert (from_period, to_period) on public.fees to authenticated`. Sin grant de
  update. `service_role` ya tiene select.
- `private.fees_opening_balance_guard` (create or replace, mismo nombre): además de lo que hace,
  mensajes amigables: "Los meses del saldo anterior no son válidos" (mitad informada, día ≠ 1,
  desde > hasta) y "El saldo anterior solo cubre meses anteriores a MM/YYYY" (`to_period >= inicio`,
  mismo texto que ya usa `register_payment_batch`). Los CHECK son la red; el guard da el mensaje.
- La auditoría (`enable_audit('public.fees')`) toma `to_jsonb(row)`: las columnas nuevas aparecen
  solas. Nada que tocar.

### 5.3 `register_payment_batch` (create or replace, misma firma, mismos grants)

Única diferencia: el `insert into public.fees` incluye `from_period` y `to_period` (ya parseados
como `from_p`/`to_p`). Todo lo demás (validaciones, advisory lock, idempotencia por `batch_id`)
queda igual. El código viejo ya manda `from_period`/`to_period` en el JSON: desde el momento de la
migración empieza a guardarlos.

### 5.4 `payment_month_options` (drop + create: suma una columna de salida)

`create or replace` no puede cambiar las columnas de salida, así que va `drop function` + `create`
dentro de la misma transacción de la migración (atómico, no hay ventana sin función) y se
re-otorgan los grants (`revoke ... from public, anon; grant ... to authenticated`).

Columna nueva: `opening_from date` (NULL salvo en celdas `opening_balance` con tramo = su
`from_period`; NULL en una celda `opening_balance` = fila vieja sin tramo). El modelo mapea columna
por columna: una columna extra no rompe al cliente viejo.

Semántica nueva, en términos de los CTE actuales:

- `charged` deja afuera los saldos anteriores CON tramo (los viejos siguen entrando como hoy y
  producen su celda única). Se arma un CTE `opening_span` desde `member_fee_coverage` unido a
  `public.fees` por `fee_id` (INVOKER: RLS de `fees` ya lo permite a quien tiene
  `payments.register`; no se toca el tipo de retorno de `member_fee_coverage`, que usan otras
  funciones).
- `opening_cells`: por cada saldo con tramo, un `generate_series(from_period, to_period, '1 month')`.
  Monto por mes = `total / n` (división entera de bigint); el ÚLTIMO mes absorbe el resto
  (`total − (n−1) × (total / n)`): los centavos sobrantes (< n) quedan en el mes más nuevo, el que
  balance forward cubre último, así nunca generan un "falta $0,01" en el medio. Suma exacta = total.
  El monto NO es `n × cuota`: el total puede haberse corregido a mano al crearlo (`OpeningTotalField`)
  y la RPC reparte lo guardado, nunca recalcula con la cuota de hoy.
- Cobertura por celda: el `covered_cents` que `member_fee_coverage` calculó para la fila se reparte
  en orden de mes (mismo truco de `projected_covered`: `least(monto, cubierto − acumulado previo)`).
  Es balance forward puro: el mes más viejo se cubre primero.
- `first_due` se calcula sobre la unión de cargos agregados y celdas del saldo.
- `billed`: las celdas del saldo se muestran TODAS (también las pagas) mientras la facturación no
  empezó (`current_period < start_period`): en plena carga inicial se ve el cuadro completo.
  Desde el inicio rigen las reglas de siempre (`period >= first_due`).
- Celdas del saldo: `kind = 'opening_balance'`, `period` = el mes real, `is_current` si es el mes
  actual, `priced_at_today = false`, `opening_from` = `from_period`.
- `pre_system` no cambia (sigue sin salir con un saldo vigente), ni `projected`, ni `credit`
  (el saldo a favor sigue siendo `pagos − Σ cargos`, y Σ celdas = Σ cargos).

Compatibilidad del código viejo con la RPC nueva: devuelve más celdas `opening_balance`; el cliente
viejo las trata como cualquier celda del sistema (no `pre_system`, selección por pendiente). No se
rompe nada visible.

### 5.5 Qué NO cambia

`member_fee_coverage`, `member_balance`, `member_fee_statement`, `member_accounts`, reportes,
`months_due`, la tabla `payments`, el generador mensual. El estado de cuenta de la ficha sigue
mostrando UN renglón de saldo anterior (con su descripción). Un saldo anterior con tramo cuenta
como UN cargo para el estado de cuenta, pero deuda total, cobranza y deuda por categoría salen igual
que antes (suman montos).

### 5.6 Filas viejas y orden de despliegue

- **Filas viejas (sin tramo):** quedan con la celda única "Saldo anterior · $X". Sin backfill: el
  tramo sería parsear `description`. Antes de mergear, el hilo principal corre una consulta de solo
  lectura en prod (`count(*)` de `fees` con `kind='opening_balance' and voided_at is null`). Si son
  pocos, la vía es anular y recargar desde la ficha (admin); si fueran muchos, se decide un backfill
  puntual con regex estricto y NULL si no matchea (otra decisión, otra migración).
- **Orden:** aplicar la migración (compatible hacia atrás) ANTES de que corra el código nuevo. Si el
  CI las dispara en paralelo, la peor consecuencia es que el "Indicar desde cuándo debía" de la ficha
  y el pago con saldo anterior den un error genérico unos minutos (la inserción es atómica: no queda
  nada a medias; reintentar anda). Preferible: mergear fuera del horario de carga.

## 6. Semántica del dominio (la regla, una sola vez)

### 6.1 Al registrar con meses previos marcados

Sea F el primer mes previo marcado, L el último previo marcado, P el último mes previo (antes del
inicio: el mes actual; después: inicio − 1). Contiguo: si la selección sigue hacia celdas del
sistema, L = P.

- Saldo anterior nuevo: `from_period = F`, `to_period = P`, total = Σ monto de F..P (o el total
  corregido a mano, §6.3).
- Pago: cubre los marcados, o sea Σ monto de F..L (más los del sistema marcados).
- Balance forward cubre en orden: el pago de ene–jun cae sobre ene–jun; jul–oct queda adeudado.
- Segundo pago histórico: `payment_month_options` ya devuelve ene..oct como celdas reales con
  ene–jun pagas (§5.4); abril–junio se elige como cualquier mes del sistema.

### 6.2 Segundo pago y siguientes
Las celdas `opening_balance` con `opening_from` se comportan como `monthly`: el rango arranca en el
primer mes adeudado (nadie salta meses: decisión 4) y termina donde se toca/arrastra.

### 6.3 Total corregido a mano
Se conserva el control actual: un TOTAL para todo el saldo (F..P). Es lo único que permite deudas que
no son múltiplo de la cuota ("Saldo de 2025" de las planillas). Reparto entre meses: la misma regla
de §5.4 (`splitOpeningTotal`). El pago = Σ de las celdas marcadas ya repartidas. Alternativa
descartada: "valor por mes" en vez de total (modelo mental más limpio, pero no expresa $35.000 en
3 meses sin centavos y cambia un control ya publicado).

### 6.4 Meses ANTERIORES al `from_period` de un saldo existente
No hay celdas: la grilla no los ofrece. La UI lo dice (§7.5) y el camino es anular el saldo (admin,
ficha) y recargar. Fuera de alcance: extender un saldo.

### 6.5 Anular y recargar
Anular el saldo anterior devuelve `pre_system` y los pagos quedan como saldo a favor. Recargar con
la grilla: las celdas efectivas absorben el pozo del pago (`effectiveOptions`), el derivado de los
meses ya pagos da $0 y el botón queda frenado con el mensaje existente "El saldo a favor ya cubre
esos meses. Indicá desde cuándo debía desde la ficha": ahí se crea solo el saldo anterior, sin pago.
Coherente, sin código nuevo.

## 7. Lógica de selección y UI (vistas)

### 7.1 `month-selection.ts` — contratos (puro, sin React ni `Date`)

Cambios (los índices siguen siendo sobre el array COMPLETO; "efectivas" = igual largo y orden):

- **`PaymentMonthOption.openingFrom: ISODate | null`** (contrato, lo fija el hilo principal en
  `types.ts`). `isLegacyOpening(o)` = `kind === 'opening_balance' && openingFrom === null`.
- **`cellTone`**: una celda `opening_balance` CON `openingFrom` se pinta como `monthly`
  (debe / falta / pagado / este mes); solo la legacy conserva el tono y la etiqueta "Saldo anterior ·
  $X".
- **`splitOpeningTotal(totalCents, months) → number[]`**: partes enteras, el último absorbe el resto.
  Espejo exacto de la RPC; un test de DB compara contra la RPC.
- **`openingSpan(options, selection) → { from, to } | null`**: null si la selección no arranca en una
  celda `pre_system`; si no, `from` = `selection.startIndex`, `to` = última celda `pre_system`.
- **`openingBalanceFromSelection(options, selection, overrideTotalCents?)`**: misma firma. Cambia
  el significado: `fromPeriod` = primer previo marcado, `toPeriod` = período de `span.to` (NO el
  último marcado), `amountCents` = override ?? Σ monto de F..P. Usa las opciones crudas.
- **`effectiveOptions(options, selection, ctx)`** (hoy `(options, openingAmountCents, credit)`; sigue
  existiendo `optionsForSelection(options, selection, ctx)` con la firma de hoy): con span, las celdas
  `pre_system` de F..P pasan a tener `amountCents` = su parte del reparto y absorben el pozo ya pagado
  en orden; las demás celdas del sistema reciben lo que sobra. Las `pre_system` anteriores a F y sin
  span no cambian.
- **`derivedAmountCents`** = Σ `pendingCents` de las celdas marcadas de las opciones efectivas (todas
  las clases). Desaparece `openingNetCents`: la cuenta vieja `max(0, saldo − pozo) + sistema` es un
  caso particular (marcado hasta P).
- **`coverageForAmount`** ("Otro monto"): recorre las celdas efectivas elegibles desde F (o desde la
  primera del sistema) en orden, marcadas o no (balance forward sigue). Las `pre_system` solo entran
  dentro de F..P. Misma forma de resultado.
- **`tapCell(options, selection, index, opts)`**: `opts.preMode?: 'to_end' | 'free'` (default
  `'to_end'` = comportamiento de hoy; la ficha no cambia) y `opts.fresh?: boolean` (el operador todavía
  no tocó nada). En `'free'`, sobre una celda `pre_system`:
  - `fresh` → `{index, index}` (la selección por defecto no cuenta);
  - celda fuera del rango → el rango se extiende hasta incluirla (rellena huecos): tocar-tocar da un
    rango sin arrastrar;
  - celda marcada que no es el final → pasa a ser el final ("hasta acá");
  - el final → se achica uno (o `null` si era la única).
  Sobre celdas del sistema, igual que hoy (inicio = primer adeudado o inicio previo mantenido).
- **`dragSelect(options, anchor, over) → Selection`**: `lo = min`, `hi = max`; si `lo` no es previa,
  `lo` = primera celda del sistema elegible (nadie salta meses); recorta a celdas elegibles; `null` si
  no queda ninguna. Un arrastre siempre REEMPLAZA la selección.
- **`preCellRole(options, selection, index) → 'marked' | 'owed' | null`**: `owed` = previa dentro de
  F..P sin marcar (queda adeudada). La grilla la rotula "queda debiendo".
- **`debtAfterPayment(options, selection, ctx) → { months, cents }`**: lo que sigue adeudado después
  del pago: Σ pendiente de las celdas efectivas NO marcadas que son deuda (`opening_balance`,
  `monthly`, previas dentro de F..P, y la proyectada solo si es el mes actual; los adelantos no son
  deuda).
- **`selectionSummary` / `coverLabel`**: las celdas `opening_balance` con `openingFrom` cuentan como
  meses; solo la legacy es "saldo anterior".
- **`extendToDueMonths` se elimina** (y sus llamadas). Existía porque el rango forzado hasta P no
  dejaba a los meses del sistema que el saldo "des-cubría" fuera del pago; ahora el operador decide y
  `debtAfterPayment` le muestra qué queda.
- `closePreSystem`, `defaultSelection`, `isBeforeStart`, `firstSystemIndex`: sin cambios.

### 7.2 Tocar (teclado y toque)

Cada celda sigue siendo un `<button>` con `aria-pressed`: Enter/Espacio/toque llama a `onTap` con
las reglas de arriba. Sin arrastrar se llega a cualquier rango tocando el primero y el último.
Línea de ayuda bajo la grilla (una sola, `text-xs`): "Tocá el primer y el último mes, o arrastrá."
(en `pointer: coarse`: "Tocá el primer y el último mes, o mantené apretado y arrastrá.").

### 7.3 Arrastrar

- Máquina de estados pura en `month-drag.ts` (sin React, testeable en Node; no hay jsdom en el repo):
  estados `idle → pending → dragging`; eventos `down(index, pointerType)`, `armed`, `enter(index)`,
  `up`, `cancel`. Reglas: mouse arma al entrar en OTRA celda; touch arma por mantener apretado
  (~250 ms) sin moverse más de ~8 px; si se mueve antes, es scroll y se descarta. `dragging` emite
  `(anchor, over)` en cada cambio de celda.
- Hook `use-month-drag.ts` (cliente): handlers delegados en el `<ul>` (`data-month-index` en cada
  celda), `pointerdown/move/up/cancel`. Hit-test con `document.elementFromPoint` (con touch el target
  queda en la celda inicial). `setPointerCapture` en el contenedor al armar.
- Scroll en touch: celdas con `touch-action: pan-y`; al armar, un listener NATIVO `touchmove` no
  pasivo hace `preventDefault` hasta soltar (React registra `touchmove` como pasivo, no sirve).
  Antes de armar el navegador scrollea normal. Mismo patrón que el `TouchSensor` con `delay` de
  dnd-kit.
- Detalles: `select-none` y `-webkit-touch-callout: none` en la grilla; se bloquea `contextmenu`
  mientras está armado; `navigator.vibrate?.(10)` al armar; el `click` que sigue a un arrastre se
  descarta (flag consumida en el handler del botón); `pointercancel` termina el arrastre y deja lo
  que hubiera. Un mantener-apretado sin mover = esa celda sola (`dragSelect(a, a)`).
- Sin auto-scroll del sheet al arrastrar cerca del borde: la grilla son ≤ 5 filas de 4.
- La selección se actualiza EN VIVO mientras se arrastra (el resumen y el total del pie siguen al
  dedo). El resumen es `role="status"` (anuncia "6 meses · enero a junio").

### 7.4 Grilla colapsable y resumen

- `EntryState` suma `expanded: boolean` y `picked: boolean` (el operador ya tocó algo; alimenta
  `fresh`). `initialEntry(options, status, { expanded })`.
- Colapsada: una línea con `summaryText` ("1 mes · octubre 2026"; con previos: "6 meses · enero a
  junio") y un botón "Cambiar" (≥ 44 px, `aria-expanded`, `aria-controls` de la grilla). Debajo,
  si queda deuda: "Queda debiendo 4 meses · $40.000" (`debtAfterPayment`). Expandida: grilla + el
  mismo resumen + el total corregible + la ayuda. Sin animación (cambio de estado, no coreografía).
- Valor inicial: `expanded = !billingStarted` en el pago individual (antes del inicio todos están en
  carga inicial: grilla abierta); `false` en el pago de grupo (N socios × grilla no entra en el
  sheet); `false` después del inicio. "Otro monto" abre la grilla (necesita ver qué cubre). El
  pliegue "¿Debe meses de antes de…?" de después del inicio se queda adentro de la grilla abierta.
- `billingStarted = billing.startPeriod != null && billing.startPeriod <= billing.currentPeriod`
  (ya viaja en `BillingStatus`); se pasa como prop booleana desde `register-payment-sheet.tsx`.
- Celdas previas dentro de F..P sin marcar: ícono + texto "queda debiendo" (no solo color). El total
  del saldo (`OpeningTotalField`) pasa a rotularse con su alcance: "Total de la deuda desde
  <F> (N meses)", con la pista "Pagó X meses · $Y. Queda debiendo Z meses · $W." y su corrección
  actual ("Si debía otro valor, corregí el total"). Recibe las celdas de F..P, no solo las marcadas.
- Aviso de saldo existente (solo con la grilla abierta, `text-xs`): con `openingFrom`: "El saldo
  anterior de este socio arranca en <mes>. Para indicar meses anteriores, un administrador tiene que
  anularlo desde la ficha y volver a cargarlo."; con celda legacy: "Este socio ya tiene un saldo
  anterior cargado. Para cambiar desde cuándo debía, un administrador tiene que anularlo desde la
  ficha."
- Ficha ("Indicar desde cuándo debía", `opening-balance-months.tsx`): sin arrastre y sin cambios
  de comportamiento (`preMode: 'to_end'`): ahí solo importa "desde cuándo", el tramo siempre va hasta
  P. Solo se actualiza el rótulo del total y la ayuda para el nuevo `OpeningTotalField`.
- Operate (`reference/operate.md`, `craft-floor.md`): un solo vocabulario de celda; sin modal; estado
  de carga/vacío/error ya cubiertos por el formulario; targets ≥ 44 px (la celda `compact` ya es
  `min-h-11`); sin kicker ni tarjetas anidadas; foco visible conservado.

### 7.5 Casos borde

| Caso | Comportamiento |
|---|---|
| Pago de grupo | Misma lógica por integrante (`EntryState` por socio); grilla colapsada por defecto; drag funciona dentro de la grilla de cada uno |
| Socio de baja | Sin celdas `projected`. Previas disponibles si no tiene saldo; selección por defecto = toda la deuda del sistema, sin adelantos (como hoy) |
| Después del inicio | Celdas del saldo con tramo ya pagas se ocultan (`period >= first_due`); colapsada por defecto |
| Antes del inicio, mes actual | Sigue siendo la celda previa `isCurrent` ("este mes"); selección inicial = el mes actual |
| Saldo a favor | `effectiveOptions` lo aplica al saldo nuevo primero; derivado puede dar $0 → frenado con el mensaje que manda a la ficha (§6.5) |
| Total corregido | §6.3; si cambia la selección el override se descarta (como hoy: `keepsPre`) |
| Dos operadores a la vez | El segundo choca con `fees_one_opening_balance` y recibe el error ya traducido (campo `openingBalance`) |
| Reintento por red | Idempotencia por `batch_id` intacta |
| Socio con alta posterior al inicio | Sin celdas previas (filtro `joined_on` de la RPC) |

## 8. Capas y archivos (MVC)

- `models/`: `types.ts` (contrato; hilo principal), `accounts.model.ts` (mapea `opening_from`),
  `fees.model.ts` (el insert de la ficha manda `from_period`/`to_period`). `payments.model.ts` no
  cambia (la RPC de lote ya recibía las fechas). Sin controllers nuevos: `payments.actions.ts` ya
  pasa `fromPeriod`/`toPeriod` a `createOpeningBalanceFromMonths`.
- `views/`: `month-selection.ts`, nuevos `month-drag.ts` y `use-month-drag.ts`, `month-strip.tsx`,
  `month-entry.tsx`, `payment-form.tsx`, `group-payment-form.tsx`, `register-payment-sheet.tsx`,
  `members/opening-balance-months.tsx`. Cero fetch en vistas (se mantiene).
- Postgres: columnas + CHECKs + trigger inmutable + grant (§5.2), dos RPC (§5.3, §5.4).
- Autorización: sin cambios (`payments.register`; la anulación sigue siendo `payments.void`).
  Auditoría: automática por triggers; actor = `auth.uid()` (la RPC es INVOKER).

## 9. Alternativas descartadas

- **Varios saldos anteriores por socio** (uno por tanda de pagos): rompe el único vigente y, peor,
  el orden de balance forward (todos comparten `period = inicio − 1`; el segundo quedaría detrás del
  primero y las celdas no coincidirían con la cobertura real).
- **Un cargo `opening_balance` por mes** (opción B): ver §5.1.
- **Permitir marcar meses sueltos con huecos** (tildar ene, mar, may): contradice balance forward
  (decisión 4) y haría falta imputar a mano. Un pago se imputa al más viejo primero; el hueco
  se resuelve eligiendo el rango contiguo.
- **Quitar la grilla y dejar solo "cuántos meses"**: no sirve para carga histórica (pedido de Tomás).
- **`touch-action: none` en las celdas**: arrastre inmediato pero secuestra el scroll del sheet.
- **Valor por mes en vez de total corregible**: §6.3.

## 10. Estrés de este plan (grilling, contra mí mismo)

1. *¿Qué pasa si el pago histórico se carga en el orden inverso (abril–junio primero)?* El saldo
   arranca en abril; enero–marzo no tienen celdas. Camino: anular y recargar (§6.4/6.5). Para la
   carga inicial se recomienda cargar la deuda "desde cuándo debía" y pagar de ahí.
2. *¿El reparto con centavos puede dar celdas "parciales" raras?* El resto (< n centavos) va al
   último mes; con totales en pesos enteros y n ≤ 12 rara vez aparece, y se muestra en pesos sin
   decimales (`formatCentsCompact`).
3. *¿`debtAfterPayment` puede contradecir la deuda real?* Opera sobre las opciones efectivas de la
   misma selección que el derivado; la deuda real post-pago es lo que la RPC devolverá. Se prueba con
   un test de DB que crea el estado y lo compara.
4. *¿El drag rompe el teclado?* No: el botón y `onTap` son los mismos; el drag es una capa de
   punteros que se descarta con `pointercancel`.
5. *¿Seguridad?* Sin superficie nueva: grants por columna, mismas policies, RPC INVOKER, CHECKs para
   quien le pegue a PostgREST directo (tramo > 36 meses, mitad informada, no `opening_balance`).
6. *¿PII en logs?* Nada nuevo.
7. *¿Migración reversible?* Reversa: restaurar las dos RPC y el guard anteriores, quitar el grant,
   los CHECKs y las columnas (nullable: filas viejas intactas). Los datos con tramo ya cargados se
   perderían como tramo, no como monto.

## 11. Verificación manual obligatoria (no hay jsdom)

En un celular iOS y uno Android, y en escritorio: scrollear vertical sobre la grilla (no debe
arrastrar), mantener apretado y arrastrar ene–jun (marca en vivo, no scrollea), soltar, tocar-tocar,
teclado (Tab, Enter), lector de pantalla (anuncia el resumen), y a 390 px sin scroll horizontal.

## 12. Preguntas

**Para el usuario (no bloquean, vienen con default):**
1. Filas de `opening_balance` viejas en prod (sin tramo): ¿se recargan a mano (anular y recargar)
   o hace falta un backfill? Default: a mano, tras ver el conteo.
2. ¿Ampliar la ventana de meses previos de 12 a 24? Default: no (alcanza con lo pedido).

**Para la Comisión:** ninguna nueva. La política de quién anula (solo `admin`) no cambia; conviene
avisarles que corregir un saldo anterior cargado mal requiere a un administrador.
