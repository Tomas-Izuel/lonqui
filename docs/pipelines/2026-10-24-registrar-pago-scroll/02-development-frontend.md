# Registrar pago: scrolls espurios en el diálogo de escritorio

## Causa raíz
`ResponsiveSheet` (escritorio) envolvía `children` en un scroller SIN padding, pero el pie sticky de
`payment-form.tsx` / `group-payment-form.tsx` usa `-mx-4 -mb-4`, pensado para el scroller del sheet móvil
(que sí tiene `px-4 py-4`). En escritorio esos márgenes negativos sacaban 16px a cada lado y 16px abajo
del scroller: barra horizontal + vertical aunque el contenido entrara. Además:
- `footer={null}` igual renderizaba `<DialogFooter>` / `<SheetFooter>` vacíos (banda vacía con borde y padding).
- Sin padding en el scroller, el anillo de foco del monto tocaba/recortaba en el borde.

## Fix (solo `src/views/shared/responsive-sheet.tsx`; no se tocó dialog/sheet ni `views/payments`)
- Escritorio: scroller `-mx-4 -mt-1 px-4 pt-1` (llega al borde del diálogo y devuelve el espacio como padding, así el anillo
  de foco respira y el pie sticky queda al ras); sin footer: `-mb-4 pb-4` (absorbe el padding inferior del diálogo); con footer: `pb-1`.
- Footer solo se renderiza si hay `footer` (desktop y móvil).
- `overflow-x-clip` en ambos scrollers como guardia: la entrada del paso en `PaymentOverlayHost` anima `x: 16` y no debe
  sumar scroll horizontal ni un frame. No es un parche del desborde real (ese era el margen negativo); el padding ya cubre el anillo.
- Otros usuarios (settings/*, sponsor-form, quick-view, income host) con footer: mismo layout salvo el scroller que ahora
  tiene 16px de padding lateral compensado por `-mx-4` (sin cambio de ancho visible). Sin footer: se pierde la banda vacía.

## Verificado
- `npm run typecheck` y `npm run lint`: 0 errores.
- NO verificado visualmente (sin sesión de navegador autenticada); razonado por layout: modo monto, tira de meses individual/grupo
  (el pie sticky con `-mx-4 -mb-4` ahora coincide con el padding del scroller en ambos breakpoints), éxito, móvil 390px (sin cambios salvo footer vacío).

## Ronda 2
Un elemento sticky se pega al scrollport descontando el padding del scroller (`py-4` en móvil, `pb-4` en escritorio sin footer),
así que con `bottom-0` quedaba una banda de 16px por debajo del pie donde asomaba el contenido ("Agregar nota").
Se cambió `bottom-0` por `-bottom-4` en el pie sticky de `payment-form.tsx` y `group-payment-form.tsx` (misma medida que el `-mb-4`
que ya asumía ese padding): el pie queda al ras del borde inferior del scroller en ambos breakpoints. Typecheck y lint sin errores; no verificado visualmente (lo verifica el hilo principal).

## Ronda 2
Un elemento sticky se pega al scrollport descontando el padding del scroller (`py-4` en móvil, `pb-4` en escritorio sin footer),
así que con `bottom-0` quedaba una banda de 16px por debajo del pie donde asomaba el contenido ("Agregar nota").
Se cambió `bottom-0` por `-bottom-4` en el pie sticky de `payment-form.tsx` y `group-payment-form.tsx` (misma medida que el `-mb-4`
que ya asumía ese padding): el pie queda al ras del borde inferior del scroller en ambos breakpoints. Typecheck y lint sin errores; no verificado visualmente (lo verifica el hilo principal).
