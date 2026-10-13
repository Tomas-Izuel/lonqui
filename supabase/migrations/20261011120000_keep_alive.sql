-- =============================================================================
-- Ping para que el proyecto hosted del plan free no se pause.
--
-- Supabase pausa los proyectos free tras una semana con poca "actividad de
-- base": cuenta queries de usuario, no requests a Auth ni a Storage. El
-- workflow .github/workflows/keep-alive.yml la llama varias veces por día con
-- la publishable key, o sea como `anon`.
--
-- `anon` no tiene grant sobre ninguna tabla ni RPC del dominio, así que un ping
-- contra una tabla terminaría en `permission denied`, que no hay garantía de
-- que cuente como actividad. Por eso esta función: SECURITY INVOKER, sin tocar
-- ninguna tabla, devuelve una constante. Que `anon` pueda ejecutarla no expone
-- nada; es la única puerta que tiene.
--
-- En el plan Pro (producción) no hace falta, pero tampoco molesta.
-- =============================================================================

create function public.keep_alive()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated, service_role;
