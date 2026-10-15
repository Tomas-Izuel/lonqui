# 03 — Tests: Ajustes en pestañas (T1)

## Veredicto: SUITE GREEN
`npm run typecheck` limpio. `npm test`: 71 archivos, 1299 tests verdes, 1 skipped (los de `tests/db/` se saltean sin Docker).

## Qué se agregó / cambió
- `tests/controllers/settings.controller.test.ts` (reescrito): las 4 lecturas (`getAjustesCuotasData|DeportesData|CajaData|ClubData`). Cada una exige `settings.manage` (por permiso, una vez, antes de tocar modelos), carga solo lo suyo, cuotas separa disciplinas todas / solo activas, deportes y caja traen inactivos. Pin: `getSettingsPage` ya no existe.
- `tests/controllers/settings.actions.revalidate.test.ts` (nuevo): las 13 actions de ajustes revalidan `('/ajustes', 'layout')` y nunca `('/ajustes')` a secas; validación fallida no revalida.
- `tests/controllers/settings.actions.concepts.test.ts`: aserción vieja `'/ajustes'` pasada a `('/ajustes', 'layout')`.
- `tests/views/shared/section-tabs.test.ts` (nuevo): `SectionTabs` activa exacta y por `matchPrefixes`, subruta sin prefijo no activa; `CajaTabs` 6 rutas y "Otros ingresos" activo en `/caja/sponsors/...`; `SettingsTabs` 4 rutas, activa exacta, aria-label; `SETTINGS_LINKS` coincide con las rutas de las pestañas.
- `tests/app/ajustes-redirect.test.ts` (nuevo): `/ajustes` redirige a `/ajustes/cuotas`.
- `tests/views/settings/edit-links.test.ts` (nuevo): "Editar categorías" (por-categoria), "Cambiar valor de cuota" (caja/cuotas), "Editar conceptos" (caja/ingresos) presentes con el flag y ausentes con `false` o sin pasarlo; `EditInSettingsLink` (href, min-h-11, ícono aria-hidden).

## Huecos anotados (no testeados)
- Los enlaces de `MemberListView`, `MemberCategoriesSection`, `MemberAccountSection`, `CajaHubView`, `BillingInactiveNotice` ("Activar cuotas" con `billing.configure`) y `IncomeFormBody`: son client con hooks del router/estado y muchas props; no se renderizaron en Node. Cubiertos solo indirectamente por `EditInSettingsLink`.
- Que cada page derive el flag de `session.permissions` (cableado en `src/app/**/page.tsx`) no se prueba: son pages async de Next.
- Layout de `/ajustes` y los `loading/error.tsx`: sin test (presentación pura).

## Bugs en src/
Ninguno.
