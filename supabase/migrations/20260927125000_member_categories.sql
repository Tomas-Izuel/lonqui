-- =============================================================================
-- 0004b — Permisos y un socio en varios deportes (S0).
--
-- Pipeline: docs/pipelines/2026-09-27-cuotas-pagos-panel/ (§13, D27–D29).
--
-- Decisiones:
--   - La pertenencia a categorías son filas-intervalo (joined_on / left_on):
--     la historia queda en las mismas filas y nada se borra.
--   - A lo sumo una inscripción abierta por DISCIPLINA: subir de 5ta a 6ta es
--     cerrar una y abrir otra, no estar en dos.
--   - members.member_type se conserva, pero lo escribe solo un trigger
--     (practicante ⇔ al menos una inscripción abierta), como members.status.
--   - members.category_id se elimina después de migrar sus datos.
--
-- Los permisos viven acá (y no en la migración de facturación) porque las
-- policies de member_categories ya son reglas nuevas: chequean permisos.
--
-- Reversa: recrear members.category_id desde las inscripciones abiertas (una
-- por socio no alcanza si alguien tiene dos deportes: la reversa pierde
-- información a partir del primer socio con dos), el CHECK y los grants.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permisos (T12)
--
-- Toda regla nueva desde este slice chequea PERMISOS, no roles. Catálogo
-- (claves estables: se agregan, nunca se renombran):
--
--   members.read        padrón, fichas, grupos, aptos (lectura)
--   members.write       alta y modificación de socios, grupo, apto, categorías
--   members.status      baja y reactivación
--   payments.read       estados de cuenta, cobranza, valores de cuota (lectura)
--   payments.register   registrar pagos, adjuntar comprobante, saldo de arranque
--   payments.void       anular pagos y cuotas
--   billing.configure   valores de cuota, activar, generar/reintentar, corridas
--   settings.manage     disciplinas, categorías, datos del club
--   users.manage        usuarios internos y (mañana) roles
--   audit.read          registro de auditoría
--   reports.read        panel inicial y listados agregados
--   reports.export      exportar CSV
--
-- Hoy el mapeo es fijo desde los tres roles. El pipeline de roles
-- configurables cambia SOLO el cuerpo de permissions_for_role (a una lectura
-- de role_permissions); can(), my_permissions() y los guards de TS no
-- cambian. Deuda: las reglas del slice 1 siguen con has_role/is_admin y ese
-- pipeline las migra primero.
-- -----------------------------------------------------------------------------
create function private.permissions_for_role(role text)
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
      'reports.read', 'reports.export'
    ]
    when 'editor' then array[
      'members.read', 'members.write',
      'payments.read', 'payments.register',
      'reports.read', 'reports.export'
    ]
    when 'consulta' then array[
      'members.read', 'payments.read', 'reports.read', 'reports.export'
    ]
    else array[]::text[]
  end;
$$;

-- Sin rol activo (sin fila, desactivado o con contraseña temporal pendiente)
-- current_app_role() es null y no hay ningún permiso.
create function private.can(permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(permission = any (private.permissions_for_role(private.current_app_role())), false);
$$;

-- Lo que la app lee una vez por request para SessionInfo.permissions: una
-- sola fuente de verdad, sin un mapa duplicado en TypeScript.
create function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.permissions_for_role(private.current_app_role()), array[]::text[]);
$$;

revoke execute on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- member_categories: en qué categorías está (y estuvo) cada socio
-- -----------------------------------------------------------------------------
create table public.member_categories (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members (id) on delete restrict,
  category_id bigint not null references public.categories (id) on delete restrict,
  joined_on date not null,
  -- Abierta mientras es null. Es el último día en la categoría.
  left_on date,
  left_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  left_by uuid,
  left_at timestamptz,

  constraint member_categories_left_after_joined
    check (left_on is null or left_on >= joined_on),
  -- left_by puede ser null en una inscripción cerrada: la cerró el sistema
  -- (seed, un job), igual que created_by.
  constraint member_categories_left_shape
    check ((left_on is null) = (left_at is null) and (left_on is not null or left_by is null)),
  constraint member_categories_left_reason_only_when_left
    check (left_reason is null or left_on is not null)
);

