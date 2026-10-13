# 00 — Arquitectura: Caja (ex Cobranza), otros ingresos, sponsors y conceptos

Pipeline: `2026-10-13-caja-otros-ingresos`. Estado: **propuesta, pendiente de
aprobación de Tomás**. Cero código, cero migraciones: este documento decide
qué se construye y con qué forma; `01-tasks.md` lo reparte. El brief de
diseño ya confirmado (`00-design-brief.md`) manda sobre la UI; acá no se
re-litiga ninguna de sus "Decisiones de Tomás", solo se señalan riesgos.

---

## 1. Problema y contexto

| Qué | Detalle |
|---|---|
| Pedido | Renombrar `/cobranza` → **Caja** (`/caja`, redirects desde `/cobranza/*`); registrar **otros ingresos** (no cuota) con **catálogo de sponsors** y **conceptos administrados en `/ajustes`**; resumen de Caja con **dos cifras héroe** (ingresado total vs. cobrado en cuotas contra la deuda); listado mensual con anulación y CSV auditado; sponsors con aportado en el año e historial; **bases para egresos sin construirlos** |
| Restricciones que mandan (`CLAUDE.md`) | MVC estricto; permisos vía `private.can` + `requirePermission` (nunca roles); auditoría por triggers con actor de `auth.uid()` (escrituras con el cliente de sesión); nada se borra (anulación con motivo, sin grant DELETE); centavos `bigint`; agregaciones en RPC; invariantes en Postgres; períodos en zona del club; adjuntos en bucket privado con URL firmada; sin PII en logs; Operate mobile-first a 390px |
| Invariante nueva central | **Un ingreso no-cuota nunca toca la deuda, el saldo a favor, el estado de cuenta, el % de cuotas ni los listados al día / con deuda / por categoría.** Se garantiza por construcción (tabla nueva que ninguna función de deuda lee) y se prueba contra la base |

## 2. Chequeo de alcance

Los ingresos no-cuota **no están en la Fase 1 del contrato** (2.2 cubre cuota
social y estado de cuenta). Es un requerimiento nuevo (contrato 7.3) que la
Comisión tiene que confirmar; **Tomás decidió construirlo**. Lo que sí es
Fase 1 y este pipeline inaugura de paso: la **exportación a CSV auditada**
(2.4), que hoy existe solo como gancho SQL (`log_export`) sin consumidor.

Fuera de este pipeline aunque parezca cerca: pantalla de egresos; stock de
indumentaria (Fase 4); cambios en el panel de Inicio; sponsors en el padrón;
mails o WhatsApp a sponsors.

## 3. Lo que hay hoy (Paso 0)

**El MCP de Supabase no conectó** (`ECONNREFUSED`: el stack local no está
levantado). Todo lo que sigue sale de `supabase/migrations/**` y del código.

| Pieza | Estado real |
|---|---|
| Migraciones | 11, la última `20261011120000_keep_alive.sql` (sin commitear). La nueva va después |
| Permisos | `private.permissions_for_role` (IMMUTABLE, `case` fijo, **en `20260927125000_member_categories.sql`**), `private.can`, `public.my_permissions`, `private.require_permission`. Doce claves; `SessionInfo.permissions` las lee de `my_permissions()` sin whitelist en TS |
| Pagos | `payments` con `batch_id` + unique `(batch_id, member_id)`, tríada de anulación, `payments_update_guard` (void solo `payments.void`, comprobante null→valor una vez), `receipt_storage_path like 'payment-receipts/%'` |
| RPCs de deuda/cobranza | `month_collection`, `daily_collection`, `dashboard_summary`, `debt_by_category`, `monthly_history`, `member_accounts`, `member_fee_statement`, campos calculados sobre `members`. **Ninguna lee otra tabla que `fees`/`payments`/`members`/eventos** |
| `log_export` | Existe (DEFINER, `reports.export`, lista cerrada de `listing`, tope 4 KiB en `filters`), **sin ningún consumidor en `src/`**. No hay CSV en la app |
| Storage | Bucket `attachments` privado; policy `attachments_insert` con prefijos `medical-clearances` y `payment-receipts` y `has_role('admin','editor')` (deuda del slice 1) |
| Rutas | `app/(panel)/cobranza/{page,loading,error,nuevo,pagos,deuda,al-dia,por-categoria}`. `nuevo` solo redirige (`?socio=`/`?grupo=`/`?volver=` → `?pagar=`) con fallback `/cobranza` |
| Vistas | `views/payments/**`: `cobranza-hub-view` (una `HeroFigure`, `CollectionRateMeter`, `CashTransferBar`, ritmo), `cobranza-tabs` (5 `<Link>`), `payment-overlay-host` (lee `?pagar=`), `month-payments-*`, `receipt-picker`/`receipt-upload`, `month-selector` |
| Overlays | `views/shared/overlay-params.ts` (`OverlayName = 'pagar' \| 'ver'`, nunca dos apilados) + `overlay-values.ts` (parseo puro). Hosts montados una vez en `app-shell.tsx` |
| Navegación | `views/shell/nav-items.ts`: `{ href: '/cobranza', label: 'Cobranza', icon: Banknote, rank: 1 }` |
| Hrefs a `/cobranza` fuera de `views/payments` | `views/dashboard/priority-extras.tsx` (1), `views/dashboard/money-summary-strip.tsx` (2), `views/shell/nav-items.ts` (1) |
| `revalidatePath('/cobranza…')` | **No aparece** en ningún controller: pagos usan `revalidatePath('/', 'layout')`; ajustes `/ajustes`; socios `/socios*` |
| Ajustes | `settings.controller.getSettingsPage` + `settings.actions` (disciplinas/categorías con `requireRole('admin')`, deuda del slice 1); vistas `discipline-group`, `category-row`, `category-form-sheet`, `confirm-toggle-dialog` |
| Auditoría | `audit.model.AUDITED_TABLES` (única fuente), `AUDIT_FIELD_LABELS`, `buildLabelDraft`; `views/audit/audit-labels.ts` (opciones, `ENTITY_LABELS`, `RECORD_PHRASE`) |
| Shared | `HeroFigure` (doc: "exactamente UNA por pantalla"), `ReasonDialog` (motivo **y fecha** obligatorios), `DataList`, `FilterBar` (URL), `Pagination`, `AmountField`, `MonthSelector` (en payments), `WhatsAppLink`, `states` |
| Tests | `tests/db/*` con `withRollback` + `actAs`; `grants-and-lockdown` verifica sin DELETE en toda tabla de `public`, funciones de `private` sin EXECUTE para public/anon y que `keep_alive` sea la **única** función de `public` ejecutable por `anon` |
| Docs Next 16 | `redirects()` en `next.config.ts`: 307/308, **la query string se pasa al destino** sin configurar nada, primer match gana, se evalúan antes del filesystem |

## 4. Pushback y riesgos

