# 03 — Review: imputación explícita por cuota y saldo anterior por mes

Rama `feat/imputacion-por-cuota` contra `main` (todo sin commitear). Primera pasada y re-review:
2026-10-29.

## Veredicto: **APPROVED** (re-review)

Los dos bloqueantes de la primera pasada están corregidos y **los volví a reproducir contra la base
local con la migración corregida** (transacciones con `rollback`): anular una cuota por el camino del
modelo (`update … set void_reason`) reimputa el crédito liberado; anular un pago cuando otro pago tiene
saldo a favor reimputa ese crédito y `member_balance`, `member_accounts`, `fee_status` y
`payment_credit` vuelven a decir lo mismo. El cambio de locks a `FOR NO KEY UPDATE` (H1 de T4) lo probé
con dos sesiones: sigue serializando motor contra motor y anulación contra guard, y el `KEY SHARE` del
FK ya no choca. `03-tests.md` dice `SUITE GREEN`. Quedan dos cosas de documentación y una duda sobre el
informe de tests, ninguna bloquea el commit (abajo, "Pendientes no bloqueantes").

## Alcance revisado

```
 .impeccable/surfaces/route-caja.md            |   4 +-
 .impeccable/surfaces/route-socios-id.md       |   2 +-
 CLAUDE.md                                     |  63 ++-  (+ regla de triggers de anulación)
 src/controllers/payments.actions.ts           |  49 +-
 src/lib/dates.ts                              |  27 ++
 src/lib/supabase/database.types.ts            |  79 +++-
 src/models/accounts.model.ts                  |  33 +-
 src/models/audit.model.ts                     |  96 +++-
 src/models/fees.model.ts                      | 141 +++---
 src/models/payments.model.ts                  | 109 ++++-  (+ fallback PGRST200, campo del monto)
 src/models/types.ts                           |  44 +-
 src/views/audit/audit-labels.ts               |  11 +
 src/views/members/member-account-section.tsx  |  41 +-
 src/views/members/member-detail-view.tsx      |   3 +-
 src/views/members/member-fee-statement.tsx    |   5 +-
 src/views/members/member-payments-list.tsx    |  42 ++
 src/views/members/opening-balance-months.tsx  |  75 +--
 src/views/payments/group-payment-form.tsx     |   8 +-
 src/views/payments/month-entry.tsx            | 174 ++++---
 src/views/payments/month-selection.ts         | 628 ++++++++++++++------------
 src/views/payments/month-strip.tsx            | 161 +++++--
 src/views/payments/payment-form.tsx           |  47 +-
 src/views/payments/register-payment-sheet.tsx |  25 +-
 src/views/payments/use-month-drag.ts          |  16 +-
 src/views/shared/labels.ts                    |   9 +
 + supabase/migrations/20261029120000_payment_allocations.sql (nuevo)
```

Ignorados a pedido: `docs/pipelines/2026-10-15-importacion-padron/`, `public/Logo.png`.

---

## Re-review: qué se corrigió y cómo lo verifiqué

