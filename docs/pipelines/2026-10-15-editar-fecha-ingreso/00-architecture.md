# Corregir la fecha de alta de un socio — arquitectura

Pipeline: `docs/pipelines/2026-10-15-editar-fecha-ingreso/`. Planificado por
`feature-planner` el 2026-10-15. Propuesta: **se aprueba antes de repartir**.

## 1. Problema y contexto

Pedido textual de Tomás: *"también se debería poder editar la fecha de ingreso
de un socio, ahora mismo no se permite"*.

Hoy `members.joined_on` es inmutable por diseño (CLAUDE.md, "Lo que se agrega
en Postgres": *"Columnas inmutables (monto de un pago, período de un cargo,
fecha de alta)"*). Lo bloquean dos barreras: no hay `grant update (joined_on)`
para nadie, y el trigger `members_immutable`
(`protect_immutable_columns('id','joined_on','created_at','created_by')`) lo
rechaza incluso como `postgres`.

Decisiones de Tomás que acotan este plan (recibidas por el hilo principal):

- Es una **corrección de carga** ("cliqueé mal"), no una operación de negocio.
  Sin motivo obligatorio, sin evento de corrección: alcanza con la auditoría
  del UPDATE.
- Se permite **solo si no perturba datos ya generados**. La base rechaza el
  cambio si la fecha nueva dejaría inconsistente algo que ya existe, con un
  mensaje en criollo.
- Se corrige **todo lo que copió esa fecha al dar de alta**, en una sola
  operación atómica: RPC `SECURITY DEFINER` con chequeo de permiso.
- Las inscripciones hechas después, con otra fecha, no se tocan; si quedaran
  antes de la fecha nueva, el cambio se rechaza.
- Permiso, no rol (`private.can('members.write')`).

Restricciones heredadas: invariantes en Postgres, nada se borra, auditoría por
trigger con actor de `auth.uid()`, dinero y cuotas intactos, superficie
Operate para voluntarios en el celular.

## 2. Chequeo de alcance

Contrato, sección 2.1 ("Asociados: alta, modificación…"): modificar un socio
incluye corregir lo que se cargó mal. No se agrega ningún módulo; no toca
Fases 2–5. **Fase 1, dentro de contrato.**

Este plan **no** toca `src/views/settings/**` ni `src/models/fee-prices.model.ts`
(los tiene el pipeline paralelo `2026-10-15-cambiar-valor-cuota`).

## 3. Lo que encontré (Step 0)

**Herramientas.** El MCP de Supabase no respondió (`ECONNREFUSED`: el stack
local no estaba levantado). Trabajé desde las migraciones
(`supabase/migrations/*.sql`, la definición vigente de cada RPC es la de la
migración más nueva) y desde el código. No hay nada que asumir del schema que
no esté escrito ahí.

**Dónde se copia la fecha de alta.** Barrido completo de `supabase/` (12
migraciones y los dos seeds) y de `src/models/`. No existe una RPC
`create_member`: el alta son dos llamadas desde `members.model.ts →
createMember`: `INSERT members` y luego `rpc('set_member_categories', {…,
effective_on: joinedOn})`.

| Lugar | Cómo llega la fecha | Qué hace la corrección |
|---|---|---|
| `members.joined_on` | la columna | se actualiza |
| `member_status_events.effective_on` de la fila `admission` | trigger `create_admission_event` copia `new.joined_on` al insertar el socio (`20260925120200_members.sql` ~202) | se actualiza (es la ficha de ingreso; `dashboard_summary` cuenta altas del mes por esta fecha) |
| `member_categories.joined_on` | `set_member_categories(id, ids, effective_on = joinedOn)` desde `createMember`; también una inscripción posterior cargada "a partir de" la misma fecha | se actualizan **todas** las filas del socio con `joined_on = fecha vieja` |
| `members.status_changed_on` | null al alta; la escriben baja/reactivación | nada |
| `audit_log.new_data` del INSERT | foto del alta | nada, a propósito: es la historia |
| `fees`, `payments`, `medical_clearances`, `family_groups` | no copian la fecha | nada |
| Seeds (`seed.sql`, `seed-demo.sql`) | copian `joined_on` a `member_categories` igual que la app | nada: datos de prueba, pasan por los mismos triggers |

**Quién lee `joined_on` (no lo copia).** `monthly_fee_targets`
(`20260927130000_billing.sql` ~300: `m.joined_on <= p_end`, `mc.joined_on <=
p_end`), `dashboard_summary` (~542, meses sin generar), `monthly_history`
(~696). Los guards `validate_member_status_event` (eventos no anteriores al
alta) y `member_categories_insert_guard` (inscripción no anterior al alta)
leen `members.joined_on` con `FOR UPDATE` sobre el socio.

**Cómo genera cuotas el sistema — y por qué importa.** `private.generate_pending_fees`
recorre **todos** los períodos desde `billing_start_period` hasta el mes actual
en cada corrida (cron del 1° y "Generar cuotas ahora"), y `generate_monthly_fees(p)`
es idempotente por el índice único. Consecuencia que la consigna original
daba por falsa: **si la fecha de alta se mueve a un mes anterior, la próxima
corrida genera las cuotas de los meses intermedios** (si son ≥
`billing_start_period`). Es exactamente lo que pasa hoy con un alta cargada
con fecha pasada. No es un bug; es una consecuencia que el plan tiene que
decidir y la UI tiene que decir. Lo anterior a `billing_start_period` sigue
siendo saldo de arranque, como dice CLAUDE.md.

**Inmutabilidades vigentes que la operación tiene que atravesar.**

- `members_immutable` (`joined_on` en la lista) y sin grant de UPDATE sobre la columna.
- `member_categories_immutable` (`joined_on` en la lista), grant de UPDATE solo
  sobre `left_on, left_reason`, y `member_categories_update_guard` que asume
  que todo UPDATE es un cierre ("Para cerrar una inscripción hace falta la fecha").
- `member_status_events_no_change`: `forbid_change()` en UPDATE **y** DELETE,
  sin grant de UPDATE para nadie.

**Tests existentes que fijan comportamiento.** `tests/db/members.test.ts`
(253–300): UPDATE directo de `joined_on` → `permission denied` para admin y
editor; como `postgres` → `/no se puede modificar/`. `tests/db/member-categories.test.ts`
(273–313 y ~338): lo mismo para `member_categories.joined_on` y
`/no se modifican ni se borran/` para `member_status_events`. **El diseño
conserva esas tres garantías fuera de la RPC** y reutiliza los mismos textos
de error para que esos tests sigan verdes.

**UI hoy.** `src/views/members/member-form.tsx` es el mismo formulario para
alta y edición; en edición muestra "Alta: dd/mm/aaaa · Estado: …" como texto y
el panel "Fecha de alta" solo en `mode === 'create'`. La action
`updateMember(id, input)` (`members.actions.ts`) valida con
`updateMemberSchema` (`.strict()`, sin `joinedOn`) y llama al modelo. El brief
`.impeccable/surfaces/route-socios-nuevo.md` dice: *"En edición, `joined_on`
y estado no se editan"* — hay que actualizarlo.

## 4. Pushback

1. **La consigna asumía "no se generan cuotas retroactivas"; el código dice lo
   contrario.** Con el generador actual, mover la fecha a un mes anterior
   produce cuotas para esos meses en la próxima corrida. Bloquearlo dejaría la
   fecha institucional mal para siempre (no hay DELETE ni re-alta con el mismo
   DNI). Recomiendo **permitirlo, con la consecuencia dicha en el formulario**;
   dejo un bloque opcional en la RPC para bloquearlo si Tomás prefiere la
   lectura estricta (pregunta P1).
2. **El chequeo de pagos es semántico, no de consistencia derivada.** Ningún
   agregado se rompe con un pago anterior al alta (`member_balance` suma sin
   mirar fechas; `monthly_history` ya filtra por `joined_on`). Y es un caso
   real: el chico paga en la sede el 10 y la ficha se carga el 15. Lo incluyo
   porque Tomás lo pidió explícitamente; es una sola condición y se puede
   quitar sin tocar nada más (pregunta P2).
3. **"Todas las filas de `member_categories` con la fecha vieja" incluye las
   que se agregaron después, a propósito, con esa misma fecha.** Es lo que
   Tomás pidió y es lo correcto en el 99 % de los casos (quien inscribe "a
   partir de" la fecha de alta quiere decir "desde que entró"). Queda dicho.
4. **La corrección y el guardado del resto de la ficha no son una sola
   transacción** (dos llamadas a PostgREST, como el alta de hoy). Se mitiga
   llamando a la RPC **primero**: si la base la rechaza, no se guardó nada y
   el error aparece debajo del campo; si pasa y falla el UPDATE siguiente,
   la fecha ya quedó bien y el reintento es idempotente (la RPC no hace nada
   si la fecha es la misma).

Por lo demás el pedido es sano: es una corrección acotada, con reglas claras
y una sola puerta.

## 5. Opciones

### 5.1 Dónde vive la escritura

| | O1 — grant por columna + trigger validador + cascada en trigger | **O2 — RPC `SECURITY DEFINER`, columna sin grant (recomendada)** | O3 — diálogo propio "Corregir fecha de alta" con action aparte |
|---|---|---|---|
| Puerta | cualquier `UPDATE members set joined_on` de admin/editor (UI o PostgREST directo) | solo `correct_member_joined_on(id, fecha)` | igual que O2, pero desde un modal en la ficha |
| Validación + cascada | repartidas en triggers de tres tablas | en una función legible, con `FOR UPDATE` del socio | igual que O2 |
| Tests existentes de "sin grant" | se rompen (hay que reescribirlos) | siguen verdes | siguen verdes |
| Modelo TS | `joined_on` en el mismo `.update()` | `rpc()` + `.update()` | `rpc()` |
| UX | el campo vive en el formulario de edición | el campo vive en el formulario de edición | un modal para editar un campo: "modal as first thought" (`operate.md`), y Tomás lo definió como corrección de carga, no operación |
| Veredicto | abre una columna que hoy está cerrada y desparrama la lógica | **una sola puerta, el patrón de `members.status`** ("sin grant de UPDATE para nadie: esta es la única puerta") | descartada por UX y por el encuadre del pedido |

### 5.2 Qué se rechaza

| Caso | R-simple: "sin cuotas mensuales del socio" | R-conjunto: "el conjunto de períodos facturables no cambia" | **R-datos: "nada existente queda antes de la fecha nueva" (recomendada)** |
|---|---|---|---|
| A. mismo mes, sin cuotas | permite | permite | permite |
| B. mismo mes, cuota del mes ya generada (la Comisión toca "Generar cuotas" después de cada alta) | **rechaza sin motivo** | permite | permite |
| C. mes anterior, sin cuotas (alta de hoy con mes equivocado, se corrige el mismo día) | permite | **rechaza aunque no haya nada que perturbar** | permite (la próxima corrida genera los meses) |
| D. mes anterior, con cuota del mes actual | rechaza | rechaza | permite (ídem C); bloque opcional para rechazar |
| E. mes posterior, con cuota de un mes anterior | rechaza | rechaza | rechaza: "Ya hay cuotas generadas desde MM/AAAA" |
| F. mes posterior, sin cuotas | permite | rechaza | permite |
| G. carga histórica (socio de 2019 cargado con fecha de hoy) corregida después de generar cuotas | **rechaza: la fecha queda mal para siempre** | permite | permite |

R-simple falla en B y G, los dos casos más probables. R-conjunto falla en C y
F, donde no existe nada que perturbar. **R-datos** es la traducción literal de
"la base rechaza si la fecha nueva haría inconsistente algo que ya existe":
hacia atrás siempre pasa (todo lo existente ya es ≥ la fecha vieja), hacia
adelante la frena el primer registro que quedaría antes.

### 5.3 Motivo obligatorio

No. Tomás lo definió como corrección de carga. La fila de auditoría del
UPDATE ya tiene actor, valor viejo y nuevo. Guardar un motivo exigiría un
lugar (una columna, o un GUC `app.audit_context` leído por `audit_row_change`
hacia `audit_log.context`) y agrega fricción al caso típico "me equivoqué de
día". Si algún día hace falta, el GUC hacia `context` son tres líneas en el
trigger de auditoría y un parámetro más en la RPC; nada de este diseño lo
impide.

## 6. Arquitectura recomendada

### 6.1 Postgres (migración, hilo principal)

Una función pública `correct_member_joined_on(target_member_id bigint,
new_joined_on date)`, `SECURITY DEFINER`, única puerta. Las tres columnas que
copian la fecha siguen **sin grant de UPDATE** y con guards que solo las dejan
cambiar mientras un GUC local a la transacción (`lonqui.joined_on_correction`
= id del socio) lo diga; ese GUC lo setea y lo limpia la propia función.
Nadie lo puede setear desde PostgREST (`set_config` no está expuesto, y sin
grant de columna el UPDATE muere antes de llegar al trigger).

Orden dentro de la RPC:

1. `private.can('members.write')` o `insufficient_privilege` ("No tenés permiso para modificar socios").
2. `SELECT … FOR UPDATE` del socio: serializa con otra corrección, con una
   baja/reactivación (`validate_member_status_event`) y con una inscripción
   (`member_categories_insert_guard`), que también bloquean la fila.
   Inexistente → `no_data_found` ("El socio no existe").
3. Fecha igual → `return` silencioso (nada que auditar; el formulario la manda siempre).
4. Rechazos, cada uno `check_violation` con mensaje para el usuario:
   - futura → "La fecha de alta no puede ser futura";
   - anterior a `birth_date` → "La fecha de alta no puede ser anterior a la fecha de nacimiento";
   - baja o reactivación con `effective_on <` nueva → "La fecha de alta no puede ser posterior a la baja o reactivación del DD/MM/AAAA";
   - inscripción con **otra** fecha y `joined_on <` nueva → "El socio está inscripto en Disciplina (Categoría) desde el DD/MM/AAAA: la fecha de alta no puede ser posterior";
   - inscripción de la carga inicial (misma fecha vieja, se arrastra) **cerrada** con `left_on <` nueva → "El socio estuvo inscripto en … hasta el DD/MM/AAAA: la fecha de alta no puede ser posterior" (sin esto saltaría el CHECK `left_after_joined` con mensaje crudo);
   - cuota `monthly` no anulada con `period < date_trunc('month', nueva)` → "Ya hay cuotas generadas desde MM/AAAA: la fecha de alta no puede quedar después de ese mes. Si no corresponden, un administrador puede anularlas" (las anuladas y los saldos de arranque no cuentan: una cuota es del socio desde el mes de su alta, `joined_on <= p_end`);
   - pago no anulado con `paid_on <` nueva → "Hay un pago registrado el DD/MM/AAAA, anterior a la fecha nueva: la fecha de alta no puede quedar después".
5. `set_config('lonqui.joined_on_correction', id, true)`; UPDATE de
   `members.joined_on`; UPDATE de `effective_on` de la fila `admission`;
   UPDATE de `member_categories.joined_on` donde `joined_on = fecha vieja`;
   `set_config(…, '', true)`.

Auditoría: los tres UPDATE pasan por `audit_row_change` con `auth.uid()` de la
sesión (los claims del JWT son del request, no del rol de ejecución; es el
mismo mecanismo que hoy audita el UPDATE de `members.status` desde el trigger
`SECURITY DEFINER`). Quedan: `members` (`changed_fields = {joined_on}`),
`member_status_events` (`{effective_on}`) y una fila por inscripción
arrastrada (`{joined_on}`), todas con `actor_source = 'session'`.

Guards nuevos / modificados (mismos textos de error que hoy, para no romper
tests):

- `members_immutable` se recrea sin `joined_on`; nuevo `members_joined_on_guard`
  (`before update of joined_on … when (old is distinct from new)`): fuera de
  la corrección → "La columna joined_on no se puede modificar".
- `member_categories_immutable` se recrea sin `joined_on`;
  `member_categories_update_guard` gana un prólogo: si cambia `joined_on`,
  solo pasa dentro de la corrección y si **no cambió nada más**; si no →
  "La columna joined_on no se puede modificar". El cuerpo del cierre queda
  igual. `sync_member_type` (AFTER UPDATE) corre en la cascada sin efecto.
- `member_status_events_no_change` pasa a **solo DELETE**; nuevo
  `member_status_events_update_guard` (BEFORE UPDATE): solo la fila
  `admission`, solo `effective_on`, solo dentro de la corrección; si no →
  "Los registros de member_status_events no se modifican ni se borran".

Carrera residual aceptada: una cuota o un pago insertados **en el mismo
instante** que la corrección (ni `fees` ni `payments` bloquean la fila del
socio). La ventana es de milisegundos y el peor caso es una cuota anterior al
alta que un admin anula con motivo.

### 6.2 TypeScript

- **Modelo** (`src/models/members.model.ts`): `updateMemberSchema` acepta
  `joinedOn?: ISODate` (Zod `z.iso.date`, no futura, igual que el alta).
  Nueva `correctMemberJoinedOn(id, joinedOn)` → `supabase.rpc('correct_member_joined_on')`
  con el cliente de sesión, traduciendo: `42501` → `DomainError('No tenés
  permiso para modificar socios')` (patrón de `translateSetCategoriesError`),
  `no_data_found`/`P0002` → `DomainError('El socio no existe', { status: 404 })`,
  `23514` con mensaje de la RPC → `DomainError(error.message, { field:
  'joinedOn' })` (el mensaje ya está redactado para el usuario; `pg-errors.ts →
  isRawPostgresMessage` sigue siendo la red para lo crudo).
  `updateMember` (el `.update()`) **no manda `joined_on` nunca**: no hay grant
  y fallaría con `permission denied`.
- **Action** (`src/controllers/members.actions.ts → updateMember`): el
  controller orquesta —es lo que justifica que exista—: `requireRole('admin',
  'editor')` como hoy (la RPC chequea el permiso en la base; cuando el
  pipeline de roles migre las reglas del slice 1, este guard pasa a
  `requirePermission('members.write')` junto con las demás) → `safeParse` →
  **si vino `joinedOn`, primero `correctMemberJoinedOn`** → después
  `updateMemberRow` con el resto → `revalidatePath('/socios')`,
  `revalidatePath('/socios/${id}')` y `revalidatePath('/')` (el panel inicial
  cuenta altas del mes por `effective_on`).
- **Vista** (`src/views/members/member-form.tsx`): el panel "Fecha de alta"
  se muestra también en edición, precargado con `member.joinedOn`, `max` hoy,
  con la misma validación que en alta (no vacía, válida, no futura). Una
  descripción corta debajo del campo y, cuando el mes elegido es anterior al
  mes guardado, una nota de consecuencia. En `onValid` (edición), `joinedOn`
  viaja dentro del mismo `updateMember`. Sin modal, sin motivo.
- `src/models/types.ts`: **sin cambios** (no hay concepto nuevo; `UpdateMemberInput` se infiere del schema).

### 6.3 SQL propuesto completo (lo escribe el hilo principal)

Archivo: `supabase/migrations/20261015120000_member_joined_on_correction.sql`.

```sql
-- =============================================================================
-- 0013 — Corrección de la fecha de alta de un socio.
--
-- Pipeline: docs/pipelines/2026-10-15-editar-fecha-ingreso/.
--
-- Decisión de Tomás (2026-10-15): la fecha de alta deja de ser inmutable, pero
-- se corrige SOLO por correct_member_joined_on, que:
--   - exige members.write (permiso, no rol);
--   - rechaza la fecha nueva si quedara después de algo que ya existe (baja o
--     reactivación, inscripción posterior o cerrada, cuota mensual no anulada,
--     pago no anulado) o fuera de lo razonable (futura, anterior al nacimiento);
--   - arrastra TODO lo que copió esa fecha al dar de alta: la ficha de ingreso
--     (member_status_events 'admission') y las inscripciones de
--     member_categories con joined_on = fecha vieja. Lo inscripto después, con
--     otra fecha, no se toca.
-- Es una corrección de carga, no una operación de negocio: sin motivo, sin
-- evento aparte. La auditoría de los tres UPDATE (actor, valor viejo y nuevo)
-- es el rastro.
--
-- Fuera de esa función las tres columnas siguen inmutables: los guards miran
-- un GUC local a la transacción (lonqui.joined_on_correction = id del socio)
-- que solo la función setea. Nadie lo setea desde PostgREST: set_config no
-- está expuesto y, además, ninguna de las tres columnas tiene grant de UPDATE.
--
-- Reversa: drop de public.correct_member_joined_on, de los triggers
-- members_joined_on_guard y member_status_events_update_guard y sus funciones;
-- recrear members_immutable y member_categories_immutable con 'joined_on';
-- recrear member_status_events_no_change como "before update or delete";
-- restaurar member_categories_update_guard de 20260927125000.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- members.joined_on: sale de protect_immutable_columns y pasa a un guard propio.
-- -----------------------------------------------------------------------------
drop trigger members_immutable on public.members;
create trigger members_immutable
  before update on public.members
  for each row execute function private.protect_immutable_columns('id', 'created_at', 'created_by');

create function private.members_joined_on_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(current_setting('lonqui.joined_on_correction', true), '') is distinct from old.id::text then
    -- Mismo texto que protect_immutable_columns: tests/db/members.test.ts lo busca.
    raise exception 'La columna joined_on no se puede modificar' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger members_joined_on_guard
  before update of joined_on on public.members
  for each row
  when (old.joined_on is distinct from new.joined_on)
  execute function private.members_joined_on_guard();

comment on column public.members.joined_on is
  'Fecha de alta. Sin grant de UPDATE: se corrige solo con correct_member_joined_on, que la arrastra a la ficha de ingreso y a las inscripciones cargadas con ella.';

-- -----------------------------------------------------------------------------
-- member_categories.joined_on: ídem. El guard de cierre gana un prólogo.
-- -----------------------------------------------------------------------------
drop trigger member_categories_immutable on public.member_categories;
create trigger member_categories_immutable
  before update on public.member_categories
  for each row execute function private.protect_immutable_columns(
    'id', 'member_id', 'category_id', 'created_by', 'created_at'
  );

create or replace function private.member_categories_update_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Corrección de la fecha de alta: correct_member_joined_on la arrastra a las
  -- inscripciones cargadas con esa fecha. Solo joined_on, solo ese socio, y
  -- nada más puede cambiar en la misma sentencia.
  if new.joined_on is distinct from old.joined_on then
    if nullif(current_setting('lonqui.joined_on_correction', true), '') is distinct from old.member_id::text
       or (to_jsonb(new) - 'joined_on') <> (to_jsonb(old) - 'joined_on') then
      -- Mismo texto que protect_immutable_columns: tests/db/member-categories.test.ts lo busca.
      raise exception 'La columna joined_on no se puede modificar' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Cuerpo original (20260927125000): lo único que cambia de una inscripción
  -- es su cierre, una vez, sin fecha futura. El actor lo pone la base.
  if old.left_on is not null then
    raise exception 'Esta inscripción ya está cerrada' using errcode = 'check_violation';
  end if;
  if new.left_on is null then
    raise exception 'Para cerrar una inscripción hace falta la fecha' using errcode = 'check_violation';
  end if;
  if new.left_on > private.club_today() then
    raise exception 'La fecha no puede ser futura' using errcode = 'check_violation';
  end if;

  new.left_reason := nullif(btrim(new.left_reason), '');
  new.left_by := auth.uid();
  new.left_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- member_status_events: DELETE sigue prohibido para todos; UPDATE solo de
-- effective_on de la ficha de ingreso, dentro de la corrección.
-- -----------------------------------------------------------------------------
drop trigger member_status_events_no_change on public.member_status_events;
create trigger member_status_events_no_change
  before delete on public.member_status_events
  for each row execute function private.forbid_change();

create function private.member_status_events_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.event_type <> 'admission'
     or nullif(current_setting('lonqui.joined_on_correction', true), '') is distinct from old.member_id::text
     or (to_jsonb(new) - 'effective_on') <> (to_jsonb(old) - 'effective_on') then
    -- Mismo texto que forbid_change: tests/db/member-categories.test.ts lo busca.
    raise exception 'Los registros de member_status_events no se modifican ni se borran'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger member_status_events_update_guard
  before update on public.member_status_events
  for each row execute function private.member_status_events_update_guard();

-- -----------------------------------------------------------------------------
-- La única puerta. En public porque se llama por RPC; el revoke y el chequeo
-- del cuerpo son la cerradura (mismo patrón que generate_pending_fees()).
-- -----------------------------------------------------------------------------
create function public.correct_member_joined_on(target_member_id bigint, new_joined_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  conflict_date date;
  conflict_label text;
  conflict_kind text;
  first_fee date;
begin
  if not private.can('members.write') then
    raise exception 'No tenés permiso para modificar socios' using errcode = 'insufficient_privilege';
  end if;

  -- Bloquea al socio: serializa con otra corrección, con una baja/reactivación
  -- (validate_member_status_event) y con una inscripción
  -- (member_categories_insert_guard), que también toman FOR UPDATE.
  select id, joined_on, birth_date into m
  from public.members
  where id = target_member_id
  for update;

  if not found then
    raise exception 'El socio no existe' using errcode = 'no_data_found';
  end if;

  -- El formulario manda la fecha siempre: igual no es corrección ni se audita.
  if new_joined_on = m.joined_on then
    return;
  end if;

  if new_joined_on > private.club_today() then
    raise exception 'La fecha de alta no puede ser futura' using errcode = 'check_violation';
  end if;
  if m.birth_date is not null and new_joined_on < m.birth_date then
    raise exception 'La fecha de alta no puede ser anterior a la fecha de nacimiento' using errcode = 'check_violation';
  end if;

  -- Hacia atrás todo lo existente ya es >= la fecha vieja: los chequeos de
  -- abajo solo frenan movimientos hacia adelante.

  select min(e.effective_on) into conflict_date
  from public.member_status_events e
  where e.member_id = target_member_id
    and e.event_type <> 'admission'
    and e.effective_on < new_joined_on;
  if conflict_date is not null then
    raise exception 'La fecha de alta no puede ser posterior a la baja o reactivación del %',
      to_char(conflict_date, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;

  -- Inscripciones: las de otra fecha no se tocan y no pueden quedar antes del
  -- alta; las de la fecha vieja se arrastran y, si están cerradas, su cierre
  -- no puede quedar antes del alta (si no saltaría el CHECK left_after_joined
  -- con un mensaje crudo).
  select d.name || ' (' || c.name || ')',
         case when mc.joined_on = m.joined_on then 'closed' else 'later' end,
         case when mc.joined_on = m.joined_on then mc.left_on else mc.joined_on end
  into conflict_label, conflict_kind, conflict_date
  from public.member_categories mc
  join public.categories c on c.id = mc.category_id
  join public.disciplines d on d.id = c.discipline_id
  where mc.member_id = target_member_id
    and (
      (mc.joined_on <> m.joined_on and mc.joined_on < new_joined_on)
      or (mc.joined_on = m.joined_on and mc.left_on is not null and mc.left_on < new_joined_on)
    )
  order by 3
  limit 1;
  if conflict_kind = 'later' then
    raise exception 'El socio está inscripto en % desde el %: la fecha de alta no puede ser posterior',
      conflict_label, to_char(conflict_date, 'DD/MM/YYYY') using errcode = 'check_violation';
  elsif conflict_kind = 'closed' then
    raise exception 'El socio estuvo inscripto en % hasta el %: la fecha de alta no puede ser posterior',
      conflict_label, to_char(conflict_date, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;

  -- Una cuota mensual es del socio desde el mes de su alta (joined_on <= fin
  -- del período): una no anulada en un mes anterior al nuevo quedaría antes
  -- de ser socio. Las anuladas y los saldos de arranque no cuentan.
  select min(f.period) into first_fee
  from public.fees f
  where f.member_id = target_member_id
    and f.kind = 'monthly'
    and f.voided_at is null
    and f.period < date_trunc('month', new_joined_on)::date;
  if first_fee is not null then
    raise exception 'Ya hay cuotas generadas desde %: la fecha de alta no puede quedar después de ese mes. Si no corresponden, un administrador puede anularlas',
      to_char(first_fee, 'MM/YYYY') using errcode = 'check_violation';
  end if;

  select min(p.paid_on) into conflict_date
  from public.payments p
  where p.member_id = target_member_id
    and p.voided_at is null
    and p.paid_on < new_joined_on;
  if conflict_date is not null then
    raise exception 'Hay un pago registrado el %, anterior a la fecha nueva: la fecha de alta no puede quedar después',
      to_char(conflict_date, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;

  -- OPCIONAL (pregunta P1 del plan, apagado por defecto): rechazar también el
  -- movimiento a un mes anterior cuando el club ya generó las cuotas de esos
  -- meses, para que una corrección nunca agregue cuotas a un mes cerrado.
  -- if exists (
  --   select 1 from public.fees f, public.settings s
  --   where s.id = 1 and f.kind = 'monthly'
  --     and f.period >= greatest(date_trunc('month', new_joined_on)::date, s.billing_start_period)
  --     and f.period <  greatest(date_trunc('month', m.joined_on)::date, s.billing_start_period)
  -- ) then
  --   raise exception 'Las cuotas de los meses anteriores ya se generaron: la fecha de alta no puede moverse a un mes anterior'
  --     using errcode = 'check_violation';
  -- end if;

  -- La llave para los tres guards, solo mientras dura esta operación.
  perform set_config('lonqui.joined_on_correction', target_member_id::text, true);

  update public.members
  set joined_on = new_joined_on
  where id = target_member_id;

  update public.member_status_events
  set effective_on = new_joined_on
  where member_id = target_member_id
    and event_type = 'admission';

  update public.member_categories
  set joined_on = new_joined_on
  where member_id = target_member_id
    and joined_on = m.joined_on;

  perform set_config('lonqui.joined_on_correction', '', true);
end;
$$;

revoke execute on function public.correct_member_joined_on(bigint, date) from public, anon;
grant execute on function public.correct_member_joined_on(bigint, date) to authenticated;

-- -----------------------------------------------------------------------------
-- EXECUTE de PUBLIC sobre las funciones nuevas de private: no se revoca por
-- schema, se cierra a mano (CLAUDE.md). Son funciones de trigger: no
-- necesitan grant (Postgres no chequea EXECUTE al dispararlas), igual que
-- member_categories_update_guard hoy.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;
```

Después de aplicar: `npm run db:reset` y `npm run db:types` (la RPC nueva
tiene que estar en `database.types.ts` para que `rpc('correct_member_joined_on')`
tipee).

### 6.4 Texto propuesto para CLAUDE.md (lo aplica el hilo principal)

Reemplazar, en "Lo que se agrega en Postgres, no en TypeScript":

> - Columnas inmutables (monto de un pago, período de un cargo, fecha de alta).

por:

> - Columnas inmutables (monto de un pago, período de un cargo). **La fecha
>   de alta se corrige, no se edita**: solo por `correct_member_joined_on`
>   (2026-10-15), que exige `members.write`, arrastra la ficha de ingreso y
>   las inscripciones cargadas con esa fecha, y rechaza la fecha nueva si
>   quedara después de una baja, una inscripción, una cuota o un pago del
>   socio. Fuera de esa función `joined_on` sigue sin grant y con trigger.
>   Mover la fecha a un mes anterior hace que la próxima corrida genere las
>   cuotas de esos meses, igual que un alta con fecha pasada.

## 7. Transversales

- **Permiso**: `members.write` (editor y admin), en la base. Coherente con
  que un editor ya puede dar de alta con fecha pasada —y generar meses— hoy;
  prohibirle corregir su propio error sería incoherente. Mover la fecha a
  después de una cuota exige anularla antes (`payments.void`, admin): la
  separación de poderes queda donde ya estaba.
- **Auditoría**: tres tablas, actor de sesión, valores viejo y nuevo. Sin
  motivo (decisión). El detalle de `/auditoria` necesita la etiqueta
  `members.joined_on → 'fecha de alta'` en `audit-labels.ts` (hoy falta).
- **Nada se borra**: cero DELETE; los guards de DELETE quedan como estaban.
- **Cuotas**: ninguna cuota existente cambia (montos y períodos congelados).
  Hacia atrás, la próxima corrida completa meses; hacia adelante, se exige
  anular primero. `period` se compara por mes (`date_trunc`), nunca por día.
- **Zona horaria**: "no futura" usa `private.club_today()`; el `max` del
  campo usa `toClubDate()`.
- **Datos personales**: la RPC no loguea ni devuelve nada; los mensajes nombran
  categorías y fechas, nunca al socio.
- **Fallas**: todo error de la RPC llega como `DomainError` con `field:
  'joinedOn'` y se muestra debajo del campo; lo no previsto cae en el genérico.
- **Migración**: solo `create`/`drop trigger`, `create or replace` de una
  función existente y una función nueva; sin cambios de datos; reversa
  documentada en el encabezado.
- **Cache**: `revalidatePath` de `/socios`, `/socios/[id]` y `/`.

## 8. Preguntas abiertas

**Para Tomás (usuario):**

- **P1.** Mover la fecha a un **mes anterior** con facturación activa hace que
  la próxima corrida genere las cuotas de esos meses (igual que un alta con
  fecha pasada). Recomiendo permitirlo y decirlo en el formulario. Si preferís
  que una corrección nunca agregue cuotas a un mes ya generado para el club,
  se prende el bloque "OPCIONAL" de la RPC (una condición; el resto no cambia).
- **P2.** El rechazo por **pago anterior a la fecha nueva** bloquea el caso
  "pagó en la sede el 10, la ficha se cargó el 15, la fecha real es el 15".
  Lo dejo porque lo pediste; se quita borrando una condición.

**Para la Comisión:** ninguna. Es una corrección de carga dentro del alcance
acordado; no cambia ninguna política.

---

**Plan listo para aprobación.** Opción recomendada: O2 (RPC única puerta) con
la regla R-datos (rechazar solo lo que quedaría antes de la fecha nueva), sin
motivo, cascada a la ficha de ingreso y a las inscripciones cargadas con la
fecha vieja, campo editable en el formulario de edición existente. Slices en
`01-tasks.md`.

## 9. Respuestas de Tomás (2026-10-15) y lo que aplicó el hilo principal

- **P1:** se permite mover a un mes anterior aunque la próxima corrida genere
  esas cuotas; el formulario lo avisa. El bloque OPCIONAL no va en la migración.
- **P2:** un pago anterior a la fecha nueva **no** bloquea. Se sacó ese chequeo
  de la RPC (y su mensaje). La deuda sale de las cuotas, que sí bloquean.
- La migración quedó en `20261015120100_member_joined_on_correction.sql` (el
  `20261015120000` ya lo usa `fee_prices_correction`). Aplicada en local con
  `supabase migration up`, `database.types.ts` regenerado, CLAUDE.md
  actualizado (§6.4 sin la mención a pagos). Smoke test en transacción
  revertida: cascada (members + admission + inscripción inicial, la posterior
  intacta), rechazos con mensaje, UPDATE directo bloqueado, 3 filas de
  auditoría con actor.
