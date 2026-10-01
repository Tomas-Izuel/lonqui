# Revisión 2 — fecha de nacimiento mínima + errores claros en todos los formularios

**Veredicto final (ronda 3): APPROVED** (ver sección "Ronda 3" al final; lo de abajo es la ronda 2, ya resuelta).

_Veredicto de la ronda 2: CHANGES REQUESTED_ (nada grave de seguridad ni de datos; son huecos de paridad cliente/servidor y textos que difieren, contra la vara de 4 puntos de la ampliación. El arreglo es chico).

La revisión 1 (solo `birth_date`) quedó aprobada y sigue en pie; sus hallazgos 1 y 2 están resueltos (`log.ts` filtra `message` por código y el mensaje vive en `lib/dates.ts`).

## Resumen

Diff completo sin commitear: 42 archivos modificados (+908/-237) más los nuevos `src/lib/zod-locale.ts`, `src/models/pg-errors.ts`, `src/views/payments/payment-schema.ts`, `tests/lib/log.test.ts`, la carpeta del pipeline y `public/Logo.png`. Corrí `npm run typecheck` (limpio), `npm run lint` (0 errores, 4 warnings en tests) y `npm test` (734 pasan, 1 skip; los `tests/db` se saltean sin Docker, así que las traducciones por nombre de constraint **no están probadas contra la base real**).

Verificado contra el código y las migraciones, no contra los dev logs:

- Sin migraciones tocadas, sin admin client, sin imports `@supabase/*` en pages/views, `.actions.ts` solo exportan async, las vistas no importan modelos (por eso `payment-schema.ts` y la constante duplicada de 2020).
- Los `<form>` conservan `method`; login y cambio de contraseña mantienen `method="POST"` + `action={formAction}` (`login-form.tsx:77`, `change-password-form.tsx:102`). `reason-dialog.tsx` suma `noValidate method="post"` sin `action`, correcto.
- `z.config(z.locales.es())` existe y funciona (probado con Node). Todo `zodResolver` de `src/views` pasa por `form-fields` (script de verificación: ningún archivo queda afuera), y todo modelo importa `lib/errors`, que importa el locale.

## Respuestas a las preguntas puntuales

**Reglas nuevas del servidor, ¿coinciden con la base?**
- Pago anterior a 2020-01-01: espeja `payments_paid_on_guard` (`20260927130100_payments.sql:58`). La base ya lo rechaza hoy, así que Zod no recorta nada que la base acepte: cargar pagos de antes de 2020 ya era imposible. Si el club necesita historia anterior a 2020, es un cambio de migración (del hilo principal), no de este diff.
- `validFrom` pasado: espeja el trigger de `fee_prices` (`billing.sql:191`). `startPeriod` pasado: espeja `settings_billing_guard` (`billing.sql:505`). Mismo texto, mismo reloj (`toPeriod()` en zona del club). Correcto.
- Topes 120 (nombres de catálogo, club, usuario) y 254 (email): **no existen en la base**, son política en TS (el dev log lo admite como "hardening"). 254 es el máximo RFC y 120 coincide con el que ya tenía socio/grupo; no rechazan nada que el club necesite. Aceptable, pero ver hallazgo 1: se agregaron solo del lado del servidor.

**¿Cae algún mensaje al default de Zod?** Las reglas con mensaje explícito no. El locale `es` es solo red de seguridad y su texto es de traducción automática y poco claro ("Inválido dirección de correo electrónico", "Demasiado pequeño: se esperaba que texto tuviera >=2 caracteres"). Lo que queda sin mensaje propio son ids internos y `.strict()` (a propósito, documentado) y `rowSchema`/`categoryIds: z.array(z.number())` del cliente, que el usuario no puede violar desde la UI. Para lo que el usuario sí puede tipear, el locale alcanza como red; no hay un camino de usuario que hoy lo dispare salvo el hallazgo 1. Es suficiente.

**Traductores y `isRawPostgresMessage`.** Cierran bien: los `23514` con texto crudo ya no llegan al usuario (caen a genérico). Los `includes` de constraint (`_name_check` en `catalogs.model.ts`, `billing_start_period_check`, `members_dni_check`, `fees_amount_cents_check`) no tienen falsos positivos reales: cada traductor solo recibe errores de su propia tabla, y `fee_prices_amount_cents_check` no contiene `fees_amount_cents_check`. Los nombres autogenerados coinciden con las migraciones (`members_*_check`, `app_users_*_check`, `fee_prices_scope_shape`, `fees_void_triad`, `payments_void_triad`, `member_categories_left_after_joined`). Excepción preexistente, ver hallazgo 5.

**`log.ts`.** Correcto: `code` y `hint` siempre, `message` solo en `23*`/`42*`/`PGRST*`, nunca `details`. Cubierto por `tests/lib/log.test.ts`.

## Hallazgos

### 1. Major — Paridad cliente/servidor: reglas de largo solo en el servidor

La vara punto 1 pide que toda regla del servidor tenga su espejo en el cliente. Faltan:

