# 04 — Release: ensayo contra producción y merge

Hilo principal, 2026-10-29. Es el §7.1 de `00-architecture.md` con dos ajustes: en esta máquina no
hay `psql` instalado (se usa el del contenedor de la base local), y se suma el chequeo m7 de
`03-review.md`.

**Antes de mergear: corre el ensayo quien tenga `SUPABASE_DB_PASSWORD`.** Hay que tener Docker
abierto y que nadie más esté corriendo tests de base en esa máquina, porque dos corridas
simultáneas sobre la misma base dan deadlocks espurios.

```bash
D=/private/tmp/claude-501/-Volumes-SSD-Work-lonqui/01bf675d-b836-44c7-b8ee-c33e4e87cb06/scratchpad/prod-dump
# Función, no variable: zsh no parte "$PSQL" en palabras y la foto del paso 4 sale vacía.
PSQL() { docker exec -i supabase_db_lonqui psql -U postgres -X -v ON_ERROR_STOP=1 "$@"; }
mkdir -p "$D" && chmod 700 "$D"

# 1. Dump de datos de producción. Es también EL backup: el plan free no tiene PITR.
#    Tiene datos personales de menores: no sale del scratchpad y se borra cuando termina el release.
#    Con `supabase login` hecho no hace falta la contraseña: el CLI crea un rol de login temporal.
npx supabase db dump --linked --data-only --use-copy \
  -x supabase_migrations.schema_migrations,supabase_migrations.seed_files \
  -f "$D/prod-data.sql"

# 2. Base local con el schema de producción (sin la migración nueva) y sin seed.
npm run db:start
npx supabase db reset --no-seed --version 20261024170000

# 3. Restaurar los datos de producción. Las migraciones ya siembran audit_log, cash_concepts,
#    settings y el bucket: vaciarlos primero o el COPY choca con la PK. El COPY de storage.* falla
#    (la versión local del schema de Storage es otra) y corta antes de los setval del final: se
#    aplican aparte. Los datos de dominio ya entraron para entonces.
PSQL <<'SQL'
begin;
set local session_replication_role = replica;
alter table public.audit_log disable trigger all;
truncate public.audit_log, public.cash_concepts, public.settings cascade;
alter table public.audit_log enable trigger all;
delete from storage.buckets;
commit;
SQL
PSQL < "$D/prod-data.sql"   # termina con error en storage.*: esperado
grep -E '^SELECT pg_catalog.setval' "$D/prod-data.sql" | PSQL -q -At

# 4. Foto independiente, antes de migrar.
PSQL -At -c "select m.id, b.charged_cents, b.paid_cents, b.balance_cents
  from public.members m cross join lateral private.member_balance(m.id) b order by m.id" > "$D/balances-antes.txt"

# 5. Migrar por el mismo camino que el CI. Si la verificación aborta, el error nombra socio/cargo por id.
npx supabase migration up --local

# 6. Comparar y controlar.
PSQL -At -c "select m.id, b.charged_cents, b.paid_cents, b.balance_cents
  from public.members m cross join lateral private.member_balance(m.id) b order by m.id" \
  | diff - "$D/balances-antes.txt" && echo "balances idénticos"
PSQL -c "
  select source, count(*), sum(amount_cents) from public.payment_allocations group by 1;
  select count(*) filter (where voided_at is not null and from_period is not null) as tramos_anulados,
         count(*) filter (where voided_at is null and from_period is null) as filas_por_mes
  from public.fees where kind = 'opening_balance';
  -- Tiene que dar 0: ningún socio con deuda y saldo a favor a la vez.
  select count(*) from (select member_id from public.fee_status group by 1 having sum(pending_cents) > 0
    intersect select member_id from public.payment_credit group by 1 having sum(credit_cents) > 0) x;"

# 7. m7 (03-review): saldos viejos SIN tramo ("solo monto"). Con el modelo nuevo esos socios vuelven
#    a ver meses previos para cargar, y cargarlos duplicaría la deuda. Listar por id y decidir con
#    la Comisión antes de abrir el sistema (anular y recargar por mes, o dejarlos y avisar).
PSQL -c "select f.member_id, f.period, f.amount_cents
  from public.fees f
  where f.kind = 'opening_balance' and f.voided_at is null and f.from_period is null
    and f.description = 'Saldo anterior al sistema'
  order by f.member_id;"

# 8. Suite completa contra la base migrada con datos reales. Mientras la facturación de producción
#    no haya arrancado (billing_start_period posterior al mes actual), 6 tests de billing/accounts
#    fallan porque suponen cuotas del mes generadas, como deja el seed. Activarla en la copia local
#    como hace el seed y volver a correr:
#    PSQL -c "update public.settings set billing_start_period = date_trunc('month', private.club_today())::date where id = 1;
#             select status, fees_created from private.generate_pending_fees('cron');"
npm test

# 9. Al terminar: volver la base local al estado de desarrollo y borrar el dump.
npm run db:reset && rm -rf "$D"
```

