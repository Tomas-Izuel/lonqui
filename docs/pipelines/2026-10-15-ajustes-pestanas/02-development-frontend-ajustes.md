# 02 — Desarrollo frontend: Ajustes en pestañas (F1)

## Archivos
- `src/app/(panel)/(admin)/ajustes/layout.tsx`: `PageHeader` "Ajustes" + `SettingsTabs` (título y barra no se remontan al cambiar de pestaña).
- `ajustes/page.tsx`: `redirect('/ajustes/cuotas')`.
- `ajustes/{cuotas,deportes,caja,club}/{page,loading,error}.tsx`. Cada page llama a `getAjustes<Tab>Data()` (contrato de `01-tasks.md`) y renderiza su vista.
- `src/views/settings/settings-tabs.tsx` (4 pestañas sobre `SectionTabs`, indicatorId `ajustes-tab-indicator`, label "Secciones de ajustes"), `settings-tab-views.tsx` (`CuotasTabView`, `DeportesTabView`, `CajaTabView`, `ClubTabView`, `SettingsTabLoading`), `settings-tab-error.tsx` (cliente, compartido por los 4 `error.tsx`).
- Borrados con `git rm`: `settings-page-view.tsx`, `ajustes/loading.tsx`, `ajustes/error.tsx`.
- Sin primitivas nuevas en `shared/`. Secciones existentes reusadas sin cambios, textos y `gap-6` intactos.

## Comportamiento / criterios
- `/ajustes` redirige a `/ajustes/cuotas`. Cada pestaña es un `<Link>` real; activa por ruta exacta.
- Cuotas: valores de cuota + activación/generación. Deportes: disciplinas y categorías (vacío con CTA "Cargar disciplina"). Caja: conceptos de ingreso. Club: datos del club.
- Cada pestaña tiene esqueleto (mismos títulos de panel que la real) y error con "Reintentar" ("No pudimos cargar esta sección").
- Acceso: solo `settings.manage` (layout `(admin)` + controller de cada pestaña). Sin acciones nuevas.
- a11y: `<nav aria-label="Secciones de ajustes">`, `aria-current="page"` en la activa, targets de 44px (`SectionTabs`).
- 390px: 4 etiquetas cortas ("Cuotas · Deportes · Caja · Club") con `px-3.5` caben sin scroll (~4x70px + gaps); si no, la barra scrollea.

## Verificación
- eslint verde en mis archivos. `tsc`: único error en `tests/controllers/settings.controller.test.ts` (referencia el `getSettingsPage` eliminado; es de T1). No se corrió en navegador.