1. **CSV es un pipeline dentro del pipeline.** El brief lo nombra en una línea; en el repo no existe ni el helper ni el patrón de descarga. Este plan lo construye **una vez, reutilizable** (route handler + `lib/csv.ts` + `log_export`) y deja el camino para "exportar cualquier listado" (2.4). Es trabajo real, no un botón.
2. **"Ingresado" mezcla dos naturalezas.** Las cuotas son una cuenta corriente (cargo/pago); los otros ingresos son caja pura. Juntarlos en una cifra es lo que Tomás pidió y es correcto para Tesorería (concilia la plata en mano), pero Presidencia puede leer "Ingresado" como "cobranza". Mitigación en el brief: la barra partida Cuotas/Otros con monto escrito y la segunda cifra "Cobrado en cuotas". No se agrega un %.
3. **Sponsor opcional en el concepto "Sponsor" rompe la pregunta "¿cuánto aportó este sponsor?"** Propongo un flag `requires_sponsor` en el concepto (semilla: solo "Sponsor" lo tiene) que el trigger hace cumplir. Si Tomás prefiere el brief literal, se saca el flag (decisión A1).
4. **Una tabla genérica de movimientos es una puerta a egresos sin pedirlos.** Se deja la puerta con cerrojo: CHECK `direction in ('income')`, policy de INSERT que exige `direction = 'income'`, ninguna RPC resta nada, ninguna UI de egresos. Relajarlo es una migración con su propio pipeline.
5. **Reactivar sponsors.** El brief solo dice "desactivar con motivo". Un sponsor que vuelve al año siguiente y no se puede reactivar obliga a crear un duplicado (que el índice único de nombre bloquea). Propongo reactivación con el mismo permiso; el motivo de la baja queda en `audit_log` (A2).
6. **Quién cargó, para no-admins.** `app_users` solo es legible por la fila propia o por admin: `editor`/`consulta` ven "—" en "Cargó" de otros. Es una limitación **ya existente** en `/cobranza/pagos`; no se arregla acá (pediría una RPC `user_display_names()`), se anota.
7. **`permanent: true` (308) se cachea para siempre en el browser.** Un redirect mal escrito queda pegado. Se verifica en local antes de commitear; a cambio, los bookmarks viejos no pagan dos saltos cada vez.
8. **El panel de Inicio "no se toca"** pero tiene 3 hrefs a `/cobranza/*`. Dejarlos cuesta un 308 por click; cambiarlos son 3 strings sin efecto visual. Recomiendo cambiarlos en el rename mecánico (A3).
9. **Datos de contacto de sponsors** (nombre, teléfono, email de una persona) son datos personales. Con `income.read` para los tres roles, `consulta` los ve. No hay forma de restringir columnas por rol de app con grants (son por rol de Postgres). Pregunta a la Comisión (C2).
10. Lo que **no** se hace aunque tiente: paginación keyset del listado (0–30/mes; se acota a 500 con aviso), selector de año en sponsors (año en curso), adjuntar comprobante después (la base lo permite por paridad, la UI no lo ofrece), importador de sponsors.

## 5. Investigación

- **Skill `supabase-postgres-best-practices`** (`security-rls-performance`, `security-privileges`, `schema-constraints`, `query-partial-indexes`, `schema-foreign-key-indexes`): `(select private.can(...))` en policies; índice en toda FK; índice parcial `where sponsor_id is not null` / `where voided_at is null`; helpers DEFINER en `private` con EXECUTE revocado; grants mínimos por columna.
- **Next 16** (`node_modules/next/dist/docs/01-app/02-guides/redirecting.md` y `.../next-config-js/redirects.md`): `redirects()` preserva la query, admite `:path*`, orden = prioridad, 308 con `permanent: true`. `permanentRedirect()` en una page es la alternativa por ruta; no hace falta: no hay condición dinámica.
- **Repo**: las funciones de trigger en `private` **no necesitan EXECUTE** para el rol que dispara el trigger (`payments_update_guard` corre como `authenticated` con el EXECUTE revocado y los tests pasan); solo los helpers que llaman policies o RPC INVOKER necesitan grant. Los default privileges de `public` ya revocan EXECUTE a toda función nueva; los de `private` no (trampa conocida): la migración cierra con el `revoke … on all functions in schema private`.
- **Patrones ya probados en el repo que se copian tal cual**: idempotencia por `batch_id` + unique + "éxito repetido"; tríada de anulación + guard; subida en dos pasos (URL firmada → path al servidor → `objectExists`); `MonthSelector` con `?mes=`; `FilterBar` en `searchParams`; `ReasonDialog`; `ResponsiveSheet`; combobox con "crear en línea" (`family-group-combobox.tsx`).
- **Cuentas de caja en sistemas de clubes/ONG** (lectura general, sin fuente única): un libro de caja por movimiento con concepto y sentido, anulación con contrapartida o marca, y el balance como vista derivada. Es exactamente la forma elegida; la diferencia es que acá las cuotas quedan en su cuenta corriente y el libro de caja las **lee**, no las copia.

## 6. Opciones y descartes

### 6.1 Forma del schema de otros ingresos

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| **A. `cash_movements` + `cash_concepts` con `direction` (CHECK solo `income`)** | Egresos mañana = relajar un CHECK y sumar UI; el balance es una RPC que ya tiene la forma; un concepto "Indumentaria" puede existir como ingreso (venta) y como egreso (compra) sin ambigüedad (unique por `direction`); una sola lógica de anulación/comprobante/idempotencia | Nombre genérico; hay que cerrar la puerta con CHECK + policy | **Recomendada** |
| B. `other_incomes` ahora, `expenses` después | Nombres literales | Duplica guards, tríada, comprobantes; el balance futuro es un `UNION`; los conceptos igual necesitan `direction` | Descartada |
| C. Meter los otros ingresos en `payments` con `member_id` null | Una sola tabla de "plata que entra" | Rompe `member_balance` (todo `payments` es cuenta corriente), contamina `month_collection`, viola "nunca toca la deuda" | Descartada |

### 6.2 Cifra "Ingresado" y resumen del mes

| Opción | Veredicto |
|---|---|
| **A. RPC `cash_month_summary` que llama a `month_collection` para la parte de cuotas y suma los movimientos** | **Recomendada**: una sola definición de "cobrado en cuotas" (inicio, `/caja/cuotas`, resumen); total y split salen de la base, nunca de sumar dos RPC en TS |
| B. Dos RPC y sumar en el controller | Viola "sumas en TS para totales que se muestran" |
| C. Extender `dashboard_summary` | Toca el Inicio (prohibido) y mezcla permisos (`reports.read`) |

"N socios con deuda · $Y adeudado" se **reusa** de `dashboard_summary`
(`members_in_debt`, `total_debt_cents`, activos, solo saldos positivos): el
controller del hub la llama en paralelo. No se duplica la definición.

### 6.3 Exportación CSV

| Opción | Veredicto |
|---|---|
| **A. Route handler `GET /api/caja/ingresos/exportar?mes=&concepto=&sponsor=` → controller → `log_export` → CSV** | **Recomendada**: un `<a href download>` funciona sin JS; el handler re-verifica permisos (los layouts no aplican a `route.ts`); la auditoría se escribe **antes** de devolver el archivo |
| B. Server Action que devuelve el texto y el cliente arma un `Blob` | Necesita JS, no es un link, y pasa el archivo entero por la serialización de la action |
| C. Generar el CSV en SQL (`copy`) | Imposible vía PostgREST |

