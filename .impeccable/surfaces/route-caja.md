---
version: 1
slug: "route-caja"
primary_target: "route:/caja"
related_targets: ["route:/caja/nuevo", "route:/caja/cuotas", "route:/caja/ingresos", "route:/caja/sponsors", "route:/caja/sponsors/[id]", "route:/caja/deuda", "route:/caja/al-dia", "route:/caja/por-categoria"]
---

# Caja (ex Cobranza) — `/caja` y sus listados

> Desde 2026-10-13 la sección se llama **Caja** y `/cobranza/*` redirige. Lo de abajo, hasta "Caja y otros ingresos", es el brief de cobranza de cuotas, que sigue vigente salvo donde la sección nueva lo reemplaza (las rutas `/cobranza/pagos` → `/caja/cuotas`, y la regla de una sola cifra héroe, que en `/caja` son dos).

Modo: **Operate**. La pantalla de Tesorería: registrar un pago con alguien esperando, ver cómo viene el mes y encontrar a quién reclamar. Brief original del `feature-planner` (2026-09-27); reescrito por el pipeline `2026-09-28-ui-expresiva` (pedido de Tomás: "todo números, ni un gráfico; muchas redirecciones").

- **Trabajo y audiencia:** Tesorería (admin) y Secretaría (editor) registran pagos en efectivo o transferencia, a veces en la cancha y con una mano; toda la Comisión (incluida `consulta`, solo lectura) mira la cobranza del mes y los listados al día / con deuda / deuda por categoría que pide el contrato (2.2).
- **Resultado y prueba:** `/cobranza` es un hub corto: un botón "Registrar pago" (admin/editor) de ancho completo abre el **overlay global de cobranza** (`PaymentOverlayHost`, `?pagar=`) encima de la pantalla actual — nunca navega a `/cobranza/nuevo`. Adentro, un paso de búsqueda (`MemberPicker`: nombre o DNI, cada resultado ya muestra "Debe $X · N meses" / "Al día" / "Saldo a favor $X" antes de tocarlo) pasa, con una transición corta dentro del MISMO sheet, al formulario de pago. "Este mes" muestra la cifra hero "Cobrado en \<mes\>" (cuenta una sola vez por sesión) y una barra apilada efectivo/transferencia con etiqueta directa en cada segmento. "Ritmo del mes" agrega un medidor lineal de "% de las cuotas del mes cobrado" y un gráfico de área del cobrado acumulado día a día contra una referencia punteada en el total de cuotas del mes, con tooltip por día y tabla accesible equivalente oculta. "Listados" es una barra de pestañas real (cuatro `<Link>` con indicador animado) a Pagos del mes, Con deuda, Al día y Deuda por categoría — la misma barra se repite arriba de las cuatro páginas, así que moverse entre listados nunca vuelve al hub.
  `/cobranza/nuevo` ya no tiene vista propia: un link viejo (`?socio=`/`?grupo=`/`?volver=`) redirige, en el servidor y sin JS, a `volver` con `?pagar=` ya puesto — abre el mismo overlay sobre el destino.
  Dentro del overlay (reescrito por el pipeline `2026-10-24-pago-por-meses`, brief `00-design-brief.md`): encabezado con el socio y su cuenta ("Debe $30.000 · 3 meses", "Al día", "Saldo a favor $10.000", "Dado de baja · debe $X"); **la tira de meses** (`MonthStrip`) reemplaza al campo de monto + chips como entrada principal: 4 columnas que crecen hacia abajo, celdas con mes, ícono y texto de estado ("debe", "falta $X", "este mes", "adelanto", "cubierto", "antes del sistema", "Saldo anterior · $X"), nunca solo color. Los meses se eligen como un CONJUNTO (pipeline `2026-10-29-imputacion-libre-meses`): tocar alterna un mes elegible (`pendiente > 0`), arrastrar pinta (la celda de partida decide: sin marcar marca, marcada desmarca, sobre la selección que había al empezar); pagar mayo y julio deja junio adeudado. Mouse arma al entrar en otra celda; el dedo, al mantener 250 ms. Celdas: "debe", "falta $X" (parcial), "pagado", "este mes", "adelanto", "cubierto", "antes del sistema", "queda debiendo"; un ícono por estado. **Los adelantos solo se habilitan cuando no queda ningún mes con cuota sin marcar** (previos del tramo incluidos): atenuados y `aria-disabled` antes, y tocarlos dice "Para adelantar meses, primero marcá los que debe." (la base mandaría ese dinero al adeudado más viejo; la grilla no promete otra cosa). La selección inicial es el mes adeudado más viejo con cuota (de baja: toda la deuda; antes del inicio: el mes actual). Ayuda: "Tocá cada mes que pagó, o mantené apretado y arrastrá." Resumen: "3 meses · mayo, julio y septiembre 2026" (contiguos: "mayo a julio 2026"), el monto derivado en grande, "Queda debiendo N meses · $X" y el botón "Otro monto" (monto libre: la grilla muestra en vivo la regla de la base, marcados en orden con "cubre $A de $B" en el último, después los no marcados adeudados con "se cubre", después adelantos "cubierto", y avisa en línea "Queda saldo a favor de $X"; marcar meses en ese modo es prioridad, no sale del modo). "¿Debe meses de antes de \<mes de inicio\>?" despliega hasta 12 meses previos en gris; tocar uno lo marca, el saldo anterior abarca desde el primero marcado (o el alta, si es anterior) hasta el último previo, los previos sin marcar dicen "queda debiendo" y el total del tramo es editable. Si se marca un previo anterior a la fecha de alta, un aviso (sin bloquear) lleva a "Corregir fecha de alta" en la ficha. Al registrar se crean los meses de saldo anterior y el pago en una sola transacción. Sin tira (cuotas no activadas, baja al día) queda el campo de monto de siempre, sin chips. Después: fecha (hoy, zona club), medio como dos botones grandes, comprobante opcional que aparece al elegir Transferencia (subida directa con progreso), notas plegadas, botón "Registrar pago de $X". **No hay confirmación bloqueante de sobrepago**: marcar un adelanto es explícito y "Otro monto" avisa en línea. Al registrar, un momento breve (check + monto + "Cubre ago–oct", o "Pago a cuenta") confirma adentro del sheet antes de cerrarlo solo — el único momento autorado del flujo, nunca una pantalla que demore el cobro siguiente — y un toast queda de rastro. Variante de grupo (`?pagar=grupo:<id>`): integrantes con checkbox; cada tildado muestra su tira compacta con su propio "desde cuándo" y su "Otro monto"; total del lote en vivo y en el botón; sigue siendo un componente propio (`GroupPaymentForm`).
  `/cobranza/pagos?mes=`: selector de mes, totales arriba, lista por fecha con socio (entrada escalonada la primera vez), monto, medio, quién cargó, "Ver comprobante" (firma al tocar) y "Anular" (solo admin, diálogo con motivo y consecuencia); anulados tachados con motivo.
  `/cobranza/deuda` y `/al-dia`: filas "Apellido, Nombre · categoría · N meses · $X" con entrada escalonada, filtros en la URL (categoría, incluir dados de baja), tocar abre la ficha.
  `/por-categoria`: un gráfico de barras horizontal (magnitud, un solo hue de deuda) con las categorías que efectivamente deben algo, ordenadas de mayor a menor, arriba de la lista completa de siempre (con las de deuda cero incluidas) — la lista es la tabla accesible equivalente del gráfico. El mismo componente de gráfico (`CategoryDebtChart`, variante compacta) se usa en el panel inicial.
