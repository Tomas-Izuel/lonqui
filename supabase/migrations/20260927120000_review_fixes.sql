-- =============================================================================
-- 0005 — Fixes del code review del slice 1 (03-review.md, blockers 2 y 3).
--
-- Reversa: drop del trigger members_clear_responsible_on_group_change y su
-- función; restaurar mark_password_reset de 0001 (sin password_reset_at);
-- drop de app_users.password_reset_at (pierde las fechas de reseteo, que ya
-- quedaron en audit_log).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Blocker 2: restablecer una contraseña tiene que dejar rastro SIEMPRE.
--
-- mark_password_reset solo quedaba auditado por el UPDATE de
-- must_change_password. Si el flag ya estaba en true (usuario que nunca entró,
-- o restablecido dos veces), el trigger de auditoría no veía cambio y no
-- escribía nada: un admin podía restablecer la contraseña de otro sin que
-- quedara registrado. Con una marca de tiempo propia, cada reseteo cambia una
-- columna y la auditoría lo registra con el actor.
-- -----------------------------------------------------------------------------
alter table public.app_users add column password_reset_at timestamptz;

comment on column public.app_users.password_reset_at is
  'Último reseteo de contraseña por un admin. Sin grant de UPDATE: lo escribe solo mark_password_reset, para que cada reseteo quede en la auditoría.';

grant select (password_reset_at) on public.app_users to authenticated, service_role;

create or replace function public.mark_password_reset(target_user_id uuid)
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

  -- password_reset_at cambia en cada llamada: aunque el flag ya estuviera
  -- prendido, el UPDATE siempre tiene un campo distinto y la auditoría lo ve.
  -- clock_timestamp() y no now(): now() es fijo dentro de una transacción, y
  -- dos reseteos en la misma (un script, un test) quedarían como uno.
  update public.app_users
  set must_change_password = true,
      password_reset_at = clock_timestamp()
  where user_id = target_user_id;
end;
$$;

-- `create or replace` conserva los grants, pero se repiten para que esta
-- migración se lea sola.
revoke execute on function public.mark_password_reset(uuid) from public, anon;
grant execute on function public.mark_password_reset(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Blocker 3: cambiar de grupo familiar a quien era responsable de pago.
--
-- Sacar a la responsable de su grupo (family_group_id = null) chocaba con el
-- CHECK members_responsible_has_group, y moverla a otro grupo con responsable
-- chocaba con el índice único: en los dos casos la persona veía un error
-- genérico. Y moverla a un grupo SIN responsable la dejaba como responsable
-- del grupo nuevo sin que nadie lo decidiera. Al cambiar de grupo, deja de ser
-- responsable; el nuevo responsable se elige a propósito
-- (set_family_payment_responsible).
-- -----------------------------------------------------------------------------
create function private.clear_responsible_on_group_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.family_group_id is distinct from old.family_group_id then
    new.is_payment_responsible := false;
  end if;
  return new;
end;
$$;

create trigger members_clear_responsible_on_group_change
  before update of family_group_id on public.members
  for each row execute function private.clear_responsible_on_group_change();

-- -----------------------------------------------------------------------------
-- Minor 7: el `alter default privileges ... in schema private` de la fundación
-- no tuvo efecto (no creó fila en pg_default_acl) y las funciones de private
-- quedaron con EXECUTE para PUBLIC. Lo mitigaba que anon no tiene USAGE del
-- schema, pero la intención era que nadie las ejecute sin grant explícito.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon;

-- Las que usan las policies (se evalúan con los privilegios de quien consulta)
-- o los triggers llamados como authenticated tienen que seguir ejecutables.
grant execute on function
  private.club_today(),
  private.normalize_text(text),
  private.current_app_role(),
  private.has_role(text[]),
  private.is_admin()
to authenticated, service_role;