Formato (A4): UTF-8 **con BOM**, separador **`;`**, CRLF, comillas RFC 4180,
fechas `dd/mm/aaaa`, montos en **pesos enteros** sin separador de miles,
anulados incluidos con columna "Estado" y "Motivo de anulación". Es lo que
Excel en es-AR abre con columnas separadas sin asistente.

### 6.4 Redirects `/cobranza/*`

| Opción | Veredicto |
|---|---|
| **A. `redirects()` en `next.config.ts`, 308, `:path*`** | **Recomendada**: query preservada, cero código, antes del render |
| B. `permanentRedirect()` en pages de `/cobranza/*` | Mantiene 7 archivos muertos |
| C. `proxy.ts` | `proxy.ts` solo refresca sesión (CLAUDE.md) |

### 6.5 Overlay de ingreso

| Opción | Veredicto |
|---|---|
| **A. Host propio `IncomeOverlayHost` (`?ingreso=`) montado junto a `PaymentOverlayHost` en `app-shell.tsx`; `'ingreso'` entra a `OVERLAY_NAMES`** | **Recomendada**: mismo mecanismo (history, deep-link con `replace`, nunca dos apilados), propiedad de archivos disjunta entre los dos agentes de frontend |
| B. Extender `PaymentOverlayHost` para leer dos params | Un host con dos dominios; dos agentes sobre el mismo archivo |

### 6.6 Estado del sponsor

| Opción | Veredicto |
|---|---|
| **A. `is_active` + tríada `deactivated_at/by/reason`, trigger que exige motivo y `sponsors.deactivate`; reactivar permitido (misma clave), la historia queda en `audit_log`** | **Recomendada** (A2) |
| B. Tabla `sponsor_status_events` como los socios | Correcta pero desproporcionada para ~40 sponsors sin estatuto que lo exija |
| C. Solo desactivar, nunca reactivar | Fuerza duplicados; el índice único de nombre los bloquea |

## 7. Arquitectura recomendada

### 7.1 Modelo de datos (SQL completo en el Anexo A)

| Tabla | Columnas clave | Invariantes en Postgres |
|---|---|---|
| `cash_concepts` | `direction` (`'income'`, inmutable), `name`, `requires_sponsor`, `is_active`, `sort_order` | unique `(direction, lower(btrim(name)))`; inmutables `id, direction, created_at`; semilla en la migración: Sponsor (requiere sponsor), Donación, Indumentaria, Evento, Otro |
| `sponsors` | `name`, `contact_name`, `phone`, `email` (lower), `notes`, `is_active`, `deactivated_at/by`, `deactivation_reason`, `created_by` | unique `lower(btrim(name))`; tríada de desactivación (CHECK); guard: cambiar estado exige `sponsors.deactivate` y motivo ≥ 3; editar datos exige `income.register`; inmutables `id, created_by, created_at` |
| `cash_movements` | `direction` (`'income'`), `concept_id` FK, `sponsor_id` FK null, `amount_cents > 0`, `occurred_on` (default hoy club), `method`, `receipt_storage_path like 'cash-receipts/%'`, `receipt_filename`, `description ≤ 500`, **`batch_id` unique**, `created_by`, tríada de anulación | insert guard (DEFINER): fecha no futura y ≥ 2020; concepto activo y del mismo `direction`; sponsor obligatorio si el concepto lo exige; sponsor activo. Update guard: anular una vez con motivo y `income.void`; comprobante solo null→valor, nunca sobre anulado, con `income.register`. Inmutables: todo salvo tríada y comprobante |

Índices: `cash_movements (batch_id)` unique, `(concept_id)`, `(sponsor_id) where sponsor_id is not null`, `(occurred_on desc, id desc)`. Las tres tablas: RLS + `force`, grants por columna, sin DELETE para nadie, `enable_audit`, `service_role` solo SELECT.

**Las cuotas no se tocan**: ni `payments`, ni `fees`, ni ninguna función de deuda. `month_collection`, `daily_collection`, `dashboard_summary`, `debt_by_category`, `monthly_history`, `member_accounts`, `member_fee_statement` y los campos calculados quedan byte a byte iguales (se prueba: insertar un ingreso no cambia ninguna de sus salidas).

### 7.2 Permisos (mapeo fijo de `permissions_for_role`, `create or replace`)

| Permiso | admin | editor | consulta | Habilita |
|---|---|---|---|---|
| `income.read` | ✓ | ✓ | ✓ | leer movimientos, sponsors, conceptos, resumen, CSV (con `reports.export`) |
| `income.register` | ✓ | ✓ | | registrar ingreso, subir comprobante a `cash-receipts/`, crear/editar sponsors |
| `income.void` | ✓ | | | anular ingresos |
| `sponsors.deactivate` | ✓ | | | desactivar / reactivar sponsors |
| `settings.manage` (existente) | ✓ | | | conceptos |

`Permission` en `types.ts` suma las cuatro claves. Todo guard nuevo en TS es
`requirePermission` / `requirePanelPermission`; ningún `requireRole` nuevo.

### 7.3 RPCs (INVOKER, `STABLE`, `set search_path = ''`, permiso en el cuerpo, `revoke from public, anon` + `grant to authenticated`)

| RPC | Devuelve | Permiso |
|---|---|---|
| `cash_month_summary(target_period date default null)` | una fila: `period, total_cents, fees_collected_cents, other_income_cents, cash_cents, transfer_cents, fees_cents, fees_count, payments_count, other_income_count, by_concept jsonb` (`[{concept_id, concept_name, amount_cents, count}]` orden monto desc). Llama a `month_collection(p)` para la parte de cuotas | `payments.read` + `income.read` |
| `sponsor_summaries(target_year int default null, target_sponsor_id bigint default null)` | por sponsor: datos + `year_total_cents`, `all_time_total_cents`, `contributions_count`, `last_contribution_on`, `last_contribution_cents`; activos primero, por nombre | `income.read` |
| `log_export` (`create or replace`) | igual, lista cerrada + `'other_income'` | `reports.export` |

Lo que **no** es RPC (sin agregación, ≤ 500 filas): el listado mensual de
movimientos y el historial de un sponsor son `select` con embed por
PostgREST (`cash_concepts(name), sponsors(name)`) desde el modelo, con
`.limit(500)` documentado.

### 7.4 Storage

Mismo bucket `attachments`, prefijo nuevo **`cash-receipts/<batch_id>/<uuid>.<ext>`**
(el `batch_id` existe antes que la fila: es la carpeta). La policy
`attachments_insert` se **recrea** sumando `cash-receipts` con `can('income.register')`;
los dos prefijos viejos quedan con `has_role('admin','editor')` tal cual
(deuda del slice 1, no se migra acá). Lectura/firma: policy existente (cualquier
rol activo). URL firmada de 60 s al tocar "Ver comprobante", nunca persistida.

### 7.5 Auditoría

`enable_audit` en las tres tablas. Actor de `auth.uid()` (escrituras con el
cliente de sesión; **ningún `createAdminClient()`**). Exportación: `log_export('other_income', filters, row_count)`
antes de devolver el archivo. `audit.model`: `AUDITED_TABLES` + 3,
`AUDIT_FIELD_LABELS` + 3, `buildLabelDraft` ("Sponsor · $50.000 · 13/10/2026",
nombre del sponsor, nombre del concepto). `views/audit/audit-labels.ts`:
"Otros ingresos", "Sponsors", "Conceptos de ingreso".

