# 02 — Backend B2: conceptos, resumen de caja, auditoría, ajustes

## Archivos
- `src/models/cash-concepts.model.ts` (nuevo): schemas `createCashConceptSchema` / `updateCashConceptSchema` (`name` 2–120 trim, `requiresSponsor?`, `.strict()`), `listCashConcepts({includeInactive?})`, `createCashConcept`, `updateCashConcept`, `setCashConceptActive`, `reorderCashConcepts`. 23505 -> `DomainError('Ya existe un concepto con ese nombre', {field:'name'})`. Alta: `sort_order = max+1`. Update: `requiresSponsor` undefined no se manda.
- `src/models/reports.model.ts`: `getCashMonthSummary(targetPeriod?)` mapea la RPC (`by_concept` jsonb `{concept_id, concept_name, amount_cents, count}` -> `CashConceptTotal[]`, `[]` si null).
- `src/controllers/reports.controller.ts`: `getCobranzaHub`/`CobranzaHubData` reemplazados por `getCajaHub`/`CajaHubData { cash, summary, billing, daily }`; guard `requirePanelPermission('payments.read','income.read','reports.read')`; 4 lecturas en `Promise.all`.
- `src/controllers/settings.controller.ts`: `SettingsPageData.incomeConcepts` (todos).
- `src/controllers/settings.actions.ts`: 4 actions nuevas con `requirePermission('settings.manage')`, revalidan `/ajustes` y `/caja` (layout). Las existentes no se tocaron (siguen con `requireRole('admin')`).
- `src/models/audit.model.ts`: `AUDITED_TABLES` +3; `AUDIT_FIELD_LABELS` para las 3 tablas (sin created_by/voided_by/deactivated_by); label de `cash_movements` = "Concepto[ · Sponsor] · $X · dd/mm/aaaa" con 2 consultas batch (conceptos, sponsors) en `Promise.all`, sin N+1, en listado y detalle; `sponsors`/`cash_concepts` -> `name`. Se sumaron alias `concept_id`, `sponsor_id`, `occurred_on` a `LABEL_COLUMNS`.

## Notas
- `requirePanelPermission` exige TODOS los permisos (AND), no alguno. Hoy los 3 roles tienen los 3 juntos.
- `getCajaHub` queda sin alias deprecado: `src/app/(panel)/caja/page.tsx` (F1) sigue llamando `getCobranzaHub` y `tests/controllers/reports.controller.test.ts` también -> typecheck roto SOLO en esos dos hasta F1 / test-engineer. Lint: 0 errores.
- Ningún log con nombres; ninguna escritura con admin client.

## Para tests/db o tests de modelo
- Conceptos: duplicado case-insensitive -> DomainError; `editor`/`consulta` -> permission denied en insert/update (RLS); desactivar con movimientos existentes funciona; reorder asigna índice.
- `getCashMonthSummary` sin movimientos -> ceros y `byConcept: []`; `feesCollectedCents` == `getMonthCollection().collectedCents`.
- Auditoría: cash_movements con concepto + sponsor, sin sponsor, con ids borrados/no visibles (label parcial); sponsors y cash_concepts con `name`.

## Schema
Sin cambios pedidos.

## Arreglos de review (#6)

`updateCashConcept` / `setCashConceptActive` usan `.maybeSingle()` y tiran `DomainError('El concepto no existe', { status: 404 })` si no hay fila. `reorderCashConcepts` verifica que cada update afectó exactamente una fila (`.select('id')`) y tira el mismo error. NO es atómico (updates en paralelo, ≤ ~10 filas). Propuesta si se quiere atómico: RPC `reorder_cash_concepts(p_ids bigint[])` SECURITY INVOKER con `unnest ... with ordinality` en un solo UPDATE, con chequeo `private.can('settings.manage')`; no la escribí.
