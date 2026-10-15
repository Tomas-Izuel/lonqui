# 02 — Desarrollo frontend (F1)

## Tarea
F1 de `01-tasks.md`: acción "Cambiar" por fila y sheet con dos modos. Aplica §11 de `00-architecture.md` (el monto en modo cambio viene PRECARGADO con el valor de la fila; reemplaza §6.5/§9).

## Archivos
- `src/views/settings/fee-prices-section.tsx` (editado).
- `src/views/settings/fee-price-sheet.tsx` (`git mv` desde `new-fee-price-sheet.tsx`; export `FeePriceSheet`, props `mode: 'new' | 'change'`, unión discriminada).
- Contratos consumidos: `FeePriceHistoryEntry`, `FeePricesOverview` (types.ts), `createFeePrice` (`billing.actions.ts`, sin cambios). Nada nuevo en `views/shared`.

## Comportamiento implementado
- Filas de vigentes y próximos: botón de texto "Cambiar" (`aria-label="Cambiar valor de <destino>"`, `h-11`). Historia: sin acción; filas con `supersededById !== null` muestran "· Reemplazado" y monto atenuado (sin pill).
- Fila vigente: tercera línea "Cambia a $Y desde <mes>" con el programado de menor `validFrom` del mismo destino.
- Layout de fila: `[etiqueta (truncable, flex-1 min-w-0) / desde] [monto whitespace-nowrap shrink-0] [Cambiar shrink-0]`. A 390px (panel ~358px): monto ~70px + botón ~80px dejan ~190px a la etiqueta, que trunca; el monto nunca. La línea "Cambia a…" puede envolver (no trunca).
- Sheet modo `change`: título "Cambiar valor de cuota", descripción = etiqueta del destino (en vigentes por categoría incluye la disciplina), línea "Hoy|Programado: $X desde <mes>", sin campos de alcance/destino, monto precargado con foco al abrir (`autoFocus`), "Aplica desde" default = primera opción (vigente) o el mes de la fila (programada).
- Ambos modos: frase fija bajo "Aplica desde" con el mes elegido; aviso "Reemplaza el valor de $Y programado para <mes>." si hay fila del destino y mes sin `supersededById` (se oculta si el monto es igual, porque ahí salta el guard); guard de cliente en `onValid`: si el monto == el que rige ese mes para el destino (mayor `validFrom <=` mes entre filas no reemplazadas, desempate por id) → error en `amountCents` "Es el mismo valor que ya tiene para ese mes".
- Éxito: toast "Valor de cuota actualizado" (cambio) / "Valor de cuota creado" (nuevo). Errores de servidor van al campo (`result.field`, p. ej. validFrom por el guard de Postgres) o a un `role="alert"`. Botón Guardar con loader y "Guardando…".
- Rol: la sección ya es solo admin (la page); no se agregó chequeo nuevo. RLS/`billing.configure` protegen la escritura.
- Form con `method="post"`.

## Decisiones
- El sheet de cambio se monta por fila con `key={price.id}` para que el form arranque con los defaults de esa fila; se conserva el último `changing` mientras `changeOpen` cierra.
- El guard de "mismo valor" vive en `onValid` y no en el schema Zod porque necesita `history`/destino.
- `sameTarget` está duplicado en sección y sheet (helpers puros locales); no justifica primitiva compartida.

## Verificación
`npx tsc --noEmit` y `eslint` de los dos archivos: limpios. No verifiqué en navegador.

## Criterios de aceptación para tests (keyed F1)
- Botón "Cambiar valor de Por defecto" abre diálogo "Cambiar valor de cuota" con campo Monto precargado y "Hoy: $… desde …".
- Enviar sin tocar el monto con el default de mes → "Es el mismo valor que ya tiene para ese mes", sin llamar a la action.
- Elegir un mes con valor programado distinto → texto "Reemplaza el valor de $… programado para …".
- Historia: "Reemplazado" solo en filas superadas; sin botón Cambiar.
- "Nuevo valor" sigue igual (campos alcance/categoría/tipo).

## Deferrals
Ninguno. Pendiente: pasada visual a 390px en navegador.
