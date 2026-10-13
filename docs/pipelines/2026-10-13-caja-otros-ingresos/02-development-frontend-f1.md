# 02 — Desarrollo frontend F1: Caja, hub con dos cifras, pestañas, shell

## Implementado (F1)
- `src/app/(panel)/caja/page.tsx`: `getCajaHub()` (guarda permisos adentro, exige los tres) + `requirePanelAccess()` solo para pasar `permissions` a la vista. Se usó `requirePanelAccess` y no `requirePanelPermission('payments.read','income.read')` porque esta última exige TODOS y ya lo hace el controller.
- `caja-hub-view.tsx` (`CajaHubView({cash, summary, billing, daily, permissions})`): encabezado "Caja"; botones "Registrar pago" (`payments.register`, `?pagar=buscar`) y "Registrar otro ingreso" (`income.register`, `useOverlayParam('ingreso').set('nuevo')`); sin permisos no hay contenedor. Dos `HeroFigure` en `grid gap-4 sm:grid-cols-2`, cada una en su `Panel` hermano (sin anidar).
  - Cifra 1 "Ingresado en <mes>" = `cash.totalCents`; `IncomeSplitBar` (nuevo, local) Cuotas / Otros ingresos con monto escrito y etiquetas-link a `/caja/cuotas` y `/caja/ingresos` (tonos de tinta, no naranja ni estado); `CashTransferBar` con `cash.cashCents/transferCents`.
  - Cifra 2 "Cobrado en cuotas" = `cash.feesCollectedCents`, href `/caja/cuotas`, "de $X en cuotas de <mes>", `CollectionRateMeter`, link "N socios con deuda · $Y adeudado" a `/caja/deuda` (de `summary`). Con `billing.active=false` explica que las cuotas no están activadas.
  - "Ritmo del mes" sin cambios. Panel "Otros ingresos": total + fila por concepto (`conceptName`/`amountCents`), "Ver todos" (solo si hay ingresos), vacío "Todavía no se registraron otros ingresos en <mes>." con botón si hay permiso.
  - Ninguna suma de centavos en el cliente (solo anchos porcentuales de barras).
- `caja-tabs.tsx`: 6 pestañas (Resumen, Cuotas, Otros ingresos, Con deuda, Al día, Por categoría), `aria-label="Secciones de caja"`, `layoutId` `caja-tab-indicator`; "Otros ingresos" activa por prefijo `/caja/ingresos` o `/caja/sponsors`.
- `app-shell.tsx`: `<IncomeOverlayHost />` en el mismo Suspense. **El archivo `views/income/income-overlay-host.tsx` (F2) todavía no existía al cerrar**: el import está activo y `typecheck` falla por eso hasta que F2 aterrice.
- `nav-items.ts`: ya traía "Caja" con `Banknote` (decisión única, se mantiene; coherente con el botón "Registrar pago").
- `cuotas/page.tsx` título "Cuotas"; `MonthSelector basePath="/caja/cuotas"` ya estaba; `month-payments-view` encabezado "Pagos de cuotas". `error.tsx`/`loading.tsx` renombrados a Caja.
- Cero `/cobranza` en `views/**` y `app/**` (quedan comentarios históricos "route-cobranza.md" en archivos de payments no tocados).

## Criterios de aceptación observables
- `consulta` ve el resumen y las cifras sin botones; `editor` ve ambos; quien solo tenga uno ve solo ese.
- Pestaña "Otros ingresos" marcada (`aria-current="page"`) en `/caja/ingresos*` y `/caja/sponsors*`.
- Targets 44px: botones `h-12`, links de barras/deuda/"Ver todos" `min-h-11`.

## Verificación
- `npm run lint` sobre `views/payments`, `views/shell`, `app/(panel)/caja`: limpio.
- `npm run typecheck`: 2 errores, ambos ajenos a la lógica: (1) falta `views/income/income-overlay-host` (F2); (2) `tests/controllers/reports.controller.test.ts` referencia `getCobranzaHub` (lo arregla test-engineer).
- NO verificado visualmente (390px / desktop): el stack local de Supabase no está levantado (MCP ECONNREFUSED), así que no pude loguearme ni correr la page. Pendiente para la revisión.

## Pendientes / follow-ups
- Comentarios con "route-cobranza.md" en payment-form, receipt-picker, etc.: cosméticos.
- Opcional no hecho: `register-payment-sheet.tsx` con `SuccessMoment` de shared.
