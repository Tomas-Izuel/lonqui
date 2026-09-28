---
version: 1
slug: "route"
primary_target: "route:/"
related_targets: []
---

# Shell del panel y panel inicial — `/`

Modo: **Operate**. Es la estructura que envuelve todas las pantallas y la primera que se ve al entrar.

## Shell

- **Navegación por rol**: `consulta` no ve Usuarios/Ajustes/Auditoría; `editor` tampoco. Móvil: barra superior + navegación inferior fija (targets de 44px). Desktop: lateral de 240px. Rutas que no existen no aparecen como botones muertos.
- **Estados**: sesión sin rol activo, rol sin permiso, carga con skeleton, error de red.
- **Anti-objetivos**: sidebar con veinte ítems, dashboards de plantilla, tarjetas icono+título+texto como estructura, métrica-héroe, un segundo color de marca.

## Panel inicial (brief confirmado por Tomás, 2026-09-27, vía `shape`)

- **Para quién**: toda la Comisión (Consulta en solo lectura; el contrato le da "reportes y estadísticas"). Tesorería y Presidencia casi a diario, desde el celular, para responder "¿cómo estamos?" en diez segundos.
- **Qué contesta, en orden de lectura a 390px**:
  1. **Tarea del día**: buscador de socios + acciones por rol "Registrar pago" y "Cargar ficha de ingreso" (admin/editor). Reemplazan los accesos que hoy duplican la navegación inferior (fix 7 de la finish review).
  2. **Este mes**: "Cobrado en <mes>" (suma de pagos no anulados con `paid_on` en el mes, aunque cubran deuda vieja) contra "Cuotas de <mes>" (cargos mensuales no anulados del período) y el %, que puede pasar el 100%. Apertura efectivo / transferencia.
  3. **Deuda**: deuda total, cuántos socios deben, y los 5 más atrasados (nombre, meses, monto) con link a su ficha.
  4. **Evolución**: últimos 12 meses de cobrado y deuda al cierre de cada mes, en un solo gráfico simple (recharts) con tabla accesible equivalente.
  5. **Padrón**: activos, altas y bajas del mes, socios y deuda por categoría, aptos físicos vencidos.
- **Forma**: filas compactas etiqueta / valor con numerales tabulares (estilo resumen de Mercado Pago), agrupadas en `Panel`s hermanos. Sin tarjetas de número grande. **Todo número es un link** al listado filtrado que lo explica (p. ej. "32 socios deben" → padrón con filtro de deuda).
- **Estados**: cuotas todavía no activadas (`settings.billing_start_period` null) → el panel lo explica y ofrece a admin activarlas desde Ajustes; club sin pagos todavía → ceros explicados; carga; error.
- **Datos**: ~250 socios, 12 categorías, deudas de hasta unos millones de pesos, 0 a 12+ meses adeudados. Toda cifra sale de una RPC (nunca sumas en TS: PostgREST corta en 1000 filas), períodos en hora argentina, montos sin decimales. Saldo a favor se muestra como tal, nunca como deuda negativa.

## Registrar pago (requisitos de Tomás, 2026-09-27)

- Se registra desde `/cobranza`, desde el inicio ("Registrar pago") y **desde la ficha del socio**.
- **Monto precargado** con la cuota vigente del socio (según su categoría o tipo de socio), **editable** (pagar varios meses, pagar parcial).
- **Pago por grupo familiar**: desde la ficha de un integrante se puede cobrar a todo o parte del grupo; se eligen los integrantes, cada uno con su cuota precargada y editable; se registra un pago por socio unidos por un mismo cobro (`batch_id`).
- Medio: efectivo o transferencia; comprobante opcional (transferencia). Fecha por defecto hoy en hora argentina.
- Anular un pago: solo admin, con motivo; nunca "eliminar".
- Tiene que ser lo más rápido del sistema: con alguien esperando, en el celular, con una mano.
## Direction contract

THESIS: Un panel administrativo moderno, sin metáfora: la convención de la categoría ejecutada completa, al nivel de Linear en precisión y de Mercado Pago en claridad para gente no técnica. Rechaza tanto el SaaS gris intercambiable como la app de hinchas: la identidad del club vive en el naranja, el escudo y el tono, no en rarezas. **Mobile first es indispensable**: toda pantalla se diseña y se verifica primero a 390px con una mano; el escritorio es una adaptación de lo móvil, nunca al revés.

OWN-WORLD: Tema claro (se usa al sol). Fondo blanco, superficies #F7F7F8, bordes 1px #E5E7EB, tinta #111827, texto secundario #6B7280. Naranja del club como único acento (Restrained): #F26A1B solo en marcas no textuales (escudo, indicador del ítem activo, foco); #C2410C para botón primario con texto blanco (5,2:1) y links; hover #9A3412. Estados: al día #15803D, con deuda #B91C1C, baja gris #6B7280, siempre con texto, nunca solo color. Una familia (Geist), base 16px, numerales tabulares en montos y DNI, radios 8px, sombras mínimas con blur, íconos lucide.

STORY: Quien entra entiende en un segundo dónde está y qué puede hacer según su rol; busca a un socio y ve su estado sin abrir tres pantallas; confía en que es el sistema serio del club y deja el Excel.

FIRST VIEWPORT: Móvil (el diseño de referencia): barra superior con escudo + "Naranja y Blanco" y avatar; debajo, saludo corto y un buscador de socios grande (48px) con foco inmediato; accesos directos por rol como filas de lista con ícono y chevron; navegación inferior fija (Inicio, Socios, y lo que el rol habilite). Desktop (adaptación): barra lateral de 240px con escudo arriba, secciones del rol y usuario abajo; contenido centrado a 960px con el mismo buscador como primera pieza.

FORM: Canon (salida estándar de la ronda), no una posición de la lista propia; seed key cc0de700. Build code-led (sin generación de imágenes en esta sesión).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
