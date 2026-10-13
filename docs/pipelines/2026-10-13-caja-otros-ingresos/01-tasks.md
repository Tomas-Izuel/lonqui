# 01 — Tareas: Caja, otros ingresos, sponsors y conceptos

Deriva de `00-architecture.md` (escrito con las respuestas recomendadas A1–A9;
si Tomás cambia alguna, ajustar la tarea que la cita). Cada tarea declara
**lane**, **archivos que posee en exclusiva** y **archivos que no toca**. Dos
agentes sobre el mismo archivo colisionan en silencio: el corte es por
directorio y es disjunto. Los criterios de aceptación son el spec del
`test-engineer`; lo marcado **[DB]** solo se prueba contra la base local
(`tests/db/`, con `pg`, transacción + rollback por test, claims por rol).

Idioma: comentarios y copy en español rioplatense, identificadores en
inglés. Ningún agente corre `npm install`, toca `supabase/**` ni resetea la
base. Ningún `requireRole`, `has_role`, `is_admin` ni `session.role` en
código nuevo: permisos, siempre. Ningún `createAdminClient()`.

## Orden de ejecución

```
Paso 0  (hilo principal, secuencial)  S1 migración → S2 seed + db:reset + db:types
                                       → SH1 types → SH2 shared → SH3 csv → SH4 redirects
                                       → SH5 briefs → SH6 rename mecánico → typecheck + lint verdes
Paso 1  (paralelo)                     B1 ingresos y sponsors │ B2 conceptos, resumen, auditoría, ajustes
Paso 2  (paralelo, tras B1 y B2)       F1 Caja: hub, pestañas, shell │ F2 ingresos, sponsors, conceptos
Paso 3  (paralelo)                     test-engineer │ code-reviewer
```

B1 y B2 no comparten archivos. B1 importa `getCashMonthSummary` de
`reports.model.ts` (B2) y B2 nada de B1: si B1 arranca antes, escribe contra
la firma de SH1 y `typecheck` cierra cuando B2 aterriza. F1 y F2 no comparten
archivos; F1 monta `IncomeOverlayHost` (F2) en `app-shell.tsx` y F2 importa
`CajaTabs`, `MonthSelector`, `ReceiptPicker` y los helpers de
`receipt-upload.ts` desde `views/payments/**` (F1) sin editarlos. Los
nombres cruzados están fijados abajo.

---

## Lane `schema` — hilo principal

Antes de escribir SQL: skill `supabase-postgres-best-practices`
(`.claude/skills/supabase-postgres-best-practices/references/security-rls-performance.md`,
`security-privileges.md`, `schema-foreign-key-indexes.md`,
`query-partial-indexes.md`) y skill `supabase` (`.claude/skills/supabase/`,
RLS y Storage). Levantar el stack (`npm run db:start`) y, si el MCP responde,
`get_advisors` después de aplicar.

### S1 — `supabase/migrations/20261013120000_cash_other_income.sql`

**Debe contener** exactamente el Anexo A de `00-architecture.md`:
`permissions_for_role` con las 4 claves nuevas; `cash_concepts` (+ semilla
de 5 conceptos con `on conflict do nothing`); `sponsors` + `sponsors_update_guard`;
`cash_movements` + `cash_movements_insert_guard` (DEFINER) +
`cash_movements_update_guard`; policy `attachments_insert` recreada con
`cash-receipts/`; RPC `cash_month_summary`, `sponsor_summaries`;
`log_export` redefinida con `'other_income'`; grants de las RPC; cierre con
`revoke execute on all functions in schema private from public, anon`.

**Aceptación [DB]:**
- Permisos: `my_permissions()` devuelve, por rol, exactamente los arrays del
  Anexo A; `private.can('income.register')` true para admin y editor, false
  para consulta; `can('income.void')` y `can('sponsors.deactivate')` solo
  admin; `can('income.read')` los tres; con `is_active = false` o
  `must_change_password = true` todo false.
- `cash_concepts`: 5 filas sembradas, `Sponsor` con `requires_sponsor`;
  `consulta`/`editor` leen y no insertan ni actualizan; `admin` inserta,
  renombra, desactiva; nombre duplicado en el mismo `direction` (con otra
  capitalización) → 23505; `update direction` → error de inmutabilidad;
  `insert … direction = 'expense'` → CHECK; sin DELETE para nadie.
- `sponsors`: `editor` crea (con `created_by` propio por default) y edita
  nombre/contacto; `consulta` no; nombre duplicado → 23505; `email` en
  mayúsculas → CHECK; `editor` desactiva → `insufficient_privilege`; `admin`
  desactiva sin motivo → "hace falta un motivo"; con motivo → `is_active =
  false`, `deactivated_at/by` fijados por el trigger (`deactivated_by` = el
  admin); reactivar como `admin` → tríada en null; `update
  deactivation_reason` sin cambiar `is_active` → error; `update created_by` →
  inmutable; auditoría con `changed_fields = {deactivated_at, deactivated_by,
  deactivation_reason, is_active}` y actor admin.
- `cash_movements`: `editor` inserta con `created_by` propio; con
  `created_by` ajeno → policy; `direction = 'expense'` → CHECK/policy;
  `occurred_on` mañana (zona club) → "no puede ser futura"; `2019-12-31` →
  "demasiado vieja"; concepto inactivo → "El concepto está desactivado";
  concepto `Sponsor` sin `sponsor_id` → "Elegí el sponsor"; sponsor
  desactivado → "El sponsor está desactivado"; segundo insert con el mismo
  `batch_id` → 23505 `cash_movements_batch_id_key`; `update amount_cents /
  concept_id / occurred_on / description` → inmutable (también como
  `postgres`); anular como `editor` → `insufficient_privilege`; como `admin`
  → `voided_by` = admin, `audit_log.changed_fields = {void_reason, voided_at,
  voided_by}`; anular dos veces → "ya está anulado"; comprobante null→valor
  como `editor` → OK; reemplazarlo / quitarlo / adjuntar a anulado / anular y
  adjuntar en el mismo UPDATE → error; `receipt_storage_path` sin prefijo
  `cash-receipts/` → CHECK; `consulta` lee y no inserta; `authenticated` y
  `service_role` sin DELETE; `service_role` sin INSERT/UPDATE.
