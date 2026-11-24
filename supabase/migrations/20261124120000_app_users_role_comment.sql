-- =============================================================================
-- App de socios, S1 — el socio NO es un rol de app_users.
--
-- La migración de fundación decía "La Fase 2 agrega 'socio' con un ALTER del
-- CHECK". Hacerlo hoy abriría el padrón: ocho policies (siete tablas y el
-- bucket attachments) abren con `private.current_app_role() is not null`, y
-- cualquier fila en app_users pasa ese filtro. Las cuentas de la app de socios
-- viven en su propio modelo (portal_accounts, pipeline 2026-11-24-app-socios)
-- y leen solo por RPC portal_*. Lo prueba tests/db/portal-lockdown.test.ts.
--
-- Sin cambio de schema: solo documentación en el catálogo.
-- =============================================================================

comment on column public.app_users.role is
  'Rol interno del panel: admin, editor o consulta. NUNCA agregar ''socio'': '
  'current_app_role() is not null abre el panel entero a cualquier fila de esta tabla. '
  'Las cuentas de socios viven en portal_accounts (pipeline 2026-11-24-app-socios).';