### 7.6 Rutas y redirects

| Ruta | Page | Permiso de page | Vista |
|---|---|---|---|
| `/caja` | hub | `payments.read` + `income.read` (+ `reports.read` por `dashboard_summary`) | `CajaHubView` |
| `/caja/cuotas?mes=` | ex `/cobranza/pagos` | `payments.read` | `MonthPaymentsView` |
| `/caja/ingresos?mes=&concepto=&sponsor=` | nueva | `income.read` | `OtherIncomeView` |
| `/caja/sponsors` | nueva | `income.read` | `SponsorsView` |
| `/caja/sponsors/[id]` | nueva (historial) | `income.read` | `SponsorDetailView` (+ `not-found.tsx`) |
| `/caja/deuda`, `/caja/al-dia`, `/caja/por-categoria` | movidas | sin cambios | sin cambios |
| `/caja/nuevo` | movida; fallback `'/caja'` | `payments.register` | redirige |
| `GET /api/caja/ingresos/exportar?mes=&concepto=&sponsor=` | route handler | `income.read` + `reports.export` | — (CSV) |
| `/ajustes` | suma sección "Conceptos de ingreso" | `settings.manage` | `IncomeConceptsSection` |

`next.config.ts` → `redirects()`, en este orden, `permanent: true`:
`/cobranza` → `/caja`; `/cobranza/pagos` → `/caja/cuotas`; `/cobranza/:path*` → `/caja/:path*`.
La query viaja sola (`/cobranza/nuevo?socio=5&volver=/socios/5` → `/caja/nuevo?…` → `?pagar=socio:5`).

Overlays: `OverlayName = 'pagar' | 'ver' | 'ingreso'`; `?ingreso=nuevo` y
`?ingreso=sponsor:<id>` (preselecciona el sponsor y el primer concepto
activo con `requires_sponsor`; lo usa "Registrar aporte" en la ficha del
sponsor). Pestañas: Resumen `/caja` · Cuotas `/caja/cuotas` · Otros ingresos
`/caja/ingresos` · Con deuda · Al día · Por categoría. Navegación: `{ href: '/caja', label: 'Caja', icon: Banknote }`.

### 7.7 Capas TypeScript

**`src/models/types.ts`** (firmas exactas en `01-tasks.md` SH1): `Permission` +4,
`CashDirection`, `CashConcept`, `Sponsor`, `SponsorOption`, `SponsorSummary`,
`CashMovement`, `CashConceptTotal`, `CashMonthSummary`, `CashMovementFilters`,
`IncomeFormData`, `SponsorDetail`, `ExportListing`, `AuditedTable` +3.

| Capa | Archivo | Contenido |
|---|---|---|
| M | `models/cash-concepts.model.ts` | schemas Zod; `listCashConcepts({ includeInactive })`, `createCashConcept`, `updateCashConcept`, `setCashConceptActive`, `reorderCashConcepts`; 23505 → "Ya existe un concepto con ese nombre" |
| M | `models/sponsors.model.ts` | schemas; `listSponsorOptions({ includeInactive })`, `listSponsorSummaries(year?)` (RPC), `getSponsorSummary(id)` (RPC con `target_sponsor_id`), `createSponsor`, `updateSponsor`, `setSponsorActive(id, isActive, reason)`; 23505 → "Ya existe un sponsor con ese nombre" (+ "está desactivado: reactivalo" si corresponde) |
| M | `models/cash-movements.model.ts` | `CASH_RECEIPT_PATH_PREFIX`, `buildCashReceiptPath(batchId, mime)`, schemas, `registerCashMovement` (unique de `batch_id` → `alreadyRegistered: true`), `voidCashMovement`, `getCashReceiptPath`, `listCashMovements(filters)` (embed, cap 500), `listSponsorMovements(sponsorId)`; traducción de los mensajes de los guards a `DomainError` con `field` |
| M | `models/reports.model.ts` (ext.) | `getCashMonthSummary(period?)` → RPC, con `.overrideTypes` para `by_concept` |
| M | `models/exports.model.ts` | `logExport(listing, filters, rowCount)` → RPC `log_export` con cliente de sesión |
| M | `models/audit.model.ts` (ext.) | tablas, etiquetas, `buildLabelDraft` (batch de nombres de conceptos/sponsors, sin N+1) |
| C | `controllers/income.controller.ts` | `getOtherIncomePage(filters)`, `getSponsorsPage()`, `getSponsorDetailPage(id)`, `exportOtherIncomeCsv(input: unknown)` (parsea `?mes=&concepto=&sponsor=`, lista, **audita primero**, arma CSV con `lib/csv.ts`) |
| C | `controllers/income.actions.ts` | `registerCashMovement`, `voidCashMovement`, `prepareCashReceiptUpload`, `getCashReceiptUrlAction`, `getIncomeFormData` |
| C | `controllers/sponsors.actions.ts` | `createSponsor`, `updateSponsor`, `setSponsorActive` |
| C | `controllers/settings.controller.ts` / `settings.actions.ts` (ext.) | `incomeConcepts` en `getSettingsPage`; `createCashConcept`, `updateCashConcept`, `setCashConceptActive`, `reorderCashConcepts` (con `requirePermission('settings.manage')`) |
| C | `controllers/reports.controller.ts` (ext.) | `getCobranzaHub` → `getCajaHub(): { cash, summary, billing, daily }` |
| app | `app/api/caja/ingresos/exportar/route.ts` | `GET` → controller → `Response` `text/csv` con `Content-Disposition: attachment`, `Cache-Control: no-store`; errores vía `toApiError` (403/400/500 JSON) |
| V | `views/payments/**` (renombrado) | `caja-hub-view.tsx` (dos heroes, barra partida, panel "Otros ingresos"), `caja-tabs.tsx` (6), resto con hrefs nuevos |
| V | `views/income/**` | `income-overlay-host.tsx`, `income-form-body.tsx`, `income-form.tsx`, `sponsor-combobox.tsx` (con "+ Agregar sponsor"), `income-receipt-upload.ts`, `other-income-view.tsx`, `other-income-list.tsx`, `sponsors-view.tsx`, `sponsor-form-sheet.tsx`, `sponsor-row-menu.tsx`, `deactivate-sponsor-dialog.tsx`, `sponsor-detail-view.tsx` |
| V | `views/settings/income-concepts-section.tsx` (+ `income-concept-form-sheet.tsx`, `income-concept-row.tsx`) | igual que disciplinas/categorías |
| V shared | `overlay-params.ts`/`overlay-values.ts` (`'ingreso'`), `success-moment.tsx` (extraído de `register-payment-sheet`), `ReasonDialog` con `showDate?: boolean`, comentario de `HeroFigure` (excepción explícita de `/caja`) |
| lib | `lib/csv.ts` | `toCsv(rows, { separator: ';', bom: true })` puro y testeable |

### 7.8 Flujos

