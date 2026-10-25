-- Saldo anterior con sus meses: la carga inicial por meses.
--
-- Pipeline: docs/pipelines/2026-10-24-carga-inicial-meses/ (00-architecture §5).
--
-- Hasta acá el saldo anterior era UNA fila de fees y sus meses solo vivían en
-- `description`. En cuanto el primer pago histórico lo creaba,
-- payment_month_options dejaba de devolver los meses previos y mostraba una
-- celda única "Saldo anterior": el segundo pago histórico (abril–junio después
-- de enero–marzo) ya no podía elegir meses.
--
-- Cambios:
--   * fees.from_period / to_period: el tramo de meses del saldo anterior.
--     Nullable (las filas viejas y el alta "solo monto" quedan sin tramo),
--     solo para kind = 'opening_balance', inmutable, insert por columna.
--   * fees_opening_balance_guard: mensajes amigables para el tramo.
--   * register_payment_batch: guarda el tramo que ya recibía en el JSON.
--   * payment_month_options: expande un saldo con tramo en una celda por mes
--     (kind 'opening_balance', período real) con la cobertura repartida del
--     mes más viejo al más nuevo. Columna de salida nueva `opening_from`
--     (NULL en una celda 'opening_balance' = saldo viejo sin tramo).
--
-- Despliegue: compatible hacia atrás (el código viejo ignora la columna nueva
-- y ya mandaba from_period/to_period al lote). El código nuevo inserta el
-- tramo desde la ficha: contra el schema viejo daría un error genérico hasta
-- que esta migración corra.
--
-- Reversa: restaurar register_payment_batch (20261024120000),
-- payment_month_options (20261024150000) y el guard (20260927130000); revocar
-- el grant de las columnas, quitar los CHECK y las columnas, y recrear
-- fees_immutable con la lista anterior. Los tramos cargados se pierden como
-- tramo, nunca como monto.

-- -----------------------------------------------------------------------------
-- fees: tramo del saldo anterior

alter table public.fees
  add column from_period date,
  add column to_period date;

-- `period` lo fija el guard (inicio − 1) en el BEFORE INSERT, antes de que se
-- evalúen estos CHECK: to_period <= period equivale a "antes del inicio".
-- El tope de 36 meses frena un generate_series descontrolado vía PostgREST.
alter table public.fees
  add constraint fees_opening_span_shape check ((from_period is null) = (to_period is null)),
  add constraint fees_opening_span_kind check (from_period is null or kind = 'opening_balance'),
  add constraint fees_opening_span_month_start check (
    from_period is null
    or (from_period = date_trunc('month', from_period)::date and to_period = date_trunc('month', to_period)::date)
  ),
  add constraint fees_opening_span_order check (
    from_period is null or (from_period <= to_period and to_period <= period)
  ),
  add constraint fees_opening_span_max check (
    from_period is null or to_period <= (from_period + interval '35 months')::date
  );

drop trigger fees_immutable on public.fees;
create trigger fees_immutable
  before update on public.fees
  for each row execute function private.protect_immutable_columns(
    'id', 'member_id', 'period', 'kind', 'amount_cents', 'fee_price_id', 'category_id', 'discipline_id',
    'created_by', 'created_at', 'from_period', 'to_period'
  );

-- Sin grant de update: el tramo nace con el saldo y no se corrige (se anula y
-- se carga otro).
grant insert (from_period, to_period) on public.fees to authenticated;

-- Mismo cuerpo que en 20260927130000_billing.sql, más los mensajes del tramo.
-- Los CHECK son la red para PostgREST directo; acá va el texto que se lee.
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
    if new.from_period is null or new.to_period is null or new.from_period > new.to_period
       or new.from_period <> date_trunc('month', new.from_period)::date
       or new.to_period <> date_trunc('month', new.to_period)::date
       or new.to_period > (new.from_period + interval '35 months')::date then
      raise exception 'Los meses del saldo anterior no son válidos' using errcode = 'check_violation';
    end if;
    if new.to_period >= start_period then
      raise exception 'El saldo anterior solo cubre meses anteriores a %', to_char(start_period, 'MM/YYYY')
        using errcode = 'check_violation';
    end if;
  end if;

  new.period := (start_period - interval '1 month')::date;
  new.description := coalesce(nullif(btrim(new.description), ''), 'Saldo anterior al sistema');
  new.fee_price_id := null;
  new.category_id := null;
  new.discipline_id := null;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- register_payment_batch: copia de 20261024120000_payment_months.sql; solo
