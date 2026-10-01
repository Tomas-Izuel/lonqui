# Backend: reglas de servidor por formulario (espejo para el cliente)

Fuente de verdad: los schemas Zod de `src/models/**` y `src/controllers/**`, más
las invariantes de la base que traduce cada modelo a `DomainError` con `field`.
El cliente espeja las reglas **con el mismo texto**. Los ids internos y los
`.strict()` quedan sin mensaje a propósito (no dan pistas a quien prueba la API).

Convenciones:
- "Zod" = rechazo antes de tocar la base. "DB" = el modelo traduce el error de
  Postgres a `DomainError` con ese `field` y ese texto.
- Todos los textos de texto libre se `trim()`ean antes de validar.
- Constantes que no pueden importar las vistas (las vistas no importan modelos):
  copiar el valor.
  - `MIN_BIRTH_DATE` / `BIRTH_DATE_TOO_OLD_MESSAGE`: ya en `@/lib/dates`.
  - Fecha mínima de un pago: `2020-01-01` (trigger `payments_paid_on_guard`).
  - Tamaño máximo de adjunto: 10 MiB (10 * 1024 * 1024). MIME admitidos: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.

## Socio: alta (`createMember`) y modificación (`updateMember`)

| Campo | Regla | Mensaje exacto |
|---|---|---|
| firstName | obligatorio (vacío o espacios) | El nombre es obligatorio |
| firstName | largo > 120 | El nombre no puede tener más de 120 caracteres |
| lastName | obligatorio | El apellido es obligatorio |
| lastName | largo > 120 | El apellido no puede tener más de 120 caracteres |
| dni | no son 7 u 8 dígitos | El DNI tiene que tener 7 u 8 dígitos |
| dni | vacío y `dniPending` apagado | El DNI es obligatorio. Si todavía no lo tenés, marcá "DNI pendiente" |
| dni | cargado y `dniPending` prendido | No podés cargar un DNI y marcarlo pendiente al mismo tiempo |
| dni | duplicado (DB `members_dni_key`, y chequeo previo en alta) | Ya hay un socio con ese DNI |
| birthDate | no es fecha ISO | La fecha de nacimiento no es válida |
| birthDate | futura | La fecha de nacimiento no puede ser futura |
| birthDate | anterior a 1900 (Zod y DB `members_birth_date_sane`) | `BIRTH_DATE_TOO_OLD_MESSAGE` |
| email | formato | El email no es válido |
| email | largo > 254 | El email no puede tener más de 254 caracteres |
| address | largo > 300 | El domicilio no puede tener más de 300 caracteres |
| phone | largo > 40 | El teléfono no puede tener más de 40 caracteres |
| notes | largo > 2000 | Las notas no pueden tener más de 2000 caracteres |
| familyGroupId | no es id válido | Elegí un grupo familiar de la lista |
| familyGroupId | grupo inexistente (DB FK) | Ese grupo familiar no existe |
| familyGroupId | responsable sin grupo (DB `members_responsible_has_group`) | El responsable de pago no puede quedar sin grupo familiar |
| familyGroupId | el grupo ya tiene responsable (DB índice) | Ese grupo familiar ya tiene un responsable de pago |
| (alta) joinedOn | no es fecha ISO | La fecha de alta no es válida |
| (alta) joinedOn | futura | La fecha de alta no puede ser futura |
| (alta) categoryIds | más de 20 | Demasiadas categorías: elegí hasta 20 |
| (alta) categoryIds | elemento no válido | Elegí una categoría de la lista |
| (alta) categoryIds | repetidas | Elegí cada categoría una sola vez |
| (alta) categoryIds | dos de la misma disciplina / dada de baja / inexistente | Elegí una sola categoría por deporte / Una de las categorías elegidas está dada de baja / Una de las categorías elegidas no existe |
| (alta) familyGroupId + newFamilyGroup | los dos | Elegí un grupo familiar existente o cargá uno nuevo, no los dos (field `familyGroupId`) |
| (alta) newFamilyGroup.name | largo > 120 | El nombre del grupo no puede tener más de 120 caracteres |
| (alta) newFamilyGroup.payerContactName | largo > 120 | El nombre del responsable no puede tener más de 120 caracteres |
| (alta) newFamilyGroup.payerContactPhone | largo > 40 | El teléfono del responsable no puede tener más de 40 caracteres |

