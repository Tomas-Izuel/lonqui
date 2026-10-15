# Corregir la fecha de alta — tareas

Orden: **T0 primero** (migración + reset + tipos, hilo principal). Después
**T1 y T2 en paralelo** (no comparten archivos; el contrato está fijado abajo).
Después **T3** (tests) y `code-reviewer`, en paralelo. Nada se commitea sin
`APPROVED` + `SUITE GREEN`.

Cada agente deja su log en este directorio: `02-development-backend.md`,
`02-development-frontend.md`, `03-tests.md`, `03-review.md`.

**Prohibido para todos los agentes**: `supabase/**`, `npm install`, resetear
la base, `src/views/settings/**` y `src/models/fee-prices.model.ts`
(pipeline paralelo `2026-10-15-cambiar-valor-cuota`).

## Contrato fijado (lo que T1 y T2 asumen el uno del otro)

- `updateMember(id: number, input: unknown): Promise<ActionResult<void>>`
  (firma sin cambios) ahora **acepta `joinedOn?: ISODate`** en `input`. Si
  viene, el servidor corrige la fecha **antes** de guardar el resto. Si la
  base la rechaza, la action devuelve `{ ok: false, error, field: 'joinedOn' }`
  y **no guardó nada**. Si es igual a la guardada, no pasa nada.
- `SERVER_FIELD_TO_FORM_FIELD` ya mapea `joinedOn → 'joinedOn'`: la vista no
  necesita un mapeo nuevo.
- `src/models/types.ts`: sin cambios. Si un agente cree que necesita un tipo
  nuevo, lo reporta en su log en vez de agregarlo.

---

## T0 — Migración `member_joined_on_correction` · lane `schema` · **hilo principal**

**Archivos**: `supabase/migrations/20261015120000_member_joined_on_correction.sql`
(SQL completo en `00-architecture.md` §6.3), `src/lib/supabase/database.types.ts`
(regenerado con `npm run db:types`), `CLAUDE.md` (texto de §6.4).

**Pasos**: escribir la migración tal cual §6.3 (bloque OPCIONAL comentado salvo
que Tomás responda P1 con "bloquear") → `npm run db:reset` → `npm run db:types`
→ verificar que `database.types.ts` tiene `correct_member_joined_on` en
`Functions` → aplicar el texto de CLAUDE.md.

**Aceptación** (la prueba T3; acá solo el checklist del hilo):
`npm run db:reset` termina sin error; la suite existente `tests/db/` sigue
verde **antes** de T3 (los textos de error se conservaron a propósito).

---

## T1 — Modelo y action · lane `backend` · `senior-backend-engineer`

**Archivos propios (exclusivos)**: `src/models/members.model.ts`,
`src/controllers/members.actions.ts`.
**No tocar**: `src/views/**`, `src/models/types.ts`, `src/models/fee-prices.model.ts`,
`src/controllers/members.controller.ts`, `src/app/**`, `supabase/**`, `tests/**`.

**Objetivo**: exponer la corrección por la única puerta (la RPC) desde el
modelo, y orquestarla en `updateMember` antes del UPDATE del resto.

**Qué hacer**

1. `updateMemberSchema`: agregar `joinedOn: z.iso.date('La fecha de alta no es
   válida').optional()`; en el `superRefine`, si viene y es `> toClubDate()`,
   issue `'La fecha de alta no puede ser futura'` en `path: ['joinedOn']`
   (misma regla que `createMemberSchema`). Actualizar el comentario de arriba
   del schema (ya no dice "sin `joinedOn`").
2. Nueva `export async function correctMemberJoinedOn(id: number, joinedOn:
   string): Promise<void>`: `createClient()` (sesión, nunca admin) →
   `supabase.rpc('correct_member_joined_on', { target_member_id: id,
   new_joined_on: joinedOn })` → `if (error) throw translateJoinedOnError(error)`.
   Traducción (patrón de `translateSetCategoriesError`):
   - `code === '42501'` → `DomainError('No tenés permiso para modificar socios')`;
   - `code === 'P0002'` o mensaje `'El socio no existe'` → `DomainError('El socio no existe', { status: 404 })`;
   - `code === '23514'` y `!isRawPostgresMessage(message)` → `DomainError(error.message, { field: 'joinedOn' })`;
   - cualquier otro → se relanza (cae en el genérico).
