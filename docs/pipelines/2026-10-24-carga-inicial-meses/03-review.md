# 03 — Revisión de código: carga inicial por meses

**Veredicto: APPROVED**

Sin blockers. Hay dos hallazgos menores y tres nits; ninguno compromete plata, auditoría ni permisos.
Los de gravedad "menor" conviene resolverlos en este mismo PR si es barato, pero no frenan el commit.

## Alcance revisado

Working tree sin commitear (`git diff` + archivos nuevos):
`supabase/migrations/20261024170000_opening_balance_months.sql`, `src/models/{accounts,fees,types}.ts`,
`database.types.ts`, `src/views/payments/{month-selection.ts,month-entry.tsx,month-strip.tsx,month-drag.ts,use-month-drag.ts,payment-form.tsx,group-payment-form.tsx,register-payment-sheet.tsx}`,
`src/views/members/opening-balance-months.tsx`. Ignorados: `2026-10-15-importacion-padron/`, `Logo.png`.
Contrastado contra `00-architecture.md` y `01-tasks.md`, no contra los logs de los dev.

Verificaciones corridas: `npm run typecheck` sin errores en `src/` (solo fallan `tests/views/payments/payment-views.render.test.ts`,
por la prop `billingStarted`, que son los tests viejos que test-engineer está actualizando). `npm run lint`: los 2 errores
están en `tests/views/shared/responsive-sheet.test.ts` (preexistente, no es del diff).

## Migración `20261024170000_opening_balance_months.sql`

Correcta. Lo que verifiqué:

- **CHECKs vs. orden del guard.** El BEFORE INSERT `fees_opening_balance_guard` fija `period = inicio − 1` antes de que Postgres
  evalúe los CHECK, así que `to_period <= period` es "antes del inicio". El guard valida primero con mensaje legible
  (tramo incompleto, día ≠ 1, desde > hasta, > 36 meses, `to >= inicio`) y los CHECK quedan de red para PostgREST directo.
  Las filas viejas tienen ambas columnas NULL: `ADD COLUMN` nullable sin default, sin reescritura ni validación costosa.
- **Reparto.** `total / n` entero con el resto en el último mes; la cobertura por celda
  `least(monto, cubierto − (k−1)·(total/n))` es balance forward puro y suma exacto al total. `splitOpeningTotal` (TS) hace lo mismo.
  Σ celdas = fee, así que `credit` (pagos − Σ cargos, ahora sobre `coverage`) no cambia.
- **Inmutabilidad y grants.** `fees_immutable` recreado con `from_period`/`to_period`; solo `grant insert (from_period, to_period)`,
  sin grant de update. La auditoría toma `to_jsonb(row)`, así que las columnas nuevas quedan auditadas con actor.
- **Grants tras el drop + create.** `payment_month_options` se re-otorga (`revoke … from public, anon; grant … to authenticated`) en la misma
  transacción, y el `revoke execute on all functions in schema private` cierra la migración. `register_payment_batch` y el guard
  usan `create or replace` y conservan su ACL; el re-grant es redundante pero inocuo. El guard sigue `SECURITY DEFINER` con `search_path = ''`.
- **`register_payment_batch`.** Diff contra la versión vigente: solo cambia el `insert` (suma `from_period`/`to_period`). Idempotencia,
  lock advisory y chequeo de permiso intactos. No hay `createAdminClient` ni escritura fuera de sesión.
- **Compatibilidad hacia atrás en el deploy paralelo.** El código viejo ya mandaba `from_period`/`to_period` en el JSON, y contra el
  schema nuevo empieza a guardarlos; ignora `opening_from`; las celdas `opening_balance` con período real las trata como cualquier mes
  del sistema. El código nuevo contra el schema viejo falla al insertar la columna (PGRST204 → error genérico) y no deja nada a medias.
  Es el riesgo ya aceptado en la arquitectura §5.6; correr la migración antes o mergear fuera del horario de carga.
