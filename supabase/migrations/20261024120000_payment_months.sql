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
-- Asume payments.register ⊂ payments.read (hoy vale para los tres roles): el
-- chequeo de "ya registrado" lee payments bajo la RLS de lectura. Cuando lleguen
-- los roles configurables, el catálogo tiene que mantener esa inclusión o esta
-- función exigir las dos. Lo mismo para payment_month_options.
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