3. `updateMember` (modelo): **no agregar `joined_on` al `.update({})`** —no
   hay grant de columna y fallaría con `permission denied`—. Si `input.joinedOn`
   está en el tipo, se ignora acá explícitamente (comentario del porqué).
4. `updateMember` (action): después del `safeParse`, `if (parsed.data.joinedOn)
   await correctMemberJoinedOn(id, parsed.data.joinedOn)` y recién después
   `updateMemberRow(id, parsed.data)`. Sumar `revalidatePath('/')` a los dos
   revalidate existentes (el panel inicial cuenta altas del mes por la fecha
   de la ficha de ingreso). Guard: dejar `requireRole('admin', 'editor')` como
   está (la regla por permiso vive en la RPC; la migración de guards del
   slice 1 es del pipeline de roles), y decirlo en el comentario.

**Aceptación** (spec para T3)

- `updateMemberSchema.safeParse({ …válido, joinedOn: '2026-10-01' })` pasa;
  con `joinedOn: '2099-01-01'` falla con mensaje "no puede ser futura" y
  `path ['joinedOn']`; con `joinedOn: 'ayer'` falla con "no es válida"; sin
  `joinedOn` sigue pasando (compatibilidad).
- El `.update()` de `updateMember` nunca incluye la clave `joined_on` aunque
  `input.joinedOn` venga cargado.
- La action llama a la RPC **antes** del UPDATE; si la RPC tira
  `DomainError` con `field: 'joinedOn'`, la action devuelve
  `{ ok: false, field: 'joinedOn' }` y **no** llama a `updateMemberRow`.
- Si `joinedOn` no viene, la RPC no se llama.
- `42501` de la RPC → `DomainError` sin texto crudo; `23514` con mensaje de
  la RPC → mismo mensaje y `field: 'joinedOn'`; mensaje crudo de Postgres
  nunca llega al cliente (`isRawPostgresMessage`).

**Skills**: `supabase` (`.claude/skills/supabase/SKILL.md`),
`vercel-react-best-practices` (Server Actions), `context7` para `supabase-js`
`rpc()` y Zod v4 (`z.iso.date`, `error.issues`).

**Dependencias**: T0 (tipos regenerados; sin eso `rpc('correct_member_joined_on')` no tipea).

---

## T2 — Formulario de edición · lane `frontend` · `frontend-react-craftsman`

**Archivos propios (exclusivos)**: `src/views/members/member-form.tsx`,
`src/views/audit/audit-labels.ts`, `.impeccable/surfaces/route-socios-nuevo.md`.
**No tocar**: `src/views/members/member-detail-view.tsx` (no cambia),
`src/views/settings/**`, `src/controllers/**`, `src/models/**`, `src/app/**`,
`supabase/**`, `tests/**`.

**Objetivo**: que la fecha de alta se corrija desde el mismo formulario de
edición, mobile-first, sin modal, con el error de la base debajo del campo.

**Qué hacer**

1. `buildSchema`: en modo `edit` validar `joinedOn` igual que en `create`
   (no vacía → "Elegí una fecha", válida, no futura). Hoy esa rama solo corre
   en `create`.
2. `defaultValues.joinedOn`: `member?.joinedOn ?? toClubDate()` (en edición,
   la guardada).
3. Mostrar el `Panel` "Fecha de alta" **también en edición** (hoy está dentro
   de `mode === 'create'`). Mismo `DateField`, `max={toClubDate()}`. Agregar
   `description` al campo, una sola frase, por ejemplo: *"Solo para corregir
   una fecha cargada mal. Si el socio ya tiene cuotas, pagos, bajas o
   inscripciones anteriores a la fecha nueva, no se puede cambiar."*
4. Nota de consecuencia **solo cuando el mes elegido es anterior al mes
   guardado** (`useWatch` de `joinedOn`, comparar `slice(0, 7)` con
   `member.joinedOn`): un `<p>` muted debajo del campo, estilo de
   `categoryConsequences`: *"Las cuotas de los meses que se agregan se
   generan en la próxima corrida (si la facturación está activa)."* Nada de
   alerta roja: es información, no un error.
