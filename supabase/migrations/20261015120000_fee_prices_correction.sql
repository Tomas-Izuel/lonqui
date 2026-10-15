-- =============================================================================
-- Valores de cuota: un valor programado se puede corregir.
--
-- Pipeline: docs/pipelines/2026-10-15-cambiar-valor-cuota/ (§6.1).
--
-- Dos filas con el mismo alcance, destino y valid_from son una corrección:
-- rige la de id más alto. Sigue append-only (forbid_change, sin UPDATE ni
-- DELETE para nadie) y fee_prices_insert_guard sigue impidiendo tocar un mes
-- pasado o ya generado: lo cobrado y lo adeudado no cambian.
--
-- Reversa: recrear fee_prices_unique_target como único (falla si ya hay dos
-- filas para el mismo destino y mes: decidir a mano cuál queda) y volver a la
-- definición de private.fee_price_for de 20260927130000_billing.sql.
-- =============================================================================

drop index if exists public.fee_prices_unique_target;

-- Mismas columnas que el índice único de antes, ahora sin unicidad: soporta el
-- filtro por destino + valid_from de fee_price_for.
create index fee_prices_target_idx
  on public.fee_prices (scope, coalesce(member_type, ''), coalesce(category_id, 0), valid_from);

-- Única definición previa: 20260927130000_billing.sql. Solo suma `fp.id desc`
-- como desempate a igual mes.
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
