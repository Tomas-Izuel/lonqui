-- =============================================================================
-- 0005 — Facturación: valores de cuota, cargos, generación mensual, registro
-- de corridas y activación.
--
-- Pipeline: docs/pipelines/2026-09-27-cuotas-pagos-panel/ (S1, §13.3–13.4).
-- Los permisos (private.can) y member_categories vienen de 0004b.
--
-- Una cuota por socio, por período y por DEPORTE (disciplina), con la
-- categoría congelada en el cargo; o una sola cuota social si no practica
-- ninguno. Nunca las dos en el mismo período (D30).
--
-- Reversa: `cron.unschedule` de los dos jobs; drop de fees, billing_runs,
-- fee_prices y de las funciones de este archivo; drop del trigger de
-- settings. No hay datos del slice 1 que se transformen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- pg_cron
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- -----------------------------------------------------------------------------
-- fee_prices: valores de cuota, append-only
-- -----------------------------------------------------------------------------
create table public.fee_prices (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('default', 'member_type', 'category')),
  member_type text check (member_type in ('practicing', 'non_practicing')),
  category_id bigint references public.categories (id) on delete restrict,
  amount_cents bigint not null check (amount_cents >= 0),
  valid_from date not null check (valid_from = date_trunc('month', valid_from)::date),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),

  constraint fee_prices_scope_shape check (
    (scope = 'default' and member_type is null and category_id is null)
    or (scope = 'member_type' and member_type is not null and category_id is null)
    or (scope = 'category' and category_id is not null and member_type is null)
  )
);

comment on table public.fee_prices is
  'Valores de cuota. Append-only: cambiar un valor es insertar una fila nueva con valid_from = el mes desde el que aplica.';

create unique index fee_prices_unique_target
  on public.fee_prices (scope, coalesce(member_type, ''), coalesce(category_id, 0), valid_from);
create index fee_prices_category_id_idx on public.fee_prices (category_id);

create trigger fee_prices_no_change
  before update or delete on public.fee_prices
  for each row execute function private.forbid_change();

-- -----------------------------------------------------------------------------
-- fees: cargos (cuotas mensuales, saldo de arranque, ajustes)
-- -----------------------------------------------------------------------------
create table public.fees (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members (id) on delete restrict,
  period date not null check (period = date_trunc('month', period)::date),
  -- 'adjustment' queda en el CHECK para el futuro: ninguna policy lo permite hoy.
  kind text not null check (kind in ('monthly', 'opening_balance', 'adjustment')),
  amount_cents bigint not null check (amount_cents >= 0),
  description text,
  -- Trazabilidad del monto congelado. Solo en 'monthly'.
  fee_price_id bigint references public.fee_prices (id) on delete restrict,
  -- Cuota por deporte: la categoría y su disciplina, congeladas al generar
  -- (si mañana la categoría cambia de disciplina, el cargo viejo no se
  -- mueve). Ambas null en la cuota social y en lo que no es 'monthly'.
  category_id bigint references public.categories (id) on delete restrict,
  discipline_id bigint references public.disciplines (id) on delete restrict,
  -- Null = generación automática o seed.
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,

  constraint fees_category_shape check (
    (kind = 'monthly' and (category_id is null) = (discipline_id is null))
    or (kind <> 'monthly' and category_id is null and discipline_id is null)
  ),
  constraint fees_void_triad check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null
        and length(btrim(void_reason)) >= 3)
  )
);

-- La idempotencia de la generación: una cuota por socio, período y deporte.
-- `nulls not distinct`: dos cuotas sociales (discipline_id null) del mismo mes
-- chocan. Por deporte y no por categoría: el ascenso de 5ta a 6ta a mitad de
-- mes no cobra dos veces fútbol (T21). Incluye las ANULADAS a propósito:
-- anular una cuota es definitivo y el cron nunca la vuelve a crear (T4).
create unique index fees_one_monthly_per_period
  on public.fees (member_id, period, discipline_id) nulls not distinct where kind = 'monthly';
