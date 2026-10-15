# 03 — Revisión: Ajustes en pestañas

**Veredicto: APPROVED** (sin blockers ni majors; 2 minors y 2 nits, ninguno bloquea el commit).

## Alcance revisado
Diff de `SectionTabs`, `EditInSettingsLink`, `CajaTabs`, `src/app/(panel)/(admin)/ajustes/**`, vistas `settings-*`, `settings.controller.ts`, `settings.actions.ts` y los enlaces "Editar" en members / payments / income / dashboard y las tres pages de caja. Sin tocar migraciones ni schema, sin permisos nuevos, sin fuera de Fase 1.

## Verificado contra el foco pedido
- **Capas**: ninguna page/layout de `ajustes/**` importa `@supabase/*` ni modelos; solo controllers y vistas. Las vistas nuevas no importan modelos (solo tipos). `settings.controller.ts` es `server-only`; `settings.actions.ts` sin exports nuevos.
- **Re-verificación de permiso**: las cuatro lecturas arrancan con `requirePanelPermission('settings.manage')` (redirige, correcto para lectura). El layout `ajustes/layout.tsx` no lee datos: solo `PageHeader` estático + barra. Los datos nunca pasan por el layout.
- **Revalidación**: las 10 llamadas pasan a `revalidatePath('/ajustes', 'layout')` (incluida `revalidateConcepts`, que además invalida `/caja`); `billing.actions` ya revalida `'/', 'layout'`. Cubre las cuatro rutas. No quedan `revalidatePath('/ajustes')` pelados.
- **Enlaces "Editar"**: todos gateados desde la page/props con `settings.manage` (`billing.configure` los de "Activar cuotas"); son links de texto muted, `min-h-11`, ícono `aria-hidden`, foco visible, nunca primarios. Un enlace por superficie, no por fila. Contraste de `--muted-foreground` (#5F6673) sobre blanco/`bg-muted`: ~5.3-5.9:1, pasa AA.
- **Enlaces viejos a `/ajustes`**: ninguno queda en `src/` salvo `nav-items.ts` (correcto: entra por el redirect) y comentarios. `/ajustes` redirige a `/ajustes/cuotas`; el ítem de nav sigue activo en las hijas (`startsWith('/ajustes/')`).
- **Estado vacío de activar cuotas** (`billing-inactive-notice.tsx`): se mantiene el botón primario. Está bien: es el único CTA de un `EmptyState` (la acción que enseña el estado vacío), ya existía y solo cambió destino/copy. No es un "Editar" secundario.
- **Piso de calidad**: título "Ajustes" sin eyebrow; sin tarjetas anidadas; 4 pestañas cortas caben a 390px y, si no, la barra scrollea con la activa a la vista; `nav aria-label`, `aria-current="page"`, links reales; cada pestaña tiene loading (mismos títulos de panel que la vista real) y error genérico con "Reintentar" que no muestra `error.message`; vacío de Deportes enseña. Header y barra viven en el layout: no parpadean.

## Hallazgos

### Minor
1. `src/views/members/member-account-section.tsx` (enlace "Activar cuotas"), `src/views/payments/caja-hub-view.tsx` (idem): se gatean con `billing.configure`, pero el destino `/ajustes/cuotas` exige `settings.manage`. Escenario: cuando existan roles configurables, alguien con `billing.configure` sin `settings.manage` ve el enlace y `requirePanelPermission` lo rebota a `/` sin explicación. Hoy ambos permisos son solo de `admin`, así que no se manifiesta. Fix: gatear con `billing.configure && settings.manage` (o anotarlo para el pipeline de roles configurables).
2. `tests/controllers/settings.controller.test.ts:` sigue importando el `getSettingsPage` eliminado (rompe `tsc` y el test). Es de `test-engineer`: migrar a las cuatro lecturas (cada una exige `settings.manage`) y asertar `revalidatePath('/ajustes', 'layout')`. Hasta que lo haga no hay SUITE GREEN. Cobertura pendiente además: `SectionTabs` (activa exacta/prefijo; `CajaTabs` con "Otros ingresos" activo en `/caja/sponsors/…`), redirect de `/ajustes` y presencia/ausencia de los enlaces "Editar" según permiso.

### Nit
3. Las cuatro pages usan el mismo `metadata.title` "Ajustes — Lonqui"; conviene el nombre de la pestaña ("Cuotas · Ajustes — Lonqui") para historial y pestañas del navegador.
4. `(admin)/layout.tsx` sigue exigiendo rol `admin` mientras los controllers piden permiso: preexistente y coherente hoy; se resuelve en el pipeline de roles configurables.

## Blockers
Ninguno.

## Qué está bien
Migración limpia de un contrato de lectura monolítico a cuatro lecturas mínimas, cada una con su guard; `SectionTabs` reusado sin cambio visible en `/caja`; una sola fuente de URLs (`SETTINGS_LINKS`); los enlaces "Editar" son discretos y están bien ubicados; sin sobrealcance.
