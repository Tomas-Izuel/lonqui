# 00 — Tira de meses antes de que arranque la facturación

Seguimiento de `2026-10-24-pago-por-meses`. Escrito por el hilo principal: es un
ajuste acotado de un pipeline recién aprobado, sin decisiones de schema nuevas.

## Problema

Tomás, después del merge: *"no veo los cambios en prod"* / *"debería aparecer
siempre la opción de hacerlo de este modo"*.

En producción `billing_start_period = 2026-11-01` y hoy es octubre 2026.
`payment_month_options` devolvía vacío con inicio futuro, el formulario caía al
campo de monto, y la ficha escondía "Indicar desde cuándo debía"
(`billing.startPeriod <= billing.currentPeriod`). Resultado: los 120 socios
activos sin tira de meses durante todo el mes de carga, justo cuando más se usa.

## Decisión

El modo por meses aparece siempre que la facturación esté configurada
(`billing_start_period` no null), haya arrancado o no.

Antes del inicio, la deuda real del socio es toda "antes del sistema": el mes
actual también. Pagar octubre en octubre crea un saldo anterior de un mes
(período = inicio − 1, lo fija `fees_opening_balance_guard`), y el pago lo
cancela. Es exactamente lo que el flujo ya hace después del inicio con los meses
previos; solo cambia que ahora el mes actual es uno de ellos.

## Base (hilo principal)

`20261024150000_payment_months_before_start.sql` redefine
`payment_month_options` (misma firma, mismos grants):

- Con inicio futuro devuelve celdas: `pre_system` (12 meses previos al inicio,
  incluye el actual) + `projected` desde el inicio hasta actual + 6.
- `pre_system` trae `isCurrent = true` en el mes actual.
- La cuota "de hoy" cae al valor del mes de inicio si hoy no hay valor vigente.

`register_payment_batch` y el trigger del saldo anterior ya aceptaban inicio
futuro: no cambian. Verificado a mano con inicio 2026-11 (transacción revertida).

## Vistas (F1, `frontend-react-craftsman`)

Antes del inicio = hay una celda `pre_system` con `isCurrent`.

1. **Sin pliegue.** Los meses previos se ven siempre (no el botón "¿Debe meses de
   antes de…?"), con una línea que explica: las cuotas arrancan en <inicio>; los
   meses anteriores se cargan como saldo anterior.
2. **"este mes"** en la celda `pre_system` actual (estado con ícono, no solo color).
3. **Selección inicial:** el mes actual (saldo anterior de un mes). Socio de baja:
   igual, sin adelantos.
4. **Tocar** un mes previo marca desde ese mes hasta el último previo (el actual);
   tocar uno proyectado extiende hasta ahí. Volver a tocar el primer mes previo
   marcado desmarca la parte previa (queda solo lo del sistema, o nada).
5. Ficha: se quita la condición `startPeriod <= currentPeriod`.
6. Grupo familiar: mismo comportamiento por integrante.

Después del inicio, nada cambia.

## Fuera de alcance

Cambiar el mes de inicio; el aviso del panel de /caja sobre la fecha de inicio.