- **Rangos:** 0 a ~250 pagos por mes; 0 a 12+ meses adeudados; deudas de hasta unos millones; lotes de grupo de 1 a 6 integrantes; montos sin decimales; todo total sale de una RPC.
- **Estados:** cuotas no activadas (el hub lo explica, incluido en "Ritmo del mes" sin el medidor de %; el formulario igual permite registrar contra un saldo anterior); mes sin pagos ("Todavía no se registraron pagos en \<mes\>"); sin días cargados este mes (el gráfico de ritmo lo dice en texto); buscando socio (skeleton de filas, luego "No encontramos socios" si no hay resultados); cargando el formulario (skeleton); error; enviando (botón deshabilitado, nombra el monto); pago ya registrado por doble toque (toast "El pago ya estaba registrado", sin duplicar); comprobante rechazado por tipo o tamaño (dice el límite); socio de baja (aviso, se permite); pago que excede la deuda (sin confirmación: el "Otro monto" avisa en línea "Queda saldo a favor de $X"); saldo a favor que ya cubre los meses previos marcados (el botón se deshabilita y manda a la ficha).
- **Interacción:** el overlay se abre y cierra por `history` (atrás del celular lo cierra igual que cualquier sheet); un link con `?pagar=` ya puesto (deep-link, recarga) cierra con `replace`, nunca saca de la app. El `batchId` nace con el formulario y viaja en cada intento; la cuota precargada es editable siempre; los filtros de cada listado viven en `searchParams` para retomar; nunca se muestra una URL de Storage. La pestaña activa de "Listados" admite click del medio y Cmd/Ctrl+click como cualquier link.
- **Anti-objetivos:** la palabra "eliminar"; un % leído como "cobranza lograda"; scroll horizontal a 390 px; pagar un adelanto debiendo un mes con cuota (la base lo mandaría al adeudado más viejo; la grilla no promete otra cosa); mover una imputación ya registrada; sumas de centavos en el cliente para totales que se muestran; tarjetas anidadas o métrica-héroe fuera de la única cifra hero permitida por vista; un gráfico de dos ejes; color como único portador de identidad en un gráfico; una pantalla de celebración que demore el flujo de cobro.
- **Dirección seleccionada:** hereda D0 (`route.md`, contrato de dirección). Lienzo `bg-canvas` con paneles blancos `shadow-raised`, igual que el resto del panel desde este pipeline.

