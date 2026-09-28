# 02 — Correcciones de backend del code review (slice 2)

Agente: `senior-backend-engineer`. Fecha: 2026-09-28. Entrada:
`03-review.md` (veredicto `CHANGES REQUESTED`, un MAJOR + varios MINOR/NIT) y,
en una segunda pasada el mismo día, un bug real encontrado por
`test-engineer` (`03-tests.md`) sobre `createOpeningBalance`. Alcance de esta
pasada: solo `src/models/**` y `src/controllers/**`. No se tocó
`supabase/**`, `tests/**`, `src/views/**`, `src/app/**` ni
`src/models/types.ts` (ya traía lo necesario).

## MAJOR 1 — `requireRole()` en dos actions nuevas de `members.actions.ts`

Archivo: `src/controllers/members.actions.ts`.

- `getMedicalClearanceUrl` (línea ~339, "Ver certificado" del apto físico):
  `await requireRole()` → `await requirePermission('members.read')`.
- `loadMoreMembers` (línea ~370, "Ver más" del padrón): `const session =
  await requireRole()` → `const session = await requirePermission('members.read')`.

Sin otro cambio: `requirePermission` devuelve el mismo `SessionInfo & { role }`
que `requireRole` (lo confirma `session.controller.ts:120-126`, es un wrapper
sobre `requireRole()` + `hasAll`), así que `session.permissions.includes(...)`
en `loadMoreMembers` sigue funcionando igual. El resto del archivo mantiene
`requireRole('admin'|'editor'|...)` sin cambios: es la deuda heredada del
slice 1 (`createMember`/`updateMember`/baja-reactivación/certificados vía
upload) que `01-tasks.md` exime explícitamente; solo las dos actions **nuevas
de este slice** estaban fuera de la regla T12/D20 ("ningún `requireRole` en
código nuevo").

Motivo por el que hoy no era explotable (igual que documenta el review): las
RLS (`can('members.read')`) siguen siendo el gate real. El fix cierra la
inconsistencia para cuando el pipeline de roles configurables cree un rol sin
`members.read`.

## MINOR 2 — comparador de `.sort()` inválido en `payments.actions.ts`

Archivo: `src/controllers/payments.actions.ts:237-240` (`getPaymentFormData`).

Antes: `[...accounts].sort((a) => (a.memberId === sourceMemberId ? -1 : 0))` —
ignora `b`, no es un comparador válido de ECMA-262 (dependía de que el sort de
V8 sea estable para "funcionar por accidente").

Después:
```ts
const ordered =
  sourceMemberId != null
    ? [...accounts].sort((a, b) =>
        a.memberId === sourceMemberId ? -1 : b.memberId === sourceMemberId ? 1 : 0,
      )
    : accounts
```
Comparador total y simétrico: el socio de origen (`sourceMemberId`, el que
abrió el formulario desde `/cobranza/nuevo?grupo=<id>`) siempre queda primero,
sin depender de la implementación del motor.

## MINOR 3 — éxito parcial de `activateBilling` reportado como fallo total

Archivos: `src/models/billing.model.ts`, `src/controllers/billing.actions.ts`.

Problema: `activateBilling` hace dos round-trips (`UPDATE settings` +
`generatePendingFees()`). Si el primero se aplica pero el segundo lanza, la
excepción subía tal cual y la action devolvía `failure()` sin ninguna señal
de que `billing_start_period` ya había quedado activado — un admin podía
reintentar "Activar cuotas" creyendo que no pasó nada y toparse con un
rechazo del trigger que no explica por qué (ya está activo).

Solución (cambio mínimo, sin tocar el contrato de `{ generated: number }` en
el camino feliz):

1. Nueva clase `PartialBillingActivationError extends DomainError` en
   `billing.model.ts`, exportada para que `billing.actions.ts` la distinga de
   cualquier otro `DomainError` (p. ej. los cuatro rechazos de
   `settings_billing_guard` que sí implican que la activación NO se aplicó).
2. `activateBilling` envuelve la llamada a `generatePendingFees()` en un
   `try/catch`: si falla, arma y lanza un `PartialBillingActivationError` con
   un mensaje que dice las dos cosas —
   `"La facturación quedó activada desde ${formatPeriod(startPeriod)}, pero
   la generación de cuotas falló: <motivo>. Reintentá desde Ajustes."` — el
   `<motivo>` es el mensaje del `DomainError` de `generatePendingFees()` si lo
   es, o un genérico si no (nunca se filtra el detalle de un error interno).
3. `billing.actions.ts` (`activateBilling` action): en el `catch`, si
   `err instanceof PartialBillingActivationError`, corre
   `revalidatePath('/', 'layout')` **antes** de devolver `failure(err, ...)`.
   El resultado sigue siendo `ok: false` (la generación sí falló y el admin
   tiene que verlo como algo a resolver), pero el mensaje ya es explícito
   sobre la activación, y la revalidación hace que `/ajustes` dependiente dl
   estado de facturación (`getBillingStatus()`) deje de mostrar "Activar
   cuotas" y pase a ofrecer "Generar cuotas ahora" / "Reintentar" — sin esa
   revalidación el admin seguiría viendo el botón de activar, que ahora
   fallaría contra el trigger con un mensaje distinto y confuso.

No se tocó `generatePendingFees()` (la action standalone de "Generar
cuotas ahora"/"Reintentar" en `billing.actions.ts`) porque ahí no hay una
activación previa en el mismo round-trip que reportar: un fallo ahí ya es
"fallo total" real y `failure()` es correcto tal cual.

## MINOR/NIT — `reports.model.ts` (typecheck roto por `payments_count`)

El hilo principal ya había sumado `payments_count` a la RPC `dashboard_summary`
(verificado en vivo contra la base local: `\df dashboard_summary` muestra la
columna) y `paymentsCount` a `DashboardSummary` en `src/models/types.ts`
(línea 574, ya presente — no se tocó `types.ts`). Faltaba el mapeo en
`src/models/reports.model.ts`:

- `DashboardSummaryRow` (tipo de la fila cruda): se agregó `payments_count:
  number` entre `transfer_cents` y `fees_cents`, en el mismo orden que la
  columna real de la función.
- `mapDashboardSummary`: se agregó `paymentsCount: row.payments_count` en la
  misma posición.

Esto es lo que rompía `npm run typecheck` (la línea ~181 que cita el review).
Con el fix, `tsc --noEmit` corre limpio.

## Bug real (post-review) — `createOpeningBalance` mandaba `period` sin grant de INSERT

Reportado por `test-engineer` (`03-tests.md`) tras la primera pasada de estos
fixes. Archivo: `src/models/fees.model.ts` (`createOpeningBalance`).

**Síntoma**: cualquier `editor`/`admin` real (no mockeado) que carga un saldo
de arranque desde `/cobranza` recibía `42501 permission denied for table
fees` (en rigor, `for column period`, pero Postgres redondea el mensaje a
nivel tabla). Rompía el flujo completo de "Saldo de arranque", que es cómo el
contrato pide cargar la deuda previa al sistema.

**Causa**: el insert mandaba `period: toPeriod()` como "placeholder", bajo el
supuesto de que el trigger `fees_opening_balance_guard` (BEFORE INSERT) lo
pisa de todos modos y que el valor mandado era irrelevante. Es cierto que el
trigger lo pisa — pero el grant de INSERT sobre `fees` (`20260927130000_
billing.sql:569`) es **por columna**: `grant insert (member_id, kind,
amount_cents, description) on public.fees to authenticated`. `period` no está
en esa lista a propósito (la fija el trigger, no la app). Postgres evalúa los
privilegios de columna sobre la lista de columnas del `INSERT` **antes** de
que cualquier trigger corra: no importa que el valor termine descartado, el
solo hecho de nombrar `period` en el `INSERT INTO fees (..., period) VALUES
(...)` ya dispara el `permission denied`, incluso para un `admin` (los grants
son por rol de Postgres — `authenticated` —, no por rol de la app).

**Por qué no se detectó en la pasada anterior**: `npm run typecheck` y
`npm run lint` no lo atrapan (es un error de runtime contra Postgres real, no
de tipos), y los tests unitarios de `tests/models/fees.model.test.ts` mockean
`.insert()` con una función que ignora sus argumentos — no hay forma de que
un mock note un grant faltante. Solo un test contra la base real
(`tests/db/`) lo iba a atrapar, que es justo lo que hizo `test-engineer`.

**Arreglo** (`src/models/fees.model.ts`):

- Se agregó el tipo local `OpeningBalanceInsert = Omit<TablesInsert<'fees'>,
  'period'>` (usando el helper `TablesInsert` que ya expone
  `database.types.ts`).
- El objeto que arma `createOpeningBalance` ya NO incluye `period` en
  absoluto (ni ninguna otra columna fuera de `member_id, kind, amount_cents,
  description`, que son exactamente las que el grant permite).
- El `.insert(payload)` castea `payload as TablesInsert<'fees'>` porque el
  tipo generado por Supabase sí marca `period` como `required` (no sabe de
  triggers ni de grants) — el cast está comentado in situ explicando por qué
  es seguro (el trigger la completa siempre, antes del `not null`).
- Se sacó el import de `toPeriod` de `@/lib/dates` (solo se usaba para el
  placeholder que ya no existe) y se agregó el import de `TablesInsert` desde
  `@/lib/supabase/database.types`.

**Barrido del resto del slice** (pedido explícito: "revisá si algún otro
insert/update tuyo o de otros modelos del slice manda columnas sin grant").
Se comparó cada `.insert()`/`.update()` de los modelos nuevos de este slice
contra su grant correspondiente en las migraciones:

| Modelo | Insert/Update | Grant | Resultado |
|---|---|---|---|
| `fees.model.ts` (`createOpeningBalance`) | `member_id, kind, amount_cents, description` (tras el fix) | `grant insert (member_id, kind, amount_cents, description)` | Coincide exacto |
| `fees.model.ts` (`voidFee`) | `update({ void_reason })` | `grant update (voided_at, voided_by, void_reason)` | Subconjunto, OK |
| `payments.model.ts` (`registerPayment`) | `member_id, amount_cents, paid_on, method, receipt_storage_path, notes, batch_id` | `grant insert (member_id, amount_cents, paid_on, method, receipt_storage_path, receipt_filename, notes, batch_id)` | Subconjunto, OK |
| `payments.model.ts` (`voidPayment`) | `update({ void_reason })` | `grant update (voided_at, voided_by, void_reason, receipt_storage_path, receipt_filename)` | Subconjunto, OK |
| `payments.model.ts` (`attachReceipt`) | `update({ receipt_storage_path, receipt_filename })` | mismo grant de arriba | Subconjunto, OK |
| `fee-prices.model.ts` (`createFeePrice`) | `scope, member_type, category_id, amount_cents, valid_from, notes` | `grant insert (scope, member_type, category_id, amount_cents, valid_from, notes)` | Coincide exacto |
| `member-categories.model.ts` (`closeMembership`) | `update({ left_on, left_reason })` | `grant update (left_on, left_reason)` | Coincide exacto |
| `member-categories.model.ts` (altas/ascensos) | vía `supabase.rpc('set_member_categories', ...)`, no `INSERT` directo | N/A (RPC `SECURITY DEFINER`, no sujeta a grants de columna de `authenticated`) | No aplica |
| `billing.model.ts` (`activateBilling`) | `update({ billing_start_period })` | `grant update (club_name, billing_start_period)` | Coincide exacto |

No se encontró ningún otro caso: `fees.model.ts` era el único desvío. Los
modelos heredados del slice 1 con `.insert()`/`.update()` (`members.model.ts`,
`family-groups.model.ts`, `medical-clearances.model.ts`, `app-users.model.ts`,
`catalogs.model.ts`, `settings.model.ts`) quedaron fuera del barrido (no son
"del slice" de cuotas/pagos) — ya pasaron su propia revisión en el pipeline
del slice 1.

**Verificación**:

- `npm run typecheck`: limpio.
- `npm run lint`: limpio en `src/**` (mismos 4 warnings preexistentes de
  `tests/**`, ajenos).
- `npx vitest run tests/models/fees.model.test.ts`: 11/11 verde (mock de
  `.insert()` ignora argumentos, no lo afecta el cambio de payload).
- `npx vitest run tests/db/billing.test.ts` y `npm test` completo: **1 test
  sigue en rojo**, ver nota abajo — no es una regresión de este fix, es una
  consecuencia esperada de haberlo corregido bien.

### Nota para `test-engineer`: el test de `tests/db/billing.test.ts` queda desalineado con el fix

El test `"fees: saldo de arranque (opening_balance) por el camino REAL de la
app > un editor con payments.register inserta un saldo de arranque mandando
member_id, kind, amount_cents, description y period — la forma EXACTA que
arma src/models/fees.model.ts createOpeningBalance"` (línea ~292) sigue
fallando con `permission denied for table fees` **después** del fix, porque
su SQL crudo reproduce a propósito la forma VIEJA (con bug) del insert:

```sql
insert into public.fees (member_id, kind, amount_cents, description, period)
values ($1, 'opening_balance', 2000000, 'Saldo anterior al sistema', date_trunc('month', private.club_today()))
returning id, period
```

Este test fue, correctamente, el que encontró el bug (reproduce "la forma
EXACTA que arma `createOpeningBalance`" — pero esa forma ya cambió: la
función real ya NO manda `period`. El test necesita actualizarse para reflejar
el insert corregido, quitando `period` de la lista de columnas y de los
`values`:

```sql
insert into public.fees (member_id, kind, amount_cents, description)
values ($1, 'opening_balance', 2000000, 'Saldo anterior al sistema')
returning id, period
```

(`returning id, period` puede quedarse igual: `period` se puede leer aunque no
se pueda escribir — el grant es solo sobre INSERT/UPDATE, no sobre SELECT — y
sirve para verificar que el trigger la completó con el valor esperado).

No se tocó `tests/db/billing.test.ts` (fuera de mi lane). Con esta única
excepción, `npm test` corre 660 tests verdes + 1 skip (el de siempre,
documentado como inalcanzable) sobre 662, y el failure restante es
exactamente este.

## Otros hallazgos del review — por qué no se tocaron en esta pasada

Todos los demás hallazgos MINOR/NIT del informe caen fuera del lane backend o
son solo informativos:

- **MINOR 4, 5, 6** y **NIT 9, 13, 15, 16**: `src/views/**` — lane de
  `frontend-react-craftsman`, no tocado.
- **MINOR 8** y **NIT 14**: `supabase/migrations/**` — las migraciones las
  escribe el hilo principal, nunca un agente de desarrollo.
- **NIT 10** (`listFeePrices` sin paginar): el propio review lo marca
  "inofensivo... no bloquea", sin arreglo pedido. Se deja anotado tal cual
  está en el informe.
- **NIT 11** (naming `registerPayments` en `01-tasks.md` vs. `registerPayment`
  real en el código): es un desvío entre el plan y el código, no algo que se
  corrija en `src/`; el comportamiento ya es el correcto (inserta N filas en
  una sola sentencia). No se tocó `01-tasks.md` (no es mío).
- **NIT 12** (`supabase/seed.sql`, UUID de `voided_by` con comentario
  engañoso): `supabase/**`, no tocado.

## Verificación

- `npm run typecheck` → limpio (`tsc --noEmit`, sin salida de error).
- `npm run lint` → limpio sobre `src/**`; los 4 warnings restantes son de
  `tests/**` (`no-unused-vars` en tests preexistentes), ajenos a este lane —
  no se tocaron.
- Confirmado contra la base local (`docker exec -i supabase_db_lonqui psql -U
  postgres -c "\df dashboard_summary"`) que la función pública ya devuelve
  `payments_count integer` en su firma — no hizo falta ninguna migración
  nueva, coincidiendo con lo que dijo el prompt de la tarea.

## Qué necesita `test-engineer`

Ya lo pide `03-review.md` en su nota final; sumo un punto propio de esta
pasada:

- Un test que ejercite `activateBilling` con `generatePendingFees()` fallando
  justo después de que el `UPDATE settings` se aplicó, y verifique que el
  error es `instanceof PartialBillingActivationError` con un mensaje que
  mencione tanto la activación como el motivo del fallo (complementa el punto
  5 de la nota del review, ahora con la clase concreta a chequear:
  `PartialBillingActivationError`, exportada de `src/models/billing.model.ts`).
- El comparador de `payments.actions.ts:237-240` con un array donde el socio
  de origen esté en distintas posiciones (punto 6 de la nota del review):
  ahora es un comparador total, así que un test de orden estable con
  cualquier posición inicial debería pasar sin depender de la estabilidad del
  motor.
- `requirePermission('members.read')` para `getMedicalClearanceUrl` y
  `loadMoreMembers` (punto 1 de la nota del review): los cuatro casos ya
  conocidos de `requirePermission` (sin sesión, contraseña temporal, rol
  desactivado, permiso faltante).
