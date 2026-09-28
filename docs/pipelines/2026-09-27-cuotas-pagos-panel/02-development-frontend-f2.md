# 02 — Desarrollo frontend F2: alta/edición con deportes, ficha con deportes y estado de cuenta, padrón con categorías y filtro de deuda

Agente: `frontend-react-craftsman` (F2). Tarea: `01-tasks.md` sección **F2**, contra
`00-architecture.md` §10 y **§13.6** (Revisión 3). Leí `02-development-backend-b3.md`
(y `-b2.md`) antes de tocar nada: fijan los contratos (`MemberPageData`,
`MemberCategoryRef`/`MemberCategoryMembership`, las actions nuevas) que consumo acá.

## Archivos tocados (todos dentro de mi ownership declarado)

Nuevos en `src/views/members/`:
- `category-selector.tsx` — "Deportes y categorías" del alta/edición: radios agrupados
  por disciplina (con "Ninguna"), value = `categoryIds: number[]`.
- `leave-category-dialog.tsx` — "Dar de baja de `<categoría>`", motivo **opcional**.
- `change-category-dialog.tsx` — "Cambiar de categoría" (ascenso, misma disciplina).
- `add-category-dialog.tsx` — "Agregar deporte" (disciplina sin inscripción abierta).
- `member-categories-section.tsx` — `Panel` "Deportes" de la ficha: abiertas + acciones +
  historia plegada (`<details>`).
- `member-account-section.tsx` — `Panel` "Cuenta" arriba del todo: estado, último pago,
  "Registrar pago"/"Pago del grupo" (links a `/cobranza/nuevo`), "Cargar saldo anterior".
- `member-fee-statement.tsx` — `Panel` "Cuotas" (statement, anular con `payments.void`).
- `member-payments-list.tsx` — `Panel` "Pagos" (comprobante bajo demanda, anular).

Modificados:
- `member-form.tsx` — reemplaza `memberType`/`disciplineId`/`categoryId` por
  `CategorySelector` + `categoryIds`; en edición agrega "A partir de" y la consecuencia
  escrita cuando la selección cambió, y un segundo llamado a `setMemberCategories`
  después de `updateMember`.
- `member-detail-view.tsx` — recibe `MemberPageData` + `disciplines` + `permissions`
  (no `role`); arma encabezado + Cuenta + Datos personales + Grupo familiar + Apto físico
  + Deportes + Cuotas + Pagos + Historia.
- `member-list.tsx` / `member-list-view.tsx` — `categories: MemberCategoryRef[]` en vez
  de `categoryName`/`disciplineName`; filtro de deuda habilitado según `billing.active` y
  `payments.read`; `canCreate` por permiso.
- `src/app/(panel)/socios/page.tsx` — parsea `debt` de la URL; llama
  `getBillingStatus()` directo (lectura plana de `billing.model.ts`, sin controller, como
  pide la tarea) y pasa `billing` + `session.permissions` a la vista.
- `src/app/(panel)/socios/[id]/page.tsx` — pasa `data: MemberPageData` +
  `disciplines` (para los selects del panel Deportes) + `permissions`.
- `src/app/(panel)/socios/[id]/editar/page.tsx` — `getMemberPage` ahora devuelve
  `MemberPageData`: pasa `data.member` al formulario; gate por `members.write`.
- `src/app/(panel)/socios/nuevo/page.tsx` — gate por `members.write` (permiso, no rol).

No toqué `views/shared/**`, `views/shell/**`, `views/payments/**`, backend, `supabase/**`,
`tests/**`. Sí **importo** (sin editar) `@/views/payments/account-format` —
`categoriesLabel`/`accountLineText`, funciones puras de formato que F1 ya expone para el
mismo texto ("Fútbol masculino · 5ta, Vóley · Sub 18", "Debe $X · N meses") — para no
duplicar la lógica entre el padrón/ficha (F2) y el formulario de pago (F1). Es composición
de un módulo hermano, no una edición de su archivo.

## Decisiones y trade-offs

