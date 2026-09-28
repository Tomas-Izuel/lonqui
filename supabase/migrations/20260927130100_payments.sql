-- =============================================================================
-- 0006 — Pagos (S2).
--
-- Un pago es de UN socio. Un cobro a varios integrantes de un grupo familiar
-- son N pagos con el mismo batch_id, insertados en una sola sentencia. El
-- batch_id lo genera el formulario una vez y es la idempotencia del submit:
-- un doble toque con mala señal no registra dos veces (T2).
--
-- Reversa: drop table public.payments y sus funciones.
-- =============================================================================

create table public.payments (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members (id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null default private.club_today(),
  method text not null check (method in ('cash', 'transfer')),
  -- Ruta en el bucket `attachments`, nunca una URL.
  receipt_storage_path text check (receipt_storage_path is null or receipt_storage_path like 'payment-receipts/%'),
  receipt_filename text,
  notes text,
  batch_id uuid not null,
  -- Nullable solo por el seed (corre sin sesión). Desde la app la policy exige
  -- created_by = auth.uid(): siempre queda quién lo cargó (contrato 2.2).
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,

  constraint payments_void_triad check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null
        and length(btrim(void_reason)) >= 3)
  )
);

create unique index payments_batch_member_key on public.payments (batch_id, member_id);
create index payments_member_paid_on_idx on public.payments (member_id, paid_on desc, id desc);
create index payments_paid_on_idx on public.payments (paid_on);
create index payments_member_not_voided_idx on public.payments (member_id) where voided_at is null;

create trigger payments_immutable
  before update on public.payments
  for each row execute function private.protect_immutable_columns(
    'id', 'member_id', 'amount_cents', 'paid_on', 'method', 'batch_id', 'created_by', 'created_at', 'notes'
  );

create function private.payments_paid_on_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.paid_on > private.club_today() then
    raise exception 'La fecha del pago no puede ser futura' using errcode = 'check_violation';
  end if;
  if new.paid_on < date '2020-01-01' then
    raise exception 'La fecha del pago es demasiado vieja' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payments_paid_on_guard
  before insert on public.payments
  for each row execute function private.payments_paid_on_guard();

-- Dos cosas se actualizan de un pago, y ninguna se deshace:
--   - la anulación: una vez, con motivo, solo con payments.void;
--   - el comprobante: adjuntarlo después, una vez; nunca reemplazarlo ni quitarlo.
create function private.payments_update_guard()
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
      raise exception 'Este pago ya está anulado' using errcode = 'check_violation';
    end if;
    if new.void_reason is null then
      raise exception 'Para anular un pago hace falta un motivo' using errcode = 'check_violation';
    end if;
    if not private.can('payments.void') then
      raise exception 'No tenés permiso para anular pagos' using errcode = 'insufficient_privilege';
    end if;
    new.voided_by := auth.uid();
    new.voided_at := now();
  end if;

  if attaching then
    -- Review B3: un pago anulado (o que se anula en esta misma sentencia)
    -- no lleva comprobante; adjuntarlo después confunde el rastro.
    if old.voided_at is not null or voiding then
      raise exception 'Un pago anulado no lleva comprobante' using errcode = 'check_violation';
    end if;
    if old.receipt_storage_path is not null then
      raise exception 'El comprobante ya está cargado y no se reemplaza' using errcode = 'check_violation';
    end if;
    if new.receipt_storage_path is null then
      raise exception 'Falta el archivo del comprobante' using errcode = 'check_violation';
    end if;
    if not private.can('payments.register') then
      raise exception 'No tenés permiso para adjuntar comprobantes' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger payments_update_guard
  before update on public.payments
  for each row execute function private.payments_update_guard();

alter table public.payments enable row level security;
alter table public.payments force row level security;

create policy payments_select on public.payments
  for select to authenticated
  using ((select private.can('payments.read')));
create policy payments_insert on public.payments
  for insert to authenticated
  with check (
    (select private.can('payments.register'))
    and created_by = (select auth.uid())
  );
create policy payments_update on public.payments
  for update to authenticated
  using ((select private.can('payments.register')) or (select private.can('payments.void')))
  with check ((select private.can('payments.register')) or (select private.can('payments.void')));

revoke all on public.payments from anon, authenticated, service_role;
grant select on public.payments to authenticated, service_role;
grant insert (member_id, amount_cents, paid_on, method, receipt_storage_path, receipt_filename, notes, batch_id)
  on public.payments to authenticated;
grant update (voided_at, voided_by, void_reason, receipt_storage_path, receipt_filename)
  on public.payments to authenticated;

select private.enable_audit('public.payments');
