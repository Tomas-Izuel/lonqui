# 03 — Review: Caja y otros ingresos

**Veredicto: APPROVED** (sin bloqueantes ni importantes; hay hallazgos menores que conviene resolver, ninguno frena el commit).

## Alcance revisado

`git diff main` + archivos nuevos sin trackear de la feature: migración `20261013120000_cash_other_income.sql`, `seed.sql`, `database.types.ts` (solo lo de caja), models (`cash-movements`, `cash-concepts`, `sponsors`, `exports`, `reports`, `audit`, `types`), controllers (`income.*`, `sponsors.actions`, `reports.*`, `settings.*`, `billing.actions` comentario), `app/api/caja/ingresos/exportar/route.ts`, `lib/csv.ts`, `next.config.ts`, pages de `/caja/**` y `/ajustes`, `views/income/**`, `views/payments/caja-*`, `views/settings/income-*`, `views/shared/**`, `views/shell/**`, `views/audit/audit-labels.ts`. No se revisó `tests/**` ni lo de keep-alive. Los dos arreglos visuales en curso en `views/income/**` quedan fuera.

Verificado contra la base local (solo lectura, `begin read only` + claims de admin): las tablas, triggers, policies y grants existen como la migración los declara; `cash_month_summary()` devuelve `fees_collected_cents` idéntico a `month_collection().collected_cents` (5.500.000 en la seed) y suma otros ingresos aparte; `sponsor_summaries()` responde; `private.permissions_for_role` conserva todos los permisos previos y suma los 4 nuevos. `npx tsc --noEmit` y `npx eslint src`: limpios.

## Checklist específica del lane review

| Punto | Resultado |
|---|---|
| Ninguna función de deuda/cobranza modificada | OK. La migración nueva solo reemplaza `permissions_for_role` (superconjunto), `log_export` (suma `other_income`, conserva grants) y la policy `attachments_insert`. `month_collection` se reusa, no se redefine |
| `direction` cerrado en CHECK y policy | OK en `cash_movements` (CHECK + `with check direction = 'income'`) y en `cash_concepts` (CHECK; el trigger de insert exige coincidencia concepto/movimiento) |
| `batch_id` nunca regenerado en el servidor | OK. Se valida `z.uuid()` y se inserta tal cual; el reintento resuelve por el índice único `cash_movements_batch_id_key` |
| Guards DEFINER solo donde leen otras tablas | OK: `cash_movements_insert_guard` DEFINER; `sponsors_update_guard` y `cash_movements_update_guard` INVOKER. ACL de las tres: solo `postgres` |
| `log_export` antes del CSV y no devuelve si falla | OK (`income.controller.ts`: `await logExport(...)` antes de armar el body; `logExport` tira si hay error; la lista cerrada y el permiso se validan en la RPC) |
| Route handler sin `@supabase/*` ni modelos | OK, solo importa el controller y `toApiError`; `no-store` y `force-dynamic` |
| `cash_month_summary` reusa `month_collection` | OK |
| `getCajaHub` toma deuda de `dashboard_summary` | OK (`getDashboardSummary`; no se recalcula) |
| Sin `requireRole`/`has_role`/`is_admin`/`session.role`/`createAdminClient()` en código nuevo | OK (grep limpio). El único `has_role` nuevo es la copia textual de la rama de los dos prefijos viejos en `attachments_insert`, documentada como deuda del pipeline de roles |
| `revalidatePath('/caja', 'layout')` en toda escritura | OK en income, sponsors y conceptos |
| URLs firmadas nunca persistidas | OK: 60 s, se piden al tocar; la base guarda solo `receipt_storage_path` (con CHECK de prefijo) |
| Redirects en orden y con query | OK: `/cobranza` → `/caja`, `/cobranza/pagos` → `/caja/cuotas` antes del comodín; Next conserva la query |
| Ningún `/cobranza` vivo en `src/` | OK |
| Dos `HeroFigure` solo en `/caja` | OK (`caja-hub-view`, cada una en su `Panel` hermano; el inicio mantiene una) |
| Copy sin "eliminar" | OK ("Anular ingreso", "Desactivar") |
| `ReasonDialog showDate` retrocompatible | OK: default `true`, mismo schema y comportamiento para los llamadores viejos |
| Targets 44 px | OK (`h-11`/`h-12`/`min-h-11`/`size-11`) |
| CSV | OK: `;`, BOM, CRLF, citado; fórmulas neutralizadas con `safeText` en todo texto libre (concepto, sponsor, detalle, cargó, motivo); montos enteros |

## Hallazgos

### Bloqueantes
Ninguno.

### Importantes
Ninguno.

### Menores

1. **Exportación con techo mudo de 20.000 filas** — `src/models/cash-movements.model.ts:~270` (`EXPORT_MAX_ROWS`). Si se llegara al techo, el CSV sale incompleto y `log_export` registra el `row_count` truncado, sin aviso. Hoy es inalcanzable (un mes de otros ingresos), pero es el mismo corte silencioso que la regla de PostgREST busca evitar. Fix: tirar un `DomainError` ("Demasiados ingresos, filtrá por concepto o sponsor") al llegar al techo en vez de cortar. **Dueño: B1.**

2. **El link "Exportar CSV" usa `<a download>` hacia un endpoint que puede devolver JSON de error** — `src/views/income/other-income-view.tsx:121`. Con 403/400/500 el navegador descarga un archivo con el JSON de error, nombrado como el CSV. Fix: sin `download` (el `Content-Disposition` del servidor ya fuerza la descarga y un error se vería como texto), o disparar el pedido con `fetch` y mostrar un toast. **Dueño: F2.**