- **Sin DELETE ni UPDATE de monto.** `drop function` solo de la RPC de lectura.

## Plata en `month-selection.ts`

El monto enviado coincide con lo que hará la base:

- `derivedAmountCents` = Σ pendiente de las celdas marcadas de las opciones efectivas. `effectiveOptions` reparte el pozo ya pagado
  del más viejo al más nuevo, igual que `member_fee_coverage`, y el saldo con tramo es el cargo más viejo.
- `openingBalanceFromSelection` manda F..P con `override ?? Σ celdas`; el pago cubre solo lo marcado (F..L), y lo que sigue hasta P queda
  como deuda: es la semántica decidida. `spanAmounts` con override usa el mismo `splitOpeningTotal` que la RPC, y `n` coincide
  (cantidad de meses de la serie).
- `debtAfterPayment` cuenta lo no marcado con pendiente (meses previos de F..P no marcados, cuotas, mes actual proyectado) y excluye adelantos.
  La línea "Queda debiendo" es entonces fiel al resultado en la base.
- `coverageForAmount` ("Otro monto") arranca en F y recorre las celdas efectivas: consistente con balance forward.

## Capa de arrastre

Bien resuelta:

- **Scroll móvil.** Las celdas llevan `touch-pan-y`; el dedo solo arma tras 250 ms quieto (tolerancia 8 px). Si se mueve antes es
  scroll y se descarta. Recién al armar un listener nativo `touchmove` no pasivo hace `preventDefault`. El scroll del sheet no se secuestra antes de armar.
- **Click tras arrastre.** `suppressClick` con ventana de 350 ms; `consumeClick` lo consume en el handler del botón. **pointercancel** → `cancel`
  → idle con timer apagado. Un `down` siempre reinicia el estado, y el mouse sin botón apretado cancela (up perdido fuera de la ventana).
- **Limpieza.** El cleanup del `useEffect` saca los listeners y limpia el timer; al colapsar la grilla el hook se desmonta.
  `setPointerCapture` va en try/catch; `contextmenu` bloqueado solo fuera de idle (el clic derecho no entra: `button !== 0` corta antes).
- **Accesibilidad.** El camino por toque/teclado (tocar primer y último mes) queda intacto: `aria-pressed` solo en celdas elegibles,
  `sr-only` con mes y estado, botón Cambiar/Listo con `aria-expanded` + `aria-controls` apuntando a un `div` que siempre existe,
  targets `min-h-11`/`min-h-16`, ícono + texto (no solo color), `role="status"` en el resumen.
- **Diseño y formularios.** Sin kicker, sin tarjetas anidadas ni emoji; `tabular-nums` en montos; `method="post"` en ambos formularios;
  el pie sticky `-bottom-4 -mb-4` del fix de scroll sigue igual en pago individual y de grupo.
- **Ficha.** `opening-balance-months.tsx` solo suma `scope` para rotular; mantiene `preMode: 'to_end'` y no recibe `onRange`
  (sin arrastre en la ficha, igual que antes).

## Hallazgos

### 1. Menor — `src/views/payments/month-drag.ts:~66` (`armed`) y `use-month-drag.ts`: un toque lento se comporta como arrastre

Con dedo, cualquier pulsación de más de 250 ms sin mover se arma, emite `range(anchor, anchor)` y suprime el click. El resultado es que
**reemplaza** la selección por esa sola celda en lugar de aplicar la regla de tocar-tocar.
Escenario: en 390 px la operadora marca enero, y para llegar a junio apoya el dedo un poco más de un cuarto de segundo (común en
usuarios no técnicos o con el pulgar cansado). La selección vuelve a ser solo junio, y la vibración confirma un "arrastre" que nadie quiso.
No es silencioso (el monto, el resumen y "Queda debiendo" se actualizan) ni toca datos, pero rompe el camino que la arquitectura declara
de respaldo ("plan B: tocar-tocar").
Arreglo sugerido: en `armed` no emitir `range` hasta que el puntero entre en otra celda (el "mantener sin mover" arma el modo pero no
selecciona), y que el click siga haciendo el toque normal cuando no hubo arrastre real. Aviso a `test-engineer`: caso de `dragReduce`
`down(touch) → armed → up` sin `enter`.

