# 02 — Desarrollo frontend (F1)

"Antes del inicio" = las opciones traen una celda `pre_system` con `isCurrent` (`isBeforeStart` en `month-selection.ts`). Después del inicio nada cambia.

## Cambios
- `month-selection.ts`: `isBeforeStart`; `defaultSelection` antes del inicio = solo el mes actual (activo o de baja); `tapCell`: antes del inicio, tocar el primer mes previo marcado desmarca la parte previa (queda desde el primer mes del sistema hasta el final, o `null`). Tocar un previo marca hasta el último previo (ya era así); tocar uno proyectado extiende (ya era así).
- `month-entry.tsx`: `initialEntry` abre `preOpen` si es antes del inicio (sin pliegue: no se pasa `onToggle`, se pasa `beforeStart`). El total corregido (`overrideCents`) se descarta cuando la selección ya no incluye la parte previa (generaliza el `isPre ? null` anterior; después del inicio el resultado es el mismo).
- `month-strip.tsx`: `preSystem.beforeStart` dibuja la línea "Las cuotas arrancan en <mes>. Los meses anteriores se cargan como saldo anterior." (sin eyebrow). La celda previa actual mantiene el trazo punteado, con ícono `CircleDot` y texto "este mes"; para lectores de pantalla "este mes, antes del sistema".
- `member-account-section.tsx`: sin la condición `startPeriod <= currentPeriod`.
- `opening-balance-months.tsx`: antes del inicio el texto de ayuda dice "Las cuotas arrancan en … se marcan todos hasta este mes"; el mes actual dice "este mes" (por la tira); volver a tocar el primer mes lo desmarca.
- Grupo: sin cambios propios, usa `MonthEntry` (cada integrante hereda; la línea explicativa se repite por integrante).
- `payment-form.tsx`, `group-payment-form.tsx`, `register-payment-sheet.tsx`: sin cambios. Revisé el toast: antes del inicio, pagar el mes actual crea saldo anterior de 1 mes y el pago lo cancela, así que dice "La cuenta quedó al día."; con adelantos dice "Queda saldo a favor…", coherente. Resumen: "1 mes · octubre 2026", éxito "Cubre oct" (salen de `selectionSummary`/`coverLabel`, que ya contaban las celdas previas).
- Briefs `.impeccable/surfaces/*`: sin nota.

## Verificado
- `npm run typecheck` limpio, `npm run lint` 0 errores (9 warnings preexistentes en tests).
- `npx vitest run tests/views`: 217 pasan, 1 falla (ver abajo).
- Con un test descartable (borrado) y 12 previas + 3 proyectadas: selección inicial `{11,11}`, resumen "1 mes · octubre 2026", cover "oct", tocar 9 -> 9..11, tocar proyectada -> 9..13, tocar 9 de nuevo -> solo lo proyectado, tocar el actual solo -> `null`, monto derivado correcto.
- NO verificado: render visual a 390px (la base local arranca en 2026-10, no muestra el estado), ni el flujo completo contra la RPC.

## Tests que rompe
- `tests/views/members/member-account-section.test.ts:99-101` ("inicio en el futuro ... no aparece"): ahora el botón SÍ aparece; hay que invertir la expectativa.
- Falta cobertura nueva: `isBeforeStart`, `defaultSelection` y `tapCell` antes del inicio, línea explicativa, "este mes" en la celda previa, ausencia del botón "¿Debe meses de antes de…?".

## Ronda 2 (review: CHANGES REQUESTED)
- Hallazgo 1: `defaultSelection` y `tapCell` usan el índice de la celda `pre_system` con `isCurrent` (`currentPreSystemIndex`), no el último previo. La RPC ya garantiza que coinciden; el código no lo asume.
- El mes de inicio real ya no se deriva de `lastPre + 1`: `startPeriod` (de `billing.startPeriod`) viaja `register-payment-sheet` -> `PaymentForm`/`GroupPaymentForm` -> `MonthEntry` -> `MonthStrip`. Es opcional en las props; sin él `MonthEntry` cae a la derivación vieja (solo correcta con inicio al mes siguiente). La ficha ya pasaba `billing.startPeriod`.
- Hallazgo 4: nuevo `BeforeStartNote` (exportado de `month-strip.tsx`). El pago de grupo lo muestra una sola vez bajo "Integrantes" y pasa `hideBeforeStartNote` a cada `MonthEntry`.
- Nits (6): sin cambios.
- Verificado: typecheck limpio, lint 0 errores, `vitest tests/views` solo falla el test ya conocido. Sin verificación visual.
- Tests que rompen por esta ronda: ninguno nuevo. Siguen vigentes el de `member-account-section.test.ts:99-101` y la cobertura pendiente de la ronda 1 (más: inicio a 2+ meses).
