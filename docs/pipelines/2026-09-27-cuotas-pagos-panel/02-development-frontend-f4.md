# 02 — Desarrollo frontend F4: Ajustes (valores de cuota y activación), etiquetas de auditoría

Agente: `frontend-react-craftsman`, lane `frontend`, tarea **F4** de `01-tasks.md`
(líneas ~1043 en adelante), con `00-architecture.md` §6.1, §6.4, §6.5, §6.8,
§8.2/§8.3, §9 y §10 (brief de `/ajustes`) como contrato. Arrancó después de que
`ResponsiveSheet` (`views/shared/`) y el resto de los sheets de `/ajustes` ya
estaban migrados a ese primitivo (confirmado leyendo `category-form-sheet.tsx`
y `discipline-form-sheet.tsx` antes de escribir nada).

## Archivos tocados (todos dentro de mi ownership declarado)

- `src/views/audit/audit-labels.ts` — modificado.
- `src/views/settings/new-fee-price-sheet.tsx` — nuevo.
- `src/views/settings/fee-prices-section.tsx` — nuevo.
- `src/views/settings/activate-billing-sheet.tsx` — nuevo.
- `src/views/settings/billing-section.tsx` — nuevo.
- `src/views/settings/billing-runs-list.tsx` — nuevo.
- `src/views/settings/settings-page-view.tsx` — modificado (compone los dos
  paneles nuevos entre "Disciplinas y categorías" y "Datos del club").
