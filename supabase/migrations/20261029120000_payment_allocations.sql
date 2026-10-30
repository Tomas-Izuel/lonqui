-- =============================================================================
-- Imputación explícita por cuota y saldo anterior por mes.
--
-- Pipeline: docs/pipelines/2026-10-29-imputacion-libre-meses/ (00-architecture §6–§9).
--
-- Hasta acá un pago era un pozo por socio y la cobertura se derivaba al leer
-- (balance forward); el saldo anterior era UNA fila con tramo. Desde acá:
--   * fees: el saldo anterior es una fila por mes (period real, < inicio).
--   * payment_allocations: "este pago cubrió esta cuota con tantos centavos".
--     Append-only. Escriben solo las funciones DEFINER del motor (triggers).
--   * fee_status / payment_credit: pagada/parcial/adeudada por cuota, saldo a
--     favor por pago. Deuda = Σ pending. Nada almacenado.
--   * Motor: al insertar un pago (marcados primero, resto al más viejo), al
--     insertar cuotas (crédito a las nuevas) y al anular una cuota (su plata
--     vuelve a crédito y se reimputa).
--   * Datos: cada tramo vigente se anula (motivo fijo, actor sistema) y se
--     reemplaza por sus meses; cada pago vigente queda imputado como el
--     sistema lo mostraba hoy ('backfill'). Si un centavo cambia, aborta.
--
-- TRANSACCIÓN: supabase db push manda el archivo entero en un pipeline con un
-- solo Sync: es UNA transacción implícita, y la fila de versión va adentro.
-- Nada acá puede empezar con CREATE/DROP INDEX CONCURRENTLY, REINDEX
-- CONCURRENTLY, VACUUM, ALTER SYSTEM ni CLUSTER: el CLI saca esas sentencias
-- del pipeline y partiría la transacción.
--
-- Reversa: ver 00-architecture §7.1 (migración hacia adelante).
-- =============================================================================

set local statement_timeout = '10min';
-- Si un lote o el cron tienen tomada una fila que la migración necesita, mejor
-- abortar (la transacción no deja nada) que quedar en cola trabando la app.
set local lock_timeout = '30s';

-- -----------------------------------------------------------------------------
-- 1. Foto de la cobertura vigente, ANTES de tocar nada. Fórmulas inline: las
--    funciones que las definían se redefinen más abajo. Tablas temporales de la
--    sesión; la verificación (sección 9) las lee y las borra.
-- -----------------------------------------------------------------------------
create function private.allocation_migration_snapshot()
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute 'drop table if exists pg_temp.mig_fees';
  execute 'drop table if exists pg_temp.mig_cells';
  execute 'drop table if exists pg_temp.mig_members';

  -- Cobertura por cargo: balance forward (20260927130200).
  create temp table mig_fees as
  with paid as (
    select p.member_id, sum(p.amount_cents)::bigint as total
    from public.payments p
    where p.voided_at is null
    group by p.member_id
  ),
  ordered as (
    select
      f.id, f.member_id, f.kind, f.period, f.amount_cents, f.from_period, f.to_period,
      sum(f.amount_cents) over (
        partition by f.member_id
        order by f.period, case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id
      ) as cumulative
    from public.fees f
    where f.voided_at is null
  )
  select
    o.member_id, o.id as fee_id, o.kind, o.period, o.amount_cents, o.from_period, o.to_period,
    greatest(0, least(o.amount_cents, coalesce(p.total, 0) - (o.cumulative - o.amount_cents)))::bigint as covered_cents
  from ordered o
  left join paid p on p.member_id = o.member_id;

  -- Celdas por mes de cada tramo: reparto y cobertura de payment_month_options (20261024170000).
  create temp table mig_cells as
  with months as (
    select
      s.member_id, s.fee_id, gs::date as period, s.amount_cents as total, s.covered_cents as total_covered,
      row_number() over (partition by s.fee_id order by gs) as k,
      count(*) over (partition by s.fee_id) as n
    from pg_temp.mig_fees s
    cross join generate_series(s.from_period, s.to_period, interval '1 month') gs
    where s.kind = 'opening_balance' and s.from_period is not null
  ),
  sized as (
    select m.*, (case when m.k < m.n then m.total / m.n else m.total - (m.n - 1) * (m.total / m.n) end)::bigint as cell
    from months m
  )
  select
    s.member_id, s.fee_id, s.period, s.cell as amount_cents,
    greatest(0, least(s.cell, s.total_covered - (s.k - 1) * (s.total / s.n)))::bigint as covered_cents
  from sized s;

  create temp table mig_members as
  select
    m.id as member_id,
    coalesce((select sum(f.amount_cents) from public.fees f where f.member_id = m.id and f.voided_at is null), 0)::bigint as charged_cents,
    coalesce((select sum(p.amount_cents) from public.payments p where p.member_id = m.id and p.voided_at is null), 0)::bigint as paid_cents
  from public.members m;
end;
$$;

select private.allocation_migration_snapshot();

