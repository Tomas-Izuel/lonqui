-- =============================================================================
-- Caja: otros ingresos, sponsors y conceptos
-- (pipeline docs/pipelines/2026-10-13-caja-otros-ingresos/).
--
-- Ingresos que no son cuota (sponsors, indumentaria, eventos…) en una tabla
-- de MOVIMIENTOS DE CAJA con sentido (`direction`). Hoy el CHECK solo admite
-- 'income': los egresos de mañana relajan el CHECK y suman UI sin cambiar la
-- forma. Las cuotas siguen en `payments`: la deuda se deriva de ahí y esta
-- migración no toca ninguna función de deuda ni de estado de cuenta.
--
-- Reversa: drop de cash_movements, sponsors, cash_concepts y sus funciones y
-- RPC; restaurar permissions_for_role (20260927125000), log_export
-- (20260927130200) y la policy attachments_insert (20260925120300).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permisos nuevos (catálogo: claves estables, se agregan, nunca se renombran)
--   income.read          otros ingresos, sponsors y conceptos (lectura)
--   income.register      registrar ingresos, subir comprobante, crear/editar sponsors
--   income.void          anular ingresos
--   sponsors.deactivate  desactivar y reactivar sponsors
-- Los conceptos se administran con settings.manage, que ya existe.
-- `create or replace` conserva los grants de la función.
-- -----------------------------------------------------------------------------
create or replace function private.permissions_for_role(role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case role
    when 'admin' then array[
      'members.read', 'members.write', 'members.status',
      'payments.read', 'payments.register', 'payments.void',
      'billing.configure', 'settings.manage', 'users.manage', 'audit.read',
      'reports.read', 'reports.export',
      'income.read', 'income.register', 'income.void', 'sponsors.deactivate'
    ]
    when 'editor' then array[
      'members.read', 'members.write',
      'payments.read', 'payments.register',
      'reports.read', 'reports.export',
      'income.read', 'income.register'
    ]
    when 'consulta' then array[
      'members.read', 'payments.read', 'reports.read', 'reports.export',
      'income.read'
    ]
    else array[]::text[]
  end;
$$;

-- -----------------------------------------------------------------------------
-- cash_concepts: conceptos de caja. Datos, no enums: el club los administra
-- desde /ajustes. Hoy solo de ingreso.
-- -----------------------------------------------------------------------------
create table public.cash_concepts (
  id bigint generated always as identity primary key,
  -- Mañana: check (direction in ('income', 'expense')). Inmutable: un
  -- concepto nunca cambia de sentido.
  direction text not null default 'income' check (direction in ('income')),
  name text not null check (length(btrim(name)) >= 2 and length(name) <= 120),
  -- Un movimiento con este concepto exige sponsor (lo hace cumplir el guard
  -- de cash_movements). Semilla: solo "Sponsor".
  requires_sponsor boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cash_concepts is
  'Conceptos de caja que administra el club. direction = income hoy; los egresos relajan el CHECK.';

-- Unique por sentido: mañana "Indumentaria" puede ser ingreso (venta) y egreso (compra).
create unique index cash_concepts_name_key on public.cash_concepts (direction, lower(btrim(name)));

create trigger cash_concepts_set_updated_at
  before update on public.cash_concepts
  for each row execute function private.set_updated_at();

create trigger cash_concepts_immutable
  before update on public.cash_concepts
  for each row execute function private.protect_immutable_columns('id', 'direction', 'created_at');

alter table public.cash_concepts enable row level security;
alter table public.cash_concepts force row level security;

create policy cash_concepts_select on public.cash_concepts
  for select to authenticated
  using ((select private.can('income.read')));
create policy cash_concepts_insert on public.cash_concepts
  for insert to authenticated
  with check ((select private.can('settings.manage')));
create policy cash_concepts_update on public.cash_concepts
  for update to authenticated
  using ((select private.can('settings.manage')))
  with check ((select private.can('settings.manage')));

revoke all on public.cash_concepts from anon, authenticated, service_role;
grant select on public.cash_concepts to authenticated, service_role;
grant insert (direction, name, requires_sponsor, is_active, sort_order) on public.cash_concepts to authenticated;
grant update (name, requires_sponsor, is_active, sort_order) on public.cash_concepts to authenticated;

select private.enable_audit('public.cash_concepts');

-- Semilla en la migración (no en seed.sql): el proyecto hosted nace de las
-- migraciones. El club los renombra o desactiva desde /ajustes. Corre como
-- postgres sin sesión: la auditoría los registra como 'system'.
insert into public.cash_concepts (direction, name, requires_sponsor, sort_order) values
  ('income', 'Sponsor', true, 1),
  ('income', 'Donación', false, 2),
  ('income', 'Indumentaria', false, 3),
  ('income', 'Evento', false, 4),
  ('income', 'Otro', false, 5)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- sponsors: catálogo. Un sponsor NO es un socio (decisión de Tomás).
-- -----------------------------------------------------------------------------
create table public.sponsors (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) >= 2 and length(name) <= 120),
  -- Datos de contacto de una persona: datos personales (Ley 25.326). Nunca en logs.
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or (email = lower(email) and length(email) <= 254)),
  notes text check (notes is null or length(notes) <= 1000),
  -- Desactivar = is_active false + motivo. Reactivar vuelve la tríada a null;
  -- el motivo de la baja queda en audit_log (A2).
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid,
  deactivation_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sponsors_deactivation_triad check (
    (is_active and deactivated_at is null and deactivated_by is null and deactivation_reason is null)
    or (not is_active and deactivated_at is not null and deactivated_by is not null
        and deactivation_reason is not null and length(btrim(deactivation_reason)) >= 3)
  )
);

