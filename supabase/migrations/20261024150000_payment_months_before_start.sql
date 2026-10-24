-- Tira de meses también antes de que arranque la facturación.
--
-- payment_month_options devolvía vacío con el inicio de la facturación en el
-- futuro, y el formulario de pago caía al campo de monto. En producción el
-- inicio quedó programado para el mes siguiente al de la carga: durante todo
-- ese mes nadie veía la tira (pipeline 2026-10-24-pago-por-meses-antes-del-inicio).
--
-- Cambios respecto de 20261024120000_payment_months.sql:
--   * con inicio futuro devuelve las celdas igual: pre_system (12 meses hasta
--     el actual inclusive; nunca los que hay entre hoy y el inicio, que todavía
--     no se deben) + projected (desde el inicio);
--   * pre_system marca is_current en el mes actual (antes era siempre false);
--   * la cuota "de hoy" cae al valor del mes de inicio si hoy no hay valor
--     vigente (un valor cargado recién desde el inicio daría celdas en $0).
--     member_fee_price_at devuelve 0 tanto sin valor como con un valor real de
--     $0: un socio exento hoy y con valor desde el inicio ve sus meses previos
--     a ese valor. Hoy no hay valores en $0; si aparecen, distinguirlo acá.
-- Sin facturación configurada (inicio null) sigue sin devolver nada.
create or replace function public.payment_month_options(member_ids bigint[])
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
         (b.amount_cents - b.covered_cents)::bigint, b.period = current_period, false
  from billed b
  union all
  select pc.member_id, pc.period, 'projected', pc.amount_cents, pc.covered_cents,
         (pc.amount_cents - pc.covered_cents)::bigint, pc.period = current_period, pc.priced_at_today
  from projected_covered pc
  union all
  select ps.member_id, ps.period, 'pre_system', ps.amount_cents, 0::bigint,
         ps.amount_cents, ps.period = current_period, true
  from pre_system ps
  order by 1, 2;
end;
$$;
