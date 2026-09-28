-- =============================================================================
-- seed-demo.sql — Carga de DEMO para desarrollo, opcional y aditiva.
--
-- Pipeline: docs/pipelines/2026-09-28-ui-expresiva/ (tarea B2). Sirve para que
-- los gráficos nuevos (evolución de 12 meses, deuda por categoría, ritmo de
-- cobranza del mes) tengan volumen parecido al del club real y no la línea
-- plana / el único punto que da el seed por defecto (11 socios, 13 cargos, 5
-- pagos). NO reemplaza ni modifica `supabase/seed.sql` (el seed real, que
-- sigue siendo el default de `db:reset`): este archivo es un agregado manual,
-- solo para el ambiente LOCAL de un desarrollador. Nunca se corre contra el
-- ambiente de prueba de la Comisión ni contra ningún ambiente hosted.
--
-- Todos los nombres, DNI, teléfonos y emails de este archivo son INVENTADOS
-- (Ley 25.326, mismo criterio que `seed.sql`). Los DNI usan el rango
-- 90000001–90000200: ningún DNI real ni el de `seed.sql` empieza con "9", así
-- que no puede haber colisión con el índice único `members_dni_key`. Los CSV
-- reales de `docs/relevamiento/` no se tocan ni se usan como referencia de
-- datos (solo de forma: cuántos socios, qué categorías).
--
-- CÓMO CORRERLO
--   1. npm run db:reset                     (corre las migraciones + seed.sql)
--   2. psql "$DB_URL" -f supabase/seed-demo.sql
--      (o, contra el contenedor local: docker exec -i supabase_db_lonqui
--       psql -U postgres -v ON_ERROR_STOP=1 < supabase/seed-demo.sql)
--
-- IDEMPOTENCIA: el script chequea al principio si ya hay socios de demo
-- (DNI que empiezan con "90000") y si los encuentra no hace nada (lo avisa
-- por consola). Correrlo dos veces no duplica nada. No hay forma de "sacar"
-- la demo con este mismo script: en un ambiente local, la forma de volver
-- atrás es `npm run db:reset` (que descarta TODA la base, real seed incluido).
--
-- QUÉ HACE, EN ORDEN
--   1. ~200 socios inventados, repartidos en las disciplinas/categorías que ya
--      sembró `seed.sql` (no crea disciplinas ni categorías nuevas): ~90%
--      practicantes / 10% no practicantes, altas repartidas en los últimos 12
--      meses.
--   2. 8 grupos familiares (4 integrantes cada uno, un responsable de pago
--      por grupo).
--   3. Retrocede `settings.billing_start_period` a 12 meses atrás y genera un
--      valor de cuota histórico, para que `private.generate_monthly_fees`
--      pueda generar los 12 períodos de historia (ver la nota grande más
--      abajo: esto pisa a propósito, y SOLO en este script, dos triggers que
--      protegen esa misma operación en el uso normal de la app).
--   4. Cuotas mensuales de los últimos 12 períodos, con
--      `private.generate_monthly_fees(period)` (nunca simulando `now()`).
--   5. Pagos repartidos en esos 12 meses (efectivo/transferencia, algunos de
--      una cuota y otros adelantando varias, ~2-3% anulados), con una
--      distribución de deuda final variada a propósito: la mayoría al día,
--      una porción 1-3 meses atrás, un puñado con mora larga (6+ meses) y
--      unos pocos con saldo a favor. El mes en curso queda cobrado a medias,
--      con pagos en distintos días, para que el gráfico diario tenga forma.
--   6. Un puñado de bajas (con motivo) repartidas en el año, algunas
--      reactivadas después, para que "altas y bajas del mes" del panel no dé
--      siempre cero.
-- =============================================================================

select case when not exists (
  select 1 from public.members where dni ~ '^90000'
) then 'true' else 'false' end as seed_demo_pending
\gset

\if :seed_demo_pending

begin;

-- -----------------------------------------------------------------------------
-- 0) Categorías disponibles (las que ya sembró seed.sql — no se crea ninguna).
-- -----------------------------------------------------------------------------
create temporary table demo_categories on commit drop as
select c.id as category_id, row_number() over (order by d.sort_order, c.sort_order) as rn
from public.categories c
join public.disciplines d on d.id = c.discipline_id
where c.is_active;

select count(*) as demo_category_count from demo_categories \gset

-- -----------------------------------------------------------------------------
-- 1) 8 grupos familiares (4 integrantes cada uno, más abajo).
-- -----------------------------------------------------------------------------
insert into public.family_groups (name)
select 'Familia Demo ' || g
from generate_series(1, 8) as g;

create temporary table demo_family_groups on commit drop as
select row_number() over (order by id) as slot, id as group_id
from public.family_groups
where name like 'Familia Demo %';

