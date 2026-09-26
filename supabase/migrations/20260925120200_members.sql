-- =============================================================================
-- 0003 — Padrón: grupos familiares, socios, eventos de alta/baja, aptos (S3).
--
-- Decisiones (00-architecture.md §6.1, D2, D4, D7):
--   - members.status se guarda, pero lo escribe SOLO el trigger de eventos: la
--     columna no tiene grant de UPDATE para nadie.
--   - El alta crea su evento 'admission' por trigger, así Secretaría (editor)
--     da de alta sin tener INSERT en member_status_events.
--   - Baja y reactivación son eventos con fecha y motivo, solo admin.
--   - DNI nullable (carga histórica) con unicidad parcial.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- family_groups
-- -----------------------------------------------------------------------------
create table public.family_groups (
  id bigint generated always as identity primary key,
  -- Opcional: por defecto la UI muestra el apellido del responsable.
  name text,
  -- Quien paga cuando no es socio (un padre, una madre).
  payer_contact_name text,
  payer_contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger family_groups_set_updated_at
  before update on public.family_groups
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- members
-- -----------------------------------------------------------------------------
create table public.members (
  id bigint generated always as identity primary key,
  first_name text not null check (length(btrim(first_name)) >= 1),
  last_name text not null check (length(btrim(last_name)) >= 1),
  dni text check (dni ~ '^[0-9]{7,8}$'),
  birth_date date,
  address text,
  phone text,
  email text check (email is null or email = lower(email)),
  member_type text not null check (member_type in ('practicing', 'non_practicing')),
  category_id bigint references public.categories (id) on delete restrict,
  family_group_id bigint references public.family_groups (id) on delete restrict,
  is_payment_responsible boolean not null default false,
  joined_on date not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  status_changed_on date,
  notes text,
  search_text text generated always as (
    private.normalize_text(first_name || ' ' || last_name || ' ' || coalesce(dni, ''))
  ) stored,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint members_practicing_has_category
    check ((member_type = 'practicing') = (category_id is not null)),
  constraint members_responsible_has_group
    check (not is_payment_responsible or family_group_id is not null),
  -- "No futura" no puede ser un CHECK (now() no es inmutable): eso lo valida
  -- Zod en el alta. Acá solo se frena lo absurdo.
  constraint members_birth_date_sane
    check (birth_date is null or birth_date >= date '1900-01-01')
);

comment on column public.members.status is
  'Lo escribe solo el trigger de member_status_events. Sin grant de UPDATE.';

create unique index members_dni_key on public.members (dni) where dni is not null;
-- A lo sumo un responsable de pago por grupo. "Al menos uno" es un aviso de
-- la UI, no una regla de la base.
create unique index members_one_responsible_per_group
  on public.members (family_group_id) where is_payment_responsible;
create index members_category_id_idx on public.members (category_id);
create index members_family_group_id_idx on public.members (family_group_id);
create index members_active_idx on public.members (status) where status = 'active';
create index members_search_trgm on public.members using gin (search_text extensions.gin_trgm_ops);
-- Keyset del padrón.
create index members_keyset_idx on public.members (last_name, first_name, id);

create trigger members_set_updated_at
  before update on public.members
  for each row execute function private.set_updated_at();

create trigger members_immutable
  before update on public.members
  for each row execute function private.protect_immutable_columns('id', 'joined_on', 'created_at', 'created_by');

-- -----------------------------------------------------------------------------
-- member_status_events: fichas de ingreso y egreso
-- -----------------------------------------------------------------------------
create table public.member_status_events (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members (id) on delete restrict,
  event_type text not null check (event_type in ('admission', 'withdrawal', 'reactivation')),
  effective_on date not null,
  reason text not null check (length(btrim(reason)) >= 3),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index member_status_events_member_idx on public.member_status_events (member_id, created_at);

-- Valida la transición contra el estado actual. Bloquea la fila del socio para
-- que dos bajas simultáneas no pasen las dos.
create function private.validate_member_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  member_joined_on date;
  has_events boolean;
begin
  select status, joined_on into current_status, member_joined_on
  from public.members
  where id = new.member_id
  for update;

  if not found then
    raise exception 'El socio no existe' using errcode = 'foreign_key_violation';
  end if;

  if new.effective_on > private.club_today() then
    raise exception 'La fecha no puede ser futura' using errcode = 'check_violation';
  end if;

  if new.effective_on < member_joined_on then
    raise exception 'La fecha no puede ser anterior a la fecha de alta' using errcode = 'check_violation';
  end if;

  select exists (select 1 from public.member_status_events where member_id = new.member_id)
  into has_events;

  if new.event_type = 'admission' then
    if has_events then
      raise exception 'El socio ya tiene su ficha de ingreso' using errcode = 'check_violation';
    end if;
  elsif new.event_type = 'withdrawal' then
    if current_status <> 'active' then
      raise exception 'El socio ya está dado de baja' using errcode = 'check_violation';
    end if;
  elsif new.event_type = 'reactivation' then
    if current_status <> 'inactive' then
      raise exception 'El socio ya está activo' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Aplica el evento al socio. SECURITY DEFINER porque members.status no tiene
-- grant de UPDATE para nadie: esta es la única puerta.
create function private.apply_member_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type = 'withdrawal' then
    update public.members
    set status = 'inactive', status_changed_on = new.effective_on
    where id = new.member_id;
  elsif new.event_type = 'reactivation' then
    update public.members
    set status = 'active', status_changed_on = new.effective_on
    where id = new.member_id;
  end if;
  return null;
end;
$$;

create trigger member_status_events_validate
  before insert on public.member_status_events
  for each row execute function private.validate_member_status_event();

create trigger member_status_events_apply
  after insert on public.member_status_events
  for each row execute function private.apply_member_status_event();

create trigger member_status_events_no_change
  before update or delete on public.member_status_events
  for each row execute function private.forbid_change();

-- El alta de un socio es su ficha de ingreso.
create function private.create_admission_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.member_status_events (member_id, event_type, effective_on, reason, created_by)
  values (new.id, 'admission', new.joined_on, 'Ficha de ingreso', new.created_by);
  return null;
end;
$$;

create trigger members_create_admission
  after insert on public.members
  for each row execute function private.create_admission_event();

-- -----------------------------------------------------------------------------
-- medical_clearances: aptos físicos
-- -----------------------------------------------------------------------------
create table public.medical_clearances (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members (id) on delete restrict,
  expires_on date not null,
  -- Ruta del objeto en el bucket `attachments`, NUNCA una URL. Null si la
  -- Comisión vio el certificado en papel y solo cargó la fecha.
  storage_path text check (storage_path is null or storage_path like 'medical-clearances/%'),
  original_filename text,
  uploaded_by uuid default auth.uid(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index medical_clearances_member_idx on public.medical_clearances (member_id, expires_on desc);

create trigger medical_clearances_set_updated_at
  before update on public.medical_clearances
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Responsable de pago: cambio atómico contra el índice único parcial.
-- SECURITY INVOKER: corre con los permisos (y la RLS) de quien la llama.
-- -----------------------------------------------------------------------------
create function public.set_family_payment_responsible(group_id bigint, member_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.members m
    where m.id = set_family_payment_responsible.member_id
      and m.family_group_id = set_family_payment_responsible.group_id
  ) then
    raise exception 'El socio no pertenece a ese grupo familiar' using errcode = 'check_violation';
  end if;

  update public.members
  set is_payment_responsible = false
  where family_group_id = set_family_payment_responsible.group_id
    and is_payment_responsible
    and id <> set_family_payment_responsible.member_id;

  update public.members
  set is_payment_responsible = true
  where id = set_family_payment_responsible.member_id;
end;
$$;

revoke execute on function public.set_family_payment_responsible(bigint, bigint) from public, anon;
grant execute on function public.set_family_payment_responsible(bigint, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS y grants (matriz §6.5)
-- -----------------------------------------------------------------------------
alter table public.family_groups enable row level security;
alter table public.family_groups force row level security;
alter table public.members enable row level security;
alter table public.members force row level security;
alter table public.member_status_events enable row level security;
alter table public.member_status_events force row level security;
alter table public.medical_clearances enable row level security;
alter table public.medical_clearances force row level security;

-- family_groups
create policy family_groups_select on public.family_groups
  for select to authenticated
  using ((select private.current_app_role()) is not null);
create policy family_groups_insert on public.family_groups
  for insert to authenticated
  with check ((select private.has_role('admin', 'editor')));
create policy family_groups_update on public.family_groups
  for update to authenticated
  using ((select private.has_role('admin', 'editor')))
  with check ((select private.has_role('admin', 'editor')));

-- members
create policy members_select on public.members
  for select to authenticated
  using ((select private.current_app_role()) is not null);
create policy members_insert on public.members
  for insert to authenticated
  with check ((select private.has_role('admin', 'editor')));
create policy members_update on public.members
  for update to authenticated
  using ((select private.has_role('admin', 'editor')))
  with check ((select private.has_role('admin', 'editor')));

-- member_status_events: baja y reactivación solo admin; el alta entra por el
-- trigger de members, que corre como dueño.
create policy member_status_events_select on public.member_status_events
  for select to authenticated
  using ((select private.current_app_role()) is not null);
create policy member_status_events_insert on public.member_status_events
  for insert to authenticated
  with check (
    (select private.is_admin())
    and event_type in ('withdrawal', 'reactivation')
  );

-- medical_clearances
create policy medical_clearances_select on public.medical_clearances
  for select to authenticated
  using ((select private.current_app_role()) is not null);
create policy medical_clearances_insert on public.medical_clearances
  for insert to authenticated
  with check ((select private.has_role('admin', 'editor')));
create policy medical_clearances_update on public.medical_clearances
  for update to authenticated
  using ((select private.has_role('admin', 'editor')))
  with check ((select private.has_role('admin', 'editor')));

revoke all on public.family_groups, public.members, public.member_status_events, public.medical_clearances
  from anon, authenticated, service_role;

grant select on public.family_groups, public.members, public.member_status_events, public.medical_clearances
  to authenticated, service_role;

grant insert (name, payer_contact_name, payer_contact_phone, notes) on public.family_groups to authenticated;
grant update (name, payer_contact_name, payer_contact_phone, notes) on public.family_groups to authenticated;

-- Sin status ni status_changed_on: el estado lo escriben los eventos.
grant insert (
  first_name, last_name, dni, birth_date, address, phone, email, member_type,
  category_id, family_group_id, is_payment_responsible, joined_on, notes
) on public.members to authenticated;
grant update (
  first_name, last_name, dni, birth_date, address, phone, email, member_type,
  category_id, family_group_id, is_payment_responsible, notes
) on public.members to authenticated;

grant insert (member_id, event_type, effective_on, reason, notes) on public.member_status_events to authenticated;

grant insert (member_id, expires_on, storage_path, original_filename, notes) on public.medical_clearances to authenticated;
grant update (expires_on, notes) on public.medical_clearances to authenticated;

select private.enable_audit('public.family_groups');
select private.enable_audit('public.members');
select private.enable_audit('public.member_status_events');
select private.enable_audit('public.medical_clearances');
