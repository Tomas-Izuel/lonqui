-- =============================================================================
-- 0001 — Cimientos: privilegios por defecto, schema private, roles, auditoría.
--
-- Pipeline: docs/pipelines/2026-09-25-padron-roles-auditoria/ (S1).
--
-- Por qué empieza tocando los default privileges: el stack de Supabase otorga
-- `arwdDxtm` (DELETE incluido) a anon, authenticated y service_role sobre TODA
-- tabla nueva en `public`. La regla "nada se borra" de CLAUDE.md no se cumple
-- por omisión: se cumple quitando eso acá y otorgando cada privilegio a mano,
-- tabla por tabla, en cada migración.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensiones
-- -----------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- -----------------------------------------------------------------------------
-- Privilegios por defecto: ninguna tabla, secuencia ni función nueva de
-- `public` nace otorgada. Cada objeto declara lo suyo.
-- -----------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
-- Postgres le da EXECUTE a PUBLIC sobre toda función nueva: una SECURITY
-- DEFINER en `public` sin este revoke es un endpoint abierto para anon.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Schema private: helpers, triggers y tablas técnicas. PostgREST no lo expone.
-- `authenticated` necesita USAGE para que las policies puedan llamar a los
-- helpers (una policy se evalúa con los privilegios de quien consulta).
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon;

-- -----------------------------------------------------------------------------
-- Helpers genéricos
-- -----------------------------------------------------------------------------

-- Hoy en la zona del club. El proceso corre en UTC: las 22:00 del 31 en
-- Lonquimay son la 01:00 del 1° en UTC.
create function private.club_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

-- `unaccent` no es IMMUTABLE (depende del diccionario en search_path), y una
-- columna generada lo exige. Con el diccionario explícito el resultado es
-- estable: "Núñez" → "nunez".
create function private.normalize_text(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(value, '')));
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Columnas que no cambian nunca después del INSERT. Los nombres llegan por
-- TG_ARGV para reusar la misma función en todas las tablas.
create function private.protect_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  foreach col in array tg_argv loop
    if old_row -> col is distinct from new_row -> col then
      raise exception 'La columna % no se puede modificar', col
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

-- Guard para tablas de historia: ni UPDATE ni DELETE, para nadie.
create function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Los registros de % no se modifican ni se borran', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

-- -----------------------------------------------------------------------------
-- app_users: usuarios internos y su rol
-- -----------------------------------------------------------------------------
create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete restrict,
  email text not null unique check (email = lower(email)),
  display_name text not null check (length(btrim(display_name)) >= 2),
  -- La Fase 2 agrega 'socio' con un ALTER del CHECK.
  role text not null check (role in ('admin', 'editor', 'consulta')),
  is_active boolean not null default true,
  -- Nace prendido: todo usuario nuevo tiene contraseña temporal. Sin grant de
  -- UPDATE para nadie: lo prenden y apagan solo las RPC de contraseña.
  must_change_password boolean not null default true,
  password_changed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_users is
  'Usuarios internos del panel. El rol vive acá y nunca en user_metadata, que el propio usuario puede editar.';

-- Rol efectivo del usuario de la sesión. Null si no tiene fila, está
-- desactivado o tiene una contraseña temporal pendiente: en esos tres casos el
-- dominio entero queda cerrado por RLS aunque el JWT sea válido.
-- SECURITY DEFINER para leer app_users sin pasar por su propia RLS (evita la
-- recursión de una policy que se consulta a sí misma).
create function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.app_users
  where user_id = (select auth.uid())
    and is_active
    and not must_change_password;
$$;

create function private.has_role(variadic roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = any (roles), false);
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('admin');
$$;

grant execute on function
  private.club_today(),
  private.normalize_text(text),
  private.current_app_role(),
  private.has_role(text[]),
  private.is_admin()
to authenticated, service_role;

-- Anti-lockout: siempre queda al menos un admin activo, y nadie se cambia su
-- propio rol ni se desactiva a sí mismo.
create function private.app_users_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.user_id
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'No podés cambiar tu propio rol ni desactivar tu propio usuario'
      using errcode = 'check_violation';
  end if;

  if old.role = 'admin' and old.is_active
     and (new.role <> 'admin' or not new.is_active) then
    -- Serializa las degradaciones de admins: dos admins que se degradan
    -- mutuamente al mismo tiempo no pueden dejar el club sin ninguno.
    perform pg_advisory_xact_lock(hashtext('lonqui.app_users.admins'));
    if not exists (
      select 1 from public.app_users
      where role = 'admin' and is_active and user_id <> old.user_id
    ) then
      raise exception 'Tiene que quedar al menos un administrador activo'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger app_users_guard
  before update on public.app_users
  for each row execute function private.app_users_guard();