-- cambia el insert del saldo anterior, que ahora guarda el tramo.

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

  -- El reintento devuelve también el saldo anterior que creó el primer envío:
  -- el formulario lo necesita para saber si quedó cargado. Saldo y pagos del
  -- lote nacen en la misma transacción, así que comparten created_at (now() es
  -- la hora de inicio de la transacción): se recuperan sin columna nueva.
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

      -- Zod ya exige el día 1, pero esto también se llama por PostgREST directo.
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

      -- period lo fija fees_opening_balance_guard (inicio − 1); created_by toma
      -- el default. Solo las columnas con grant de INSERT.
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

  return query
  select p.member_id, p.id, p.amount_cents, ob.fee_id, false
  from public.payments p
  left join unnest(ob_members, ob_ids) as ob(m_id, fee_id) on ob.m_id = p.member_id
  where p.batch_id = register_payment_batch.batch_id
  order by p.id;
end;
$$;


-- -----------------------------------------------------------------------------
-- payment_month_options: el saldo con tramo, mes por mes.
--
-- Cuerpo de 20261024150000_payment_months_before_start.sql, más:
--   * `coverage`: la cobertura de cada cargo vigente con su tramo (fees por
--     fee_id; la RLS de fees ya deja leer a quien registra pagos).
--   * `charged` deja afuera los saldos con tramo; los viejos siguen dando su
--     celda única.
--   * `opening_cells`: una celda por mes del tramo. Monto = total / n con
--     división entera; el último mes absorbe el resto, así un total corregido a
--     mano cierra exacto y los centavos sobrantes caen en el mes que balance
--     forward cubre último. La cobertura se reparte del mes más viejo al más
--     nuevo: antes del mes k ya hay (k − 1) × (total / n) cubierto.
--   * `credit` suma todos los cargos vigentes (antes salía de `charged`).
--   * Mientras la facturación no arrancó se ven todas las celdas del tramo,
--     también las pagas: en la carga inicial se ve el cuadro completo.
--   * Columna nueva `opening_from` (de ahí el drop + create).
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
  opening_from date
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
      m.joined_on,
      coalesce(
        nullif(private.member_fee_price_at(m.id, current_period), 0),
        private.member_fee_price_at(m.id, greatest(current_period, start_period))
      ) as price_today,
      exists (
        select 1 from public.fees f
        where f.member_id = m.id and f.kind = 'opening_balance' and f.voided_at is null
      ) as has_opening_balance
    from public.members m
    where m.id = any (payment_month_options.member_ids)
  ),
  coverage as (
    select
      t.id as member_id,
      cv.period,
      cv.kind,
      cv.amount_cents,
      cv.covered_cents,
      f.from_period,
      f.to_period
    from target t
    cross join lateral private.member_fee_coverage(t.id) cv
    join public.fees f on f.id = cv.fee_id
    where cv.voided_at is null
  ),
  charged as (
    -- Un mes = la suma de sus cargos no anulados (dos deportes = dos cuotas).
    select
      c.member_id,
      c.period,
      case when bool_or(c.kind = 'opening_balance') then 'opening_balance' else 'monthly' end as kind,
      sum(c.amount_cents)::bigint as amount_cents,
      sum(c.covered_cents)::bigint as covered_cents
    from coverage c
    where c.from_period is null
    group by c.member_id, c.period
  ),
  opening_months as (
    select
      c.member_id,
      gs::date as period,
      c.from_period,
      c.amount_cents as total_cents,
      c.covered_cents as total_covered_cents,
      row_number() over (partition by c.member_id order by gs) as k,
      count(*) over (partition by c.member_id) as n
    from coverage c
    cross join generate_series(c.from_period, c.to_period, interval '1 month') gs
    where c.kind = 'opening_balance' and c.from_period is not null
  ),
  opening_cells as (
    select
      om.member_id,
      om.period,
      om.from_period,
      x.amount_cents,
      greatest(0, least(x.amount_cents, om.total_covered_cents - (om.k - 1) * (om.total_cents / om.n)))::bigint as covered_cents
    from opening_months om
    cross join lateral (
      select (case when om.k < om.n then om.total_cents / om.n
                   else om.total_cents - (om.n - 1) * (om.total_cents / om.n) end)::bigint as amount_cents
    ) x
  ),
  first_due as (
    select d.member_id, min(d.period) as period
    from (
      select c.member_id, c.period from charged c where c.amount_cents > c.covered_cents
      union all
      select oc.member_id, oc.period from opening_cells oc where oc.amount_cents > oc.covered_cents
    ) d
    group by d.member_id
  ),
  credit as (
    select
      t.id as member_id,
      greatest(0,
        coalesce((select sum(p.amount_cents) from public.payments p
                  where p.member_id = t.id and p.voided_at is null), 0)
        - coalesce((select sum(c.amount_cents) from coverage c where c.member_id = t.id), 0)
      )::bigint as credit_cents
    from target t
  ),
  billed as (
    select c.member_id, c.period, c.kind, c.amount_cents, c.covered_cents
    from charged c
    left join first_due fd on fd.member_id = c.member_id
    where c.period >= coalesce(fd.period, current_period)
  ),
  opening_billed as (
    select oc.member_id, oc.period, oc.amount_cents, oc.covered_cents, oc.from_period
    from opening_cells oc
    left join first_due fd on fd.member_id = oc.member_id
    where current_period < start_period
       or oc.period >= coalesce(fd.period, current_period)
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
    -- Hasta el mes actual como máximo: con el inicio a dos o más meses, los
    -- meses entre hoy y el inicio todavía no se deben (review 1). La ventana de
    -- 12 cuenta desde ese tope, así el mes actual siempre entra (review 2).
    select t.id as member_id, gs::date as period, t.price_today as amount_cents
    from target t
    cross join generate_series(
      least((start_period - interval '1 month')::date, current_period) - interval '11 months',
      least((start_period - interval '1 month')::date, current_period),
      interval '1 month'
    ) gs
    where not t.has_opening_balance
      and date_trunc('month', t.joined_on)::date <= start_period
  )
  select b.member_id, b.period, b.kind, b.amount_cents, b.covered_cents,
         (b.amount_cents - b.covered_cents)::bigint, b.period = current_period, false, null::date
  from billed b
  union all
  select ob.member_id, ob.period, 'opening_balance', ob.amount_cents, ob.covered_cents,
         (ob.amount_cents - ob.covered_cents)::bigint, ob.period = current_period, false, ob.from_period
  from opening_billed ob
  union all
  select pc.member_id, pc.period, 'projected', pc.amount_cents, pc.covered_cents,
         (pc.amount_cents - pc.covered_cents)::bigint, pc.period = current_period, pc.priced_at_today, null::date
  from projected_covered pc
  union all
  select ps.member_id, ps.period, 'pre_system', ps.amount_cents, 0::bigint,
         ps.amount_cents, ps.period = current_period, true, null::date
  from pre_system ps
  order by 1, 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants. El drop se llevó los de payment_month_options; create or replace
-- conserva los de register_payment_batch y del guard, se repiten igual.
revoke execute on function
  public.payment_month_options(bigint[]),
  public.register_payment_batch(uuid, date, text, text, text, jsonb)
from public, anon;

grant execute on function
  public.payment_month_options(bigint[]),
  public.register_payment_batch(uuid, date, text, text, text, jsonb)
to authenticated;

revoke execute on all functions in schema private from public, anon;