comment on table public.member_categories is
  'Inscripciones de un socio en categorías, con historia. Nada se borra: dejar una categoría es cerrar la fila (left_on).';

create unique index member_categories_one_open_per_category
  on public.member_categories (member_id, category_id) where left_on is null;
create index member_categories_open_member_idx
  on public.member_categories (member_id) where left_on is null;
create index member_categories_open_category_idx
  on public.member_categories (category_id) where left_on is null;
create index member_categories_member_joined_idx
  on public.member_categories (member_id, joined_on);
create index member_categories_category_id_idx
  on public.member_categories (category_id);

create trigger member_categories_immutable
  before update on public.member_categories
  for each row execute function private.protect_immutable_columns(
    'id', 'member_id', 'category_id', 'joined_on', 'created_by', 'created_at'
  );

-- SECURITY DEFINER: la invariante no depende de la RLS de quien escribe
-- (lee members y categories aunque mañana un rol no pueda verlas).
create function private.member_categories_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_joined_on date;
  target_discipline_id bigint;
  target_active boolean;
  open_label text;
begin
  -- Bloquea al socio: dos inscripciones simultáneas en el mismo deporte no
  -- pasan las dos el chequeo de abajo.
  select joined_on into member_joined_on
  from public.members
  where id = new.member_id
  for update;

  if not found then
    raise exception 'El socio no existe' using errcode = 'foreign_key_violation';
  end if;

  select c.discipline_id, c.is_active and d.is_active
  into target_discipline_id, target_active
  from public.categories c
  join public.disciplines d on d.id = c.discipline_id
  where c.id = new.category_id;

  if not found then
    raise exception 'La categoría no existe' using errcode = 'foreign_key_violation';
  end if;
  if not target_active then
    raise exception 'La categoría está dada de baja' using errcode = 'check_violation';
  end if;

  if new.joined_on < member_joined_on then
    raise exception 'La fecha no puede ser anterior a la fecha de alta del socio' using errcode = 'check_violation';
  end if;
  if new.joined_on > private.club_today() then
    raise exception 'La fecha no puede ser futura' using errcode = 'check_violation';
  end if;

  select d.name || ' (' || c.name || ')'
  into open_label
  from public.member_categories mc
  join public.categories c on c.id = mc.category_id
  join public.disciplines d on d.id = c.discipline_id
  where mc.member_id = new.member_id
    and mc.left_on is null
    and c.discipline_id = target_discipline_id
  limit 1;

  if open_label is not null then
    raise exception 'Ya está inscripto en %; dalo de baja de esa categoría primero o usá el cambio de categoría', open_label
      using errcode = 'check_violation';
  end if;

  new.left_on := null;
  new.left_reason := null;
  new.left_by := null;
  new.left_at := null;
  return new;
end;
$$;

create trigger member_categories_insert_guard
  before insert on public.member_categories
  for each row execute function private.member_categories_insert_guard();

-- Lo único que cambia de una inscripción es su cierre: una vez, sin fecha
-- futura. El actor lo pone la base.
create function private.member_categories_update_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger member_categories_update_guard
  before update on public.member_categories
  for each row execute function private.member_categories_update_guard();

create trigger member_categories_no_delete
  before delete on public.member_categories
  for each row execute function private.forbid_change();

-- member_type es derivado: practicante ⇔ al menos una inscripción abierta.
-- SECURITY DEFINER porque la columna no tiene grant de escritura para nadie.
create function private.sync_member_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  derived text;
begin
  derived := case
    when exists (
      select 1 from public.member_categories
      where member_id = new.member_id and left_on is null
    ) then 'practicing'
    else 'non_practicing'
  end;

  update public.members
  set member_type = derived
  where id = new.member_id
    and member_type is distinct from derived;

  return null;