**Registrar otro ingreso**: botón (solo con `income.register`) → `?ingreso=nuevo` → `IncomeOverlayHost` → `getIncomeFormData()` (conceptos activos + sponsors activos) → formulario (batchId `useState(() => crypto.randomUUID())`) → si transferencia y hay archivo: `prepareCashReceiptUpload({ batchId, mimeType, sizeBytes })` → subida directa → `registerCashMovement({ batchId, conceptId, sponsorId?, amountCents, occurredOn, method, receiptPath?, description? })` → `requirePermission('income.register')` → Zod `.strict()` → `objectExists(receiptPath)` → `insert` (cliente de sesión; guard + policy + audit) → `revalidatePath('/caja', 'layout')` → momento de éxito + toast → cierre por `history`. Doble toque: unique `batch_id` → `alreadyRegistered: true` → mismo éxito.

**Crear sponsor en línea**: en el combobox "+ Agregar sponsor" → `createSponsor({ name })` → se selecciona; el resto de datos se completa después desde `/caja/sponsors`.

**Anular**: menú de fila (solo `income.void`) → `ReasonDialog` (sin fecha) → `voidCashMovement({ movementId, reason })` → `update void_reason` → guard fija `voided_at/by` → fila tachada con motivo; el resumen del mes baja.

**Exportar**: `<a href="/api/caja/ingresos/exportar?mes=2026-10&concepto=3">` → handler → `requirePermission('income.read', 'reports.export')` → lista → `log_export('other_income', { mes, concepto, sponsor }, n)` → CSV.

## 8. Transversales

| Tema | Cómo queda |
|---|---|
| Autorización | RLS/grants por `private.can`; guards TS por permiso; `IncomeOverlayHost` y botones ocultos por `useHasPermission` (UX, no defensa); route handler re-verifica (los layouts no lo cubren) |
| Auditoría y actor | triggers en las tres tablas; actor de sesión; exportación con `log_export`; semilla de conceptos y seed local quedan `system` |
| Nada se borra | sin DELETE; anulación con motivo; sponsors y conceptos se desactivan; concepto desactivado deja de ofrecerse pero los movimientos viejos lo muestran (FK `restrict`) |
| Dinero | `bigint` centavos, CHECK `> 0`; totales solo de RPC; CSV en pesos enteros |
| Zona horaria | `occurred_on` default `private.club_today()`; mes = `between p and p_end`; "año" = `extract(year from occurred_on)`; sin tz en `date` |
| Idempotencia | `batch_id` unique; reintento = éxito repetido con la fila existente |
| Datos personales | contacto de sponsors sin logs (ids y montos sí); comprobantes en bucket privado, URL firmada 60 s; CSV auditado (es el momento en que salen datos) |
| Fallos | overlay con carga/error; subida fallida muestra el error bajo el selector; `alreadyRegistered`; concepto/sponsor desactivado entre abrir y enviar → `DomainError` del guard con `field`; CSV con error → JSON 4xx/5xx y la UI muestra toast |
| Migración | solo `create`/`create or replace` + recreación de **una** policy de storage; reversa documentada en el encabezado; `log_export` redefinida (la vigente es la más nueva) |
| Revalidación | ingresos y sponsors: `revalidatePath('/caja', 'layout')`; conceptos: `/ajustes` + `/caja` layout; **no** `/` (Inicio no cambia) |
| Rename | `git mv` + reemplazo mecánico de strings en el hilo principal **antes** de repartir, para que ningún agente toque archivos fuera de su lane por el rename |

## 9. Decisiones abiertas

Aplicado el frame de `grilling` como auto-entrevista: cada pregunta trae la
respuesta recomendada; el plan está escrito con esas respuestas.

### Para Tomás (A)

| # | Pregunta | Recomendación |
|---|---|---|
| A1 | ¿Sponsor **obligatorio** cuando el concepto es "Sponsor"? (flag `requires_sponsor` por concepto, trigger) | Sí. Sin esto "¿cuánto aportó este sponsor?" miente |
| A2 | ¿Se puede **reactivar** un sponsor desactivado (mismo permiso `sponsors.deactivate`)? | Sí; el motivo de la baja queda en auditoría |
| A3 | ¿Actualizar los 3 hrefs de `views/dashboard/*` a `/caja/*` dentro del rename mecánico (sin cambio visual)? | Sí |
| A4 | CSV: `;` + BOM + pesos enteros + anulados incluidos con columna Estado | Sí |
| A5 | Redirects `permanent: true` (308) | Sí, verificados en local antes del commit |
| A6 | Historial del sponsor como **página** `/caja/sponsors/[id]` (no sheet) | Sí: bookmarkeable, con "Registrar aporte" que abre `?ingreso=sponsor:<id>` |
| A7 | Nombre de sponsor **único** (sin tildes/mayúsculas) | Sí; el error dice si el duplicado está desactivado |
| A8 | Año de "aportado en el año" = año calendario en curso, sin selector | Sí (si hace falta, `?anio=` después) |
| A9 | Tabla de movimientos genérica `cash_movements`/`cash_concepts` con `direction` (vs. `other_incomes`) | Sí (§6.1) |

### Para la Comisión (C)

| # | Pregunta |
|---|---|
| C1 | Confirmar el requerimiento fuera de Fase 1 (contrato 7.3): otros ingresos, sponsors y conceptos |
| C2 | ¿Los datos de contacto de un sponsor (persona, teléfono, email) los puede ver toda la Comisión (`consulta`) o solo quienes registran? Hoy la propuesta: todos |
| C3 | ¿Secretaría (`editor`) crea y edita sponsors? Propuesta: sí (está en `income.register`) |
| C4 | Nombres de la semilla de conceptos (Sponsor, Donación, Indumentaria, Evento, Otro): ¿falta alguno de uso real (rifa, buffet, alquiler de cancha)? |

---

## Anexo A — Migración propuesta `supabase/migrations/20261013120000_cash_other_income.sql`

**La escribe el hilo principal**; ningún agente toca `supabase/**`. Antes de
aplicarla: `npm run db:start`, releer con la skill `supabase-postgres-best-practices`.
Si A1 se rechaza, quitar `requires_sponsor` (columna, grant, semilla y el
bloque del guard). Si A2 se rechaza, en `sponsors_update_guard` rechazar
`false → true`.