-- Un saldo de arranque vigente por socio. Si se cargó mal, se anula y se carga otro.
create unique index fees_one_opening_balance
  on public.fees (member_id) where kind = 'opening_balance' and voided_at is null;
create index fees_period_idx on public.fees (period);
create index fees_member_period_idx on public.fees (member_id, period);
create index fees_category_id_idx on public.fees (category_id);
create index fees_discipline_id_idx on public.fees (discipline_id);
create index fees_fee_price_id_idx on public.fees (fee_price_id);

create trigger fees_immutable
  before update on public.fees
  for each row execute function private.protect_immutable_columns(
    'id', 'member_id', 'period', 'kind', 'amount_cents', 'fee_price_id', 'category_id', 'discipline_id',
    'created_by', 'created_at'
  );

-- Lo único que se actualiza de un cargo es su anulación: una vez, con motivo,
-- y solo con payments.void. El actor lo pone la base.
create function private.fees_void_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'Este cargo ya está anulado' using errcode = 'check_violation';
  end if;
  if new.void_reason is null then
    raise exception 'Para anular un cargo hace falta un motivo' using errcode = 'check_violation';
  end if;
  if not private.can('payments.void') then
    raise exception 'No tenés permiso para anular cargos' using errcode = 'insufficient_privilege';
  end if;
  new.voided_by := auth.uid();
  new.voided_at := now();
  return new;
end;
$$;

create trigger fees_void_guard
  before update on public.fees
  for each row execute function private.fees_void_guard();

-- El saldo de arranque es la deuda previa al sistema: su período lo fija la
-- base (el mes anterior al inicio de la facturación), no quien lo carga.
create function private.fees_opening_balance_guard()
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

  new.period := (start_period - interval '1 month')::date;
  new.description := coalesce(nullif(btrim(new.description), ''), 'Saldo anterior al sistema');
  new.fee_price_id := null;
  new.category_id := null;
  new.discipline_id := null;
  return new;
end;
$$;

create trigger fees_opening_balance_guard
  before insert on public.fees
  for each row execute function private.fees_opening_balance_guard();

