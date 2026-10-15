# 03-tests — Corregir la fecha de alta (T3)

**SUITE GREEN** — `npm test`: 67 archivos, 1241 tests pasan, 1 skipped (preexistente). Stack local en 127.0.0.1:54322, sin reset.

## Archivos
- `tests/db/member-joined-on.test.ts` (nuevo, 27 tests, BEGIN/ROLLBACK + `actAs` por rol).
- `tests/models/members.model.test.ts`: el test que esperaba que `updateMemberSchema` rechace `joinedOn` pasó a aceptarlo; se agregan formato inválido y fecha futura.
- `tests/models/members.model.writes.test.ts`: `correctMemberJoinedOn` (llama la RPC, traduce 42501, 404, check_violation propio con field `joinedOn`, CHECK crudo NO se muestra).
- `tests/controllers/members.actions.test.ts`: `updateMember` (sin `joinedOn` no llama la RPC; con él la llama ANTES del UPDATE; rechazo de la RPC no guarda nada y devuelve `field: joinedOn`; futura frenada por el schema; revalida `/`, `/socios`, `/socios/:id`; consulta no llega).

## Cobertura DB
- Cascada (editor y admin): members, admission y las inscripciones con la fecha vieja; la de otra fecha intacta; auditoría con `actor_id`, `actor_source='session'` y `changed_fields` correcto en las tres tablas.
- Permisos: consulta 42501 "No tenés permiso"; anon sin EXECUTE (catálogo y llamada); funciones de trigger nuevas sin EXECUTE para anon/public.
- Rechazos con mensaje: socio inexistente, futura (borde mañana/hoy), antes del nacimiento (borde mismo día), posterior a baja y a reactivación, inscripción de otra fecha, cierre de inscripción (sin texto crudo del CHECK; borde cierre = nueva fecha), cuota mensual no anulada en mes anterior.
- No bloquean: cuota anulada, saldo de arranque, misma-mes de la cuota, y (§9) pago no anulado anterior (queda intacto).
- Misma fecha: no-op, cero filas de auditoría. Rechazo tardío no deja cambios a medias.
- Generador: mover el alta al mes anterior hace que `monthly_fee_targets(mes anterior)` incluya al socio con la categoría arrastrada; la cuota ya generada no cambia. Limitación: la base local tiene `billing_start_period = 2026-10-01`, así que `generate_monthly_fees` de un mes anterior devuelve 0 por diseño; se prueba la función de objetivos que usa el generador, no la inserción (la unicidad e idempotencia ya las cubre `billing.test.ts`).
- Inmutabilidad fuera de la RPC: postgres sin llave rechazado en las tres columnas y DELETE; editor/admin 42501; GUC de otro id rechazado; con la llave correcta solo cambia `effective_on` de `admission` (otra columna, otro evento, DELETE, o inscripción con otra columna: rechazado); la llave no sobrevive a la operación. Los tests existentes de `members.test.ts` y `member-categories.test.ts` siguen verdes sin cambios.

## Hallazgos en src/ o migración
Ninguno.