- **Las funciones de deuda no cambian**: con el fixture del slice 2 (socio
  con deuda, otro al día, un pago del mes), insertar un `cash_movement` de
  este mes por $50.000 y otro anulado deja **idénticas** las salidas de
  `month_collection(p)`, `daily_collection(p)`, `dashboard_summary()`,
  `debt_by_category()`, `monthly_history(12)`, `member_accounts(null,
  'active')`, `member_fee_statement(id)` y `member_debt_status(members)`
  (comparar `row_to_json` antes y después).
- `cash_month_summary(p)`: `fees_collected_cents` = `month_collection(p).collected_cents`
  siempre; `other_income_cents` suma solo no anulados con `occurred_on` en
  el mes; `total_cents = fees_collected_cents + other_income_cents`;
  `cash_cents`/`transfer_cents` suman pagos **y** movimientos; `by_concept`
  trae una entrada por concepto con movimientos no anulados, ordenada por
  monto desc, `[]` sin movimientos; mes sin nada → todo en cero sin error;
  `consulta` la ejecuta; `anon` no; un usuario sin `income.read` (stub de
  `permissions_for_role` vía `set local` si es viable, si no documentar) →
  `insufficient_privilege`.
- `sponsor_summaries()`: `year_total_cents` solo del año en curso (un
  movimiento del 31/12 del año pasado no cuenta; uno del 1/1 sí),
  `all_time_total_cents` todo, los anulados nunca; `last_contribution_on/
  cents` del más reciente no anulado; sponsor sin aportes → ceros y nulls;
  activos primero y luego por nombre; `(null, <id>)` una sola fila;
  `(2025)` filtra por ese año.
- Storage: `editor` inserta en `storage.objects` con `name =
  'cash-receipts/<uuid>/<uuid>.jpg'`; `consulta` no; `editor` sigue pudiendo
  en `payment-receipts/` y `medical-clearances/`; un prefijo desconocido
  falla para todos.
- `log_export('other_income', '{"mes":"2026-10"}', 3)` como `consulta` deja
  una fila `EXPORT` con `table_name = 'other_income'` y su `actor_id`;
  `'cualquiera'` → error; los seis `listing` anteriores siguen aceptados.
- Lockdown: ninguna tabla nueva otorga DELETE a `authenticated`
  (`allPublicTables`); `keep_alive` sigue siendo la única función de
  `public` ejecutable por `anon`; ninguna función de `private` ejecutable
  por `public`/`anon`; `grep` sobre `pg_get_functiondef`/`pg_policies` de
  los objetos nuevos: cero `has_role`/`is_admin` (salvo la policy de storage
  en los dos prefijos viejos, documentada).

### S2 — Seed, reset y tipos

- `supabase/seed.sql`: Anexo B (sponsors y movimientos inventados).
- `npm run db:reset` y `npm run db:types` (`database.types.ts` con las
  tres tablas y las dos RPC). Verificar con la secret key que `service_role`
  lee las tres tablas (trampa conocida de grants).
- Verificar a mano en el navegador los redirects de SH4 antes de `permanent: true`.

---

## Lane `shared` — hilo principal (contratos; se escriben ANTES de repartir)

### SH1 — `src/models/types.ts`

Agregar, sin cambiar nada existente:

```ts
export type Permission = /* las doce actuales */ | 'income.read' | 'income.register' | 'income.void' | 'sponsors.deactivate'

/** Sentido de un movimiento de caja. Hoy solo 'income'; 'expense' llega con egresos (CHECK en la base). */
export type CashDirection = 'income'

export type CashConcept = { id: number; direction: CashDirection; name: string; requiresSponsor: boolean; isActive: boolean; sortOrder: number }

export type Sponsor = {
  id: number; name: string; contactName: string | null; phone: string | null; email: string | null; notes: string | null
  isActive: boolean; deactivatedAt: ISODateTime | null; deactivationReason: string | null; createdAt: ISODateTime
}

/** Opción del buscador del formulario y de los filtros. */
export type SponsorOption = { id: number; name: string; isActive: boolean }

/** Fila de `sponsor_summaries`. Año = calendario en curso, por `occurredOn`. */
export type SponsorSummary = Omit<Sponsor, 'createdAt'> & {
  yearTotalCents: number; allTimeTotalCents: number; contributionsCount: number
  lastContributionOn: ISODate | null; lastContributionCents: number | null
}

export type CashMovement = {
  id: number; direction: CashDirection; conceptId: number; conceptName: string
  sponsorId: number | null; sponsorName: string | null
  amountCents: number; occurredOn: ISODate; method: PaymentMethod
  hasReceipt: boolean; receiptFilename: string | null; description: string | null
  batchId: string; createdByName: string | null; createdAt: ISODateTime
  voidedAt: ISODateTime | null; voidReason: string | null; voided: boolean
}

export type CashConceptTotal = { conceptId: number; conceptName: string; amountCents: number; count: number }

/** Una fila de `cash_month_summary`. `feesCollectedCents` es la MISMA cifra que `MonthCollection.collectedCents`. */
export type CashMonthSummary = {
  period: ISODate; totalCents: number; feesCollectedCents: number; otherIncomeCents: number
  cashCents: number; transferCents: number; feesCents: number; feesCount: number
  paymentsCount: number; otherIncomeCount: number; byConcept: CashConceptTotal[]
}

export type CashMovementFilters = { period: ISODate; conceptId?: number; sponsorId?: number }

/** Lo que necesita el formulario de otro ingreso: solo lo activo. */
export type IncomeFormData = { concepts: CashConcept[]; sponsors: SponsorOption[] }

export type SponsorDetail = { sponsor: SponsorSummary; movements: CashMovement[] }

/** Lista cerrada de `log_export` (la base la vuelve a validar). */
export type ExportListing = 'members' | 'debt' | 'up_to_date' | 'debt_by_category' | 'month_payments' | 'audit' | 'other_income'

export type AuditedTable = /* las doce actuales */ | 'cash_concepts' | 'sponsors' | 'cash_movements'
```

