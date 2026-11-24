-- =============================================================================
-- App de socios, S2 — cuentas, vínculos, tokens de acceso y pedidos de acceso.
-- Pipeline: lonqui-workspace/docs/pipelines/2026-11-24-app-socios/ (00 §4.A–§4.D,
-- §4.H, §5; ajustes A1–A5 por los spikes).
--
-- Reglas que esta migración hace mecánicas:
--   - El socio NO es un rol de app_users. Las cuentas de la app viven acá y
--     ninguna policy del panel las deja pasar (tests/db/portal-lockdown.test.ts).
--   - Las tablas nuevas: RLS prendida y forzada, SELECT solo para el panel con
--     permiso, CERO escritura para authenticated. Escriben solo las RPC.
--   - El socio lee por RPC public.portal_* SECURITY DEFINER, que resuelven la
--     cuenta desde auth.uid() y la visibilidad con private.portal_member_ids().
--   - Las RPC "de servicio" (las llama /api/v1 de la app con la secret key)
--     empiezan con portal_ pero NO son ejecutables por authenticated: solo
--     service_role. Ojo: el test de cierre exime a portal_*; S2-T4 prueba esto.
--   - Tokens: 256 bits, en la base solo el SHA-256, un solo uso, nada se borra.
--   - enable_signup sigue en false: nadie crea un usuario de Auth sin un token
--     que emitió la Comisión.
--
-- Convive con el código viejo: solo agrega tablas, funciones, permisos nuevos
-- y una columna nullable en settings. No toca ninguna policy existente.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Permisos nuevos. Reemplaza la definición de 20261013120000 (la vigente es la
-- de la migración más nueva).
--   portal.review      Revisión de pedidos, cuentas vinculadas, revocar, bloquear
--   portal.invite      Emitir invitaciones (WhatsApp o QR)
--   portal.login_link  Emitir enlaces de ingreso: SOLO admin, porque quien lo
--                      emite puede abrirlo (00 §4.A.7)
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
      'income.read', 'income.register', 'income.void', 'sponsors.deactivate',
      'portal.review', 'portal.invite', 'portal.login_link'
    ]
    when 'editor' then array[
      'members.read', 'members.write',
      'payments.read', 'payments.register',
      'reports.read', 'reports.export',
      'income.read', 'income.register',
      'portal.review', 'portal.invite'
    ]
    when 'consulta' then array[
      'members.read', 'payments.read', 'reports.read', 'reports.export',
      'income.read'
    ]
    else array[]::text[]
  end;
$$;

-- -----------------------------------------------------------------------------
-- settings: código de área por defecto para normalizar teléfonos sin área.
-- -----------------------------------------------------------------------------
alter table public.settings
  add column default_phone_area_code text
    check (default_phone_area_code is null or default_phone_area_code ~ '^[1-9][0-9]{1,3}$');

comment on column public.settings.default_phone_area_code is
  'Código de área (sin 0) que se asume para un teléfono cargado sin área. Solo para sugerir coincidencias y normalizar entradas nuevas.';

grant update (default_phone_area_code) on public.settings to authenticated;

-- -----------------------------------------------------------------------------
-- portal_accounts: la persona que entra a la app. Muchas veces NO es socio
-- (el padre o la madre de un menor). La credencial es de Supabase Auth: acá
-- nunca hay un hash (el trigger de auditoría copia la fila entera a audit_log).
-- -----------------------------------------------------------------------------
create table public.portal_accounts (
  user_id uuid primary key references auth.users (id) on delete restrict,
  first_name text not null check (length(btrim(first_name)) >= 1),
  last_name text not null check (length(btrim(last_name)) >= 1),
  -- Identificador del ingreso con contraseña (00 §4.C.3).
  dni text not null check (dni ~ '^[0-9]{7,8}$'),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[0-9]{8,15}$'),
  email_verified_at timestamptz,
  password_set_at timestamptz,
  terms_accepted_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'blocked')),
  blocked_reason text,
  blocked_at timestamptz,
  blocked_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint portal_accounts_blocked_has_reason check (
    (status = 'blocked') = (blocked_at is not null)
    and (status <> 'blocked' or length(btrim(coalesce(blocked_reason, ''))) >= 3)
  )
);

comment on table public.portal_accounts is
  'Cuentas de la app de socios. No son usuarios del panel: nunca tienen fila en app_users. Escriben solo las RPC portal_* y las del panel.';

-- Una persona, una cuenta (entre las no bloqueadas).
create unique index portal_accounts_dni_key
  on public.portal_accounts (dni) where status <> 'blocked';

create trigger portal_accounts_set_updated_at
  before update on public.portal_accounts
  for each row execute function private.set_updated_at();

create trigger portal_accounts_immutable
  before update on public.portal_accounts
  for each row execute function private.protect_immutable_columns('user_id', 'dni', 'terms_accepted_at', 'created_at');

create trigger portal_accounts_no_delete
  before delete on public.portal_accounts
  for each row execute function private.forbid_change();

