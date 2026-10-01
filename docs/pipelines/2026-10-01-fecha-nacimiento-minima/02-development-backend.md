# 02 - Backend: fecha de nacimiento minima

Archivos: `src/models/members.model.ts`, `src/lib/log.ts`. Usa `MIN_BIRTH_DATE` de `src/lib/dates.ts` (no se redefine).

## Cambios
- `checkMemberCoherence` (alta y modificacion): issue en `['birthDate']` si `birthDate < MIN_BIRTH_DATE`, mensaje "La fecha de nacimiento no puede ser anterior a 1900. Revisá el año". Se mantiene el chequeo de fecha futura.
- `translateMemberError`: `23514` + `members_birth_date_sane` -> `DomainError(mismo mensaje, { field: 'birthDate' })`. `createMember` y `updateMember` ya pasaban por `translateMemberError` (insert/update directo), no hizo falta tocar nada mas.
- `log.ts`: un valor que no es `Error` pero es objeto con `code`/`message` string (PostgrestError) se loguea como `{ code, message, hint }`. `details` excluido a proposito (en unique trae el valor, ej. el DNI: Ley 25.326). Otros valores: fallback `{ value: String(error) }`.

## Criterios de aceptacion
- birthDate 1899-12-31 rechazado por Zod con el mensaje, campo birthDate; 1900-01-01 aceptado.
- Si algo esquiva el Zod, el CHECK de Postgres se traduce al mismo DomainError.
- El log de un PostgrestError nunca incluye `details`.

## Requiere base real
El CHECK `members_birth_date_sane` y su traduccion (23514) se prueban contra Postgres en `tests/db/`.

## Verificacion
typecheck OK, lint 0 errores (4 warnings preexistentes en tests). `npm test`: 5 fallos en tests/db (accounts, billing; dependen de fecha/facturacion), identicos con mis cambios stasheados: preexistentes.
