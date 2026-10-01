# 02 - Frontend slice A (`src/views/members/**`)

Ampliación "todos los formularios": validación Zod en el cliente con mensaje claro bajo el input.
Validación: `mode: 'onBlur'` + `reValidateMode: 'onChange'` en todos (el form de socio ya lo tenía; se sumó a los 4 restantes). Errores de servidor con `field` van a `form.setError`; sin `field`, al `<p role="alert">` del formulario.

## Alta/edición de socio (`member-form.tsx`)
| Campo | Regla | Mensaje (antes -> después) |
|---|---|---|
| firstName / lastName | max 120 | (nada) -> "El nombre/apellido no puede tener más de 120 caracteres" |
| address | max 300 | (nada) -> "El domicilio no puede tener más de 300 caracteres" |
| phone | max 40 | (nada) -> "El teléfono no puede tener más de 40 caracteres" |
| notes | max 2000 | (nada) -> "Las notas no pueden tener más de 2000 caracteres" |
| newGroupName / PayerContactName | max 120 | (nada) -> "El nombre del grupo / del contacto no puede tener más de 120 caracteres" |
| newGroupPayerContactPhone | max 40 | (nada) -> "El teléfono del contacto no puede tener más de 40 caracteres" |
| birthDate | formato | (nada) -> "La fecha de nacimiento no es válida" |
| birthDate | piso 1900 | literal -> `BIRTH_DATE_TOO_OLD_MESSAGE` (`@/lib/dates`) |
| joinedOn / effectiveOn | formato | (nada) -> "La fecha de alta no es válida" / "La fecha no es válida" |
| email | trim antes de validar | igual mensaje "El email no es válido" |
Sin cambio (ya espejaban el servidor): nombre/apellido obligatorios, DNI (obligatorio / 7-8 dígitos / pendiente excluyente), nacimiento y alta futuras, "Elegí una fecha".
Mapeo servidor -> campo (`SERVER_FIELD_TO_FORM_FIELD`): `familyGroupId`/`newFamilyGroup` -> combobox de grupo, `newFamilyGroup.*` y `name`/`payerContact*` (error de `createFamilyGroup`) -> `newGroup*`, `dniPending` -> `dni`. Antes un error sobre `familyGroupId` (responsable duplicado) caía al mensaje general. Cubre también los errores de `createFamilyGroup` en edición (antes siempre general).
`categoryIds` max 20 / duplicados: inalcanzable desde la UI (un radio por disciplina), no se espeja.

## `category-selector.tsx`
Error con `FieldError` (mismo componente que los campos compartidos), `id` + `aria-describedby` en cada fieldset, `data-invalid`. No se puso `aria-invalid` en los radios (jsx-a11y lo rechaza en `radio`).

## Diálogos de categoría
| Form | Campo | Mensaje antes -> después |
|---|---|---|
| Agregar deporte | disciplineId | "Elegí una disciplina" -> "Elegí el deporte que va a practicar" |
| | categoryId | "Elegí una categoría" -> "Elegí la categoría del deporte" |
| | effectiveOn | "Elegí una fecha" -> "Elegí desde qué fecha empieza"; futura = mensaje del servidor "La fecha no puede ser futura" |
| Cambiar categoría | newCategoryId | -> "Elegí la categoría a la que pasa" |
| | effectiveOn | -> "Elegí desde qué fecha rige el cambio"; futura igual al servidor |
| Dar de baja de categoría | leftOn | -> "Elegí desde qué fecha deja el deporte"; futura igual al servidor |
| | reason | max 500 sin mensaje -> "El motivo no puede tener más de 500 caracteres" |
Server `field` ya llegaba a `setError` (categoryIds -> categoryId); sin cambios.

## Apto físico (`medical-clearance-section.tsx`)
- expiresOn: "Elegí la fecha de vencimiento" -> "Elegí la fecha de vencimiento del certificado" + "La fecha de vencimiento no es válida".
- Archivo: "Formato no admitido. Elegí una foto (JPG, PNG o WEBP) o un PDF." / nuevo "El archivo está vacío. Elegí otro o sacá la foto de nuevo." / "El archivo no puede pesar más de 10 MB. Elegí uno más liviano." (espejo de `prepareUploadSchema`). El error usa `FieldError` con id y los dos botones de archivo llevan `aria-invalid` + `aria-describedby`.
- Un archivo rechazado ya no se descarta en silencio: se limpia `file` y el submit se frena mientras haya `fileError` (antes guardaba solo la fecha con el archivo viejo/sin archivo).
- Server: `field: 'expiresOn'` -> `form.setError` + foco; `mimeType`/`sizeBytes` -> error del archivo; resto -> mensaje general.

## Saldo anterior (`member-account-section.tsx`)
- amountCents vacío: "El saldo anterior tiene que ser mayor a cero" -> "Ingresá el saldo anterior en pesos"; <= 0 conserva el mensaje del servidor.
- description: max 500 -> "La descripción no puede tener más de 500 caracteres".
- Server `amountCents`/`description` -> `form.setError` (antes todo al mensaje general).

## Sin formulario propio / fuera de alcance
`family-group-section` (acciones con botón, errores ya inline), `member-status-actions` (usa `ReasonDialog`, slice C), `member-list` (filtros GET), `family-group-combobox` (ya muestra `fieldState.error` con `aria-invalid`/`describedby`).

## Verificación
`npm run typecheck` y `npm run lint`: sin hallazgos en `src/views/members/**` (los errores restantes son de `src/views/payments` y `settings`, slice B).
Criterios de aceptación: submit con campos inválidos muestra el mensaje bajo el input y enfoca el primero; en blur también; el error de servidor con campo queda bajo su input.
