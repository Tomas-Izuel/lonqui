-- =============================================================================
-- 0004 — Storage: bucket privado de adjuntos (S4).
--
-- Certificados de apto físico de menores y (slice 2) comprobantes de
-- transferencia. Ley 25.326: el bucket es privado y se sirve solo con URLs
-- firmadas de vida corta. Nunca se guarda una URL en la base, solo la ruta.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  10485760, -- 10 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Subir: admin y editor, solo bajo los prefijos conocidos.
create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] in ('medical-clearances', 'payment-receipts')
    and (select private.has_role('admin', 'editor'))
  );

-- Leer (y por lo tanto firmar URLs): cualquier rol activo.
create policy attachments_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (select private.current_app_role()) is not null
  );

-- Sin policies de UPDATE ni DELETE: un adjunto no se reemplaza ni se borra
-- desde la app. Un certificado nuevo es un objeto nuevo y una fila nueva.