comment on table public.sponsors is
  'Catálogo de sponsors. Nunca se borra: se desactiva con motivo. Sus aportes viven en cash_movements.';

create unique index sponsors_name_key on public.sponsors (lower(btrim(name)));

create trigger sponsors_set_updated_at
  before update on public.sponsors
  for each row execute function private.set_updated_at();

create trigger sponsors_immutable
  before update on public.sponsors
  for each row execute function private.protect_immutable_columns('id', 'created_by', 'created_at');

-- Dos cosas cambian de un sponsor y piden permisos distintos:
--   - sus datos (nombre, contacto): income.register;
--   - su estado (desactivar con motivo / reactivar): sponsors.deactivate.
-- Una policy FOR UPDATE no distingue columnas: lo distingue este guard.
create function private.sponsors_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  status_change boolean := new.is_active is distinct from old.is_active;
  triad_change boolean := new.deactivated_at is distinct from old.deactivated_at
    or new.deactivated_by is distinct from old.deactivated_by
    or new.deactivation_reason is distinct from old.deactivation_reason;
  data_change boolean := new.name is distinct from old.name
    or new.contact_name is distinct from old.contact_name
    or new.phone is distinct from old.phone
    or new.email is distinct from old.email
    or new.notes is distinct from old.notes;
begin
  if triad_change and not status_change then
    raise exception 'El estado del sponsor se cambia desactivándolo o reactivándolo'
      using errcode = 'check_violation';
  end if;

  if status_change then
    if not private.can('sponsors.deactivate') then
      raise exception 'No tenés permiso para desactivar o reactivar sponsors'
        using errcode = 'insufficient_privilege';
    end if;
    if not new.is_active then
      if new.deactivation_reason is null or length(btrim(new.deactivation_reason)) < 3 then
        raise exception 'Para desactivar un sponsor hace falta un motivo' using errcode = 'check_violation';
      end if;
      new.deactivated_at := now();
      new.deactivated_by := auth.uid();
    else
      new.deactivated_at := null;
      new.deactivated_by := null;
      new.deactivation_reason := null;
    end if;
  end if;

  if data_change and not private.can('income.register') then
    raise exception 'No tenés permiso para editar sponsors' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger sponsors_update_guard
  before update on public.sponsors
  for each row execute function private.sponsors_update_guard();

alter table public.sponsors enable row level security;
alter table public.sponsors force row level security;

create policy sponsors_select on public.sponsors
  for select to authenticated
  using ((select private.can('income.read')));
create policy sponsors_insert on public.sponsors
  for insert to authenticated
  with check ((select private.can('income.register')) and created_by = (select auth.uid()));
create policy sponsors_update on public.sponsors
  for update to authenticated
  using ((select private.can('income.register')) or (select private.can('sponsors.deactivate')))
  with check ((select private.can('income.register')) or (select private.can('sponsors.deactivate')));