| # | Hallazgo original | Estado | Evidencia |
|---|---|---|---|
| B1 | `fees_apply_credit_on_void` con `of voided_at` nunca disparaba desde `voidFee` | **Corregido** (`…payment_allocations.sql:771-775`: `after update on public.fees … when (old.voided_at is null and new.voided_at is not null)`) | `pg_get_triggerdef` en local lo confirma; escenario E (`update fees set void_reason = …`): aparece `(P, F2, credit)`, F2 `paid`, crédito 0 |
| B2 | Anular un pago no reimputaba el crédito de los otros pagos | **Corregido** (`:510-520` función DEFINER, `:777-781` trigger sin `of`, revocada a los 4 roles en `:1247`) | `has_function_privilege` = false para `public/anon/authenticated/service_role`; escenario A: tras anular P1, F1 `paid` por `(P2, F1, credit)`, `member_accounts` balance 0 / `months_due` 0 / `up_to_date`, `payment_month_options` sin adeudado ni adelanto cubierto |
| M3 | Embed `payment_allocations` rompía la ficha y `/caja/pagos` contra el schema viejo | **Corregido** (`payments.model.ts:365, 499-501, 569-571`: ante `PGRST200` reintenta sin el embed; `mapAllocations` ya devolvía `[]` sin la clave) | Lectura; la lógica es la misma en los dos lectores |
| H1 (T4) | Deadlock entre dos lotes del mismo socio: `KEY SHARE` del FK vs `FOR UPDATE` del motor | **Corregido** (`:247, :259, :376, :424`: `for no key update`) | Dos sesiones, todo revertido: (a) `NO KEY UPDATE` vs `NO KEY UPDATE` sobre `members` espera (lock timeout) → **serializa motor contra motor**; (b) `INSERT` de un pago del socio bloqueado: el FK (`KEY SHARE`) pasa y la espera es "while locking tuple in relation members" dentro del motor → **sin deadlock, serializado**; (c) `update fees set void_reason` sobre una cuota retenida por el guard espera → **la anulación serializa con el guard**; (d) `INSERT` en `fees` con el trigger de crédito apagado no espera → el `KEY SHARE` ya no choca. Un `UPDATE` común (anulación, edición de socio) toma `NO KEY UPDATE`, que conflictúa con el del motor: no se pierde ninguna serialización que importe; lo único que deja pasar es el chequeo de FK, que es lo que se buscaba |
| m4 | Sin `lock_timeout` | **Corregido** (`:32` `set local lock_timeout = '30s'`) | — |
| m5 | Orden de locks cron vs. lote | **Corregido** (`:487` `order by i.member_id`; `:1196` `order by x.member_id`) | — |
| m6 | "…y cada mes tiene que ser mayor a cero" caía en `amountCents` | **Corregido** (`payments.model.ts:228`: solo el texto exacto del monto) | — |
| nit | Reintento del lote sin `voided_at is null` | **Corregido** (`:1075-1077`) | — |
| nit | Descripción del tramo copiada a cada mes (payload viejo) | **Corregido** (`:1136-1140`: sin descripción, la pone el guard) | — |
| nits | Comentario "balance forward" y copy "se marcan todos" en la ficha | **Corregidos** (`opening-balance-months.tsx:155`) | — |
| m7 | Saldos viejos sin tramo vuelven a ofrecer meses previos | **Abierto por decisión del usuario**: va al procedimiento de release (§7.1, si el `notice` da > 0) | — |
| m8 | Alta anterior a la ventana → el tramo es siempre de 12 meses | **Es la regla elegida por el usuario** (§6.3) | — |

