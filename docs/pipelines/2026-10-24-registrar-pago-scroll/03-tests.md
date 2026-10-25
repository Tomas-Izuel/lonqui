# 03-tests: registrar pago scroll

Cambio: `ResponsiveSheet` renderiza el pie solo con `footer`; clases del scroller; pie sticky `-bottom-4` en los formularios de pago.

- Suite previa al cambio de tests: 77 archivos, 1546 pasaron, 1 salteado. Typecheck limpio. Ningún test existente rompió (no había aserciones sobre clases ni sobre el pie).
- Nuevo: `tests/views/shared/responsive-sheet.test.ts` (2 tests, render estático en Node). Cubre "sin footer no hay slot de pie" y "con footer sí". Se mockea `@/components/ui/sheet` (borde externo, el Portal de Radix no emite en SSR). Solo alcanza la rama móvil (en SSR `useIsDesktop` es false); la rama Dialog de escritorio necesita `matchMedia`/DOM y el repo no tiene jsdom ni testing-library: no testeada.
- Layout/scroll/píxeles: verificado por el hilo principal con Playwright, no se testea.

SUITE GREEN