revoke all on public.sponsors from anon, authenticated, service_role;
grant select on public.sponsors to authenticated, service_role;
grant insert (name, contact_name, phone, email, notes) on public.sponsors to authenticated;
-- deactivated_at / deactivated_by los fija el guard, no hace falta grant.
grant update (name, contact_name, phone, email, notes, is_active, deactivation_reason) on public.sponsors to authenticated;

select private.enable_audit('public.sponsors');

-- -----------------------------------------------------------------------------
-- cash_movements: el libro de caja (hoy, solo ingresos que no son cuota).
--
-- Un movimiento es un lote de uno: batch_id lo genera el formulario UNA vez y
-- es la idempotencia del submit (doble toque con mala señal = éxito repetido,
-- no dos ingresos). Nada se edita: se anula con motivo.
-- -----------------------------------------------------------------------------
create table public.cash_movements (
  id bigint generated always as identity primary key,
  -- Mañana: check (direction in ('income', 'expense')). La policy de INSERT
  -- también exige 'income': relajar esto es una migración con su pipeline.
  direction text not null default 'income' check (direction in ('income')),
  concept_id bigint not null references public.cash_concepts (id) on delete restrict,
  sponsor_id bigint references public.sponsors (id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  occurred_on date not null default private.club_today(),
  method text not null check (method in ('cash', 'transfer')),
  -- Ruta en el bucket `attachments`, nunca una URL. Carpeta = batch_id (existe
  -- antes que la fila: la subida es en dos pasos).
  receipt_storage_path text check (receipt_storage_path is null or receipt_storage_path like 'cash-receipts/%'),
  receipt_filename text,
  description text check (description is null or length(description) <= 500),
  batch_id uuid not null,
  -- Nullable solo por el seed. Desde la app la policy exige created_by = auth.uid().
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,

  constraint cash_movements_void_triad check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null
        and length(btrim(void_reason)) >= 3)
  )
);

comment on table public.cash_movements is
  'Movimientos de caja que no son cuota. Nunca tocan la deuda ni el estado de cuenta: eso vive en fees/payments.';

create unique index cash_movements_batch_id_key on public.cash_movements (batch_id);
create index cash_movements_concept_id_idx on public.cash_movements (concept_id);
create index cash_movements_sponsor_id_idx on public.cash_movements (sponsor_id) where sponsor_id is not null;
create index cash_movements_occurred_on_idx on public.cash_movements (occurred_on desc, id desc);

create trigger cash_movements_immutable
  before update on public.cash_movements
  for each row execute function private.protect_immutable_columns(
    'id', 'direction', 'concept_id', 'sponsor_id', 'amount_cents', 'occurred_on', 'method',
    'description', 'batch_id', 'created_by', 'created_at'
  );

-- SECURITY DEFINER (review B4 del slice 2): lee conceptos y sponsors sin
-- depender de la RLS de quien escribe.
create function private.cash_movements_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  concept record;
  sponsor_active boolean;
begin
  if new.occurred_on > private.club_today() then
    raise exception 'La fecha del ingreso no puede ser futura' using errcode = 'check_violation';
  end if;
  if new.occurred_on < date '2020-01-01' then
    raise exception 'La fecha del ingreso es demasiado vieja' using errcode = 'check_violation';
  end if;

  select c.direction, c.is_active, c.requires_sponsor into concept
  from public.cash_concepts c
  where c.id = new.concept_id;

  if not found then
    raise exception 'El concepto no existe' using errcode = 'foreign_key_violation';
  end if;
  if not concept.is_active then
    raise exception 'El concepto está desactivado' using errcode = 'check_violation';
  end if;
  if concept.direction <> new.direction then
    raise exception 'El concepto no corresponde a este tipo de movimiento' using errcode = 'check_violation';
  end if;
  if concept.requires_sponsor and new.sponsor_id is null then
    raise exception 'Elegí el sponsor' using errcode = 'check_violation';
  end if;

  if new.sponsor_id is not null then
    select s.is_active into sponsor_active from public.sponsors s where s.id = new.sponsor_id;
    if sponsor_active is null then
      raise exception 'El sponsor no existe' using errcode = 'foreign_key_violation';
    end if;
    if not sponsor_active then
      raise exception 'El sponsor está desactivado' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger cash_movements_insert_guard
  before insert on public.cash_movements
  for each row execute function private.cash_movements_insert_guard();