### 2. Menor — `src/views/payments/month-selection.ts:~177` (`paidPoolCents`): el pozo ignora los meses pagos que la RPC ya no muestra

`payment_month_options` solo devuelve cuotas desde el primer mes con deuda (`period >= first_due`). Una cuota anterior ya pagada no
entra en `coveredCents` de las celdas visibles, así que el pozo (cubierto visible + crédito) queda corto respecto de "todos los pagos".
Escenario: un socio con la cuota de noviembre paga, diciembre debida y sin saldo anterior; si desde el pago se marca un tramo previo,
la vista asume que los pagos existentes cubren menos de lo que cubrirán, y el derivado de lo marcado sale mayor al que la base
termina necesitando (balance forward corre noviembre hacia el saldo más viejo).
No es una regresión de este diff (`paidPoolCents` ya estaba en HEAD) y en la carga inicial, antes del inicio, no hay cuotas, así que no aplica.
Pasa recién con socios dados de alta con saldo anterior después del arranque. Dejarlo anotado como seguimiento; corregirlo exige que la
RPC devuelva el cubierto total (otra migración).

### 3. Nit — `src/views/payments/group-payment-form.tsx:~95`: prop `billingStarted` declarada y no usada

`GroupPaymentForm` la recibe en el tipo pero no la desestructura ni la usa, y `register-payment-sheet.tsx` la pasa igual. Es código muerto
con un comentario que justifica no usarla. Quitar la prop de ambos lados, o usarla.

### 4. Nit — `src/views/payments/month-strip.tsx`: prop `id` sin uso real

`MonthEntry` no le pasa `id` a `MonthStrip` (el `aria-controls` apunta al `div` propio), así que la prop `id` de la tira
queda como superficie sin consumidor. Eliminarla o usarla.

### 5. Nit — `src/models/fees.model.ts:~108`

`translateOpeningBalanceError` detecta los CHECK del tramo por `message.includes('fees_opening_span_')`: depende del texto de Postgres.
Funciona hoy y el guard cubre el caso normal; alcanza con dejar el comentario que ya explica que es una red.

## Cobertura que sugiero a `test-engineer`

- Paridad de `splitOpeningTotal` (TS) con el reparto de la RPC (el reporte DB lo deja pendiente, 100.000,00 en 3 → 3.333.333/3.333.333/3.333.334).
- `dragReduce` con touch: `armed` sin movimiento y `up`; `move` sobre tolerancia antes de armar → idle; `cancel` durante `dragging`.
- `tapCell` en modo `free`: deseleccionar la única celda; extender hacia atrás; `fresh`.
- `debtAfterPayment` / `openingScope`: pago ene–jun con saldo hasta oct (6 pagados, 4 debidos); con total corregido; con crédito previo.
- Los tests de render de `payment-form` / `group-payment-form` necesitan `billingStarted` (hoy no compilan).

## Blockers

Ninguno.

## Lo bueno

- La invariante vive en la base: CHECKs + guard con mensajes + inmutabilidad + grant por columna, y todo se audita por trigger.
- El reparto del saldo es determinista y está espejado exacto entre SQL y TS, con el resto en el mes que balance forward cubre último.
- La línea "Queda debiendo N meses · $X" hace visible la consecuencia de marcar de menos, que era el riesgo principal de la semántica decidida.
- El arrastre es una máquina de estados pura (`month-drag.ts`) más un hook delgado; no secuestra el scroll antes de armar y limpia todo al desmontar.
- La retrocompatibilidad del deploy paralelo está pensada y documentada, con reversa escrita en la cabecera de la migración.