- `src/views/users/create-user-dialog.tsx:27` y `complete-user-dialog.tsx:16`: `displayName` sin `.max(120, ...)` (el servidor, `app-users.model.ts`, lo exige).
- `create-user-dialog.tsx:22-26` y `member-form.tsx:56`: email sin `.max(254, ...)`.
- `src/views/settings/club-settings-form.tsx:15-19`: `clubName` sin `.max(120, ...)`.
- `src/views/settings/category-form-sheet.tsx:16` y `discipline-form-sheet.tsx:18`: `name` sin `.max(120, ...)`.

Escenario: alguien pega un texto de 130 caracteres en "Nombre del club". El cliente lo deja pasar, hace el viaje al servidor y recién ahí aparece el error (sí queda bajo el input porque `field` está mapeado, así que no es un bug de usuario, pero es el patrón exacto que la ampliación quería eliminar, y cada viaje de ida y vuelta se paga en celular).
Arreglo: agregar los `.max` con el mismo texto que el servidor en esos cinco schemas.

### 2. Major — Mismas reglas, textos distintos entre cliente y servidor

La vara pide mismo texto. Hoy difieren (el dev log dice "idénticos", no lo son):

- `payment-schema.ts:30`: cliente "La fecha del pago es demasiado antigua. Revisá el año", servidor `payments.model.ts` (`PAYMENT_DATE_TOO_OLD_MESSAGE`) "La fecha del pago no puede ser anterior a 2020. Revisá el año". La del cliente además no dice cuál es el piso.
- `payment-schema.ts:38`: cliente "La nota puede tener hasta 500 caracteres. Acortala", servidor "Las notas no pueden tener más de 500 caracteres".
- `reason-dialog.tsx:24`: "El motivo es demasiado largo. Resumilo en 500 caracteres o menos" vs "El motivo no puede tener más de 500 caracteres".
- `club-settings-form.tsx:19`: "El nombre del club es demasiado corto" vs "El nombre del club tiene que tener al menos 2 caracteres".
- `change-password-form.tsx` (`Las contraseñas no coinciden. Escribí la misma...`, "Ingresá tu contraseña actual (la temporal...)") difieren del servidor en el sufijo.
- `member-form.tsx` grupo nuevo: cliente "El nombre del contacto..." / "El teléfono del contacto..." vs servidor "El nombre del responsable..." / "El teléfono del responsable...".

Escenario: el mismo error se lee distinto según si lo atajó el cliente o el servidor; para la Comisión es ruido y para los tests de paridad es un falso verde. Un sufijo de ayuda en el cliente es válido, pero entonces tiene que ser el mismo texto base. Arreglo: unificar al texto del servidor (el cliente no importa el modelo, así que se repite el literal; para el piso de 2020 conviene el texto que nombra el año).

### 3. Minor — Apto físico: submit bloqueado sin señal

`medical-clearance-section.tsx:185`: si hay `fileError`, `onValid` hace `return` sin mensaje ni foco. El error del archivo ya está en pantalla, pero el botón "Guardar" parece no hacer nada, sobre todo en 390px donde el error puede quedar fuera de vista. Arreglo: llevar el foco o hacer scroll al error del archivo, o deshabilitar el submit con un texto que lo explique.

### 4. Minor — Selector de categoría: a11y incompleta

`category-selector.tsx:87`: el `fieldset` lleva `aria-describedby` pero no `aria-invalid`, y el `data-invalid` no tiene efecto de estilo conocido. Los radios quedan sin estado inválido para lectores de pantalla. Lo mismo el grupo de "Medio de pago" en `payment-form.tsx`/`group-payment-form.tsx`: el `FieldError` aparece pero los botones no referencian el error con `aria-describedby`. Línea con solo espacios en `category-selector.tsx:97` (formato) y `onClick` multilínea mal indentado en `category-form-sheet.tsx` y `discipline-form-sheet.tsx` (nit de formato).

### 5. Minor (preexistente) — `app-users.model.ts:277`

`markPasswordReset` devuelve `new DomainError(error.message)` para cualquier error de la RPC. El comentario asume que todo mensaje es redactado, pero un `42501` o un error de infraestructura mostraría texto crudo. No es parte de este diff y no bloquea; conviene aplicarle el mismo criterio de `isRawPostgresMessage`/código en una pasada próxima.

### 6. Nit — `fees_void_triad` y `payments_void_triad` traducidos como "El motivo tiene que tener al menos 3 caracteres"

Esas constraints cubren la terna anulación (fecha, autor, motivo) y no solo el largo. Es red de seguridad para PostgREST directo y el texto es plausible, pero puede ser impreciso. Sin acción obligatoria.

### 7. Nit — `public/Logo.png` sin trackear

Aparece en `git status` y no pertenece a este pipeline. Que el hilo principal decida si va en este commit o en otro; no mezclarlo sin querer.

## Para `test-engineer`