### SH2 — `src/views/shared/**`

- `overlay-params.ts`: `OverlayName = 'pagar' | 'ver' | 'ingreso'`;
  `OVERLAY_NAMES` con los tres; re-exportar lo nuevo de `overlay-values.ts`.
- `overlay-values.ts`: `IncomeOverlayTarget = { mode: 'nuevo'; sponsorId?: number }`;
  `parseIncomeOverlay(value: string | null): IncomeOverlayTarget | null`
  (`'nuevo'` → `{ mode: 'nuevo' }`, `'sponsor:<id>'` → `{ mode: 'nuevo', sponsorId }`,
  otra cosa → `null`); `incomeOverlayValue(target)`.
- `success-moment.tsx` (nuevo): `SuccessMoment({ amountCents, label })`,
  copia de `PaymentSuccessMoment` de `register-payment-sheet.tsx` con el
  texto parametrizado. F1 puede reemplazar el original por este (opcional).
- `reason-dialog.tsx`: prop opcional `showDate?: boolean` (default `true`);
  con `false` no renderiza ni valida `effectiveOn` (el schema pasa a
  `effectiveOn` opcional cuando está oculto). Firma de `onConfirm` sin cambios.
- `hero-figure.tsx`: solo el comentario: "una por pantalla, con la excepción
  explícita de `/caja` (brief 2026-10-13: dos cifras de igual peso)".
- `labels.ts`: nada nuevo (medios de pago y `auditOpLabels` se reusan).

**Aceptación (unidad):** `parseIncomeOverlay('nuevo')`, `('sponsor:12')`,
`('sponsor:0')` → null, `('socio:1')` → null; abrir `ingreso` quita `pagar` y
`ver` de la URL (mismo test que hoy para `pagar`); `ReasonDialog` con
`showDate=false` confirma solo con motivo.

### SH3 — `src/lib/csv.ts`

`toCsv(rows: readonly (readonly (string | number | null)[])[], options?: { separator?: ';' | ','; bom?: boolean }): string`
— default `;` y BOM; CRLF; cita (`"…"`, comillas dobladas) todo campo con
separador, comillas, `\r` o `\n`; `null` → vacío; `number` → `String(n)`.
Sin dependencias.

**Aceptación (unidad):** BOM al inicio; `['a;b', 'c"d', null, 10000]` →
`"a;b";"c""d";;10000`; CRLF; separador `,` opcional.

### SH4 — `next.config.ts`

`redirects()` con, en este orden y `permanent: true`: `/cobranza` → `/caja`;
`/cobranza/pagos` → `/caja/cuotas`; `/cobranza/:path*` → `/caja/:path*`.
Comentario: la query viaja sola (docs de Next 16), primer match gana.

**Aceptación:** test que importa `next.config.ts` y comprueba las tres
entradas y su orden; a mano: `/cobranza/pagos?mes=2026-09` → `/caja/cuotas?mes=2026-09`,
`/cobranza/nuevo?socio=5&volver=/socios/5` → `/socios/5?pagar=socio:5`,
`/cobranza/deuda?categoriaId=3` → `/caja/deuda?categoriaId=3`.

### SH5 — Briefs

`git mv .impeccable/surfaces/route-cobranza.md route-caja.md`; frontmatter
con `route:/caja` y los relacionados (`/caja/cuotas`, `/caja/ingresos`,
`/caja/sponsors`, `/caja/deuda`, `/caja/al-dia`, `/caja/por-categoria`);
sección nueva "Caja y otros ingresos (2026-10-13)" que copia las secciones 3–7
de `00-design-brief.md`. `route-ajustes.md`: una línea con "Conceptos de
ingreso: alta, renombrar, desactivar, requiere sponsor".

### SH6 — Rename mecánico (antes de repartir, cero cambios de comportamiento)

- `git mv "src/app/(panel)/cobranza" "src/app/(panel)/caja"` y
  `git mv "src/app/(panel)/caja/pagos" "src/app/(panel)/caja/cuotas"`.
- `git mv src/views/payments/cobranza-tabs.tsx src/views/payments/caja-tabs.tsx`
  y `cobranza-hub-view.tsx` → `caja-hub-view.tsx`; renombrar los exports a
  `CajaTabs` y `CajaHubView` y sus imports (`month-payments-view`,
  `member-accounts-listing-view`, `debt-by-category-view`, `caja/page.tsx`).
- Reemplazar strings: `/cobranza/pagos` → `/caja/cuotas` y `/cobranza` →
  `/caja` en `src/views/**` (incluido `views/dashboard/*` si A3 = sí) y
  `src/app/**`; `nav-items.ts` → `{ href: '/caja', label: 'Caja' }`;
  `caja/nuevo/page.tsx` fallback `'/caja'`; metadata "Caja — Lonqui".
- `tests/views/shell/nav-items.test.ts` y `tests/controllers/reports.controller.test.ts`:
  solo los strings/nombres del rename (el resto de `tests/` es del
  `test-engineer`).
- `npm run typecheck && npm run lint && npm test` verdes antes del Paso 1.

---

## Lane `backend` — `senior-backend-engineer`

Reglas comunes: escrituras con el cliente de sesión; `requirePermission(...)`
en toda action y `requirePanelPermission(...)` en todo controller de lectura
(permisos de §7.2); Zod v4 `.strict()`; errores de Postgres traducidos a
`DomainError` con `field`; logs con ids y montos, nunca nombres, teléfonos ni
emails; `revalidatePath('/caja', 'layout')` en toda escritura de ingresos y
sponsors. Dev log en `02-development-backend-<id>.md`. Skills:
`supabase-postgres-best-practices` (antes de cada query), `supabase`
(Storage, RLS, `.rpc()`), `context7` (supabase-js `insert`/`rpc`/embeds/
`createSignedUploadUrl`, Zod v4), `vercel-react-best-practices`.

### B1 — Otros ingresos, sponsors, exportación

