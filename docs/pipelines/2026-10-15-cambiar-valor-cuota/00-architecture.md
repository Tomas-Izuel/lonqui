# 00 — Arquitectura: cambiar el valor de una cuota desde la UI

Pipeline: `docs/pipelines/2026-10-15-cambiar-valor-cuota/`. Planner:
`feature-planner`, 2026-10-15. Estado: **propuesta, pendiente de aprobación**.

## 1. Problema y contexto

Pedido de Tomás, textual: *"actualmente la ui no permite cambiar los valores
de las cuotas, debería dejar hacerlo. comienza a aplicar del cambio en
adelante, no cambia lo pasado, en pagado ni en deuda"*.

Dos cosas distintas se mezclan en "no permite":

1. **Descubribilidad.** Un admin que mira una fila "Por defecto · $10.000 ·
   desde octubre 2026" en `/ajustes` no tiene ninguna acción sobre ella. La
   única puerta es "Nuevo valor", que pide elegir alcance, destino, monto y
   mes como si fuera una regla nueva. Para quien quiere "subir la cuota a
   $12.000", eso no se lee como "cambiar el valor": se lee como que no se
   puede.
2. **Corregir un valor programado es imposible.** Si alguien cargó $120.000
   en vez de $12.000 para noviembre, el índice único
   `fee_prices_unique_target (scope, member_type, category_id, valid_from)`
   rechaza cualquier segunda fila para ese destino y mes, y `fee_prices` es
   append-only (`forbid_change`): no hay UPDATE, no hay DELETE. La única
   salida hoy es programar diciembre y aceptar que noviembre se genere mal.

La **semántica** que pide Tomás —aplica hacia adelante, lo pasado (pagado o
adeudado) no cambia— **ya está garantizada en Postgres** y no se toca:
`fees.amount_cents` se congela al generar, `fee_prices_insert_guard` rechaza
`valid_from` anterior al mes actual (hora Argentina) y rechaza cualquier mes
que ya tenga cuotas mensuales generadas. Este pipeline no cambia esa regla;
la hace visible y usable.

Restricciones que mandan: contrato §2.2 (valor configurable por categoría o
tipo de socio), CLAUDE.md "Cuotas" (monto congelado, cambio aplica desde el
próximo período, nada se borra, auditoría por trigger), superficie Operate
para voluntarios no técnicos, mobile first a 390px.

## 2. Chequeo de alcance

- **Dentro de la Fase 1**: contrato §2.2 "valor de cuota configurable,
  distinto por categoría o por tipo de socio". CLAUDE.md ya lo fija: *"Cambiar
  el valor de la cuota no reescribe cargos pasados: aplica desde el próximo
  período"*. Esto es terminar un requisito contratado, no uno nuevo.
- **Fuera, y queda fuera** (confirmado con el diagnóstico del hilo principal,
  punto 3):
  - *Cambiar el valor de un mes ya generado.* Es D17-C del pipeline
    `2026-09-27-cuotas-pagos-panel` (regenerar cuotas al cambiar el precio),
    descartada porque rompe "monto congelado" y toca cargos pagados. Si la
    Comisión alguna vez quiere recobrar un mes a otro valor, eso es anular
    cuotas con motivo y un ajuste por socio: otro pipeline, otra conversación.
  - *Cancelar un valor programado.* No hace falta un mecanismo propio: con la
    decisión de §6 (dos filas para el mismo mes, gana la más nueva), "cancelar"
    el $12.000 de noviembre es tocar "Cambiar" en esa fila y cargar el valor
    vigente ($10.000) para ese mismo mes. Queda en la historia como lo que
    fue. Si en el uso real resulta poco intuitivo, se diseña entonces.
- **Nada de esto toca** pagos, deuda, generación, cron, roles ni auditoría.

## 3. Desafío al pedido y al diagnóstico

El diagnóstico del hilo principal es correcto en sus dos puntos. Lo que agrego
o corrijo:

1. **"Unique incluyendo `amount`" tiene una trampa y se descarta.** Parece el
   punto medio (permite corregir, bloquea el duplicado exacto), pero: default
   $10.000 vigente; alguien programa $12.000 para noviembre; se arrepiente y
   quiere volver a $10.000 para noviembre. Con `(destino, mes, monto)` único,
   la fila `(default, nov, 10.000)` no choca con nada... salvo que YA exista
   una fila `(default, nov, 10.000)` de un intento anterior: entonces el
   insert falla con 23505 y el admin no puede volver atrás nunca para ese
   mes. Y al revés: si existen `(nov, 12.000)` y `(nov, 10.000)`, el desempate
   sigue siendo por `id` igual, así que el índice no aporta nada que no
   aporte el desempate. Es una restricción que no protege ningún invariante
   y sí crea un callejón sin salida. Fuera.
2. **Monto vacío, no precargado, en el sheet de "Cambiar".** El hilo propuso
   precargar el monto actual. En un celular, borrar "10.000" para tipear
   "12.000" es fricción y una fuente de errores ("10.0002"). El valor actual
   se muestra como contexto ("Hoy: $10.000 desde octubre 2026") y el campo
   arranca vacío con foco: la persona escribe el número nuevo y listo.
3. **Decir explícitamente qué se reemplaza.** Al sacar el índice único, elegir
   un mes que ya tiene un valor programado para ese destino lo pisa en
   silencio (gana el más nuevo). Eso tiene que estar escrito en el sheet,
   dinámico según el mes elegido: *"Reemplaza el valor de $12.000 programado
   para noviembre 2026"*. Vale en los dos modos (Nuevo valor y Cambiar), porque
   "Nuevo valor" también puede caer en un destino+mes ya programado.
