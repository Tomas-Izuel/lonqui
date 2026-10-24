# 00 — Brief de diseño: Registrar pago por meses, con "desde cuándo"

Pipeline `2026-10-24-pago-por-meses`. Brief de `/impeccable` (shape), confirmado por
Tomás el 2026-10-24. Manda sobre `route-caja.md` donde se contradiga.

## Problema

1. Usuarios: *"Cuando cargo un pago puedo seleccionar o tachar los meses que está
   pagando?"*. El formulario habla en montos (campo + chips "1/2/3 meses"); la
   Comisión piensa en meses, como la grilla del Excel. Nunca ve qué meses cubre un
   pago (balance forward, D3: un pago de una cuota cubre el mes más viejo, no el
   actual).
2. Tomás: *"lo que hoy no hace muy bien el sistema es elegir 'desde cuándo' está
   pagando: cuando no hay pagos registrados para alguien que están cargando, le cargan
   cuotas pasadas y queda en saldo a favor o desaparece"*. Causa: la facturación
   arrancó en octubre 2026 y los importados tienen `joined_on = 2026-10-01`; antes de
   octubre no hay cargos. Un pago "por julio–septiembre" no tiene contra qué imputarse:
   queda saldo a favor y la cuota de octubre se lo come. La herramienta existente
   ("Cargar saldo anterior" en la ficha) pide un monto suelto, fuera del flujo de cobro.

## Decisiones (Tomás, 2026-10-24)

- **Balance forward se mantiene (D3).** Los meses se cubren en orden, del más viejo al
  más nuevo. No se eligen meses sueltos; no hay tabla de imputaciones.
- **Meses primero, monto derivado.** "Otro monto" como escape (pagos a cuenta,
  redondeos).
- **El pago de grupo familiar usa el mismo patrón**, por integrante.
- **Deuda previa al sistema = saldo anterior** (el concepto que ya existe), creado
  desde la tira en meses. Valor por mes por defecto: la cuota de hoy; el total es
  editable.

## Interacción

**La tira de meses** reemplaza al campo de monto + chips como entrada principal.

- Celdas de mes (nombre corto + año cuando cambia, estado, ícono de
  `MemberPeriodStrip`: nunca solo color). Estados: debe · falta $X (parcial) · este
  mes · adelanto · cubierto (por saldo a favor, no tocable) · antes del sistema.
- **Tocar un mes marca todo hasta ese mes** desde el más viejo adeudado. Tocar un mes
  ya marcado acorta la selección hasta ahí. La selección siempre termina donde tocaste.
- Saldo anterior vigente: primera celda ("Saldo anterior · $X"); entra con cualquier mes.
- Mes parcial: suma solo lo que falta.
- Resumen: "3 meses · agosto a octubre 2026" (con año, decidido en la integración: un
  rango que cruza de año solo se lee bien así), monto grande, "Otro monto". Con "Otro monto"
  la tira refleja en vivo qué cubre (con la celda parcial) y avisa en línea si queda
  saldo a favor. Tocar un mes vuelve al monto derivado.
- Botón "Registrar pago de $30.000". Momento de éxito: check + monto + "Cubre ago–oct".
- **Selección inicial:** el primer mes sin pagar (deuda o adelanto). Socio de baja con
  deuda: toda la deuda, sin meses de adelanto.
- Ventana: todo lo adeudado + mes actual + hasta 6 de adelanto. 4 columnas que crecen
  hacia abajo, nunca scroll horizontal a 390px, celdas ≥ 44px.
- Desaparece la confirmación bloqueante "el pago supera la deuda": marcar adelanto es
  explícito y "Otro monto" avisa en línea.

**"Desde cuándo" (meses antes del sistema).** Solo si el socio no tiene saldo anterior
vigente y su alta es ≤ el inicio de la facturación.

- Plegado bajo "¿Debe meses de antes de \<mes de inicio\>?". Al abrir: hasta 12 meses
  previos, en gris, "antes del sistema".
- Tocar julio marca julio–septiembre (+ octubre si lo debe): "4 meses · julio a octubre
  · $40.000".
- Al registrar, **en una sola transacción**: se crea el saldo anterior ("Saldo anterior
  · julio a septiembre 2026", cuota de hoy × meses, o el total corregido) y se registra
  el pago. Todo o nada; un doble toque no crea dos saldos ni dos pagos (`batchId` +
  índice `fees_one_opening_balance`).

**Arreglo de casos ya cargados mal.** En la ficha, un socio sin saldo anterior y con
alta ≤ inicio ve "Indicar desde cuándo debía" (reemplaza al "Cargar saldo anterior" por
monto): la misma tira de meses previos, crea solo el saldo anterior. Si ya tenía saldo a
favor, balance forward lo aplica solo.

**Grupo familiar.** Cada integrante tildado muestra su tira compacta (con su propio
"desde cuándo" si aplica). Total del lote en vivo y en el botón.

## Estados y rangos

0 a 12+ meses adeudados; 1–6 integrantes por grupo; cuotas no activadas → sin tira,
campo de monto como hoy; carga / error / enviando (botón nombra el monto) / doble
toque / socio de baja.

## Constraints

- Ningún total que se muestre como reporte sale del cliente. Los meses, sus montos
  pendientes y el precio proyectado de cada mes futuro (puede haber un valor
  programado) salen de una RPC de lectura. El cliente solo suma las celdas elegidas
  para armar el monto a enviar.
- Un adelanto queda como saldo a favor al valor de hoy; si la cuota cambia, la celda
  lo dice ("al valor de hoy").
- Sin tablas nuevas, sin cambios a `payments` ni `fees`.
- `route-caja.md`: el anti-objetivo "pantalla de imputación de meses" se reescribe:
  sigue prohibido elegir meses sueltos; la tira muestra en orden lo que la cuenta ya
  hace.

## Fuera de alcance

Importar los pagos 2026 de las planillas (segunda etapa de la importación);
imputación libre; descuentos familiares.