-- -----------------------------------------------------------------------------
-- 2) ~200 socios inventados: nombre, apellido, DNI, teléfono y email de
-- relleno, altas repartidas en los últimos 12 meses, 90% practicante.
-- -----------------------------------------------------------------------------
create temporary table demo_members_stage on commit drop as
select
  n,
  (array[
    'Mateo','Sofía','Lucas','Valentina','Bruno','Camila','Tomás','Martina','Joaquín','Agustina',
    'Nicolás','Julieta','Franco','Micaela','Ezequiel','Rocío','Ignacio','Florencia','Santiago','Milagros',
    'Gonzalo','Antonella','Emiliano','Candela'
  ])[1 + (n % 24)] as first_name,
  (array[
    'Gómez','Fernández','Rodríguez','López','Martínez','Díaz','Pereyra','Sosa','Romero','Acosta',
    'Benítez','Ibáñez','Cáceres','Molina','Ríos','Aguirre','Ojeda','Correa','Ledesma','Villalba',
    'Escobar','Maidana','Bazán','Ferreyra'
  ])[1 + ((n * 7 + 3) % 24)] as last_name,
  (90000000 + n)::text as dni,
  ('2994' || lpad((500000 + n)::text, 6, '0')) as phone,
  case when n % 3 = 0 then 'socio.demo' || n || '@example.com' else null end as email,
  (current_date - ((16 + (n % 50)) || ' years')::interval)::date as birth_date,
  (n % 10 <> 0) as practicing,
  case when (n % 10) <> 0
    then (select category_id from demo_categories where rn = 1 + (n % :demo_category_count))
  end as category_id,
  case when n <= 32 then ((n - 1) / 4) + 1 end as family_slot,
  (n <= 32 and (n - 1) % 4 = 0) as is_resp,
  least(
    (date_trunc('month', private.club_today())
      - ((n % 12) || ' months')::interval
      + ((1 + (n * 5) % 27) || ' days')::interval)::date,
    private.club_today()
  ) as joined_on
from generate_series(1, 200) as n;

insert into public.members (
  first_name, last_name, dni, birth_date, phone, email,
  family_group_id, is_payment_responsible, joined_on, notes
)
select
  s.first_name, s.last_name, s.dni, s.birth_date, s.phone, s.email,
  fg.group_id, s.is_resp, s.joined_on,
  'Dato de demo, inventado (docs/pipelines/2026-09-28-ui-expresiva)'
from demo_members_stage s
left join demo_family_groups fg on fg.slot = s.family_slot;

-- Inscripción en categoría = la de alta (member_type lo deriva el trigger).
insert into public.member_categories (member_id, category_id, joined_on)
select m.id, s.category_id, s.joined_on
from demo_members_stage s
join public.members m on m.dni = s.dni
where s.practicing;

-- -----------------------------------------------------------------------------
-- 3) Retroceder el inicio de facturación a 12 meses atrás.
--
-- `seed.sql` ya activó la facturación este mes y ya generó las cuotas del mes
-- en curso para sus propios socios (`generate_pending_fees('cron')`). Eso deja
-- dos invariantes reales del dominio en el camino de este script:
--   - `settings_billing_guard` no deja cambiar `billing_start_period` una vez
--     que existe CUALQUIER cuota 'monthly' — justamente para que nadie
--     reescriba a mitad de camino desde cuándo se factura. Ya hay cuotas
--     (las de seed.sql), así que un UPDATE normal acá chocaría.
--   - `fee_prices_insert_guard` no deja cargar un valor de cuota con
--     `valid_from` en el pasado — para que nadie reescriba lo que ya se
--     cobró. El valor que necesitamos acá es "del pasado" a propósito: es
--     el valor con el que la demo factura los 12 meses de historia.
-- Las dos son correctas para el uso normal de la aplicación. Achica el
-- alcance: esto es SOLO un script de demo/desarrollo, nunca migraciones ni
-- código de producto, así que se sortean apagando cada trigger un instante y
-- prendiéndolo de nuevo enseguida, en la misma transacción.
-- -----------------------------------------------------------------------------
do $$
declare
  current_period date := date_trunc('month', private.club_today())::date;
  start_period date := (current_period - interval '11 months')::date;
begin
  execute 'alter table public.fee_prices disable trigger fee_prices_insert_guard';
  insert into public.fee_prices (scope, amount_cents, valid_from, notes)
  select 'default', 1000000, start_period, 'Valor histórico de demo (12 meses), pipeline 2026-09-28-ui-expresiva'
  where not exists (
    select 1 from public.fee_prices where scope = 'default' and valid_from = start_period
  );
  execute 'alter table public.fee_prices enable trigger fee_prices_insert_guard';

  execute 'alter table public.settings disable trigger settings_billing_guard';
  update public.settings set billing_start_period = start_period where id = 1;
  execute 'alter table public.settings enable trigger settings_billing_guard';
