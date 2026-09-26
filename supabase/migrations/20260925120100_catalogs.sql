-- =============================================================================
-- 0002 — Disciplinas y categorías (S2).
--
-- Son datos, no enums: el club las administra desde /ajustes. "Dar de baja"
-- una categoría es is_active = false; nada se borra.
-- =============================================================================

create table public.disciplines (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) >= 2),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index disciplines_name_key on public.disciplines (lower(btrim(name)));

create table public.categories (
  id bigint generated always as identity primary key,
  discipline_id bigint not null references public.disciplines (id) on delete restrict,
  name text not null check (length(btrim(name)) >= 2),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index categories_discipline_id_idx on public.categories (discipline_id);
create unique index categories_name_key on public.categories (discipline_id, lower(btrim(name)));

create trigger disciplines_set_updated_at
  before update on public.disciplines
  for each row execute function private.set_updated_at();
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function private.set_updated_at();

create trigger disciplines_immutable
  before update on public.disciplines
  for each row execute function private.protect_immutable_columns('id', 'created_at');
create trigger categories_immutable
  before update on public.categories
  for each row execute function private.protect_immutable_columns('id', 'created_at');

alter table public.disciplines enable row level security;
alter table public.disciplines force row level security;
alter table public.categories enable row level security;
alter table public.categories force row level security;

create policy disciplines_select on public.disciplines
  for select to authenticated
  using ((select private.current_app_role()) is not null);
create policy disciplines_insert on public.disciplines
  for insert to authenticated
  with check ((select private.is_admin()));
create policy disciplines_update on public.disciplines
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy categories_select on public.categories
  for select to authenticated
  using ((select private.current_app_role()) is not null);
create policy categories_insert on public.categories
  for insert to authenticated
  with check ((select private.is_admin()));
create policy categories_update on public.categories
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.disciplines, public.categories from anon, authenticated, service_role;
grant select on public.disciplines, public.categories to authenticated, service_role;
grant insert (name, is_active, sort_order) on public.disciplines to authenticated;
grant update (name, is_active, sort_order) on public.disciplines to authenticated;
grant insert (discipline_id, name, is_active, sort_order) on public.categories to authenticated;
grant update (discipline_id, name, is_active, sort_order) on public.categories to authenticated;

select private.enable_audit('public.disciplines');
select private.enable_audit('public.categories');
