# 03 — Revisión de código: cuotas, pagos, estado de cuenta y panel (slice 2)

Revisor: `code-reviewer`. Fecha: 2026-09-28. Alcance: diff sin commitear desde
`369cd1f`, **incluido** el panel inicial definitivo (la ronda de diseño se
cerró: `src/app/(panel)/inicio-propuestas/**` ya se borró, y `page.tsx`,
`loading.tsx`, `error.tsx`, `src/views/dashboard/**` y el flag
`COBRANZA_ENABLED` de `nav-items.ts` son ahora la superficie final, F3).
`tests/**` es responsabilidad de `test-engineer` en paralelo; no lo audito
salvo para confirmar que `typecheck`/`lint` de producción están verdes.

## Veredicto: **CHANGES REQUESTED**

Un solo hallazgo que elevo a **MAJOR** y pido corregido antes de commitear
(fix mecánico, dos líneas): dos actions nuevas de este slice usan
`requireRole()` en vez de `requirePermission(...)`, violando sin excepción la
regla propia de este pipeline ("ningún `requireRole`/`has_role`/`is_admin`/
`session.role` en código nuevo", `01-tasks.md`, lane `review`). No es
explotable hoy — RLS sigue siendo el gate real y hoy los tres roles tienen el
permiso equivalente — pero es exactamente la deuda que T12/D20 se propuso
evitar, en código escrito en esta misma tanda, no heredado. El resto —
cinco auditorías independientes cruzadas (schema/migraciones, backend B1–B4,
frontend F1/F2/F4, shell/lint/feedback del slice 1, y el panel inicial
definitivo F3), más verificación propia sobre los puntos de mayor riesgo— no
encontró ningún otro BLOCKER ni MAJOR. Todo lo demás es MINOR, NIT o
informativo: no compromete seguridad, dinero, auditoría, "nada se borra" ni el
alcance de Fase 1. `npm run typecheck` y `npm run lint` están limpios sobre
todo el árbol, incluidos `tests/**` (0 errores; 1 warning de una variable sin
usar en un test, ajeno a este lane).

## Resumen del alcance revisado

Migraciones nuevas: `20260927120000_review_fixes.sql`,
`20260927125000_member_categories.sql`, `20260927130000_billing.sql`,
`20260927130100_payments.sql`, `20260927130200_accounts.sql`, `seed.sql`
(modificado). Backend nuevo: `fee-prices.model.ts`, `billing.model.ts`,
`payments.model.ts`, `fees.model.ts`, `accounts.model.ts`,
`member-categories.model.ts`, `reports.model.ts`, `billing.actions.ts`,
`payments.actions.ts`, `payments.controller.ts`, `reports.actions.ts`,
`reports.controller.ts`, más modificaciones a `settings.*`, `members.*`,
`catalogs.model.ts`, `audit.model.ts`, `types.ts`, `session.controller.ts`/
`session.model.ts`. Frontend nuevo: `app/(panel)/cobranza/**`,
`views/payments/**`, selectores y diálogos de categorías en
`views/members/**`, secciones de cuenta/statement en la ficha, secciones de
facturación y valores de cuota en `/ajustes`, y el **panel inicial
definitivo** (`app/(panel)/page.tsx`, `loading.tsx`, `error.tsx`,
`views/dashboard/**`). Transversal: regla de lint de forms por POST,
`ResponsiveSheet`, navegación móvil del shell (incluido prender
`COBRANZA_ENABLED`), primitivas shadcn actualizadas a 44px, `safe-redirect.ts`,
fixes de la revisión del slice 1 (`mark_password_reset` con rastro siempre,
cambio de grupo familiar sin perder el responsable, cierre del `EXECUTE` de
`PUBLIC` sobre `private`). 76+ archivos, ~3750 líneas agregadas sin contar el
panel inicial definitivo.

## Hallazgos

### MAJOR

1. **`src/controllers/members.actions.ts:339` y `:370` — dos actions nuevas usan `requireRole()` en vez de `requirePermission(...)`.**
   ```ts
   // :339, getMedicalClearanceUrl (firma del certificado de apto físico)
   await requireRole()
   // :370, loadMoreMembers ("Ver más" del padrón)
   const session = await requireRole()
   ```
   Ambas funciones son **nuevas de este slice** (confirmado por `git diff
   369cd1f`, no son código heredado del slice 1). El propio `01-tasks.md`
   (lane `review`, línea final) lo nombra como criterio explícito y sin
   excepciones: *"ningún `requireRole`/`has_role`/`is_admin`/`session.role`
   en código nuevo (solo `requirePermission`, `requirePanelPermission`,
   `private.can`, `session.permissions`)"*. El comentario en el código
   ("`requireRole()` sin roles: cualquier rol activo puede ver un
   certificado ya cargado") muestra que es una elección consciente, no un
   descuido — pero exactamente esa elección es la que T12/D20 decidió
   cerrar para que el pipeline de roles configurables no tenga que reabrir
   estas dos funciones.
   - **Por qué no es un blocker de seguridad hoy**: las dos funciones leen a
     través del cliente de sesión (`createClient()`), y las tablas
     subyacentes (`medical_clearances`, `members`) tienen RLS con
     `can('members.read')`. Un usuario sin ese permiso no vería datos igual
     (la policy lo bloquea), así que no hay fuga de información hoy.
   - **Escenario concreto donde sí importa**: el día que el pipeline de
     roles configurables cree un rol sin `members.read` (por ejemplo, un
     futuro rol "Tesorería" con solo `payments.*`/`reports.*`),
     `requireRole()` lo deja pasar igual (tiene "un rol activo") y el
     comportamiento observable pasa de "acceso denegado con mensaje claro"
     a "la consulta a Postgres devuelve vacío o un error de RLS crudo" —
     exactamente la inconsistencia que la centralización en
     `requirePermission` existe para evitar, y el motivo por el que el
     propio plan lo lista como cosa a verificar.
   - **Arreglo**: `requirePermission('members.read')` en las dos, sin
     cambiar el resto de la lógica (la firma que recibe `session` en
     `loadMoreMembers` para leer `session.permissions.includes('payments.read')`
     ya usa el objeto correcto — solo cambia cómo se lo exige). Agente:
     `senior-backend-engineer`. Cambio mecánico, no debería tocar ningún
     otro archivo.

### MINOR

2. **`src/controllers/payments.actions.ts:239` — comparador de `sort` inválido según spec.**
   ```ts
   const ordered = sourceMemberId != null
     ? [...accounts].sort((a) => (a.memberId === sourceMemberId ? -1 : 0))
     : accounts
   ```
   El comparador ignora el segundo argumento (`b`): no compara `a` contra
   `b`, solo mira `a`. Hoy funciona en V8/Node porque el algoritmo de sort es
   estable y esta forma "casi-comparador" empuja el elemento buscado hacia
   arriba en la práctica, pero no es un comparador válido de ECMA-262 — un
   cambio de motor o una versión futura de V8 podría dejar de poner al socio
   de origen primero en `/cobranza/nuevo?grupo=<id>`. Arreglo: `(a, b) =>
   (a.memberId === sourceMemberId ? -1 : b.memberId === sourceMemberId ? 1 : 0)`.
   Agente: `senior-backend-engineer`.

3. **`src/models/billing.model.ts:227-238` (`activateBilling`) — éxito parcial se reporta como fallo total.**
   El `UPDATE settings` (activa la facturación) y la llamada a
   `generatePendingFees()` son dos round-trips separados. Si el `UPDATE` sale
   bien pero la generación falla por un error inesperado de Postgres, la
   excepción sube y la action devuelve `failure()` — pero
   `billing_start_period` **ya quedó activado**. El admin ve "no se pudieron
   generar las cuotas: <motivo>" sin ninguna señal de que la activación en sí
   se completó, y podría reintentar "Activar cuotas" creyendo que no pasó
   nada (el trigger se lo va a rechazar con un mensaje que no explica por
   qué). El sistema tiene el mecanismo correcto para esto (`billing_runs` +
   aviso "Reintentar" en `/ajustes`/panel), pero el resultado de *esta*
   action no lo comunica. Arreglo sugerido: que `activateBilling` atrape el
   error de `generatePendingFees()` y devuelva `{ generated: 0,
   generationError: string }` en vez de relanzar, para que la action arme
   "Se activó la facturación pero no se pudieron generar las cuotas de <mes>
   ahora: <motivo>. Podés reintentar desde Ajustes" en vez de un fallo llano.
   Agente: `senior-backend-engineer`.

4. **`src/views/payments/payment-form.tsx:95-97` — chip "Toda la deuda" duplica "1 mes" cuando la deuda es exactamente un mes.**
   ```ts
   if (member.debtStatus === 'in_debt' && member.balanceCents > 0) {
     chips.push({ label: `Toda la deuda (${formatCentsCompact(member.balanceCents)})`, cents: member.balanceCents })
   }
   ```
   D12-C del plan pide que el atajo aparezca **solo si** `balance_cents >
   current_fee_cents`. Acá se muestra con cualquier deuda positiva: un socio
   que debe exactamente un mes ve dos chips idénticos ("1 mes $10.000" y
   "Toda la deuda ($10.000)") en el celular. No rompe nada, pero confunde en
   la pantalla de cobro más usada del sistema. Arreglo: agregar
   `member.balanceCents > (member.currentFeeCents ?? 0)` a la condición.
   Agente: `frontend-react-craftsman`.

5. **`src/views/payments/group-payment-form.tsx` — sin confirmación de sobrepago (D13), a diferencia de `PaymentForm`.**
   `PaymentForm` (pago individual) muestra "El pago supera la deuda actual…
   Va a quedar un saldo a favor de $X" y exige una confirmación extra cuando
   el monto excede la deuda (`needsOverpayConfirm`). El formulario de pago de
   grupo no tiene ningún equivalente (`grep` de `saldo a favor`/`overpay` en
   el archivo no devuelve nada): un editor puede cargar, por fila, un monto
   mayor a la deuda de ese integrante y el sistema lo acepta sin avisar que
   una parte queda como saldo a favor. Inconsistente con el flujo individual
   y con D13, aunque el criterio de aceptación explícito de F1 para el flujo
   de grupo en `01-tasks.md` no lo menciona textualmente (sí menciona el caso
   de "un integrante sin cuota"). Arreglo: reusar la misma confirmación por
   fila, o una confirmación agregada si algún integrante del lote excede su
   deuda. Agente: `frontend-react-craftsman`.

6. **`src/views/payments/member-accounts-list.tsx:53-58` — la tabla de escritorio de `/cobranza/al-dia` no distingue "saldo a favor" como sí lo hace la fila mobile.**
   Las `columns` que alimentan la vista de tabla (desktop, vía `DataList`) no
   incluyen ningún indicador de estado (`DebtStatusPill` u otro): solo
   `Apellido, Nombre`, `Categorías`, `Meses` y `Monto` (con
   `Math.abs(member.balanceCents)`). La fila mobile (`renderRow`, misma
   variante `up_to_date`) sí muestra `DebtStatusPill` + el texto "Tiene saldo
   a favor de $X" cuando `debtStatus === 'credit'`. En escritorio, un socio
   con saldo a favor y uno al día pelado se ven idénticos en la columna
   "Monto" (ambos un número positivo, sin signo ni etiqueta) — se pierde la
   distinción que el propio listado existe para mostrar. Arreglo: agregar una
   columna de estado a `columns` (o al menos condicionar el texto de "Monto"
   igual que en `renderRow`). Agente: `frontend-react-craftsman`.

7. **`src/models/types.ts:571-579` (`DashboardSummary`) — falta `paymentsCount`, pedido explícitamente por el criterio de aceptación de F3.**
   `01-tasks.md` §F3 pide que "Este mes" muestre "efectivo / transferencia,
   **cantidad de pagos**". `MonthCollection` (usado por `/cobranza`) sí trae
   `paymentsCount` (`types.ts:559`); `DashboardSummary` (usado por el panel
   inicial) no lo tiene, y en consecuencia
   `src/views/dashboard/month-rows.tsx` solo puede mostrar Efectivo/
   Transferencia, sin la cantidad de pagos. Está documentado como gap
   conocido en el dev log de F3, no oculto, pero es un criterio de
   aceptación explícito que quedó sin cerrar. Arreglo: sumar `paymentsCount`
   a `dashboard_summary()` (SQL) y a `DashboardSummary` (TS), y un ajuste
   chico en `month-rows.tsx`. Agentes: `senior-backend-engineer` (RPC +
   tipo) y `frontend-react-craftsman` (vista).

8. **`supabase/migrations/20260927120000_review_fixes.sql` — sin comentario de "Reversa" en el encabezado.**
   Las otras cuatro migraciones de esta tanda documentan cómo revertirlas
   (`member_categories.sql`, `billing.sql`, `payments.sql`, `accounts.sql`
   tienen todas su línea "Reversa:"); esta solo dice "0005 — Fixes del code
   review del slice 1" sin la receta de reversa. Regla explícita de
   `01-tasks.md` ("cada migración con reversa documentada en el
   encabezado"). No es solo forma: revertir el `revoke execute on all
   functions in schema private from public, anon` reabre el hueco de
   seguridad que cierra, así que la reversa correcta necesita decirlo
   explícitamente (no es un simple `drop`). Arreglo: agregar al encabezado
   la receta de reversa, incluyendo la advertencia sobre el `revoke`.
   Agente: hilo principal (migraciones no las escriben los agentes de
   desarrollo).

### NIT / informativo (no requieren acción para este commit)

9. **`src/components/ui/button.tsx:41`** — `size="icon-lg"` quedó en
   `size-11`, idéntico a `icon`/`icon-sm` (antes `size-9`): perdió su
   distinción en la escala de tamaños. No rompe ningún consumidor actual (sus
   dos usos ya traen su propio override). Para quien vuelva a tocar la
   primitiva. Agente: `frontend-react-craftsman`.

10. **`src/models/fee-prices.model.ts:110-121` (`listFeePrices`)** — trae toda
    la historia sin `limit`/`range`. Inofensivo a esta escala (un admin
    cambia el valor de cuota unas pocas veces al año) y es contenido de
    `/ajustes`, no un listado operativo del contrato; el propio plan no lo
    pide paginado. Se deja anotado, no bloquea.

11. **Naming**: `01-tasks.md` (B2) documenta el modelo como
    `registerPayments(batch)` (plural); la función real es
    `registerPayment(input)` (singular, `payments.model.ts:235`). El
    comportamiento es el correcto (inserta N filas en una sola sentencia);
    solo un desvío de nombre entre plan y código.

12. **`supabase/seed.sql` (~línea 168)** — el pago anulado de Sofía usa
    `voided_by = '00000000-0000-0000-0000-000000000000'` con el comentario
    "se simula el admin", pero esa no es la UUID real del admin del seed.
    Inocuo (`payments.voided_by` no tiene FK), pero el comentario es
    engañoso.

13. **`src/views/shared/reason-dialog.tsx`** — pide una "Fecha" que
    `voidPayment`/`voidFee` reciben pero no usan (el trigger pone `now()`
    siempre). Decisión documentada a propósito en el dev log de F1 y
    ordenada por `00-architecture.md` §10; el componente es compartido y
    está fuera del lane de F1/F2 para este slice. El usuario completa un
    campo que no hace nada, sin ninguna pista en la UI. Si se quiere
    resolver: un `showEffectiveOn?: boolean` en `ReasonDialog`, para un
    pipeline futuro.

14. **`private.debt_by_category()` (`20260927130200_accounts.sql`, CTE `uncovered`)** —
    el `case` sobre `kind` ya no tiene `else` (la resolución del hallazgo 2
    de `03-review-schema.md` está aplicada), pero como consecuencia, si algún
    día se habilita `kind = 'adjustment'` (hoy sin policy de INSERT,
    inalcanzable), esa deuda no aparece en ninguna fila de
    `debt_by_category()` y `sum(debt_cents) < dashboard_summary.total_debt_cents`
    de forma silenciosa. El propio código ya lo anticipa en un comentario.
    Para quien habilite `adjustment` en el futuro: esa función necesita su
    propia fila en el `case`.

15. **`src/views/dashboard/history-chart.tsx` — `role="status" aria-live="assertive"` en el tooltip del gráfico**, mientras el contenedor ya es
    `role="img"` con `aria-label` completo y la tabla accesible equivalente
    (`history-table.tsx`) es el camino real para lectores de pantalla. Es
    casi seguro muerto en la práctica, pero si algún navegador no suprime el
    subárbol de un `role="img"`, un `assertive` interrumpiría al usuario en
    cada movimiento de mouse sobre el gráfico. Bajar a `polite` o quitarlo.
    Agente: `frontend-react-craftsman`.

16. **`src/views/dashboard/money-summary-strip.tsx:25-32`** — el % de
    cobranza se muestra como "Cobrado en septiembre 2026 $150.000 de
    $200.000 (75%)" sin la palabra "cuotas" explícita que pedía D16/D2 del
    plan ("el % se etiqueta 'del valor de las cuotas del mes'"). Ambos
    montos llevan `$`, así que no hay riesgo real de leerlo como "75% de los
    socios pagó", pero el texto podría ser más explícito ("de $200.000 en
    cuotas"). Cosmético.

## Blockers

1. **MAJOR 1** — `requireRole()` en las dos actions nuevas de
   `src/controllers/members.actions.ts` (`getMedicalClearanceUrl`,
   `loadMoreMembers`): cambiar a `requirePermission('members.read')` antes
   de commitear. Es el único punto que impide el `APPROVED`; el resto de los
   hallazgos son mejoras, no condiciones de aprobación.

## Qué está bien

- **Autorización por permisos (T12/D20) implementada casi sin excepciones**
  en todo el código nuevo: `requirePermission`/`requirePanelPermission` en
  las cuatro lanes de backend, coincidiendo exactamente con la matriz de
  §6.8, salvo el blocker de arriba. Cero `requireRole`/`requirePanelAccess`
  nuevos fuera de esa excepción y de la deuda documentada y heredada del
  slice 1 (`createMember`/`updateMember`/baja-reactivación, que el propio
  plan exime).
- **Cero `createAdminClient()`** en las escrituras de dominio de este
  slice; todo con el cliente de sesión, auditoría con actor real.
- **`batchId` idempotente de punta a punta**: generado una sola vez en el
  cliente (`crypto.randomUUID()` en el inicializador de `useState`), nunca
  regenerado en el servidor, y la unique violation se traduce a éxito
  idempotente (`alreadyRegistered`).
- **Agregación exclusivamente por RPC**: `member_accounts`,
  `dashboard_summary`, `debt_by_category`, `monthly_history`,
  `month_collection` — cero sumas en TypeScript sobre listados que pudieran
  cortar en `max_rows`. `getMemberAccounts(ids)` es una sola llamada, no un
  loop N+1.
- **Dinero en centavos enteros** de punta a punta, sin aritmética flotante
  sobre input de usuario.
- **Los tres hallazgos de `03-review-schema.md` (revisión temprana de
  schema) están resueltos y verificados en vivo** contra la base local
  (`current_fee_cents` gateado por `billing_due`; el `case` de
  `debt_by_category` sin `else`), no solo leídos en el markdown.
- **Nada se borra, auditoría por trigger, `SECURITY DEFINER` correctamente
  acotado** (`revoke execute from public, anon` + chequeo de permiso en el
  cuerpo) en las cinco migraciones nuevas; `billing_runs` deliberadamente
  no auditada y append-only, consistente con su propia justificación.
- **Nada de exportación CSV construida** (slice 3): el gancho `log_export`
  existe sin consumidor, como pide el plan.
- **Categorías múltiples (Revisión 3/§13)** correctamente implementadas: la
  UI hace estructuralmente imposible elegir dos categorías de la misma
  disciplina (radio agrupado por disciplina, no una validación después del
  hecho); `member_type` es derivado, sin ningún select manual en los
  formularios; el índice único de `fees` es por disciplina con `nulls not
  distinct`, exactamente como pide T21.
- **Panel inicial definitivo (F3)**: MVC respetado (`views/dashboard/**`
  cero data fetching), sin plantilla de métrica-héroe ni tarjetas anidadas,
  targets de 44px confirmados por código, "todo número es un link", aviso de
  corrida (T1) gateado por `permissions.includes('billing.configure')` y
  nunca por `session.role`, gráfico de evolución con tabla accesible
  equivalente, `loading.tsx` con skeleton de la misma altura, `nav-items.ts`
  con `COBRANZA_ENABLED = true` y limpieza completa de `inicio-propuestas`
  (sin imports rotos).
- **Un bug real de PostgREST fue investigado y documentado** por el agente
  de B3 (`members.model.ts`, filtros sobre embeds sin alias con más de una
  fila) en vez de pasar desapercibido — señal de rigor genuino.
- **El follow-up entre agentes funcionó como está diseñado**: F2 reportó un
  bug real en `accounts.model.ts` (`disciplineName` siempre null en el
  statement) y quedó corregido con un comentario que cita el reporte —
  verificado que el fix está aplicado en el código actual, no solo
  prometido.

## Nota para `test-engineer`

Cobertura que vale la pena confirmar que existe:

1. `requirePermission('members.read')` (una vez corregido el blocker) para
   `getMedicalClearanceUrl`/`loadMoreMembers`, con los cuatro casos de
   `requirePermission` (sin sesión, contraseña temporal, rol desactivado,
   permiso faltante si algún día un rol no lo tiene).
2. El escenario D30 con datos sintéticos (cuota social generada, alta a un
   deporte a mitad del mismo período → segunda corrida no genera nada; y el
   simétrico) como test permanente en `tests/db/`.
3. `sum(debt_by_category().debt_cents) = dashboard_summary().total_debt_cents`
   como invariante fija, no solo verificada a mano con el seed.
4. `member_accounts()` con `billing_start_period` en un mes futuro:
   `current_fee_cents`/`current_fees`/`current_fee_period` deben ser
   `null`/`[]`/`null`.
5. Un test que ejercite `activateBilling` con `generatePendingFees()`
   fallando después de que el `UPDATE settings` ya se aplicó (hallazgo
   MINOR 3).
6. El comparador de `payments.actions.ts:239` con un array donde el socio de
   origen esté en distintas posiciones (hallazgo MINOR 2).
7. `group-payment-form.tsx` con un monto de fila que excede la deuda de ese
   integrante (hallazgo MINOR 5): hoy no hay ningún test ni confirmación de
   UI que lo cubra.

## Cierre (hilo principal, 2026-09-28)

- **MAJOR resuelto**: `getMedicalClearanceUrl` y `loadMoreMembers` usan `requirePermission('members.read')` (`02-development-backend-review-fixes.md`).
- MINOR resueltos: comparador del `sort` (2), activación parcial informada (3), chip duplicado (4), sobrepago en pago de grupo (5), "saldo a favor" en la tabla de escritorio (6), `paymentsCount` en `dashboard_summary` + `DashboardSummary` (7, migración y tipos por el hilo principal), "Reversa" en `review_fixes` (8), comentario del seed (12), `aria-live` polite (15), "en cuotas" (16).
- Quedan anotados para un pipeline futuro: 9 (`icon-lg`), 10 (paginar `listFeePrices`), 11 (naming), 13 (`ReasonDialog` pide una fecha que no se usa), 14 (fila propia para `adjustment` el día que exista).
- Hallazgos nuevos durante las correcciones, resueltos: hydration mismatch de `method` en login/cambio de contraseña (`method="POST"`, regla sumada a CLAUDE.md); `createOpeningBalance` mandaba `period` sin grant (42501 para todo usuario real), encontrado por test-engineer y cubierto con un test de regresión.
- Verificación final: `db:reset` desde cero limpio (migraciones + seed), `npm test` 662 passed / 1 skipped, `typecheck` limpio, `lint` 0 errores.

**Veredicto final: APPROVED.**
