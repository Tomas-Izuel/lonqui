# T0 — estado al repartir (hilo principal, 2026-10-29)

## Migración

- `supabase/migrations/20261029120000_payment_allocations.sql` = SQL de 00 §9, sin cambios. Aplicó sin errores con `db:reset` (seed) y con `migration up` sobre un escenario de forma vieja (tramos con total impar, pagos parciales, saldo a favor, pago anulado, saldo sin tramo anulado, socio con dos deportes, grupo familiar).
- Comparación independiente antes/después (`private.member_balance` de todos los socios + todas las celdas no `pre_system` de `payment_month_options`): **79 celdas idénticas** (monto, cubierto, pendiente). En `member_balance` solo cambian `months_due` y `oldest_due_period` de los socios con tramo convertido (de 1 a N meses), que es el arreglo esperado. Las `pre_system` nuevas aparecen por diseño (meses previos sin fila de saldo).
- Idempotencia: `migrate_opening_spans()` y `backfill_allocations()` corridas de nuevo devuelven 0 y no cambian filas.
- Smoke del motor: marcar jul y sep con jun adeudado → jul y sep `paid`, jun y ago quedan como estaban; monto libre sin deuda → crédito; anular una cuota pagada → su plata se reimputa (`credit`) a jun y ago; cuota nueva con crédito → `credit` la cubre.

## Contratos fijados

- `src/models/types.ts` (§10), `src/lib/dates.ts` `periodListLabel`, `src/views/shared/labels.ts` `paymentAllocationSourceLabels`, `database.types.ts` regenerado, CLAUDE.md (§13).

## Tests de base en rojo al repartir (por diseño, para T4)

