# 02 — Desarrollo frontend F1: Cobranza (hub, registrar pago, pagos del mes, listados)

Agente: `frontend-react-craftsman`. Tarea: **F1** de `01-tasks.md` (sección F1
y "Reglas comunes" del lane `frontend`). Brief: `.impeccable/surfaces/route-cobranza.md`
+ sección "Registrar pago" de `route.md`. Arquitectura consumida: §10 y §13
(Revisión 3) de `00-architecture.md`.

## Archivos

**Vistas** (`src/views/payments/`, todos nuevos):
- `account-format.ts` — helpers puros de texto: `categoriesLabel`,
  `accountLineText` ("Debe $X · N meses" / "Al día" / "Saldo a favor $X" /
  "Dado de baja · …"), `currentFeeLabel` (precarga con desglose por deporte,
  D12 revisada, §13.4).
- `receipt-upload.ts` / `receipt-picker.tsx` — subida de comprobante (mismo
  patrón de dos pasos que el apto físico: URL firmada + `uploadToSignedUrl`
  en el browser, compresión de imágenes > 2 MB).
- `payment-form.tsx` — `PaymentForm`: pago de UN socio. Precarga = suma de
  cuotas del mes con desglose visible, chips 1/2/3 meses (múltiplos de la
  suma) y "Toda la deuda", confirmación cuando el monto supera la deuda,
  medio de pago (Efectivo/Transferencia como botones grandes), comprobante
  condicional, notas plegadas, `batchId` con `useState(() => crypto.randomUUID())`.
- `group-payment-form.tsx` — `GroupPaymentForm`: pago de grupo familiar con
  `useFieldArray`, checkbox + monto editable por integrante (activos
  marcados, de baja desmarcados y con la etiqueta), total del lote en vivo,
  un solo `batchId` y un solo comprobante para todo el lote.
- `payment-form-page.tsx` — `PaymentFormPage`: decide individual vs. grupo
  según `PaymentFormData.familyGroup` y hace `router.push(volverHref)` al
  terminar. La usa `/cobranza/nuevo/page.tsx`.
- `register-payment-sheet.tsx` — `RegisterPaymentSheet` (ver "Componente
  reutilizable para F2" más abajo).
- `cobranza-hub-view.tsx` — hub de `/cobranza`: buscador de socio (escribe
  `?q=`, reusa `getPadron`), "Este mes" (filas etiqueta/valor), accesos a los
  cuatro listados.
- `month-selector.tsx`, `month-payments-view.tsx`, `month-payments-list.tsx`
  — `/cobranza/pagos`: selector de mes por URL, totales, lista con "Ver más"
  (acumulado en cliente, mismo patrón que `MemberList`/`AuditList`), "Ver
  comprobante" (firma la URL al tocar, mismo patrón que
  `MedicalClearanceSection`), "Anular" (`ReasonDialog`, solo con
  `payments.void`).
- `member-accounts-listing-view.tsx` — `MemberAccountsListingView`: wrapper
  Server Component (`PageHeader` + `FilterBar`) que comparte forma entre
  `/cobranza/deuda` y `/cobranza/al-dia` (`variant` decide copy y meta de
  fila). Delega la lista y el "Ver más" en `member-accounts-list.tsx`.
- `member-accounts-list.tsx` — `MemberAccountsList` (Client Component,
  agregado en el fix post-entrega de abajo): acumula "Ver más" llamando
  `loadMoreMemberAccounts` (Server Action nueva de B4), mismo patrón que
  `MemberList`/`MonthPaymentsList`.
- `debt-by-category-view.tsx` — `/cobranza/por-categoria`: filas por
  categoría + "Cuota social" + "Saldo anterior", total al pie desde
  `dashboard_summary` (nunca sumado en TS).