**Posee:** `src/models/cash-movements.model.ts`, `src/models/sponsors.model.ts`,
`src/models/exports.model.ts`, `src/controllers/income.controller.ts`,
`src/controllers/income.actions.ts`, `src/controllers/sponsors.actions.ts`,
`src/app/api/caja/ingresos/exportar/route.ts`.
**No toca:** `types.ts`, `lib/**`, `reports.model.ts`, `audit.model.ts`,
`settings.*`, `payments.*`, `views/**`, `app/(panel)/**`, `supabase/**`, `tests/**`.

**Firmas (contrato con F2):**

```ts
// cash-movements.model.ts
export const CASH_RECEIPT_PATH_PREFIX = 'cash-receipts/'
export function buildCashReceiptPath(batchId: string, mimeType: string): string   // cash-receipts/<batchId>/<uuid>.<ext>
export const prepareCashReceiptUploadSchema  // { batchId: uuid, mimeType, sizeBytes } (mismos MIME y 10 MiB que pagos)
export const registerCashMovementSchema      // { batchId: uuid, conceptId, sponsorId?: number|null, amountCents: int > 0, occurredOn: iso ≤ hoy club y ≥ 2020-01-01, method, receiptPath?: prefijo, description?: ≤ 500 } .strict()
export const voidCashMovementSchema          // { movementId, reason: 3–500 }
export const getCashReceiptUrlSchema         // { movementId }
export const listCashMovementsSchema         // { period: iso date, conceptId?, sponsorId? }
export async function registerCashMovement(input): Promise<{ movementId: number; amountCents: number; alreadyRegistered: boolean }>
export async function voidCashMovement(movementId: number, reason: string): Promise<void>
export async function getCashReceiptPath(movementId: number): Promise<string | null>
export async function listCashMovements(filters: CashMovementFilters): Promise<CashMovement[]>   // embed cash_concepts(name), sponsors(name); orden occurred_on desc, id desc; .limit(500)
export async function listSponsorMovements(sponsorId: number): Promise<CashMovement[]>           // todos, incluidos anulados; .limit(500)

// sponsors.model.ts
export const createSponsorSchema   // { name: 2–120, contactName?: ≤120, phone?: ≤40, email?: z.email() → lower, notes?: ≤1000 } .strict()
export const updateSponsorSchema   // mismos campos, todos opcionales salvo name
export const setSponsorActiveSchema // { id, isActive: boolean, reason?: string } con refine: !isActive ⇒ reason 3–500
export async function listSponsorOptions(options?: { includeInactive?: boolean }): Promise<SponsorOption[]>
export async function listSponsorSummaries(year?: number): Promise<SponsorSummary[]>
export async function getSponsorSummary(id: number): Promise<SponsorSummary | null>
export async function createSponsor(input): Promise<Sponsor>
export async function updateSponsor(id: number, patch): Promise<Sponsor>
export async function setSponsorActive(id: number, isActive: boolean, reason: string | null): Promise<Sponsor>

// exports.model.ts
export async function logExport(listing: ExportListing, filters: Record<string, unknown>, rowCount: number): Promise<void>

// income.controller.ts ('server-only')
export type OtherIncomePageData = { movements: CashMovement[]; summary: CashMonthSummary; concepts: CashConcept[]; sponsors: SponsorOption[]; truncated: boolean }
export async function getOtherIncomePage(filters: CashMovementFilters): Promise<OtherIncomePageData>     // income.read (+ payments.read por el resumen)
export async function getSponsorsPage(): Promise<SponsorSummary[]>                                       // income.read
export async function getSponsorDetailPage(sponsorId: number): Promise<SponsorDetail | null>             // income.read
export const exportOtherIncomeSchema  // { mes: /^\d{4}-\d{2}$/, concepto?: dígitos, sponsor?: dígitos }
export async function exportOtherIncomeCsv(input: unknown): Promise<{ filename: string; body: string }>  // requirePermission('income.read', 'reports.export'); tira

// income.actions.ts ('use server')
export async function registerCashMovement(input: unknown): Promise<ActionResult<{ movementId: number; amountCents: number; alreadyRegistered: boolean }>>
export async function voidCashMovement(input: unknown): Promise<ActionResult<void>>
export async function prepareCashReceiptUpload(input: unknown): Promise<ActionResult<{ path: string; token: string; signedUrl: string }>>
export async function getCashReceiptUrlAction(input: unknown): Promise<ActionResult<{ url: string | null }>>
export async function getIncomeFormData(): Promise<ActionResult<IncomeFormData>>

// sponsors.actions.ts ('use server')
export async function createSponsor(input: unknown): Promise<ActionResult<Sponsor>>
export async function updateSponsor(id: number, input: unknown): Promise<ActionResult<Sponsor>>
export async function setSponsorActive(input: unknown): Promise<ActionResult<Sponsor>>
```

**Aceptación:**
- Permisos: `registerCashMovement`, `prepareCashReceiptUpload`,
  `getIncomeFormData`, `createSponsor`, `updateSponsor` →
  `requirePermission('income.register')`; `voidCashMovement` →
  `'income.void'`; `setSponsorActive` → `'sponsors.deactivate'`;
  `getCashReceiptUrlAction` → `'income.read'`; `getOtherIncomePage`,
  `getSponsorsPage`, `getSponsorDetailPage` → `requirePanelPermission('income.read')`
  (y `'payments.read'` el primero); `exportOtherIncomeCsv` →
  `requirePermission('income.read', 'reports.export')` (**tira**, no
  redirige: lo consume un route handler).
- `registerCashMovement`: `batchId` se acepta del cliente y nunca se
  regenera; `occurredOn` futura o anterior a 2020 → `field: 'occurredOn'`;
  `amountCents` 0/decimal → `field: 'amountCents'`; `receiptPath` sin prefijo
  `cash-receipts/` → `field: 'receiptPath'`; `receiptPath` que no existe en
  Storage → `DomainError` "No encontramos el comprobante subido"; unique de
  `batch_id` → `success({ alreadyRegistered: true, movementId, amountCents })`
  con la fila existente; mensajes de los guards ("Elegí el sponsor" →
  `field: 'sponsorId'`; "El concepto está desactivado" → `field: 'conceptId'`;
  "El sponsor está desactivado" → `field: 'sponsorId'`) traducidos a
  `DomainError`; éxito → `revalidatePath('/caja', 'layout')`.
