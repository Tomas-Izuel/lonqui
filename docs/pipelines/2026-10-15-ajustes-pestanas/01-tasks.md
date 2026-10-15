# 01 — Tareas: Ajustes en pestañas

Orden: SH (hecho) → B1 ∥ F1 ∥ F2 → T1 ∥ code-reviewer. Nadie corre
`npm install`, toca `supabase/**` ni resetea la base.

## SH — hilo principal (HECHO)
- `src/views/shared/section-tabs.tsx` (`SectionTabs({ tabs, label, indicatorId })`,
  `SectionTab = { href, label, matchPrefixes? }`).
- `src/views/payments/caja-tabs.tsx` reescrito como envoltorio.
- `.impeccable/surfaces/route-ajustes.md` con el brief.

## Contrato de lecturas (lo implementa B1, lo consume F1)

En `src/controllers/settings.controller.ts`, cada una con
`await requirePanelPermission('settings.manage')` primero:

```ts
export type AjustesCuotasData = {
  feePrices: FeePricesOverview
  billing: BillingStatus
  disciplines: DisciplineWithCategories[]            // todas, para etiquetar
  categoriesByDiscipline: DisciplineWithCategories[] // solo activas, para "Nuevo valor"
}
export type AjustesDeportesData = { disciplines: DisciplineWithCategories[] } // todas
export type AjustesCajaData = { incomeConcepts: CashConcept[] }              // todos
export type AjustesClubData = { settings: Settings }

export async function getAjustesCuotasData(): Promise<AjustesCuotasData>
export async function getAjustesDeportesData(): Promise<AjustesDeportesData>
export async function getAjustesCajaData(): Promise<AjustesCajaData>
export async function getAjustesClubData(): Promise<AjustesClubData>
```

`getSettingsPage` / `SettingsPageData` se eliminan.

## B1 — senior-backend-engineer
Archivos: `src/controllers/settings.controller.ts`, `src/controllers/settings.actions.ts`,
`src/controllers/billing.actions.ts` (solo revalidación, si hace falta).
- Implementar el contrato de arriba.
- `revalidatePath('/ajustes')` → `revalidatePath('/ajustes', 'layout')`.
- No toca `src/app/**` ni `src/views/**`.

## F1 — frontend-react-craftsman (Ajustes)
Archivos: todo `src/app/(panel)/(admin)/ajustes/**` y `src/views/settings/settings-page-view.tsx`
(se reemplaza por vistas por pestaña en `src/views/settings/`, archivos nuevos).
- `ajustes/layout.tsx`: `PageHeader` "Ajustes" + `SectionTabs` (label
  "Secciones de ajustes", indicatorId "ajustes-tab-indicator").
- `ajustes/page.tsx`: `redirect('/ajustes/cuotas')`.
- `cuotas/`, `deportes/`, `caja/`, `club/`: `page.tsx` (controller → vista),
  `loading.tsx`, `error.tsx`. Mover el `loading.tsx`/`error.tsx` actuales a
  donde correspondan.
- Las secciones existentes (`FeePricesSection`, `BillingSection`,
  `IncomeConceptsSection`, `DisciplineGroup`, `ClubSettingsForm`…) se reusan
  sin cambiar su comportamiento.
- No toca `src/views/shared/**`, `caja-tabs.tsx`, ni otros módulos.

## F2 — frontend-react-craftsman ("Editar" desde otros módulos)
Archivos: vistas y pages de OTROS módulos (`src/views/members/**`,
`src/views/payments/**` salvo `caja-tabs.tsx`, `src/views/income/**`,
`src/views/dashboard/**`, y sus `src/app/(panel)/**/page.tsx` fuera de
`(admin)/ajustes`), más un helper si hace falta en `src/views/settings/settings-links.ts`
(archivo nuevo, constantes de URL de las pestañas).
- Primero inventario (en el dev log): dónde se muestra un dato configurable
  (disciplina/categoría, concepto de ingreso, sponsor no — eso vive en Caja,
  valor de cuota, estado de facturación, nombre del club).
- Enlace secundario "Editar …" a la pestaña, solo con `settings.manage`
  (el permiso viaja desde la page: `session.permissions`).
- No toca `src/app/(panel)/(admin)/ajustes/**` ni `src/views/settings/*-section.tsx`.

## T1 — test-engineer
- `SectionTabs`: activa exacta y por prefijo; `CajaTabs` mantiene sus 6 rutas
  y "Otros ingresos" activo en `/caja/sponsors/…`.
- Controllers por pestaña: cada uno exige `settings.manage`.
- Acciones de ajustes revalidan `('/ajustes', 'layout')`.
- `/ajustes` redirige a `/ajustes/cuotas`.
- Enlaces "Editar": presentes con `settings.manage`, ausentes sin él.