Además re-corrí los escenarios de la primera pasada que ya estaban bien: guard que ve las filas
anteriores del mismo `INSERT` (rechaza la segunda), `UPDATE`/`DELETE` de `payment_allocations` con
`session_replication_role = replica` (rechazados), grants por rol y columna, `security_invoker`,
DEFINER + `search_path = ''`. `CLAUDE.md` suma la regla correcta ("los triggers de anulación son
`after update … when (...)`, nunca `update of voided_at`") y dice que anular un pago reimputa el
crédito.

## Pendientes no bloqueantes (para el hilo principal)

1. **`00-architecture.md` quedó desactualizado** respecto del SQL real: §6.2.3 (línea 319, "anular un
   pago: … nada se reimputa"), §6.6 (línea 403, "Anulación de pago: sin cambios"), §8 (línea 580, "la
   ficha lista saldos (funciona)") y el SQL de §9 (línea 1343 sigue con `after update of voided_at`, sin
   `payments_apply_credit_on_void`, con `for update`, sin `lock_timeout`). CLAUDE.md es la conclusión y
   ya está bien; el pipeline es el registro del razonamiento y hoy contradice lo que se mergea. Alcanza
   con una sección "Correcciones post-review (B1, B2, M3, H1)" al final del 00 que remita a este
   archivo y a `03-tests.md`, sin reescribir §9.
2. **`03-tests.md` se contradice**: el veredicto dice "1681 verdes, 1 skipped" y "SUITE GREEN", pero la
   línea "Corrida final" dice "1 failed | 1678 passed | 1 skipped (1680)". El hilo principal reporta
   dos corridas seguidas en verde (1681); que `test-engineer` deje una sola cifra, la de la corrida que
   vale, antes del commit.
3. Para el release (§7.1): el archivo de migración cambió después del ensayo contra el dump; el hilo
   principal dice que lo re-ensayó (79 celdas y saldos idénticos). Dejarlo asentado en `00-t0-estado.md`
   o en el 00, con la fecha, para que el merge no dependa de la memoria de nadie.

---

## Primera pasada (2026-10-29, CHANGES REQUESTED) — se conserva como registro

### B1 — BLOCKER · `fees_apply_credit_on_void` nunca se dispara desde la app

**`supabase/migrations/20261029120000_payment_allocations.sql`** (trigger de anulación de cuota) y
**`src/models/fees.model.ts:211-225`**.

El trigger estaba declarado `after update of voided_at on public.fees`. Un trigger `UPDATE OF columna`
dispara **solo si la columna aparece en el SET del UPDATE**; que un BEFORE trigger la modifique no
cuenta (docs de `CREATE TRIGGER`). `voidFee` hace `.update({ void_reason: reason })` — la única
columna del SET es `void_reason`; `voided_at` la pone `fees_void_guard`. Resultado: la anulación de
una cuota por el camino real **no reimputaba nada**.

Reproducido en local (admin por JWT, mismo UPDATE que el modelo):

```
-- F1 (sep), F2 (oct), pago P $10.000 → P cubre F1 (oldest_first), F2 adeudada
update public.fees set void_reason = 'prueba' where id = F1;
-- payment_allocations: sigue solo (P, F1)        ← no apareció ninguna fila 'credit'
-- fee_status:          F2 due, pending 1.000.000
-- payment_credit:      P credit 1.000.000        ← deuda y saldo a favor conviven
```

Con `set voided_at = now(), void_reason = …` (lo que probó T0 como `postgres`) sí aparecía `(P, F2,
credit)`. Por eso el smoke de `00-t0-estado.md` pasó y el producto no. Arreglo aplicado: trigger sin
`of voided_at`, con el `WHEN`.

### B2 — BLOCKER · anular un pago no reimputaba el crédito de los otros pagos

No había trigger de anulación en `payments`. El plan decía "anular un pago: nada se reimputa (no hay
plata)". Falso cuando **otro** pago del socio tiene saldo a favor (un adelanto, que el diseño nuevo
fomenta). Reproducido:

```
-- F1 (oct $10.000); P1 $10.000 el 5/10 → cubre F1; P2 $10.000 el 20/10 → crédito 10.000
-- admin anula P1 (cargado al socio equivocado):
fee_status:        F1 due, pending 1.000.000
payment_credit:    P2 credit 1.000.000              ← conviven
member_balance:    balance 0, months_due 1, oldest_due 2026-10
member_accounts:   debt_status = 'up_to_date' y months_due = 1   ← se contradice en la misma fila
debt_by_category:  suma +1.000.000 (dashboard total_debt: 0)     ← la suma por categoría ya no cierra
payment_month_options: oct pending 1.000.000 y nov 'projected' covered 1.000.000
```

Arreglo aplicado: `private.payments_apply_credit_on_void()` + trigger `after update on payments … when
(old.voided_at is null and new.voided_at is not null)`, revocada a los cuatro roles.

### M3 — MAJOR · en la ventana de despliegue la ficha y `/caja/pagos` dejaban de abrir

`listPaymentsForMember` y `getMonthPaymentsPage` embebían `payment_allocations(...)`; contra el schema
viejo PostgREST responde `PGRST200` y las dos páginas caían en error. Arreglo aplicado: reintento sin
el embed con `allocations: []`.

### Menores y nits de la primera pasada