-- -----------------------------------------------------------------------------
-- 2. Reparto de un total en n partes enteras, el resto en la última. Espejo
--    exacto de splitOpeningTotal (TS); un test de DB compara los dos.
-- -----------------------------------------------------------------------------
create function private.split_opening_total(total bigint, n integer)
returns bigint[]
language sql
immutable
set search_path = ''
as $$
  select case when n <= 0 then '{}'::bigint[] else
    array(
      select (case when k < n then total / n else total - (n - 1) * (total / n) end)::bigint
      from generate_series(1, n) k
      order by k
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- 3. fees: el saldo anterior es una fila por mes.
-- -----------------------------------------------------------------------------

-- Un saldo vigente por socio Y MES (antes: uno por socio). Mismo nombre: el
-- modelo ya traduce este 23505.
drop index public.fees_one_opening_balance;
create unique index fees_one_opening_balance
  on public.fees (member_id, period) where kind = 'opening_balance' and voided_at is null;

-- period ya no lo fija la base: viene del mes real (la ficha y el lote lo
-- mandan). Sin period (seed, código viejo) sigue siendo inicio − 1.
grant insert (period) on public.fees to authenticated;
-- El tramo no se carga nunca más. Las columnas quedan por la historia de las
-- filas anuladas (y su CHECK e inmutabilidad siguen).
revoke insert (from_period, to_period) on public.fees from authenticated;

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
    raise exception 'El saldo anterior se carga mes por mes. Recargá la página y volvé a intentar'
      using errcode = 'check_violation';
  end if;

  -- Compat: sin período = el mes anterior al inicio (seed, código anterior).
  if new.period is null then
    new.period := (start_period - interval '1 month')::date;
  end if;
  if new.period <> date_trunc('month', new.period)::date then
    raise exception 'El mes del saldo anterior no es válido' using errcode = 'check_violation';
  end if;
  if new.period >= start_period then
    raise exception 'El saldo anterior solo cubre meses anteriores a %', to_char(start_period, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;
  if new.period < (start_period - interval '36 months')::date then
    raise exception 'El saldo anterior no puede ir más de 36 meses atrás' using errcode = 'check_violation';
  end if;

  new.description := coalesce(nullif(btrim(new.description), ''), 'Saldo anterior · ' || to_char(new.period, 'MM/YYYY'));
  new.fee_price_id := null;
  new.category_id := null;
  new.discipline_id := null;
  return new;
end;
$$;

comment on column public.fees.from_period is
  'Histórico: tramo de los saldos anteriores cargados antes de 20261029120000, hoy anulados. Ninguna fila nueva lo usa.';

-- -----------------------------------------------------------------------------
-- 4. payment_allocations
-- -----------------------------------------------------------------------------
create table public.payment_allocations (
  id bigint generated always as identity primary key,
  payment_id bigint not null references public.payments (id) on delete restrict,
  fee_id bigint not null references public.fees (id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  -- marked: el operador marcó el mes; oldest_first: el resto del pago, al
  -- más viejo; credit: saldo a favor aplicado después (generador, anulación
  -- de cuota); backfill: la migración que imputó la historia.
  source text not null check (source in ('marked', 'oldest_first', 'credit', 'backfill')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.payment_allocations is
  'Qué cuota cubrió cada pago y con cuántos centavos. Append-only. Un pago puede imputarse dos veces a la misma cuota en momentos distintos (sin índice único a propósito). Una imputación a una cuota o pago anulados queda inerte: fee_status y payment_credit las ignoran.';

create index payment_allocations_payment_id_idx on public.payment_allocations (payment_id);
create index payment_allocations_fee_id_idx on public.payment_allocations (fee_id);

-- Historia: ni UPDATE, ni DELETE, ni TRUNCATE, para nadie, incluso con
-- session_replication_role = replica (como audit_log).
create trigger payment_allocations_no_change
  before update or delete on public.payment_allocations
  for each row execute function private.forbid_change();
create trigger payment_allocations_no_truncate
  before truncate on public.payment_allocations
  for each statement execute function private.forbid_change();
alter table public.payment_allocations enable always trigger payment_allocations_no_change;
alter table public.payment_allocations enable always trigger payment_allocations_no_truncate;

-- Invariantes, válidas por cualquier camino:
--   - pago y cuota existen, están vigentes y son del mismo socio;
--   - Σ imputado a la cuota (pagos no anulados) + nuevo <= monto de la cuota;
--   - Σ imputado del pago (cuotas no anuladas) + nuevo <= monto del pago.
-- Bloquea pago y cuota: dos escrituras sobre la misma cuota se serializan y la
-- segunda ve la primera (también dentro de un INSERT de varias filas).
create function private.payment_allocations_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay record;
  fee record;
  fee_paid bigint;
  pay_allocated bigint;
begin
  select p.id, p.member_id, p.amount_cents, p.voided_at
  into pay
  from public.payments p
  where p.id = new.payment_id
  for no key update;
  if not found then
    raise exception 'El pago no existe' using errcode = 'foreign_key_violation';
  end if;
  if pay.voided_at is not null then
    raise exception 'Un pago anulado no se imputa' using errcode = 'check_violation';
  end if;

  select f.id, f.member_id, f.period, f.amount_cents, f.voided_at
  into fee
  from public.fees f
  where f.id = new.fee_id
  for no key update;
  if not found then
    raise exception 'La cuota no existe' using errcode = 'foreign_key_violation';
  end if;
  if fee.voided_at is not null then
    raise exception 'Una cuota anulada no recibe imputaciones' using errcode = 'check_violation';
  end if;
  if fee.member_id <> pay.member_id then
    raise exception 'El pago y la cuota son de socios distintos' using errcode = 'check_violation';
  end if;

  select coalesce(sum(a.amount_cents), 0) into fee_paid
  from public.payment_allocations a
  join public.payments p on p.id = a.payment_id
  where a.fee_id = new.fee_id and p.voided_at is null;
  if fee_paid + new.amount_cents > fee.amount_cents then
    raise exception 'La cuota de % ya está paga, o le falta menos de lo imputado', to_char(fee.period, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(a.amount_cents), 0) into pay_allocated
  from public.payment_allocations a
  join public.fees f on f.id = a.fee_id
  where a.payment_id = new.payment_id and f.voided_at is null;
  if pay_allocated + new.amount_cents > pay.amount_cents then
    raise exception 'Lo imputado supera el monto del pago' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger payment_allocations_insert_guard
  before insert on public.payment_allocations
  for each row execute function private.payment_allocations_insert_guard();

alter table public.payment_allocations enable row level security;
alter table public.payment_allocations force row level security;

create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using ((select private.can('payments.read')));
-- Sin policy de INSERT: nadie inserta desde la app. Escribe el motor (DEFINER).

revoke all on public.payment_allocations from anon, authenticated, service_role;
grant select on public.payment_allocations to authenticated, service_role;

select private.enable_audit('public.payment_allocations');

-- -----------------------------------------------------------------------------
-- 5. Vistas: UNA definición de "pagada / parcial / adeudada" y de "saldo a
--    favor". security_invoker: valen las RLS de fees, payments y allocations.
-- -----------------------------------------------------------------------------
create view public.fee_status with (security_invoker = true) as
select
  f.id as fee_id,
  f.member_id,
  f.period,
  f.kind,
  f.category_id,
  f.discipline_id,
  f.amount_cents,
  coalesce(a.paid, 0)::bigint as paid_cents,
  (f.amount_cents - coalesce(a.paid, 0))::bigint as pending_cents,
  case
    when coalesce(a.paid, 0) >= f.amount_cents then 'paid'
    when coalesce(a.paid, 0) > 0 then 'partial'
    else 'due'
  end as status
from public.fees f
left join lateral (
  select sum(al.amount_cents) as paid
  from public.payment_allocations al
  join public.payments p on p.id = al.payment_id
  where al.fee_id = f.id and p.voided_at is null
) a on true
where f.voided_at is null;

create view public.payment_credit with (security_invoker = true) as
select
  p.id as payment_id,
  p.member_id,
  p.paid_on,
  p.amount_cents,
  coalesce(a.allocated, 0)::bigint as allocated_cents,
  (p.amount_cents - coalesce(a.allocated, 0))::bigint as credit_cents
from public.payments p
left join lateral (
  select sum(al.amount_cents) as allocated
  from public.payment_allocations al
  join public.fees f on f.id = al.fee_id
  where al.payment_id = p.id and f.voided_at is null
) a on true
where p.voided_at is null;

revoke all on public.fee_status, public.payment_credit from anon, authenticated, service_role;
grant select on public.fee_status, public.payment_credit to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Motor de imputación (DEFINER, sin EXECUTE para nadie: lo llaman triggers).
-- -----------------------------------------------------------------------------

-- Crédito de los pagos más viejos a las cuotas pendientes más viejas, por
-- solape de acumulados. UN insert; el guard valida cada fila. Bloquea al socio.
create function private.apply_credit(p_member_id bigint, p_source text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  -- NO KEY UPDATE y no FOR UPDATE: el INSERT del pago ya tomó KEY SHARE sobre el
  -- socio (chequeo de FK); FOR UPDATE choca con el KEY SHARE de otro lote del
  -- mismo socio y los dos se bloquean mutuamente (deadlock, hallazgo H1 de T4).
  -- NO KEY UPDATE convive con KEY SHARE y sigue serializando entre motores.
  perform 1 from public.members m where m.id = p_member_id for no key update;

  insert into public.payment_allocations (payment_id, fee_id, amount_cents, source)
  with credits as (
    select pc.payment_id, pc.credit_cents,
           sum(pc.credit_cents) over (order by pc.paid_on, pc.payment_id) as hi
    from public.payment_credit pc
    where pc.member_id = p_member_id and pc.credit_cents > 0
  ),
  pendings as (
    select fs.fee_id, fs.pending_cents,
           sum(fs.pending_cents) over (
             order by fs.period, case fs.kind when 'opening_balance' then 0 else 1 end, fs.discipline_id nulls first, fs.fee_id
           ) as hi
    from public.fee_status fs
    where fs.member_id = p_member_id and fs.pending_cents > 0
  )
  select
    c.payment_id,
    f.fee_id,
    least(c.hi, f.hi) - greatest(c.hi - c.credit_cents, f.hi - f.pending_cents),
    p_source
  from credits c
  join pendings f on least(c.hi, f.hi) > greatest(c.hi - c.credit_cents, f.hi - f.pending_cents)
  order by f.hi, c.hi;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Los meses marcados, en orden, hasta donde alcanza el pago. Un mes marcado
-- sin pendiente (otro operador lo cobró, o el crédito previo lo cubrió) se
-- saltea: la plata sigue al más viejo adeudado (apply_credit, después).
create function private.allocate_marked(p_payment_id bigint, p_periods date[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay record;
  f record;
  remaining bigint;
  take bigint;
  n integer := 0;
begin
  select p.id, p.member_id, p.amount_cents into pay from public.payments p where p.id = p_payment_id;
  perform 1 from public.members m where m.id = pay.member_id for no key update;

  select pay.amount_cents - coalesce(sum(a.amount_cents), 0) into remaining
  from public.payment_allocations a
  join public.fees fe on fe.id = a.fee_id
  where a.payment_id = p_payment_id and fe.voided_at is null;

  for f in
    select fs.fee_id, fs.pending_cents
    from public.fee_status fs
    where fs.member_id = pay.member_id and fs.period = any (p_periods) and fs.pending_cents > 0
    order by fs.period, case fs.kind when 'opening_balance' then 0 else 1 end, fs.discipline_id nulls first, fs.fee_id
  loop
    exit when remaining <= 0;
    take := least(remaining, f.pending_cents);
    insert into public.payment_allocations (payment_id, fee_id, amount_cents, source)
    values (p_payment_id, f.fee_id, take, 'marked');
    remaining := remaining - take;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Trigger de payments: los meses marcados llegan por un GUC local a la
-- transacción que solo register_payment_batch setea
-- ({"<member_id>": ["2026-05-01", ...]}); sin GUC, todo al más viejo.
create function private.payments_allocate_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  marked jsonb := nullif(current_setting('lonqui.marked_periods', true), '')::jsonb;
  periods date[];
begin
  if new.voided_at is not null then
    return null;
  end if;
  if marked is not null and marked ? new.member_id::text then
    select array_agg(x::date) into periods
    from jsonb_array_elements_text(marked -> new.member_id::text) x;
    perform private.allocate_marked(new.id, periods);
  end if;
  perform private.apply_credit(new.member_id, 'oldest_first');
  return null;
end;
$$;

-- Trigger de fees (statement): cuotas nuevas (cron, saldo anterior, ajustes)
-- absorben el crédito del socio.
create function private.fees_apply_credit_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m bigint;
begin
  -- Orden por socio: el mismo que el lote, para que cron y lote no se crucen
  -- tomando los bloqueos de socios en orden inverso.
  for m in select distinct i.member_id from inserted i where i.voided_at is null order by i.member_id loop
    perform private.apply_credit(m, 'credit');
  end loop;
  return null;
end;
$$;

-- Trigger de fees (row): anular una cuota libera su plata, que se reimputa.
create function private.fees_apply_credit_on_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_credit(new.member_id, 'credit');
  return null;
end;
$$;

-- Trigger de payments (row): anular un pago deja inertes sus imputaciones y
-- vuelve a deber lo que cubría; si otro pago del socio tiene saldo a favor,
-- lo cubre ya (nunca conviven deuda y saldo a favor).
create function private.payments_apply_credit_on_void()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.apply_credit(new.member_id, 'credit');
  return null;
end;
$$;

-- (Los triggers se crean en la sección 10, DESPUÉS de convertir y backfillear:
--  esos pasos no deben disparar el motor.)

-- -----------------------------------------------------------------------------
-- 7. Conversión: cada tramo vigente se anula y se reemplaza por sus meses.
--    Nada se borra. fees_void_guard exige un usuario con payments.void y no
--    hay sesión: se desactiva SOLO acá, dentro de la transacción; la auditoría
--    y fees_immutable siguen activas. Idempotente: sin tramos, no hace nada.
-- -----------------------------------------------------------------------------
create function private.migrate_opening_spans()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  s record;
  months integer;
  parts bigint[];
  n integer := 0;
begin
  if not exists (
    select 1 from public.fees f where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is not null
  ) then
    return 0;
  end if;

  execute 'alter table public.fees disable trigger fees_void_guard';

  for s in
    select f.id, f.member_id, f.amount_cents, f.from_period, f.to_period, f.created_by, f.created_at
    from public.fees f
    where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is not null
    order by f.id
  loop
    months := ((extract(year from s.to_period) - extract(year from s.from_period)) * 12
              + (extract(month from s.to_period) - extract(month from s.from_period)))::integer + 1;
    parts := private.split_opening_total(s.amount_cents, months);

    -- Primero anular (la fila con tramo ocupa (socio, inicio − 1) en el índice nuevo).
    update public.fees
    set voided_at = now(),
        voided_by = '00000000-0000-0000-0000-000000000000',
        void_reason = 'Convertido a saldo anterior por mes (migración 20261029120000)'
    where id = s.id;

    insert into public.fees (member_id, kind, period, amount_cents, description, created_by, created_at)
    select
      s.member_id,
      'opening_balance',
      (s.from_period + make_interval(months => k - 1))::date,
      parts[k],
      'Saldo anterior · ' || to_char((s.from_period + make_interval(months => k - 1))::date, 'MM/YYYY'),
      s.created_by,
      s.created_at
    from generate_series(1, months) k;

    n := n + 1;
  end loop;

  execute 'alter table public.fees enable trigger fees_void_guard';
  return n;
end;
$$;

select private.migrate_opening_spans();

-- -----------------------------------------------------------------------------
-- 8. Backfill: cada pago vigente imputado como el sistema lo mostraba hoy.
--    Pagos por (paid_on, id) y cargos por (period, saldo, deporte, id) son dos
--    acumulados; la imputación es el solape de intervalos. El remanente queda
--    como crédito. Solo si no hay ninguna imputación todavía.
-- -----------------------------------------------------------------------------
create function private.backfill_allocations()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if exists (select 1 from public.payment_allocations) then
    return 0;
  end if;

  insert into public.payment_allocations (payment_id, fee_id, amount_cents, source, created_by)
  with pays as (
    select p.id, p.member_id, p.amount_cents,
           sum(p.amount_cents) over (partition by p.member_id order by p.paid_on, p.id) as hi
    from public.payments p
    where p.voided_at is null
  ),
  charges as (
    select f.id, f.member_id, f.amount_cents,
           sum(f.amount_cents) over (
             partition by f.member_id
             order by f.period, case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id
           ) as hi
    from public.fees f
    where f.voided_at is null
  )
  select p.id, c.id, least(p.hi, c.hi) - greatest(p.hi - p.amount_cents, c.hi - c.amount_cents), 'backfill', null::uuid
  from pays p
  join charges c
    on c.member_id = p.member_id
   and least(p.hi, c.hi) > greatest(p.hi - p.amount_cents, c.hi - c.amount_cents)
  order by p.member_id, c.hi, p.hi;

  get diagnostics n = row_count;
  return n;
end;
$$;

select private.backfill_allocations();

-- -----------------------------------------------------------------------------
-- 9. Verificación. Cualquier diferencia aborta la migración entera (es una
--    transacción): mejor no migrar que migrar cambiando la deuda de alguien.
--    Mensajes con ids, nunca nombres.
-- -----------------------------------------------------------------------------
create function private.allocation_migration_verify()
returns void
language plpgsql
set search_path = ''
as $$
declare
  bad record;
  legacy integer;
begin
  -- (1) Cargos sin tramo: la cobertura es la misma.
  select s.member_id, s.fee_id, s.covered_cents as old_cents, coalesce(fs.paid_cents, 0) as new_cents
  into bad
  from pg_temp.mig_fees s
  left join public.fee_status fs on fs.fee_id = s.fee_id
  where s.from_period is null and coalesce(fs.paid_cents, 0) <> s.covered_cents
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: el cargo % (socio %) cambió de cobertura: % → %',
      bad.fee_id, bad.member_id, bad.old_cents, bad.new_cents;
  end if;

  -- (2) Cada mes de cada tramo: una fila vigente con el mismo monto y la misma cobertura.
  select c.member_id, c.fee_id, c.period, c.amount_cents, c.covered_cents,
         fs.fee_id as new_fee_id, fs.amount_cents as new_amount, fs.paid_cents as new_paid
  into bad
  from pg_temp.mig_cells c
  left join public.fee_status fs
    on fs.member_id = c.member_id and fs.period = c.period and fs.kind = 'opening_balance'
  where fs.fee_id is null or fs.amount_cents <> c.amount_cents or fs.paid_cents <> c.covered_cents
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: el mes % del saldo % (socio %) no coincide: monto %/%, cubierto %/%',
      bad.period, bad.fee_id, bad.member_id, bad.amount_cents, bad.new_amount, bad.covered_cents, bad.new_paid;
  end if;

  -- (3) Por socio: deuda y crédito idénticos a cargos − pagos.
  select m.member_id, (m.charged_cents - m.paid_cents) as old_balance,
         coalesce((select sum(fs.pending_cents) from public.fee_status fs where fs.member_id = m.member_id), 0) as pending,
         coalesce((select sum(pc.credit_cents) from public.payment_credit pc where pc.member_id = m.member_id), 0) as credit
  into bad
  from pg_temp.mig_members m
  where coalesce((select sum(fs.pending_cents) from public.fee_status fs where fs.member_id = m.member_id), 0)
          <> greatest(0, m.charged_cents - m.paid_cents)
     or coalesce((select sum(pc.credit_cents) from public.payment_credit pc where pc.member_id = m.member_id), 0)
          <> greatest(0, m.paid_cents - m.charged_cents)
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: socio % con saldo viejo %, pendiente nuevo % y crédito nuevo %',
      bad.member_id, bad.old_balance, bad.pending, bad.credit;
  end if;

  -- (4) Por socio: Σ tramos anulados = Σ filas nuevas por mes.
  select o.member_id, o.old_total, coalesce(nw.new_total, 0) as new_total
  into bad
  from (
    select s.member_id, sum(s.amount_cents) as old_total
    from pg_temp.mig_fees s where s.kind = 'opening_balance' and s.from_period is not null
    group by s.member_id
  ) o
  left join (
    select f.member_id, sum(f.amount_cents) as new_total
    from public.fees f
    where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is null
      and not exists (select 1 from pg_temp.mig_fees s where s.fee_id = f.id)
    group by f.member_id
  ) nw on nw.member_id = o.member_id
  where coalesce(nw.new_total, 0) <> o.old_total
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: socio % con tramos por % y filas por mes por %',
      bad.member_id, bad.old_total, bad.new_total;
  end if;

  -- (5) Por pago: nunca más de su monto; nada apunta a algo anulado.
  select p.id, p.amount_cents, sum(a.amount_cents) as allocated
  into bad
  from public.payments p
  join public.payment_allocations a on a.payment_id = p.id
  group by p.id, p.amount_cents
  having sum(a.amount_cents) > p.amount_cents
  limit 1;
  if found then
    raise exception 'Migración de imputaciones: el pago % quedó imputado por % sobre un monto de %',
      bad.id, bad.allocated, bad.amount_cents;
  end if;
  if exists (
    select 1 from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    join public.fees f on f.id = a.fee_id
    where p.voided_at is not null or f.voided_at is not null
  ) then
    raise exception 'Migración de imputaciones: hay imputaciones a pagos o cuotas anulados';
  end if;

  -- (6) Global: Σ imputado + Σ crédito = Σ pagos vigentes.
  if (select coalesce(sum(a.amount_cents), 0) from public.payment_allocations a)
     + (select coalesce(sum(pc.credit_cents), 0) from public.payment_credit pc)
     <> (select coalesce(sum(p.amount_cents), 0) from public.payments p where p.voided_at is null) then
    raise exception 'Migración de imputaciones: Σ imputado + Σ crédito ≠ Σ pagos vigentes';
  end if;

  select count(*) into legacy
  from public.fees f
  where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is null
    and exists (select 1 from pg_temp.mig_fees s where s.fee_id = f.id);
  raise notice 'Migración de imputaciones: % saldos sin tramo quedaron como una fila del mes anterior al inicio', legacy;

  execute 'drop table pg_temp.mig_fees';
  execute 'drop table pg_temp.mig_cells';
  execute 'drop table pg_temp.mig_members';
end;
$$;

select private.allocation_migration_verify();

-- -----------------------------------------------------------------------------
-- 10. Triggers del motor (recién ahora).
-- -----------------------------------------------------------------------------
create trigger payments_allocate_on_insert
  after insert on public.payments
  for each row execute function private.payments_allocate_on_insert();

create trigger fees_apply_credit_on_insert
  after insert on public.fees
  referencing new table as inserted
  for each statement execute function private.fees_apply_credit_on_insert();

-- Sin `of voided_at`: la app anula con `set void_reason` y el guard BEFORE
-- pone voided_at, que no está en el SET; un trigger `update of voided_at` no
-- dispararía nunca (review B1). El WHEN ya lo acota a la anulación.
create trigger fees_apply_credit_on_void
  after update on public.fees
  for each row
  when (old.voided_at is null and new.voided_at is not null)
  execute function private.fees_apply_credit_on_void();

create trigger payments_apply_credit_on_void
  after update on public.payments
  for each row
  when (old.voided_at is null and new.voided_at is not null)
  execute function private.payments_apply_credit_on_void();

-- -----------------------------------------------------------------------------
-- 11. Lecturas sobre el libro (mismas firmas; create or replace conserva grants).
-- -----------------------------------------------------------------------------
create or replace function private.member_fee_coverage(p_member_id bigint)
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
  select
    f.id,
    f.period,
    f.kind,
    f.description,
    f.amount_cents,
    case when f.voided_at is not null then 0::bigint
      else coalesce((
        select sum(a.amount_cents)
        from public.payment_allocations a
        join public.payments p on p.id = a.payment_id
        where a.fee_id = f.id and p.voided_at is null
      ), 0)::bigint
    end,
    f.category_id,
    f.discipline_id,
    f.voided_at,
    f.void_reason,
    row_number() over (order by f.period, case f.kind when 'opening_balance' then 0 else 1 end, f.discipline_id nulls first, f.id)
  from public.fees f
  where f.member_id = p_member_id;
$$;

create or replace function private.member_balance(p_member_id bigint)
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
  charged as (
    select coalesce(sum(f.amount_cents), 0)::bigint as total
    from public.fees f
    where f.member_id = p_member_id and f.voided_at is null
  ),
  last_payment as (
    select p.paid_on, p.amount_cents
    from public.payments p
    where p.member_id = p_member_id and p.voided_at is null
    order by p.paid_on desc, p.id desc
    limit 1
  ),
  due as (
    select count(distinct fs.period)::integer as months, min(fs.period) as oldest
    from public.fee_status fs
    where fs.member_id = p_member_id and fs.pending_cents > 0
  )
  select
    charged.total,
    paid.total,
    charged.total - paid.total,
    due.months,
    due.oldest,
    (select lp.paid_on from last_payment lp),
    (select lp.amount_cents from last_payment lp)
  from charged, paid, due;
$$;

-- payment_month_options: celdas desde fee_status por mes. Sale opening_from
-- (no hay tramos), entra before_joined (solo pre_system: mes anterior al mes
-- de alta). pre_system = los 12 meses previos SIN fila de saldo vigente.
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
  before_joined boolean
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
      date_trunc('month', m.joined_on)::date as joined_period,
      coalesce(
        nullif(private.member_fee_price_at(m.id, current_period), 0),
        private.member_fee_price_at(m.id, greatest(current_period, start_period))
      ) as price_today,
      coalesce((select sum(pc.credit_cents) from public.payment_credit pc where pc.member_id = m.id), 0)::bigint as credit_cents
    from public.members m
    where m.id = any (payment_month_options.member_ids)
  ),
  cells as (
    select
      fs.member_id,
      fs.period,
      case when bool_or(fs.kind = 'opening_balance') then 'opening_balance' else 'monthly' end as kind,
      sum(fs.amount_cents)::bigint as amount_cents,
      sum(fs.paid_cents)::bigint as covered_cents,
      sum(fs.pending_cents)::bigint as pending_cents
    from public.fee_status fs
    join target t on t.id = fs.member_id
    group by fs.member_id, fs.period
  ),
  first_due as (
    select c.member_id, min(c.period) as period
    from cells c
    where c.pending_cents > 0
    group by c.member_id
  ),
  billed as (
    select c.*
    from cells c
    left join first_due fd on fd.member_id = c.member_id
    where c.period >= coalesce(fd.period, current_period)
       -- Carga inicial: mientras no empezó la facturación se ve todo el saldo, también lo pago.
       or (c.kind = 'opening_balance' and current_period < start_period)
  ),
  projected as (
    select
      t.id as member_id,
      gs::date as period,
      private.member_fee_price_at(t.id, gs::date) as amount_cents,
      t.price_today,
      t.credit_cents
    from target t
    cross join generate_series(greatest(start_period, current_period), horizon, interval '1 month') gs
    where t.status = 'active'
      and not exists (
        select 1 from public.fees f
        where f.member_id = t.id and f.kind = 'monthly' and f.period = gs::date
      )
  ),
  projected_covered as (
    -- Preview de lo que hará el generador: el crédito, en orden.
    select
      p.member_id,
      p.period,
      p.amount_cents,
      greatest(0, least(
        p.amount_cents,
        p.credit_cents - (sum(p.amount_cents) over (partition by p.member_id order by p.period) - p.amount_cents)
      ))::bigint as covered_cents,
      (p.amount_cents = p.price_today) as priced_at_today
    from projected p
  ),
  pre_system as (
    select
      t.id as member_id,
      gs::date as period,
      t.price_today as amount_cents,
      (gs::date < t.joined_period) as before_joined
    from target t
    cross join generate_series(
      least((start_period - interval '1 month')::date, current_period) - interval '11 months',
      least((start_period - interval '1 month')::date, current_period),
      interval '1 month'
    ) gs
    where t.joined_period <= start_period
      and not exists (
        select 1 from public.fees f
        where f.member_id = t.id and f.kind = 'opening_balance' and f.voided_at is null and f.period = gs::date
      )
  )
  select b.member_id, b.period, b.kind, b.amount_cents, b.covered_cents, b.pending_cents,
         b.period = current_period, false, false
  from billed b
  union all
  select pc.member_id, pc.period, 'projected', pc.amount_cents, pc.covered_cents,
         (pc.amount_cents - pc.covered_cents)::bigint, pc.period = current_period, pc.priced_at_today, false
  from projected_covered pc
  union all
  select ps.member_id, ps.period, 'pre_system', ps.amount_cents, 0::bigint,
         ps.amount_cents, ps.period = current_period, true, ps.before_joined
  from pre_system ps
  order by 1, 2;
end;
$$;

-- register_payment_batch: ítems
--   { "member_id", "amount_cents",
--     "marked_periods": ["2026-05-01", ...] | null,
--     "opening_months": [{ "period": "2026-03-01", "amount_cents": 1000000 }, ...] | null,
--     "opening_balance": { from_period, to_period, amount_cents, description } | null   -- forma vieja, se expande }
-- Mismo retorno. opening_balance_fee_id = la primera fila de saldo del socio en el lote.
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
  om jsonb;
  from_p date;
  to_p date;
  ob_amount bigint;
  months integer;
  parts bigint[];
  om_count integer;
  om_distinct integer;
  om_bad integer;
  mp_count integer;
  mp_distinct integer;
  mp_bad integer;
  first_id bigint;
  ob_members bigint[] := '{}';
  ob_ids bigint[] := '{}';
  marked jsonb := '{}'::jsonb;
begin
  if not private.can('payments.register') then
    raise exception 'No tenés permiso para registrar pagos' using errcode = 'insufficient_privilege';
  end if;

  if register_payment_batch.batch_id is null then
    raise exception 'El identificador del lote no es válido' using errcode = 'check_violation';
  end if;
  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'Cargá al menos un pago' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(items) = 0 then
    raise exception 'Cargá al menos un pago' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('lonqui.payment_batch:' || register_payment_batch.batch_id::text));

  -- Reintento: el lote ya existe. Las filas de saldo del lote comparten
  -- created_at con los pagos (misma transacción); se devuelve la primera.
  if exists (select 1 from public.payments p where p.batch_id = register_payment_batch.batch_id) then
    return query
    select p.member_id, p.id, p.amount_cents,
           (select min(f.id) from public.fees f
             where f.member_id = p.member_id and f.kind = 'opening_balance' and f.created_at = p.created_at
               and f.voided_at is null),
           true
    from public.payments p
    where p.batch_id = register_payment_batch.batch_id
    order by p.id;
    return;
  end if;

  select s.billing_start_period into start_period from public.settings s where s.id = 1;

  for item in
    select x.member_id, x.amount_cents, x.marked_periods, x.opening_months, x.opening_balance
    from jsonb_to_recordset(items)
      as x(member_id bigint, amount_cents bigint, marked_periods jsonb, opening_months jsonb, opening_balance jsonb)
  loop
    if item.member_id is null then
      raise exception 'Elegí el socio' using errcode = 'check_violation';
    end if;
    if item.amount_cents is null or item.amount_cents <= 0 then
      raise exception 'El monto tiene que ser mayor a cero' using errcode = 'check_violation';
    end if;

    -- Meses marcados: forma (el motor decide los montos).
    if item.marked_periods is not null and jsonb_typeof(item.marked_periods) <> 'null' then
      if jsonb_typeof(item.marked_periods) <> 'array' then
        raise exception 'Los meses marcados no son válidos' using errcode = 'check_violation';
      end if;
      select count(*), count(distinct p.value),
             count(*) filter (where p.value is null or (p.value)::date <> date_trunc('month', (p.value)::date)::date)
      into mp_count, mp_distinct, mp_bad
      from jsonb_array_elements_text(item.marked_periods) p;
      if mp_bad > 0 or mp_count > 60 or mp_count <> mp_distinct then
        raise exception 'Los meses marcados no son válidos' using errcode = 'check_violation';
      end if;
      if mp_count > 0 then
        marked := marked || jsonb_build_object(item.member_id::text, item.marked_periods);
      end if;
    end if;

    -- Saldo anterior: forma nueva (por mes) o vieja (tramo, expandida).
    om := null;
    if item.opening_months is not null and jsonb_typeof(item.opening_months) = 'array' then
      om := item.opening_months;
    elsif item.opening_balance is not null and jsonb_typeof(item.opening_balance) = 'object' then
      from_p := (item.opening_balance ->> 'from_period')::date;
      to_p := (item.opening_balance ->> 'to_period')::date;
      ob_amount := (item.opening_balance ->> 'amount_cents')::bigint;
      if from_p is null or to_p is null or from_p > to_p
         or from_p <> date_trunc('month', from_p)::date
         or to_p <> date_trunc('month', to_p)::date
         or to_p > (from_p + interval '35 months')::date then
        raise exception 'Los meses del saldo anterior no son válidos' using errcode = 'check_violation';
      end if;
      if ob_amount is null or ob_amount <= 0 then
        raise exception 'El saldo anterior tiene que ser mayor a cero' using errcode = 'check_violation';
      end if;
      months := ((extract(year from to_p) - extract(year from from_p)) * 12
                + (extract(month from to_p) - extract(month from from_p)))::integer + 1;
      parts := private.split_opening_total(ob_amount, months);
      select jsonb_agg(jsonb_build_object(
               'period', to_char((from_p + make_interval(months => k - 1))::date, 'YYYY-MM-DD'),
               -- Sin descripción: la del tramo ("julio a septiembre") mentiría en
               -- cada mes; el guard pone la de cada fila.
               'amount_cents', parts[k]))
      into om
      from generate_series(1, months) k;
    end if;

    if om is not null then
      if start_period is null then
        raise exception 'Primero activá las cuotas en Ajustes' using errcode = 'check_violation';
      end if;
      select count(*), count(distinct (m ->> 'period')),
             count(*) filter (
               where (m ->> 'period') is null
                  or (m ->> 'period')::date <> date_trunc('month', (m ->> 'period')::date)::date
                  or (m ->> 'period')::date >= start_period
                  or (m ->> 'amount_cents') is null
                  or (m ->> 'amount_cents')::bigint <= 0
             )
      into om_count, om_distinct, om_bad
      from jsonb_array_elements(om) m;
      if om_count = 0 or om_count > 36 or om_count <> om_distinct then
        raise exception 'Los meses del saldo anterior no son válidos' using errcode = 'check_violation';
      end if;
      if om_bad > 0 then
        raise exception 'El saldo anterior solo cubre meses anteriores a % y cada mes tiene que ser mayor a cero',
          to_char(start_period, 'MM/YYYY') using errcode = 'check_violation';
      end if;

      -- Solo columnas con grant de INSERT. El guard valida y pone la descripción
      -- por defecto; el trigger de fees aplica el crédito previo del socio.
      with ins as (
        insert into public.fees (member_id, kind, period, amount_cents, description)
        select item.member_id, 'opening_balance', (m ->> 'period')::date, (m ->> 'amount_cents')::bigint,
               nullif(btrim(m ->> 'description'), '')
        from jsonb_array_elements(om) m
        returning id
      )
      select min(id) into first_id from ins;

      ob_members := ob_members || item.member_id;
      ob_ids := ob_ids || first_id;
    end if;
  end loop;

  -- Los meses marcados viajan al trigger de payments por un GUC local a la transacción.
  perform set_config('lonqui.marked_periods', marked::text, true);

  insert into public.payments (member_id, amount_cents, paid_on, method, receipt_storage_path, notes, batch_id)
  select
    x.member_id,
    x.amount_cents,
    register_payment_batch.paid_on,
    register_payment_batch.method,
    register_payment_batch.receipt_storage_path,
    register_payment_batch.notes,
    register_payment_batch.batch_id
  from jsonb_to_recordset(items) as x(member_id bigint, amount_cents bigint)
  -- Mismo orden de bloqueo de socios que el trigger de cuotas (cron).
  order by x.member_id;

  perform set_config('lonqui.marked_periods', '', true);

  return query
  select p.member_id, p.id, p.amount_cents, ob.fee_id, false
  from public.payments p
  left join unnest(ob_members, ob_ids) as ob(m_id, fee_id) on ob.m_id = p.member_id
  where p.batch_id = register_payment_batch.batch_id
  order by p.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Grants. El drop se llevó los de payment_month_options; create or replace
--     conservó los de register_payment_batch, member_fee_coverage y
--     member_balance (se repiten igual). Ninguna función de private para
--     PUBLIC; a mano las que las RPC INVOKER necesitan. El motor y las
--     funciones de migración: para nadie (las disparan triggers / las corre la
--     migración y el test como postgres).
-- -----------------------------------------------------------------------------
revoke execute on function
  public.payment_month_options(bigint[]),
  public.register_payment_batch(uuid, date, text, text, text, jsonb)
from public, anon;

grant execute on function
  public.payment_month_options(bigint[]),
  public.register_payment_batch(uuid, date, text, text, text, jsonb)
to authenticated;

revoke execute on all functions in schema private from public, anon;

grant execute on function
  private.member_fee_coverage(bigint),
  private.member_balance(bigint),
  private.split_opening_total(bigint, integer)
to authenticated, service_role;

revoke execute on function
  private.apply_credit(bigint, text),
  private.allocate_marked(bigint, date[]),
  private.payments_allocate_on_insert(),
  private.fees_apply_credit_on_insert(),
  private.fees_apply_credit_on_void(),
  private.payments_apply_credit_on_void(),
  private.payment_allocations_insert_guard(),
  private.migrate_opening_spans(),
  private.backfill_allocations(),
  private.allocation_migration_snapshot(),
  private.allocation_migration_verify()
from public, anon, authenticated, service_role;
