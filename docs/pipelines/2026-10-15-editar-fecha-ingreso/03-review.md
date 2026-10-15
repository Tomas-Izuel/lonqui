# Revisión — corregir la fecha de alta de un socio

**Veredicto: APPROVED** (sin blockers ni majors; 3 minors y 3 nits, ninguno frena el commit).

Alcance revisado: `supabase/migrations/20261015120100_member_joined_on_correction.sql`, `database.types.ts` (solo la RPC), `members.model.ts`, `members.actions.ts`, `member-form.tsx`, `audit-labels.ts`, `route-socios-nuevo.md` y el bloque de CLAUDE.md. Se contrastó con §9 de `00-architecture.md` (manda sobre §6). El resto del diff (valores de cuota, /caja) no se re-revisó. No se corrió la suite ni el stack: lo de abajo es lectura de código y de las migraciones previas.

## Lo que se verificó y está bien

- **RPC SECURITY DEFINER en public:** `set search_path = ''`, todo calificado (`public.`, `private.`), chequeo `private.can('members.write')` como primera sentencia, `revoke execute ... from public, anon` + `grant ... to authenticated`. `service_role` conserva EXECUTE pero sin `auth.uid()` `can()` da falso. Cumple la regla de CLAUDE.md.
- **GUC no es una puerta:** `set_config` no está expuesto por PostgREST (es `pg_catalog`), `joined_on` sigue sin grant de UPDATE para `authenticated` (la columna ni aparece en los `grant update (...)` de members), el valor es el id del socio (no un booleano global) y se setea con `is_local = true`. Si la RPC falla a medio camino el GUC se revierte con la transacción. Sale con la llave puesta solo durante tres UPDATE propios.
- **Inmutabilidad fuera de la RPC:** `members_joined_on_guard` (con `WHEN old is distinct from new`), `member_categories_update_guard` (exige GUC = `member_id` **y** que `to_jsonb(new) - 'joined_on'` sea igual al viejo) y `member_status_events_update_guard` (solo `admission`, solo `effective_on`, GUC = `member_id`) mantienen los textos de error que los tests existentes buscan (`tests/db/members.test.ts:297`, `member-categories.test.ts:306-338`). `DELETE` sigue prohibido en `member_status_events` (`forbid_change` before delete) y en `member_categories`. No hay ningún `DELETE` ni `grant delete` nuevo.
- **Cascada completa y atómica:** una sola función = una sola transacción: `members`, `admission` e inscripciones con `joined_on = fecha vieja`. Lo inscripto después no se toca y, si quedara antes del alta, se rechaza. El cierre de una inscripción arrastrada que quedaría antes del alta se frena antes de que salte el CHECK `left_after_joined` crudo. El prólogo de `member_categories_update_guard` devuelve antes del cuerpo viejo, así que una inscripción cerrada se puede arrastrar sin chocar con "ya está cerrada", y nada más puede cambiar en la misma sentencia.
- **Rechazos y mensajes:** futura, anterior al nacimiento, posterior a baja/reactivación, inscripción posterior, inscripción cerrada y cuota mensual no anulada. Mensajes en criollo, todos `check_violation` con texto propio, que `translateJoinedOnError` + `isRawPostgresMessage` deja pasar solo si no son crudos; `42501` y `P0002` se traducen aparte; el resto sube como genérico. Un pago anterior no bloquea (§9-P2): consistente en la RPC, el modelo y CLAUDE.md.
- **Auditoría con actor:** la RPC corre con la sesión del usuario (`supabase.rpc` con el cliente de sesión), `auth.uid()` llega a los triggers de auditoría de `members`, `member_status_events` y `member_categories`. No se usa `createAdminClient()`. Nada de auditoría escrita desde TS.
- **Generador de cuotas:** `generate_pending_fees` recorre desde `billing_start_period` hasta el mes actual y `monthly_fee_targets` usa `m.joined_on <= p_end`: mover el alta hacia atrás hace que la próxima corrida genere los meses nuevos (decisión P1), el índice único absorbe lo ya existente, y las cuotas anuladas no cuentan. El monto se congela al generar con el precio de ese período: nada se recalcula.
- **Action:** `requireRole('admin','editor')` + la RPC con permiso en Postgres, Zod `.strict()` con `joinedOn` opcional, el `UPDATE` del modelo nunca manda `joined_on`. Orden RPC-primero: el caso "RPC ok + UPDATE falla" es razonable. La corrección es idempotente (un reintento ve la fecha igual y sale por el no-op), la RPC es la única que puede rechazar por reglas de negocio, y el log lo documenta. Se acepta.
- **UI:** `method="post"` presente, una columna, `DateField` con error `role="alert"` debajo del campo y `aria-describedby`, foco al campo en error, validación igual en alta y edición, `max` = hoy en hora de Argentina, nota informativa sin alarma y sin modal. Sin kicker, sin tarjetas anidadas, `tabular-nums` en la fecha. Reusa `Panel` y `DateField` de `shared/`.