m4 `lock_timeout`; m5 orden de locks cron vs. lote; m6 campo del mensaje "mayor a cero"; m7 saldos
viejos sin tramo y `pre_system` (release); m8 alta anterior a la ventana (regla del usuario); reintento
sin `voided_at is null`; descripción del payload viejo por mes; comentario y copy en
`opening-balance-months.tsx`; saldo a favor por pago sumado en el cliente (acotado a un pago, coincide
con `payment_credit`); las cuatro funciones de migración quedan en `private` revocadas (decisión del 00
para que T4 las pruebe).

---

## Lo que está bien (verificado en las dos pasadas)

- **Migración de datos.** `mig_fees` reproduce `member_fee_coverage` (130200) con la misma ventana y
  orden `(period, saldo, discipline_id nulls first, id)`; `mig_cells` reproduce `opening_cells` de
  141024170000 (partición por `fee_id` ≡ por socio con el índice viejo). `split_opening_total` es
  espejo exacto de `splitOpeningTotal`. El backfill por solape de acumulados da, por cargo,
  `min(amount, Σ pagos − acumulado previo)` = la fórmula vieja; por pago, `allocated ≤ amount`;
  Σ imputado + Σ crédito = Σ pagos. La verificación compara cada cargo sin tramo, cada mes de cada
  tramo (monto y cobertura), deuda y crédito por socio, totales de tramos, topes por pago, nada a
  anulados y el global. Anular el tramo **antes** de insertar sus meses evita el choque con el índice
  nuevo. Idempotente (`exists` en las dos funciones de datos; en un re-run el primer `create function`
  aborta todo). `fees_void_guard` se desactiva solo dentro de la función y en la misma transacción;
  `fees_immutable` y la auditoría siguen (actor `system`). Ninguna sentencia parte la transacción;
  `statement_timeout` y `lock_timeout` locales. Compatibilidad: payload viejo expandido; `period` null
  → inicio − 1; lectores con fallback ante el schema viejo; gate de `before_joined` en el formulario.
- **Seguridad.** `authenticated`/`service_role` solo SELECT en `payment_allocations`; `anon` nada;
  `fees.period` con INSERT, `from_period`/`to_period` sin INSERT; motor, triggers de anulación y
  funciones de migración sin EXECUTE para ninguno de los cuatro roles; `fee_status`/`payment_credit`
  con `security_invoker`; DEFINER en `private` con `search_path = ''`; RLS con `private.can`; el GUC
  `lonqui.marked_periods` es local a la transacción y solo lo fija la RPC.
- **Motor.** Marcados en orden → `oldest_first` → crédito; un marcado ya pago se saltea; el crédito se
  aplica a cuotas nuevas, a la anulación de una cuota y a la anulación de un pago; el guard bloquea pago
  y cuota, ve las filas anteriores del mismo INSERT y la anulación espera al guard. Locks de socio con
  `NO KEY UPDATE`: serializan entre sí y dejan pasar al FK, sin deadlock.
- **Capas.** `payments.actions.ts` con `'use server'` en línea 1 y solo funciones async; ninguna
  `page.tsx`/`layout.tsx` importa `@supabase/*`; las vistas no importan modelos; errores de base →
  `DomainError` solo si no son crudos; nada personal en logs ni en los `raise`. Alcance dentro de la
  Fase 1. `src/` con `tsc` y `eslint` limpios.
- **UI.** Celdas `min-h-11`/`min-h-16`, `aria-pressed`, `aria-disabled` + `role="status"` para el
  adelanto bloqueado, `sr-only` con mes y estado, íconos lucide (uno por estado), `tabular-nums`,
  `pointer-coarse:` (Tailwind v4), `method="post"` en el formulario de la ficha, estados
  cargando/vacío/error con "Reintentar" (sheet y ficha), aviso de fecha de alta con link de 44 px. La
  lógica de la grilla es pura (`month-selection.ts`) y su preview coincide con la regla de la base.

## Bloqueantes

Ninguno.
