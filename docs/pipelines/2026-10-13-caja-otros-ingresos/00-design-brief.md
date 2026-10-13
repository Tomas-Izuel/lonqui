# Brief de diseño — Caja: cuotas + otros ingresos

Salida de `/impeccable shape`, confirmada por Tomás el 2026-10-13. Modo **Operate**.
Hereda la dirección D0 (`.impeccable/surfaces/route.md`) y reemplaza a
`.impeccable/surfaces/route-cobranza.md` en lo que se contradiga.

> **Alcance contractual:** los ingresos no-cuota no están en la Fase 1 del
> contrato (que cubre cuota social y estado de cuenta). Es un requerimiento
> nuevo (contrato 7.3) que la Comisión tiene que confirmar. Tomás decidió
> construirlo.

## Decisiones de Tomás

- Un sponsor **no es un socio**. Hay un **catálogo de sponsors** (no nombre libre).
- **Solo ingresos ahora, pero dejar las bases para egresos.**
- `/cobranza` pasa a llamarse **Caja** (`/caja`). Las URLs viejas `/cobranza/*` redirigen.
- **Conceptos de ingreso administrados por el club** en `/ajustes` (como disciplinas y
  categorías). Semilla: Sponsor, Donación, Indumentaria, Evento, Otro.
- **El resumen de Caja tiene DOS cifras héroe de igual peso** (excepción explícita a "una
  sola cifra héroe por vista"): lo ingresado total y lo cobrado en cuotas contra la deuda.
- Dos botones: "Registrar pago" (primario, cuota, igual que hoy) y "Registrar otro ingreso"
  (secundario). Cobrar una cuota no suma ningún toque.
- Sponsors es subpágina de "Otros ingresos", no una pestaña más.
- El panel de Inicio **no se toca** en esta tanda.

## 1. Trabajo y audiencia

Tesorería (admin) y Secretaría (editor) registran ingresos que no son cuota —aporte de un
sponsor, venta de camisetas, una rifa— muchas veces desde el celular. Presidencia y el resto
de la Comisión (consulta) quieren ver cuánto **ingresó** al club en el mes, no solo cuánto se
cobró de cuotas.

## 2. Resultado

Registrar un ingreso en segundos. Que impacte en el balance del mes y **nunca** en la deuda,
el saldo a favor, el estado de cuenta, el % de cuotas cobradas ni los listados al día / con
deuda / por categoría. Poder contestar "¿cuánto aportó este sponsor este año?" en un toque.

## 3. Superficies

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

## 4. Rangos y estados

- 0 a ~30 otros ingresos por mes; 0 a ~40 sponsors; montos de $5.000 a varios millones,
  sin decimales.
- Mes sin otros ingresos: "Todavía no se registraron otros ingresos en \<mes\>" con la acción.
- Sin sponsors: el buscador ofrece crearlo.
- Doble toque: no duplica (índice único sobre el `batchId`).
- Carga, vacío y error en toda superficie async; enviando (botón deshabilitado, nombra el
  monto); anulado.

## 5. Permisos (por permiso, no por rol)

| Permiso | admin | editor | consulta |
|---|---|---|---|
| `income.read` | ✓ | ✓ | ✓ |
| `income.register` (incluye crear/editar sponsors) | ✓ | ✓ | |
| `income.void` | ✓ | | |
| `sponsors.deactivate` | ✓ | | |

Los conceptos van con el permiso de ajustes que ya existe. Todo se aplica en RLS/grants con
`private.can(...)`, no solo en TypeScript.

## 6. Bases para egresos (no se construyen)

Cada movimiento y cada concepto llevan un **sentido** (ingreso/egreso); hoy un CHECK solo
acepta ingreso. El balance sale de una RPC que mañana puede restar egresos sin tocar la UI.
Las cuotas siguen en `payments`: la deuda se deriva de ellas y no se toca. El schema exacto
lo decide el `feature-planner`.

## 7. Anti-objetivos

Sponsor en el padrón; stock o inventario de camisetas (Fase 4); pantalla de egresos; la
palabra "eliminar"; sumas en el cliente para totales que se muestran; scroll horizontal de
página a 390px; que un ingreso no-cuota toque la deuda o el % de cuotas; tarjetas anidadas;
cambios en el panel de Inicio.