end;
$$;

create trigger member_categories_sync_member_type
  after insert or update on public.member_categories
  for each row execute function private.sync_member_type();

-- -----------------------------------------------------------------------------
-- members: migrar category_id y dejar member_type en manos de la base
-- -----------------------------------------------------------------------------

-- Corre como postgres, sin sesión: la auditoría registra estas filas como
-- 'system'. Los triggers de arriba ya validan cada fila.
insert into public.member_categories (member_id, category_id, joined_on)
select id, category_id, joined_on
from public.members
where category_id is not null;

alter table public.members drop constraint members_practicing_has_category;
drop index public.members_category_id_idx;
alter table public.members drop column category_id;

alter table public.members alter column member_type set default 'non_practicing';

comment on column public.members.member_type is
  'Derivado: practicing si tiene al menos una inscripción abierta en member_categories. Lo escribe solo el trigger sync_member_type. Sin grant de escritura.';

revoke insert (member_type), update (member_type) on public.members from authenticated;

create index members_practicing_idx on public.members (member_type) where member_type = 'practicing';

-- -----------------------------------------------------------------------------
-- Cambio de categorías en bloque (alta y edición del socio)
--
-- SECURITY INVOKER: corre con la RLS y los grants de quien la llama. Cierra
-- las inscripciones abiertas que no están en la lista y abre las que faltan,
-- todo o nada. Mismo patrón que set_family_payment_responsible.
-- -----------------------------------------------------------------------------
create function public.set_member_categories(
  target_member_id bigint,
  category_ids bigint[],
  effective_on date default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  on_date date := coalesce(effective_on, private.club_today());
  wanted bigint[] := coalesce(category_ids, array[]::bigint[]);
begin
  if not private.can('members.write') then
    raise exception 'No tenés permiso para modificar socios' using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1
    from public.categories c
    where c.id = any (wanted)
    group by c.discipline_id
    having count(*) > 1
  ) then
    raise exception 'Elegí una sola categoría por deporte' using errcode = 'check_violation';
  end if;

  -- Primero se cierran, así el cambio 5ta → 6ta no choca con la regla de
  -- una inscripción abierta por deporte.
  update public.member_categories
  set left_on = on_date
  where member_id = target_member_id
    and left_on is null
    and not (category_id = any (wanted));

  insert into public.member_categories (member_id, category_id, joined_on)
  select target_member_id, wanted_id, on_date
  from unnest(wanted) as wanted_id
  where not exists (
    select 1 from public.member_categories mc
    where mc.member_id = target_member_id
      and mc.category_id = wanted_id
      and mc.left_on is null
  );
end;
$$;

revoke execute on function public.set_member_categories(bigint, bigint[], date) from public, anon;
grant execute on function public.set_member_categories(bigint, bigint[], date) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS y grants
-- -----------------------------------------------------------------------------
alter table public.member_categories enable row level security;
alter table public.member_categories force row level security;

create policy member_categories_select on public.member_categories
  for select to authenticated
  using ((select private.can('members.read')));
create policy member_categories_insert on public.member_categories
  for insert to authenticated
  with check ((select private.can('members.write')));
create policy member_categories_update on public.member_categories
  for update to authenticated
  using ((select private.can('members.write')))
  with check ((select private.can('members.write')));

revoke all on public.member_categories from anon, authenticated, service_role;
grant select on public.member_categories to authenticated, service_role;
grant insert (member_id, category_id, joined_on) on public.member_categories to authenticated;
grant update (left_on, left_reason) on public.member_categories to authenticated;

select private.enable_audit('public.member_categories');

-- -----------------------------------------------------------------------------
-- EXECUTE de PUBLIC: no se revoca por schema, se cierra a mano (CLAUDE.md).
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;

grant execute on function
  private.club_today(),
  private.normalize_text(text),
  private.current_app_role(),
  private.has_role(text[]),
  private.is_admin(),
  private.permissions_for_role(text),
  private.can(text)
to authenticated, service_role;
