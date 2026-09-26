#!/usr/bin/env bash
#
# Reset completo de la base LOCAL: migraciones + seed + tipos.
#
# `supabase db reset` recrea la base entera, incluido el schema `auth`: se lleva
# puestos todos los usuarios. Por eso al final corre el bootstrap del admin
# de desarrollo (scripts/bootstrap-admin.mjs, con DEV_ADMIN_* de .env.local).
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

# `db reset` recrea el schema auth: sin esto no queda ningún usuario para entrar.
if [ -f scripts/bootstrap-admin.mjs ]; then
  echo "→ Creando el admin de desarrollo..."
  node --env-file=.env.local scripts/bootstrap-admin.mjs "$@"
fi

# `db reset` NO relee supabase/config.toml: eso se lee al arrancar los
# contenedores.
echo
echo "Nota: si cambiaste supabase/config.toml, hace falta"
echo "      npm run db:stop && npm run db:start  (un reset no lo relee)"