Nota: `field` de un issue anidado (`newFamilyGroup.name`) llega como el último
segmento de string del path: `name`, `payerContactName`, `payerContactPhone`.
Mapearlos al input del grupo nuevo, no al `name` del socio.

## Baja / reactivación (`statusEventSchema`)

| Campo | Regla | Mensaje exacto |
|---|---|---|
| effectiveOn | no es fecha | La fecha no es válida |
| effectiveOn | futura (DB) | La fecha no puede ser futura |
| effectiveOn | anterior al alta (DB) | La fecha no puede ser anterior a la fecha de alta |
| reason | menos de 3 caracteres | El motivo tiene que tener al menos 3 caracteres |
| reason | más de 500 | El motivo no puede tener más de 500 caracteres |
| notes | más de 2000 | Las notas no pueden tener más de 2000 caracteres |
| (sin campo) | ya de baja / ya activo | El socio ya está dado de baja / El socio ya está activo |

## Deportes del socio

`setMemberCategories` (editar en bloque), `leaveCategory`, `changeCategory`.

| Form | Campo | Regla | Mensaje exacto |
|---|---|---|---|
| set | categoryIds | más de 20 / repetidas / elemento inválido | Demasiadas categorías: elegí hasta 20 / Elegí cada categoría una sola vez / Elegí una categoría de la lista |
| set | categoryIds | misma disciplina / de baja / inexistente (DB) | Elegí una sola categoría por deporte / Una de las categorías elegidas está dada de baja / Una de las categorías elegidas no existe |
| set | categoryIds | ya inscripto en otra categoría de ese deporte (DB) | Ya está inscripto en <deporte>; dalo de baja de esa categoría primero o usá el cambio de categoría |
| set / change | effectiveOn | no es fecha | La fecha no es válida |
| set / change | effectiveOn | futura | La fecha no puede ser futura |
| set / change | effectiveOn | anterior al alta (DB) | La fecha no puede ser anterior a la fecha de alta del socio |
| leave | leftOn | no es fecha | La fecha no es válida |
| leave | leftOn | futura | La fecha no puede ser futura |
| leave | leftOn | anterior al ingreso a esa categoría (DB `member_categories_left_after_joined`) | La fecha de salida no puede ser anterior a la de ingreso a la categoría |
| leave | reason | largo > 500 | El motivo no puede tener más de 500 caracteres |
| change | newCategoryId | no elegida | Elegí la categoría nueva |
| change | newCategoryId | otra disciplina | Elegí una categoría del mismo deporte |
| (sin campo) | | inscripción cerrada / inexistente | Esa inscripción no existe o ya está cerrada |

## Apto físico

`prepareMedicalClearanceUpload` (adjunto), `confirmMedicalClearance`, `createMedicalClearanceWithoutFile`, `updateMedicalClearance`.

| Campo | Regla | Mensaje exacto |
|---|---|---|
| mimeType | no admitido | Subí un archivo PDF, JPG, PNG o WEBP |
| sizeBytes | vacío (0) | El archivo está vacío |
| sizeBytes | > 10 MiB | El archivo no puede pesar más de 10 MB |
| expiresOn | no es fecha | La fecha no es válida |
| originalFilename | largo > 255 | El nombre del archivo no puede tener más de 255 caracteres |
| notes | largo > 2000 | Las notas no pueden tener más de 2000 caracteres |
| (sin campo) | archivo subido no está / no es de este socio | No encontramos el archivo subido. Probá de nuevo. / El archivo no corresponde a este socio |

## Grupo familiar (`familyGroupInputSchema`, `setPaymentResponsible`)

