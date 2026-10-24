# Revisión: registrar pago, scrolls espurios

Alcance: `git diff main` sobre `responsive-sheet.tsx`, `payment-form.tsx`, `group-payment-form.tsx` (solo vistas; sin migraciones, sin capas tocadas).

## Hallazgos

1. **nit** `responsive-sheet.tsx` (desktop, con footer): `pb-1` suma 4px entre el scroller y el `DialogFooter` además del gap del diálogo. Efecto visual mínimo en los 5 sheets de ajustes y el de sponsor; no bloquea.
2. **nit** `02-development-frontend.md`: la sección "Ronda 2" está duplicada.
3. **nit** `footer` sigue tipado como requerido pero tres consumidores pasan `null` (quick view, payment host, income host). Funciona; conviene tipar `footer?: ReactNode | null` para que el contrato diga lo que ya hace.

## Regresiones revisadas (ninguna encontrada)

- Consumidores con `footer={null}` (`payment-overlay-host`, `income-overlay-host`, `member-quick-view-sheet`): ninguno dependía de la banda vacía; ahora el scroller absorbe el padding inferior (`-mb-4 pb-4`) y el contenido queda parejo.
- Consumidores con footer (settings x5, sponsor-form): ancho visible igual (`-mx-4` + `px-4`), anillo de foco con espacio; sin cambios relevantes.
- `overflow-x-clip`: ninguno de esos consumidores tiene tablas ni `overflow-x-auto` ni contenido que dependiera del scroll horizontal (grep sin resultados). `clip` no crea contenedor de scroll, así que el `sticky` del pie sigue anclado al scroller vertical.
- Sticky `-bottom-4` + `-mb-4` consistente con el padding del scroller en móvil (`py-4`) y desktop sin footer (`pb-4`); verificado por el hilo principal con Playwright (1440 y 390). Modo monto y estado de éxito comparten el mismo scroller y no agregan márgenes negativos propios.
- Móvil 390px: solo cambia `overflow-x-clip` y el footer condicional; targets de 44px intactos.

Sin hallazgos de capas, autorización, dinero ni datos personales (diff solo de clases y render condicional).

## Blockers
Ninguno.

APPROVED
