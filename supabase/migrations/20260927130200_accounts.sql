-- =============================================================================
-- 0007 — Cuentas: deuda derivada, campos calculados del padrón, RPCs del
-- estado de cuenta, la cobranza y el panel, y el gancho de exportación (S3).
--
-- La deuda NUNCA se guarda: se deriva (cargos − pagos no anulados). Todo lo
-- que agrega va en SQL, no en TypeScript: PostgREST corta en max_rows sin
-- avisar y una deuda total sumada en TS da mal en silencio.
--
-- Semántica "balance forward" (D3): los pagos cubren los cargos del más viejo
-- al más nuevo (período, saldo de arranque antes que las cuotas del mismo mes,
-- la cuota social antes que las de deporte, id). Esa cobertura está definida
-- UNA vez, en private.member_fee_coverage; la ficha y la deuda por categoría
-- la usan las dos, así que la suma por categoría cierra con la deuda total. Un cargo parcialmente cubierto sigue adeudado. Un saldo negativo es
-- saldo a favor y se informa aparte: nunca resta deuda en los KPIs.
--
-- Todas las funciones de lectura son SECURITY INVOKER: respetan RLS igual, y
-- además chequean el permiso en el cuerpo para responder "sin permiso" en vez
-- de ceros que parecen un club sin deuda.
--
-- Reversa: drop de las funciones de este archivo. No hay tablas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Núcleo
-- -----------------------------------------------------------------------------
create function private.member_balance(p_member_id bigint)
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
  last_payment as (
    select p.paid_on, p.amount_cents
    from public.payments p
    where p.member_id = p_member_id and p.voided_at is null
    order by p.paid_on desc, p.id desc
    limit 1
  ),
  charges as (
    select
      f.period,
      f.amount_cents,
      sum(f.amount_cents) over (
        order by f.period, case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id
      ) as cumulative
    from public.fees f
    where f.member_id = p_member_id and f.voided_at is null
  )
  select
    coalesce((select sum(c.amount_cents) from charges c), 0)::bigint,
    paid.total,
    coalesce((select sum(c.amount_cents) from charges c), 0)::bigint - paid.total,
    -- Meses, no cargos: quien juega dos deportes tiene dos cuotas por mes.
    (select count(distinct c.period) from charges c where c.cumulative > paid.total)::integer,
    (select min(c.period) from charges c where c.cumulative > paid.total),
    (select lp.paid_on from last_payment lp),
    (select lp.amount_cents from last_payment lp)
  from paid;
$$;

