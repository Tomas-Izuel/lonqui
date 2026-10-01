# Fecha de nacimiento mínima — tareas

## Origen

Alta de socio en producción (2026-10-01 19:40 UTC, dos intentos) falló con
`23514 members_birth_date_sane` (`birth_date >= 1900-01-01`). Ni el schema Zod
del form ni el del modelo tenían ese piso, la constraint no se traducía a
`DomainError` (el usuario vio el mensaje genérico) y `log.ts` serializó el
`PostgrestError` como `[object Object]`, así que el log de Vercel no decía nada.

Cambio trivial, sin `00-architecture.md`.

## Contrato (hilo principal)

- `MIN_BIRTH_DATE = '1900-01-01'` en `src/lib/dates.ts`. Es la fuente única en TS.

## Slices

| Dueño | Archivos | Qué |
|---|---|---|
| `senior-backend-engineer` | `src/models/members.model.ts`, `src/lib/log.ts` | Piso en `MEMBER_CORE_SHAPE`/`checkMemberCoherence`; traducir `members_birth_date_sane` a `DomainError` con `field: 'birthDate'`; log de errores tipo Postgrest con `code`/`message`/`hint`, **sin `details`** (trae valores, ej. DNI) |
| `frontend-react-craftsman` | `src/views/members/member-form.tsx` | Piso en el schema de cliente con mensaje en el campo; `min={MIN_BIRTH_DATE}` en el `DateField` |
| `test-engineer` | `tests/` | Cubrir lo anterior |

---

## Ampliación (pedido de Tomás, mismo día): todos los formularios

> "que esto pase en todos los formularios, me refiero al error de zod en el
> front y ser claro con el error"

### Contrato (hilo principal)

- `BIRTH_DATE_TOO_OLD_MESSAGE` en `src/lib/dates.ts` (finding 2 del review): fuente única del mensaje.
- `src/lib/zod-locale.ts`: `z.config(z.locales.es())`, importado por efecto desde
  `lib/errors.ts` (servidor) y `views/shared/form-fields.tsx` (cliente). Es red
  de seguridad; **toda regla igual lleva mensaje explícito**.

### Vara para cada formulario

1. Toda regla del servidor (schema Zod del modelo/controller) y toda invariante
   de la base (CHECK, NOT NULL, largo, unicidad conocida) que el usuario pueda
   violar desde ese formulario tiene su espejo en el schema del cliente.
2. Cada regla tiene mensaje explícito, en rioplatense, que diga **qué está mal
   y cómo arreglarlo** ("El monto tiene que ser mayor a $0", no "Inválido").
3. El error aparece **debajo del input que lo causó** (incluye controles
   propios: selectores, combobox, adjuntos), con `aria-invalid`.
4. Un `DomainError` con `field` del servidor termina en `form.setError(field)`
   sobre ese input; sin `field`, en un mensaje visible del formulario.

### Slices

| Dueño | Archivos |
|---|---|
| `senior-backend-engineer` | `src/models/**`, `src/controllers/**`, `src/lib/log.ts` |
| `frontend-react-craftsman` A | `src/views/members/**` |
| `frontend-react-craftsman` B | `src/views/payments/**`, `src/views/settings/**` |
| `frontend-react-craftsman` C | `src/views/auth/**`, `src/views/users/**`, `src/views/shared/reason-dialog.tsx`, `src/views/shared/form-fields.tsx` |
