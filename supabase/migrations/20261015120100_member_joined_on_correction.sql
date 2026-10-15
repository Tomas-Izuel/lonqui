-- =============================================================================
-- Corrección de la fecha de alta de un socio.
--
-- Pipeline: docs/pipelines/2026-10-15-editar-fecha-ingreso/ (§6.3, §9).
--
-- Decisión de Tomás (2026-10-15): la fecha de alta deja de ser inmutable, pero
-- se corrige SOLO con correct_member_joined_on, que:
--   - exige members.write (permiso, no rol);
--   - rechaza la fecha nueva si dejara antes del alta algo que ya existe (baja
--     o reactivación, inscripción posterior o cerrada, cuota mensual no
--     anulada) o si es absurda (futura, anterior al nacimiento). Un pago
--     anterior al alta NO bloquea: la deuda sale de las cuotas;
--   - arrastra TODO lo que copió esa fecha al dar de alta: la ficha de ingreso
--     (member_status_events 'admission') y las inscripciones de
--     member_categories con joined_on = fecha vieja. Lo inscripto después, con
--     otra fecha, no se toca.
-- Es una corrección de carga, no una operación de negocio: sin motivo, sin
-- evento aparte. La auditoría de los UPDATE (actor, valor viejo y nuevo) es el
-- rastro. Mover la fecha a un mes anterior hace que la próxima corrida genere
-- las cuotas de esos meses, igual que un alta con fecha pasada.
--
-- Fuera de esa función las tres columnas siguen inmutables: los guards miran
-- un GUC local a la transacción (lonqui.joined_on_correction = id del socio)
-- que solo la función setea. Desde PostgREST no se llega: set_config no está
-- expuesto y ninguna de las tres columnas tiene grant de UPDATE.
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
    -- Mismo texto que protect_immutable_columns: los tests lo buscan.
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
    -- Mismo texto que forbid_change: los tests lo buscan.
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
  -- y con una inscripción, que también toman FOR UPDATE sobre la fila.
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

-- EXECUTE de PUBLIC sobre las funciones nuevas de private: no se revoca por
-- schema, se cierra a mano (CLAUDE.md). Son funciones de trigger: no necesitan
-- grant, Postgres no chequea EXECUTE al dispararlas.
revoke execute on all functions in schema private from public, anon;