create trigger app_users_set_updated_at
  before update on public.app_users
  for each row execute function private.set_updated_at();

create trigger app_users_immutable
  before update on public.app_users
  for each row execute function private.protect_immutable_columns('user_id', 'email', 'created_at', 'created_by');

alter table public.app_users enable row level security;
alter table public.app_users force row level security;

-- La fila propia se lee por auth.uid() DIRECTO, sin has_role: un usuario con
-- contraseña temporal tiene que poder leer su propio flag para que el layout
-- sepa a dónde mandarlo.
create policy app_users_select on public.app_users
  for select to authenticated
  using ((select auth.uid()) = user_id or (select private.is_admin()));

create policy app_users_insert on public.app_users
  for insert to authenticated
  with check ((select private.is_admin()));

create policy app_users_update on public.app_users
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.app_users from anon, authenticated, service_role;
grant select on public.app_users to authenticated, service_role;
grant insert (user_id, email, display_name, role, is_active, created_by)
  on public.app_users to authenticated;
grant update (display_name, role, is_active) on public.app_users to authenticated;
-- service_role: solo el bootstrap del primer admin. Puede nacer con el flag
-- apagado (admin de desarrollo local) o prendido (hosted).
grant insert (user_id, email, display_name, role, is_active, created_by, must_change_password)
  on public.app_users to service_role;
grant update (display_name, role, is_active) on public.app_users to service_role;

-- -----------------------------------------------------------------------------
-- Contraseña temporal: marker del hash y las dos RPC
-- -----------------------------------------------------------------------------

-- Tabla técnica, no expuesta y no auditada: no tiene datos de dominio. Guarda
-- un sha256 del hash bcrypt de Auth en el momento del reseteo —un hash de un
-- hash, nunca la contraseña— para poder comprobar en la base que la
-- contraseña realmente cambió antes de liberar al usuario.
create table private.password_markers (
  user_id uuid primary key references public.app_users (user_id) on delete restrict,
  marker text not null,
  set_by uuid,
  set_at timestamptz not null default now(),
  cleared_at timestamptz
);

revoke all on private.password_markers from public, anon, authenticated, service_role;

create function private.password_hash_marker(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(u.encrypted_password, 'UTF8')), 'hex')
  from auth.users u
  where u.id = target;
$$;

revoke execute on function private.password_hash_marker(uuid) from public, anon, authenticated, service_role;

-- Prende el flag de contraseña temporal y guarda el marker del hash actual.
-- La llaman un admin (alta y "restablecer contraseña") o service_role (el
-- bootstrap del primer admin en hosted). En public porque tiene que ser
-- llamable por RPC: el revoke y el chequeo del cuerpo son la puerta.
create function public.mark_password_reset(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_marker text;
begin
  if not (private.is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'No tenés permiso para restablecer contraseñas'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.app_users where user_id = target_user_id) then
    raise exception 'El usuario no existe' using errcode = 'no_data_found';
  end if;

  current_marker := private.password_hash_marker(target_user_id);
  if current_marker is null then
    raise exception 'El usuario no tiene contraseña en Auth' using errcode = 'no_data_found';
  end if;

  insert into private.password_markers (user_id, marker, set_by, set_at, cleared_at)
  values (target_user_id, current_marker, auth.uid(), now(), null)
  on conflict (user_id) do update
    set marker = excluded.marker,
        set_by = excluded.set_by,
        set_at = excluded.set_at,
        cleared_at = null;

  -- Pasa por el trigger de auditoría: queda registrado quién restableció,
  -- sin que la contraseña aparezca en ningún lado.
  update public.app_users
  set must_change_password = true
  where user_id = target_user_id;
end;
$$;

-- Apaga el flag del usuario de la sesión, pero solo si el hash de Auth cambió
-- respecto del marker. Llamarla por PostgREST sin haber cambiado la
-- contraseña no libera nada. Fail-closed: cualquier duda deja el flag prendido.
create function public.confirm_password_changed()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pending_marker text;
begin
  if uid is null then
    raise exception 'Sesión requerida' using errcode = 'insufficient_privilege';
  end if;

  select marker into pending_marker
  from private.password_markers
  where user_id = uid and cleared_at is null
  for update;

  if pending_marker is null then
    raise exception 'No hay un cambio de contraseña pendiente' using errcode = 'no_data_found';
  end if;

  if private.password_hash_marker(uid) is not distinct from pending_marker then
    raise exception 'La contraseña no cambió' using errcode = 'check_violation';
  end if;

  update public.app_users
  set must_change_password = false,
      password_changed_at = now()
  where user_id = uid;

  update private.password_markers
  set cleared_at = now()
  where user_id = uid;

  return true;
end;
$$;

revoke execute on function public.mark_password_reset(uuid) from public, anon;
revoke execute on function public.confirm_password_changed() from public, anon;
grant execute on function public.mark_password_reset(uuid) to authenticated, service_role;
grant execute on function public.confirm_password_changed() to authenticated;

-- -----------------------------------------------------------------------------
-- audit_log: append-only
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_source text not null check (actor_source in ('session', 'explicit', 'system')),
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE', 'EXPORT')),
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  context jsonb
);