- `tests/db/`: una prueba por cada traducción por nombre de constraint (`members_*_check`, `fee_prices_*`, `fees_amount_cents_check`, `*_void_triad`, `settings_billing_start_period_check`, `member_categories_left_after_joined`) pegando por PostgREST con sesión `editor`/`admin` y verificando `DomainError.field`; `payments_paid_on_guard` con fecha < 2020-01-01. Hoy no corren sin Docker.
- Unit: paridad de mensajes cliente/servidor para cada regla compartida (comparar literales exportados), para que el hallazgo 2 no vuelva a aparecer.
- Unit de `isRawPostgresMessage` con los cuatro textos crudos (`violates check/not-null/unique/foreign key`, `null value in column`, `duplicate key value`) y con un mensaje de trigger propio ("La fecha del pago no puede ser futura") como no-match.

## Bloqueantes

1. Hallazgo 1: espejar en el cliente los topes de largo (displayName, email, clubName, nombres de disciplina y categoría).
2. Hallazgo 2: unificar los textos cliente/servidor listados.

## Lo que está bien

- Alcance contenido a la Fase 1; sin migraciones, sin admin client, sin importador, sin datos reales.
- `isRawPostgresMessage` + traducción por constraint cierra la fuga de mensajes crudos de Postgres que motivó el pipeline, y `log.ts` ya no pierde ni filtra datos personales.
- Los errores del servidor con `field` caen bajo su input en todos los formularios (mapa `SERVER_FIELD_TO_FORM_FIELD` en el alta de socio, `receiptPath` bajo el comprobante, `items`/`amountCents` bajo el monto), con `FieldError role="alert"`, `aria-invalid` y `aria-describedby` en los campos de `form-fields`.
- Los cambios de comportamiento son razonables: `noValidate` en `ReasonDialog` (RHF/Zod pasa a ser la única validación y ahora cubre fecha futura), errores inline en lugar de toast en Ajustes (el toast desaparece, el inline persiste), `catch` que evita formularios mudos ante una falla de red.
- Reglas nuevas del servidor alineadas con los triggers existentes y con el reloj de la zona del club.
- Cobertura de tests de log y de esquemas ya presente (734 verdes).


---

## Ronda 3 — verificación de los arreglos

**Veredicto: APPROVED.** Verificado en el diff actual: typecheck limpio, lint 0 errores (5 warnings de tests), `npm test` 792 pasan y 1 skip (49 archivos, con la base local). El `03-tests.md` todavía dice SUITE RED con 3 fallas: está desactualizado respecto de la corrida actual y el test-engineer debe actualizarlo a SUITE GREEN antes del commit.

- Bloqueante 1 (topes de largo): resuelto. `.max` con el texto del servidor en `create-user-dialog.tsx:26,31`, `complete-user-dialog.tsx:20`, `club-settings-form.tsx:19`, `category-form-sheet.tsx:20`, `discipline-form-sheet.tsx:22` y `member-form.tsx:56`.
- Bloqueante 2 (textos): resuelto. Los textos listados en el log de arreglos coinciden con el servidor; los tres drifts que el test-engineer encontró (monto no entero, tipo y tamaño de comprobante) también quedaron alineados, y los tests de paridad en `tests/views/payments` lo fijan.
- Minor 3 (apto bloqueado): resuelto con foco al botón de archivo (`medical-clearance-section.tsx:186-190`, id `FILE_BUTTON_ID` aplicado en la línea 307, que referencia el error por `aria-describedby`).
- Minor 4 (a11y): resuelto en lo posible; `aria-describedby` en fieldset y radios y en los botones de medio de pago. Omitir `aria-invalid` en rol radio/button es correcto (no lo admiten).
- Minor 5 (`markPasswordReset`): resuelto. Solo `42501`/`P0002` con mensaje de la lista cerrada, que coincide literal con los tres `raise exception` de la migración `20260927120000_review_fixes.sql`; el resto se relanza y sale genérico. Mantener la lista sincronizada con la función es el costo, ya anotado en el dev log.

**Preguntas del coordinador**

- Mensaje "Ingresá un email válido" para email vacío: aceptable. Es el mismo texto que da el servidor, un campo vacío en un login o alta se entiende sin más, y mantener un único texto es lo que pidió la vara. No hace falta mejorar el servidor; si más adelante se quiere, hay que cambiar ambos lados a la vez. Lo mismo para los "Elegí..." de fecha vacía, que el dev log deja distintos a propósito porque el servidor no tiene regla equivalente para el vacío: correcto.
- `document.getElementById` para el foco: aceptable. Es un id fijo, único en la página (hay una sola sección de apto físico por ficha), se usa en un handler (no en render) y con `?.`. Lo idiomático sería un `ref`, pero el botón es un `Button` shadcn dentro de un bloque condicional y el costo de plumbing no lo justifica. Nit, sin acción obligatoria; si la sección se llega a montar dos veces en la misma página, pasar a `ref`.

Sin regresiones nuevas encontradas. Los nits abiertos (`public/Logo.png` sin trackear, `fees_void_triad` con texto de motivo, formato de `onClick` multilínea en las hojas de Ajustes) no bloquean. **Bloqueantes: ninguno.**
