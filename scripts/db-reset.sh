#!/usr/bin/env bash
#
# Reset completo de la base LOCAL: migraciones + seed + tipos.
#
# `supabase db reset` recrea la base entera, incluido el schema `auth`: se lleva
# puestos todos los usuarios. Cuando exista el bootstrap de usuarios de
# desarrollo (primer pipeline de la Fase 1), se llama al final de este script.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker no está corriendo. Abrí Docker Desktop y volvé a intentar."
  exit 1
fi

if ! npx supabase status >/dev/null 2>&1; then
  echo "→ El stack local no está levantado. Arrancándolo..."
  npx supabase start
fi

echo "→ Recreando la base (migraciones + seed)..."
npx supabase db reset

echo "→ Regenerando tipos de TypeScript desde el schema..."
npx supabase gen types typescript --local --schema public > src/lib/supabase/database.types.ts

# `db reset` NO relee supabase/config.toml: eso se lee al arrancar los
# contenedores.
echo
echo "Nota: si cambiaste supabase/config.toml, hace falta"
echo "      npm run db:stop && npm run db:start  (un reset no lo relee)"
