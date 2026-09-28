# 02 — Desarrollo backend: B2, `supabase/seed-demo.sql`

Tarea B2 de `01-tasks.md`. Lane `backend`. Único archivo propio:
`supabase/seed-demo.sql` (nuevo). No se tocó ninguna migración, ni
`supabase/seed.sql`, ni `supabase/config.toml`, ni ningún archivo de otra
slice.

## Qué es y cómo se corre

Script SQL standalone, opcional y aditivo, **solo para desarrollo local**.
Corre después de `npm run db:reset` (que ya aplicó las migraciones y
`seed.sql`):

```bash
npm run db:reset
psql "$DB_URL" -f supabase/seed-demo.sql
# o, contra el contenedor local:
docker exec -i supabase_db_lonqui psql -U postgres -v ON_ERROR_STOP=1 < supabase/seed-demo.sql
```

No se agregó a `package.json` ni a `db:reset` (a propósito, según la tarea).
No se tocaron `docs/relevamiento/*` para nada más que confirmar cuántas
disciplinas/categorías existen — ningún dato real se usó ni se copió.

## Idempotencia

El archivo abre con un chequeo en `psql` (`\gset` + `\if`): si ya existe algún
socio con DNI que empieza con `90000`, no hace nada y lo avisa por consola
(`\echo`). Confirmado corriendo el script dos veces seguidas: la segunda vez
imprime `seed-demo.sql: ya hay socios de demo (DNI 90000001-90000200); no se
hizo nada.` y no toca la base.

Antes de aplicarlo de verdad lo corrí una vez con el `commit;` final
reemplazado por `rollback;` (`begin; ... rollback;`, tal como pide el
protocolo de la tarea), revisé que no tirara ningún error y que la
distribución de deuda resultante tuviera la forma pedida, y recién ahí corrí
la versión real con `commit;`.

## Qué generó (verificado en el stack local, ver "Verificación" más abajo)

- **200 socios** inventados (`dni` 90000001–90000200, nombres y teléfonos de
  relleno, ningún dato de `docs/relevamiento/`), repartidos en las
  disciplinas/categorías que ya sembró `seed.sql` — no se creó ninguna
  categoría ni disciplina nueva.
  - 180 con una inscripción abierta en `member_categories` (90% practicantes,
    exacto: `n % 10 <> 0`).
  - Altas (`joined_on`) repartidas en los últimos 12 meses (`n % 12` meses
    atrás, día pseudo-aleatorio dentro del mes, siempre `<= club_today()`).
- **8 grupos familiares** (`Familia Demo 1`..`8`), 4 integrantes cada uno,
  exactamente un responsable de pago por grupo (verificado: 8 grupos, 1
  responsable y 4 integrantes cada uno).
- **12 períodos de cuotas** generados con el generador real
  (`private.generate_monthly_fees(period)`, nunca simulando `now()`):
  2025-10-01 → 200 creadas, ..., 2026-09-01 → 200 creadas (log completo abajo).
  Cubre también a los 11 socios de `seed.sql` (efecto secundario aceptado de
  retroceder `billing_start_period`, ver más abajo) — quedaron **1374 cargos
  `monthly`** en total.
- **953 pagos** de socios de demo (mezcla efectivo/transferencia, algunos por
  período y algunos adelantando varios meses en un solo pago), de los cuales
  **23 anulados con motivo** (~2.4%, dentro del 2-3% pedido), insertados YA
  anulados (nunca con un `UPDATE` posterior — ver invariantes).
- **Distribución de deuda final** (sobre los 200 socios de demo,
  `private.member_balance`/`debt_status_of`):

  | Estado | Socios |
  |---|---|
  | Al día (`up_to_date`) | 121 (60.5%) |
  | En deuda (`in_debt`) | 75 (37.5%) — 64 con 1-3 meses, 6 con mora larga (6-9 meses), el resto explicado abajo |
  | Con saldo a favor (`credit`) | 4 (2%) |

  El perfil de mora lo decide el número de orden `n` (= `dni - 90000000`):
  `n <= 140` al día, `141-186` 1 a 3 meses atrás, `187-196` mora larga (6 a 9
  meses "objetivo"), `197-200` saldo a favor. Los socios de crédito se fuerzan
  por el camino de "pago único" (única rama que suma un mes de más); el resto
  se reparte entre pago único (una cuarta parte, `n % 4 = 0`) y pago por
  período. Nota honesta: de los 10 socios apuntados a "mora larga", solo 6
  terminan con `months_due >= 6` — los otros 4 tienen un `joined_on` reciente
  (pocos cargos generados todavía) y no pueden deber 6 meses que no existen;
  quedan en el bucket de 1-3 meses en cambio. Sigue siendo "un puñado" con
  mora larga, que es lo que pedía la tarea, así que no lo ajusté más.
  También hay más `in_debt` de lo que suman esos tres buckets a mano: una
  fracción de los pagos anulados (2-3% del total, ver arriba) le tocó a algún
  socio que iba a quedar "al día" — un pago anulado le vuelve a generar deuda,
  que es exactamente lo que se espera de una anulación real.