-- -----------------------------------------------------------------------------
-- portal_access_requests: el que llega sin invitación deja un pedido, SIN
-- cuenta de Auth. Revisión lo convierte en invitación (00 §4.A.8, §4.H).
-- -----------------------------------------------------------------------------
create table public.portal_access_requests (
  id bigint generated always as identity primary key,
  first_name text not null check (length(btrim(first_name)) >= 1),
  last_name text not null check (length(btrim(last_name)) >= 1),
  dni text not null check (dni ~ '^[0-9]{7,8}$'),
  phone_raw text not null check (length(btrim(phone_raw)) between 6 and 30),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[0-9]{8,15}$'),
  email text check (email is null or (email = lower(email) and length(email) <= 254)),
  message text check (message is null or length(message) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'invited', 'completed', 'rejected')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index portal_access_requests_pending_idx
  on public.portal_access_requests (created_at) where status = 'pending';

create trigger portal_access_requests_set_updated_at
  before update on public.portal_access_requests
  for each row execute function private.set_updated_at();

create trigger portal_access_requests_immutable
  before update on public.portal_access_requests
  for each row execute function private.protect_immutable_columns(
    'id', 'first_name', 'last_name', 'dni', 'phone_raw', 'phone_e164', 'email', 'message', 'created_at'
  );

create trigger portal_access_requests_no_delete
  before delete on public.portal_access_requests
  for each row execute function private.forbid_change();

-- Transiciones: pending → invited | rejected; invited → invited (reemisión) |
-- completed | rejected. completed y rejected son finales.
create function private.portal_access_requests_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('completed', 'rejected') then
    raise exception 'El pedido ya está resuelto' using errcode = 'check_violation';
  end if;

  if not (
    (old.status = 'pending' and new.status in ('pending', 'invited', 'rejected'))
    or (old.status = 'invited' and new.status in ('invited', 'completed', 'rejected'))
  ) then
    raise exception 'El pedido ya está resuelto' using errcode = 'check_violation';
  end if;

  if new.status = 'rejected' and length(btrim(coalesce(new.resolution_note, ''))) < 3 then
    raise exception 'Indicá el motivo del rechazo' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger portal_access_requests_transition
  before update of status on public.portal_access_requests
  for each row execute function private.portal_access_requests_transition_guard();

-- A quién quiere ver la persona que pide. Lo declarado, inmutable.
create table public.portal_access_request_people (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.portal_access_requests (id) on delete restrict,
  first_name text not null check (length(btrim(first_name)) >= 1),
  last_name text not null check (length(btrim(last_name)) >= 1),
  dni text check (dni is null or dni ~ '^[0-9]{7,8}$'),
  -- Relación de quien pide con esta persona.
  relationship text not null check (relationship in ('self', 'guardian')),
  created_at timestamptz not null default now()
);

create index portal_access_request_people_request_idx
  on public.portal_access_request_people (request_id);

create trigger portal_access_request_people_no_change
  before update or delete on public.portal_access_request_people
  for each row execute function private.forbid_change();

-- -----------------------------------------------------------------------------
-- portal_access_tokens: invitaciones y enlaces de ingreso (00 §4.A.2).
--
-- Una invitación siempre se ancla a un socio. "Invitar al grupo" es la misma
-- invitación con family_scope: la visibilidad del grupo se DERIVA del
-- family_group_id del socio ancla, no se materializa por hermano (00 §4.B).
-- -----------------------------------------------------------------------------
create table public.portal_access_tokens (
  id bigint generated always as identity primary key,
  purpose text not null check (purpose in ('invite', 'login')),
  -- SHA-256 del token. El valor en claro existe una sola vez: en la respuesta
  -- de create_portal_token. Nunca se persiste ni se loguea.
  token_hash bytea not null check (length(token_hash) = 32),
  member_id bigint references public.members (id) on delete restrict,
  account_id uuid references public.portal_accounts (user_id) on delete restrict,
  family_scope boolean not null default false,
  relationship text check (relationship in ('self', 'guardian')),
  delivery text not null check (delivery in ('whatsapp', 'qr')),
  requires_dni_check boolean not null,
  failed_checks smallint not null default 0 check (failed_checks between 0 and 5),
  request_id bigint references public.portal_access_requests (id) on delete restrict,
  expires_at timestamptz not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,

  constraint portal_access_tokens_target check (
    (purpose = 'invite' and member_id is not null and account_id is null and relationship is not null)
    or (purpose = 'login' and account_id is not null and member_id is null
        and relationship is null and not family_scope and request_id is null)
  ),
  constraint portal_access_tokens_expiry check (expires_at > created_at),
  constraint portal_access_tokens_single_end check (consumed_at is null or revoked_at is null),
  constraint portal_access_tokens_consumed_by check ((consumed_at is null) = (consumed_by is null)),
  constraint portal_access_tokens_revoked check (
    (revoked_at is null) = (revoke_reason is null)
  )
);

create unique index portal_access_tokens_hash_key on public.portal_access_tokens (token_hash);
create index portal_access_tokens_member_idx on public.portal_access_tokens (member_id);
create index portal_access_tokens_account_idx on public.portal_access_tokens (account_id);
create index portal_access_tokens_request_idx on public.portal_access_tokens (request_id);
-- Lo que la ficha muestra: tokens vivos de un socio o una cuenta.
create index portal_access_tokens_pending_idx
  on public.portal_access_tokens (expires_at) where consumed_at is null and revoked_at is null;

-- Solo cambian: el contador de verificaciones, el consumo y la revocación.
-- Un token consumido o revocado ya no cambia.
create function private.portal_access_tokens_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.consumed_at is not null or old.revoked_at is not null then
    raise exception 'El enlace ya no está vigente' using errcode = 'check_violation';
  end if;

  if (to_jsonb(new) - array['failed_checks', 'consumed_at', 'consumed_by', 'revoked_at', 'revoked_by', 'revoke_reason'])
     is distinct from
     (to_jsonb(old) - array['failed_checks', 'consumed_at', 'consumed_by', 'revoked_at', 'revoked_by', 'revoke_reason']) then
    raise exception 'Los enlaces de acceso no se modifican' using errcode = 'insufficient_privilege';
  end if;

  if new.failed_checks < old.failed_checks then
    raise exception 'Los enlaces de acceso no se modifican' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger portal_access_tokens_update
  before update on public.portal_access_tokens
  for each row execute function private.portal_access_tokens_update_guard();

create trigger portal_access_tokens_no_delete
  before delete on public.portal_access_tokens
  for each row execute function private.forbid_change();

-- -----------------------------------------------------------------------------
-- portal_account_members: qué socios ve una cuenta.
--   relationship  self (la cuenta es ese socio) | guardian (responde por él)
--   family_scope  el vínculo extiende la vista a TODO el grupo del socio
-- Revocar es definitivo; volver a vincular es otra fila.
-- -----------------------------------------------------------------------------
create table public.portal_account_members (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.portal_accounts (user_id) on delete restrict,
  member_id bigint not null references public.members (id) on delete restrict,
  relationship text not null check (relationship in ('self', 'guardian')),
  family_scope boolean not null default false,
  token_id bigint references public.portal_access_tokens (id) on delete restrict,
  linked_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,

  constraint portal_account_members_revoked check (
    (revoked_at is null) = (revoke_reason is null)
    and (revoke_reason is null or length(btrim(revoke_reason)) >= 3)
  )
);

create unique index portal_account_members_active_key
  on public.portal_account_members (account_id, member_id) where revoked_at is null;
-- Un socio es "self" de una sola cuenta.
create unique index portal_account_members_one_self
  on public.portal_account_members (member_id) where relationship = 'self' and revoked_at is null;
create index portal_account_members_account_idx on public.portal_account_members (account_id);
create index portal_account_members_member_idx on public.portal_account_members (member_id);
create index portal_account_members_token_idx on public.portal_account_members (token_id);

create function private.portal_account_members_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null then
    raise exception 'El vínculo ya está revocado' using errcode = 'check_violation';
  end if;

  if (to_jsonb(new) - array['revoked_at', 'revoked_by', 'revoke_reason'])
     is distinct from (to_jsonb(old) - array['revoked_at', 'revoked_by', 'revoke_reason']) then
    raise exception 'Los vínculos no se modifican: se revocan' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger portal_account_members_update
  before update on public.portal_account_members
  for each row execute function private.portal_account_members_update_guard();

create trigger portal_account_members_no_delete
  before delete on public.portal_account_members
  for each row execute function private.forbid_change();

-- -----------------------------------------------------------------------------
-- private.portal_rate_limits: ventanas fijas por balde. El sujeto se guarda
-- hasheado (puede ser un DNI o una IP: no es un lugar para datos personales).
-- -----------------------------------------------------------------------------
create table private.portal_rate_limits (
  bucket text not null,
  subject_hash text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, subject_hash, window_start)
);

