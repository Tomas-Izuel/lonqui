# 02 — Desarrollo frontend (T3): selección, arrastre, grilla colapsable

Agente: frontend-react-craftsman, 2026-10-24. Spec: `00-architecture.md` §6–§7, `01-tasks.md` T3.

## Archivos
- `src/views/payments/month-selection.ts` (lógica pura, reescrita en la parte de selección/montos)
- `src/views/payments/month-drag.ts` (nuevo, máquina de estados pura)
- `src/views/payments/use-month-drag.ts` (nuevo, capa de punteros)
- `src/views/payments/month-strip.tsx`, `month-entry.tsx`, `payment-form.tsx`, `group-payment-form.tsx`, `register-payment-sheet.tsx`
- `src/views/members/opening-balance-months.tsx` (ficha: sin arrastre, `preMode: 'to_end'`)

## Firmas nuevas o cambiadas (puras)
- `isLegacyOpening(o)`: `kind === 'opening_balance' && !o.openingFrom` (`!`, no `=== null`: tolera fixtures/RPC vieja sin la columna).
- `cellTone(o)`: opening con `openingFrom` se pinta como monthly; la legacy conserva `opening_balance`; una `pre_system` con `pendingCents <= 0` (solo en opciones efectivas) devuelve `covered`.
- `splitOpeningTotal(totalCents, months): number[]`
- `openingSpan(options, selection): { from, to } | null` (`to` = última `pre_system`)
- `openingBalanceFromSelection(options, selection, overrideCents?)`: `fromPeriod` = primer previo marcado, `toPeriod` = período de `span.to`, monto = override ?? Σ F..P.
- `effectiveOptions(options, selection, ctx)` (antes `(options, openingAmountCents, credit)`); `optionsForSelection` mantiene la firma.
- `derivedAmountCents` = Σ `pendingCents` de las celdas marcadas efectivas. `openingNetCents` y `extendToDueMonths` eliminados.
- `coverageForAmount`: recorre efectivas desde F (o primer mes del sistema); las previas solo dentro de F..P. Las previas con pendiente 0 (cubiertas por saldo a favor) ya no figuran en `fullyCovered`.
- `tapCell(options, selection, index, { preSystemOpen, preMode?: 'to_end'|'free', fresh? })` (default `'to_end'` = comportamiento anterior).
- `dragSelect(options, anchor, over): Selection`
- `preCellRole(options, selection, index): 'marked' | 'owed' | null` (recibe efectivas; una previa sin pendiente da `null`)
- `debtAfterPayment(options, selection, ctx): { months, cents }`
- `openingScope(options, selection, ctx, { payment }): OpeningScope | null` (nuevo; alimenta el rótulo del total corregible: desde cuándo, meses, suma, pagó/queda debiendo).
- `selectionSummary` / `coverLabel`: solo la legacy cuenta como "saldo anterior".
- `month-drag.ts`: `dragReduce(state, event) -> { state, effects }`, `IDLE`, `TOUCH_ARM_MS = 250`, `TOUCH_MOVE_TOLERANCE_PX = 8`. Eventos `down|move|armed|enter|up|cancel`; efectos `range|arm|timer|suppressClick`.
- `month-entry.tsx`: `EntryState` suma `expanded` y `picked`; `initialEntry(options, status, { expanded })`; nuevos `entryDebtAfter`, `debtLine`.

## Decisiones que el spec dejó abiertas
1. **Evento extra `move` en la máquina** para la tolerancia del dedo (el spec solo listaba down/armed/enter/up/cancel). `enter` se calcula por hit-test (`elementFromPoint`) en cada `pointermove`.
2. **Grilla abierta forzada con "Otro monto"**: `initialEntry` abre la grilla si no hay selección por defecto; "Otro monto" fija `expanded: true`.
3. **Botón "Listo"** (en vez de "Cambiar") cuando la grilla está abierta, para poder volver a colapsar. El resumen (`role="status"`) y el botón van siempre arriba, en una fila; `aria-controls` apunta a un contenedor que existe siempre (la grilla se monta solo abierta).
4. **Pago individual**: el pie fijo ya no repite el resumen de meses (vive arriba, junto a "Cambiar"); conserva "Pago a cuenta…" en modo "Otro monto" y suma la línea "Queda debiendo N meses · $X" (`showDebtLine={false}` en `MonthEntry` para no duplicarla). En grupo la línea va por integrante, debajo de su resumen.
5. **El total corregido sobrevive mientras no cambie F** (el primer previo marcado), no solo mientras la selección siga arrancando en previa. Cambiar el último marcado no cambia la deuda F..P.
6. **`GroupPaymentForm` acepta `billingStarted?: boolean`** por contrato pero no lo usa (siempre arranca colapsado). Opcional para no romper tests existentes.
7. Ayuda de arrastre solo cuando hay celdas previas visibles y hay arrastre (en la ficha no hay). Dos spans con `pointer-coarse:` (Tailwind 4.3).
8. La ficha pasa `scope` con `payment: false`: el rótulo del total es el mismo ("Total de la deuda desde <F> (N meses)") pero la pista no dice "Pagó…".
9. Lint (`react-hooks/refs`): el hook devuelve `setList` (ref callback con estado) y hay que desestructurar el resultado; pasar `drag.listRef` en render falla el lint.