end $$;

-- -----------------------------------------------------------------------------
-- 4) Cuotas de los últimos 12 períodos, generador real (nunca simula `now()`).
-- Cubre también a los socios de `seed.sql`: es un efecto secundario aceptado
-- de retroceder el inicio de facturación (les da más historia, no menos).
-- -----------------------------------------------------------------------------
do $$
declare
  current_period date := date_trunc('month', private.club_today())::date;
  p date := (current_period - interval '11 months')::date;
  created integer;
begin
  while p <= current_period loop
    created := private.generate_monthly_fees(p);
    raise notice 'seed-demo: cuotas de % -> % generadas', p, created;
    p := (p + interval '1 month')::date;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5) Pagos: perfil de mora por socio (según su número de orden `n`, sacado
-- del DNI), del más viejo al más nuevo (misma cobertura que usa la app,
-- `private.member_fee_coverage`: pagar los N cargos más viejos dejando los
-- últimos `skip_months` sin cubrir alcanza para simular exactamente eso, sin
-- tener que imitar la función).
--   n <= 140  (70%): al día — paga todos los períodos que tiene.
--   n 141-186 (23%): 1 a 3 meses atrás.
--   n 187-196  (5%): mora larga, 6 a 9 meses.
--   n 197-200  (2%): paga de más — saldo a favor.
-- Un cuarto de los socios (n % 4 = 0), más los que quedan con saldo a favor,
-- pagan todo junto en un solo pago (varias cuotas adelantadas, o una de más
-- para el saldo a favor); el resto paga cada período por separado. ~1 de cada 40
-- pagos queda anulado con motivo (~2.5%), insertado YA anulado (igual que
-- `seed.sql`): sin sesión, `private.can('payments.void')` da `false`, así que
-- anularlo con un UPDATE fallaría por RLS/guard; cargarlo directamente ya
-- anulado no pasa por esa regla porque el guard de anulación solo corre en
-- UPDATE, nunca en INSERT.
-- El mes en curso se reparte en distintos días (no todos el día 1): es lo que
-- le da forma a la curva diaria de `/cobranza`.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  n integer;
  fee_count integer;
  skip_months integer;
  is_credit boolean;
  pay_count integer;
  fee_ids bigint[];
  fee_amounts bigint[];
  fee_periods date[];
  lump boolean;
  batch uuid;
  method text;
  pay_date date;
  amount bigint;
  i integer;
  void_counter integer := 0;
  current_period date := date_trunc('month', private.club_today())::date;
  today date := private.club_today();
  day_span integer;