create index portal_rate_limits_window_idx on private.portal_rate_limits (window_start);

-- Cuenta un intento y dice si todavía está dentro del límite.
create function private.portal_rate_hit(p_bucket text, p_subject text, p_window interval, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  win_seconds double precision := extract(epoch from p_window);
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / win_seconds) * win_seconds);
  v_hits integer;
begin
  insert into private.portal_rate_limits as r (bucket, subject_hash, window_start, hits)
  values (
    p_bucket,
    encode(sha256(convert_to(p_bucket || ':' || coalesce(p_subject, ''), 'UTF8')), 'hex'),
    v_window,
    1
  )
  on conflict (bucket, subject_hash, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;

  return v_hits <= p_max;
end;
$$;

-- -----------------------------------------------------------------------------
-- Helpers de visibilidad del socio
-- -----------------------------------------------------------------------------

-- La cuenta de la sesión, solo si está activa. Null para cualquier otro.
create function private.portal_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id
  from public.portal_accounts a
  where a.user_id = (select auth.uid())
    and a.status = 'active';
$$;

-- LA definición de qué socios ve la cuenta de la sesión: vínculos directos ∪
-- grupo familiar de los vínculos con family_scope. Derivada en el momento: el
-- hermano que se suma al grupo aparece solo y el que sale deja de verse.
-- Bloquear la cuenta o revocar el vínculo corta al instante.
create function private.portal_member_ids()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  with links as (
    select l.member_id, l.family_scope
    from public.portal_account_members l
    where l.account_id = private.portal_account_id()
      and l.revoked_at is null
  )
  select member_id from links
  union
  select m.id
  from links l
  join public.members anchor on anchor.id = l.member_id
  join public.members m on m.family_group_id = anchor.family_group_id
  where l.family_scope
    and anchor.family_group_id is not null;
$$;

-- -----------------------------------------------------------------------------
-- Teléfonos: claves de coincidencia (00 §4.A.9). Deliberadamente laxa: alimenta
-- a un humano en Revisión, nunca decide un vínculo.
-- Devuelve claves de 10 dígitos (área + abonado, sin 54, sin 9, sin 0, sin 15)
-- o, si no se puede, los dígitos tal cual.
-- -----------------------------------------------------------------------------
create function private.phone_match_keys(raw text, default_area text default null)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
  keys text[] := array[]::text[];
  a integer;
begin
  if d = '' then
    return keys;
  end if;

  if d like '54%' and length(d) >= 12 then
    d := substr(d, 3);
  end if;
  if d like '9%' and length(d) = 11 then
    d := substr(d, 2);
  end if;
  if d like '0%' then
    d := substr(d, 2);
  end if;

  if length(d) = 10 then
    keys := array[d];
  elsif length(d) = 12 then
    -- área de 2, 3 o 4 dígitos seguida de 15
    for a in 2..4 loop
      if substr(d, a + 1, 2) = '15' then
        keys := keys || (substr(d, 1, a) || substr(d, a + 3));
      end if;
    end loop;
  elsif length(d) < 10 and default_area is not null then
    if d like '15%' then
      d := substr(d, 3);
    end if;
    if length(default_area || d) = 10 then
      keys := array[default_area || d];
    end if;
  end if;

  if cardinality(keys) = 0 then
    keys := array[d];
  end if;

  return keys;
end;
$$;

-- ¿El DNI dado corresponde a la invitación o al enlace? (00 §4.A.4)
-- Invitación: el DNI de un socio de la invitación (el ancla, o su grupo si
-- family_scope). Ingreso: el DNI de la cuenta.
create function private.portal_token_dni_matches(t public.portal_access_tokens, p_dni text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_dni is null then false
    when t.purpose = 'login' then exists (
      select 1 from public.portal_accounts a where a.user_id = t.account_id and a.dni = p_dni
    )
    else exists (
      select 1
      from public.members anchor
      join public.members m
        on m.id = anchor.id
        or (t.family_scope and anchor.family_group_id is not null and m.family_group_id = anchor.family_group_id)
      where anchor.id = t.member_id
        and m.dni = p_dni
    )
  end;
$$;

-- -----------------------------------------------------------------------------
-- RLS y grants. SELECT para el panel con permiso; nada de escritura directa.
-- -----------------------------------------------------------------------------
alter table public.portal_accounts enable row level security;
alter table public.portal_accounts force row level security;
alter table public.portal_access_requests enable row level security;
alter table public.portal_access_requests force row level security;
alter table public.portal_access_request_people enable row level security;
alter table public.portal_access_request_people force row level security;
alter table public.portal_access_tokens enable row level security;
alter table public.portal_access_tokens force row level security;
alter table public.portal_account_members enable row level security;
alter table public.portal_account_members force row level security;
alter table private.portal_rate_limits enable row level security;

create policy portal_accounts_select on public.portal_accounts
  for select to authenticated
  using ((select private.can('portal.review')) or (select private.can('portal.invite')));

create policy portal_access_requests_select on public.portal_access_requests
  for select to authenticated
  using ((select private.can('portal.review')));

create policy portal_access_request_people_select on public.portal_access_request_people
  for select to authenticated
  using ((select private.can('portal.review')));

create policy portal_access_tokens_select on public.portal_access_tokens
  for select to authenticated
  using ((select private.can('portal.review')) or (select private.can('portal.invite')));

create policy portal_account_members_select on public.portal_account_members
  for select to authenticated
  using ((select private.can('portal.review')) or (select private.can('portal.invite')));

grant select on
  public.portal_accounts,
  public.portal_access_requests,
  public.portal_access_request_people,
  public.portal_access_tokens,
  public.portal_account_members
to authenticated, service_role;

select private.enable_audit('public.portal_accounts', 'user_id');
select private.enable_audit('public.portal_access_requests');
select private.enable_audit('public.portal_access_request_people');
select private.enable_audit('public.portal_access_tokens');
select private.enable_audit('public.portal_account_members');

-- =============================================================================
-- RPC del panel (authenticated; cada una verifica el permiso en el cuerpo)
-- =============================================================================

-- Emite una invitación o un enlace de ingreso. Devuelve el token en claro UNA
-- vez: el controller arma la URL con el token en el fragmento (#t=) y nunca lo
-- persiste ni lo loguea.
--
-- Vigencias (D8): QR en la sede 15 min; enlace de ingreso por WhatsApp 30 min;
-- invitación por WhatsApp 72 h.
--
-- p_replace_pending: revoca los tokens vivos del mismo propósito y destino
-- (reemitir). Para invitar a OTRA persona sobre el mismo socio (madre y padre)
-- se pasa false, o se revocaría la invitación de la primera.
create function public.create_portal_token(
  p_purpose text,
  p_delivery text,
  p_member_id bigint default null,
  p_family_scope boolean default false,
  p_relationship text default null,
  p_account_id uuid default null,
  p_request_id bigint default null,
  p_replace_pending boolean default true
)
returns table (token_id bigint, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_expires timestamptz;
  v_requires_dni boolean;
  v_id bigint;
  anchor record;
  v_request_status text;
begin
  if p_purpose = 'invite' then
    if not private.can('portal.invite') then
      raise exception 'No tenés permiso para invitar a la app' using errcode = 'insufficient_privilege';
    end if;
  elsif p_purpose = 'login' then
    if not private.can('portal.login_link') then
      raise exception 'Solo un Administrador puede emitir enlaces de ingreso' using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'Tipo de enlace inválido' using errcode = 'check_violation';
  end if;

  if p_delivery not in ('whatsapp', 'qr') then
    raise exception 'Forma de entrega inválida' using errcode = 'check_violation';
  end if;

  if p_purpose = 'invite' then
    if p_relationship not in ('self', 'guardian') or p_relationship is null then
      raise exception 'Indicá si la invitación es para el socio o para quien responde por él' using errcode = 'check_violation';
    end if;

    select m.id, m.family_group_id, m.status into anchor
    from public.members m where m.id = p_member_id;
    if not found then
      raise exception 'El socio no existe' using errcode = 'no_data_found';
    end if;
    if anchor.status <> 'active' then
      raise exception 'El socio está dado de baja' using errcode = 'check_violation';
    end if;
    if p_family_scope and anchor.family_group_id is null then
      raise exception 'El socio no tiene grupo familiar' using errcode = 'check_violation';
    end if;

    v_requires_dni := p_delivery = 'whatsapp' and exists (
      select 1 from public.members m
      where m.dni is not null
        and (m.id = anchor.id
             or (p_family_scope and m.family_group_id = anchor.family_group_id))
    );
    v_expires := now() + case p_delivery when 'qr' then interval '15 minutes' else interval '72 hours' end;

    if p_request_id is not null then
      select r.status into v_request_status
      from public.portal_access_requests r where r.id = p_request_id for update;
      if not found then
        raise exception 'El pedido no existe' using errcode = 'no_data_found';
      end if;
      if v_request_status not in ('pending', 'invited') then
        raise exception 'El pedido ya está resuelto' using errcode = 'check_violation';
      end if;
    end if;
  else
    if p_member_id is not null or p_request_id is not null or p_family_scope then
      raise exception 'Un enlace de ingreso es para una cuenta' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.portal_accounts a where a.user_id = p_account_id and a.status = 'active'
    ) then
      raise exception 'La cuenta no existe o está bloqueada' using errcode = 'check_violation';
    end if;

    v_requires_dni := p_delivery = 'whatsapp';
    v_expires := now() + case p_delivery when 'qr' then interval '15 minutes' else interval '30 minutes' end;
  end if;

  if p_replace_pending then
    update public.portal_access_tokens t
    set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Reemplazado por un enlace nuevo'
    where t.purpose = p_purpose
      and t.consumed_at is null
      and t.revoked_at is null
      and t.expires_at > now()
      and (
        -- Desde un pedido: solo las invitaciones de ESE pedido. Dos pedidos por el
        -- mismo socio (madre y padre) no se revocan entre sí.
        (p_purpose = 'invite' and p_request_id is not null and t.request_id = p_request_id)
        or (p_purpose = 'invite' and p_request_id is null and t.request_id is null
            and t.member_id = p_member_id and t.family_scope = p_family_scope)
        or (p_purpose = 'login' and t.account_id = p_account_id)
      );
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.portal_access_tokens (
    purpose, token_hash, member_id, account_id, family_scope, relationship,
    delivery, requires_dni_check, request_id, expires_at
  ) values (
    p_purpose, sha256(convert_to(v_token, 'UTF8')),
    case when p_purpose = 'invite' then p_member_id end,
    case when p_purpose = 'login' then p_account_id end,
    coalesce(p_family_scope, false) and p_purpose = 'invite',
    case when p_purpose = 'invite' then p_relationship end,
    p_delivery, v_requires_dni, p_request_id, v_expires
  )
  returning id into v_id;

  if p_request_id is not null then
    update public.portal_access_requests r
    set status = 'invited', resolved_by = auth.uid(), resolved_at = now()
    where r.id = p_request_id;
  end if;

  return query select v_id, v_token, v_expires;
end;
$$;

create function public.revoke_portal_token(p_token_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  select tk.purpose, tk.consumed_at, tk.revoked_at into t
  from public.portal_access_tokens tk where tk.id = p_token_id for update;
  if not found then
    raise exception 'El enlace no existe' using errcode = 'no_data_found';
  end if;

  if not private.can(case t.purpose when 'login' then 'portal.login_link' else 'portal.invite' end) then
    raise exception 'No tenés permiso para revocar este enlace' using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indicá el motivo' using errcode = 'check_violation';
  end if;
  if t.consumed_at is not null or t.revoked_at is not null then
    raise exception 'El enlace ya no está vigente' using errcode = 'check_violation';
  end if;

  update public.portal_access_tokens
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
  where id = p_token_id;
end;
$$;

-- Sugerencias para Revisión. NO se guardan: se calculan contra el padrón del
-- momento. El orden de Tomás (DNI → teléfono → email → nombre) es el peso: un DNI
-- exacto (100) le gana a cualquier suma del resto (30 + 25 + 20 + 15 = 90).
create function public.portal_request_candidates(p_request_id bigint)
returns table (
  person_id bigint,
  member_id bigint,
  score integer,
  reasons text[],
  family_group_id bigint,
  has_account boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  req record;
  area text;
  req_keys text[];
begin
  if not private.can('portal.review') then
    raise exception 'No tenés permiso para revisar pedidos' using errcode = 'insufficient_privilege';
  end if;

  select r.* into req from public.portal_access_requests r where r.id = p_request_id;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'no_data_found';
  end if;

  select s.default_phone_area_code into area from public.settings s where s.id = 1;
  req_keys := private.phone_match_keys(coalesce(req.phone_e164, req.phone_raw), area);

  return query
  with people as (
    select p.id, p.dni, private.normalize_text(p.first_name || ' ' || p.last_name) as norm_name
    from public.portal_access_request_people p
    where p.request_id = p_request_id
  ),
  scored as (
    select
      pe.id as person_id,
      m.id as member_id,
      m.family_group_id,
      (pe.dni is not null and m.dni = pe.dni) as dni_hit,
      (private.phone_match_keys(m.phone, area) && req_keys) as phone_hit,
      (g.payer_contact_phone is not null and private.phone_match_keys(g.payer_contact_phone, area) && req_keys) as payer_phone_hit,
      (req.email is not null and m.email = req.email) as email_hit,
      extensions.similarity(pe.norm_name, private.normalize_text(m.first_name || ' ' || m.last_name)) as name_sim
    from people pe
    cross join public.members m
    left join public.family_groups g on g.id = m.family_group_id
  ),
  ranked as (
    select
      s.*,
      (case when s.dni_hit then 100 else 0 end
       + case when s.phone_hit then 30 else 0 end
       + case when s.payer_phone_hit then 25 else 0 end
       + case when s.email_hit then 20 else 0 end
       + case when s.name_sim >= 0.45 then round(s.name_sim * 15)::integer else 0 end) as total,
      row_number() over (
        partition by s.person_id
        order by (case when s.dni_hit then 100 else 0 end
                  + case when s.phone_hit then 30 else 0 end
                  + case when s.payer_phone_hit then 25 else 0 end
                  + case when s.email_hit then 20 else 0 end
                  + case when s.name_sim >= 0.45 then round(s.name_sim * 15)::integer else 0 end) desc,
                 s.name_sim desc, s.member_id
      ) as rn
    from scored s
    where s.dni_hit or s.phone_hit or s.payer_phone_hit or s.email_hit or s.name_sim >= 0.45
  )
  select
    r.person_id,
    r.member_id,
    r.total,
    array_remove(array[
      case when r.dni_hit then 'dni' end,
      case when r.phone_hit then 'phone' end,
      case when r.payer_phone_hit then 'payer_phone' end,
      case when r.email_hit then 'email' end,
      case when r.name_sim >= 0.45 then 'name' end
    ], null),
    r.family_group_id,
    exists (
      select 1 from public.portal_account_members l
      join public.portal_accounts a on a.user_id = l.account_id
      where l.member_id = r.member_id and l.revoked_at is null and a.status = 'active'
    )
  from ranked r
  where r.rn <= 5
  order by r.person_id, r.total desc, r.rn;
end;
$$;

-- Rechazar un pedido. Invitar se hace con create_portal_token(p_request_id).
create function public.resolve_portal_request(p_request_id bigint, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can('portal.review') then
    raise exception 'No tenés permiso para revisar pedidos' using errcode = 'insufficient_privilege';
  end if;
  if p_status <> 'rejected' then
    raise exception 'Para invitar, emití una invitación desde el pedido' using errcode = 'check_violation';
  end if;

  update public.portal_access_requests
  set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(),
      resolution_note = nullif(btrim(p_note), '')
  where id = p_request_id and status in ('pending', 'invited');

  if not found then
    if exists (select 1 from public.portal_access_requests where id = p_request_id) then
      raise exception 'El pedido ya está resuelto' using errcode = 'check_violation';
    end if;
    raise exception 'El pedido no existe' using errcode = 'no_data_found';
  end if;

  -- Un pedido rechazado no deja invitaciones vivas.
  update public.portal_access_tokens
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Pedido rechazado'
  where request_id = p_request_id and consumed_at is null and revoked_at is null;
end;
$$;

create function public.revoke_portal_link(p_link_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can('portal.review') then
    raise exception 'No tenés permiso para administrar cuentas de la app' using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indicá el motivo' using errcode = 'check_violation';
  end if;

  update public.portal_account_members
  set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
  where id = p_link_id and revoked_at is null;

  if not found then
    raise exception 'El vínculo no existe o ya está revocado' using errcode = 'check_violation';
  end if;
end;
$$;

-- Bloquear corta al instante (portal_member_ids deja de devolver filas aunque
-- la sesión siga viva) y revoca los enlaces de ingreso pendientes.
create function public.set_portal_account_status(p_user_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  if not private.can('portal.review') then
    raise exception 'No tenés permiso para administrar cuentas de la app' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('active', 'blocked') then
    raise exception 'Estado inválido' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Indicá el motivo' using errcode = 'check_violation';
  end if;

  select a.status into current_status from public.portal_accounts a where a.user_id = p_user_id for update;
  if not found then
    raise exception 'La cuenta no existe' using errcode = 'no_data_found';
  end if;
  if current_status = p_status then
    raise exception 'La cuenta ya está en ese estado' using errcode = 'check_violation';
  end if;

  if p_status = 'blocked' then
    update public.portal_accounts
    set status = 'blocked', blocked_reason = btrim(p_reason), blocked_at = now(), blocked_by = auth.uid()
    where user_id = p_user_id;

    update public.portal_access_tokens
    set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Cuenta bloqueada'
    where account_id = p_user_id and consumed_at is null and revoked_at is null;
  else
    -- Desbloquear: el índice único de DNI rechaza si otra cuenta activa tomó
    -- ese DNI mientras tanto.
    update public.portal_accounts
    set status = 'active', blocked_reason = null, blocked_at = null, blocked_by = null
    where user_id = p_user_id;
  end if;
end;
$$;

-- =============================================================================
-- RPC del socio (authenticated; resuelven la cuenta desde auth.uid())
-- =============================================================================

-- Quién soy y a quién veo. Null si la sesión no es una cuenta activa de la app.
create function public.portal_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when a.user_id is null then null else jsonb_build_object(
    'first_name', a.first_name,
    'last_name', a.last_name,
    'has_password', a.password_set_at is not null,
    'has_verified_email', a.email_verified_at is not null,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
          'member_id', m.id,
          'first_name', m.first_name,
          'last_name', m.last_name,
          'is_active', m.status = 'active',
          'family_group_id', m.family_group_id,
          -- 'self' | 'guardian' si hay vínculo directo; 'family' si se ve por el grupo
          'relationship', coalesce(direct.relationship, 'family')
        ) order by m.last_name, m.first_name, m.id)
      from private.portal_member_ids() v(member_id)
      join public.members m on m.id = v.member_id
      left join public.portal_account_members direct
        on direct.member_id = m.id and direct.account_id = a.user_id and direct.revoked_at is null
    ), '[]'::jsonb)
  ) end
  from (select private.portal_account_id() as uid) s
  left join public.portal_accounts a on a.user_id = s.uid;
$$;

-- Anota que la persona definió contraseña. NO recibe la contraseña: la define
-- el cliente con auth.updateUser y después llama a esto.
create function public.portal_mark_password_set()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.portal_accounts
  set password_set_at = now()
  where user_id = private.portal_account_id();

  if not found then
    raise exception 'No hay una cuenta activa en esta sesión' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- =============================================================================
-- RPC de servicio (SOLO service_role: las llama /api/v1 de la app de socios)
-- =============================================================================

-- Valida un token SIN consumirlo, y la verificación de DNI si corresponde.
-- Un DNI equivocado suma un intento; al quinto el token queda bloqueado.
-- status: ok | invalid | locked | dni_required | dni_mismatch
-- 'invalid' cubre inexistente, vencido, usado y revocado: no se distingue.
create function public.portal_token_peek(p_token text, p_dni text default null)
returns table (status text, token_id bigint, purpose text, account_id uuid, family_scope boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.portal_access_tokens;
begin
  select * into t
  from public.portal_access_tokens tk
  where tk.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
    and tk.consumed_at is null
    and tk.revoked_at is null
    and tk.expires_at > now()
  for update;

  if not found then
    return query select 'invalid'::text, null::bigint, null::text, null::uuid, null::boolean;
    return;
  end if;

  if t.failed_checks >= 5 then
    return query select 'locked'::text, null::bigint, null::text, null::uuid, null::boolean;
    return;
  end if;

  if t.requires_dni_check then
    if p_dni is null then
      return query select 'dni_required'::text, t.id, t.purpose, null::uuid, null::boolean;
      return;
    end if;
    if not private.portal_token_dni_matches(t, p_dni) then
      update public.portal_access_tokens set failed_checks = failed_checks + 1 where id = t.id;
      return query select
        case when t.failed_checks + 1 >= 5 then 'locked' else 'dni_mismatch' end::text,
        null::bigint, null::text, null::uuid, null::boolean;
      return;
    end if;
  end if;

  return query select 'ok'::text, t.id, t.purpose, t.account_id, t.family_scope;
end;
$$;

-- Consume el token y, en la misma transacción, crea la cuenta y el vínculo
-- (invitación) o solo consume (ingreso). Ajuste A1: la app llama a esto DESPUÉS
-- de tener la sesión de Auth en mano; si devuelve algo distinto de 'ok', la app
-- borra el usuario de Auth que acaba de crear y descarta la sesión.
--
-- p_user_id: el usuario de Auth (recién creado, o el de la sesión si la persona
-- ya tenía cuenta y abre otra invitación: suma vínculos, no crea otra cuenta).
--
-- status: ok | invalid | locked | dni_mismatch | dni_has_account
--         | self_dni_mismatch | member_has_self_account | account_mismatch
--         | account_blocked | missing_data | staff_account
create function public.portal_token_consume(
  p_token text,
  p_user_id uuid,
  p_check_dni text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_person_dni text default null,
  p_phone_e164 text default null,
  p_terms_accepted boolean default false
)
returns table (status text, account_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.portal_access_tokens;
  acct record;
  anchor record;
  existing_link record;
begin
  if p_user_id is null then
    raise exception 'Falta el usuario' using errcode = 'check_violation';
  end if;

  -- Un usuario del panel nunca es además una cuenta de la app: la misma
  -- persona tiene dos usuarios de Auth (00 §4.D, "la misma persona en los dos
  -- mundos"). Mezclarlos haría que el socio herede el rol interno.
  if exists (select 1 from public.app_users u where u.user_id = p_user_id) then
    return query select 'staff_account'::text, null::uuid;
    return;
  end if;

  -- Sin sesión (secret key): la auditoría registra como actor a la persona.
  perform set_config('app.actor_id', p_user_id::text, true);

  select * into t
  from public.portal_access_tokens tk
  where tk.token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
    and tk.consumed_at is null
    and tk.revoked_at is null
    and tk.expires_at > now()
  for update;

  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  if t.failed_checks >= 5 then
    return query select 'locked'::text, null::uuid;
    return;
  end if;
  if t.requires_dni_check and not private.portal_token_dni_matches(t, p_check_dni) then
    update public.portal_access_tokens set failed_checks = failed_checks + 1 where id = t.id;
    return query select
      case when t.failed_checks + 1 >= 5 then 'locked' else 'dni_mismatch' end::text, null::uuid;
    return;
  end if;

  select a.user_id, a.status, a.dni into acct
  from public.portal_accounts a where a.user_id = p_user_id for update;

  -- Enlace de ingreso: es para una cuenta precisa.
  if t.purpose = 'login' then
    if t.account_id <> p_user_id then
      return query select 'account_mismatch'::text, null::uuid;
      return;
    end if;
    if acct.status is distinct from 'active' then
      return query select 'account_blocked'::text, null::uuid;
      return;
    end if;

    update public.portal_access_tokens
    set consumed_at = now(), consumed_by = p_user_id
    where id = t.id;

    return query select 'ok'::text, p_user_id;
    return;
  end if;

  -- Invitación.
  select m.id, m.dni into anchor from public.members m where m.id = t.member_id;

  if acct.user_id is null then
    if p_first_name is null or p_last_name is null or p_person_dni is null or not coalesce(p_terms_accepted, false) then
      return query select 'missing_data'::text, null::uuid;
      return;
    end if;
    if p_person_dni !~ '^[0-9]{7,8}$' then
      return query select 'missing_data'::text, null::uuid;
      return;
    end if;
    if exists (select 1 from public.portal_accounts a where a.dni = p_person_dni and a.status <> 'blocked') then
      return query select 'dni_has_account'::text, null::uuid;
      return;
    end if;
  elsif acct.status <> 'active' then
    return query select 'account_blocked'::text, null::uuid;
    return;
  end if;

  -- "Soy ese socio": si el socio tiene DNI, tiene que ser el de la persona.
  if t.relationship = 'self' then
    if anchor.dni is not null and anchor.dni <> coalesce(acct.dni, p_person_dni) then
      return query select 'self_dni_mismatch'::text, null::uuid;
      return;
    end if;
    if exists (
      select 1 from public.portal_account_members l
      where l.member_id = t.member_id and l.relationship = 'self'
        and l.revoked_at is null and l.account_id <> p_user_id
    ) then
      return query select 'member_has_self_account'::text, null::uuid;
      return;
    end if;
  end if;

  if acct.user_id is null then
    insert into public.portal_accounts (user_id, first_name, last_name, dni, phone_e164, terms_accepted_at)
    values (p_user_id, btrim(p_first_name), btrim(p_last_name), p_person_dni, p_phone_e164, now());
  end if;

  select l.id, l.family_scope, l.relationship into existing_link
  from public.portal_account_members l
  where l.account_id = p_user_id and l.member_id = t.member_id and l.revoked_at is null
  for update;

  if existing_link.id is null then
    insert into public.portal_account_members (account_id, member_id, relationship, family_scope, token_id, linked_by)
    values (p_user_id, t.member_id, t.relationship, t.family_scope, t.id, t.created_by);
  elsif (t.family_scope and not existing_link.family_scope) or existing_link.relationship <> t.relationship then
    -- La invitación nueva amplía o corrige el vínculo: el viejo se revoca (la
    -- historia queda) y nace otro.
    update public.portal_account_members
    set revoked_at = now(), revoked_by = p_user_id, revoke_reason = 'Reemplazado por una invitación nueva'
    where id = existing_link.id;

    insert into public.portal_account_members (account_id, member_id, relationship, family_scope, token_id, linked_by)
    values (p_user_id, t.member_id, t.relationship, t.family_scope or existing_link.family_scope, t.id, t.created_by);
  end if;

  update public.portal_access_tokens
  set consumed_at = now(), consumed_by = p_user_id
  where id = t.id;

  if t.request_id is not null then
    -- Alias obligatorio: `status` también es columna OUT de esta función (42702).
    update public.portal_access_requests r
    set status = 'completed', resolved_at = now()
    where r.id = t.request_id and r.status = 'invited';
  end if;

  return query select 'ok'::text, p_user_id;
end;
$$;

-- Pedido de acceso sin cuenta (00 §4.A.8). La respuesta al usuario es SIEMPRE
-- la misma: si se pasa del límite, el pedido se descarta en silencio.
-- p_people: [{first_name, last_name, dni?, relationship: 'self'|'guardian'}], 1 a 10.
-- p_client_key: la IP (o un hash de ella) que manda la app; acá se vuelve a hashear.
create function public.portal_submit_access_request(
  p_first_name text,
  p_last_name text,
  p_dni text,
  p_phone_raw text,
  p_phone_e164 text,
  p_email text,
  p_message text,
  p_people jsonb,
  p_client_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  person jsonb;
begin
  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) not between 1 and 10 then
    raise exception 'Indicá a quién querés ver (hasta 10 personas)' using errcode = 'check_violation';
  end if;

  if not private.portal_rate_hit('access_request_client', p_client_key, interval '1 day', 5)
     or not private.portal_rate_hit('access_request_dni', p_dni, interval '1 day', 3) then
    return false;
  end if;

  insert into public.portal_access_requests (first_name, last_name, dni, phone_raw, phone_e164, email, message)
  values (btrim(p_first_name), btrim(p_last_name), p_dni, btrim(p_phone_raw), p_phone_e164,
          nullif(lower(btrim(p_email)), ''), nullif(btrim(p_message), ''))
  returning id into v_id;

  for person in select * from jsonb_array_elements(p_people) loop
    insert into public.portal_access_request_people (request_id, first_name, last_name, dni, relationship)
    values (
      v_id,
      btrim(person ->> 'first_name'),
      btrim(person ->> 'last_name'),
      nullif(btrim(person ->> 'dni'), ''),
      person ->> 'relationship'
    );
  end loop;

  return true;
end;
$$;

-- =============================================================================
-- Limpieza de ventanas de límite vencidas.
-- =============================================================================
select cron.unschedule(jobid) from cron.job where jobname = 'lonqui-portal-rate-limits-cleanup';

select cron.schedule(
  'lonqui-portal-rate-limits-cleanup',
  '15 4 * * *',
  $$delete from private.portal_rate_limits where window_start < now() - interval '2 days'$$
);

-- =============================================================================
-- Grants de funciones
-- =============================================================================
revoke execute on all functions in schema private from public, anon;

revoke execute on function
  public.create_portal_token(text, text, bigint, boolean, text, uuid, bigint, boolean),
  public.revoke_portal_token(bigint, text),
  public.portal_request_candidates(bigint),
  public.resolve_portal_request(bigint, text, text),
  public.revoke_portal_link(bigint, text),
  public.set_portal_account_status(uuid, text, text),
  public.portal_me(),
  public.portal_mark_password_set()
from public, anon;

grant execute on function
  public.create_portal_token(text, text, bigint, boolean, text, uuid, bigint, boolean),
  public.revoke_portal_token(bigint, text),
  public.portal_request_candidates(bigint),
  public.resolve_portal_request(bigint, text, text),
  public.revoke_portal_link(bigint, text),
  public.set_portal_account_status(uuid, text, text),
  public.portal_me(),
  public.portal_mark_password_set()
to authenticated;

-- De servicio: NI anon NI authenticated.
revoke execute on function
  public.portal_token_peek(text, text),
  public.portal_token_consume(text, uuid, text, text, text, text, text, boolean),
  public.portal_submit_access_request(text, text, text, text, text, text, text, jsonb, text)
from public, anon, authenticated;

grant execute on function
  public.portal_token_peek(text, text),
  public.portal_token_consume(text, uuid, text, text, text, text, text, boolean),
  public.portal_submit_access_request(text, text, text, text, text, text, text, jsonb, text)
to service_role;
