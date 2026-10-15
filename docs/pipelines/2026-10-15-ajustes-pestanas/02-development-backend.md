# 02 — Desarrollo backend (B1)

## Hecho
- `src/controllers/settings.controller.ts`: se eliminan `getSettingsPage` / `SettingsPageData`.
  Cuatro lecturas, una por pestaña, cada una con `requirePanelPermission('settings.manage')` primero
  y cargando solo lo suyo (contrato exacto de `01-tasks.md`):
  - `getAjustesCuotasData()` -> `{ feePrices, billing, disciplines (todas), categoriesByDiscipline (solo activas) }`
  - `getAjustesDeportesData()` -> `{ disciplines (todas) }`
  - `getAjustesCajaData()` -> `{ incomeConcepts (todos) }`
  - `getAjustesClubData()` -> `{ settings }`
- `src/controllers/settings.actions.ts`: las 10 llamadas `revalidatePath('/ajustes')` pasan a
  `revalidatePath('/ajustes', 'layout')` (firma vigente: `revalidatePath(path, type?: 'page'|'layout')`),
  incluida `revalidateConcepts()`. Con 'layout' se invalidan todas las pestañas hijas.
- `billing.actions.ts`: sin cambios; ya revalida `('/', 'layout')`, que cubre `/ajustes/**`.

## Reglas / criterios
- Cada lectura exige `settings.manage` (redirige via `requirePanelPermission`).
- Las actions no cambiaron de permiso (admin por rol en las de catálogo/settings, permiso en conceptos).

## Para test-engineer
- `tests/controllers/settings.controller.test.ts` usa `getSettingsPage` (ahora no existe): hay que migrarlo
  a las cuatro lecturas. Los assert de revalidación deben esperar `('/ajustes', 'layout')`.
- No hay nada que requiera base real en este slice.

## Esquema / deferrals
Ninguno.