comment on table public.audit_log is
  'Registro de auditoría. Append-only: sin grants de escritura para nadie; solo lo escriben triggers SECURITY DEFINER.';

create index audit_log_occurred_at_brin on public.audit_log using brin (occurred_at);
create index audit_log_record_idx on public.audit_log (table_name, record_id);
create index audit_log_actor_idx on public.audit_log (actor_id);
-- Keyset de /auditoria: más nuevo primero.
create index audit_log_keyset_idx on public.audit_log (occurred_at desc, id desc);

-- El actor sale de auth.uid(). Cuando no hay sesión (bootstrap, jobs), de
-- `app.actor_id` fijado con set_config por quien corre la operación; si no hay
-- ninguno, queda como 'system' sin actor.
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pk_column text := coalesce(tg_argv[0], 'id');
  actor uuid := auth.uid();
  source text := 'session';
  old_row jsonb;
  new_row jsonb;
  changed text[];
  explicit_actor text;
begin
  if actor is null then
    explicit_actor := nullif(current_setting('app.actor_id', true), '');
    if explicit_actor is not null then
      actor := explicit_actor::uuid;
      source := 'explicit';
    else
      source := 'system';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    old_row := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_row := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    -- updated_at cambia en todo UPDATE y search_text es derivada: ninguna de
    -- las dos es un cambio que alguien hizo.
    select array_agg(key order by key) into changed
    from jsonb_each(new_row) as n(key, value)
    where key not in ('updated_at', 'search_text')
      and n.value is distinct from old_row -> key;

    if changed is null then
      return null;
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_source, op, table_name, record_id, old_data, new_data, changed_fields)
  values (
    actor,
    source,
    tg_op,
    tg_table_name,
    coalesce(new_row, old_row) ->> pk_column,
    old_row,
    new_row,
    changed
  );

  return null;
end;
$$;

create function private.audit_log_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El registro de auditoría no se puede modificar ni borrar'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function private.audit_log_guard();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_guard();
-- `enable always`: vale también con session_replication_role = replica, que es
-- como se desactivan los triggers comunes.
alter table public.audit_log enable always trigger audit_log_no_update_delete;
alter table public.audit_log enable always trigger audit_log_no_truncate;

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using ((select private.is_admin()));

revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;

-- Activa la auditoría sobre una tabla. Idempotente.
create function private.enable_audit(target regclass, pk_column text default 'id')
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('drop trigger if exists audit_row_change on %s', target);
  execute format(
    'create trigger audit_row_change after insert or update or delete on %s '
    'for each row execute function private.audit_row_change(%L)',
    target, pk_column
  );
end;
$$;

revoke execute on function private.enable_audit(regclass, text) from public, anon, authenticated, service_role;

select private.enable_audit('public.app_users', 'user_id');

-- -----------------------------------------------------------------------------
-- settings: singleton
-- -----------------------------------------------------------------------------
create table public.settings (
  id smallint primary key default 1 check (id = 1),
  club_name text not null default 'Club Social y Deportivo Naranja y Blanco',
  -- Primer período que genera cuotas (lo usa el slice 2). Primer día de mes.
  billing_start_period date check (
    billing_start_period is null or billing_start_period = date_trunc('month', billing_start_period)::date
  ),
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function private.set_updated_at();

alter table public.settings enable row level security;
alter table public.settings force row level security;

create policy settings_select on public.settings
  for select to authenticated
  using ((select private.current_app_role()) is not null);

create policy settings_update on public.settings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.settings from anon, authenticated, service_role;
grant select on public.settings to authenticated, service_role;
grant update (club_name, billing_start_period) on public.settings to authenticated;

select private.enable_audit('public.settings');
