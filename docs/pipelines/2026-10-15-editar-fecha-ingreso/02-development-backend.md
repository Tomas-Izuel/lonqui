# 02 — Desarrollo backend (T1)

## Archivos
- `src/models/members.model.ts`
- `src/controllers/members.actions.ts`

## Contratos expuestos
- `updateMemberSchema`: ahora acepta `joinedOn?: ISODate` (`z.iso.date('La fecha de alta no es válida')`); `> toClubDate()` => issue 'La fecha de alta no puede ser futura' en `path ['joinedOn']`. Sigue `.strict()` (rechaza `status`, `categoryIds`).
- `correctMemberJoinedOn(id: number, joinedOn: string): Promise<void>` (modelo): `rpc('correct_member_joined_on', { target_member_id, new_joined_on })` con cliente de sesión. Traducción (`translateJoinedOnError`): `42501` => DomainError 'No tenés permiso para modificar socios'; `P0002` o 'El socio no existe' => 404; `23514` no crudo (`isRawPostgresMessage`) => DomainError con el mensaje de la RPC y `field: 'joinedOn'`; el resto se relanza (genérico).
- `updateMember` (modelo): el `.update()` nunca manda `joined_on` (comentado el porqué).
- `updateMember` (action, firma igual): si viene `joinedOn` llama a la RPC ANTES de `updateMemberRow`; si la RPC falla no se guarda nada y vuelve `{ ok:false, field:'joinedOn' }`. Sin `joinedOn` no se llama a la RPC. Revalida `/`, `/socios`, `/socios/[id]`. Guard sin cambios (`requireRole('admin','editor')`); la regla por permiso vive en la RPC.
- `types.ts` sin cambios.

## Decisiones
- Orden RPC-primero: la RPC es lo único que puede rechazar por reglas de negocio; el UPDATE del resto sería el que quedaría a medias si fuera al revés. Contrapartida: si la RPC pasa y el UPDATE falla (ej. DNI duplicado), la fecha ya quedó corregida (dos transacciones). Es aceptable: es una corrección idempotente y el usuario reintenta con el resto.
- Fecha igual a la guardada: la RPC retorna sin tocar nada (el form la manda siempre).
- Un pago anterior a la nueva fecha NO bloquea (§9); no hay mensaje de eso.

## Necesita base real (tests/db)
Permisos por rol (consulta => 42501), cascada a admission/inscripciones iniciales, rechazos de la RPC con sus mensajes, UPDATE directo bloqueado, auditoría con actor.

## Para T3
`tests/models/members.model.test.ts` existente puede asumir que `joinedOn` es rechazado por `.strict()` en `updateMemberSchema`: ahora es válido. Typecheck y lint verdes (solo warnings preexistentes en tests). No corrí la suite.

## Schema: nada pendiente.

## Fix post-review (Minor 3 y nit)
- `src/controllers/members.actions.ts` `updateMember`: si la RPC `correct_member_joined_on` pasó y `updateMemberRow` falla, un `try/finally` revalida `/`, `/socios` y `/socios/[id]` (helper local no exportado `revalidateMemberPaths`) y el error original sigue su camino al `failure(...)`: el usuario ve lo mismo. Si falla la RPC no se revalida (no cambió nada). En éxito se revalida una sola vez.
- Nit (no llamar a la RPC con fecha igual): NO aplicado. Saber la fecha guardada exige una lectura extra y el action no la tiene (la sabe el form/controller de lectura, que toca otro agente). La RPC ya es no-op con fecha igual; se deja así.
- Tests: la revalidación tras fallo parcial es de action (mock de modelo), no necesita base real.