**Rutas** (`src/app/(panel)/cobranza/`, todas nuevas, con su `loading.tsx`/
`error.tsx`): `page.tsx` (hub), `nuevo/page.tsx` (+ `loading.tsx` propio,
forma de formulario), `pagos/page.tsx`, `deuda/page.tsx`, `al-dia/page.tsx`,
`por-categoria/page.tsx`. `error.tsx`/`loading.tsx` genéricos a nivel
`cobranza/` cubren los listados (misma lógica que ya usa el resto del panel:
Next hereda el boundary más cercano).

## Decisiones y por qué

1. **El buscador de "Registrar pago" NO es un combobox propio.** Evalué
   reusar `loadMoreMembers` (Server Action de B3) para un combobox en vivo,
   pero su schema exige `cursor` no vacío (`z.string().min(1)`): sirve para
   "Ver más" de una lista ya montada, no para una primera búsqueda desde
   cero. En vez de inventar una action nueva (no soy dueño de
   `members.actions.ts`) o pedirla como dependencia y bloquear el resto del
   slice, usé el mismo mecanismo que ya resuelve "retomar después de una
   interrupción" en todo el panel: `SearchInput` (shared) escribe `?q=` y
   `/cobranza/page.tsx` llama a `getPadron({ q, status: 'all', limit: 8 })`
   (controller de lectura de B3, pensado para Server Components) — sin
   combobox, sin JS de más, consistente con `/socios`. `status: 'all'` a
   propósito: un socio de baja con deuda también se busca acá para cobrarle
   (D14).
2. **`getPaymentFormData` (Server Action de B2) se llama DIRECTO desde
   `/cobranza/nuevo/page.tsx`** (Server Component), no envuelta en un
   controller de lectura. Es legal (ninguna regla de `eslint.config.mjs`
   restringe que una page importe un `.actions.ts`, solo `@supabase/*`) y es
   la única forma de que el formulario más rápido del sistema no pague un
   viaje cliente-servidor extra antes de mostrar nada; la misma función
   también la usa `RegisterPaymentSheet` (Client Component) sin duplicar
   lógica.
