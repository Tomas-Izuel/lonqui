# 02 — Correcciones de frontend del code review (slice 2)

Agente: `frontend-react-craftsman`. Fecha: 2026-09-28. Entrada: `03-review.md`
(veredicto `CHANGES REQUESTED`). Alcance de esta pasada: solo `src/views/**` y
`src/app/**`. No se tocó `src/models/**`, `src/controllers/**`,
`supabase/**`, `tests/**` ni `src/views/shared/**` (ningún hallazgo de mi lane
lo pedía explícitamente). No se corrió `npm install` ni `next build`; se
verificó contra el `next dev` compartido (`localhost:3000`).

## D12-C — `payment-form.tsx`: chip "Toda la deuda" duplicaba "1 mes"

Archivo: `src/views/payments/payment-form.tsx` (~línea 95).

Antes, el chip aparecía con cualquier deuda positiva (`member.balanceCents >
0`). Ahora exige que la deuda total sea **mayor** a la cuota corriente
(`member.balanceCents > (member.currentFeeCents ?? 0)`), como pedía D12-C: con
exactamente un mes de deuda, "1 mes" y "Toda la deuda" son el mismo monto y
mostrar los dos era redundante en la pantalla de cobro más usada.

Verificado en vivo contra el socio `Inventada, Sofía` (id 6, seed: debe
exactamente $10.000 · 1 mes, `currentFeeCents = 10.000`) en
`/cobranza/nuevo?socio=6`: solo aparecen los chips "1 mes / 2 meses / 3
meses", sin "Toda la deuda". No se tocó la lógica de sobrepago
(`needsOverpayConfirm`), que sigue funcionando igual (verificado con el mismo
socio, monto $50.000 → mensaje "El pago supera la deuda actual… saldo a favor
de $40.000").

## D13 — `group-payment-form.tsx`: sin confirmación de sobrepago

Archivo: `src/views/payments/group-payment-form.tsx`.

Se agregó la misma interacción que `PaymentForm` (mismo texto base, mismo par
de botones "Sí, registrar igual" / "Ajustar…"), pero **resuelta por lote
entero, con el detalle por integrante**, no una confirmación por fila:

- **Por qué agregada y no por fila**: el registro del grupo ya es de lote
  entero — un solo `batchId`, un solo submit, una sola llamada a
  `registerPayment`. Una confirmación por fila obligaría a partir ese submit
  en N pasos o a un estado de confirmación por `memberId`, más complejo que lo
  que el propio flujo necesita. Una confirmación agregada que **lista cada
  integrante afectado con su saldo a favor resultante** da la misma
  información (nadie se entera tarde de que quedó con saldo a favor) sin
  reinventar el mecanismo de envío.
- **Mismo criterio que el individual**: solo cuenta como sobrepago si el
  integrante **todavía debe algo** (`debtStatus === 'in_debt'`) y el monto de
  su fila supera su deuda individual (`row.amountCents > account.balanceCents`).
  Precargar un monto mayor a la cuota para pagar meses futuros (chips "2/3
  meses" en el individual; acá, editar el monto de una fila al día) no es
  sobrepago — mismo comentario que ya existía en `PaymentForm`.
- **Texto**: con un solo integrante afectado, el mismo mensaje que
  `PaymentForm` ("El pago de \<Nombre\> supera la deuda actual. Va a quedar un
  saldo a favor de \<monto\>."). Con más de uno, un encabezado ("Estos pagos
  superan la deuda actual de cada integrante. Van a quedar con saldo a
  favor:") más una lista `<Nombre>: saldo a favor de <monto>` por integrante.
- **Gating**: igual que el individual, el botón de submit normal se oculta
  mientras `needsOverpayConfirm` es `true`; "Ajustar montos" solo cierra el
  panel (no toca los valores), dejando que el usuario edite los montos
  directamente en las filas y reintente el submit.

**Verificación**: la superficie renderiza sin errores de consola/hidratación
en `/cobranza/nuevo?grupo=1&socio=3` (Familia Ejemplo, 390px y con
`typecheck`/`lint` limpios). **No pude ejercer el camino positivo en vivo**:
los tres integrantes de "Familia Ejemplo" en el seed están hoy `al día` o con
`saldo a favor` (ninguno `in_debt`), así que ningún monto tipeado dispara la
condición — y generar deuda artificial para probarlo hubiera significado
escribir pagos/cargos reales en la base compartida del `next dev`, que evité
a propósito. Rastreé la lógica contra el mismo patrón ya probado en
`PaymentForm` (mismo estado, misma condición, mismo JSX) y confirmé el caso
negativo por código: un integrante `credit` o `up_to_date` nunca entra en
`overpayingRows` sin importar el monto (el filtro corta en
`account.debtStatus !== 'in_debt'` antes de comparar montos). El propio
`03-review.md` (Nota para test-engineer, ítem 7) ya pide un caso de test
sintético para esto — queda para `test-engineer`, con un integrante de grupo
`in_debt` en el fixture.

## D16/6 — `member-accounts-list.tsx`: la tabla de escritorio no distinguía "saldo a favor"

Archivo: `src/views/payments/member-accounts-list.tsx`.

Las `columns` (tabla `≥ md`) eran las mismas para las dos variantes
(`in_debt`/`up_to_date`) y solo mostraban "Meses" + "Monto" en valor absoluto:
un socio con saldo a favor y uno al día pelado se veían idénticos, mientras
que la fila mobile (`renderRow`) sí distinguía con `DebtStatusPill`.

Ahora `columns` se arma según `variant`:

- `up_to_date` (`/cobranza/al-dia`): "Apellido, Nombre", "Categorías",
  **"Estado"** (el mismo `DebtStatusPill`) y "Saldo" (el monto, en verde
  cuando `debtStatus === 'credit'`, mismo tono `text-status-up-to-date` que ya
  usa la fila mobile). Se sacó la columna "Meses" para esta variante: en este
  listado siempre es 0 (nadie con `up_to_date`/`credit` debe meses), así que
  no aportaba y el espacio lo ocupa mejor el estado.
- `in_debt` (`/cobranza/deuda`): sin cambios — "Apellido, Nombre",
  "Categorías", "Meses", "Monto".

Verificado en vivo en `/cobranza/al-dia` a 1440px: la tabla ahora muestra
"Al día" / "Saldo a favor" con pill, y el saldo a favor en verde con su
monto — visualmente igual a la fila mobile. Sin overflow, sin errores de
consola.

## F3 — `dashboard`: falta "cantidad de pagos" en "Este mes"

Archivo: `src/views/dashboard/month-rows.tsx`. `DashboardSummary.paymentsCount`
ya lo mapea el backend (confirmado en `src/models/types.ts` y en vivo: el
panel inicial en `/` muestra "Cantidad de pagos: 15" bajo "Este mes",
coincidiendo con `MonthCollection.paymentsCount` de `/cobranza`). Se agregó
una tercera `DataRow` ("Cantidad de pagos", `summary.paymentsCount`) al lado
de "Efectivo"/"Transferencia", cerrando el criterio de aceptación de
`01-tasks.md §F3` ("Este mes: … efectivo/transferencia, cantidad de pagos").

**Primer viewport a 390 sin romper**: el panel "Este mes" está bien debajo del
plegado (después del encabezado, `MoneySummaryStrip` y "Qué hay que
resolver"), confirmado con captura de solo-viewport a 390×844: la fila nueva
no aparece ahí, y `document.documentElement.scrollWidth === clientWidth`
(390 = 390, sin overflow horizontal) tanto en esa vista como en la del panel
completo.

## Otros hallazgos MINOR/NIT del informe, lane frontend

- **#15 (`history-chart.tsx`, tooltip con `aria-live="assertive"`)**: bajado a
  `aria-live="polite"`, como sugería el informe (el contenedor ya es
  `role="img"` con `aria-label` completo y la tabla accesible equivalente es
  el camino real para lectores de pantalla; esto es solo defensivo). Cambio
  de una línea, sin riesgo.
- **#16 (`money-summary-strip.tsx`, % sin la palabra "cuotas")**: el texto
  pasó de "Cobrado en \<mes\> $X de $Y (Z%)" a "… de $Y **en cuotas** (Z%)",
  como pedía D16/D2. Verificado en vivo: "Cobrado en septiembre 2026 $149.694
  de $110.000 en cuotas (136%)".
- **#9 (`button.tsx`, `icon-lg` = `icon`/`icon-sm`)**: **no tocado**. Vive en
  `src/components/ui/**`, fuera de mi alcance para esta tanda (`src/views/**`
  y `src/app/**` únicamente, y no es `src/views/shared/**` tampoco). Queda
  anotado para quien vuelva a tocar esa primitiva, tal como ya dice el
  informe.
- **#13 (`reason-dialog.tsx`, campo "Fecha" sin efecto en `voidPayment`/
  `voidFee`)**: **no tocado**. Es `src/views/shared/**`, explícitamente fuera
  de esta tanda salvo pedido expreso del informe — y el informe lo marca como
  "fuera del lane de F1/F2 para este slice… para un pipeline futuro", no como
  algo a resolver ahora.
- **#8, #10, #11, #12, #14**: migraciones, modelos, seed — no son lane
  frontend, no tocados.

## Hallazgo nuevo, no reportado (observado durante la verificación)

Al navegar a `/login` con Playwright a 390px apareció un warning de
**hydration mismatch** de React sobre el atributo `method` del `<form>`. No
estaba en `03-review.md` y en la primera pasada de este dev log lo dejé
anotado sin tocar (no era uno de mis 5 puntos). El coordinador lo asignó
explícitamente después de leer este reporte — arreglado más abajo.

## Hydration mismatch en `LoginForm`/`ChangePasswordForm` (`method="post"` vs `"POST"`)

Asignado por el coordinador después del reporte inicial de este mismo dev log
("Hallazgo nuevo, no reportado" arriba). Archivos:
`src/views/auth/login-form.tsx`, `src/views/auth/change-password-form.tsx`.

**Causa raíz** (rastreada en el código de React, no supuesta): los dos `<form>`
tienen `action={formAction}` (la función que devuelve `useActionState`, para
que el envío sin JS le pegue directo a la Server Action) y explícitamente
`method="post"` en minúscula. Cuando `action` de un `<form>` es una función,
`react-dom`'s server renderer (`pushFormActionAttribute` /
`getCustomFormFields` en `react-dom-server.node.production.js`) **ignora el
`method` que el JSX declara** y en su lugar usa el que trae `$$FORM_ACTION` de
la referencia a la Server Action — metadata que agrega
`react-server-dom-turbopack-client` (`node_modules/next/dist/compiled/
react-server-dom-turbopack/cjs/react-server-dom-turbopack-client.node.
production.js:593`, literalmente `method: "POST"`, mayúscula, hardcodeado por
React/Next). Ese override **solo existe en el renderer de servidor**: no hay
ningún `$$FORM_ACTION`/`getCustomFormFields` en el bundle de cliente
(`react-dom-client.production.js`), así que la hidratación arranca del string
literal del JSX (`"post"`) tal cual. Resultado: HTML del servidor con
`method="POST"`, intento del cliente con `method="post"` → mismatch de
hidratación en cada carga de `/login` y `/cambiar-contrasena`.

**Arreglo**: `method="post"` → `method="POST"` en los dos formularios (un
cambio de casing, cero lógica). La regla de lint
(`no-restricted-syntax` sobre `JSXOpeningElement[name.name='form']` en
`eslint.config.mjs`) solo exige que el atributo `method` exista, no un valor
en particular — sigue pasando. Dejé el razonamiento completo en un comentario
en cada archivo para que quien lo vuelva a tocar no la revierta a minúscula
pensando que es solo estilo.

**Verificación**:
- Playwright, 390×844, con JS: **cero** mensajes de consola con "hydrat" en
  `/login` (sin sesión) y en `/cambiar-contrasena` (modo voluntario, sesión de
  `admin@lonqui.test`) — antes del fix, `/login` mostraba el warning de
  hydration mismatch de React apenas cargaba.
- Playwright con `javaScriptEnabled: false`: el submit de `/login` sigue
  siendo un **POST multipart/form-data** real (no un GET) con `email`/
  `password` en el body, nunca en la URL, y termina en `/` (login exitoso).
  Mismo comportamiento que ya había verificado el agente de feedback del
  slice 1 para este flujo — no se rompió con el cambio de casing.
- `npm run typecheck` y `npm run lint`: limpios (mismo resultado que la
  ronda anterior de este dev log).

## Verificación

- `npm run typecheck`: limpio, 0 errores.
- `npm run lint`: 0 errores, 4 warnings — los 4 en `tests/**` (variables sin
  usar), ninguno en mi lane.
- Playwright contra el `next dev` compartido (`admin@lonqui.test`), 390×844 y
  1440×900: `/`, `/cobranza/al-dia`, `/cobranza/deuda`,
  `/cobranza/nuevo?socio=6` (chip dedupe + sobrepago individual),
  `/cobranza/nuevo?grupo=1&socio=3` (grupo, render y ausencia de errores),
  `/login` y `/cambiar-contrasena` (sin sesión y con sesión, sin warnings de
  "hydrat" en consola) y `/login` con `javaScriptEnabled: false` (POST
  multipart real, sin campos en la URL). Sin errores de consola nuevos, sin
  overflow horizontal a 390.
- No se registró ningún pago real durante la verificación (los clicks de
  submit se probaron solo hasta el punto de confirmación, sin completar el
  registro), para no dejar residuo en la base compartida del `next dev`.

## Deferrals / follow-ups

- `test-engineer`: agregar un integrante `in_debt` a un grupo familiar en el
  fixture de test para poder ejercer el camino positivo de la confirmación de
  sobrepago de `GroupPaymentForm` (mismo pedido que ya hace `03-review.md`,
  Nota para test-engineer, ítem 7).
- El hydration mismatch de `method` en `LoginForm`/`ChangePasswordForm` quedó
  resuelto en esta misma tanda (ver sección dedicada arriba) — ya no es un
  follow-up pendiente.