4. **Un guard de "mismo valor" en el cliente, no en la base.** Guardar el
   mismo monto que ya rige para ese mes crea una fila que no cambia nada.
   Se frena en el formulario ("Es el mismo valor que ya tiene para ese
   mes"). No va a Postgres porque no es un invariante del dominio: una fila
   redundante no mueve un centavo, y el importador (pipeline
   `2026-10-15-importacion-padron`) ya evita insertarla por su propio SELECT.
5. **La historia sigue mostrando todo.** Append-only significa que la fila
   reemplazada queda. En "Historia" se marca como "Reemplazado" (texto
   secundario, sin pill nueva), para que nadie crea que hay dos valores
   vigentes para el mismo mes. En "Próximos" y en "vigentes" solo se muestra
   el que gana.

Nada en el pedido es sobre-ingeniería; el cambio es chico y el riesgo bajo.

## 4. Investigación: qué hay en el repo y qué consulté

**Herramientas.** El MCP de Supabase **no respondió** (`ECONNREFUSED`: el stack
local no estaba levantado), así que todo lo que sigue sale de leer las
migraciones y el código, no de inspeccionar la base viva. Skills leídas:
`supabase-postgres-best-practices` (`schema-constraints.md`,
`query-partial-indexes.md`, `query-composite-indexes.md`, `data-upsert.md`,
`security-privileges.md`) e `impeccable` (`reference/shape.md`,
`reference/operate.md`, `reference/craft-floor.md`, más `impeccable context`
sobre `fee-prices-section.tsx`: PRODUCT.md, DESIGN.md y
`.impeccable/surfaces/route-ajustes.md`).

**Lo que existe hoy (verificado):**

- `supabase/migrations/20260927130000_billing.sql`:
  - `fee_prices` append-only: `forbid_change` en UPDATE/DELETE, sin grant de
    UPDATE/DELETE para nadie (ni `service_role`). Grant de INSERT por columna
    a `authenticated`; policy de insert por `private.can('billing.configure')`.
  - Índice **único** `fee_prices_unique_target (scope, coalesce(member_type,''),
    coalesce(category_id,0), valid_from)`.
  - Trigger `fee_prices_insert_guard` (DEFINER): rechaza `valid_from <` mes
    actual (`private.club_today()`) y `valid_from` con `fees kind='monthly'`
    ya generadas, con mensajes pensados para el usuario (23514).
  - `private.fee_price_for(category_id, member_type, period)`: categoría >
    tipo > default, dentro de cada uno el mayor `valid_from <= period`,
    `limit 1`. **No desempata por `id`** porque el índice único lo hacía
    innecesario. Es la **única definición** en todas las migraciones
    (`accounts.sql` solo la usa en `member_accounts` para `current_fee_cents`
    y la re-otorga). `generate_fees` la usa para congelar `amount_cents` y
    `fee_price_id`.
  - `enable_audit('public.fee_prices')`: cada INSERT deja fila en `audit_log`
    con actor `auth.uid()`.
- `src/models/fee-prices.model.ts`: `listFeePrices` (orden `valid_from desc,
  id desc`), `getFeePricesOverview` (vigente = primero por destino con
  `validFrom <= mes actual`; `upcoming` = todo lo futuro **sin deduplicar**;
  `history` = todo), `createFeePrice` (traduce 23505 → "Ya hay un valor para
  ese alcance desde ese mes", 23514 del guard → mensaje tal cual en
  `validFrom`). Es el **único lector TS** de la tabla (el modelo de auditoría
  solo etiqueta columnas).
- `src/controllers/billing.actions.ts:createFeePrice`: `requirePermission(
  'billing.configure')`, Zod `.strict()`, `revalidatePath('/', 'layout')`.
- `src/views/settings/fee-prices-section.tsx`: filas sin acción, con un
  comentario que lo declara a propósito ("nunca hay un botón editar en una
  fila"). `new-fee-price-sheet.tsx`: alcance → destino → monto → "Aplica
  desde" (del primer mes no generado a +12 meses, derivado de
  `BillingStatus.lastGeneratedPeriod`).
- `src/models/types.ts`: `FeePrice`, `FeePriceInput`, `FeePricesOverview`.
- Tests que dependen del índice único: `tests/db/billing.test.ts` ("duplicado
  exacto → 23505"), `tests/db/constraint-translations.test.ts` ("valor
  duplicado 23505 → field validFrom"), `tests/models/fee-prices.model.test.ts`
  ("23505 → DomainError").
- Seed local: default $10.000 desde el mes actual (ya generado), Vóley ·
  Mayores $12.000 programado para el mes siguiente.
- `.impeccable/surfaces/route-ajustes.md`: Operate, hereda la dirección D0;
  patrón de fila con acciones ya existe en `category-row.tsx` (botones
  `size-11`, menú "Más acciones").

**Patrón de referencia.** Tablas de precios con vigencia ("effective-dated
pricing", "slowly changing" de tipo append) resuelven la corrección de un
valor futuro de dos maneras: *supersede* implícito (gana la fila más reciente
para la misma vigencia) o *void* explícito (marcar la fila como anulada). La
segunda es la que este repo usa para dinero real (`payments.voided_at`,
`cash_movements`), porque un pago anulado tiene consecuencias contables y
necesita motivo. Un valor de cuota futuro que todavía no generó nada no las
tiene: no hay cargo, no hay deuda, no hay actor perjudicado. Para
configuración, el supersede implícito con auditoría de cada inserción es el
estándar y alcanza.

## 5. Opciones y trade-offs

### 5.1 Cómo se descubre "cambiar" en `/ajustes`

| Opción | Pros | Contras |
|---|---|---|
| **A. Acción "Cambiar" por fila (vigentes y próximos) que abre el mismo sheet en modo "cambio", con destino fijo** (recomendada) | Un toque desde la fila que se quiere cambiar; el destino no se elige (no hay forma de equivocarse de categoría); el mismo formulario y la misma action que hoy; corregir un programado es la misma acción | Un componente con dos modos (nuevo / cambio); una fila más ancha a 390px |
| B. Edición inline del monto en la fila, con el mes en un selector al lado | Menos toques | Se lee como "editar", que es exactamente lo que append-only no hace; el "desde qué mes" y el aviso de qué se reemplaza no entran en una fila de celular; estados de error pobres |
| C. Dejar solo "Nuevo valor" y mejorar la copy | Cero cambios de estructura | No resuelve el problema: la persona busca la acción en la fila, no en el header |

### 5.2 Cómo se permite corregir un valor programado

| Opción | Pros | Contras |
|---|---|---|
| **A. Índice no único + desempate por `id desc` en `fee_price_for` y en el modelo** (recomendada) | Sigue append-only (ninguna fila se toca); la corrección es un INSERT auditado con actor; una línea en la función SQL; el modelo ya ordena por `id desc`; "cancelar" es corregir de vuelta | La historia puede mostrar dos filas para el mismo mes (se marca "Reemplazado"); el importador pierde el respaldo del índice para su idempotencia (§8: ya la hace por SELECT) |
| B. Único incluyendo `amount_cents` | Bloquea el duplicado exacto | Callejón sin salida de §3.1; el desempate por `id` hace falta igual; no protege ningún invariante |
| C. Anulación explícita (`superseded_at/by` en la fila vieja, como `payments.voided_at`) | Estado explícito en datos; el índice único se conserva | Rompe la inmutabilidad total de `fee_prices` (hay que abrir UPDATE por columna, policy, guard, auditoría del UPDATE); es el "cancelar valor programado" que el hilo dejó fuera; mucha migración para un caso raro de configuración, no de dinero |
| D. No permitir corregir; que programe el mes siguiente | Nada que hacer | Noviembre se genera con el valor equivocado y después hay que anular cuotas una por una: inaceptable |

### 5.3 Qué pasa con el guard al corregir

Sin opción nueva: `fee_prices_insert_guard` queda **igual**. Corregir noviembre
está permitido mientras noviembre no tenga cuotas generadas; si el admin tiene
la página abierta de antes de las 00:05 del 1° y toca "Cambiar" después del
cron, Postgres rechaza con "Las cuotas de 11/2026 ya se generaron con otro
valor; el nuevo aplica desde 12/2026", que el modelo ya traduce al campo
"Aplica desde". Es el camino de error correcto y ya existe.

## 6. Arquitectura recomendada

**5.1-A + 5.2-A.** Un cambio de schema de tres sentencias, un modelo que
deduplica y marca, una vista con acción por fila y un sheet con dos modos.
Ninguna action nueva, ningún permiso nuevo, ninguna tabla nueva.

### 6.1 Postgres (migración, la escribe el hilo principal)

Archivo propuesto: `supabase/migrations/20261015120000_fee_prices_correction.sql`.
Contenido, en intención (el hilo principal lo escribe y lo verifica con
`db:reset`):

```
-- Valores de cuota: dos filas con el mismo alcance, destino y mes son una
-- corrección (gana la de id más alto). Sigue append-only. Pipeline:
-- docs/pipelines/2026-10-15-cambiar-valor-cuota/

drop index if exists public.fee_prices_unique_target;

-- Mismo prefijo que antes, ahora NO único. Con decenas de filas en toda la
-- vida del club el índice es higiene, no performance: soporta el filtro por
-- destino + valid_from de fee_price_for y del overview.
create index fee_prices_target_idx
  on public.fee_prices (scope, coalesce(member_type, ''), coalesce(category_id, 0), valid_from);

-- Única redefinición de fee_price_for en todo el repo (la de 20260927130000):
-- se agrega `fp.id desc` como último criterio. Misma firma, mismo retorno,
-- `create or replace` conserva los grants; se reafirman igual por convención.
create or replace function private.fee_price_for(p_category_id bigint, p_member_type text, p_period date)
returns table (fee_price_id bigint, amount_cents bigint)
language sql
stable
set search_path = ''
as $$
  select fp.id, fp.amount_cents
  from public.fee_prices fp
  where fp.valid_from <= p_period
    and (
      (fp.scope = 'category' and fp.category_id = p_category_id)
      or (fp.scope = 'member_type' and fp.member_type = p_member_type)
      or fp.scope = 'default'
    )
  order by
    case fp.scope when 'category' then 1 when 'member_type' then 2 else 3 end,
    fp.valid_from desc,
    fp.id desc
  limit 1;
$$;

revoke execute on function private.fee_price_for(bigint, text, date) from public, anon;
grant execute on function private.fee_price_for(bigint, text, date) to authenticated, service_role;

comment on table public.fee_prices is
  'Valores de cuota. Append-only: cambiar un valor es insertar una fila nueva con valid_from = el mes desde el que aplica. Dos filas con el mismo alcance, destino y mes son una corrección: rige la de id más alto.';
```

Qué **no** cambia y por qué:

- `fee_prices_insert_guard`: es la regla "aplica hacia adelante" que pide
  Tomás. Intacta.
- `forbid_change`, grants (sin UPDATE/DELETE para nadie), policy de insert por
  `billing.configure`, `enable_audit`: intactos. La corrección es un INSERT
  más, con su fila de auditoría y su actor.
- `fees`: su índice único `(member_id, period, discipline_id) where
  kind='monthly'` sigue garantizando una cuota por socio y mes; `fee_price_id`
  apunta a la fila que ganó al generar. Nada que migrar.
- Reversa: recrear el índice único (falla si ya hay dos filas para el mismo
  destino y mes: habría que decidir cuál queda, a mano) y volver a la
  definición anterior de `fee_price_for`. Documentarlo en el encabezado de la
  migración.

### 6.2 Contrato de tipos (`src/models/types.ts`, hilo principal)

- Nuevo `FeePriceHistoryEntry = FeePrice & { supersededById: number | null }`:
  `null` si esa fila es la que rige para su destino y mes; si no, el `id` de
  la fila que la reemplazó (la de mayor `id` con el mismo alcance, destino y
  `validFrom`).
- `FeePricesOverview.history` pasa de `FeePrice[]` a `FeePriceHistoryEntry[]`.
  `current` y `upcoming` siguen siendo `FeePrice[]`, pero `upcoming` pasa a
  contener **una fila por destino y mes** (la que rige).
- `FeePrice` y `FeePriceInput` no cambian: el sheet en modo cambio manda el
  mismo `FeePriceInput` de siempre.

### 6.3 Modelo (`src/models/fee-prices.model.ts`, backend)

- `translateFeePriceError`: se **elimina** la rama `23505` (ya no hay índice
  único que la produzca; si apareciera un 23505 por otra causa se relanza
  como error interno, que es lo correcto).
- `getFeePricesOverview`:
  - `current`: sin cambio de lógica (la lista ya viene `valid_from desc, id
    desc`, el primero por destino es el que rige, también si dos filas
    comparten el mes).
  - `upcoming`: deduplicar por (alcance, destino, `validFrom`) quedándose con
    el primero que aparece (el de mayor `id`).
  - `history`: cada fila con `supersededById` calculado en una pasada sobre la
    lista ordenada (la primera fila vista para cada clave destino+mes es la que
    rige; las siguientes con la misma clave apuntan a ella).
  - Todo en TypeScript puro sobre la lista ya cargada: una tabla de decenas de
    filas no justifica una RPC, y PostgREST no corta nada acá (lejos de
    `max_rows`).
- Comentario de cabecera del modelo: reemplazar "la unique constraint del
  duplicado exacto" por la regla de corrección.

### 6.4 Controller y action

Sin cambios. `createFeePrice` (action) ya hace permiso + Zod + revalidación del
layout entero. El modo "cambio" del sheet es solo una forma distinta de armar
el mismo `FeePriceInput`.

### 6.5 Vistas (`src/views/settings/`, frontend)

**Sección "Valores de cuota"** (`fee-prices-section.tsx`):

- Cada fila de **vigentes** (por defecto, por tipo de socio, por categoría) y
  de **próximos** gana una acción **"Cambiar"**: botón de texto (`variant=
  "ghost"`, alto 44px, `aria-label="Cambiar valor de <destino>"`). En
  "Historia" no hay acción.
- Las filas de vigentes muestran, si existe, el cambio ya programado más
  próximo para ese destino, como tercera línea secundaria: *"Cambia a $12.000
  desde noviembre 2026"*. Se deriva de `upcoming` comparando alcance +
  destino. Evita programar dos veces lo mismo y hace legible "Próximos".
- "Historia": las filas con `supersededById !== null` muestran "Reemplazado"
  en texto secundario (sin pill nueva, sin tocar `status-pill.tsx`), monto
  con el mismo estilo pero atenuado. Orden sin cambios.
- "Nuevo valor" en el header se queda: es la puerta para una **regla nueva**
  (un destino que todavía no tiene valor propio).
- Actualizar el comentario del componente: la fila sí tiene acción, pero sigue
  insertando; nunca edita.

**Sheet** (`new-fee-price-sheet.tsx`, renombrar a `fee-price-sheet.tsx` /
`FeePriceSheet`, un componente con dos modos):

- Prop `mode: 'new' | 'change'` y, en `change`, la fila de referencia
  (`FeePrice`) + su etiqueta legible (la misma que usa la sección).
- Modo `new`: exactamente lo de hoy.
- Modo `change`:
  - Título "Cambiar valor de cuota"; descripción con el destino ("Por
    defecto" / "Practicante" / "Vóley · Mayores"). Alcance y destino **no se
    muestran como campos** (ni deshabilitados): son fijos.
  - Línea de contexto: "Hoy: $10.000 desde octubre 2026" (fila vigente) o
    "Programado: $12.000 desde noviembre 2026" (fila de próximos).
  - **Monto vacío**, con foco al abrir.
  - "Aplica desde": mismas opciones que hoy (del primer mes no generado a +12).
    Default: fila vigente → la primera opción; fila de próximos → su propio
    mes (siempre está en la lista: un mes futuro nunca tiene cuotas
    generadas).
  - Texto fijo debajo del selector, dinámico con el mes elegido: *"Se usa en
    las cuotas que se generen desde <mes>. Las cuotas ya generadas no cambian,
    estén pagadas o adeudadas."* Es la frase de Tomás, puesta donde se decide.
- En **ambos modos**, si para el destino resultante ya hay un valor con el mes
  elegido, aviso: *"Reemplaza el valor de $X programado para <mes>"*. Se
  calcula con `history` (misma clave destino+mes, el de mayor `id`).
- En **ambos modos**, guard de cliente: si el monto es igual al que regiría en
  el mes elegido para ese destino (el mayor `validFrom <=` mes elegido entre
  las filas del mismo destino, desempate por `id`), error en `amountCents`:
  *"Es el mismo valor que ya tiene para ese mes"*.
- Envío: la misma action `createFeePrice`; éxito → toast "Valor de cuota
  actualizado" (modo cambio) / "Valor de cuota creado" (modo nuevo); el error
  del guard de Postgres ya aterriza en "Aplica desde".
- La sección pasa al sheet `history` (para los dos cálculos de arriba) además
  de `billing` y `categoriesByDiscipline`.

Piso de calidad que aplica (`craft-floor.md`, `operate.md`): targets de 44px,
estados hover/focus/disabled/loading/error, sin modal para lo que no necesita
foco protegido (el sheet ya es la convención de `/ajustes` para formularios
cortos), copy que nombra la acción y la consecuencia, numerales tabulares en
montos, nada de pills nuevas ni íconos unicode. Verificar a 390px: la fila
`etiqueta/desde · monto · Cambiar` no puede partirse en dos líneas ni truncar
el monto (truncar la etiqueta sí, ya lo hace).

### 6.6 Flujo

```
/ajustes → fila "Por defecto $10.000 desde oct 2026 · Cambia a $12.000 desde nov 2026" → [Cambiar]
  → FeePriceSheet mode=change (destino fijo, Hoy: $10.000, monto vacío, Aplica desde: dic 2026)
  → aviso si dic ya tiene valor para ese destino; error si monto == el que regiría en dic
  → createFeePrice({ scope, memberType, categoryId, amountCents, validFrom })   (action existente)
  → requirePermission('billing.configure') → Zod → INSERT con cliente de sesión
  → RLS (billing.configure) → fee_prices_insert_guard (mes ≥ actual, mes sin cuotas) → audit_row_change (actor = auth.uid())
  → revalidatePath('/', 'layout') → la sección muestra la fila nueva en Próximos y la vieja (si era del mismo mes) en Historia como "Reemplazado"
  → el 1° del mes, generate_fees → fee_price_for(..., período) → gana valid_from más alto y, a igual mes, id más alto → amount_cents congelado
```

## 7. Transversales

- **Autorización.** Sin cambios: `billing.configure` (hoy solo `admin`) en la
  action, en la policy de INSERT y en `getSettingsPage`. `editor` y
  `consulta` no llegan a `/ajustes`; aunque peguen a PostgREST directo, la
  policy los frena.
- **Auditoría y actor.** La corrección es un INSERT con el cliente de sesión:
  `audit_log` recibe la fila con `actor_id = auth.uid()`. Dos correcciones
  seguidas son dos filas de auditoría con sus actores; `/auditoria` ya las
  etiqueta ("un valor de cuota", alcance, monto, vigente desde). Nada que
  tocar en `audit.model.ts` ni en `audit-labels.ts`.
- **Nada se borra.** Se refuerza, no se debilita: sigue sin UPDATE ni DELETE
  para nadie; la fila "equivocada" queda y se ve como reemplazada.
- **Dinero y cuotas.** Centavos enteros, CHECK `>= 0`, monto congelado en
  `fees`. La deuda se deriva de `fees` − `payments`, que no se tocan: un
  cambio de valor no mueve ni un centavo del pasado, por construcción.
- **Zona horaria.** El guard usa `private.club_today()`; el sheet usa
  `toPeriod()`/`BillingStatus.currentPeriod` (hora Argentina). Sin cambios.
- **Concurrencia.** Dos admins corrigiendo el mismo mes a la vez: los dos
  INSERT entran, gana el `id` más alto, los dos quedan auditados. Es "último
  en escribir gana", que para configuración es aceptable y más honesto que un
  23505 arbitrario para uno de los dos.
- **Datos personales.** No hay ninguno en esta superficie.
- **Fallas.** Guard de Postgres (mes generado) → mensaje en "Aplica desde";
  permiso → `PermissionError` → mensaje genérico; red → `formError`. Todo
  existente.
- **Migración.** `drop index` + `create index` sobre una tabla de decenas de
  filas: instantáneo; `create or replace function` conserva ACL y
  dependencias (misma firma y retorno). `database.types.ts` no cambia
  (índices y cuerpo de función no se tipan), pero se regenera igual por
  convención.
- **Cache.** `revalidatePath('/', 'layout')` ya está en la action. Un valor
  nuevo cambia `current_fee_cents` de la precarga de pagos en `/socios/[id]`
  y `/caja` solo para meses futuros; el layout entero se invalida igual.

## 8. Impacto en `docs/pipelines/2026-10-15-importacion-padron/` (no implementado)

Ese plan cuenta con `fee_prices_unique_target` en tres lugares. Qué cambia (el
hilo principal lo anota en ese plan; este pipeline no edita esos archivos):

- §6.2 y §6.7: la idempotencia de precios **ya se decide por SELECT** en la
  misma transacción ("vigente igual → nada; vigente con otro monto → bloqueo;
  programado a futuro → bloqueo"). La fila de la tabla de §6.7 *"Fila exacta
  (category, valid_from) ya existente con otro monto → bloqueo (el índice
  único lo rechazaría igual)"* pierde la frase entre paréntesis: la detecta
  el caso "vigente a `valid_from` con otro monto" (un valor con el mismo
  `valid_from` es `<=` objetivo). El comportamiento no cambia; solo
  desaparece el respaldo del índice. **Importante**: al buscar "el precio
  vigente a `valid_from`" el importador tiene que desempatar por `id desc`
  (o usar `private.fee_price_for`, que ya hace para el preview de octubre).
- §"Fallas": sacar `fee_prices_unique_target` de la lista de constraints a
  traducir (23505 en `fee_prices` ya no ocurre).
- 01-tasks.md del importador: donde liste `fee_prices_unique_target` como
  caso de prueba, reemplazar por "segunda corrida con otro monto → bloqueo
  por SELECT, nunca llega al INSERT".

## 9. Brief de superficie (para que SH1 lo pegue en `.impeccable/surfaces/route-ajustes.md`)

> - **Cambiar un valor de cuota (2026-10-15):** cada fila de valores vigentes
>   y de próximos tiene "Cambiar" (botón de texto, 44px). Abre el mismo sheet
>   que "Nuevo valor" en modo cambio: destino fijo (no se vuelve a elegir),
>   "Hoy: $X desde <mes>" como contexto, monto vacío con foco, "Aplica desde"
>   con el primer mes sin cuotas generadas por defecto (o el mes de la fila,
>   si es un valor programado que se corrige), y la frase *"Se usa en las
>   cuotas que se generen desde <mes>. Las cuotas ya generadas no cambian,
>   estén pagadas o adeudadas."* Si el mes elegido ya tiene un valor para ese
>   destino, avisa "Reemplaza el valor de $Y programado para <mes>". Las filas
>   vigentes muestran su cambio programado más próximo ("Cambia a $Y desde
>   <mes>"). "Historia" muestra todo, con "Reemplazado" en las filas que otra
>   corrección dejó sin efecto. Nunca "editar", nunca "borrar": siempre una
>   fila nueva, auditada.
> - **Anti-objetivos:** editar el monto inline; cambiar el valor de un mes ya
>   generado; cancelar un programado con un mecanismo propio (se corrige de
>   vuelta al valor vigente).

## 10. Preguntas abiertas

**Para Tomás (bloquean el reparto):**

1. "Cambiar" como botón de texto en cada fila (recomendado por
   descubribilidad) vs. ícono de lápiz con `aria-label` (más angosto a 390px).
2. Monto vacío con "Hoy: $X" como contexto (recomendado) vs. precargado con el
   valor actual, como propuso el hilo.
3. ¿Confirmás que "cancelar un valor programado" queda fuera y se resuelve
   corrigiéndolo al valor vigente?
4. Renombrar `new-fee-price-sheet.tsx` → `fee-price-sheet.tsx`
   (`FeePriceSheet`, `mode`): ¿ok? Solo lo importa `fee-prices-section.tsx`,
   mismo dueño.

**Para la Comisión:** ninguna nueva. La regla de fondo ("un cambio aplica desde
un mes futuro completo, sin prorrateo; lo generado no cambia") ya la confirmó
el pipeline `2026-09-27-cuotas-pagos-panel` (D17, T6). Esto solo la hace
operable.

## 11. Respuestas de Tomás (2026-10-15)

1. Acción por fila: botón de texto **"Cambiar"** (recomendado).
2. Monto en modo cambio: **precargado con el valor de la fila** (no vacío). Reemplaza lo dicho en §6.5 y §9: el campo trae el monto actual y se edita encima; el foco va al campo igual.
3. Cancelar un programado: **fuera** (se corrige de vuelta al vigente).
4. Renombrar `new-fee-price-sheet.tsx` → `fee-price-sheet.tsx`: sí (decidido por el hilo principal, es interno).

S1 (migración) y SH1 (types + brief) hechos por el hilo principal; migración aplicada en local con `supabase migration up`.