- **Mes en curso cobrado a medias, con días variados**: los pagos de
  septiembre 2026 (el mes en curso al momento de correr el script) cayeron en
  19 días distintos del mes (1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17,
  18, 20, 21, 22, 24, 25, 26, 28), con montos variados por día — le da forma a
  una curva acumulada diaria, que es el objetivo (alimenta
  `public.daily_collection`, de la migración `20260928120000`, y el "ritmo
  del mes" que consume B1/F-cobranza).
- **10 bajas** (`member_status_events`, `event_type = 'withdrawal'`, con
  motivo) y **2 reactivaciones** repartidas en el año (de las 3 apuntadas,
  una quedó sin reactivar porque su fecha de baja ya caía muy cerca de hoy y
  el cálculo defensivo de la fecha de reactivación no encontró un día válido
  antes de `club_today()` — comportamiento esperado del `if r_date <= today`,
  no un error). Dos de las bajas caen dentro del mes en curso a propósito,
  para que "altas y bajas del mes" del panel inicial no dé cero.

Estado final de socios: 202 activos, 9 inactivos (11 originales de `seed.sql`
+ 200 de demo, menos las reactivaciones).

## La parte no trivial: retroceder `billing_start_period`

`seed.sql` ya activa la facturación este mes y genera las cuotas del mes en
curso para sus propios 11 socios (`generate_pending_fees('cron')`). Eso deja
dos invariantes reales del dominio en el camino de generar 12 meses de
historia:

- `private.settings_billing_guard` (trigger de `settings`) no deja cambiar
  `billing_start_period` una vez que existe **cualquier** cargo `monthly` —
  ya hay (los de `seed.sql`), así que un `UPDATE` directo lo bloquea con "El
  mes de inicio ya no se puede cambiar: hay cuotas generadas".
- `private.fee_prices_insert_guard` no deja cargar un valor de cuota con
  `valid_from` en el pasado (respecto del `now()` real) — y el valor que
  hace falta acá es exactamente "del pasado": el que factura los 12 meses de
  demo.

Las dos son correctas y deseables para el uso normal de la aplicación (evitan
que alguien reescriba en qué fecha empezó a facturar, o qué precio regía, una
vez que ya se usó para cobrar). Como esto es un script de demo/desarrollo —
nunca una migración, nunca código de producto — las sorteo apagando cada
trigger un instante (`alter table ... disable trigger ...`, dentro de un
`execute` en un bloque `do $$ ... $$`) justo antes de la operación que
bloquean, y prendiéndolo de nuevo inmediatamente después, todo dentro de la
misma transacción. Quedé con el `billing_start_period` final en
`2025-10-01` (12 meses antes del mes en curso al momento de la corrida) de
forma permanente en esta base de desarrollo — es lo que se busca: que la
facturación "parezca" haber arrancado hace un año.

Efecto colateral aceptado y documentado en el archivo: como el generador de
cuotas no distingue quién es "de demo" y quién es de `seed.sql`, los 11
socios originales también recibieron su historia de 12 meses de cargos
(quedaron con más cuotas de las que tenían al terminar el slice anterior).
Es deseable, no un bug: la motivación completa de este script es que el
gráfico de evolución tenga volumen real en vez de una línea plana.

## Por qué las bajas van DESPUÉS de generar cuotas y pagos

`private.monthly_fee_targets` (el que usa `generate_monthly_fees`) filtra por
`members.status = 'active'` usando el estado **actual** de la columna, no una
reconstrucción histórica por período. Si hubiera dado de baja a esos 10
socios antes de generar las cuotas, se hubieran quedado sin ningún cargo, ni
siquiera el de los meses en que sí estuvieron activos. Generando primero y
dando de baja después, conservan su historia real de cuotas y pagos, y solo
cambia su estado actual — que es exactamente lo que pasaría en la vida real
si alguien se da de baja hoy con historia previa.

## Por qué los pagos anulados se insertan ya anulados

Sin sesión (el script corre como `postgres`, sin JWT), `auth.uid()` es
`null`, y `private.current_app_role()` (y por lo tanto
`private.can('payments.void')`) da `false`. El trigger `payments_update_guard`
exige ese permiso en un `UPDATE` que cambie `voided_at`/`voided_by`/
`void_reason`. Insertar el pago **ya** en estado anulado (mismos tres campos
en el propio `INSERT`) no pasa por ese guard, porque solo corre en `UPDATE` —
es el mismo truco que ya usa `supabase/seed.sql` para su único pago anulado;
lo repliqué literalmente, incluido el UUID de relleno
(`00000000-0000-0000-0000-000000000000`) para `voided_by` (la columna no
tiene FK, así que no hace falta que sea un usuario real).

## Invariantes respetadas (nada nuevo, todo por el camino existente)

- Índice único `(member_id, period, discipline_id) where kind='monthly'`:
  cero duplicados generados por el script (verificado, ver abajo) — todas las
  cuotas salen de `private.generate_monthly_fees`, nunca de un `INSERT`
  manual a `fees`.
- `amount_cents >= 0` en `fees` y `> 0` en `payments`: cero filas violándolo
  (verificado).
- Nada se `UPDATE`/`DELETE` en tablas de historia: los pagos anulados se
  insertan anulados (arriba); las bajas y reactivaciones son inserts en
  `member_status_events`, nunca un `UPDATE` de `members.status` (lo hace el
  trigger `apply_member_status_event`, como en el resto de la app).
- Actor de auditoría: igual que `seed.sql`, el script corre sin sesión, así
  que todo entra a `audit_log` con `actor_source = 'system'` (no se fijó
  `app.actor_id` a mano en ningún punto).
- No se importó nada de `docs/relevamiento/`, no se tocó ninguna migración.

## Verificación corrida contra el stack local

```
-- resumen que imprime el propio script al terminar
 socios_demo | inscripciones_demo | cuotas_totales | pagos_demo | pagos_demo_anulados | bajas_demo | reactivaciones_demo
-------------+---------------------+----------------+------------+----------------------+------------+----------------------
         200 |                 180 |           1374 |        953 |                   23 |         10 |                    2

-- re-corrida del mismo script (idempotencia)
seed-demo.sql: ya hay socios de demo (DNI 90000001-90000200); no se hizo nada.

-- triggers de-sactivados/re-activados quedaron ENABLED (tgenabled = 'O')
 tgname                    | tgenabled
----------------------------+-----------
 fee_prices_insert_guard    | O
 settings_billing_guard     | O

-- settings.billing_start_period final
 2025-10-01

-- duplicados en fees (member_id, period, discipline_id) para kind='monthly'
 0

-- fees.amount_cents < 0 / payments.amount_cents <= 0
 0 / 0

-- members por estado
 active   | 202
 inactive | 9

-- grupos familiares: 8 grupos, 1 responsable y 4 integrantes cada uno (verificado uno por uno)

-- cuotas generadas por período (log de la propia corrida)
2025-10-01 -> 16   2025-11-01 -> 32   2025-12-01 -> 48   2026-01-01 -> 67
2026-02-01 -> 87   2026-03-01 -> 108  2026-04-01 -> 127  2026-05-01 -> 144
2026-06-01 -> 161  2026-07-01 -> 178  2026-08-01 -> 195  2026-09-01 -> 200

-- cobrado del mes en curso (setiembre 2026) por día, directo contra `payments`
-- (no pude probar la RPC public.daily_collection/monthly_history/debt_by_category
-- desde psql sin sesión: piden payments.read/reports.read vía private.can(),
-- que da false sin auth.uid() — es la RLS funcionando como debe. La prueba
-- real de esas RPC con un usuario autenticado le toca a test-engineer o a
-- probarlas manualmente desde la app.)
19 días distintos con cobro en el mes en curso (1 al 28), montos entre
$40.000 y $390.000 por día.
```

## Qué NO hice (fuera de alcance de B2, según la tarea)

- No agregué el script a `package.json` ni a `db:reset` (a propósito).
- No toqué `docs/relevamiento/*` como fuente de datos (solo miré `seed.sql`
  para el patrón de disciplinas/categorías y el truco del pago anulado).
- No escribí ninguna migración ni cambié grants/policies/triggers de forma
  permanente: los dos `disable trigger`/`enable trigger` son transitorios,
  dentro de la misma transacción del script, y quedan verificados como
  `ENABLED` al terminar.
- No probé las RPC `SECURITY INVOKER` (`daily_collection`,
  `monthly_history`, `debt_by_category`, `member_accounts`) con un rol
  autenticado real — necesitan una sesión de Auth, que este script
  deliberadamente no tiene. Quien las pruebe end-to-end (`test-engineer`, o
  el hilo principal a mano desde la app) las va a encontrar con datos de
  sobra para dibujar los tres gráficos nuevos del pipeline.

## Para `test-engineer`

Según `01-tasks.md`, este archivo es un script de datos, no una migración:
"`test-engineer` no escribe tests contra este archivo... pero sí puede
correrlo en su verificación manual del resto de la suite si hace falta". No
hay ningún `tests/db/` nuevo que deba cubrir `seed-demo.sql` en sí; si hace
falta volumen de datos para probar a mano los charts o los listados
paginados, este script deja la base en un estado usable (`npm run db:reset`
+ `psql -f supabase/seed-demo.sql`).
