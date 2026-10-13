# 03-tests: keep_alive

Agregado en `tests/db/grants-and-lockdown.test.ts` (describe "keep_alive(): la única puerta de anon"):

1. anon ejecuta `public.keep_alive()` y recibe `true`.
2. Guardia: las funciones de `public` ejecutables por anon (sin las de extensiones, `pg_depend` deptype 'e') son exactamente `['keep_alive']`. Revisadas las migraciones: ninguna otra función de public otorga execute a anon (todas hacen `revoke ... from public, anon`).
3. `keep_alive` es SECURITY INVOKER (`prosecdef = false`).

Estado: Docker NO estaba corriendo, así que los tests de `tests/db/` NO se ejecutaron (se saltean). Riesgo: la guardia 2 depende de ACL reales; si el stack tiene default privileges de Supabase que dan execute a anon sobre alguna función no revocada, fallará recién al correr con Docker.
Verificación local: typecheck, lint y `npm test` (db saltados).