- `voidCashMovement`: `reason` < 3 → `field: 'reason'`; ya anulado →
  `DomainError` con el texto del guard; id inexistente →
  `DomainError('El ingreso no existe', 404)` (`.select('id').maybeSingle()`).
- `prepareCashReceiptUpload`: MIME fuera de la lista / > 10 MiB → `field`;
  ruta `cash-receipts/<batchId>/<uuid>.<ext>` armada en el servidor.
- `getIncomeFormData`: solo conceptos **activos** (orden `sort_order, name`)
  y sponsors **activos** (orden nombre).
- `createSponsor`: `email` se guarda en minúsculas; 23505 → `DomainError('Ya
  existe un sponsor con ese nombre', field 'name')`; si el existente está
  desactivado, el mensaje lo dice ("…está desactivado: reactivalo desde
  Sponsors"). `updateSponsor`: ídem; `setSponsorActive({ id, isActive:
  false })` sin `reason` → `field: 'reason'`; `editor` → `PermissionError`;
  reactivar devuelve el sponsor con tríada en null.
- `listCashMovements`: filtra por mes (`occurred_on` entre primer y último
  día), `conceptId`, `sponsorId`; incluye anulados con `voided: true`;
  `createdByName` resuelto en batch (sin N+1; "—" para quien RLS no deje
  leer, limitación heredada documentada); `truncated: true` en el controller
  si llegaron 500.
- `exportOtherIncomeCsv`: columnas `Fecha;Concepto;Sponsor;Detalle;Monto;Medio;Cargó;Estado;Motivo de anulación`;
  fecha `dd/mm/aaaa`; monto en pesos enteros (`amountCents / 100`, sin
  separador); medio en español; Estado `Vigente`/`Anulado`; usa `toCsv` de
  `lib/csv.ts`; **llama a `logExport('other_income', { mes, concepto, sponsor }, rows.length)` antes de devolver**;
  si `logExport` falla, no devuelve el archivo; `filename =
  otros-ingresos-<YYYY-MM>.csv`; `mes` inválido → `DomainError` 400.
- Route handler: `GET`, pasa `Object.fromEntries(searchParams)` al
  controller; éxito → `200` con `Content-Type: text/csv; charset=utf-8`,
  `Content-Disposition: attachment; filename="…"`, `Cache-Control: no-store`;
  error → `Response.json(body, { status })` vía `toApiError(err, 'income.export')`
  (403 sin permiso/sesión, 400 inválido, 500 genérico). **No importa
  `@supabase/*` ni modelos**: solo el controller.
- Ningún log con `contact_name`, `phone`, `email` ni `description`.
- **[DB]** lo de S1 se prueba también con las funciones del modelo y claims por rol.

**Dependencias:** S1, S2, SH1, SH3; `getCashMonthSummary` de B2 (por firma).
**Fuera de alcance:** adjuntar comprobante después (la base lo admite, no
hay action), paginación, selector de año, exportación de sponsors, UI.

### B2 — Conceptos, resumen de caja, auditoría, ajustes

**Posee:** `src/models/cash-concepts.model.ts`, `src/models/reports.model.ts`
(modificar), `src/models/audit.model.ts` (modificar),
`src/controllers/reports.controller.ts` (modificar),
`src/controllers/settings.controller.ts` (modificar),
`src/controllers/settings.actions.ts` (modificar).
**No toca:** nada de B1, `types.ts`, `lib/**`, `views/**`, `app/**`,
`supabase/**`, `tests/**`.

**Firmas (contrato con F1/F2):**

```ts
// cash-concepts.model.ts
export const createCashConceptSchema  // { name: 2–120, requiresSponsor?: boolean } .strict()
export const updateCashConceptSchema  // { name: 2–120, requiresSponsor?: boolean } .strict()
export async function listCashConcepts(options?: { includeInactive?: boolean }): Promise<CashConcept[]>   // orden sort_order, name
export async function createCashConcept(input): Promise<CashConcept>
export async function updateCashConcept(id: number, patch): Promise<CashConcept>
export async function setCashConceptActive(id: number, isActive: boolean): Promise<CashConcept>
export async function reorderCashConcepts(orderedIds: number[]): Promise<void>

// reports.model.ts (+)
export async function getCashMonthSummary(targetPeriod?: string): Promise<CashMonthSummary>

// reports.controller.ts: getCobranzaHub → getCajaHub
export type CajaHubData = { cash: CashMonthSummary; summary: DashboardSummary; billing: BillingStatus; daily: DailyCollectionPoint[] }
export async function getCajaHub(): Promise<CajaHubData>   // requirePanelPermission('payments.read', 'income.read', 'reports.read')

// settings.controller.ts: SettingsPageData + incomeConcepts: CashConcept[] (todos, incluidos inactivos)

// settings.actions.ts (+)  — todas con requirePermission('settings.manage')
export async function createCashConcept(input: unknown): Promise<ActionResult<CashConcept>>
export async function updateCashConcept(id: number, input: unknown): Promise<ActionResult<CashConcept>>
export async function setCashConceptActive(id: number, isActive: boolean): Promise<ActionResult<CashConcept>>
export async function reorderCashConcepts(orderedIds: number[]): Promise<ActionResult<void>>
```

**Aceptación:**
- `getCashMonthSummary`: mapea la RPC con `.overrideTypes` (`by_concept`
  jsonb → `CashConceptTotal[]`); sin período → mes actual en zona club; sin
  movimientos → ceros y `byConcept: []`.
- `getCajaHub`: cuatro lecturas en `Promise.all`; `summary` es el
  `dashboard_summary` existente (de ahí salen `membersInDebt` y
  `totalDebtCents`; no se recalculan); `getCobranzaHub` deja de existir.
- Conceptos: 23505 → "Ya existe un concepto con ese nombre" (`field:
  'name'`); `setCashConceptActive` no cuenta movimientos (desactivar nunca
  se impide); `reorderCashConcepts` asigna `sort_order` = índice; las
  actions revalidan `/ajustes` **y** `/caja` (layout).
- `audit.model`: `AUDITED_TABLES` suma `cash_concepts`, `sponsors`,
  `cash_movements` (y la page de `/auditoria` las toma de ahí sin tocarla);
  `AUDIT_FIELD_LABELS` con las columnas de las tres (sin `created_by`,
  `voided_by`, `deactivated_by`); `buildLabelDraft`: `cash_movements` →
  "<Concepto>[ · <Sponsor>] · $X · dd/mm/aaaa" resolviendo nombres de
  conceptos y sponsors en **una** consulta batch por tabla (sin N+1, mismo
  patrón que socios), `sponsors` y `cash_concepts` → `name`.
- Ningún log con nombres.

**Dependencias:** S1, S2, SH1.
**Fuera de alcance:** UI, tocar `dashboard_summary` o el Inicio.

---

## Lane `frontend` — `frontend-react-craftsman`

Reglas comunes: cero data fetching en `views/**`; permisos con
`session.permissions.includes(...)` / `useHasPermission` (UX, no defensa);
todo `<form>` con `method="post"`; targets 44 px; estados de carga, vacío y
error; copy sin "eliminar"; verificar primero a 390 px. Skills obligatorias:
`impeccable` (`.claude/skills/impeccable/reference/craft-floor.md` y
`reference/operate.md` antes de editar; el brief es `00-design-brief.md` y
`route-caja.md`), `frontend-design`, `vercel-react-best-practices`,
`web-design-guidelines` antes de cerrar, `dataviz` para la barra partida,
`context7` (react-hook-form, Zod v4, cmdk, Next 16 `searchParams` como
`Promise`). Dev log en `02-development-frontend-<id>.md`.

### F1 — Caja: hub con dos cifras, pestañas, shell

**Posee:** `src/views/payments/**`, `src/views/shell/**`,
`src/views/dashboard/**` (solo si queda algo del rename), `src/app/(panel)/caja/page.tsx`,
`loading.tsx`, `error.tsx`, `nuevo/**`, `cuotas/**`, `deuda/**`, `al-dia/**`,
`por-categoria/**`.
**No toca:** `views/income/**`, `views/settings/**`, `views/audit/**`,
`views/shared/**`, `app/(panel)/caja/ingresos/**`, `app/(panel)/caja/sponsors/**`,
`app/(panel)/(admin)/**`, `controllers/**`, `models/**`, `tests/**`.

**Aceptación:**
- `caja/page.tsx`: `requirePanelPermission('payments.read', 'income.read')`
  → `getCajaHub()` → `CajaHubView({ cash, summary, billing, daily, permissions })`.
- `CajaHubView`: `PageHeader` "Caja"; `CajaTabs`; "Registrar pago" (primario,
  ancho completo, solo `payments.register`, abre `?pagar=buscar`) y
  "Registrar otro ingreso" (outline, ancho completo, solo `income.register`,
  abre `useOverlayParam('ingreso').set('nuevo')`); sin ninguno de los dos
  permisos no hay botones ni espacio vacío.
- Dos `HeroFigure` en `grid gap-4 sm:grid-cols-2` (apiladas a 390 px), con
  `countUpKey` distintos: (1) "Ingresado en <mes>" = `cash.totalCents`, sin
  href; debajo una barra partida **Cuotas / Otros ingresos** con el monto
  escrito en cada tramo y cada etiqueta como `<Link>` a `/caja/cuotas` y
  `/caja/ingresos` (misma gramática que `CashTransferBar`, colores no de
  estado, `role="img"` + `aria-label`), y la barra **efectivo/transferencia
  de todo lo ingresado** (`cash.cashCents`/`cash.transferCents`); (2)
  "Cobrado en cuotas" = `cash.feesCollectedCents`, href `/caja/cuotas`,
  supporting "de $X en cuotas de <mes>", `CollectionRateMeter` existente y la
  línea "N socios con deuda · $Y adeudado" (`summary.membersInDebt`,
  `summary.totalDebtCents`) como `<Link>` a `/caja/deuda`. Con `billing.active
  = false`, la cifra 2 explica que no hay cuotas, como hoy.
- Panel "Ritmo del mes" sin cambios. Panel "Otros ingresos": total del mes
  (`cash.otherIncomeCents`) y una fila etiqueta/valor por `byConcept`
  (tabulares), link "Ver todos" a `/caja/ingresos`; vacío: "Todavía no se
  registraron otros ingresos en <mes>" con el botón si hay permiso.
- `CajaTabs`: seis pestañas en el orden del brief; `aria-label="Secciones de
  caja"`; `layoutId` propio; scrollea horizontal a 390 px y lleva la activa a
  la vista; la activa se decide por `pathname` exacto (`/caja/sponsors` y
  `/caja/sponsors/[id]` marcan "Otros ingresos": usar `startsWith` para esa
  pestaña).
- `app-shell.tsx`: monta `<IncomeOverlayHost />` (import `@/views/income/income-overlay-host`)
  dentro del mismo `Suspense` que los otros dos hosts.
- `nav-items.ts`: "Caja" con `Banknote` (o `Wallet` si lee mejor; una sola
  decisión, documentada). `/caja/*` marca el ítem activo.
- `caja/nuevo/page.tsx` con fallback `/caja`; `cuotas/page.tsx` título
  "Cuotas"; `MonthSelector basePath="/caja/cuotas"`; `month-payments-view`
  encabezado "Pagos de cuotas".
- Ningún string `/cobranza` queda en `views/**` ni `app/**` (salvo
  comentarios históricos).
- Opcional: `register-payment-sheet.tsx` usa `SuccessMoment` de shared.

**Contratos:** `CajaHubData`, `CashMonthSummary`, `DashboardSummary`,
`HeroFigure`, `useOverlayParam('ingreso')`, `IncomeOverlayHost` (F2).
**Dependencias:** SH2, SH6, B2.

### F2 — Otros ingresos, sponsors, conceptos en ajustes

**Posee:** `src/views/income/**` (nuevo), `src/views/settings/**`,
`src/views/audit/audit-labels.ts`, `src/app/(panel)/caja/ingresos/**`
(solo `page.tsx`; el route handler es de B1 y vive en `app/api`),
`src/app/(panel)/caja/sponsors/**` (`page.tsx`, `[id]/page.tsx`,
`[id]/not-found.tsx`), `src/app/(panel)/(admin)/ajustes/page.tsx`.
**No toca:** `views/payments/**` (importa `CajaTabs`, `MonthSelector`,
`ReceiptPicker`, `validateReceiptFile`, `maybeCompressReceipt`),
`views/shell/**`, `views/shared/**`, `views/dashboard/**`, `app/(panel)/caja/page.tsx`
y hermanos de F1, `controllers/**`, `models/**`, `tests/**`.

**Aceptación — overlay (`?ingreso=`):**
- `IncomeOverlayHost`: lee `useOverlayParam('ingreso')`, `parseIncomeOverlay`,
  `useHasPermission('income.register')` (sin permiso devuelve `null`);
  `ResponsiveSheet` título "Registrar otro ingreso"; cierra con
  `useCloseOverlay('ingreso')` (history/replace, igual que pagos); conserva
  el último valor válido durante la animación de salida.
- `IncomeFormBody`: al montar llama `getIncomeFormData()` (carga/error),
  luego `IncomeForm`; éxito → `SuccessMoment({ amountCents, label: 'Ingreso
  registrado' })` el tiempo de `DURATION.focal` y después cierre +
  `router.refresh()`; toast "Ingreso registrado · $X".
- `IncomeForm` (react-hook-form + Zod espejo del schema del modelo, textos
  idénticos): `batchId` en `useState(() => crypto.randomUUID())`; campos en
  una columna y en este orden: **Concepto** (botones grandes, grilla de 2 a
  390 px, `role="radiogroup"`, error `aria-describedby`), **Sponsor**
  (combobox con buscador y "+ Agregar sponsor" en línea que llama
  `createSponsor({ name })` y selecciona el creado; obligatorio si el
  concepto elegido tiene `requiresSponsor`, y en ese caso sube justo debajo
  de Concepto; con `sponsorId` del overlay viene preseleccionado y el
  concepto es el primero activo con `requiresSponsor`), **Monto**
  (`AmountField`, sin precarga), **Fecha** (hoy club), **Medio** (dos
  botones), **Comprobante** (`ReceiptPicker`, visible con transferencia),
  **Detalle** (`TextareaField`, ≤ 500); botón "Registrar ingreso de $X"
  deshabilitado mientras envía; subida en dos pasos
  (`income-receipt-upload.ts`: `uploadCashReceipt(batchId, file)` con
  `prepareCashReceiptUpload`); errores con `field` bajo su campo;
  `alreadyRegistered` se trata como éxito.
- Sin conceptos activos: estado vacío con link a `/ajustes` (si
  `settings.manage`) o texto; sin sponsors: el buscador ofrece crearlo.

**Aceptación — `/caja/ingresos`:**
- `page.tsx`: `requirePanelPermission('income.read')`; parsea `?mes=YYYY-MM`,
  `?concepto=`, `?sponsor=`; llama `getOtherIncomePage(filters)`; pasa
  `canVoid = permissions.includes('income.void')` y `canExport =
  permissions.includes('reports.export')`.
- `OtherIncomeView`: `PageHeader` "Otros ingresos"; `CajaTabs`;
  `MonthSelector basePath="/caja/ingresos"` (conserva `concepto`/`sponsor`
  o los descarta de forma explícita y documentada); panel de totales: total
  del mes + fila por concepto; `FilterBar` con `concepto` (todos los
  conceptos, inactivos marcados) y `sponsor` (todos); botón outline
  "Exportar CSV" = `<a href="/api/caja/ingresos/exportar?mes=…&concepto=…&sponsor=…" download>`
  solo con `canExport`; link "Sponsors" a `/caja/sponsors`; aviso si
  `truncated`.
- `OtherIncomeList` (`DataList`): columnas Fecha · Concepto · Sponsor o
  detalle · Monto · Medio · Cargó; fila móvil con título = concepto (+
  sponsor), subtítulo fecha · medio, meta monto (tachado si anulado +
  "Anulado: motivo"); menú: "Ver comprobante" (firma al tocar, patrón del
  popup de pagos) y "Anular ingreso" (solo `canVoid` y no anulado) →
  `ReasonDialog showDate={false}` con consecuencia "Deja de contar en lo
  ingresado del mes. Queda registrado, tachado, con el motivo." →
  `voidCashMovement`; estado vacío del brief con el botón si hay permiso.

**Aceptación — sponsors:**
- `/caja/sponsors`: `requirePanelPermission('income.read')` → `getSponsorsPage()`
  → `SponsorsView`: `CajaTabs`; lista (`DataList`) nombre · aportado en el
  año · último aporte (fecha y monto) · pill "Desactivado" para inactivos
  (después de los activos); fila navega a `/caja/sponsors/[id]`; "Nuevo
  sponsor" (solo `income.register`) abre `SponsorFormSheet`; vacío: "Todavía
  no hay sponsors cargados".
- `/caja/sponsors/[id]`: `getSponsorDetailPage(id)`; `null` → `notFound()`;
  `SponsorDetailView`: encabezado con nombre y estado; aportado en el año,
  total histórico, último aporte, cantidad; contacto (nombre, teléfono con
  `WhatsAppLink`, email) sin exponer nada en la URL; acciones: "Registrar
  aporte" (`income.register`, abre `?ingreso=sponsor:<id>`, deshabilitado si
  está desactivado), "Editar" (sheet), "Desactivar" / "Reactivar"
  (`sponsors.deactivate`; desactivar con `ReasonDialog showDate={false}`,
  reactivar con confirmación simple); historial de aportes (incluidos
  anulados, tachados) con "Ver comprobante".
- `SponsorFormSheet`: nombre obligatorio; contacto, teléfono, email, notas
  opcionales; errores con `field`; en edición no toca el estado.

**Aceptación — ajustes:**
- `ajustes/page.tsx` pasa `incomeConcepts`; `settings-page-view.tsx` suma el
  panel "Conceptos de ingreso" (después de "Disciplinas y categorías", antes
  de valores de cuota) con `IncomeConceptsSection`: filas como
  `category-row.tsx` (subir/bajar, Editar, Desactivar con `ConfirmToggleDialog`
  / Activar), sheet con nombre + checkbox "Pide sponsor"; copy de desactivar:
  "Deja de ofrecerse al registrar ingresos. Los ingresos ya cargados lo
  siguen mostrando."; vacío que enseña.
- `audit-labels.ts`: opciones "Otros ingresos" (`cash_movements`),
  "Sponsors", "Conceptos de ingreso"; `ENTITY_LABELS` ("un ingreso", "un
  sponsor", "un concepto de ingreso"); `RECORD_PHRASE` ("el ingreso <label>",
  "el sponsor <label>", "el concepto <label>"); `FIELD_LABELS` con las
  columnas de B2 (copiadas o importadas de `AUDIT_FIELD_LABELS`).

**Contratos:** todo lo de B1/B2 por firma; `SuccessMoment`, `ReasonDialog
showDate`, `parseIncomeOverlay`/`incomeOverlayValue`, `CajaTabs` (F1).
**Dependencias:** SH1, SH2, SH6, B1, B2 (F1 solo por `CajaTabs`).
**Fuera de alcance:** paginación, selector de año, exportar sponsors, tocar
el Inicio, cualquier pantalla de egresos.

---

## Lane `tests` — `test-engineer` (después de B y F)

Spec = los criterios de arriba. Posee todo `tests/**` (el hilo principal
solo tocó strings del rename en dos archivos, SH6). Prioridad:

1. **[DB]** `tests/db/cash.test.ts` (nuevo): la matriz completa de S1 por rol
   (`consulta`/`editor`/`admin`) para las tres tablas; idempotencia de
   `batch_id`; inmutabilidad también como `postgres`; guards de insert
   (fecha, concepto inactivo, `requires_sponsor`, sponsor desactivado) y de
   update (anular, comprobante); tríada y reactivación de sponsors;
   auditoría con actor y `changed_fields`; `cash_month_summary` (igualdad
   con `month_collection`, split, `by_concept`, mes vacío); `sponsor_summaries`
   (borde 31/12–1/1, anulados excluidos, sponsor sin aportes, un solo id).
2. **[DB] Invariante central**: snapshot `row_to_json` de las ocho funciones
   de deuda/cobranza antes y después de insertar y anular movimientos → sin
   diferencias.
3. **[DB]** `tests/db/storage.test.ts` (+): prefijo `cash-receipts/` por rol;
   los viejos intactos. `tests/db/accounts.test.ts` (+): `log_export('other_income')`.
   `tests/db/grants-and-lockdown.test.ts`: confirmar que los guards
   existentes (sin DELETE, `anon` solo `keep_alive`, private cerrado) siguen
   verdes con las tablas y RPC nuevas; `my_permissions()` por rol con las
   claves nuevas; `grep` de `has_role`/`is_admin` en los objetos nuevos.
4. Modelos (mocks del cliente): `cash-movements.model` (filas → `CashMovement`,
   `alreadyRegistered`, traducción de mensajes a `field`, `limit(500)`),
   `sponsors.model` (email en minúsculas, 23505 con y sin "desactivado"),
   `cash-concepts.model`, `reports.model.getCashMonthSummary` (`by_concept`),
   `audit.model` (labels de las tres tablas, batch sin N+1).
5. Controllers/actions: permisos por action (`editor` no anula, `consulta`
   no registra, `editor` no desactiva sponsors); Zod con `field`;
   `exportOtherIncomeCsv` (audita antes, no devuelve si la auditoría falla,
   columnas y formato, `mes` inválido); route handler (headers, 403/400);
   `getCajaHub` (cuatro lecturas, permisos); `settings.actions` de conceptos
   (`requirePermission('settings.manage')`, revalida `/ajustes` y `/caja`).
6. `tests/lib/csv.test.ts`; `tests/views/shared/overlay-params.test.ts`
   (`ingreso`, exclusión mutua con `pagar`/`ver`); `tests/views/shell/nav-items.test.ts`
   ("Caja", `/caja`); `tests/config/redirects.test.ts` (las tres entradas y
   su orden desde `next.config.ts`); helpers puros de `views/income/*` si
   los hay (espejo del schema, texto del botón "Registrar ingreso de $X").
7. Sin PII en logs: ningún log con `contact_name`/`phone`/`email`/`description`.

**Nunca** resetea la base; transacción con rollback por test; claims por rol
con `actAs`. Informe en `03-tests.md`; veredicto `SUITE GREEN` o la lista de
hallazgos enrutados al agente dueño.

## Lane `review` — `code-reviewer` (en paralelo con tests)

Verifica además de lo general: ninguna función de deuda/cobranza
modificada (diff de `supabase/migrations/` toca solo la migración nueva);
`direction` cerrado en CHECK **y** policy; `batch_id` nunca regenerado en
el servidor; guards DEFINER solo donde leen otras tablas
(`cash_movements_insert_guard`), INVOKER el resto; `log_export` con lista
cerrada y llamada **antes** de devolver el CSV; el route handler sin
`@supabase/*` ni modelos; `cash_month_summary` reusa `month_collection`
(no redefine "cobrado"); `getCajaHub` toma deuda de `dashboard_summary`;
ninguna suma de centavos en TS para totales mostrados; ningún
`requireRole`/`has_role`/`is_admin`/`session.role` en código nuevo; ningún
`createAdminClient()`; `revalidatePath('/caja', 'layout')` en toda
escritura; URLs firmadas nunca persistidas; sin PII en logs ni en la URL
del CSV; redirects en el orden correcto y con query preservada; ningún
`/cobranza` vivo en `src/`; dos `HeroFigure` solo en `/caja` (excepción
documentada); copy sin "eliminar"; `ReasonDialog` con `showDate` retro-
compatible; targets 44 px y sin scroll horizontal a 390 px; `AuditedTable` y
etiquetas completas; `database.types.ts` regenerado y commiteado con la
migración. Veredicto en `03-review.md`.
