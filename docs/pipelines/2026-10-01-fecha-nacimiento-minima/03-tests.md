# 03 - Tests: fecha de nacimiento minima

## Cobertura nueva
- `tests/models/members.model.test.ts`: piso 1900 en `createMemberSchema` y `updateMemberSchema` (1899-12-31 rechazado con issue en `birthDate` y mensaje exacto; 1900-01-01 aceptado; caso real "0198-05-10").
- `tests/models/members.model.writes.test.ts`: `23514`/`members_birth_date_sane` -> `DomainError` con `field: 'birthDate'` en `createMember` y `updateMember`.
- `tests/lib/log.test.ts` (nuevo): PostgrestError loguea `code`/`message`/`hint`, nunca `details` (ni el DNI que trae), sin "[object Object]"; `Error` conserva name/message/stack; primitivo -> `{ value }`.
- `tests/db/members.test.ts`: el CHECK rechaza `birth_date` < 1900 con 23514 (INSERT y UPDATE), acepta 1900-01-01.

## Los 5 fallos preexistentes (causa raiz: tests, no produccion)
Los tests de `tests/db/` hardcodeaban setiembre 2026 o sumaban dias al inicio del mes real; hoy es 2026-10-01 (club time).
- `accounts.test.ts` current_fee_cents y monthly_history: usaban `'2026-09-01'` pero ambas RPC miran el mes en curso. Ahora derivan periodo y hoy de `private.club_today()` (helper `clubNow`).
- `billing.test.ts` T6: esperaba `/09\/2026/`; ahora arma `MM/YYYY` desde `club_today()`.
- `billing.test.ts` fixture A-G y ascenso previo: punto medio `periodo + 14/10 dias` caia en el futuro el dia 1 (trigger "La fecha no puede ser futura", correcto). Ahora `least(periodo + N, club_today())`.
No se encontro bug real en `src/` ni SQL: el trigger y las RPC se comportan bien; el calculo de periodo es en hora Argentina (los tests de frontera 02:30 UTC pasan).

## Resultado
`npm test`: Test Files 46 passed (46); Tests 732 passed | 1 skipped (733) (el skip es preexistente en billing). `npm run typecheck` OK. DB local arriba, `tests/db` corrio de verdad.

---

# Ampliación: validación Zod clara en todos los formularios

## Arreglos de los 4 fallos y bombas de tiempo
- `tests/controllers/billing.actions.test.ts`: `activateBilling` y `createFeePrice` usaban `2026-09-01`/`2026-10-01` fijos; con la regla "no mes pasado" caducan solos. Ahora `CURRENT_PERIOD = toPeriod()` y `FUTURE_PERIOD = addMonths(...)`.
- `tests/models/payments.model.test.ts`: el 23503 crudo ahora es `DomainError('El socio no existe', {field:'memberId'})` (contrato nuevo, sin leak de la constraint); se agregó el caso complementario: un error desconocido (57014) NO se vuelve DomainError.
- `tests/models/fee-prices.model.test.ts`: `BASE.validFrom` derivado del reloj; casos nuevos de frontera (mes actual pasa, mes anterior falla con el mensaje y path `validFrom`).

## Cobertura nueva
- `tests/db/constraint-translations.test.ts` (29 tests, base real): provoca cada violación como `admin` por el camino de PostgREST, toma el error de Postgres TAL CUAL y lo pasa por el modelo real (cliente de Supabase falso que inyecta ese error en la escritura). Confirma los nombres de constraint inferidos: `members_{first_name,last_name,dni,email,family_group_id}_*`, `member_status_events_reason_check`, `fee_prices_{amount_cents_check,valid_from_check,scope_shape}` + FK + unique, `payments_amount_cents_check`, `payments_void_triad`, trigger "La fecha del pago es demasiado vieja" (2019-12-31 falla, 2020-01-01 pasa), FK de socio, `app_users_{display_name,role,email}_check`, `*_name_check` de catálogos + FK de disciplina, `settings_billing_start_period_check`. Verifica `field` y que ningún mensaje contenga texto crudo de Postgres.
  - Observacion: `members_email_check` es solo `email = lower(email)` (el formato lo valida Zod); el modelo igual le muestra "El email no es válido". El modelo ya baja a minúsculas al escribir, así que solo se alcanza por PostgREST directo.
- `tests/lib/log.test.ts`: code de clase 22 (`22P02`, `22007`, `22001`) y desconocidos no loguean `message` (que trae el valor tipeado: nombre, DNI, teléfono); `23xxx`/`42xxx`/`PGRST` sí; sin `code` no se loguea.
- `tests/views/payments/payment-schema.test.ts` y `receipt-upload.test.ts`: los schemas del cliente contra los del servidor (mensaje por campo, fronteras 2019-12-31/2020-01-01, hoy/mañana en hora del club, 10 MiB / +1 byte).

## No cubierto
Los schemas Zod inline dentro de componentes `.tsx` (login, usuarios, ajustes, socio, apto, motivo, deportes) no son importables sin arrastrar la UI; el pedido de extraerlos a módulos `*-schema.ts` queda para el frontend.

## FALLAS REALES (drift cliente/servidor, dueño: frontend-react-craftsman B, `src/views/payments/`)
1. `payment-schema.ts` `amountCentsSchema`: monto no entero (1000.5) dice "El monto tiene que ser mayor a cero"; el servidor dice "El monto no es válido".
2. `receipt-upload.ts:19` `validateReceiptFile`, tipo no admitido: "Formato no admitido. Usá JPG, PNG, WEBP o PDF." vs servidor "Subí un archivo PDF, JPG, PNG o WEBP".
3. `receipt-upload.ts:22`, tamaño: "...más de 10 MB." (con punto) vs servidor "...más de 10 MB".
Son textos, no seguridad: la validación existe y rechaza lo correcto en ambos lados.

## Resultado
`npm test`: Test Files 2 failed | 47 passed (49); Tests 3 failed | 789 passed | 1 skipped (793). `npm run typecheck` OK. DB local arriba.

SUITE RED (3 fallas, las de arriba, drift de textos cliente/servidor)

---

## Corrida final (hilo principal, después de la ronda 3 de arreglos)

Los 3 drifts de arriba (monto no entero, tipo y tamaño de comprobante) se
arreglaron en `src/views/payments/`. `npm test` con la base local arriba:

```
Test Files  49 passed (49)
     Tests  792 passed | 1 skipped (793)
```

`npm run typecheck` limpio, `npm run lint` 0 errores.

**SUITE GREEN**