1. **`ReasonDialog` no sirve para "Dar de baja de `<categoría>`".** El shared
   `ReasonDialog` (`views/shared/reason-dialog.tsx`) exige motivo obligatorio (mínimo 3
   caracteres) — correcto para anular pagos/cuotas y para baja/reactivación de socio,
   pero §13.6 pide motivo **opcional** para dejar una categoría. En vez de tocar el
   shared (fuera de mi alcance) armé `LeaveCategoryDialog` en `views/members/`,
   componiendo los mismos primitivos (`Dialog`, `DateField`, `TextareaField`) con el
   mismo patrón de confirmación. Anoto esto como candidato a promover a
   `views/shared` con un flag `reasonRequired` si otra pantalla necesita lo mismo — no
   lo hice yo porque no me toca decidir la forma final de un primitivo compartido desde
   un caso de uso.

2. **"Registrar pago" / "Pago del grupo" son links a `/cobranza/nuevo`, no un
   componente embebido.** `01-tasks.md` F2 lo especifica así textualmente
   (`?socio=<id>&volver=/socios/<id>` y `?grupo=<id>&volver=`), y F1 construyó en
   paralelo `views/payments/register-payment-sheet.tsx` (`RegisterPaymentSheet`) como
   una alternativa embebible — su propio comentario dice explícito que el flujo
   aprobado en `00-architecture.md`/`01-tasks.md` es el link, y que el sheet "queda
   como alternativa documentada por si F2 prefiere no navegar afuera de la ficha; no
   tiene su propio caso de uso probado en este pipeline". Me quedé con el link: es lo
   que pide la tarea, es lo que ya construye `/cobranza/nuevo` (page.tsx de F1), y no
   agrega una segunda forma de hacer lo mismo sin que la Comisión lo haya pedido. Si
   más adelante se decide que "no salir de la ficha" es mejor, cambiar el botón por
   `<RegisterPaymentSheet memberId={member.id} />` es un cambio de una línea en
   `member-account-section.tsx` (el punto de montaje detrás de `payments.register` ya
   existe: el bloque entero de botones está gateado por `canRegister`).

3. **`describeCategoryChanges` compara por DISCIPLINA, no por categoría**, para no
   mostrar "Deja fútbol" + "Empieza fútbol" cuando en realidad es un ascenso 5ta→6ta
   hecho desde el formulario en bloque (en vez de "Cambiar de categoría" de la ficha).
   Coincide con §13.4 punto 4: cambiar de categoría dentro del mismo deporte "no cobra
   nada extra", así que no hace falta consecuencia para ese caso — solo cuando un
   deporte completo se agrega o se deja.

4. **Bug de backend encontrado y mitigado defensivamente**: `accounts.model.ts`
   (`mapStatementRow`, B2) siempre devuelve `FeeStatementLine.disciplineName = null`,
   incluso para cargos mensuales con `categoryId` no nulo (el comentario del código dice
   que es null "en la cuota social y el saldo anterior", pero el código lo pone null
   siempre). Sin el guard, la ficha mostraba literalmente "septiembre 2026 null · 5ta".
   `lineLabel` en `member-fee-statement.tsx` cae a mostrar solo la categoría cuando
   `disciplineName` es null, así que hoy se ve "5ta" en vez de "Fútbol masculino · 5ta"
   para las cuotas por deporte — funciona, pero **no es lo que pide §13.5** ("cada línea
   trae `category_name`/`discipline_name` del cargo"). Reportado para que B2 (o quien
   corrija) complete `disciplineName` resolviendo la disciplina de `categoryId` en
   `resolveCategoryNames`/`mapStatementRow`; mi guard queda igual (no hace daño una vez
   corregido, simplemente deja de activarse).

5. **`member-account-section.tsx` usa `account.status` (`MemberAccount.status`), no un
   prop `memberStatus` aparte** — ya viene en el tipo, evita un prop redundante.

## Contratos consumidos (fijados por B3/S0, no los toqué)

`MemberPageData`, `MemberDetail.categories`/`.categoryHistory`, `MemberSummary.categories`,
`MemberAccountDetail` (`account`/`statement`/`payments`/`openingBalance`),
`MemberCategoryRef`, `MemberCategoryMembership`, `CreateMemberInput.categoryIds`,
`SetMemberCategoriesInput`, `LeaveCategoryInput`, `ChangeCategoryInput` (de
`member-categories.model.ts`, re-exportado vía las actions), `BillingStatus`. Actions:
`setMemberCategories`, `leaveCategory`, `changeCategory` (B3, `members.actions.ts`);
`createOpeningBalance`, `voidFee`, `voidPayment`, `getReceiptUrlAction` (B2,
`payments.actions.ts`).

## Comportamientos de usuario implementados (acceptance criteria de F2)