-- -----------------------------------------------------------------------------
-- Guard de fee_prices (necesita fees, por eso va después)
-- -----------------------------------------------------------------------------
create function private.fee_prices_insert_guard()
returns trigger
language plpgsql
-- DEFINER: la invariante no depende de la RLS de quien escribe (review B4).
security definer
set search_path = ''
as $$
begin
  -- El pasado ya está congelado en fees: un valor nuevo aplica desde este mes.
  if new.valid_from < date_trunc('month', private.club_today())::date then
    raise exception 'Un valor de cuota nuevo aplica desde este mes o uno futuro'
      using errcode = 'check_violation';
  end if;

  -- T6: si el mes ya se generó, el valor nuevo dejaría socios del mismo mes
  -- con montos distintos sin que nadie lo decida.
  if exists (
    select 1 from public.fees
    where kind = 'monthly' and period = new.valid_from
  ) then
    raise exception 'Las cuotas de % ya se generaron con otro valor; el nuevo aplica desde %',
      to_char(new.valid_from, 'MM/YYYY'),
      to_char((new.valid_from + interval '1 month')::date, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger fee_prices_insert_guard
  before insert on public.fee_prices
  for each row execute function private.fee_prices_insert_guard();

-- Precio de un socio para un período: categoría > tipo de socio > default,
-- y dentro de cada uno el de mayor valid_from <= período.
create function private.fee_price_for(p_category_id bigint, p_member_type text, p_period date)
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
    fp.valid_from desc
  limit 1;
$$;

revoke execute on function private.fee_price_for(bigint, text, date) from public, anon;
grant execute on function private.fee_price_for(bigint, text, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- billing_runs: registro de corridas de la generación (T1)
--
-- Tabla técnica, no auditada: el efecto de dominio de cada corrida (las filas
-- de fees) ya entra en audit_log con su actor; duplicarlo sería ruido. Es
-- append-only y guarda su propio actor.
-- -----------------------------------------------------------------------------
create table public.billing_runs (
  id bigint generated always as identity primary key,
  period date not null check (period = date_trunc('month', period)::date),
  trigger text not null check (trigger in ('cron', 'manual')),
  actor_id uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('ok', 'error', 'skipped')),
  fees_created integer not null default 0,
  -- El mensaje de Postgres. Nunca nombres ni DNI: el generador no los incluye.
  error_message text,
  notified_at timestamptz
);

comment on column public.billing_runs.notified_at is
  'Reservada para el job de avisos por mail (Fase 5): marca cuándo se avisó de una falla. Sin consumidor hoy.';

create index billing_runs_period_idx on public.billing_runs (period, started_at desc);
create index billing_runs_errors_idx on public.billing_runs (started_at desc) where status = 'error';

create trigger billing_runs_no_change
  before update or delete on public.billing_runs
  for each row execute function private.forbid_change();

-- -----------------------------------------------------------------------------
-- Generación
-- -----------------------------------------------------------------------------

-- Qué cuotas le corresponden a un período (§13.4), sin mirar precios:
--   1. Por cada socio activo con alta hasta el fin del período y por cada
--      deporte con una inscripción que solape el período: una cuota con la
--      categoría de la inscripción más reciente de ese deporte en el período
--      (el ascenso 5ta → 6ta del 15 cobra 6ta, una sola vez).
--   2. El socio activo sin ninguna inscripción que solape: la cuota social.
--   3. D30: en un período, o cuota social o cuotas por deporte, nunca las
--      dos. Lo que se generó primero queda (anulado o no): quien se inscribe
--      el 15 ya pagó la social ese mes y paga el deporte desde el siguiente.
-- Lo que ya existe lo absorbe el índice único en el INSERT.
create function private.monthly_fee_targets(target_period date)
returns table (member_id bigint, category_id bigint, discipline_id bigint, category_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select target_period as p_start,
           (target_period + interval '1 month' - interval '1 day')::date as p_end
  ),
  active as (
    select m.id
    from public.members m, bounds b
    where m.status = 'active' and m.joined_on <= b.p_end
  ),
  sport as (
    select distinct on (mc.member_id, c.discipline_id)
      mc.member_id, mc.category_id, c.discipline_id, c.name as category_name
    from public.member_categories mc
    join active a on a.id = mc.member_id
    join public.categories c on c.id = mc.category_id
    cross join bounds b
    where mc.joined_on <= b.p_end
      and (mc.left_on is null or mc.left_on >= b.p_start)
    order by mc.member_id, c.discipline_id, mc.joined_on desc, mc.id desc
  )
  select s.member_id, s.category_id, s.discipline_id, s.category_name
  from sport s
  where not exists (
    select 1 from public.fees f
    where f.member_id = s.member_id and f.period = target_period
      and f.kind = 'monthly' and f.discipline_id is null
  )
  union all
  select a.id, null, null, null
  from active a
  where not exists (select 1 from sport s where s.member_id = a.id)
    and not exists (
      select 1 from public.fees f
      where f.member_id = a.id and f.period = target_period
        and f.kind = 'monthly' and f.discipline_id is not null
    );
$$;

-- Genera las cuotas de UN período. Una sola sentencia: o se crean todas o
-- ninguna. Idempotente por el índice único.
create function private.generate_monthly_fees(target_period date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_period date;
  missing_label text;
  created integer;
begin
  perform pg_advisory_xact_lock(hashtext('lonqui.generate_fees'));

  select billing_start_period into start_period from public.settings where id = 1;
  if start_period is null or target_period < start_period then
    return 0;
  end if;

  -- Un socio sin precio frena todo: mejor ninguna cuota que un mes a medias.
  -- El mensaje nombra la categoría o "Cuota social", nunca al socio.
  select coalesce(t.category_name, 'la cuota social')
  into missing_label
  from private.monthly_fee_targets(target_period) t
  where not exists (
    select 1 from private.fee_price_for(
      t.category_id,
      case when t.category_id is null then 'non_practicing' else 'practicing' end,
      target_period
    )
  )
  limit 1;

  if missing_label is not null then
    raise exception 'No hay un valor de cuota vigente para %', missing_label
      using errcode = 'check_violation';
  end if;

  insert into public.fees (
    member_id, period, kind, amount_cents, fee_price_id, category_id, discipline_id, description, created_by
  )
  select
    t.member_id,
    target_period,
    'monthly',
    price.amount_cents,
    price.fee_price_id,
    t.category_id,
    t.discipline_id,
    case when t.category_id is null
      then 'Cuota social ' || to_char(target_period, 'MM/YYYY')
      else 'Cuota ' || to_char(target_period, 'MM/YYYY') || ' · ' || t.category_name
    end,
    auth.uid()
  from private.monthly_fee_targets(target_period) t
  cross join lateral private.fee_price_for(
    t.category_id,
    case when t.category_id is null then 'non_practicing' else 'practicing' end,
    target_period
  ) as price
  on conflict (member_id, period, discipline_id) where kind = 'monthly' do nothing;

  get diagnostics created = row_count;
  return created;
end;
$$;

-- Recorre todos los períodos pendientes hasta el actual. Cada período en su
-- propio bloque: si falla se revierte entero, queda registrado y se corta
-- (los siguientes fallarían por lo mismo; el reintento los vuelve a recorrer).
create function private.generate_pending_fees(run_trigger text, run_actor uuid default null)
returns table (status text, fees_created integer, error_message text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  start_period date;
  current_period date := date_trunc('month', private.club_today())::date;
  p date;
  n integer;
  total integer := 0;
  started timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('lonqui.generate_pending_fees'));

  select s.billing_start_period into start_period from public.settings s where s.id = 1;

  if start_period is null or start_period > current_period then
    insert into public.billing_runs (period, trigger, actor_id, finished_at, status, error_message)
    values (
      current_period, run_trigger, run_actor, clock_timestamp(), 'skipped',
      case when start_period is null then 'Facturación no activada'
           else 'La facturación empieza en ' || to_char(start_period, 'MM/YYYY') end
    );
    return query select 'skipped'::text, 0, null::text;
    return;
  end if;

  p := start_period;
  while p <= current_period loop
    started := clock_timestamp();
    begin
      n := private.generate_monthly_fees(p);
      total := total + n;
      -- Sin filas "0 creadas" por cada mes viejo: solo lo que generó algo y
      -- siempre el período actual, que es el que el aviso del panel mira.
      if n > 0 or p = current_period then
        insert into public.billing_runs (period, trigger, actor_id, started_at, finished_at, status, fees_created)
        values (p, run_trigger, run_actor, started, clock_timestamp(), 'ok', n);
      end if;
    exception when others then
      insert into public.billing_runs (period, trigger, actor_id, started_at, finished_at, status, error_message)
      values (p, run_trigger, run_actor, started, clock_timestamp(), 'error', sqlerrm);
      return query select 'error'::text, total, sqlerrm;
      return;
    end;
    p := (p + interval '1 month')::date;
  end loop;

  return query select 'ok'::text, total, null::text;
end;
$$;

revoke execute on function private.monthly_fee_targets(date) from public, anon, authenticated, service_role;
revoke execute on function private.generate_monthly_fees(date) from public, anon, authenticated, service_role;
revoke execute on function private.generate_pending_fees(text, uuid) from public, anon, authenticated, service_role;

-- "Generar cuotas ahora", "Reintentar" y la activación. Devuelve el resultado
-- en vez de relanzar el error: relanzarlo revertiría la transacción y con ella
-- la fila de billing_runs que registra la falla.
create function public.generate_pending_fees()
returns table (status text, fees_created integer, error_message text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can('billing.configure') then
    raise exception 'No tenés permiso para generar cuotas' using errcode = 'insufficient_privilege';
  end if;
  return query select * from private.generate_pending_fees('manual', auth.uid());
end;
$$;

revoke execute on function public.generate_pending_fees() from public, anon;
grant execute on function public.generate_pending_fees() to authenticated;

-- -----------------------------------------------------------------------------
-- Activación de la facturación (settings.billing_start_period, D18 / T5)
-- -----------------------------------------------------------------------------
create function private.settings_billing_guard()
returns trigger
language plpgsql
-- DEFINER: la invariante no depende de la RLS de quien escribe (review B4).
security definer
set search_path = ''
as $$
begin
  -- Sin JWT (seed, jobs) no hay usuario que autorizar: ya saltean RLS.
  if auth.uid() is not null and not private.can('billing.configure') then
    raise exception 'No tenés permiso para activar la facturación' using errcode = 'insufficient_privilege';
  end if;

  if new.billing_start_period is null then
    raise exception 'La facturación no se puede desactivar una vez activada' using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.fees where kind = 'monthly') then
    raise exception 'El mes de inicio ya no se puede cambiar: hay cuotas generadas' using errcode = 'check_violation';
  end if;

  if new.billing_start_period < date_trunc('month', private.club_today())::date then
    raise exception 'El mes de inicio tiene que ser este mes o uno futuro; la deuda anterior se carga como saldo de arranque'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.fee_prices
    where scope = 'default' and valid_from <= new.billing_start_period
  ) then
    raise exception 'Antes de activar la facturación cargá un valor de cuota por defecto'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger settings_billing_guard
  before update on public.settings
  for each row
  when (old.billing_start_period is distinct from new.billing_start_period)
  execute function private.settings_billing_guard();

-- -----------------------------------------------------------------------------
-- RLS y grants (matriz §6.7, en permisos)
-- -----------------------------------------------------------------------------
alter table public.fee_prices enable row level security;
alter table public.fee_prices force row level security;
alter table public.fees enable row level security;
alter table public.fees force row level security;
alter table public.billing_runs enable row level security;
alter table public.billing_runs force row level security;

create policy fee_prices_select on public.fee_prices
  for select to authenticated
  using ((select private.can('payments.read')));
create policy fee_prices_insert on public.fee_prices
  for insert to authenticated
  with check ((select private.can('billing.configure')));

create policy fees_select on public.fees
  for select to authenticated
  using ((select private.can('payments.read')));
-- Desde la app solo se carga el saldo de arranque; las cuotas las genera la base.
create policy fees_insert on public.fees
  for insert to authenticated
  with check (
    (select private.can('payments.register'))
    and kind = 'opening_balance'
    and created_by = (select auth.uid())
  );
create policy fees_update on public.fees
  for update to authenticated
  using ((select private.can('payments.void')))
  with check ((select private.can('payments.void')));

create policy billing_runs_select on public.billing_runs
  for select to authenticated
  using ((select private.can('billing.configure')));

revoke all on public.fee_prices, public.fees, public.billing_runs from anon, authenticated, service_role;

grant select on public.fee_prices, public.fees, public.billing_runs to authenticated, service_role;
grant insert (scope, member_type, category_id, amount_cents, valid_from, notes) on public.fee_prices to authenticated;
grant insert (member_id, kind, amount_cents, description) on public.fees to authenticated;
grant update (voided_at, voided_by, void_reason) on public.fees to authenticated;

select private.enable_audit('public.fee_prices');
select private.enable_audit('public.fees');

-- -----------------------------------------------------------------------------
-- Jobs
--
-- 03:05 UTC del día 1 = 00:05 del 1° en Argentina (UTC−3 fijo, sin horario de
-- verano). El generador calcula el período con club_today(): a esa hora ya es
-- el día 1 en Lonquimay. La memoria de las corridas es billing_runs, no
-- cron.job_run_details.
-- -----------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname in ('lonqui-generate-fees', 'lonqui-cron-cleanup');

select cron.schedule(
  'lonqui-generate-fees',
  '5 3 1 * *',
  $$select private.generate_pending_fees('cron')$$
);

select cron.schedule(
  'lonqui-cron-cleanup',
  '0 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '90 days'$$
);