-- Dos cosas se actualizan de un movimiento, y ninguna se deshace:
--   - la anulación: una vez, con motivo, solo con income.void;
--   - el comprobante: null → valor, una vez; nunca sobre un movimiento anulado.
create function private.cash_movements_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  voiding boolean := new.voided_at is distinct from old.voided_at
    or new.voided_by is distinct from old.voided_by
    or new.void_reason is distinct from old.void_reason;
  attaching boolean := new.receipt_storage_path is distinct from old.receipt_storage_path
    or new.receipt_filename is distinct from old.receipt_filename;
begin
  if voiding then
    if old.voided_at is not null then
      raise exception 'Este ingreso ya está anulado' using errcode = 'check_violation';
    end if;
    if new.void_reason is null or length(btrim(new.void_reason)) < 3 then
      raise exception 'Para anular un ingreso hace falta un motivo' using errcode = 'check_violation';
    end if;
    if not private.can('income.void') then
      raise exception 'No tenés permiso para anular ingresos' using errcode = 'insufficient_privilege';
    end if;
    new.voided_by := auth.uid();
    new.voided_at := now();
  end if;

  if attaching then
    if old.voided_at is not null or voiding then
      raise exception 'Un ingreso anulado no lleva comprobante' using errcode = 'check_violation';
    end if;
    if old.receipt_storage_path is not null then
      raise exception 'El comprobante ya está cargado y no se reemplaza' using errcode = 'check_violation';
    end if;
    if new.receipt_storage_path is null then
      raise exception 'Falta el archivo del comprobante' using errcode = 'check_violation';
    end if;
    if not private.can('income.register') then
      raise exception 'No tenés permiso para adjuntar comprobantes' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger cash_movements_update_guard
  before update on public.cash_movements
  for each row execute function private.cash_movements_update_guard();

alter table public.cash_movements enable row level security;
alter table public.cash_movements force row level security;

create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using ((select private.can('income.read')));
create policy cash_movements_insert on public.cash_movements
  for insert to authenticated
  with check (
    (select private.can('income.register'))
    and created_by = (select auth.uid())
    and direction = 'income'
  );
create policy cash_movements_update on public.cash_movements
  for update to authenticated
  using ((select private.can('income.register')) or (select private.can('income.void')))
  with check ((select private.can('income.register')) or (select private.can('income.void')));

revoke all on public.cash_movements from anon, authenticated, service_role;
grant select on public.cash_movements to authenticated, service_role;
grant insert (direction, concept_id, sponsor_id, amount_cents, occurred_on, method,
              receipt_storage_path, receipt_filename, description, batch_id)
  on public.cash_movements to authenticated;
grant update (voided_at, voided_by, void_reason, receipt_storage_path, receipt_filename)
  on public.cash_movements to authenticated;

select private.enable_audit('public.cash_movements');

-- -----------------------------------------------------------------------------
-- Storage: prefijo cash-receipts/ en el bucket privado existente. Los dos
-- prefijos del slice 1 quedan con has_role (deuda que migra el pipeline de
-- roles); el nuevo ya chequea permiso.
-- -----------------------------------------------------------------------------
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (
      ((storage.foldername(name))[1] in ('medical-clearances', 'payment-receipts')
        and (select private.has_role('admin', 'editor')))
      or ((storage.foldername(name))[1] = 'cash-receipts'
        and (select private.can('income.register')))
    )
  );

