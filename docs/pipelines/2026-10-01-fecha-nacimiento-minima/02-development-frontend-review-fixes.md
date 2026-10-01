
## Arreglos del review 2

Fuente de verdad de cada texto: `src/models/*`, `src/controllers/billing.actions.ts`. Los componentes cliente no pueden importar modelos, así que el literal se repite.

### Bloqueante 1: topes de largo espejados en el cliente (texto del servidor)
- `displayName` 120: `users/create-user-dialog.tsx`, `users/complete-user-dialog.tsx` ("El nombre no puede tener más de 120 caracteres").
- `email` 254: `users/create-user-dialog.tsx`, `members/member-form.tsx` ("El email no puede tener más de 254 caracteres").
- `clubName` 120: `settings/club-settings-form.tsx` ("El nombre del club no puede tener más de 120 caracteres").
- `name` 120: `settings/category-form-sheet.tsx`, `settings/discipline-form-sheet.tsx`.

### Bloqueante 2: textos unificados (antes -> después)
- payment-schema fecha antigua: "La fecha del pago es demasiado antigua. Revisá el año" -> "La fecha del pago no puede ser anterior a 2020. Revisá el año"
- payment-schema notas: "La nota puede tener hasta 500 caracteres. Acortala" -> "Las notas no pueden tener más de 500 caracteres"
- payment-schema fecha inválida: "La fecha no es válida. Elegila del calendario" -> "La fecha no es válida"
- payment-schema monto vacío: "Ingresá el monto en pesos, por ejemplo 10.000" -> "Ingresá el monto" (también en new-fee-price-sheet)
- payment-schema medio: "Elegí cómo se pagó: efectivo o transferencia" -> "Elegí el medio de pago: efectivo o transferencia"
- reason-dialog motivo: "El motivo es demasiado largo. Resumilo en 500 caracteres o menos" -> "El motivo no puede tener más de 500 caracteres"
- reason-dialog fecha: "La fecha no es válida. Elegila del calendario" -> "La fecha no es válida"; "La fecha no puede ser futura. Elegí hoy o un día anterior" -> "La fecha no puede ser futura"
- club-settings-form: "El nombre del club es demasiado corto" -> "El nombre del club tiene que tener al menos 2 caracteres" (se quitó el mensaje de campo vacío "Escribí el nombre del club": el servidor da el de mínimo)
- category/discipline form: se quitaron "Escribí el nombre de la categoría/disciplina, por ejemplo ..." -> "El nombre tiene que tener al menos 2 caracteres"
- change-password-form: "Ingresá tu contraseña actual (la temporal, si es tu primer ingreso)" -> "Ingresá tu contraseña actual"; "Repetí la contraseña nueva para confirmarla" -> "Repetí la contraseña nueva"; "Las contraseñas no coinciden. Escribí la misma en los dos campos" -> "Las contraseñas no coinciden"
- member-form grupo nuevo: "El nombre del contacto..." -> "El nombre del responsable no puede tener más de 120 caracteres"; "El teléfono del contacto..." -> "El teléfono del responsable no puede tener más de 40 caracteres"
- login-form y create-user-dialog email: "Ingresá un email válido, por ejemplo nombre@dominio.com" -> "Ingresá un email válido"; email vacío ("Ingresá tu email" / "Ingresá el email") -> "Ingresá un email válido"
- member-account-section: "Ingresá el saldo anterior en pesos" -> "Ingresá el monto del saldo anterior"
- medical-clearance-section: "La fecha de vencimiento no es válida" -> "La fecha no es válida"
- new-fee-price-sheet: "Elegí el mes desde el que aplica el valor" -> "Elegí el mes desde el que aplica"
- activate-billing-sheet: "Elegí el mes desde el que se generan las cuotas" / "El mes no es válido. Elegí uno de la lista" -> "Elegí el mes de inicio"

### Reglas del servidor que el cliente no tenía (agregadas, mismo texto)
- new-fee-price-sheet: "Un valor de cuota nuevo aplica desde este mes o uno futuro" (mes pasado).
- activate-billing-sheet: "El mes de inicio tiene que ser este mes o uno futuro; la deuda anterior se carga como saldo de arranque".

### Presencia deliberadamente distinta
Los mensajes de "campo de fecha vacío" ("Elegí la fecha en que se cobró", "Elegí desde qué fecha...", etc.) quedan como están: el servidor solo diría "La fecha no es válida" y la guía de "Elegí..." es más clara para un campo vacío. No hay regla equivalente en el servidor para el vacío.

### Minors
- `medical-clearance-section.tsx`: si `fileError` bloquea el guardado, el foco va al botón "Elegir archivo" (que ya referencia el error con `aria-describedby`/`aria-invalid`); el error sigue visible.
- `category-selector.tsx`: los radios llevan `aria-describedby` al `FieldError` (el `fieldset` también); `aria-invalid` se omitió porque el rol radio no lo admite (lo advierte jsx-a11y). Se quitó `data-invalid` sin efecto y la línea en blanco.
- Medio de pago (`payment-form.tsx`, `group-payment-form.tsx`): los botones referencian el `FieldError` (`METHOD_ERROR_ID`, exportado de `payment-schema.ts`) con `aria-describedby`; sin `aria-invalid` (rol button no lo admite).

### Ronda 3 (paridad detectada por tests/views/payments)
- payment-schema monto no entero: "El monto tiene que ser mayor a cero" -> "El monto no es válido" (<= 0 conserva "mayor a cero").
- receipt-upload tipo no admitido: "Formato no admitido. Usá JPG, PNG, WEBP o PDF." -> "Subí un archivo PDF, JPG, PNG o WEBP".
- receipt-upload tamaño: "El archivo no puede pesar más de 10 MB." -> "El archivo no puede pesar más de 10 MB" (sin punto).