| Campo | Regla | Mensaje exacto |
|---|---|---|
| name | largo > 120 | El nombre del grupo no puede tener más de 120 caracteres |
| payerContactName | largo > 120 | El nombre del responsable no puede tener más de 120 caracteres |
| payerContactPhone | largo > 40 | El teléfono del responsable no puede tener más de 40 caracteres |
| notes | largo > 2000 | Las notas no pueden tener más de 2000 caracteres |
| memberId (responsable) | no elegido | Elegí un integrante del grupo |
| memberId (responsable) | no pertenece al grupo (DB) | El socio no pertenece a ese grupo familiar |

## Registrar pago (`registerPaymentSchema`)

| Campo | Regla | Mensaje exacto |
|---|---|---|
| paidOn | no es fecha | La fecha no es válida |
| paidOn | futura (Zod y DB trigger) | La fecha del pago no puede ser futura |
| paidOn | anterior a 2020-01-01 (Zod y DB trigger) | La fecha del pago no puede ser anterior a 2020. Revisá el año |
| method | no elegido | Elegí el medio de pago: efectivo o transferencia |
| items | vacío | Cargá al menos un pago |
| items[].memberId | no elegido | Elegí el socio |
| items[].amountCents | no es número | Ingresá el monto |
| items[].amountCents | no entero | El monto no es válido |
| items[].amountCents | <= 0 | El monto tiene que ser mayor a cero |
| notes | largo > 500 | Las notas no pueden tener más de 500 caracteres |
| receiptPath | prefijo incorrecto | El comprobante no corresponde a un pago |
| (field `familyGroupId`) | grupo inexistente | El grupo familiar no existe |
| (sin campo) | integrantes fuera del grupo | Todos los pagos tienen que ser de integrantes del grupo familiar |
| receiptPath | objeto no está en Storage | No encontramos el comprobante subido. Probá de nuevo. |

Aviso de path: el `field` de un issue en `items[n].amountCents` es `amountCents`
(último segmento string); no distingue la fila. El cliente decide a qué fila
mostrarlo (la que tenga el monto inválido, validándolo localmente primero).

Comprobante adjunto (`prepareReceiptUpload`): mismas reglas que el adjunto del
apto (MIME, `El archivo está vacío`, `El archivo no puede pesar más de 10 MB`).
`attachReceipt`: filename largo > 255 -> El nombre del archivo no puede tener más de 255 caracteres.

## Anular pago / anular cargo

| Form | Campo | Regla | Mensaje exacto |
|---|---|---|---|
| void payment / void fee | reason | menos de 3 | El motivo tiene que tener al menos 3 caracteres |
| void payment / void fee | reason | más de 500 | El motivo no puede tener más de 500 caracteres |
| (sin campo) | | ya anulado | Este pago ya está anulado / Este cargo ya está anulado |

## Saldo anterior (`createOpeningBalanceSchema`)

| Campo | Regla | Mensaje exacto |
|---|---|---|
| amountCents | no es número | Ingresá el monto del saldo anterior |
| amountCents | no entero | El monto no es válido |
| amountCents | <= 0 (Zod y DB) | El saldo anterior tiene que ser mayor a cero |
| description | largo > 500 | La descripción no puede tener más de 500 caracteres |
| (sin campo) | facturación inactiva | Primero activá las cuotas en Ajustes |
| (sin campo) | ya tiene saldo vigente | Ya tiene un saldo anterior vigente. Anulalo antes de cargar uno nuevo. |

## Valor de cuota (`createFeePriceSchema`)

| Campo | Regla | Mensaje exacto |
|---|---|---|
| scope | no elegido | Elegí a quién aplica el valor |
| memberType | alcance "tipo de socio" sin tipo | Elegí un tipo de socio |
| memberType | alcance "categoría" con tipo | Un valor por categoría no lleva tipo de socio |
| categoryId | alcance "categoría" sin categoría | Elegí una categoría |
| categoryId | alcance "tipo" con categoría | Un valor por tipo de socio no lleva categoría |
| categoryId | categoría inexistente (DB FK) | Esa categoría no existe |
| (default) | con categoría o tipo | Un valor por defecto no lleva categoría ni tipo de socio (field `categoryId` o `memberType`) |
| amountCents | no es número | Ingresá el monto |
| amountCents | no entero | El monto tiene que ser un número entero de centavos |
| amountCents | negativo | El monto no puede ser negativo |
| validFrom | no es fecha | Elegí el mes desde el que aplica |
| validFrom | no es día 1 | Tiene que ser el primer día de un mes |
| validFrom | mes pasado (Zod y DB trigger) | Un valor de cuota nuevo aplica desde este mes o uno futuro |
| validFrom | duplicado exacto (DB) | Ya hay un valor para ese alcance desde ese mes |
| validFrom | mes que ya generó cuotas con otro valor (DB) | texto del trigger: "Las cuotas de <mes> ya se generaron con otro valor; el nuevo aplica desde <mes>" |
| notes | largo > 500 | Las notas no pueden tener más de 500 caracteres |