3. **`receiptPath` no se ata al `batchId` ni se verifica que no esté usado** — `income.actions.ts` / `registerCashMovementSchema`. Solo se exige el prefijo `cash-receipts/` y que el objeto exista. Un usuario con `income.register` podría asociar a un ingreso nuevo un comprobante ya subido a otro movimiento si conociera la ruta (UUID, no adivinable): impacto bajo, pero el path armado por el servidor ya incluye `<batchId>`. Fix: exigir `path.startsWith('cash-receipts/<batchId>/')`. **Dueño: B1.**

4. **Un reintento con el mismo `batchId` devuelve éxito aunque el payload sea distinto o de otro usuario** — `registerCashMovement` (`isBatchAlreadyRegistered`). Mismo comportamiento que `payments`; es aceptable porque el `batchId` nace con el formulario, pero conviene dejarlo asentado. Fix opcional: comparar `amount_cents`/`concept_id` con lo pedido y tirar `DomainError` si difieren. **Dueño: B1.**

5. **`translateGuardError` no traduce "El estado del sponsor se cambia desactivándolo o reactivándolo"** (check_violation del guard) — `sponsors.model.ts`. Cae al genérico. Inalcanzable desde la UI; sí con PostgREST directo, donde ya hay error. Nit. **Dueño: B1.**

6. **Escrituras de conceptos con `.single()` / `Promise.all` sin chequear filas** — `cash-concepts.model.ts` (`updateCashConcept`, `setCashConceptActive`: un id inexistente da error PGRST116 genérico en vez de 404; `reorderCashConcepts`: N updates no atómicos, sin verificar que todos los ids existan). Sin consecuencia de integridad (la RLS y `settings.manage` son la barrera), solo mensajes. Fix: `.maybeSingle()` + `DomainError('El concepto no existe', 404)`. **Dueño: B2.**

7. **BOM como carácter literal invisible en el fuente** — `src/lib/csv.ts` (`(bom ? '﻿' : '')`). Funciona (verificado, 3 bytes `EF BB BF`), pero un editor o formateador puede borrarlo sin que se note. Fix: `'﻿'`. **Dueño: shared.**

8. **Comentarios obsoletos** — varios archivos de `views/payments/**` siguen citando `route-cobranza.md` (renombrado a `route-caja.md`); el comentario de `income.controller.ts` dice `/caja/otros` y la ruta real es `/caja/ingresos`. Cosmético. **Dueño: F1 / B1.**

9. **`CajaHubView` es un Client Component completo** — `views/payments/caja-hub-view.tsx` (`'use client'` por los `useOverlayParam`). Hereda el patrón del hub anterior y es funcional, pero empuja al cliente la lógica de barras que podría ser servidor, dejando como isla solo los dos botones. Mejora de rendimiento opcional, no de esta feature. **Dueño: F1.**

### Notas (sin acción)

- El audit_log captura `phone`, `email` y `contact_name` de sponsors en `old_data`/`new_data`. Es esperable (la auditoría registra "qué cambió") y solo lo lee `admin` desde `/auditoria`; los logs de aplicación no los incluyen (`log.ts` descarta `details` y mensajes fuera de 23/42/PGRST).
- `attachments_select` deja que cualquier usuario con rol firme cualquier objeto del bucket (incluye `cash-receipts/`); igual que los prefijos previos. Revisar cuando existan roles configurables.
- Cobertura a pedirle a `test-engineer` (por si no está en `03-tests.md`): RLS por rol sobre las tres tablas (editor no anula ni desactiva; consulta no escribe); `sponsors_update_guard` (reactivar limpia la tríada; cambiar solo la tríada falla); guard de insert (concepto/sponsor inactivo, `requires_sponsor`, fecha futura/<2020); idempotencia por `batch_id`; `log_export('other_income')` con actor; `cash_month_summary` con un `fees_collected_cents` igual a `month_collection`; export con fórmulas (`=`, `+`, `-`, `@`) en `description`.

## Bloqueantes

Ninguno.

## Qué está bien

- La migración es de manual: RLS `force`, grants por columna, `direction` cerrado dos veces, inmutables por trigger, anulación y desactivación con tríada y motivo obligatorio, permisos de `private.can` en SQL (la policy de update admite dos permisos y el guard separa cuál columna exige cuál), índices en toda FK y para el listado, `revoke` de `public, anon` en las RPC y el cierre de `private`.
- Nada se borra ni se edita: ni `DELETE` ni `grant delete`; el monto, el concepto, el sponsor y la fecha son inmutables; el comprobante se adjunta una sola vez.
- Auditoría por triggers (`enable_audit`) con actor de sesión; todas las escrituras van con el cliente de sesión; la exportación se audita antes de entregar.
- Los totales salen de RPC (`cash_month_summary`, `sponsor_summaries`), ninguna suma de centavos en TS; la cifra de cuotas es la misma definición de `month_collection`.
- El controller del export defiende contra inyección de fórmulas, y el route handler es una cáscara fina.
- Idempotencia del submit con `batch_id` generado una vez en el formulario, reintento tratado como éxito, archivo ya subido recordado para no resubirlo.
- Buena disciplina de capas y de copy: sin `/cobranza` residual, redirects con orden correcto, formularios con `method`, estados de carga/vacío/error, `ReasonDialog` extendido sin romper llamadores.
