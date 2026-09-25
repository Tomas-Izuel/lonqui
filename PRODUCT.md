# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Tesorería.** Es quien más usa el sistema y quien hoy carga todo en Excel. Su
pregunta de todos los días es *"¿esta persona debe cuota? ¿desde cuándo?
¿cuánto?"* y hoy no la puede contestar con certeza. Registra pagos en efectivo
y por transferencia, muchas veces en la cancha, desde el celular, con el socio
o el padre adelante esperando. Su éxito: cargar un pago en segundos y ver el
estado de cuenta correcto al instante. Rol `admin`.

**Presidencia.** Necesita el estado del club de un vistazo: cuántos socios
activos, cuánto se cobró este mes, cuánto se debe. Da de alta y baja socios
formalmente, como pide el estatuto. Administra quién de la Comisión entra al
sistema y con qué permiso. Rol `admin`.

**Secretaría.** Carga las fichas de ingreso, mantiene los datos al día (DNI,
teléfono, apto físico de los chicos) y registra pagos. No administra usuarios
ni borra historia. Rol `editor`.

**El resto de la Comisión (siete personas en total).** Voluntarios, no
técnicos. Entran a consultar: el listado de una categoría, quién está al día,
el reporte que pide la contadora. No modifican nada. Rol `consulta`.

Todos entran desde el celular la mayoría de las veces: **la sede no tiene
computadora fija, tiene un celular.**

## Product Purpose

Que el club sepa, en cualquier momento, **quién es socio y cómo está su cuota**.
Hoy la información está repartida en planillas de Excel en Drive (una por
categoría, cada una con su formato), un libro de socios manuscrito y fichas en
papel, cargada por varias personas sin registro de quién tocó qué. El alta y la
baja formales que exige el estatuto no se están haciendo.

El sistema reemplaza todo eso. No convive con el Excel: una vez cargado el
padrón, la planilla deja de usarse.

## Positioning

Un sistema **propio del club**, hecho a medida, no un SaaS genérico de gestión
de clubes con molinetes, carnets y módulos que nadie pidió. Hace pocas cosas y
las hace bien: padrón, cuota, deuda, permisos y trazabilidad. Crece por fases
que decide la Comisión.

## Operating Context

- Club de barrio en Lonquimay con fútbol masculino (5ta a 10ma), fútbol
  femenino y vóley. Unos 200–250 socios, el 90% practicantes; unos 25 socios
  históricos no practicantes.
- Cuota social hoy de $10.000 mensuales, plana. Se paga en efectivo o por
  transferencia al CBU del club. Es común pagar varios meses juntos.
- Muchos socios son menores: los datos los carga el club y el pago lo hace un
  familiar. Hay hermanos en distintas categorías (grupo familiar).
- La conexión es la del celular de quien esté operando. Requiere internet, sin
  modo offline.
- Los usuarios cambian: la Comisión se renueva, y alguien nuevo tiene que poder
  usar el sistema con el manual y un video corto, sin capacitación presencial.

## Capabilities and Constraints

Fase 1 (lo que existe o se está construyendo):

- Padrón con alta, modificación, baja y reactivación, cada una con fecha y
  motivo. Fichas de ingreso y egreso.
- Disciplinas y categorías administradas por el club.
- Grupo familiar con responsable de pago. Apto físico de menores con
  vencimiento y certificado.
- Cuotas generadas solas cada mes. Registro de pagos con comprobante opcional.
  Estado de cuenta por socio.
- Listados (al día, con deuda, deuda por categoría, cobranza del mes), panel
  inicial y exportación a CSV de cualquier listado.
- Tres roles (Administrador, Editor, Consulta) y un registro de auditoría que
  nadie puede editar.

No hace, todavía: portal del socio, pagos online, facturación ARCA, inventario,
planteles, sitio público, mails a socios. WhatsApp automatizado no se hace
nunca en este contrato: a lo sumo un botón que abre la conversación.

## Brand Commitments

- **Naranja y blanco**, los colores del club. El logo del club donde
  corresponda. Es el sistema del club, no el de un proveedor: el desarrollador
  no firma la interfaz.
- Tono: claro, directo, en español rioplatense. "Registrar pago", no "Crear
  transacción". "Dar de baja", no "Eliminar".
- La historia es sagrada: nada en la interfaz sugiere que un pago o un socio se
  pueden "borrar". Se anulan y se dan de baja, con motivo.

## Evidence on Hand

- El contrato aceptado (`docs/relevamiento/Propuesta-Sistema-Administrativo-Club.pdf`).
- La transcripción de la reunión de relevamiento del 2026-09-03.
- Ocho planillas reales de socios y cuotas (una por categoría) y la grilla de
  horarios. Muestran formatos inconsistentes, nombres en mayúsculas y
  minúsculas mezcladas, "Apellido, Nombre" y "Apellido Nombre", filas de
  totales mezcladas con socios, duplicados y columnas de DNI vacías.

## Product Principles

1. **La pregunta central tiene respuesta en un toque.** "¿Debe? ¿Desde cuándo?
   ¿Cuánto?" se contesta desde la búsqueda, sin abrir tres pantallas.
2. **Cargar un pago es lo más rápido del sistema.** Es la operación más
   frecuente y se hace con alguien esperando.
3. **Todo deja rastro.** Quién, qué, cuándo. Nada se borra.
4. **Cada uno ve lo que su función requiere.** Y la regla vale aunque alguien
   manipule la aplicación, no solo en la pantalla.
5. **Autónomo sin el desarrollador.** Si una tarea cotidiana necesita
   preguntarle a alguien cómo se hace, la interfaz falló.

## Accessibility & Inclusion

- WCAG 2.2 AA. Contraste medido, no a ojo: el naranja institucional se ajusta
  para texto.
- Targets de 44px. Formularios usables con una mano en un celular de gama baja.
- Usuarios de todas las edades y sin formación técnica: lenguaje llano, sin
  jerga, confirmaciones claras en las acciones con consecuencias (baja,
  anulación).
- Tamaños de letra que se lean al sol, en la cancha.