## Activar cuotas (`activateBilling`)

| Campo | Regla | Mensaje exacto |
|---|---|---|
| startPeriod | no es fecha | Elegí el mes de inicio |
| startPeriod | no es día 1 | Tiene que ser el primer día de un mes |
| startPeriod | mes pasado (Zod y DB) | El mes de inicio tiene que ser este mes o uno futuro; la deuda anterior se carga como saldo de arranque |
| startPeriod | ya activada / con cuotas / sin valor por defecto (DB) | texto del trigger, `field: startPeriod` |

## Ajustes: disciplinas, categorías, club

| Form | Campo | Regla | Mensaje exacto |
|---|---|---|---|
| disciplina / categoría | name | vacío o < 2 | El nombre tiene que tener al menos 2 caracteres |
| disciplina / categoría | name | > 120 | El nombre no puede tener más de 120 caracteres |
| disciplina | name | duplicado (DB, sin distinguir mayúsculas) | Ya existe una disciplina con ese nombre |
| categoría | name | duplicado en la disciplina (DB) | Ya existe una categoría con ese nombre |
| categoría (alta) | disciplineId | no elegida | Elegí una disciplina |
| categoría (alta) | disciplineId | inexistente (DB FK) | Esa disciplina no existe |
| club | clubName | < 2 | El nombre del club tiene que tener al menos 2 caracteres |
| club | clubName | > 120 | El nombre del club no puede tener más de 120 caracteres |

## Usuarios

| Form | Campo | Regla | Mensaje exacto |
|---|---|---|---|
| alta / completar | email | formato o vacío | Ingresá un email válido |
| alta / completar | email | > 254 | El email no puede tener más de 254 caracteres |
| alta / completar | email | duplicado (app_users o Auth) | Ya hay un usuario con ese email / Ya existe un usuario de Auth con ese email. Revisá la lista: puede figurar como alta incompleta. |
| alta / completar | displayName | < 2 | El nombre tiene que tener al menos 2 caracteres |
| alta / completar | displayName | > 120 | El nombre no puede tener más de 120 caracteres |
| alta / completar / cambiar rol | role | no elegido o no válido | Elegí un rol |
| (sin campo) | | cambiarse el propio rol / desactivarse / último admin | No podés cambiar tu propio rol ni desactivar tu propio usuario / Tiene que quedar al menos un administrador activo |
| restablecer | | sobre uno mismo | Para tu propia contraseña usá "Cambiar contraseña" en tu menú de usuario |

## Login y cambio de contraseña

| Form | Campo | Regla | Mensaje exacto |
|---|---|---|---|
| login | email | formato o vacío | Ingresá un email válido |
| login | password | vacío | Ingresá tu contraseña |
| login | (sin campo) | credenciales / usuario desactivado | Email o contraseña incorrectos / Tu usuario está desactivado. Hablá con un administrador del club. |
| cambiar contraseña | currentPassword | vacío | Ingresá tu contraseña actual |
| cambiar contraseña | currentPassword | incorrecta | Tu contraseña actual no es correcta |
| cambiar contraseña | newPassword | < 10 | La contraseña tiene que tener al menos 10 caracteres |
| cambiar contraseña | newPassword | > 72 | La contraseña no puede tener más de 72 caracteres |
| cambiar contraseña | newPassword | sin letra / sin número | La contraseña tiene que tener al menos una letra / La contraseña tiene que tener al menos un número |
| cambiar contraseña | newPassword | igual a la actual | La contraseña nueva tiene que ser distinta a la actual |
| cambiar contraseña | newPassword | igual a la temporal (Auth / DB) | Elegí una contraseña distinta a la temporal |
| cambiar contraseña | newPassword | Auth la rechaza por débil | Esa contraseña es demasiado fácil de adivinar. Elegí otra |
| cambiar contraseña | confirmPassword | vacío | Repetí la contraseña nueva |
| cambiar contraseña | confirmPassword | distinta | Las contraseñas no coinciden |