## Hallazgos

### Minor

1. **La nota "Se van a generar las cuotas desde <mes>" puede ser falsa.** `member-form.tsx:258` y `:490`. El generador arranca en `settings.billing_start_period` y no hace nada si la facturación no está activada. Escenario: la facturación empieza en 10/2026, un socio dado de alta el 15/10/2026 se corrige a 03/2025; el formulario dice "Se van a generar las cuotas desde marzo 2025" y la corrida solo genera octubre (o nada si `billing_start_period` es null). Es información que el usuario usa para decidir. Arreglo sugerido: no prometer un mes; decir "Se van a generar las cuotas de los meses que falten a partir de la facturación" o pasarle el mes de inicio de la facturación a la vista y mostrar el `max(mes elegido, billing_start_period)`; si no está activada, no mostrar la nota.
2. **El brief de la superficie quedó desactualizado.** `.impeccable/surfaces/route-socios-nuevo.md:15` dice que la base rechaza si queda después de "una cuota, un pago, una baja o una inscripción", pero §9-P2 sacó el pago. Arreglo: quitar "un pago" (y de paso mencionar que mover a un mes anterior avisa que se van a generar cuotas).
3. **Caso parcial sin revalidación.** `members.actions.ts:96-101`. Si la RPC pasa y `updateMemberRow` falla (DNI duplicado), `revalidatePath` no corre y la fecha ya cambió en la base. La ficha `/socios/[id]` y el listado pueden mostrar la fecha vieja y, en el form, el subtítulo "Alta: ..." y la comparación de `joinedOnEarlierMonth` (contra `member!.joinedOn`) quedan con el valor viejo hasta navegar. Arreglo sugerido: revalidar `/`, `/socios`, `/socios/[id]` también cuando la RPC pasó y el resto falló (por ejemplo un `try/finally` con una bandera, sin mover el return de error).

### Nit

4. `correct_member_joined_on` con `new_joined_on` null no tiene un mensaje propio: pasa los `if` (comparaciones con null), llega al `UPDATE` y falla con un NOT NULL crudo (llega como error genérico, no es un leak). Hoy no se alcanza desde la UI (Zod lo exige), pero por PostgREST directo sí. Arreglo: `if new_joined_on is null then raise ...` al inicio, o declarar la función `strict`.
5. La RPC se llama en cada guardado de la ficha aunque la fecha no haya cambiado (el form la manda siempre): un round-trip extra y un `FOR UPDATE` sobre el socio. No es incorrecto (sale por el no-op antes de tocar nada); si molesta, el form puede mandar `joinedOn` solo si cambió.
6. Ventana de carrera teórica: la RPC bloquea la fila del socio pero el generador no, así que un movimiento hacia adelante concurrente con una corrida de catch-up (mismo mes viejo, snapshot con el `joined_on` anterior) podría dejar una cuota de un mes anterior a la nueva fecha. Muy improbable (el cron corre una vez al día y la Comisión corrige un alta de a una); anotado, no pide cambio. El mensaje de rechazo por cuotas dice "un administrador puede anularlas": un `editor` lo lee sin poder hacerlo, aceptable porque es exactamente a quien hay que derivar.

## Para `test-engineer` (cobertura que falta; no escribí tests)

- RPC por rol: `consulta` y `anon` rechazados (`42501` y revoke), `editor` y `admin` pasan.
- Cascada: `members.joined_on`, `admission.effective_on`, inscripción inicial arrastrada, inscripción posterior intacta, y actor en las tres filas de auditoría.
- Cada rechazo con su mensaje: futura, anterior al nacimiento, baja/reactivación, inscripción posterior, inscripción cerrada con `left_on` anterior, cuota mensual no anulada (y que una anulada o un saldo de arranque **no** bloquea, y que un pago anterior **no** bloquea).
- Fuera de la RPC: `UPDATE members.joined_on` como `authenticated` (permission denied) y como superusuario (guard), `member_categories.joined_on` y `member_status_events.effective_on` ídem, `event_type <> 'admission'` rechazado aunque haya GUC, GUC de otro socio rechazado, GUC no filtra tras el commit/rollback.
- Generador: mover hacia atrás y correr `generate_pending_fees` crea los meses nuevos; correrlo dos veces no duplica; mover hacia adelante con cuota generada se rechaza.
- Modelo: `updateMemberSchema` acepta `joinedOn` válido, rechaza futura/mal formada; `translateJoinedOnError` (42501, P0002, 23514 propio vs crudo).

## Blockers

Ninguno.