5. `onValid` (edición): incluir `joinedOn: values.joinedOn` en el objeto que
   va a `updateMember(member.id, { …shared, familyGroupId, joinedOn })`. Sin
   llamada nueva, sin segunda action. El manejo de `result.field` existente
   ya pone el error en `joinedOn` y le da foco.
6. Subtítulo de edición: dejar "Alta: dd/mm/aaaa · Estado: …" tal cual (es el
   valor guardado; mientras se edita sirve de referencia).
7. `audit-labels.ts`, bloque `members`: agregar `joined_on: 'fecha de alta'`.
8. `.impeccable/surfaces/route-socios-nuevo.md`: en "Estados", reemplazar
   *"En edición, `joined_on` y estado no se editan (se muestran como texto)."*
   por *"En edición, el estado no se edita (se muestra como texto); la fecha de
   alta se puede corregir en su panel y la base la rechaza con mensaje debajo
   del campo si quedara después de una cuota, un pago, una baja o una
   inscripción del socio."* Nada más del brief cambia.

**Aceptación**

- A 390 px el panel "Fecha de alta" se lee y se opera con una mano; el input
  de fecha es nativo; target ≥ 44 px; sin scroll horizontal.
- En edición el campo arranca con la fecha guardada; guardar sin tocarla no
  cambia nada (la RPC no-op) y no muestra ninguna nota.
- Elegir un mes anterior muestra la nota de consecuencia; volver al mes
  original la oculta.
- Fecha futura: error inline antes de enviar.
- Error de la base (p. ej. "Ya hay cuotas generadas desde 09/2026…"): aparece
  **debajo del campo**, con foco, y el resto del formulario queda intacto
  (no se guardó nada).
- Sin modal, sin campo de motivo, sin la palabra "eliminar".
- El hook de `impeccable` no reporta nada pendiente al cerrar.

**Skills**: `impeccable` — leer antes de editar
`.claude/skills/impeccable/reference/craft-floor.md` y
`.claude/skills/impeccable/reference/operate.md`; `web-design-guidelines`
antes de cerrar; `vercel-react-best-practices`; `frontend-design` solo si
hay una decisión de tratamiento (no debería: el panel ya existe).

**Dependencias**: ninguna de archivos. Para probar el envío real, T0 y T1
aplicados; hasta entonces el agente valida el formulario con la action tal
como está (la clave `joinedOn` la rechazará `.strict()` hasta que T1 la
acepte — esperado, no lo "arregle" tocando el schema del modelo).

---

## T3 — Tests · lane `shared` · `test-engineer`

**Archivos propios**: `tests/db/member-joined-on.test.ts` (nuevo),
`tests/models/members.model.writes.test.ts`, `tests/controllers/**` que cubra
`members.actions` (crear si no existe). Puede ajustar fixtures en
`tests/db/helpers.ts`.
**No tocar**: `src/**`, `supabase/**`. Un test que revela un bug es un
hallazgo para el agente dueño, no un fix en `src/`.

**Lo que solo se prueba contra la base** (`tests/db/`, `withRollback`,
`actAs`): todo lo de abajo salvo el bloque "Modelo y action".

**Casos — RPC `correct_member_joined_on`**

1. Editor corrige hacia atrás (de `2026-10-10` a `2026-09-20`) un socio con
   dos inscripciones cargadas con la fecha vieja y una tercera posterior
   (`2026-10-12`): `members.joined_on`, `effective_on` de la fila
   `admission` y las **dos** inscripciones de la fecha vieja quedan en
   `2026-09-20`; la tercera no se toca. `audit_log` tiene filas UPDATE para
   `members` (`changed_fields = {joined_on}`), `member_status_events`
   (`{effective_on}`) y dos de `member_categories` (`{joined_on}`), todas con
   `actor_id` del editor y `actor_source = 'session'`.