## Resultado del ensayo (2026-10-29, hilo principal)

Dump de producción tomado a las 19:07 (ART) con el CLI vinculado a `uvarzfqcjjzgbtswmkrb`, en
`20261024170000` (la versión previa a esta migración, confirmada por MCP). La copia local coincidió
con producción en conteos y sumas: 121 socios, 32 cargos (todos `opening_balance`: 31 con tramo, 4
anulados) por $1.880.000, 12 pagos (7 anulados) por $380.000, 593 filas de auditoría, 6 usuarios.

- `migration up --local`: aplicó en ~1 s; la verificación interna no abortó.
- **Saldos idénticos** en los 121 socios (`member_balance` antes = después).
- Imputaciones: 13 filas `backfill` por $130.000. 31 tramos anulados, 170 filas por mes vivas, 0
  tramos vivos. 0 socios con deuda y saldo a favor a la vez. 13 filas de auditoría de imputaciones.
- Celdas de `payment_month_options` (2.007 → 2.173): **ninguna celda cambió ni desapareció**; se
  sumaron 166 meses `pre_system` en 28 socios, todos anteriores a su saldo cargado y todos con
  `before_joined = true` (la grilla los ofrece con el aviso de fecha de alta: regla m8, ventana de
  12 meses).
- **m7**: un solo socio con saldo "solo monto" (id 14): $10.000 en octubre 2026, alta 2026-10-15,
  ya pagado (pendiente 0). Su grilla ofrece ahora noviembre 2025 a septiembre 2026, todos antes del
  alta y con aviso. El riesgo de duplicar deuda es mínimo; alcanza con no cargarle meses previos.
- Facturación de octubre activada en la copia: 120 cuotas generadas, invariante de deuda/crédito
  en 0. Producción no tiene saldo a favor, así que el camino de crédito no se ejercitó con datos
  reales (lo cubren los tests).
- Suite: 6 fallas esperadas por la facturación no arrancada (ver paso 8); con la facturación
  activada, **83 archivos, 1.681 tests en verde**.
- Dump borrado y base local reseteada al terminar. Para el merge, tomar un dump nuevo como backup.

**Merge**: fuera del horario de carga, avisando a la Comisión que no registre pagos durante 15
minutos. El CI aplica la migración y Vercel despliega en paralelo. El código nuevo llega unos minutos
antes que el schema, y durante esa ventana:
- el formulario de pago muestra "El sistema se está actualizando";
- la ficha y `/caja/pagos` muestran los pagos sin "Cubre…" (fallback ante `PGRST200`).

**Después del release** (SQL Editor del dashboard, solo lectura):
- las consultas del paso 6;
- `select count(*) from public.audit_log where table_name = 'payment_allocations'`;
- abrir la ficha de un socio con saldo convertido y la de uno con saldo a favor;
- registrar un pago de prueba marcando dos meses sueltos y anularlo, con motivo "prueba de release".

**Rollback**: §7.1 de `00-architecture.md`. Si la migración falla, la transacción se revierte
entera y la base queda como estaba.