create function private.debt_status_of(balance bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when balance > 0 then 'in_debt' when balance < 0 then 'credit' else 'up_to_date' end;
$$;

-- Cada cargo del socio (anulados incluidos, con cobertura 0) con cuánto lo
-- cubren sus pagos no anulados, del más viejo al más nuevo. Por construcción
-- sum(amount - covered) de los no anulados = greatest(0, saldo).
create function private.member_fee_coverage(p_member_id bigint)
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
  with paid as (
    select coalesce(sum(p.amount_cents), 0)::bigint as total
    from public.payments p
    where p.member_id = p_member_id and p.voided_at is null
  ),
  ordered as (
    select
      f.*,
      row_number() over w as rn,
      case when f.voided_at is null then
        sum(f.amount_cents) filter (where f.voided_at is null) over (w rows between unbounded preceding and current row)
      end as cumulative
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
    case when o.voided_at is not null then 0::bigint
      else greatest(0, least(o.amount_cents, paid.total - (o.cumulative - o.amount_cents)))::bigint
    end,
    o.category_id,
    o.discipline_id,
    o.voided_at,
    o.void_reason,
    o.rn
  from ordered o, paid;
$$;

create function private.require_permission(permission text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not private.can(permission) then
    raise exception 'No tenés permiso para ver esta información' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function private.member_balance(bigint) from public, anon;
revoke execute on function private.member_fee_coverage(bigint) from public, anon;
revoke execute on function private.debt_status_of(bigint) from public, anon;
revoke execute on function private.require_permission(text) from public, anon;
grant execute on function private.member_balance(bigint) to authenticated, service_role;
grant execute on function private.member_fee_coverage(bigint) to authenticated, service_role;
grant execute on function private.debt_status_of(bigint) to authenticated, service_role;
grant execute on function private.require_permission(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Campos calculados de PostgREST sobre members (D24 / T7)
--
-- Permiten `?member_debt_status=eq.in_debt` y mostrar la deuda en cada fila
-- del padrón sin reescribir la búsqueda ni la paginación.
-- -----------------------------------------------------------------------------
create function public.member_balance_cents(m public.members)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_permission('payments.read');
  return (select b.balance_cents from private.member_balance(m.id) b);
end;
$$;

create function public.member_debt_status(m public.members)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_permission('payments.read');
  return private.debt_status_of((select b.balance_cents from private.member_balance(m.id) b));
end;
$$;

create function public.member_months_due(m public.members)
returns integer
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.require_permission('payments.read');
  return (select b.months_due from private.member_balance(m.id) b);
end;
$$;

-- -----------------------------------------------------------------------------
-- Estado de cuenta
-- -----------------------------------------------------------------------------

-- Una fila por socio. La ficha (un id), la precarga del pago de grupo (N ids),
-- los listados al día / con deuda (con filtro por categoría) y el top de
-- atrasados.
create function public.member_accounts(
  member_ids bigint[] default null,
  status_filter text default 'active',
  category_filter bigint default null
)
returns table (
  member_id bigint,
  full_name text,
  status text,
  member_type text,
  -- Inscripciones abiertas: [{category_id, category_name, discipline_id, discipline_name}]
  categories jsonb,
  family_group_id bigint,
  is_payment_responsible boolean,
  charged_cents bigint,
  paid_cents bigint,
  balance_cents bigint,
  months_due integer,
  oldest_due_period date,
  last_payment_on date,
  last_payment_cents bigint,
  debt_status text,
  current_fee_cents bigint,
  -- Desglose de la cuota del mes: [{category_id, category_name, discipline_name, amount_cents}]
  current_fees jsonb,
  current_fee_period date
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  start_period date;
  billing_due boolean;
  current_period date := date_trunc('month', private.club_today())::date;
begin
  perform private.require_permission('payments.read');

  if status_filter not in ('active', 'inactive', 'all') then
    raise exception 'Filtro de estado inválido' using errcode = 'invalid_parameter_value';
  end if;

  select s.billing_start_period into start_period from public.settings s where s.id = 1;
  billing_due := start_period is not null and start_period <= current_period;

  return query
  select
    m.id,
    m.last_name || ', ' || m.first_name,
    m.status,
    m.member_type,
    coalesce(open_cats.list, '[]'::jsonb),
    m.family_group_id,
    m.is_payment_responsible,
    b.charged_cents,
    b.paid_cents,
    b.balance_cents,
    b.months_due,
    b.oldest_due_period,
    b.last_payment_on,
    b.last_payment_cents,
    private.debt_status_of(b.balance_cents),
    -- Sin facturación, o con inicio en un mes futuro, este mes no se cobra:
    -- nada que precargar (si no, el pago quedaría como saldo a favor sin
    -- que nadie lo decida).
    case when not billing_due then null else
      (select coalesce(sum((x ->> 'amount_cents')::bigint), 0)::bigint from jsonb_array_elements(cur.fees) x)
    end,
    case when not billing_due then '[]'::jsonb else cur.fees end,
    case when not billing_due then null else current_period end
  from public.members m
  cross join lateral private.member_balance(m.id) b
  cross join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'category_id', c.id, 'category_name', c.name,
        'discipline_id', d.id, 'discipline_name', d.name
      ) order by d.sort_order, c.sort_order
    ) as list
    from public.member_categories mc
    join public.categories c on c.id = mc.category_id
    join public.disciplines d on d.id = c.discipline_id
    where mc.member_id = m.id and mc.left_on is null
  ) open_cats
  -- La cuota del mes si ya se generó; si no, lo que le tocaría con sus
  -- inscripciones de hoy (o la social). Es lo que precarga el pago.
  cross join lateral (
    select coalesce(
      (select jsonb_agg(
          jsonb_build_object(
            'category_id', f.category_id,
            'category_name', coalesce(c.name, 'Cuota social'),
            'discipline_name', d.name,
            'amount_cents', f.amount_cents
          ) order by f.discipline_id nulls first, f.id
        )
        from public.fees f
        left join public.categories c on c.id = f.category_id
        left join public.disciplines d on d.id = f.discipline_id
        where f.member_id = m.id and f.kind = 'monthly'
          and f.period = current_period and f.voided_at is null),
      (select jsonb_agg(
          jsonb_build_object(
            'category_id', c.id, 'category_name', c.name,
            'discipline_name', d.name, 'amount_cents', fp.amount_cents
          ) order by d.sort_order, c.sort_order
        )
        from public.member_categories mc
        join public.categories c on c.id = mc.category_id
        join public.disciplines d on d.id = c.discipline_id
        cross join lateral private.fee_price_for(c.id, 'practicing', current_period) fp
        where mc.member_id = m.id and mc.left_on is null),
      (select jsonb_build_array(jsonb_build_object(
          'category_id', null, 'category_name', 'Cuota social',
          'discipline_name', null, 'amount_cents', fp.amount_cents
        ))
        from private.fee_price_for(null, 'non_practicing', current_period) fp
        where not exists (
          select 1 from public.member_categories mc
          where mc.member_id = m.id and mc.left_on is null
        )),
      '[]'::jsonb
    ) as fees
  ) cur
  where (member_accounts.member_ids is null or m.id = any (member_accounts.member_ids))
    and (status_filter = 'all' or m.status = status_filter)
    and (
      member_accounts.category_filter is null
      or exists (
        select 1 from public.member_categories mc
        where mc.member_id = m.id and mc.left_on is null
          and mc.category_id = member_accounts.category_filter
      )
    );
end;
$$;

-- Cada cargo del socio con cuánto lo cubren los pagos: los "meses adeudados"
-- de la ficha, del más viejo al más nuevo.
create function public.member_fee_statement(target_member_id bigint)
returns table (
  fee_id bigint,
  period date,
  kind text,
  description text,
  amount_cents bigint,
  covered_cents bigint,
  category_id bigint,
  discipline_id bigint,
  status text,
  voided_at timestamptz,
  void_reason text
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_permission('payments.read');

  return query
  select
    cv.fee_id,
    cv.period,
    cv.kind,
    cv.description,
    cv.amount_cents,
    cv.covered_cents,
    cv.category_id,
    cv.discipline_id,
    case
      when cv.voided_at is not null then 'voided'
      when cv.covered_cents >= cv.amount_cents then 'paid'
      when cv.covered_cents > 0 then 'partial'
      else 'due'
    end,
    cv.voided_at,
    cv.void_reason
  from private.member_fee_coverage(target_member_id) cv
  order by cv.sort_key;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cobranza y panel
-- -----------------------------------------------------------------------------

-- "Cobrado en <mes>" = pagos no anulados con paid_on en el mes, aunque cubran
-- deuda vieja (confirmado por Tomás). "Cuotas de <mes>" = cargos mensuales no
-- anulados del período; el saldo de arranque no cuenta.
create function public.month_collection(target_period date default null)
returns table (
  period date,
  collected_cents bigint,
  cash_cents bigint,
  transfer_cents bigint,
  payments_count integer,
  fees_cents bigint,
  fees_count integer
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  p date := date_trunc('month', coalesce(target_period, private.club_today()))::date;
  p_end date := (date_trunc('month', coalesce(target_period, private.club_today())) + interval '1 month' - interval '1 day')::date;
begin
  perform private.require_permission('payments.read');

  return query
  select
    p,
    coalesce(sum(pay.amount_cents), 0)::bigint,
    coalesce(sum(pay.amount_cents) filter (where pay.method = 'cash'), 0)::bigint,
    coalesce(sum(pay.amount_cents) filter (where pay.method = 'transfer'), 0)::bigint,
    count(pay.id)::integer,
    (select coalesce(sum(f.amount_cents), 0)::bigint from public.fees f
      where f.kind = 'monthly' and f.period = p and f.voided_at is null),
    (select count(*)::integer from public.fees f
      where f.kind = 'monthly' and f.period = p and f.voided_at is null)
  from public.payments pay
  where pay.voided_at is null and pay.paid_on between p and p_end;
end;
$$;

create function public.dashboard_summary()
returns table (
  billing_active boolean,
  billing_start_period date,
  period date,
  active_members integer,
  collected_cents bigint,
  cash_cents bigint,
  transfer_cents bigint,
  payments_count integer,
  fees_cents bigint,
  fees_count integer,
  total_debt_cents bigint,
  members_in_debt integer,
  members_with_credit integer,
  credit_cents bigint,
  inactive_debt_cents bigint,
  inactive_in_debt integer,
  admissions_count integer,
  reactivations_count integer,
  withdrawals_count integer,
  expired_clearances integer,
  missing_clearances integer,
  pending_periods date[]
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  today date := private.club_today();
  p date := date_trunc('month', private.club_today())::date;
  p_end date := (date_trunc('month', private.club_today()) + interval '1 month' - interval '1 day')::date;
  start_period date;
begin
  perform private.require_permission('reports.read');

  select s.billing_start_period into start_period from public.settings s where s.id = 1;

  return query
  with balances as (
    select m.id, m.status, m.birth_date, b.balance_cents
    from public.members m
    cross join lateral private.member_balance(m.id) b
  ),
  collection as (
    select
      coalesce(sum(pay.amount_cents), 0)::bigint as total,
      coalesce(sum(pay.amount_cents) filter (where pay.method = 'cash'), 0)::bigint as cash,
      coalesce(sum(pay.amount_cents) filter (where pay.method = 'transfer'), 0)::bigint as transfer,
      count(pay.id)::integer as n
    from public.payments pay
    where pay.voided_at is null and pay.paid_on between p and p_end
  ),
  month_fees as (
    select coalesce(sum(f.amount_cents), 0)::bigint as total, count(*)::integer as n
    from public.fees f
    where f.kind = 'monthly' and f.period = p and f.voided_at is null
  ),
  events as (
    select
      count(*) filter (where e.event_type = 'admission')::integer as admissions,
      count(*) filter (where e.event_type = 'reactivation')::integer as reactivations,
      count(*) filter (where e.event_type = 'withdrawal')::integer as withdrawals
    from public.member_status_events e
    where e.effective_on between p and p_end
  ),
  minors as (
    select
      bl.id,
      (select max(mc.expires_on) from public.medical_clearances mc where mc.member_id = bl.id) as latest_expiry
    from balances bl
    where bl.status = 'active'
      and bl.birth_date is not null
      and bl.birth_date > (today - interval '18 years')::date
  )
  select
    start_period is not null,
    start_period,
    p,
    (select count(*)::integer from balances where status = 'active'),
    collection.total,
    collection.cash,
    collection.transfer,
    collection.n,
    month_fees.total,
    month_fees.n,
    (select coalesce(sum(balance_cents) filter (where balance_cents > 0), 0)::bigint from balances where status = 'active'),
    (select count(*)::integer from balances where status = 'active' and balance_cents > 0),
    (select count(*)::integer from balances where status = 'active' and balance_cents < 0),
    (select coalesce(-sum(balance_cents) filter (where balance_cents < 0), 0)::bigint from balances where status = 'active'),
    (select coalesce(sum(balance_cents) filter (where balance_cents > 0), 0)::bigint from balances where status = 'inactive'),
    (select count(*)::integer from balances where status = 'inactive' and balance_cents > 0),
    events.admissions,
    events.reactivations,
    events.withdrawals,
    (select count(*)::integer from minors where latest_expiry is not null and latest_expiry < today),
    (select count(*)::integer from minors where latest_expiry is null),
    -- Meses entre el inicio y hoy sin ninguna cuota generada habiendo socios
    -- activos: si no está vacío, la generación no corrió.
    case when start_period is null or start_period > p then array[]::date[] else array(
      select gs::date
      from generate_series(start_period, p, interval '1 month') gs
      where not exists (select 1 from public.fees f where f.kind = 'monthly' and f.period = gs::date)
        and exists (select 1 from public.members m where m.status = 'active' and m.joined_on <= (gs + interval '1 month' - interval '1 day')::date)
      order by gs
    ) end
  from collection, month_fees, events;
end;
$$;

-- Deuda por categoría (D31/D32). Cada peso adeudado se atribuye al cargo que
-- no llegó a cubrirse (misma cobertura que la ficha) y ese cargo, a la
-- categoría CONGELADA en él (decidido por Tomás: la deuda de los meses en 5ta
-- queda en 5ta aunque el chico ya juegue en 6ta). Filas:
--   'category'         una por categoría; members = plantel de HOY (socios
--                      activos con inscripción abierta, cada uno en cada una
--                      de las suyas), así que puede haber más socios con
--                      deuda que socios actuales;
--   'social'           cuota social (no practicantes);
--   'opening_balance'  saldo anterior al sistema.
-- La suma de debt_cents de todas las filas = deuda total de los activos.
create function public.debt_by_category()
returns table (
  kind text,
  category_id bigint,
  category_name text,
  discipline_id bigint,
  discipline_name text,
  members integer,
  members_in_debt integer,
  debt_cents bigint,
  sort_order integer
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.require_permission('reports.read');

  return query
  with active as (
    select m.id from public.members m where m.status = 'active'
  ),
  uncovered as (
    select
      a.id as member_id,
      -- 'adjustment' no tiene camino de escritura hoy; el día que lo tenga,
      -- esta función necesita su propia fila (no mezclarlo con el saldo
      -- anterior). Por eso no hay un `else`.
      case cv.kind
        when 'monthly' then case when cv.category_id is null then 'social' else 'category' end
        when 'opening_balance' then 'opening_balance'
      end as bucket,
      cv.category_id,
      cv.amount_cents - cv.covered_cents as due
    from active a
    cross join lateral private.member_fee_coverage(a.id) cv
    where cv.voided_at is null and cv.amount_cents > cv.covered_cents
  ),
  roster as (
    select mc.category_id, count(distinct mc.member_id)::integer as n
    from public.member_categories mc
    join active a on a.id = mc.member_id
    where mc.left_on is null
    group by mc.category_id
  ),
  category_debt as (
    select u.category_id, count(distinct u.member_id)::integer as n, sum(u.due)::bigint as total
    from uncovered u
    where u.bucket = 'category'
    group by u.category_id
  )
  select
    'category'::text,
    c.id,
    c.name,
    d.id,
    d.name,
    coalesce(r.n, 0),
    coalesce(cd.n, 0),
    coalesce(cd.total, 0)::bigint,
    (d.sort_order * 1000 + c.sort_order)::integer
  from public.categories c
  join public.disciplines d on d.id = c.discipline_id
  left join roster r on r.category_id = c.id
  left join category_debt cd on cd.category_id = c.id
  where r.n is not null or cd.n is not null
  union all
  select
    'social',
    null,
    'Cuota social',
    null,
    null,
    (select count(*)::integer from active a
      where not exists (select 1 from public.member_categories mc where mc.member_id = a.id and mc.left_on is null)),
    (select count(distinct u.member_id)::integer from uncovered u where u.bucket = 'social'),
    (select coalesce(sum(u.due), 0)::bigint from uncovered u where u.bucket = 'social'),
    1000000
  union all
  select
    'opening_balance',
    null,
    'Saldo anterior al sistema',
    null,
    null,
    (select count(distinct u.member_id)::integer from uncovered u where u.bucket = 'opening_balance'),
    (select count(distinct u.member_id)::integer from uncovered u where u.bucket = 'opening_balance'),
    (select coalesce(sum(u.due), 0)::bigint from uncovered u where u.bucket = 'opening_balance'),
    1000001
  order by 9, 3;
end;
$$;

-- Evolución de los últimos N meses (incluido el actual). La deuda al cierre de
-- un mes P se calcula sobre los socios activos AL CIERRE DE P (reconstruido
-- desde los eventos de alta/baja: T8), con los cargos de períodos <= P y los
-- pagos con fecha <= fin de P. Es "como se sabe hoy": lo anulado no cuenta
-- nunca, porque anular es corregir la historia.
create function public.monthly_history(months integer default 12)
returns table (
  period date,
  collected_cents bigint,
  fees_cents bigint,
  debt_at_close_cents bigint
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_period date := date_trunc('month', private.club_today())::date;
  n integer := least(greatest(coalesce(months, 12), 1), 36);
begin
  perform private.require_permission('reports.read');

  return query
  with periods as (
    select gs::date as p, (gs + interval '1 month' - interval '1 day')::date as p_end
    from generate_series(current_period - make_interval(months => n - 1), current_period, interval '1 month') gs
  )
  select
    pr.p,
    (select coalesce(sum(pay.amount_cents), 0)::bigint from public.payments pay
      where pay.voided_at is null and pay.paid_on between pr.p and pr.p_end),
    (select coalesce(sum(f.amount_cents), 0)::bigint from public.fees f
      where f.kind = 'monthly' and f.period = pr.p and f.voided_at is null),
    (select coalesce(sum(greatest(0,
        coalesce((select sum(f.amount_cents) from public.fees f
                  where f.member_id = m.id and f.voided_at is null and f.period <= pr.p), 0)
        - coalesce((select sum(pay.amount_cents) from public.payments pay
                  where pay.member_id = m.id and pay.voided_at is null and pay.paid_on <= pr.p_end), 0)
      )), 0)::bigint
      from public.members m
      where m.joined_on <= pr.p_end
        and coalesce((
          select e.event_type from public.member_status_events e
          where e.member_id = m.id and e.effective_on <= pr.p_end
          order by e.effective_on desc, e.created_at desc, e.id desc
          limit 1
        ), 'admission') <> 'withdrawal'
    )
  from periods pr
  order by pr.p;
end;
$$;

-- -----------------------------------------------------------------------------
-- Gancho de exportación (slice 3, sin consumidor todavía)
--
-- SECURITY DEFINER porque es la única forma de insertar en audit_log, que no
-- tiene grants de escritura para nadie. El actor sale de auth.uid().
-- -----------------------------------------------------------------------------
create function public.log_export(listing text, filters jsonb, row_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can('reports.export') then
    raise exception 'No tenés permiso para exportar' using errcode = 'insufficient_privilege';
  end if;

  -- Review B5: lista cerrada (el slice 3 la extiende acá) y un tope al
  -- tamaño de los filtros. audit_log es append-only: lo que entra, queda.
  if listing is null or listing not in ('members', 'debt', 'up_to_date', 'debt_by_category', 'month_payments', 'audit') then
    raise exception 'Listado desconocido' using errcode = 'invalid_parameter_value';
  end if;
  if filters is not null and pg_column_size(filters) > 4096 then
    raise exception 'Los filtros son demasiado grandes' using errcode = 'invalid_parameter_value';
  end if;
  if row_count is null or row_count < 0 then
    raise exception 'Cantidad de filas inválida' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.audit_log (actor_id, actor_source, op, table_name, record_id, context)
  values (
    auth.uid(),
    'session',
    'EXPORT',
    listing,
    null,
    jsonb_build_object('listing', listing, 'filters', coalesce(filters, '{}'::jsonb), 'row_count', row_count)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants de las funciones públicas
-- -----------------------------------------------------------------------------
revoke execute on function
  public.member_balance_cents(public.members),
  public.member_debt_status(public.members),
  public.member_months_due(public.members),
  public.member_accounts(bigint[], text, bigint),
  public.member_fee_statement(bigint),
  public.month_collection(date),
  public.dashboard_summary(),
  public.debt_by_category(),
  public.monthly_history(integer),
  public.log_export(text, jsonb, integer)
from public, anon;

grant execute on function
  public.member_balance_cents(public.members),
  public.member_debt_status(public.members),
  public.member_months_due(public.members),
  public.member_accounts(bigint[], text, bigint),
  public.member_fee_statement(bigint),
  public.month_collection(date),
  public.dashboard_summary(),
  public.debt_by_category(),
  public.monthly_history(integer),
  public.log_export(text, jsonb, integer)
to authenticated;

-- -----------------------------------------------------------------------------
-- Ninguna función de private ejecutable por PUBLIC.
--
-- Postgres le da EXECUTE a PUBLIC a toda función nueva, y ese default solo se
-- puede revocar globalmente, no por schema: el `alter default privileges ...
-- in schema private` de la fundación no tiene efecto. Por eso cada migración
-- que crea funciones en private cierra con este revoke y otorga a mano lo que
-- las policies y las funciones INVOKER necesitan. Hay un test en tests/db/
-- que lo verifica.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;

grant execute on function
  private.club_today(),
  private.normalize_text(text),
  private.current_app_role(),
  private.has_role(text[]),
  private.is_admin(),
  private.permissions_for_role(text),
  private.can(text),
  private.fee_price_for(bigint, text, date),
  private.member_balance(bigint),
  private.member_fee_coverage(bigint),
  private.debt_status_of(bigint),
  private.require_permission(text)
to authenticated, service_role;