- tests/db/billing.test.ts > fees: saldo de arranque (opening_balance) por el camino REAL de la app > mandar period explícito en el insert (aunque sea el valor correcto) sigue dando 42501: el grant ausente es intencional, no un descuido a corregir de nuevo
- tests/db/billing.test.ts > settings: activación de la facturación (D18, §6.5) > activar (mes futuro, sin cuotas mensuales globales): permitido — el trigger valida a–d, no auth.uid()
- tests/db/opening-balance-months.test.ts > grants de las funciones tocadas > paridad TS/SQL: splitOpeningTotal da exactamente el reparto por celda de payment_month_options (varios total, n)
- tests/db/opening-balance-months.test.ts > guard del saldo anterior con tramo: mensajes y período > hasta >= inicio: "solo cubre meses anteriores a MM/YYYY" con el inicio real; hasta = inicio - 1 pasa
- tests/db/opening-balance-months.test.ts > guard del saldo anterior con tramo: mensajes y período > tramos mal formados dan el texto amigable (check_violation), no el nombre de un constraint
- tests/db/opening-balance-months.test.ts > guard del saldo anterior con tramo: mensajes y período > un editor inserta el tramo por PostgREST directo (grant de insert por columna); sin tramo sigue andando
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > antes del inicio se ven las celdas pagas; después del inicio solo desde la primera adeudada
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > carga inicial completa: ene–mar histórico → celdas reales pagas/adeudadas; segundo pago abr–jun deja jul..oct adeudadas
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > después del inicio con todo pago: no queda ninguna celda del saldo
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > fila vieja sin tramo: una sola celda "opening_balance" con opening_from NULL y el total entero
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > la deuda sigue derivada: Σ monto de celdas = fees.amount_cents, Σ cubierto = pagos, y member_accounts da total − pagos
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > saldo anulado: vuelven las pre_system y los pagos quedan como saldo a favor sobre las proyectadas
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > socio dado de baja conserva las celdas de su saldo y no recibe proyectadas; alta posterior al inicio sin previas no ve ni pre_system
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > total corregido a mano (≠ n × cuota): Σ celdas = total y las n-1 primeras son iguales
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > total no múltiplo: $100.000 en 3 meses → el resto cae en el último mes y Σ celdas = total
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > un mes de tramo con el total chico: n=1 devuelve una celda con todo el monto
- tests/db/opening-balance-months.test.ts > payment_month_options: saldo anterior mes por mes > un peso menos que todo el saldo: la última celda queda con 1 centavo pendiente; todo el saldo: ninguna
- tests/db/opening-balance-months.test.ts > register_payment_batch con tramo > grupo: cada socio con su propio tramo; cada celda lleva el opening_from de SU saldo
- tests/db/opening-balance-months.test.ts > register_payment_batch con tramo > guarda el tramo y el período = inicio - 1; reintento con el mismo batch_id es idempotente y devuelve el mismo saldo
- tests/db/opening-balance-months.test.ts > tramo: inmutable, sin delete, auditado > auditoría: la fila INSERT del saldo trae from_period/to_period en new_data y el actor es auth.uid() de quien lo cargó
- tests/db/opening-balance-months.test.ts > tramo: inmutable, sin delete, auditado > authenticated: insert de las columnas nuevas sí, update no, y ningún delete sobre fees
- tests/db/opening-balance-months.test.ts > tramo: inmutable, sin delete, auditado > from_period/to_period: sin grant de update ni siquiera para admin; el trigger los frena incluso como postgres; anular solo cambia la anulación
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > billing_start_period null: sigue sin devolver nada
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > despues del inicio (inicio pasado) pre_system sigue siendo inicio-12..inicio-1, sin is_current, y no cambia con la ronda 2
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > despues del inicio la salida no cambia: ningun pre_system marca is_current y el mes actual es monthly
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > inicio = mes siguiente: 12 pre_system (inicio-12..inicio-1) con is_current solo en el mes actual, y projected desde el inicio hasta actual+6
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > inicio a 13 meses o mas: la ventana sigue siendo 12 celdas y termina en el mes actual con is_current; sin proyectados (el inicio queda mas alla de actual+6)
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > inicio a 3 meses: pre_system termina en el mes actual (no se ofrecen meses futuros como deuda) y los proyectados arrancan en el inicio
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > sin valor vigente hoy pero con uno desde el mes de inicio: las celdas no quedan en $0, usan el del inicio
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > socio con saldo anterior vigente y inicio futuro: no recibe pre_system
- tests/db/payment-month-options-before-start.test.ts > payment_month_options: inicio de la facturacion en el futuro > socio dado de baja con inicio futuro: pre_system si, projected no (sin adelantos)
- tests/db/payment-month-options.test.ts > payment_month_options: pre_system (meses antes del sistema) > alta anterior al inicio y sin saldo anterior: 12 filas inicio-12..inicio-1 a la cuota de hoy
- tests/db/payment-month-options.test.ts > payment_month_options: pre_system (meses antes del sistema) > alta en el mismo mes del inicio: sí (la cota es <=); alta el mes siguiente: ninguna
- tests/db/payment-month-options.test.ts > payment_month_options: pre_system (meses antes del sistema) > con el saldo anterior ANULADO vuelven los pre_system y el saldo no cuenta
- tests/db/payment-month-options.test.ts > payment_month_options: pre_system (meses antes del sistema) > con saldo anterior vigente: ninguna fila pre_system; el saldo aparece primero con su pendiente
- tests/db/payment-month-options.test.ts > payment_month_options: pre_system (meses antes del sistema) > saldo anterior cubierto del todo: no aparece (y tampoco vuelven los pre_system)
- tests/db/payment-month-options.test.ts > payment_month_options: saldo a favor aplicado a los proyectados > 1,5 cuotas de saldo a favor: el primer adelanto cubierto, el segundo a medias, el resto sin cubrir
- tests/db/payment-month-options.test.ts > payment_month_options: saldo a favor aplicado a los proyectados > el saldo a favor se agota exactamente: un peso menos que una cuota deja la celda con 1 centavo pendiente, no cubierta
- tests/db/payment-month-options.test.ts > payment_month_options: sin facturación no hay tira > sin billing_start_period: 0 filas (el formulario cae al campo de monto)
- tests/db/payment-month-options.test.ts > payment_month_options: valor programado en un mes futuro > el proyectado desde el mes del nuevo valor trae ese monto y priced_at_today = false
- tests/db/payment-month-options.test.ts > payment_month_options: varios socios y permisos > un grupo en UNA llamada: cada socio con sus filas, sin mezclar ni traer socios no pedidos
- tests/db/payment-month-options.test.ts > payment_month_options: ventana adeudado + mes actual + 6 de adelanto > dos deportes en el mismo mes: UNA fila por mes con las cuotas sumadas
- tests/db/payment-month-options.test.ts > payment_month_options: ventana adeudado + mes actual + 6 de adelanto > pago parcial del mes viejo: parcial, el actual debe, 6 proyectados al valor de hoy y nada anterior al inicio
- tests/db/payment-month-options.test.ts > payment_month_options: ventana adeudado + mes actual + 6 de adelanto > socio al día (mes actual ya pagado, sin saldo): la ventana arranca en el mes actual
- tests/db/payment-month-options.test.ts > payment_month_options: ventana adeudado + mes actual + 6 de adelanto > socio de baja con deuda: solo lo adeudado, sin meses de adelanto
- tests/db/payment-month-options.test.ts > payment_month_options: ventana adeudado + mes actual + 6 de adelanto > un pago que cubre una sola de las dos cuotas del mes deja la celda parcial por la diferencia
- tests/db/register-payment-batch.test.ts > deuda derivada tras crear el saldo anterior (balance forward) > contraste: con un pago de 2 cuotas la cobertura llega SOLO hasta el mes siguiente (el número que promete la UI)
- tests/db/register-payment-batch.test.ts > deuda derivada tras crear el saldo anterior (balance forward) > después del lote, la tira del socio ya no ofrece pre_system y no hay saldo a favor aplicado a proyectados de más
- tests/db/register-payment-batch.test.ts > deuda derivada tras crear el saldo anterior (balance forward) > saldo anterior jul-sep de 3 cuotas + pago de 4: la cobertura llega hasta el 3er mes después del actual (todo cubierto, sin contar el crédito dos veces)
- tests/db/register-payment-batch.test.ts > deuda derivada tras crear el saldo anterior (balance forward) > saldo anterior ya existente + grupo (createFamilyGroup): los fixtures de grupo conviven sin cruzar socios
- tests/db/register-payment-batch.test.ts > deuda derivada tras crear el saldo anterior (balance forward) > un peso menos que el pago que cubre el mes siguiente: ese proyectado queda parcial, no cubierto
- tests/db/register-payment-batch.test.ts > register_payment_batch: camino feliz > editor: saldo anterior + pagos del lote; el período lo fija la base, created_by es el editor, la descripción la que vino
- tests/db/register-payment-batch.test.ts > register_payment_batch: camino feliz > grupo con dos socios, cada uno con su propio saldo anterior: cada fee_id vuelve en la fila de SU socio
- tests/db/register-payment-batch.test.ts > register_payment_batch: idempotente por batch_id > el reintento devuelve already_registered y no duplica ni el saldo anterior ni los pagos

## Re-ensayo con la migración corregida (2026-10-29, después del review)

Con el archivo que incluye B1, B2, m4, m5 y los nits (antes de H1): `db reset --version
20261024170000`, el mismo escenario de forma vieja, foto, `migration up`, comparación. **79 celdas y
saldos de los 11 socios idénticos.** B1 y B2 se reprodujeron anulando por el camino del modelo
(`set void_reason`) y quedaron corregidos. H1 (`for no key update`) solo cambia bloqueos: lo cubren
el test de migración (`payment-allocations-migration.test.ts`) y el caso 18 de concurrencia. El
ensayo contra el dump de producción está pendiente (`04-release.md`).