## Comportamiento implementado (criterios para test-engineer)
- Pago individual antes del inicio (`billingStarted=false`): grilla abierta; después del inicio y en grupo: cerrada con resumen "N meses · rango" y botón "Cambiar" (`aria-expanded`, `aria-controls`, `min-h-11`).
- Tocar sobre previas (modo `free`): `fresh` reemplaza el default, tocar-tocar da rango, tocar marcado intermedio lo vuelve final, tocar el final achica, único marcado se desmarca.
- Arrastrar con mouse (arma al entrar en otra celda) y dedo (mantener 250 ms, sin mover > 8 px; si se mueve antes, scroll). Selección en vivo; el `click` posterior (ventana 350 ms) se descarta. Un arrastre reemplaza la selección.
- Previas dentro de F..P sin marcar: ícono `AlertCircle` + "queda debiendo". Línea "Queda debiendo N meses · $X" (no en "Otro monto").
- Total corregible: "Total de la deuda desde <mes> (N meses)", pista "Pagó X meses · $Y. Queda debiendo Z meses · $W. Si debía otro valor, corregí el total."
- Avisos de saldo existente (solo grilla abierta), con y sin `openingFrom`, con el texto del §7.4.
- Ficha: `preMode: 'to_end'`, sin `onRange`, sin ayuda de arrastre.
- Forms `method="post"` intactos; el body a `registerPayment` no cambia de forma; el pie `sticky -bottom-4` se mantiene.

## Verificación
- `npm run typecheck`: sin errores en `src/`. Errores en `tests/` (sin tocar): `billingStarted` requerido en `PaymentForm`; fixtures sin `openingFrom`; llamadas viejas a `effectiveOptions(options, number, credit)`.
- `npm run lint`: `src/` limpio (quedan errores de `tests/views/shared/responsive-sheet.test.ts`, ajenos).
- `npx vitest run tests/views`: 18 fallan, TODOS por semántica vieja (ninguno por otra cosa):
  - `extendToDueMonths` (9 tests): función eliminada.
  - `effectiveOptions` (4): firma nueva `(options, selection, ctx)`.
  - `coverageForAmount` (5): previas ya cubiertas por crédito no figuran como cubiertas por el pago; el reparto por celda usa partes del total (override) y el pozo cae en orden de mes.
  - `selectionSummary` caso del review: las previas cubiertas por crédito ya no son marcables, el rótulo arranca en el primer mes marcable.
  - `payment-views.render` "3 integrantes con startPeriod": esperaba 15 celdas; en grupo la grilla ahora arranca colapsada.
  - Además, `tsc` de tests: `PaymentForm` pide `billingStarted`.

## Verificación manual obligatoria (§11)
iOS, Android y escritorio:
1. Scrollear vertical sobre la grilla en el celular: no debe arrastrar ni marcar.
2. Mantener apretado y arrastrar ene–jun: marca en vivo, no scrollea; soltar deja el rango; no queda un toque fantasma.
3. Tocar-tocar (primero y último), tocar el final para achicar.
4. Mouse: apretar y arrastrar entre celdas, soltar fuera de la grilla.
5. Teclado: Tab hasta las celdas, Enter/Espacio marca; "Cambiar"/"Listo" con Enter.
6. Lector de pantalla: anuncia el resumen (`role="status"`).
7. 390 px: sin scroll horizontal, targets >= 44 px, el pie fijo sigue pegado abajo.
8. Menú contextual / lupa de iOS no aparecen al mantener apretado; el sheet no scrollea mientras está armado.

## Corrección post-review: toque lento en touch
- `month-drag.ts`: el estado `dragging` suma `moved: boolean`. En touch, `armed` ya NO emite `range` (solo `arm`: bloquea scroll y vibra), con `over = anchor` y `moved: false`. `enter` a otra celda emite `range` y pone `moved: true` (en mouse, el arme por `enter` ya nace con `moved: true`). `up` en `dragging` emite `suppressClick` solo si `moved`; si no, no emite nada y el `click` del botón corre `onTap` una sola vez (un toque lento = toque normal). Nombres de evento y efecto sin cambios; mouse sin cambios.
- `use-month-drag.ts` no cambió.