- **`/socios/nuevo` y `/socios/[id]/editar`**: sección "Deportes y categorías" con
  radios por disciplina (target 44 px, opción "Ninguna"), texto "Si no practica ningún
  deporte, queda como socio no practicante y paga la cuota social"; en edición, si la
  selección cambió respecto de la inicial, aparece "A partir de" (default hoy, no
  futura, obligatoria) con la consecuencia escrita por deporte agregado/dejado; si
  `updateMember` (datos personales) sale bien pero `setMemberCategories` falla, se
  avisa con un toast de error y no se pierde el guardado ya hecho (verificado
  manualmente: ver abajo).
- **`/socios/[id]`**: encabezado con `categoriesLabel(member.categories)` ("Fútbol
  femenino · Primera, Vóley · Sub 18" / "No practicante"); `Panel` "Cuenta" con
  `DebtStatusPill` + `accountLineText`, último pago, "Registrar pago"/"Pago del grupo"
  (gateados por `payments.register`), "Cargar saldo anterior" (gateado por
  `payments.register` + `billing.active` + sin uno vigente; si ya hay uno, muestra el
  monto en vez del botón); `Panel` "Deportes": inscripciones abiertas con "desde
  `<fecha>`", "Cambiar de categoría" (solo si la disciplina tiene más de una
  categoría), "Dar de baja de `<categoría>`" (motivo opcional), "Agregar deporte"
  (solo disciplinas sin inscripción abierta), historia plegada con TODA la
  pertenencia (categoría, desde, hasta, motivo, quién); `Panel` "Cuotas" (una línea
  por cargo, anuladas tachadas con motivo, "Anular" solo `payments.void`); `Panel`
  "Pagos" (comprobante bajo demanda vía URL firmada de 60 s, "Anular" solo
  `payments.void`); ambos paneles ausentes si `account` viene `null` (sin
  `payments.read`).
- **`/socios`**: columna/meta de categoría con la lista completa por socio; filtro
  "Condición de deuda" habilitado cuando `payments.read` **y** `billing.active`
  (con el motivo explicado cuando no); `Amount`/`DebtStatusPill` en cada fila con
  `payments.read`.
- **Accesibilidad**: la línea de cuenta es texto real (`<p>`), no solo color; pagos y
  cuotas anulados usan `<s>` + texto "Anulado"; radios con `<label htmlFor>` real
  (hit target de la fila completa); nunca la palabra "eliminar" en ningún string.
- **Permisos, no roles (T12)**: todo lo condicional en estas vistas lee
  `session.permissions.includes(...)` (`members.write`, `members.status`,
  `payments.register`, `payments.void`, `payments.read`) — migré también las pages de
  slice 1 (`nuevo`, `editar`, `[id]`) que todavía chequeaban `role === 'admin' ||
  role === 'editor'`.

## Verificación manual (Playwright contra el `next dev` compartido de :3000)

No usé `scripts/capture-screens.mjs` tal cual (hace su propio `build && next start` en
:3210; la tarea pedía no levantar otro servidor) — escribí un script ad-hoc con el mismo
patrón (`chromium`, locale/timezone `es-AR`, 390×844 y 1440×900) apuntando a
`http://localhost:3000`, lo corrí desde la raíz del repo para que Node resuelva
`playwright` de `node_modules`, y lo borré al terminar (no quedó en el repo).

- **390 y 1440, sin scroll horizontal** en `/socios`, `/socios?categoryId=12`,
  `/socios?debt=in_debt`, `/socios/nuevo`, `/socios/5`, `/socios/4`,
  `/socios/4/editar`, `/socios/6` (`document.documentElement.scrollWidth <=
  clientWidth`, verificado por script).