-- -----------------------------------------------------------------------------
-- Resumen de caja del mes. La parte de cuotas sale de month_collection: UNA
-- definición de "cobrado en cuotas" para el inicio, /caja/cuotas y acá.
-- Mañana los egresos suman expense_cents y total pasa a ser neto, sin tocar
-- la UI de hoy.
-- -----------------------------------------------------------------------------
create function public.cash_month_summary(target_period date default null)
returns table (
  period date,
  total_cents bigint,
  fees_collected_cents bigint,
  other_income_cents bigint,
  cash_cents bigint,
  transfer_cents bigint,
  fees_cents bigint,
  fees_count integer,
  payments_count integer,
  other_income_count integer,
  by_concept jsonb
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  p date := date_trunc('month', coalesce(target_period, private.club_today()))::date;
  p_end date := (date_trunc('month', coalesce(target_period, private.club_today())) + interval '1 month' - interval '1 day')::date;
  mc record;
begin
  perform private.require_permission('payments.read');
  perform private.require_permission('income.read');

  select * into mc from public.month_collection(p);

  return query
  with other as (
    select
      coalesce(sum(m.amount_cents), 0)::bigint as total,
      coalesce(sum(m.amount_cents) filter (where m.method = 'cash'), 0)::bigint as cash,
      coalesce(sum(m.amount_cents) filter (where m.method = 'transfer'), 0)::bigint as transfer,
      count(m.id)::integer as n
    from public.cash_movements m
    where m.direction = 'income' and m.voided_at is null and m.occurred_on between p and p_end
  ),
  per_concept as (
    select m.concept_id, sum(m.amount_cents)::bigint as total, count(*)::integer as n
    from public.cash_movements m
    where m.direction = 'income' and m.voided_at is null and m.occurred_on between p and p_end
    group by m.concept_id
  ),
  concepts_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('concept_id', c.id, 'concept_name', c.name, 'amount_cents', pc.total, 'count', pc.n)
        order by pc.total desc, c.sort_order, c.name
      ),
      '[]'::jsonb
    ) as j
    from per_concept pc
    join public.cash_concepts c on c.id = pc.concept_id
  )
  select
    p,
    (mc.collected_cents + other.total)::bigint,
    mc.collected_cents,
    other.total,
    (mc.cash_cents + other.cash)::bigint,
    (mc.transfer_cents + other.transfer)::bigint,
    mc.fees_cents,
    mc.fees_count,
    mc.payments_count,
    other.n,
    concepts_json.j
  from other, concepts_json;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sponsors con lo aportado en el año (calendario, por occurred_on) y el
-- último aporte. Activos primero. target_sponsor_id = la ficha de uno.
-- -----------------------------------------------------------------------------
create function public.sponsor_summaries(target_year integer default null, target_sponsor_id bigint default null)
returns table (
  sponsor_id bigint,
  name text,
  is_active boolean,
  contact_name text,
  phone text,
  email text,
  notes text,
  deactivated_at timestamptz,
  deactivation_reason text,
  year_total_cents bigint,
  all_time_total_cents bigint,
  contributions_count integer,
  last_contribution_on date,
  last_contribution_cents bigint
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  y integer := coalesce(target_year, extract(year from private.club_today())::integer);
begin
  perform private.require_permission('income.read');

  return query
  select
    s.id,
    s.name,
    s.is_active,
    s.contact_name,
    s.phone,
    s.email,
    s.notes,
    s.deactivated_at,
    s.deactivation_reason,
    coalesce(sum(m.amount_cents) filter (where extract(year from m.occurred_on) = y), 0)::bigint,
    coalesce(sum(m.amount_cents), 0)::bigint,
    count(m.id)::integer,
    (select l.occurred_on from public.cash_movements l
      where l.sponsor_id = s.id and l.voided_at is null
      order by l.occurred_on desc, l.id desc limit 1),
    (select l.amount_cents from public.cash_movements l
      where l.sponsor_id = s.id and l.voided_at is null
      order by l.occurred_on desc, l.id desc limit 1)
  from public.sponsors s
  left join public.cash_movements m
    on m.sponsor_id = s.id and m.direction = 'income' and m.voided_at is null
  where target_sponsor_id is null or s.id = target_sponsor_id
  group by s.id
  order by s.is_active desc, lower(s.name);
end;
$$;

-- -----------------------------------------------------------------------------
-- log_export: suma 'other_income' a la lista cerrada. Es la definición
-- vigente (la de la migración más nueva manda). Los grants se conservan.
-- -----------------------------------------------------------------------------
create or replace function public.log_export(listing text, filters jsonb, row_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can('reports.export') then
    raise exception 'No tenés permiso para exportar' using errcode = 'insufficient_privilege';
  end if;

  if listing is null or listing not in (
    'members', 'debt', 'up_to_date', 'debt_by_category', 'month_payments', 'audit', 'other_income'
  ) then
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
-- Grants de las RPC nuevas y cierre de private
-- -----------------------------------------------------------------------------
revoke execute on function
  public.cash_month_summary(date),
  public.sponsor_summaries(integer, bigint)
from public, anon;

grant execute on function
  public.cash_month_summary(date),
  public.sponsor_summaries(integer, bigint)
to authenticated;

-- Las funciones nuevas de private son triggers: no necesitan EXECUTE para el
-- rol que dispara el trigger (igual que payments_update_guard). Los helpers
-- que usan las policies ya tienen su grant de migraciones anteriores, y este
-- revoke solo toca public/anon.
revoke execute on all functions in schema private from public, anon;