## Red de seguridad común

`DomainError` sin `field` -> mostrar en un mensaje del formulario (no hay input
culpable). Cualquier otro error llega genérico. Un `field` que el formulario no
tenga como input debe caer igual en un mensaje visible.

## Cambios de implementación (resumen final)

- `src/models/pg-errors.ts` (nuevo): `isRawPostgresMessage`. Un `check_violation` con texto crudo de Postgres ("violates check constraint ...") ya no se muestra al usuario: se traduce por nombre de constraint o queda como falla interna (genérica). Los mensajes de nuestros triggers siguen pasando tal cual.
- Constraints declarativas que ahora se traducen (por nombre autogenerado): `members_first_name_check`, `members_last_name_check`, `members_dni_check`, `members_email_check`, `members_family_group_id_fkey`, `member_status_events_reason_check`, `member_categories_left_after_joined`, `fee_prices_amount_cents_check`, `fee_prices_valid_from_check`, `fee_prices_scope_shape`, `fees_amount_cents_check`, `fees_void_triad`, `payments_amount_cents_check`, `payments_void_triad`, `settings_billing_start_period_check`, `app_users_display_name_check`, `app_users_role_check`, `app_users_email_check`, `*_name_check` de catálogos, FK de disciplina y de socio.
- Triggers cuyo mensaje se tradujo a `DomainError` con `field`: `payments_paid_on_guard` (`paidOn`), anulación sin motivo (`reason`), "Ya está inscripto en ..." (`categoryIds`).
- Reglas nuevas en Zod que antes solo estaban en la base: pago no anterior a 2020-01-01, valor de cuota con `validFrom` en un mes pasado, mes de inicio de facturación pasado. **Dependen del reloj** (`toClubDate`/`toPeriod`), igual que las de "fecha futura".
- Nuevo: `weak_password` de Auth en el cambio de contraseña -> `newPassword`.
- `log.ts`: `message` solo si `code` empieza con `23`, `42` o `PGRST`; siempre `code` y `hint`.
- Nuevo tope de largo (sin CHECK en la base, solo hardening/UX): nombre de catálogo 120, club 120, nombre de usuario 120, email 254.

## Qué necesita base real (tests/db)

- Cada traducción por nombre de constraint de arriba: provocar la violación con el cliente de sesión (PostgREST) y verificar `DomainError.field`. Los nombres de constraint autogenerados (`*_check`, `*_fkey`) hay que confirmarlos contra el schema real.
- `payments_paid_on_guard` con fecha < 2020-01-01.

## Fix review: `markPasswordReset` ya no devuelve `error.message` crudo (app-users.model.ts)

- Antes: `if (error) throw new DomainError(error.message)` para cualquier error de la RPC.
- Ahora: es `DomainError` solo si el código es `42501`/`P0002`, el mensaje no es crudo de Postgres (`isRawPostgresMessage`) y está en la lista cerrada de los tres mensajes que levanta `public.mark_password_reset` (migración `20260927120000_review_fixes.sql`): sin permiso, usuario inexistente, usuario sin contraseña en Auth. Todo lo demás se relanza (`throw error`) para que el controller lo loguee y devuelva el mensaje genérico.
- Si la función suma un mensaje nuevo, hay que agregarlo a `PASSWORD_RESET_USER_MESSAGES`.
- Necesita base real para probarse: llamar la RPC como `editor` (42501 con mensaje propio), con UUID inexistente (P0002) y revocando el execute (permission denied crudo debe salir como error interno).
