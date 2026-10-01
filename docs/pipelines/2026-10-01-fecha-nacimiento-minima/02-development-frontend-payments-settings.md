# 02 - Frontend B: pagos y ajustes (validación Zod en el cliente)

Slice B de la "Ampliación". Archivos: `src/views/payments/**`, `src/views/settings/**`.
Nuevo: `src/views/payments/payment-schema.ts` (piezas Zod compartidas por los dos formularios de pago: monto, fecha, medio, notas; espeja `registerPaymentSchema` y el CHECK `amount_cents > 0`).

Dinero siempre en centavos enteros (`AmountField` + `parsePesosToCents`). No se tocó `shared/**`.

## Cambios transversales
- Todo `DomainError` con `field` termina en `form.setError` (o en el control propio); sin `field` reconocible, un `<p role="alert">` dentro del formulario. Antes, en los 4 sheets de ajustes y en `club-settings-form`, el caso sin campo era un `toast.error` (efímero): ahora es mensaje inline del formulario.
- Error de subida/servidor del comprobante (`receiptPath`): antes iba al mensaje general; ahora `ReceiptPicker` recibe `error` y lo muestra debajo del selector (`aria-invalid` + `aria-describedby` en el botón "Elegir archivo").
- Los errores se ven al enviar (`handleSubmit`, `noValidate`) y se revalidan al corregir (modo RHF por defecto).

## payment-form (pago de un socio)
| Campo | Regla | Mensaje | Antes |
|---|---|---|---|
| amountCents | vacío / no numérico | Ingresá el monto en pesos, por ejemplo 10.000 | "Ingresá un monto mayor a cero" (confuso con texto no numérico) |
| amountCents | <= 0 (CHECK `> 0`, servidor) | El monto tiene que ser mayor a cero | "Ingresá un monto mayor a cero" |
| paidOn | vacío | Elegí la fecha en que se cobró | "Elegí una fecha" |
| paidOn | formato | La fecha no es válida. Elegila del calendario | sin regla (llegaba al servidor: "La fecha no es válida") |
| paidOn | futura (servidor) | La fecha del pago no puede ser futura | sin regla en el cliente |
| paidOn | < 2020-01-01 (el `min` del input, que con `noValidate` no avisaba) | La fecha del pago es demasiado antigua. Revisá el año | sin mensaje |
| method | no es efectivo/transferencia | Elegí cómo se pagó: efectivo o transferencia (se muestra debajo de los botones) | mensaje por defecto de Zod, sin lugar donde verse |
| notes | > 500 (servidor `max(500)`) | La nota puede tener hasta 500 caracteres. Acortala | sin regla (error crudo del servidor) |
| receipt (archivo) | formato / > 10 MB | ya existían en `validateReceiptFile` | igual |
| receipt (subida / `receiptPath` servidor) | falla | texto del servidor o "No pudimos subir el comprobante. Probá de nuevo." | mensaje general al pie |
Servidor -> cliente: paidOn/method/notes/amountCents -> `setError` + foco (abre "Notas" si hace falta); `items`/`memberId` -> bajo Monto; `receiptPath` -> bajo el comprobante; resto -> mensaje general.

## group-payment-form (pago de grupo familiar)
| Campo | Regla | Mensaje | Antes |
|---|---|---|---|
| rows (ninguna tildada) | al menos una (servidor: "Cargá al menos un pago") | Tildá al menos un integrante para registrar el pago | "Elegí al menos un integrante" (en `<p>` suelto, ahora `FieldError`) |
| rows[i].amountCents | tildada y vacía / no numérica | Ingresá el monto en pesos, por ejemplo 10.000 (bajo el monto de esa fila) | "Ingresá un monto mayor a cero" |
| rows[i].amountCents | tildada y <= 0 | El monto tiene que ser mayor a cero | idem |
| paidOn / method / notes | igual que payment-form | igual | igual |
Servidor -> cliente: antes TODO iba a `setFormError`; ahora paidOn/method/notes -> `setError` en su campo; `items`/`amountCents`/`familyGroupId` -> error del listado de integrantes (`rows`); `receiptPath` -> bajo el comprobante; resto -> mensaje general. (El servidor devuelve solo el último segmento del path, así que un monto inválido no dice de qué fila: se muestra sobre el listado.)

## Ajustes
| Formulario | Campo | Regla | Mensaje | Antes |
|---|---|---|---|---|
| discipline-form-sheet | name | vacío | Escribí el nombre de la disciplina, por ejemplo Fútbol masculino | "Al menos 2 caracteres" |
| | name | < 2 (servidor) | El nombre tiene que tener al menos 2 caracteres | igual |
| category-form-sheet | name | vacío | Escribí el nombre de la categoría, por ejemplo 5ta | idem |
| | name | < 2 | El nombre tiene que tener al menos 2 caracteres | igual |
| club-settings-form | clubName | vacío | Escribí el nombre del club | "demasiado corto" |
| | clubName | < 2 | El nombre del club es demasiado corto | igual |
| activate-billing-sheet | startPeriod | vacío | Elegí el mes desde el que se generan las cuotas | "Elegí un mes" |
| | startPeriod | formato / no día 1 (servidor) | El mes no es válido. Elegí uno de la lista / Tiene que ser el primer día de un mes | sin regla |
| new-fee-price-sheet | scope | inválido | Elegí a quién aplica el valor | default Zod |
| | amountCents | vacío / no numérico | Ingresá el monto en pesos, por ejemplo 10.000 | "Ingresá un monto válido" |
| | amountCents | negativo (servidor; 0 es válido, CHECK `>= 0`) | El monto no puede ser negativo | igual |
| | validFrom | vacío | Elegí el mes desde el que aplica el valor | "Elegí un mes" |
| | validFrom | no día 1 (servidor + CHECK) | Tiene que ser el primer día de un mes | sin regla |
| | categoryId | scope categoría sin elegir | Elegí una categoría | igual |
| | memberType | scope tipo sin elegir | Elegí un tipo de socio | igual |
Servidor -> cliente: ya existía `setError` por campo en los cinco; lo nuevo es el mensaje inline sin campo (en vez de toast).

## Notas
- Montos: el servidor no define máximo (bigint); el cliente tampoco inventa uno. `parsePesosToCents` ya rechaza lo que no es entero seguro (cae en "Ingresá el monto…").
- Controles revisados: `AmountField`, `DateField`, `SelectField`, `TextField`, `TextareaField` de `shared/form-fields` ya pintan `FieldError` debajo con `aria-invalid`. Los botones de medio de pago usan `aria-pressed`; el error se pinta debajo con `FieldError`. `MonthSelector` y `MemberPicker` no son formularios de envío (navegación / búsqueda), sin cambios.
- Pendiente observado (shared, no mío): cuando `AmountField` recibe texto no numérico muestra el mensaje del schema, no su "Ingresá un monto válido" interno; el nuevo texto del schema cubre ambos casos.
- Verificación: `npm run typecheck` OK; `npm run lint` sin errores ni warnings en `src/views/payments` y `src/views/settings`.
