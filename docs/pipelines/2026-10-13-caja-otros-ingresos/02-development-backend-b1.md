# 02 — Desarrollo backend B1: otros ingresos, sponsors, exportación

## Archivos
- `src/models/cash-movements.model.ts`, `src/models/sponsors.model.ts`, `src/models/exports.model.ts`
- `src/controllers/income.controller.ts` (lecturas + `exportOtherIncomeCsv`), `income.actions.ts`, `sponsors.actions.ts`
- `src/app/api/caja/ingresos/exportar/route.ts` (URL pública: `/api/caja/ingresos/exportar?mes=YYYY-MM&concepto=&sponsor=`)

## Contratos
Las firmas son las de `01-tasks.md` B1. Extras: `listAllCashMovements(filters)` (modelo; pagina con `range` de a 1000, techo 20.000, para exportar sin el corte mudo de `max_rows`), `CASH_MOVEMENTS_LIST_LIMIT` (500), `MAX_CASH_RECEIPT_SIZE_BYTES`, `MIN_CASH_DATE`.

## Decisiones y desvíos
- `getOtherIncomePage` trae conceptos y sponsors **con inactivos** (los filtros tienen que poder elegir uno desactivado); `getIncomeFormData` solo activos. Usa `listCashConcepts` de B2 (`cash-concepts.model.ts`) y `getCashMonthSummary` de `reports.model.ts`.
- `getOtherIncomePage` valida `filters` con `listCashMovementsSchema`; un período inválido tira `DomainError` (la page debe sanear `?mes=`).
- `receipt_filename` se guarda como el basename de la ruta (`<uuid>.<ext>`): el schema del contrato no trae nombre original.
- `updateSponsor`: `name` obligatorio; los otros campos `undefined` no se tocan, `null`/vacío los limpia.
- Texto libre del CSV (concepto, sponsor, detalle, cargó, motivo) pasa por `safeText`: prefijo `'` si empieza con `= + - @ \t \r` (guard de fórmulas). `lib/csv.ts` no lo hace por sí mismo (no es mío). Monto: pesos enteros; con coma decimal solo si los centavos no son redondos.
- El 23505 de sponsors consulta si el homónimo está desactivado para ajustar el mensaje (`ilike` con escape).
- Guards 42501 de los triggers (anular sin `income.void`, desactivar sin `sponsors.deactivate`) → `PermissionError`.

## Reglas / errores (para tests)
- Permisos: register/prepare/formData/createSponsor/updateSponsor → `income.register`; void → `income.void`; setSponsorActive → `sponsors.deactivate`; receipt URL → `income.read`; páginas → `requirePanelPermission('income.read'[, 'payments.read'])`; export → `requirePermission('income.read','reports.export')` (tira).
- `registerCashMovement`: batch duplicado → `alreadyRegistered: true` con la fila existente; fecha futura/<2020 → `occurredOn`; monto → `amountCents`; `receiptPath` sin prefijo → `receiptPath`; objeto inexistente en Storage → "No encontramos el comprobante subido. Probá de nuevo."; guards de concepto/sponsor traducidos con `field` (`conceptId`/`sponsorId`).
- `voidCashMovement`: motivo corto → `reason`; ya anulado → texto del guard; id inexistente → 404 "El ingreso no existe".
- Export: `logExport('other_income', …)` ANTES de armar la respuesta; si falla tira y no hay archivo. `mes` inválido → `DomainError` 400.
- Logs: ningún log con nombre, teléfono, email ni `description` (solo `failure(err, contexto)`).

## Necesita base real (`tests/db/`)
RLS por rol sobre `cash_movements`/`sponsors` (editor no anula ni desactiva; consulta no escribe), unicidad `batch_id` e idempotencia, guard de insert (concepto/sponsor inactivos, `requires_sponsor`), `sponsors_update_guard` (tríada, reactivar limpia), `log_export('other_income')` escribe `audit_log` con actor, export paginado > 1000 filas.

## Schema
Sin cambios pedidos. Typecheck: solo falla `getCobranzaHub` ausente en `reports.controller` (lane B2/F1, no mío). Lint de mis archivos verde.

## Arreglos de review

- **#1 export**: `listAllCashMovements` tira `DomainError('Hay demasiados ingresos para exportar de una vez; filtrá por concepto o sponsor')` al llegar a 20.000 filas (conservador: con exactamente 20.000 también tira). Antes devolvía un CSV incompleto sin avisar. Test nuevo posible: mock con páginas llenas.
- **#3 receiptPath**: `registerCashMovement` (modelo) exige que `receiptPath` empiece con `cash-receipts/<batchId>/` del mismo `batchId`; si no, `DomainError('El comprobante no corresponde a este ingreso', { field: 'receiptPath' })`. El chequeo `objectExists` de la action queda igual (corre antes).
- **#5 sponsors**: `translateGuardError` traduce 'El estado del sponsor se cambia desactivándolo o reactivándolo' (23514) a `DomainError`.
- **tests hallazgo 1**: `listCashMovements` pide `CASH_MOVEMENTS_LIST_LIMIT + 1`; `getOtherIncomePage` marca `truncated` solo si llegan más de 500 y recorta a 500. Tests que asumían `truncated` con exactamente 500 filas (o el `.limit(500)`) deben actualizarse (test-engineer).
- **#8**: comentarios `/caja/otros` -> `/caja/ingresos` en `income.controller.ts`.
- Nota: `npm run typecheck` falla en `src/views/income/other-income-view.tsx` (`Button` sin importar), archivo de frontend, fuera de mi alcance.