3. **`getMonthCollection` (modelo de `reports.model.ts`) se llama directo
   desde `/cobranza/pagos/page.tsx`**, mismo criterio ya usado en
   `/socios/page.tsx` con `getBillingStatus()`: es una lectura plana (una
   RPC, sin nada que orquestar), y `CLAUDE.md` lo permite explícito ("una
   page puede llamar a un modelo directamente para una lectura plana").
4. **`PaymentForm`/`GroupPaymentForm` reciben `onDone: () => void`, no
   `volverHref`.** Así el mismo componente sirve para navegar
   (`/cobranza/nuevo/page.tsx`, vía `PaymentFormPage`) o para cerrarse en un
   sheet sin salir de la página (`RegisterPaymentSheet`), sin que el
   formulario sepa cuál de las dos es ni acople su lógica de negocio a la
   navegación.
5. **Confirmación de sobrepago inline, no un `window.confirm`.** Cuando el
   monto supera la deuda (`member.debtStatus === 'in_debt' && monto >
   balance`), el botón de submit se reemplaza por un aviso con "Sí, registrar
   igual" / "Ajustar el monto" — nunca se dispara si el pago es un adelanto
   deliberado con saldo ya a favor (D13: pagar meses no generados es un flujo
   esperado, no una alarma).
6. **`ReasonDialog` (shared) se reusa para "Anular pago" descartando
   `effectiveOn`.** El primitivo pide fecha + motivo siempre; `voidPayment`
   no usa fecha (el trigger la pone en `now()`). Es la misma decisión que
   `00-architecture.md` §10 pide explícito ("Anular… con `ReasonDialog`") y
   evita reinventar un diálogo de un solo campo.
7. **Ancho de formulario en escritorio**: verificado a 1440px, el formulario
   ocupaba todo `max-w-5xl` del `AppShell` y quedaba desproporcionado. Lo
   corregí a `mx-auto max-w-xl`, el mismo ancho que ya usa `member-form.tsx`
   para su columna única — consistencia con la convención ya establecida, no
   una decisión nueva.

## Bug real encontrado y corregido durante la verificación

**Hidratación rota en `GroupPaymentForm`** (`group-payment-form.tsx`): usaba
`field.id` (el id interno que genera `useFieldArray` de react-hook-form) en
los atributos `id`/`htmlFor` del checkbox de cada fila. Ese id NO es estable
entre el render del servidor y la hidratación del cliente (a diferencia de la
`key` de la lista, que nunca llega al DOM), así que React tiraba "A tree
hydrated but some attributes… didn't match" en cada carga de
`/cobranza/nuevo?grupo=`. Lo encontré con una corrida de Playwright leyendo
`console` (`msg.type() === 'error'`), no a simple vista — un screenshot no lo
muestra. Corregido: `id`/`htmlFor` ahora usan `field.memberId` (estable,
numérico, viene de los datos); `field.id` queda solo como `key` del `.map()`.
Verificado después: las siete rutas de `/cobranza` cargan sin ningún error de
consola.

## Componente reutilizable para F2: `RegisterPaymentSheet`

El mensaje que me lanzó pidió explícito un componente reutilizable
(`RegisterPaymentSheet`/similar) para que F2 lo importe desde la ficha del
socio. Lo agregué en `src/views/payments/register-payment-sheet.tsx`:

```tsx
<RegisterPaymentSheet
  open={boolean}
  onOpenChange={(open: boolean) => void}
  memberId={number}       // uno de los dos
  familyGroupId={number}  // uno de los dos
/>
```

Pide los datos con `getPaymentFormData` recién al abrirse (no antes), muestra
loading/error/ready, y al terminar cierra el sheet y hace `router.refresh()`
(los montos de la ficha se vuelven a leer del servidor). **Importante**: el
flujo APROBADO en `00-architecture.md` §10 y en la aceptación de F2
(`01-tasks.md`) es un link directo — "Registrar pago" / "Pago del grupo" en
la ficha llevan a `/cobranza/nuevo?socio=…&volver=/socios/<id>` — más simple,
sin estado de carga adicional, y es lo que `/cobranza/nuevo/page.tsx` ya
implementa contra ese contrato exacto. `RegisterPaymentSheet` queda como
alternativa disponible y probada (typecheck + lint limpios, sin prueba manual
propia en este pipeline porque nadie la monta todavía); si F2 prefiere no
salir de la ficha, puede importarla tal cual. Si F2 usa el link (lo
recomendado), este archivo queda sin consumidor — no rompe nada dejarlo.

## Contratos consumidos (sin tocar `controllers/**` ni `models/**`)

`src/controllers/payments.actions.ts`: `registerPayment`, `voidPayment`,
`prepareReceiptUpload`, `getReceiptUrlAction`, `getPaymentFormData`,
`loadMoreMonthPayments`. `src/controllers/payments.controller.ts`:
`getMonthPaymentsPage`. `src/controllers/reports.controller.ts`:
`getCobranzaHub`, `getDebtListing`, `getUpToDateListing`,
`getDebtByCategoryPage`. `src/controllers/members.controller.ts`: `getPadron`
(buscador). `src/models/reports.model.ts`: `getMonthCollection` (lectura
plana). `src/models/catalogs.model.ts`: `listDisciplines` (opciones de
filtro). Tipos: `PaymentFormData`, `MemberAccount`, `MonthCollection`,
`PaymentListItem`, `DebtByCategoryRow`, `Page<T>`, `BillingStatus`,
`FamilyGroupSummary`, `Permission`.

Primitivas de `src/views/shared/` usadas tal cual (ninguna nueva pedida):
`Panel`, `PageHeader`, `DataList`, `FilterBar`, `SearchInput`, `Pagination`,
`EmptyState`/`LoadingList`/`ErrorState`, `Amount`, `DateText`/`PeriodText`,
`DebtStatusPill`, `ReasonDialog`, `ResponsiveSheet`, `AmountField`/
`DateField`/`TextareaField`, `labels.ts` (`paymentMethodLabels`,
`memberStatusLabels`).

## Comportamiento visible por el usuario (acceptance criteria, `01-tasks.md` F1)

- **`/cobranza`**: todos los roles entran (`payments.read`). "Registrar
  pago" + buscador solo con `payments.register` (admin/editor). "Este mes"
  siempre visible; con facturación inactiva explica que no hay cuotas para
  comparar (sin ocultar lo cobrado). Accesos a los cuatro listados como filas
  con chevron.
- **`/cobranza/nuevo?socio=`**: encabezado con nombre, deportes/categorías
  ("Fútbol masculino · 5ta, Vóley · Sub 18" o "No practicante"),
  `DebtStatusPill` + línea de cuenta, precarga con desglose ("Cuota de
  septiembre 2026: $20.000 (Fútbol femenino · Primera $10.000 + Vóley · Sub
  18 $10.000)" — verificado en pantalla con un socio real de dos deportes).
  Chips 1/2/3 meses y "Toda la deuda"; fecha por defecto hoy (zona club);
  medio como dos botones de 48px; comprobante al elegir Transferencia,
  disponible en Efectivo plegado (siempre montado, solo oculto); notas
  plegadas; botón que nombra el monto y se deshabilita mientras envía;
  `alreadyRegistered` → toast sin duplicar; socio de baja → la línea de
  cuenta lo dice y precarga la deuda; sobrepago → confirmación explícita
  antes de someter.
- **`/cobranza/nuevo?grupo=`**: integrantes con checkbox (activos marcados,
  de baja con la etiqueta), monto editable por fila, total en vivo y
  repetido en el botón, un solo `batchId` y un solo comprobante para el lote.
- **`/cobranza/pagos?mes=`**: selector de mes, totales arriba, lista por
  fecha desc con socio/monto/medio/quién cargó, "Ver comprobante" (firma al
  tocar, nunca una URL persistida) y "Anular" (solo `payments.void`,
  `ReasonDialog` con la consecuencia escrita); anulados tachados con motivo;
  "Ver más" acumulado en cliente.
- **`/cobranza/deuda` / `/al-dia`**: filtros en la URL (categoría, incluir
  dados de baja), filas con categorías + meses + monto (o `DebtStatusPill` en
  al-día), ordenadas por meses desc (lo hace la RPC, no la vista); tocar abre
  la ficha.
- **`/cobranza/por-categoria`**: filas por categoría + "Cuota social" +
  "Saldo anterior al sistema", total al pie desde `dashboard_summary`
  (verificado que coincide, no se suma en TS); enlaza a `/cobranza/deuda?categoriaId=`.
- **Accesibilidad**: línea de cuenta como texto completo (no solo color/pill);
  anulados con `<s>` + texto "Anulado: <motivo>"; targets ≥44px en chips,
  botones de medio de pago y menú de fila; `aria-pressed` en los toggles de
  medio de pago; `role="alert"` en errores de formulario.
- **`consulta`**: no ve "Registrar pago" ni el buscador en el hub, ni "Anular"
  en pagos (ambos gateados por `session.permissions.includes(...)`, nunca por
  `session.role` — verificado leyendo el código, T12).
- **`editor` no ve "Anular"**: no había usuario `editor` en el seed local (solo
  `admin@lonqui.test`) y no creé uno para no tocar `/usuarios` fuera de mi
  lane. Verificado por código en cambio: `canVoid` en
  `MonthPaymentsView`/`MonthPaymentsList` es
  `session.permissions.includes('payments.void')`, y el catálogo de permisos
  (§6.8, `00-architecture.md`) no le da `payments.void` a `editor` (solo a
  `admin`) — el botón/ítem de menú nunca se renderiza para ese permiso
  ausente, sea cual sea el rol.

## Verificación hecha

`npm run typecheck` y `npm run lint`: **cero errores/warnings** en
`src/views/payments/**` y `src/app/(panel)/cobranza/**` (los 9 errores de
`tsc --noEmit` que quedan son preexistentes en `tests/models/members.model.writes.test.ts`,
fuera de mi lane). Playwright contra el `next dev` compartido en :3000 (no
levanté otro servidor ni corrí `next build`), a 390×844 y 1440×900, con
`admin@lonqui.test`:

- Registré un pago individual real (socio "Prueba, Joaquín", $12.345 contra
  una deuda de $5.000 → disparó y confirmé la pantalla de sobrepago; quedó
  con saldo a favor, verificado en su ficha).
- Registré un pago de grupo real para "Familia Ejemplo" (3 integrantes,
  $10.000 cada uno, medio Transferencia, un solo lote).
- Anulé un pago como admin desde `/cobranza/pagos` con motivo; verifiqué que
  el total de "Cobrado" del mes se actualizó solo (via `revalidatePath`, sin
  `router.refresh()` manual de mi parte) y que el pago quedó tachado con el
  motivo.
- Recorrí las siete rutas (`/cobranza`, `/nuevo?socio=`, `/nuevo?grupo=`,
  `/pagos`, `/deuda`, `/al-dia`, `/por-categoria`) leyendo la consola del
  browser: encontré y corregí el bug de hidratación de arriba; después,
  las siete cargan sin ningún error ni warning de React.
- Sin scroll horizontal a 390px en ninguna de las siete pantallas.

**Datos que quedaron cargados en la base local** (esperado, avisado en la
tarea): pagos reales para los socios 1 (Lucía Ejemplo), 2 (Tomás Ejemplo), 3
(Martina Ejemplo), 4 (Joaquín Prueba), 5 (Valentina Ficticia) — todos con
`created_by` = admin de desarrollo — y una anulación de prueba sobre uno de
los pagos de Martina Ejemplo (motivo: "Prueba de verificación F1: anulación
de humo"). Es local, con seed inventado; nada de esto son datos reales del
club.

## Fixes post-entrega

### 1. Open redirect en `?volver=` (hallazgo del coordinador, 2026-09-28)

`src/app/(panel)/cobranza/nuevo/page.tsx` armaba `volverHref` con
`firstValue(sp.volver) || '/cobranza'` y se lo pasaba sin validar a
`PaymentFormPage`, que termina en `router.push(volverHref)` en el browser:
`?volver=https://evil.example` o `?volver=//evil.example` era un redirect
abierto (mismo blocker que ya tuvo el login en el slice 1, `03-review.md`).
**Fix**: `safeRedirectPath(firstValue(sp.volver), '/cobranza')` (la única
fuente para esto, `src/lib/safe-redirect.ts`) — se resuelve en el SERVIDOR,
antes de que la vista reciba el valor, así que `PaymentFormPage`/
`PaymentForm`/`GroupPaymentForm` nunca ven algo que no sea una ruta interna.

Revisé el resto de mis rutas por si leía algún otro `volver`/`next` de
`searchParams`: `nuevo/page.tsx` es el único lugar (el hub solo ESCRIBE un
`volver=/cobranza` literal, hardcodeado, nunca lo lee de vuelta).

Verificado en vivo contra el `next dev` compartido (Playwright,
`admin@lonqui.test`):

| `?volver=` | Termina en |
|---|---|
| `https://example.com` | `/cobranza` |
| `//example.com` | `/cobranza` |
| `/\evil.com` (barra invertida) | `/cobranza` |
| `/socios/5` (ruta interna real) | `/socios/5` (sigue funcionando) |

`npx tsc --noEmit` y `npx eslint` sobre `cobranza/nuevo/page.tsx`: limpio.

### 2. "Ver más" real en `/cobranza/deuda` y `/cobranza/al-dia` (B4 agregó `loadMoreMemberAccounts`)

B4 corrigió el hallazgo 1 de abajo (`listMemberAccounts` ahora usa
`.in('debt_status', ['up_to_date','credit'])` cuando el filtro es
`up_to_date`, sin cambiar ninguna firma que yo consuma) y agregó
`loadMoreMemberAccounts(input): Promise<ActionResult<Page<MemberAccount>>>`
en `src/controllers/reports.actions.ts` (mismo patrón que
`loadMoreMembers`/`loadMoreMonthPayments`). Reemplacé el texto provisorio
("Mostrando los primeros N socios…") por un "Ver más" real:

- **`src/views/payments/member-accounts-list.tsx`** (nuevo, Client
  Component): acumula en estado, llama `loadMoreMemberAccounts({ debt:
  variant, categoryId, status, cursor })` — mismo patrón que `MemberList`/
  `MonthPaymentsList` (el `filters` que viaja nunca lleva `cursor` propio, lo
  agrega este componente en cada pedido).
- **`member-accounts-listing-view.tsx`** quedó como wrapper fino (Server
  Component): `PageHeader` + `FilterBar` + `<MemberAccountsList key=
  {filtersKey} .../>`, mismo patrón `filtersKey` (sin cursor) que
  `MemberListView` para remontar con estado fresco cuando cambia un filtro
  real.
- `ListingVariant` se movió a `account-format.ts` (antes vivía en
  `member-accounts-listing-view.tsx`) para que `member-accounts-list.tsx` no
  tuviera que importarlo de un archivo que a su vez lo importa a él
  (ciclo de tipos, aunque inofensivo, evitado igual).

**Verificado en vivo**: `Histórico, Ramón` (`debt_status = 'credit'`, el caso
que motivó el fix de B4) ya aparece en `/cobranza/al-dia` con el pill "Saldo
a favor" y el monto — junto con `Ejemplo, Lucía` y `Prueba, Joaquín`, que
quedaron con saldo a favor por los pagos de la verificación anterior. Las
tres pantallas (`/cobranza/al-dia`, `/cobranza/deuda`, y el hub) cargan sin
errores de consola. No pude ejercer el botón "Ver más" con datos reales
porque el seed local tiene bien por debajo de 200 socios en cada bucket (el
`Pagination` no renderiza el botón cuando `nextCursor` es `null`); la
Server Action y el componente están armados exactamente contra la firma que
publicó B4 y pasan `tsc`/`eslint` limpios.

## Pendientes / dependencias cruzadas (para el code-reviewer)

1. **`RegisterPaymentSheet` no tiene consumidor propio en este pipeline**
   (ver arriba): typecheck/lint limpios, pero no lo ejercité manualmente
   porque nada lo monta todavía. Si F2 lo usa, vale la pena una pasada de
   humo específica antes de dar el slice por cerrado.
2. **Quirk visual preexistente, no mío**: `SearchInput` (shared) muestra DOS
   íconos de "limpiar" superpuestos cuando hay texto (el botón `X` propio del
   componente + el "clear" nativo de `<input type="search">` en Chromium). Lo
   vi al usar el buscador del hub; es un comportamiento del primitivo
   compartido (`views/shared/search-input.tsx`), no algo que F1 introdujo ni
   puede tocar.
3. No se creó ningún usuario `editor` en el seed local para la prueba
   manual de "editor no ve Anular" — se razonó por permisos (ver arriba) en
   vez de mutar `/usuarios` fuera de mi lane.
4. **"Ver más" de `/cobranza/deuda`/`/al-dia` sin ejercer con datos reales**
   (ver "Fixes post-entrega" arriba): la firma está armada exactamente contra
   lo que publicó B4 y pasa `tsc`/`eslint`, pero el seed local no tiene
   suficientes socios en ningún bucket para que `Pagination` muestre el
   botón. Si el `test-engineer` o el `code-reviewer` quieren forzarlo, alcanza
   con insertar >200 filas de `member_accounts` en un mismo `debt_status` (o
   llamar `loadMoreMemberAccounts` directo con un `cursor` fabricado) y
   confirmar que acumula sin duplicar ni perder filas.