```sql
-- =============================================================================
-- Caja: otros ingresos, sponsors y conceptos
-- (pipeline docs/pipelines/2026-10-13-caja-otros-ingresos/).
--
-- Ingresos que no son cuota (sponsors, indumentaria, eventos…) en una tabla
-- de MOVIMIENTOS DE CAJA con sentido (`direction`). Hoy el CHECK solo admite
-- 'income': los egresos de mañana relajan el CHECK y suman UI sin cambiar la
-- forma. Las cuotas siguen en `payments`: la deuda se deriva de ahí y esta
-- migración no toca ninguna función de deuda ni de estado de cuenta.
--
-- Reversa: drop de cash_movements, sponsors, cash_concepts y sus funciones y
-- RPC; restaurar permissions_for_role (20260927125000), log_export
-- (20260927130200) y la policy attachments_insert (20260925120300).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permisos nuevos (catálogo: claves estables, se agregan, nunca se renombran)
--   income.read          otros ingresos, sponsors y conceptos (lectura)
--   income.register      registrar ingresos, subir comprobante, crear/editar sponsors
--   income.void          anular ingresos
--   sponsors.deactivate  desactivar y reactivar sponsors
-- Los conceptos se administran con settings.manage, que ya existe.
-- `create or replace` conserva los grants de la función.
-- -----------------------------------------------------------------------------
create or replace function private.permissions_for_role(role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case role
    when 'admin' then array[
      'members.read', 'members.write', 'members.status',
      'payments.read', 'payments.register', 'payments.void',
      'billing.configure', 'settings.manage', 'users.manage', 'audit.read',
      'reports.read', 'reports.export',
      'income.read', 'income.register', 'income.void', 'sponsors.deactivate'
    ]
    when 'editor' then array[
      'members.read', 'members.write',
      'payments.read', 'payments.register',
      'reports.read', 'reports.export',
      'income.read', 'income.register'
    ]
    when 'consulta' then array[
      'members.read', 'payments.read', 'reports.read', 'reports.export',
      'income.read'
    ]
    else array[]::text[]
  end;
$$;

-- -----------------------------------------------------------------------------
-- cash_concepts: conceptos de caja. Datos, no enums: el club los administra
-- desde /ajustes. Hoy solo de ingreso.
-- -----------------------------------------------------------------------------
create table public.cash_concepts (
  id bigint generated always as identity primary key,
  -- Mañana: check (direction in ('income', 'expense')). Inmutable: un
  -- concepto nunca cambia de sentido.
  direction text not null default 'income' check (direction in ('income')),
  name text not null check (length(btrim(name)) >= 2 and length(name) <= 120),
  -- Un movimiento con este concepto exige sponsor (lo hace cumplir el guard
  -- de cash_movements). Semilla: solo "Sponsor".
  requires_sponsor boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cash_concepts is
  'Conceptos de caja que administra el club. direction = income hoy; los egresos relajan el CHECK.';

-- Unique por sentido: mañana "Indumentaria" puede ser ingreso (venta) y egreso (compra).
create unique index cash_concepts_name_key on public.cash_concepts (direction, lower(btrim(name)));

create trigger cash_concepts_set_updated_at
  before update on public.cash_concepts
  for each row execute function private.set_updated_at();

create trigger cash_concepts_immutable
  before update on public.cash_concepts
  for each row execute function private.protect_immutable_columns('id', 'direction', 'created_at');

alter table public.cash_concepts enable row level security;
alter table public.cash_concepts force row level security;

create policy cash_concepts_select on public.cash_concepts
  for select to authenticated
  using ((select private.can('income.read')));
create policy cash_concepts_insert on public.cash_concepts
  for insert to authenticated
  with check ((select private.can('settings.manage')));
create policy cash_concepts_update on public.cash_concepts
  for update to authenticated
  using ((select private.can('settings.manage')))
  with check ((select private.can('settings.manage')));

revoke all on public.cash_concepts from anon, authenticated, service_role;
grant select on public.cash_concepts to authenticated, service_role;
grant insert (direction, name, requires_sponsor, is_active, sort_order) on public.cash_concepts to authenticated;
grant update (name, requires_sponsor, is_active, sort_order) on public.cash_concepts to authenticated;

select private.enable_audit('public.cash_concepts');

-- Semilla en la migración (no en seed.sql): el proyecto hosted nace de las
-- migraciones. El club los renombra o desactiva desde /ajustes. Corre como
-- postgres sin sesión: la auditoría los registra como 'system'.
insert into public.cash_concepts (direction, name, requires_sponsor, sort_order) values
  ('income', 'Sponsor', true, 1),
  ('income', 'Donación', false, 2),
  ('income', 'Indumentaria', false, 3),
  ('income', 'Evento', false, 4),
  ('income', 'Otro', false, 5)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- sponsors: catálogo. Un sponsor NO es un socio (decisión de Tomás).
-- -----------------------------------------------------------------------------
create table public.sponsors (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) >= 2 and length(name) <= 120),
  -- Datos de contacto de una persona: datos personales (Ley 25.326). Nunca en logs.
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or (email = lower(email) and length(email) <= 254)),
  notes text check (notes is null or length(notes) <= 1000),
  -- Desactivar = is_active false + motivo. Reactivar vuelve la tríada a null;
  -- el motivo de la baja queda en audit_log (A2).
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivated_by uuid,
  deactivation_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sponsors_deactivation_triad check (
    (is_active and deactivated_at is null and deactivated_by is null and deactivation_reason is null)
    or (not is_active and deactivated_at is not null and deactivated_by is not null
        and deactivation_reason is not null and length(btrim(deactivation_reason)) >= 3)
  )
);

comment on table public.sponsors is
  'Catálogo de sponsors. Nunca se borra: se desactiva con motivo. Sus aportes viven en cash_movements.';

create unique index sponsors_name_key on public.sponsors (lower(btrim(name)));

create trigger sponsors_set_updated_at
  before update on public.sponsors
  for each row execute function private.set_updated_at();

create trigger sponsors_immutable
  before update on public.sponsors
  for each row execute function private.protect_immutable_columns('id', 'created_by', 'created_at');

-- Dos cosas cambian de un sponsor y piden permisos distintos:
--   - sus datos (nombre, contacto): income.register;
--   - su estado (desactivar con motivo / reactivar): sponsors.deactivate.
-- Una policy FOR UPDATE no distingue columnas: lo distingue este guard.
create function private.sponsors_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  status_change boolean := new.is_active is distinct from old.is_active;
  triad_change boolean := new.deactivated_at is distinct from old.deactivated_at
    or new.deactivated_by is distinct from old.deactivated_by
    or new.deactivation_reason is distinct from old.deactivation_reason;
  data_change boolean := new.name is distinct from old.name
    or new.contact_name is distinct from old.contact_name
    or new.phone is distinct from old.phone
    or new.email is distinct from old.email
    or new.notes is distinct from old.notes;
begin
  if triad_change and not status_change then
    raise exception 'El estado del sponsor se cambia desactivándolo o reactivándolo'
      using errcode = 'check_violation';
  end if;

  if status_change then
    if not private.can('sponsors.deactivate') then
      raise exception 'No tenés permiso para desactivar o reactivar sponsors'
        using errcode = 'insufficient_privilege';
    end if;
    if not new.is_active then
      if new.deactivation_reason is null or length(btrim(new.deactivation_reason)) < 3 then
        raise exception 'Para desactivar un sponsor hace falta un motivo' using errcode = 'check_violation';
      end if;
      new.deactivated_at := now();
      new.deactivated_by := auth.uid();
    else
      new.deactivated_at := null;
      new.deactivated_by := null;
      new.deactivation_reason := null;
    end if;
  end if;

  if data_change and not private.can('income.register') then
    raise exception 'No tenés permiso para editar sponsors' using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger sponsors_update_guard
  before update on public.sponsors
  for each row execute function private.sponsors_update_guard();

alter table public.sponsors enable row level security;
alter table public.sponsors force row level security;

create policy sponsors_select on public.sponsors
  for select to authenticated
  using ((select private.can('income.read')));
create policy sponsors_insert on public.sponsors
  for insert to authenticated
  with check ((select private.can('income.register')) and created_by = (select auth.uid()));
create policy sponsors_update on public.sponsors
  for update to authenticated
  using ((select private.can('income.register')) or (select private.can('sponsors.deactivate')))
  with check ((select private.can('income.register')) or (select private.can('sponsors.deactivate')));

revoke all on public.sponsors from anon, authenticated, service_role;
grant select on public.sponsors to authenticated, service_role;
grant insert (name, contact_name, phone, email, notes) on public.sponsors to authenticated;
-- deactivated_at / deactivated_by los fija el guard, no hace falta grant.
grant update (name, contact_name, phone, email, notes, is_active, deactivation_reason) on public.sponsors to authenticated;

select private.enable_audit('public.sponsors');

-- -----------------------------------------------------------------------------
-- cash_movements: el libro de caja (hoy, solo ingresos que no son cuota).
--
-- Un movimiento es un lote de uno: batch_id lo genera el formulario UNA vez y
-- es la idempotencia del submit (doble toque con mala señal = éxito repetido,
-- no dos ingresos). Nada se edita: se anula con motivo.
-- -----------------------------------------------------------------------------
create table public.cash_movements (
  id bigint generated always as identity primary key,
  -- Mañana: check (direction in ('income', 'expense')). La policy de INSERT
  -- también exige 'income': relajar esto es una migración con su pipeline.
  direction text not null default 'income' check (direction in ('income')),
  concept_id bigint not null references public.cash_concepts (id) on delete restrict,
  sponsor_id bigint references public.sponsors (id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  occurred_on date not null default private.club_today(),
  method text not null check (method in ('cash', 'transfer')),
  -- Ruta en el bucket `attachments`, nunca una URL. Carpeta = batch_id (existe
  -- antes que la fila: la subida es en dos pasos).
  receipt_storage_path text check (receipt_storage_path is null or receipt_storage_path like 'cash-receipts/%'),
  receipt_filename text,
  description text check (description is null or length(description) <= 500),
  batch_id uuid not null,
  -- Nullable solo por el seed. Desde la app la policy exige created_by = auth.uid().
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,

  constraint cash_movements_void_triad check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null
        and length(btrim(void_reason)) >= 3)
  )
);

comment on table public.cash_movements is
  'Movimientos de caja que no son cuota. Nunca tocan la deuda ni el estado de cuenta: eso vive en fees/payments.';

create unique index cash_movements_batch_id_key on public.cash_movements (batch_id);
create index cash_movements_concept_id_idx on public.cash_movements (concept_id);
create index cash_movements_sponsor_id_idx on public.cash_movements (sponsor_id) where sponsor_id is not null;
create index cash_movements_occurred_on_idx on public.cash_movements (occurred_on desc, id desc);

create trigger cash_movements_immutable
  before update on public.cash_movements
  for each row execute function private.protect_immutable_columns(
    'id', 'direction', 'concept_id', 'sponsor_id', 'amount_cents', 'occurred_on', 'method',
    'description', 'batch_id', 'created_by', 'created_at'
  );

-- SECURITY DEFINER (review B4 del slice 2): lee conceptos y sponsors sin
-- depender de la RLS de quien escribe.
create function private.cash_movements_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  concept record;
  sponsor_active boolean;
begin
  if new.occurred_on > private.club_today() then
    raise exception 'La fecha del ingreso no puede ser futura' using errcode = 'check_violation';
  end if;
  if new.occurred_on < date '2020-01-01' then
    raise exception 'La fecha del ingreso es demasiado vieja' using errcode = 'check_violation';
  end if;

  select c.direction, c.is_active, c.requires_sponsor into concept
  from public.cash_concepts c
  where c.id = new.concept_id;

  if not found then
    raise exception 'El concepto no existe' using errcode = 'foreign_key_violation';
  end if;
  if not concept.is_active then
    raise exception 'El concepto está desactivado' using errcode = 'check_violation';
  end if;
  if concept.direction <> new.direction then
    raise exception 'El concepto no corresponde a este tipo de movimiento' using errcode = 'check_violation';
  end if;
  if concept.requires_sponsor and new.sponsor_id is null then
    raise exception 'Elegí el sponsor' using errcode = 'check_violation';
  end if;

  if new.sponsor_id is not null then
    select s.is_active into sponsor_active from public.sponsors s where s.id = new.sponsor_id;
    if sponsor_active is null then
      raise exception 'El sponsor no existe' using errcode = 'foreign_key_violation';
    end if;
    if not sponsor_active then
      raise exception 'El sponsor está desactivado' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger cash_movements_insert_guard
  before insert on public.cash_movements
  for each row execute function private.cash_movements_insert_guard();

-- Dos cosas se actualizan de un movimiento, y ninguna se deshace:
--   - la anulación: una vez, con motivo, solo con income.void;
--   - el comprobante: null → valor, una vez; nunca sobre un movimiento anulado.
create function private.cash_movements_update_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  voiding boolean := new.voided_at is distinct from old.voided_at
    or new.voided_by is distinct from old.voided_by
    or new.void_reason is distinct from old.void_reason;
  attaching boolean := new.receipt_storage_path is distinct from old.receipt_storage_path
    or new.receipt_filename is distinct from old.receipt_filename;
begin
  if voiding then
    if old.voided_at is not null then
      raise exception 'Este ingreso ya está anulado' using errcode = 'check_violation';
    end if;
    if new.void_reason is null or length(btrim(new.void_reason)) < 3 then
      raise exception 'Para anular un ingreso hace falta un motivo' using errcode = 'check_violation';
    end if;
    if not private.can('income.void') then
      raise exception 'No tenés permiso para anular ingresos' using errcode = 'insufficient_privilege';
    end if;
    new.voided_by := auth.uid();
    new.voided_at := now();
  end if;

  if attaching then
    if old.voided_at is not null or voiding then
      raise exception 'Un ingreso anulado no lleva comprobante' using errcode = 'check_violation';
    end if;
    if old.receipt_storage_path is not null then
      raise exception 'El comprobante ya está cargado y no se reemplaza' using errcode = 'check_violation';
    end if;
    if new.receipt_storage_path is null then
      raise exception 'Falta el archivo del comprobante' using errcode = 'check_violation';
    end if;
    if not private.can('income.register') then
      raise exception 'No tenés permiso para adjuntar comprobantes' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger cash_movements_update_guard
  before update on public.cash_movements
  for each row execute function private.cash_movements_update_guard();

alter table public.cash_movements enable row level security;
alter table public.cash_movements force row level security;

create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using ((select private.can('income.read')));
create policy cash_movements_insert on public.cash_movements
  for insert to authenticated
  with check (
    (select private.can('income.register'))
    and created_by = (select auth.uid())
    and direction = 'income'
  );
create policy cash_movements_update on public.cash_movements
  for update to authenticated
  using ((select private.can('income.register')) or (select private.can('income.void')))
  with check ((select private.can('income.register')) or (select private.can('income.void')));

revoke all on public.cash_movements from anon, authenticated, service_role;
grant select on public.cash_movements to authenticated, service_role;
grant insert (direction, concept_id, sponsor_id, amount_cents, occurred_on, method,
              receipt_storage_path, receipt_filename, description, batch_id)
  on public.cash_movements to authenticated;
grant update (voided_at, voided_by, void_reason, receipt_storage_path, receipt_filename)
  on public.cash_movements to authenticated;

select private.enable_audit('public.cash_movements');

-- -----------------------------------------------------------------------------
-- Storage: prefijo cash-receipts/ en el bucket privado existente. Los dos
-- prefijos del slice 1 quedan con has_role (deuda que migra el pipeline de
-- roles); el nuevo ya chequea permiso.
-- -----------------------------------------------------------------------------
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (
      ((storage.foldername(name))[1] in ('medical-clearances', 'payment-receipts')
        and (select private.has_role('admin', 'editor')))
      or ((storage.foldername(name))[1] = 'cash-receipts'
        and (select private.can('income.register')))
    )
  );

-- -----------------------------------------------------------------------------
-- Resumen de caja del mes. La parte de cuotas sale de month_collection: UNA
-- definición de "cobrado en cuotas" para el inicio, /caja/cuotas y acá.
-- Mañana los egresos suman expense_cents y total pasa a ser neto, sin tocar
-- la UI de hoy.
-- -----------------------------------------------------------------------------
create function public.cash_month_summary(target_period date default null)
returns table (
  period date,
  total_cents bigint,
  fees_collected_cents bigint,
  other_income_cents bigint,
  cash_cents bigint,
  transfer_cents bigint,
  fees_cents bigint,
  fees_count integer,
  payments_count integer,
  other_income_count integer,
  by_concept jsonb
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  p date := date_trunc('month', coalesce(target_period, private.club_today()))::date;
  p_end date := (date_trunc('month', coalesce(target_period, private.club_today())) + interval '1 month' - interval '1 day')::date;
  mc record;
begin
  perform private.require_permission('payments.read');
  perform private.require_permission('income.read');

  select * into mc from public.month_collection(p);

  return query
  with other as (
    select
      coalesce(sum(m.amount_cents), 0)::bigint as total,
      coalesce(sum(m.amount_cents) filter (where m.method = 'cash'), 0)::bigint as cash,
      coalesce(sum(m.amount_cents) filter (where m.method = 'transfer'), 0)::bigint as transfer,
      count(m.id)::integer as n
    from public.cash_movements m
    where m.direction = 'income' and m.voided_at is null and m.occurred_on between p and p_end
  ),
  per_concept as (
    select m.concept_id, sum(m.amount_cents)::bigint as total, count(*)::integer as n
    from public.cash_movements m
    where m.direction = 'income' and m.voided_at is null and m.occurred_on between p and p_end
    group by m.concept_id
  ),
  concepts_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('concept_id', c.id, 'concept_name', c.name, 'amount_cents', pc.total, 'count', pc.n)
        order by pc.total desc, c.sort_order, c.name
      ),
      '[]'::jsonb
    ) as j
    from per_concept pc
    join public.cash_concepts c on c.id = pc.concept_id
  )
  select
    p,
    (mc.collected_cents + other.total)::bigint,
    mc.collected_cents,
    other.total,
    (mc.cash_cents + other.cash)::bigint,
    (mc.transfer_cents + other.transfer)::bigint,
    mc.fees_cents,
    mc.fees_count,
    mc.payments_count,
    other.n,
    concepts_json.j
  from other, concepts_json;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sponsors con lo aportado en el año (calendario, por occurred_on) y el
-- último aporte. Activos primero. target_sponsor_id = la ficha de uno.
-- -----------------------------------------------------------------------------
create function public.sponsor_summaries(target_year integer default null, target_sponsor_id bigint default null)
returns table (
  sponsor_id bigint,
  name text,
  is_active boolean,
  contact_name text,
  phone text,
  email text,
  notes text,
  deactivated_at timestamptz,
  deactivation_reason text,
  year_total_cents bigint,
  all_time_total_cents bigint,
  contributions_count integer,
  last_contribution_on date,
  last_contribution_cents bigint
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  y integer := coalesce(target_year, extract(year from private.club_today())::integer);
begin
  perform private.require_permission('income.read');

  return query
  select
    s.id,
    s.name,
    s.is_active,
    s.contact_name,
    s.phone,
    s.email,
    s.notes,
    s.deactivated_at,
    s.deactivation_reason,
    coalesce(sum(m.amount_cents) filter (where extract(year from m.occurred_on) = y), 0)::bigint,
    coalesce(sum(m.amount_cents), 0)::bigint,
    count(m.id)::integer,
    (select l.occurred_on from public.cash_movements l
      where l.sponsor_id = s.id and l.voided_at is null
      order by l.occurred_on desc, l.id desc limit 1),
    (select l.amount_cents from public.cash_movements l
      where l.sponsor_id = s.id and l.voided_at is null
      order by l.occurred_on desc, l.id desc limit 1)
  from public.sponsors s
  left join public.cash_movements m
    on m.sponsor_id = s.id and m.direction = 'income' and m.voided_at is null
  where target_sponsor_id is null or s.id = target_sponsor_id
  group by s.id
  order by s.is_active desc, lower(s.name);
end;
$$;

-- -----------------------------------------------------------------------------
-- log_export: suma 'other_income' a la lista cerrada. Es la definición
-- vigente (la de la migración más nueva manda). Los grants se conservan.
-- -----------------------------------------------------------------------------
create or replace function public.log_export(listing text, filters jsonb, row_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can('reports.export') then
    raise exception 'No tenés permiso para exportar' using errcode = 'insufficient_privilege';
  end if;

  if listing is null or listing not in (
    'members', 'debt', 'up_to_date', 'debt_by_category', 'month_payments', 'audit', 'other_income'
  ) then
    raise exception 'Listado desconocido' using errcode = 'invalid_parameter_value';
  end if;
  if filters is not null and pg_column_size(filters) > 4096 then
    raise exception 'Los filtros son demasiado grandes' using errcode = 'invalid_parameter_value';
  end if;
  if row_count is null or row_count < 0 then
    raise exception 'Cantidad de filas inválida' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.audit_log (actor_id, actor_source, op, table_name, record_id, context)
  values (
    auth.uid(),
    'session',
    'EXPORT',
    listing,
    null,
    jsonb_build_object('listing', listing, 'filters', coalesce(filters, '{}'::jsonb), 'row_count', row_count)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants de las RPC nuevas y cierre de private
-- -----------------------------------------------------------------------------
revoke execute on function
  public.cash_month_summary(date),
  public.sponsor_summaries(integer, bigint)
from public, anon;

grant execute on function
  public.cash_month_summary(date),
  public.sponsor_summaries(integer, bigint)
to authenticated;

-- Las funciones nuevas de private son triggers: no necesitan EXECUTE para el
-- rol que dispara el trigger (igual que payments_update_guard). Los helpers
-- que usan las policies ya tienen su grant de migraciones anteriores, y este
-- revoke solo toca public/anon.
revoke execute on all functions in schema private from public, anon;
```

## Anexo B — Seed local (`supabase/seed.sql`, solo datos inventados)

Después del bloque de pagos: dos sponsors activos (uno con contacto y
teléfono ficticios), uno desactivado con motivo (tríada completa con el uuid
de relleno `00000000-0000-0000-0000-000000000000`, igual que el pago anulado
del seed); cinco movimientos con `batch_id` fijos (`b0000000-…-0001` …
`-0005`): un aporte de sponsor por transferencia de este mes, una venta de
indumentaria en efectivo con detalle, un evento, uno del mes pasado y uno
anulado con motivo. Sin `created_by` (corre sin sesión).