begin
  for r in
    select m.id as member_id, m.dni
    from public.members m
    where m.dni ~ '^90000'
    order by m.id
  loop
    n := (r.dni)::bigint - 90000000;

    if n <= 140 then
      skip_months := 0; is_credit := false;
    elsif n <= 186 then
      skip_months := 1 + (n % 3); is_credit := false;
    elsif n <= 196 then
      skip_months := 6 + (n % 4); is_credit := false;
    else
      skip_months := 0; is_credit := true;
    end if;

    select count(*) into fee_count
    from public.fees f
    where f.member_id = r.member_id and f.kind = 'monthly' and f.voided_at is null;

    continue when fee_count = 0;

    pay_count := greatest(fee_count - skip_months, 0);
    continue when pay_count = 0;

    select
      array_agg(x.id order by x.period),
      array_agg(x.amount_cents order by x.period),
      array_agg(x.period order by x.period)
    into fee_ids, fee_amounts, fee_periods
    from (
      select id, amount_cents, period
      from public.fees
      where member_id = r.member_id and kind = 'monthly' and voided_at is null
      order by period
      limit pay_count
    ) x;

    -- Los socios "con crédito" SIEMPRE van por el pago único: es la única
    -- rama que suma el mes de más que los deja en saldo a favor.
    lump := (n % 4 = 0) or is_credit;
    method := case when n % 2 = 0 then 'cash' else 'transfer' end;

    if lump then
      amount := (select sum(x) from unnest(fee_amounts) as x);
      if is_credit then
        amount := amount + 1000000;
      end if;

      if fee_periods[array_length(fee_periods, 1)] = current_period then
        day_span := greatest(extract(day from today)::integer, 1);
        pay_date := least((current_period + (n % day_span))::date, today);
      else
        pay_date := least(
          (fee_periods[array_length(fee_periods, 1)] + (1 + (n % 25)) * interval '1 day')::date,
          (fee_periods[array_length(fee_periods, 1)] + interval '1 month' - interval '1 day')::date
        );
      end if;

      batch := gen_random_uuid();
      void_counter := void_counter + 1;
      if void_counter % 40 = 0 then
        insert into public.payments (member_id, amount_cents, method, batch_id, paid_on, voided_at, voided_by, void_reason)
        values (r.member_id, amount, method, batch, pay_date, now(), '00000000-0000-0000-0000-000000000000', 'Carga duplicada (demo)');
      else
        insert into public.payments (member_id, amount_cents, method, batch_id, paid_on)
        values (r.member_id, amount, method, batch, pay_date);
      end if;
    else
      for i in 1 .. array_length(fee_ids, 1) loop
        if fee_periods[i] = current_period then
          day_span := greatest(extract(day from today)::integer, 1);
          pay_date := least((current_period + ((n + i) % day_span))::date, today);
        else
          pay_date := least(
            (fee_periods[i] + (1 + ((n * 7 + i) % 25)) * interval '1 day')::date,
            (fee_periods[i] + interval '1 month' - interval '1 day')::date
          );
        end if;

        batch := gen_random_uuid();
        void_counter := void_counter + 1;
        if void_counter % 40 = 0 then
          insert into public.payments (member_id, amount_cents, method, batch_id, paid_on, voided_at, voided_by, void_reason)
          values (r.member_id, fee_amounts[i], method, batch, pay_date, now(), '00000000-0000-0000-0000-000000000000', 'Carga duplicada (demo)');
        else
          insert into public.payments (member_id, amount_cents, method, batch_id, paid_on)
          values (r.member_id, fee_amounts[i], method, batch, pay_date);
        end if;
      end loop;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 6) Bajas y reactivaciones repartidas en el año (fichas de egreso reales,
-- con motivo, por el mismo camino que usa la app: `member_status_events`).
-- Se hace DESPUÉS de generar cuotas y pagos a propósito: el generador de
-- cuotas solo mira el estado ACTUAL del socio (`members.status = 'active'`),
-- no el que tenía en cada período histórico. Si diéramos de baja antes de
-- generar, esos socios se quedarían sin ninguna cuota, ni siquiera la de los
-- meses en que sí estuvieron activos. Dándolas de baja después, conservan su
-- historia de cuotas y pagos y solo cambia su estado actual — es exactamente
-- lo que pasaría en la vida real si alguien se da de baja hoy.
-- -----------------------------------------------------------------------------
do $$
declare
  candidates integer[] := array[15, 45, 65, 85, 105, 125, 145, 165, 185, 199];
  reactivate_set integer[] := array[15, 65, 145];
  forced_current_month integer[] := array[125, 185];
  n integer;
  mem_id bigint;
  mem_joined date;
  w_date date;
  r_date date;
  today date := private.club_today();
  current_period date := date_trunc('month', today)::date;
begin
  foreach n in array candidates loop
    select id, joined_on into mem_id, mem_joined
    from public.members where dni = (90000000 + n)::text;

    continue when mem_id is null;

    if n = any (forced_current_month) then
      w_date := greatest(least((current_period + 5)::date, today), mem_joined);
    else
      w_date := greatest(least((mem_joined + interval '2 months')::date, today), mem_joined);
    end if;

    insert into public.member_status_events (member_id, event_type, effective_on, reason)
    values (mem_id, 'withdrawal', w_date, 'Baja de demo (docs/pipelines/2026-09-28-ui-expresiva)');

    if n = any (reactivate_set) then
      r_date := greatest(least((w_date + interval '2 months')::date, today), w_date + 1);
      if r_date <= today and r_date > w_date then
        insert into public.member_status_events (member_id, event_type, effective_on, reason)
        values (mem_id, 'reactivation', r_date, 'Reactivación de demo (docs/pipelines/2026-09-28-ui-expresiva)');
      end if;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Resumen para quien corre el script a mano.
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.members where dni ~ '^90000') as socios_demo,
  (select count(*) from public.member_categories mc join public.members m on m.id = mc.member_id where m.dni ~ '^90000') as inscripciones_demo,
  (select count(*) from public.fees where kind = 'monthly') as cuotas_totales,
  (select count(*) from public.payments p join public.members m on m.id = p.member_id where m.dni ~ '^90000') as pagos_demo,
  (select count(*) from public.payments p join public.members m on m.id = p.member_id where m.dni ~ '^90000' and p.voided_at is not null) as pagos_demo_anulados,
  (select count(*) from public.member_status_events e join public.members m on m.id = e.member_id where m.dni ~ '^90000' and e.event_type = 'withdrawal') as bajas_demo,
  (select count(*) from public.member_status_events e join public.members m on m.id = e.member_id where m.dni ~ '^90000' and e.event_type = 'reactivation') as reactivaciones_demo;

commit;

\echo 'seed-demo.sql: carga de demo aplicada.'

\else

\echo 'seed-demo.sql: ya hay socios de demo (DNI 90000001-90000200); no se hizo nada.'

\endif