## Caja y otros ingresos (2026-10-13)

Brief confirmado por Tomás (`docs/pipelines/2026-10-13-caja-otros-ingresos/00-design-brief.md`). Manda sobre lo anterior donde se contradiga.

### 3. Superficies

### Resumen `/caja`

- Encabezado "Caja". Debajo: "Registrar pago" (primario, ancho completo, abre el overlay
  `?pagar=buscar` de siempre) y "Registrar otro ingreso" (outline, abre `?ingreso=nuevo`).
  Cada botón aparece solo con su permiso.
- Pestañas: **Resumen · Cuotas · Otros ingresos · Con deuda · Al día · Por categoría**
  (la barra actual, que scrollea horizontal a 390px y lleva la activa a la vista).
- **Dos cifras héroe**, una al lado de la otra desde `sm` y apiladas a 390px:
  1. **"Ingresado en \<mes\>"** (cuotas + otros ingresos no anulados). Debajo: una barra
     partida *Cuotas / Otros ingresos* con el monto escrito en cada tramo, y la barra
     efectivo/transferencia de **todo** lo ingresado (es lo que Tesorería concilia contra la
     plata en mano).
  2. **"Cobrado en cuotas"**. Debajo: "de $X en cuotas de \<mes\>", el medidor de "% de las
     cuotas del mes cobrado" que ya existe, y una línea "**N socios con deuda · $Y
     adeudado**" que linkea a *Con deuda*.
- Panel **Ritmo del mes** (cuotas, sin cambios).
- Panel **Otros ingresos**: total del mes y desglose por concepto (Sponsor $X,
  Indumentaria $Y…), link a la lista.
- Cuotas no activadas: la cifra 2 explica que todavía no hay cuotas, como hoy.

