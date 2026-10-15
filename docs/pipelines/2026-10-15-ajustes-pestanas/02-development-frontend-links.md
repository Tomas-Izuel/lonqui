# 02 — Frontend F2: enlaces "Editar" hacia las pestañas de Ajustes

## Inventario (dónde se MUESTRA un dato configurable)

| Superficie | Dato | Decisión |
|---|---|---|
| `/socios` (filtros disciplina/categoría) | categorías | Enlace "Editar categorías" bajo los filtros → `/ajustes/deportes` |
| `/socios/[id]` panel "Deportes" | categorías | Enlace "Editar categorías" al pie del panel → deportes |
| `/socios/[id]` panel "Cuenta" con facturación inactiva | estado de facturación | "Activar cuotas" (con `billing.configure`) → `/ajustes/cuotas` |
| `/socios/[id]` filas del estado de cuota | monto congelado | Sin enlace: es historia, el valor no se edita desde acá |
| `/` aviso "cuotas no activadas" | facturación | El CTA existente apuntaba a `/ajustes`; ahora `/ajustes/cuotas`, texto "Activar cuotas" (ya era la acción del estado vacío, gate `billing.configure`) |
| `/` RunFailedNotice | reintento de corrida | Sin enlace: la acción es "Reintentar", no configuración |
| `/` desglose por categoría | categorías | Ruido: es un indicador, no una lista editable |
| `/caja` resumen con facturación inactiva | facturación | "Activar cuotas" (`billing.configure`) → cuotas |
| `/caja/cuotas` | valor de cuota | "Cambiar valor de cuota" → `/ajustes/cuotas` |
| `/caja/ingresos` | conceptos de ingreso | "Editar conceptos" junto al filtro/exportar → `/ajustes/caja` |
| Form de ingreso (overlay) sin conceptos | conceptos | CTA existente `/ajustes` → `/ajustes/caja`, "Cargar conceptos" |
| `/caja/por-categoria` | categorías | "Editar categorías" bajo las pestañas → deportes |
| `/caja/deuda`, `/caja/al-dia` | categoría como filtro/columna | Ruido: ya hay enlace en la hermana "Por categoría" |
| Shell | nombre del club | No se muestra el nombre (solo el escudo): sin enlace. `SETTINGS_LINKS.club` queda disponible |

Un enlace por superficie, cerca del dato, nunca por fila.

## Código
- `src/views/settings/settings-links.ts` (nuevo): `SETTINGS_LINKS = { fees, sports, cash, club }`.
- `src/views/shared/edit-in-settings-link.tsx` (nuevo; el hilo principal lo movió de `shell/` a `shared/`): `EditInSettingsLink` — link de texto con ícono `Settings2`, `min-h-11`, color muted, nunca primario. Vive en `shell/` porque `shared/` y `settings/` no eran míos; si se prefiere, moverlo a `shared/`.
- Permiso: `settings.manage` (`billing.configure` para los de facturación) llega por props desde la page (`session.permissions`), nunca fetch en la vista. Props nuevas (todas opcionales, default `false`): `canEditCategories` (`DebtByCategoryView`), `canEditFee` (`MonthPaymentsView`), `canEditConcepts` (`OtherIncomeView`), `canEditCatalog` (`MemberCategoriesSection`), `canActivateBilling` (`MemberAccountSection`). `MemberListView` y `CajaHubView` ya recibían `permissions`. `IncomeFormBody` ya usaba `useHasPermission('settings.manage')`.
- Pages tocadas: `caja/por-categoria`, `caja/cuotas`, `caja/ingresos` (pasan el flag; `por-categoria` ahora guarda la sesión).

## Criterios de aceptación (para T1)
- Con `settings.manage`: se ven los enlaces "Editar categorías" (socios, ficha, por categoría), "Cambiar valor de cuota" (caja/cuotas), "Editar conceptos" (caja/ingresos). Sin él: ausentes.
- "Activar cuotas" (ficha, caja, inicio) solo con `billing.configure` y solo si la facturación está inactiva.
- Targets de 44px, foco visible, íconos `aria-hidden`.

## Pendiente / notas
- Typecheck: único error actual en `tests/controllers/settings.controller.test.ts` (`getSettingsPage`, lo migra el otro agente). Lint verde en `src/views` y `src/app`.
- No toqué `member-form.tsx` (selector de categoría del form): el enlace de la lista y la ficha alcanza.

## Fix de review (Minor 1 y Nit 3)
- "Activar cuotas" apunta a `/ajustes/cuotas`, que exige `settings.manage`; activar exige `billing.configure`. Ahora el enlace se muestra solo con LOS DOS permisos. Se ajustó donde se calcula el flag, sin renombrar props: `member-detail-view.tsx` (`canActivateBilling`), `caja-hub-view.tsx` (chequeo inline) y, por el mismo defecto, `dashboard-content.tsx` (`canConfigureBilling`, que alimenta `BillingInactiveNotice`).
- `metadata.title` de `/ajustes/{cuotas,deportes,caja,club}`: `'<Pestaña> · Ajustes — Lonqui'`.
