# Dev log frontend — fecha de nacimiento mínima

Archivo: `src/views/members/member-form.tsx`.

- Schema de cliente (`superRefine` de coherencia): issue en `['birthDate']` si `birthDate < MIN_BIRTH_DATE` (importado de `@/lib/dates`), mensaje "La fecha de nacimiento no puede ser anterior a 1900. Revisá el año" (igual al del backend).
- `DateField` de birthDate recibe `min={MIN_BIRTH_DATE}`.
- Verificado sin editar: `DateField` renderiza `fieldState.error.message` debajo del input (`FieldError role="alert"`, `aria-invalid`, `aria-describedby`). El form usa `zodResolver` con `mode: 'onBlur'`, y en submit valida todo igual. El error de servidor `{ field: 'birthDate' }` entra por `isKnownField` (KNOWN_FIELDS incluye `birthDate`) -> `setError` + `setFocus` en alta y edición.
- Criterio de aceptación: tipear "0198" y salir del campo/enviar muestra el mensaje bajo el input, sin llamar al servidor.