- `src/views/settings/club-settings-form.tsx` — modificado (solo el
  comentario de cabecera, quedaba desactualizado: decía "no hay nada de
  cuotas que mostrar todavía", que ya no es cierto).
- `src/app/(panel)/(admin)/ajustes/page.tsx` — modificado (pasa
  `categoriesByDiscipline`, `feePrices`, `billing` a la vista).
- `src/app/(panel)/(admin)/ajustes/loading.tsx` — modificado (agrega el
  esqueleto de los dos paneles nuevos, para que el fallback de Suspense no se
  quede corto contra lo que va a aparecer).

No toqué `views/shared/**`, `views/shell/**`, ningún `.model.ts`/`.controller.ts`/
`.actions.ts`, `supabase/**` ni `tests/**`.

## `audit-labels.ts`: qué faltaba y qué agregué

El `AuditedTable` de `types.ts` ya incluye `member_categories` (lo agregó B1/S0
del hilo principal), pero este archivo tenía `ENTITY_LABELS: Record<AuditedTable,
string>` — un `Record` completo, no `Partial` — sin la clave
`member_categories`: eso es lo que rompía `npm run typecheck` ("Property
'member_categories' is missing…"). `AUDITED_TABLE_OPTIONS` y `ENTITY_LABELS`
para `fee_prices`/`fees`/`payments` ya estaban (alguien los agregó en paralelo
antes de que yo entrara), pero les faltaba una entrada en `FIELD_LABELS`.

Hice:

- `AUDITED_TABLE_OPTIONS`: sumé `{ value: 'member_categories', label:
  'Inscripciones a categorías' }` (el filtro de tabla de `/auditoria`).
- `ENTITY_LABELS`: sumé `member_categories: 'una inscripción a categoría'`
  (esto es lo que arregla el typecheck).
- `FIELD_LABELS`: sumé las cuatro entradas que faltaban —
  `member_categories`, `fee_prices`, `fees`, `payments` — con el MISMO texto
  que `AUDIT_FIELD_LABELS` en `src/models/audit.model.ts` (B2 ya las había
  escrito ahí y dejó un comentario explícito pidiendo que se copien o
  importen). **No las importé**: `views/audit/audit-labels.ts` está bajo
  `src/views/**`, y `eslint.config.mjs` prohíbe que `src/views/**` importe
  `@/models/*.model` o `@/models/**/*.model` (regla `NO_DATA_FETCHING_IN_VIEWS`,
  línea ~41) — `audit.model.ts` cae exactamente en ese patrón. Verifiqué el
  glob antes de decidir, no asumí. Quedó documentado con un comentario en el
  archivo mismo señalando el porqué de la duplicación, para que quien la lea
  no piense que es un descuido.
- No agregué una entrada en `RECORD_PHRASE` para ninguna de las cuatro tablas:
  `fee_prices`/`fees`/`payments` ya estaban sin una (el fallback de
  `auditRecordPhrase` devuelve el `recordLabel` compuesto tal cual, que ya
  trae todo lo necesario — ver `audit.model.ts:finalizeLabel`, casos
  `needsMemberFeeLabel`/`needsFeePriceLabel`/`needsMemberPaymentLabel`/
  `needsMemberCategoryLabel`, todos arman una frase completa con socio, monto
  y período/categoría). Seguí la misma convención para `member_categories`
  por consistencia, no por omisión.

## Panel "Valores de cuota" (`fee-prices-section.tsx` + `new-fee-price-sheet.tsx`)

- Vigentes: "Por defecto", "Por tipo de socio" (si hay) y "Por categoría"
  **agrupadas por disciplina** (usa `disciplines`, que llega con TODAS —
  incluidas inactivas— para poder seguir etiquetando un valor de una
  categoría que el club dio de baja después: nada se borra). El selector de
  categoría del sheet usa en cambio `categoriesByDiscipline` (solo activas):
  no tiene sentido fijar un precio nuevo para algo ya dado de baja.
- "Próximos" (`feePrices.upcoming`) y "Historia" (`feePrices.history`,
  plegada con `<details>`) usan una etiqueta plana con el nombre de
  disciplina antepuesto para categorías ("Fútbol femenino · Juveniles"), para
  no repetir el problema que ya evitaba `audit-labels.ts` con nombres de
  categoría duplicados entre deportes (p. ej. "Sub 18" existe en fútbol y en
  vóley).
- Sin valor por defecto: `EmptyState` que explica el orden de carga (D18) y
  ofrece "Cargar valor por defecto", que abre el mismo sheet.
- `NewFeePriceSheet`: scope → campo dependiente (tipo de socio o categoría,
  con `useWatch` para no re-renderizar el form entero — mismo patrón que
  `member-form.tsx`/`payment-form.tsx`, no `form.watch()`, que además tira un
  warning de "React Compiler: incompatible library" en lint) → `AmountField`
  → "Aplica desde". Reescribí el Zod schema del sheet en vez de importar
  `createFeePriceSchema` de `fee-prices.model.ts` (mismo motivo de capas que
  arriba: un Client Component no puede importar un `.model.ts`, y
  `TextField`/`SelectField` ya vienen así en el resto de `/ajustes` —
  `category-form-sheet.tsx` hace lo mismo con `catalogs.model.ts`). El
  `superRefine` repite el CHECK `fee_prices_scope_shape` en el cliente para no
  ir al servidor solo por eso.
- "Aplica desde": el mes actual entra a la lista SOLO si
  `billing.lastGeneratedPeriod` todavía no llegó al mes actual (si ya lo
  alcanzó o pasó, arranca en el siguiente) — es el mismo cálculo que hace el
  trigger `fee_prices_insert_guard`, reproducido en el cliente para no
  ofrecer una opción que el servidor va a rechazar seguro. Los errores del
  trigger (mes pasado / mes ya generado con otro valor) llegan con `field:
  'validFrom'` y se pintan inline bajo ese campo con `form.setError` —
  **probado en vivo** (ver "Verificación"), no solo leído en el modelo.

## Panel "Cuotas" (`billing-section.tsx` + `activate-billing-sheet.tsx` + `billing-runs-list.tsx`)

- Sin activar: texto que explica el orden (valor por defecto → activar) +
  "Activar cuotas" deshabilitado con el motivo escrito si falta el valor por
  defecto (`hasDefaultFeePrice`, calculado en `settings-page-view.tsx` como
  `feePrices.current.default !== null` y pasado como prop — no repetí la
  cuenta adentro de `BillingSection`).
- Activada: "Activas desde <mes>", "Último mes generado", el aviso T1
  (`currentPeriodRun === 'failed' | 'missing'`) con el mensaje de
  `lastRun.errorMessage` (o uno genérico para `missing`, que no tiene fila
  que traiga mensaje) y "Reintentar"; si no hay aviso pero sí
  `pendingPeriods.length > 0`, "Generar cuotas ahora (N pendientes)". Ambos
  botones llaman a la MISMA action, `generatePendingFees()` — no hay una
  action separada para "reintentar" (no la necesitaba, ya la había según B1).
- "Últimas corridas" (`billing-runs-list.tsx`) vive FUERA del `if`
  activa/inactiva: el cron deja una fila `skipped` aunque la facturación no
  esté activa (`00-architecture.md` §6.4), así que la lista tiene que poder
  mostrar eso incluso antes de activar. Reusa las variantes de `StatusPill`
  que ya existen (`up-to-date`/`in-debt`/`member-inactive`) para
  ok/error/skipped en vez de inventar una variante nueva en `status-pill.tsx`
  (no es mío en esta tarea).
- `ActivateBillingSheet`: mes (actual + 12 futuros, con `periodRange` de
  `lib/dates.ts`) + resumen. El resumen usa `billing.activeMembers` como
  aproximación de "cuántos van a recibir cuota" — **no** es un conteo exacto
  de cuotas (un socio con dos deportes recibe dos cargos), y no hay ninguna
  RPC de "preview" en los contratos de B1 para calcularlo exacto sin
  ejecutar la generación. Elegí decir "para los N socios activos" en vez de
  "N cuotas" para no prometer un número que puede no coincidir con lo que
  después dice el toast (que sí es exacto, viene de `activateBilling()`).
  Documento esto porque `01-tasks.md` cita literalmente 'resumen "Se van a
  generar N cuotas de <mes>"' y me aparté un poco de esa redacción exacta a
  propósito.

## Decisión: sin `session.permissions` en las vistas de esta tarea

`00-architecture.md` §9 dice que toda lectura nueva de esta página va detrás
de `billing.configure`, y CLAUDE.md pide no ocultar solo con UI. Ya está así:
`getSettingsPage()` (B1) exige `requirePanelPermission('settings.manage')`, y
las tres actions de `billing.actions.ts` exigen
`requirePermission('billing.configure')` — más el layout de `(admin)` del
slice 1 (rol `admin`). Hoy, con el mapeo fijo de `private.permissions_for_role`,
`billing.configure` y `settings.manage` los tiene únicamente `admin`, que es
exactamente quien ya puede entrar a `/ajustes`. No agregué un prop
`permissions`/`session` a `SettingsPageView` ni a los paneles nuevos porque no
hay ningún elemento que deba esconderse de alguien que ya llegó hasta acá: no
hay una segunda audiencia con menos permisos viendo esta page hoy. El resto de
`/ajustes` (disciplinas y categorías) tampoco lo hace. Si el pipeline de roles
configurables (T12) alguna vez separa `settings.manage` de `billing.configure`
en dos roles distintos, ahí sí hace falta threadear permisos hasta acá — hoy
sería especulativo sin un caso real que atender.

## Verificación

- `next dev` ya corría en `http://localhost:3000` (compartido, no lo toqué ni
  levanté otro). Login `admin@lonqui.test` / `lonqui-dev-1234`.
- Capturas con Playwright a 390×844 y 1440×900 (mismo patrón que
  `scripts/capture-screens.mjs`, pero en un script temporal en mi scratchpad
  — lo borré al terminar, no quedó nada en `scripts/`): `/ajustes` completo,
  con "Historia" y "Últimas corridas" desplegadas, el sheet "Nuevo valor de
  cuota" abierto (sheet desde abajo en 390, diálogo centrado en 1440).
- **Probé un valor futuro de verdad**: creé un valor "Por defecto" para
  septiembre de 2027 desde la UI real (no un mock) → apareció al toque en
  "Próximos", en la historia, con el toast "Valor de cuota creado". **Esta
  fila queda en la base de desarrollo compartida**: `fee_prices` es
  append-only (`forbid_change` bloquea `UPDATE`/`DELETE` incluso para
  `postgres`, confirmado por B1) — no hay forma de borrarla sin una
  migración, así que no lo intenté. Es una fila real con `amount_cents =
  1150000`, `scope = default`, `valid_from = 2027-09-01`: no afecta ninguna
  cuota actual ni ningún test (está 12 meses en el futuro), pero lo dejo
  anotado para que no sorprenda a nadie que mire `fee_prices` en la base
  local.
- **Probé el rechazo de un mes ya generado**: parcheé temporalmente
  `buildValidFromOptions` (una línea, revertida antes de terminar — ver el
  diff final del archivo, no quedó rastro) para poder elegir "septiembre
  2026" (ya generado) desde el desplegable, mandé el formulario, y confirmé
  que el mensaje del trigger — *"Las cuotas de 09/2026 ya se generaron con
  otro valor; el nuevo aplica desde 10/2026"* — aparece inline bajo "Aplica
  desde", con el campo en rojo. Con la lógica real (sin el parche) ese mes ni
  siquiera aparece en el desplegable, así que un usuario real nunca ve el
  mensaje del trigger para ESE caso puntual — pero confirma que el camino
  `DomainError({field:'validFrom'})` → `form.setError` funciona de punta a
  punta, que es lo que importa (el mismo camino se usa para "mes pasado",
  que si es alcanzable desde la UI si alguien deja el sheet abierto mucho
  tiempo y cambia el mes).
- **No pude probar en vivo** el estado "cuotas no activadas" (`BillingSection`
  con `!billing.active`, el sheet `ActivateBillingSheet` completo end-to-end,
  ni el aviso de corrida fallida/ausente): el seed de este pipeline ya activa
  la facturación desde el mes actual (confirmado en la tarea), y
  `settings_billing_guard` prohíbe volver `billing_start_period` a `null` una
  vez fijado — sin excepción de rol, es la misma regla incondicional que
  `fee_prices.forbid_change`. Mutar eso a mano para probar y no poder
  revertirlo habría dejado la base de desarrollo compartida en un estado que
  otros agentes (F1/F2/F3, o quien reset la corra después) no esperan.
  Verificado por lectura de código en cambio: `BillingSection` reusa
  exactamente las mismas piezas ya probadas en vivo (`ResponsiveSheet`,
  `SelectField`, `useWatch`, el mismo patrón de `form.setError` con
  `result.field`), y `activateBilling()`/`generatePendingFees()` ya están
  verificados a nivel modelo por B1 (su dev log detalla las cuatro
  traducciones de `settings_billing_guard`). Si el test-engineer necesita
  este camino cubierto con capturas reales, va a hacer falta un ambiente
  separado (o un `db:reset` con un seed sin activar), no algo que yo debiera
  forzar sobre el compartido.
- `npm run typecheck`: sin errores en `views/settings/**`, `views/audit/
  audit-labels.ts` ni `app/(panel)/(admin)/ajustes/**` (hay errores
  preexistentes en `views/members/**`, `member-form.tsx` y
  `tests/models/members.model.writes.test.ts` de agentes en paralelo — no
  son míos, no los toqué).
- `npx eslint` sobre mis archivos: limpio. Encontré y corregí dos warnings de
  `react-hooks/incompatible-library` (usaba `form.watch()` en vez de
  `useWatch({ control, name })`, que es el patrón que ya usa el resto del
  repo — `payment-form.tsx`, `member-form.tsx`, etc.).
- `web-design-guidelines`: revisé accesibilidad (roles nativos de
  `<details>`/`<summary>` para lo plegado, sin ARIA extra necesaria; `role="alert"`
  en el aviso de corrida; labels asociados), animación (agregué
  `motion-reduce:transition-none` a los dos chevrones que roto — el repo ya
  tiene un chevron igual sin ese guard en `views/dashboard/padron-rows.tsx`,
  de otro agente en paralelo; el mío lo cubre, ese no es mío para tocar),
  tipografía (numerales tabulares vía `Amount`, formato de mes vía
  `formatPeriod`, nada armado a mano), truncamiento (`truncate` en las
  etiquetas largas de `FeePriceRow`, mismo patrón que `DisciplineGroup`).

## Primitivas: ninguna nueva en `views/shared/`

No hice falta crear nada en `views/shared/` — `ResponsiveSheet`, `AmountField`,
`SelectField`, `Panel`, `EmptyState`, `StatusPill`, `PeriodText`, `DateTimeText`,
`Amount` y `feePriceScopeLabels`/`memberTypeLabels` (en `labels.ts`) ya
cubrían todo. Los ÚNICOS mapas de etiquetas que agregué
(`RUN_STATUS_LABEL`/`RUN_STATUS_VARIANT` en `billing-runs-list.tsx`) son
locales a este archivo, no en `views/shared/labels.ts` (no es mío en esta
tarea): son específicos de `BillingRunStatus`, sin otro consumidor hoy.

## Deferrals / pendientes

- El aviso de corrida fallida/ausente en el **panel inicial** (`/`) es F3, no
  esta tarea (F4 es solo `/ajustes`). `BillingStatus.currentPeriodRun` ya
  está listo para que F3 lo consuma igual que acá.
- No agregué un campo `notes` en `NewFeePriceSheet` aunque el modelo lo
  acepta (`FeePriceInput.notes`): ni `01-tasks.md` ni el brief de §10
  mencionan un campo de notas en el sheet ("scope → campo dependiente,
  `AmountField`, 'Aplica desde'"), y agregarlo alargaba un formulario que
  tiene que ser rápido en el celular. Si el club lo pide, es un campo
  opcional más en el mismo form.
- Cobertura visual de "no activada"/aviso de corrida: ver nota de
  verificación arriba — pendiente de un ambiente que no sea el compartido.
