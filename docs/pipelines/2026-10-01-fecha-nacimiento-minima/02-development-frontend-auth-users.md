# Slice C: auth, users, reason-dialog (frontend)

Archivos tocados: `src/views/auth/{login-form,change-password-form}.tsx`, `src/views/users/{create-user-dialog,complete-user-dialog}.tsx`, `src/views/shared/reason-dialog.tsx`. `form-fields.tsx` NO se editó: ya renderiza el error bajo el input (`FieldError role="alert"`) con `aria-invalid` y `aria-describedby` en Text/Password/Textarea/Select; conserva `import '@/lib/zod-locale'`.

Transversal: todos los `catch` de red/excepción de las actions ahora muestran un mensaje de formulario visible (antes los diálogos tenían `try/finally` sin `catch`: un rechazo quedaba mudo). `DomainError.field` -> `form.setError` + `setFocus`; sin `field` -> mensaje de formulario (`role="alert"`).

## Login (`login-form.tsx`)
| Campo | Regla | Antes | Después |
|---|---|---|---|
| email | vacío | "Ingresá un email válido" | "Ingresá tu email" |
| email | formato (con trim, como el servidor) | "Ingresá un email válido" (sin trim) | "Ingresá un email válido, por ejemplo nombre@dominio.com" |
| password | requerida | "Ingresá tu contraseña" | igual |
| (servidor) | credenciales malas | genérico sin `field` | igual: "Email o contraseña incorrectos", NO revela si el email existe; se muestra arriba del botón |

`method="POST"` + `action={formAction}` intactos.

## Cambio de contraseña (`change-password-form.tsx`)
| Campo | Regla | Antes | Después |
|---|---|---|---|
| currentPassword | requerida | "Ingresá tu contraseña actual" | "...actual (la temporal, si es tu primer ingreso)" |
| newPassword | 10-72 caracteres, letra, número | mensajes de `passwordPolicySchema` (ya explícitos, espejo del servidor) | igual; texto de ayuda previo: "Entre 10 y 72 caracteres, con al menos una letra y un número." (antes omitía el máximo) |
| newPassword | distinta a la actual | "Elegí una contraseña distinta a la actual" | "La contraseña nueva tiene que ser distinta a la actual" (idéntico al servidor) |
| confirmPassword | requerida | "Repetí la contraseña nueva" | "Repetí la contraseña nueva para confirmarla" |
| confirmPassword | coincide | "Las contraseñas no coinciden" | "Las contraseñas no coinciden. Escribí la misma en los dos campos" |
| (servidor) | `currentPassword` incorrecta / `newPassword` igual a la temporal | `field` ya mapeado a `setError` | igual; sin `field` -> mensaje arriba del botón |

`method="POST"` + `action={formAction}` intactos.

## Nuevo usuario (`create-user-dialog.tsx`)
| Campo | Regla | Antes | Después |
|---|---|---|---|
| email | vacío | "Ingresá un email válido" | "Ingresá el email" |
| email | formato, con trim | sin trim | "Ingresá un email válido, por ejemplo nombre@dominio.com" |
| displayName | >= 2 caracteres tras trim (server + CHECK `app_users`) | igual | igual (mismo texto que el servidor) |
| role | uno de admin/editor/consulta | "Elegí un rol" | "Elegí un rol para el usuario" (error bajo el selector) |
| (servidor) | email duplicado (`field: 'email'`) | ya mapeado | igual + catch de red |

## Completar alta (`complete-user-dialog.tsx`)
displayName y role: mismas reglas y mensajes que arriba; el email no se edita (sale de la fila). Agregado `catch` de red.

## ReasonDialog (`shared/reason-dialog.tsx`; lo usan baja/reactivación, anulación de pago, toggles de ajustes)
| Campo | Regla | Antes | Después |
|---|---|---|---|
| effectiveOn | requerida | "Elegí una fecha" | "Elegí la fecha en que ocurrió" |
| effectiveOn | fecha ISO válida | sin regla | "La fecha no es válida. Elegila del calendario" (espejo de `statusEventSchema`) |
| effectiveOn | no futura (la base lo rechaza) | solo atributo `max` | "La fecha no puede ser futura. Elegí hoy o un día anterior" |
| reason | >= 3 caracteres tras trim (server + CHECK) | "Contá el motivo (al menos 3 caracteres)" | "El motivo tiene que tener al menos 3 caracteres" (idéntico al servidor) |
| reason | <= 500 | sin regla | "El motivo es demasiado largo. Resumilo en 500 caracteres o menos" |

Además: `noValidate` en el `<form>` (el atributo `max` del input de fecha disparaba el globo nativo del navegador en lugar del mensaje de Zod), `setFocus` al campo con error del servidor, y `catch` de red.

## A11y esperada
Cada error es un `role="alert"` debajo del input, enlazado por `aria-describedby`, con `aria-invalid`. Sin primitivas nuevas en `shared/`.

## Verificación
`npm run typecheck` y `eslint` sobre `src/views/{auth,users,shared}`: limpios. No se corrió `npm test` (no es mío).

## Nota para otros slices
`ReasonDialog` ahora valida fecha no futura y 500 caracteres: los consumidores (members, payments, settings) no necesitan cambios.
