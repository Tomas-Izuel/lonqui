-- =============================================================================
-- Ritmo de cobranza del mes (pipeline 2026-09-28-ui-expresiva).
--
-- Alimenta el gráfico de /cobranza: lo cobrado día a día y acumulado contra
-- el total de cuotas del mes. Una fila por día del período, también los días
-- sin pagos (en cero), para que el acumulado sea una curva continua y no haya
-- que rellenar huecos en TypeScript. En el mes en curso corta en hoy (hora
-- argentina): los días que todavía no pasaron no son "cero cobrado".
--
-- Misma definición de "cobrado" que month_collection: pagos no anulados con
-- paid_on en el día, aunque cubran deuda vieja. Máximo 31 filas: nunca toca
-- el corte de max_rows de PostgREST.
-- =============================================================================

create function public.daily_collection(target_period date default null)
returns table (
  day date,
  collected_cents bigint,
  cumulative_cents bigint
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  p date := date_trunc('month', coalesce(target_period, private.club_today()))::date;
  p_end date := least(
    (date_trunc('month', coalesce(target_period, private.club_today())) + interval '1 month' - interval '1 day')::date,
    private.club_today()
  );
begin
  perform private.require_permission('payments.read');

  return query
  select
    d.day::date,
    coalesce(sum(pay.amount_cents), 0)::bigint,
    (sum(coalesce(sum(pay.amount_cents), 0)) over (order by d.day))::bigint
  from generate_series(p, p_end, interval '1 day') as d(day)
  left join public.payments pay
    on pay.paid_on = d.day::date and pay.voided_at is null
  group by d.day
  order by d.day;
end;
$$;

revoke execute on function public.daily_collection(date) from public, anon;
grant execute on function public.daily_collection(date) to authenticated;

revoke execute on all functions in schema private from public, anon;