### Overlay "Registrar otro ingreso" (`?ingreso=nuevo`)

Mismo mecanismo de sheet que el overlay de pagos (abre/cierra por `history`; un deep-link
cierra con `replace`). Campos, en una columna:

- **Concepto**: botones grandes con los conceptos activos.
- **Monto**: sin precarga.
- **Fecha**: hoy en zona del club.
- **Sponsor** (opcional en cualquier concepto): buscador del catálogo con "+ Agregar
  sponsor" en línea, que solo pide el nombre. Si el concepto elegido es Sponsor, el campo
  sube al primer lugar después de Concepto.
- **Medio**: efectivo / transferencia, dos botones grandes.
- **Comprobante** opcional, aparece al elegir transferencia (mismo upload que pagos).
- **Detalle** opcional (ej. "20 camisetas 5ta").
- Botón "Registrar ingreso de $X". Confirma con el mismo momento breve (check + monto) que
  pagos, y queda un toast. Idempotente: un `batchId` nace con el formulario y viaja en cada
  intento.

### Otros ingresos `/caja/ingresos?mes=`

Selector de mes, total del mes y total por concepto. Filas: concepto · sponsor o detalle ·
fecha · monto · medio · quién cargó. "Ver comprobante" (URL firmada al tocar). "Anular" (solo
con permiso de anulación) en un diálogo con motivo y su consecuencia; los anulados se ven
tachados, con el motivo. Filtros por concepto y por sponsor en `searchParams`. Exportación a
CSV, auditada. Link a "Sponsors".

### Sponsors `/caja/sponsors`

Lista: nombre, aportado en el año, último aporte. Tocar abre el historial de aportes de ese
sponsor. Alta y edición: nombre (obligatorio) y, opcionales, contacto, teléfono, email y
notas. Un sponsor se **desactiva** con motivo, nunca se borra; un sponsor desactivado no
aparece para elegir en un ingreso nuevo, pero sus aportes viejos lo siguen mostrando.

### Ajustes → Conceptos de ingreso

Igual que disciplinas y categorías: alta, renombrar, desactivar (nunca borrar). Un concepto
desactivado deja de ofrecerse y los ingresos viejos lo siguen mostrando.

### 4. Rangos y estados

- 0 a ~30 otros ingresos por mes; 0 a ~40 sponsors; montos de $5.000 a varios millones,
  sin decimales.
- Mes sin otros ingresos: "Todavía no se registraron otros ingresos en \<mes\>" con la acción.
- Sin sponsors: el buscador ofrece crearlo.
- Doble toque: no duplica (índice único sobre el `batchId`).
- Carga, vacío y error en toda superficie async; enviando (botón deshabilitado, nombra el
  monto); anulado.

### 5. Permisos (por permiso, no por rol)

| Permiso | admin | editor | consulta |
|---|---|---|---|
| `income.read` | ✓ | ✓ | ✓ |
| `income.register` (incluye crear/editar sponsors) | ✓ | ✓ | |
| `income.void` | ✓ | | |
| `sponsors.deactivate` | ✓ | | |

Los conceptos van con el permiso de ajustes que ya existe. Todo se aplica en RLS/grants con
`private.can(...)`, no solo en TypeScript.

### 6. Bases para egresos (no se construyen)

Cada movimiento y cada concepto llevan un **sentido** (ingreso/egreso); hoy un CHECK solo
acepta ingreso. El balance sale de una RPC que mañana puede restar egresos sin tocar la UI.
Las cuotas siguen en `payments`: la deuda se deriva de ellas y no se toca. El schema exacto
lo decide el `feature-planner`.

### 7. Anti-objetivos

Sponsor en el padrón; stock o inventario de camisetas (Fase 4); pantalla de egresos; la
palabra "eliminar"; sumas en el cliente para totales que se muestran; scroll horizontal de
página a 390px; que un ingreso no-cuota toque la deuda o el % de cuotas; tarjetas anidadas;
cambios en el panel de Inicio.
