# 02 — Frontend F2: otros ingresos, sponsors, conceptos en ajustes

## Archivos (todos nuevos salvo indicación)
- `src/views/income/`: `income-overlay-host.tsx` (`IncomeOverlayHost`, sin props), `income-form-body.tsx`, `income-form.tsx`, `income-schema.ts`, `income-receipt-upload.ts`, `choice-group.tsx`, `sponsor-combobox.tsx`, `use-cash-receipt.ts`, `register-income-button.tsx`, `other-income-view.tsx`, `other-income-list.tsx`, `sponsors-view.tsx`, `sponsor-detail-view.tsx`, `sponsor-actions.tsx`, `sponsor-form-sheet.tsx`, `new-sponsor-button.tsx`.
- `src/views/settings/`: `income-concepts-section.tsx`, `income-concept-row.tsx`, `income-concept-form-sheet.tsx`, `new-income-concept-button.tsx`; editado `settings-page-view.tsx` (prop `incomeConcepts`, panel entre "Disciplinas y categorías" y valores de cuota).
- Pages: `app/(panel)/caja/ingresos/page.tsx`, `caja/sponsors/page.tsx`, `caja/sponsors/[id]/page.tsx` + `not-found.tsx`; editada `(admin)/ajustes/page.tsx`.
- Editado `views/audit/audit-labels.ts` (`RECORD_PHRASE` y `FIELD_LABELS` de las 3 tablas).

## Decisiones
- Orden del formulario: Concepto → (Sponsor si el concepto lo pide) → Monto → Fecha → (Sponsor opcional) → Medio → Comprobante → Detalle. Cuando es opcional baja después de la fecha (brief §3) para que una venta no pase por un buscador que no usa; cuando es obligatorio sube justo bajo Concepto.
- Concepto y Medio: `ChoiceGroup` (`role="radiogroup"`/`radio`, flechas, tabindex rotativo). Medio por defecto Efectivo.
- Combobox de sponsor: "Agregar sponsor" en línea sin `<form>` propio (un submit anidado burbujea por React al form del ingreso). Si el sponsor es opcional ofrece "Sin sponsor".
- `batchId` en `useState`; el archivo ya subido se recuerda para no resubir en un reintento; `alreadyRegistered` = éxito ("El ingreso ya estaba registrado").
- `MonthSelector` descarta `concepto`/`sponsor` al cambiar de mes (documentado en `other-income-view.tsx`). Los totales son siempre del mes entero (de `summary`, no sumados en cliente); con filtro activo la vista lo aclara.
- Desktop: la tabla de `DataList` no renderiza `row.actions`, así que `OtherIncomeList` agrega una columna "Acciones" con el menú (Ver comprobante / Anular ingreso).
- Extra: la ficha del sponsor pasa `canVoid` (income.void) para poder anular un aporte desde el historial.
- Tipos de props de vistas importados de `models/types` (no del controller, que es `server-only`).

## Aceptación implementada (F2)
- Overlay `?ingreso=nuevo|sponsor:<id>`: sin `income.register` devuelve null; carga/error (con Reintentar)/vacío (link a /ajustes solo con `settings.manage`); `SuccessMoment` + toast "Ingreso registrado · $X" + cierre + `router.refresh()`; errores con `field` bajo su campo (`receiptPath` bajo el comprobante). Botón "Registrar ingreso de $X" deshabilitado mientras envía.
- `/caja/ingresos`: `mes` saneado (regex), `concepto`/`sponsor` solo enteros positivos; totales + fila por concepto; filtros (inactivos marcados "(desactivado)"); "Exportar CSV" (`<a download>`) solo con `reports.export`; link Sponsors; aviso de truncado; vacío con acción; anulados tachados con motivo.
- Anular: "Anular ingreso" con `ReasonDialog showDate={false}`, consecuencia del brief; nunca "eliminar".
- `/caja/sponsors`: lista activos primero, "Desactivado" pill, fila → ficha, "Nuevo sponsor" con `income.register`, vacío. Ficha: cifras, contacto (WhatsApp `wa.me`, mailto), Registrar aporte (deshabilitado si inactivo), Editar (`income.register`), Desactivar con motivo / Reactivar con confirmación (`sponsors.deactivate`), historial con comprobante. `notFound()` si no existe; título de pestaña genérico.
- Ajustes: panel "Conceptos de ingreso" (subir/bajar, Editar, Desactivar con copy del brief / Activar, checkbox "Pide sponsor", vacío que enseña).
- A11y: radiogroups con label y error por `aria-describedby`; targets 44-48 px; menús con `aria-label` por fila.

## Verificación
- `npm run typecheck`: solo el error ajeno `tests/controllers/reports.controller.test.ts` (`getCobranzaHub`, lo corrige test-engineer). `npm run lint`: 0 errores (warnings preexistentes en tests).
- Dev server: las tres rutas compilan y redirigen a /login sin sesión.
- NO verificado visualmente (390px/desktop, flujo de registro): no se hizo login; el único usuario local es una cuenta real con contraseña en `.env.local` y no corresponde usarla.

## Pendientes / sugerencias
- Probar a mano: overlay a 390px (combobox en sheet sobre sheet), subida de comprobante, export.
- No se tocó `views/shared` ni `views/payments`.

## Arreglos de QA
- Orden de las páginas: encabezado → `CajaTabs` → acciones, igual que el hub, en `OtherIncomeView`, `SponsorsView` ("Nuevo sponsor" se muestra solo si hay sponsors; con lista vacía queda el botón del estado vacío) y `SponsorDetailView` (el link "‹ Sponsors" y el título quedan arriba).
- Foco inicial del overlay: Radix dejaba el foco en el handle "Cerrar" de `ResponsiveSheet` (primer elemento enfocable) con su anillo. Pagos no lo muestra porque su `MemberPicker` tiene `autoFocus` en el buscador; acá `ChoiceGroup` ganó `autoFocus` y el grupo "Concepto" lo usa (foco en la opción que entra al Tab). `ResponsiveSheet` no se tocó.

## Arreglos de review
- #2: `src/views/income/export-csv-button.tsx` (client, nuevo). Mejora progresiva: `<a href download>` sigue andando sin JS; con JS el click hace `fetch`, y solo si `res.ok` baja el Blob con el nombre del `Content-Disposition`. Si no, toast de `sonner` y no descarga nada: el body de error real es `{ error: string, field? }` (no `error.message`); 4xx muestra ese texto, 5xx y fallas de red el genérico "No se pudo exportar. Probá de nuevo.". Estado "Exportando…" con link inerte (`aria-disabled`, `pointer-events-none`). `OtherIncomeView` lo usa en lugar del `<a>`.
- #7: `src/lib/csv.ts` usa el escape `'﻿'` en vez del BOM literal.
- #8: comentarios `route-cobranza.md` -> `route-caja.md` en `src/views/payments/**` (solo comentarios).