2. Admin: lo mismo. `consulta`: `insufficient_privilege` con "No tenés permiso".
3. Misma fecha: no falla, no cambia nada, **cero** filas nuevas en `audit_log`.
4. Socio inexistente: "El socio no existe".
5. Futura (`club_today() + 1`): "no puede ser futura". Anterior a
   `birth_date`: "anterior a la fecha de nacimiento".
6. Hacia adelante pasando una baja (`withdrawal` el `2026-10-05`, nueva
   `2026-10-08`): mensaje con "baja o reactivación del 05/10/2026".
7. Hacia adelante pasando una inscripción posterior (de otra fecha): mensaje
   "está inscripto en Disciplina (Categoría) desde el …".
8. Hacia adelante pasando el `left_on` de una inscripción de la fecha vieja ya
   cerrada: mensaje "estuvo inscripto en … hasta el …". Nunca sale el texto
   crudo de `member_categories_left_after_joined`.
9. Cuotas: con una `monthly` no anulada en `2026-09-01` y fecha nueva
   `2026-10-03` → "Ya hay cuotas generadas desde 09/2026". Con esa cuota
   **anulada** → pasa. Con solo un `opening_balance` de período anterior →
   pasa. Fecha nueva dentro del mismo mes de la cuota (`2026-09-15`) → pasa.
10. Pagos: pago no anulado el `2026-09-25` y fecha nueva `2026-10-01` →
    "Hay un pago registrado el 25/09/2026". Anulado → pasa.
11. Consecuencia del generador (fixture de `tests/db/billing.test.ts`:
    facturación activa desde `2026-08-01`, precio por defecto): socio con alta
    `2026-10-10` y cuota de 10/2026 generada; corregir a `2026-09-20`; correr
    `private.generate_pending_fees('manual', <uuid>)` como `postgres` → aparece
    **una** cuota `2026-09-01` para el socio (con la categoría de la
    inscripción arrastrada si la tenía), la de 10/2026 sigue igual
    (monto, `fee_price_id`), y no hay duplicados. Si Tomás responde P1 con
    "bloquear", este caso se invierte: la RPC rechaza con "ya se generaron".
12. Inmutabilidad fuera de la RPC (como `postgres`, sin GUC): `update members
    set joined_on` → `/no se puede modificar/`; `update member_categories set
    joined_on` → ídem; `update member_status_events set effective_on` →
    `/no se modifican ni se borran/`; `delete from member_status_events` →
    ídem. Como editor/admin: `permission denied` (sin grant) — los tests
    existentes de `members.test.ts` 253–300 y `member-categories.test.ts`
    273–340 deben seguir verdes **sin cambios**.
13. Con el GUC seteado a mano a otro id (`select set_config('lonqui.joined_on_correction',
    '999999', true)`) un UPDATE directo sigue rechazado para el socio real.
14. Un UPDATE a `member_status_events` dentro de la corrección que toque otra
    columna además de `effective_on` no existe como camino de la app; cubrirlo
    solo si es barato (sentencia manual con el GUC seteado al id correcto y
    `set reason = 'x'` → rechazado).
15. `grants-and-lockdown`: ninguna función nueva de `private` es ejecutable
    por `anon`/`public`; `correct_member_joined_on` no es ejecutable por `anon`.

**Casos — modelo y action** (vitest con el cliente de Supabase stubeado,
patrón de `tests/models/members.model.writes.test.ts`)

- Los cinco puntos de "Aceptación" de T1.

**Dependencias**: T0 aplicado y `npm run db:reset` hecho por el hilo
principal; T1 para el bloque de modelo y action.

**Skills**: `supabase-postgres-best-practices`
(`.claude/skills/supabase-postgres-best-practices/SKILL.md`, para los tests
de RLS/triggers), `supabase`.

---

## T4 — Revisión · `code-reviewer` (en paralelo con T3)

Puntos de atención además de lo habitual: que `joined_on` **no** aparezca en
ningún `.update()` ni `.insert()` nuevo fuera del alta; que la RPC se llame
con el cliente de sesión; que ningún log incluya la fecha junto a datos
personales; que `.strict()` siga rechazando `status`/`categoryIds` en
`updateMemberSchema`; que la vista no haya agregado un modal ni un motivo; que
el brief de la superficie quedó actualizado.