- **Padrón filtrado por categoría** (`categoryId=12`, Vóley · Sub 18): devuelve solo a
  Valentina Ficticia, y la fila muestra SUS DOS deportes ("Fútbol femenino · Primera,
  Vóley · Sub 18"), no solo el que matcheó — confirma que el doble embed de B3
  funciona también del lado de la UI.
- **Padrón filtrado por deuda** (`debt=in_debt`): excluye a Histórico, Ramón (saldo a
  favor) y a los al día; el filtro aparece habilitado (billing activo en el seed).
- **Ficha de Valentina Ficticia (dos deportes simultáneos)**: encabezado, Deportes y
  Cuotas muestran sus dos inscripciones (Fútbol femenino · Primera + Vóley · Sub 18)
  con una línea de cuota por cada una.
- **Ficha de Joaquín Prueba (ascendió 6ta→5ta)**: edición precarga "5ta" seleccionado;
  cambiar a "6ta" sin guardar muestra la sección "A partir de" + consecuencia (no
  guardé el cambio, para no tocar el fixture del seed que otros agentes usan de
  referencia).
- **Ficha de Sofía Inventada (dejó el fútbol)**: encabezado "No practicante"; Deportes
  muestra "No practica ningún deporte. Paga la cuota social." + Historia plegada con
  "Fútbol femenino · Primera / Desde 10/01/2026 hasta 31/08/2026 / Motivo: Dejó de
  jugar"; Cuotas muestra "Cuota social" (con el bug #4 de arriba ya mitigado); Pagos
  muestra un pago **anulado** tachado con motivo ("Anulado · Cargado dos veces") — el
  piso de "nada se borra" se ve andando con datos reales del seed.
- **Alta con dos deportes (dato nuevo, creado en local)**: creé un socio de prueba
  "DosDeportes, F2Test" (DNI 30999111, id **16** en la base local) con Fútbol
  masculino · 8va + Vóley · Sub 19. La ficha mostró ambos correctamente.
- **Cambio de categoría** (sobre el socio de prueba): "Cambiar de categoría" en
  Fútbol masculino de 8va → 9na actualizó la ficha sin tocar la inscripción de Vóley.
- **Baja de un deporte sin motivo** (sobre el socio de prueba): "Dar de baja de Sub
  19" con el campo de motivo vacío cerró el diálogo y quitó a Vóley del encabezado —
  confirma que el motivo es realmente opcional de punta a punta (UI → action →
  `leaveCategory` → RPC).
- **Agregar deporte**: el diálogo ofrece únicamente disciplinas sin inscripción
  abierta (tras la baja de Vóley, "Vóley" volvió a aparecer en el select).

Dato dejado en la base local (no se resetea, no se borra): socio id 16, "F2Test
DosDeportes", DNI `30999111`, hoy en Fútbol masculino · 9na (sin Vóley, se dio de
baja durante la prueba). Es un socio de prueba, no un fixture con nombre real.

## Typecheck y lint

- `npx tsc --noEmit -p .`: limpio en todo `src/**` (incluidos mis archivos y el resto
  del repo). Quedan errores en `tests/models/members.model.writes.test.ts` (usa el
  `CreateMemberInput` viejo, `memberType` sin `categoryIds`) — no son míos, los
  actualiza `test-engineer` con el contrato nuevo; no toqué `tests/**`.
- `npx eslint src/views/members "src/app/(panel)/socios"`: limpio, sin warnings.
- `npm run lint` (repo completo): un error preexistente en
  `src/views/payments/register-payment-sheet.tsx` (F1, `setState` síncrono en un
  efecto) que F1 corrigió en paralelo mientras yo trabajaba — no es mío, no lo toqué.

## Pendientes / follow-ups

1. **Reportar a B2**: `accounts.model.ts` (`mapStatementRow`) no resuelve
   `disciplineName` para los cargos por deporte del statement (siempre `null`); mi
   `lineLabel` lo mitiga mostrando solo la categoría, pero el criterio de §13.5 ("cada
   línea trae `category_name`/`discipline_name`") no se cumple hasta que se corrija el
   modelo.
2. **`LeaveCategoryDialog` es un one-off** con motivo opcional, paralelo a
   `ReasonDialog` (motivo obligatorio). Si otra pantalla necesita la misma variante,
   vale la pena promoverla a `views/shared/reason-dialog.tsx` con un
   `reasonRequired?: boolean` en vez de duplicar un tercer diálogo.
3. **No verifiqué visualmente el renderizado para `editor`/`consulta`** (el seed local
   solo tiene el usuario `admin@lonqui.test`): la ocultación de "Cambiar de
   categoría"/"Dar de baja"/"Agregar deporte"/"Anular"/"Cargar saldo anterior" está
   verificada por lectura de código (todas gateadas por `permissions.includes(...)`,
   nunca por `role`), no por captura de pantalla con esos roles.
4. **`RegisterPaymentSheet` (F1) queda sin usar** desde la ficha, a propósito (ver
   decisión #2 arriba) — el punto de montaje para cambiarlo está en
   `member-account-section.tsx`, detrás de `canRegister`.
