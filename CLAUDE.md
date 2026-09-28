@AGENTS.md

# Lonqui — Sistema de Gestión Administrativa

Sistema web propio del **Club Social y Deportivo Naranja y Blanco** (Club
Deportivo Lonquimay). Reemplaza las planillas de Excel en Drive, el libro de
socios manuscrito y las fichas en papel. Es la **única fuente de verdad** del
padrón, las categorías, la cuota social y la deuda: no convive con el Excel.

Es **un solo club, para siempre**. No hay `club_id`, no hay multi-tenant, no hay
backoffice de plataforma. Si alguna vez aparece otro club, es otra instancia
(otro proyecto de Supabase), no una columna.

Fuentes de verdad del alcance, en `docs/relevamiento/` (**no se commitean**:
tienen datos personales de menores, ver `.gitignore`):

| Archivo | Qué es |
|---|---|
| `Propuesta-Sistema-Administrativo-Club.pdf` | **El contrato**, enviado y aceptado. Manda sobre todo lo demás |
| `propuesta-fuente.html` | La fuente editable del mismo contrato |
| `Toma de requerimientos_ ….md` | Transcripción de la reunión del 2026-09-03 con la Comisión |
| `miembros y cuotas *.csv`, `horarios.csv` | Los Excel reales del club. Sirven para modelar, **no** para importar |

`PRODUCT.md` tiene la verdad de producto (quién usa esto, para qué, con qué vara).

---

## Alcance

### Fase 1 — lo que se construye ahora (4 a 6 semanas desde la aceptación)

1. **Asociados**: alta, modificación, baja y reactivación, **cada una con fecha y
   motivo**. Ficha digital de ingreso y de egreso (la que pide el estatuto).
   Datos: nombre y apellido, DNI, fecha de nacimiento, domicilio, teléfono,
   email. Socio **practicante** (juega una disciplina) y **no practicante**, en
   el mismo padrón. Disciplina y categoría (las administra el club desde el
   sistema). **Grupo familiar** con un responsable de pago por grupo. **Apto
   físico** para menores: vencimiento + certificado adjunto. Búsqueda y filtros
   por nombre, DNI, categoría, estado y condición de deuda.
2. **Cuota social y estado de cuenta**: valor de cuota configurable, distinto por
   categoría o por tipo de socio. **Generación mensual automática** para cada
   socio activo. Registro de pagos (fecha, monto, medio: efectivo o
   transferencia, y quién lo cargó), con comprobante adjunto opcional. Estado de
   cuenta: meses adeudados, deuda total, último pago, historial. Listados: al
   día, con deuda, deuda por categoría, cobranza del mes.
3. **Roles, permisos y auditoría** (ver más abajo).
4. **Reportes**: panel inicial (socios activos, distribución por categoría,
   cobranza del mes, deuda acumulada) y **exportación a CSV de cualquier
   listado**.
5. **Plataforma**: web responsive (compu y celular), usuario y contraseña
   personales, usuarios internos ilimitados. Requiere internet: **no hay modo
   offline**.

### Fuera de la Fase 1 — no se construye aunque parezca fácil

| Fase | Módulo |
|---|---|
| 2 | Portal del asociado: el socio ve su estado de cuenta, pagos, grupo familiar y comprobantes |
| 3 | Pagos en línea (Mercado Pago) y factura C ante ARCA. Requiere hablar antes con la contadora |
| 4 | Inventario de indumentaria/materiales, planteles, entrenadores, horarios |
| 5 | Sitio público (QR), avisos y recordatorios de cuota por email |

**WhatsApp automatizado está fuera, expresamente** (aprobación de Meta, línea
dedicada, plantillas pagas). Lo único permitido es un botón que abra `wa.me`
con el socio cargado para que la Comisión mande el mensaje a mano.

Diseñar pensando en las fases siguientes está bien —el schema no tiene que
impedir el portal del socio ni los pagos online—; **construirlas no**. Un
requerimiento que excede lo entregado se trata en una reunión de seguimiento
(contrato, 7.3), no se mete en un PR.

**La carga inicial es responsabilidad del club** y se hace con los formularios
del sistema. La importación masiva y la limpieza de los Excel existentes son un
servicio aparte que se cotiza por separado. No escribas un importador de los CSV
sin que se haya pedido.

---

## Stack

Mismo stack que Burger Shop, sin Mercado Pago (llega en la Fase 3).

| Pieza | Versión / nota |
|---|---|
| Next.js | 16.3.3, App Router. **El middleware se llama `proxy.ts`** |
| React | 19.2.8 |
| Tailwind | v4 (config en CSS, no en JS) |
| shadcn/ui | base `radix`, preset Nova. Componentes en `src/components/ui/` |
| Zod | v4 — `z.url()`, no `z.string().url()`. Los errores son `error.issues` |
| Supabase | Postgres 17 + Auth + Storage. `@supabase/ssr`, `supabase-js`. Local en `127.0.0.1:54321` |
| Mail | Resend + `@react-email/components` (plantillas TSX). Hace falta para el reseteo de contraseña, ver Email |
| Tests | vitest 3.2. Node ≥ 22 (supabase-js ya no soporta 20), npm 11. `pg` para los tests de `tests/db/` |

En la UI: `react-hook-form` + `@hookform/resolvers` (todos los formularios),
`recharts` (panel), `sonner` (toasts), `lucide-react` (íconos). Antes de sumar
una alternativa a cualquiera de estas, justificala.

## Comandos

```bash
npm run dev            # Next en :3000
npm run build
npm run typecheck      # tsc --noEmit
npm run lint
npm test               # vitest. Los tests de tests/db/ se saltean sin Docker.
npm run test:watch

npm run db:start       # levanta el stack local (necesita Docker)
npm run db:reset       # RESET TOTAL: migraciones + seed + tipos
npm run db:types       # regenerar src/lib/supabase/database.types.ts
npm run db:stop
```

**Solo hay stack local por ahora.** El proyecto hosted de Supabase (región
`sa-east-1`, inmutable) se crea cuando haya un entregable para el ambiente de
prueba de la Comisión. Hasta entonces el CI no aplica migraciones a ningún lado,
y `.mcp.json` apunta al **MCP del stack local** (`http://127.0.0.1:54321/mcp`,
necesita `npm run db:start`). A propósito no apunta al MCP hosted sin
`project_ref`: ese ve todos los proyectos de la cuenta, incluido el de Burger
Shop en producción. Cuando exista el proyecto hosted, se decide si se agrega
como un segundo server con su `project_ref` y `read_only=true`.

## Variables de entorno

`.env.example` está comentado; `.env.local` lo lee `next dev`. Las claves
locales salen de `npx supabase status`.

**Cuidado con qué archivo lee cada cosa.** `next dev` lee `.env.local`; el CLI de
Supabase, que sustituye los `env(...)` de `config.toml`, no lo lee igual. Una
variable que usen los dos va en los dos.

---

## Arquitectura: MVC sobre App Router

App Router no es MVC, así que el mapeo es explícito y **se respeta**:

```
src/
  models/       M — ÚNICO lugar que habla con Postgres. Schemas Zod + queries.
  controllers/  C — casos de uso. Server Actions y route handlers delegan acá.
  views/        V — componentes de presentación. CERO data fetching.
  app/          Routing fino: la page llama a un controller y renderiza una view.
  services/     Adapters externos detrás de interfaces (email, storage).
  lib/          Clientes Supabase, dinero, fechas, errores, utils.
  emails/       Plantillas de mail en TSX (react-email).
```

**Regla dura**: `app/**/page.tsx` y `layout.tsx` no importan `@supabase/*`
**nunca**. Las vistas no importan modelos. Los modelos no importan de vistas ni
de controllers. Está hecho mecánico en `eslint.config.mjs`: romperlo es un error
de lint, no una opinión.

**Cuándo hace falta un controller.** Una page puede llamar a un modelo
directamente para una lectura plana. El controller existe cuando hay algo que
orquestar: combinar modelos, validar entrada, hablar con un servicio, revalidar
cache o resolver sesión y permisos. Un controller que solo reenvía a un modelo es
indirección sin valor.

### Controllers: lecturas y acciones van en archivos SEPARADOS

```
<nombre>.controller.ts   lecturas. `import 'server-only'`. Lo usan Server Components.
<nombre>.actions.ts      Server Actions. `'use server'` en la PRIMERA LÍNEA del archivo.
                         Lo importan los Client Components.
```

No es una preferencia: **Next rechaza el build** si un Client Component importa
un módulo con `'use server'` en línea dentro de una función.

Un `.actions.ts` **solo exporta funciones async**. Tipos, constantes, schemas y
helpers viven en el controller o en el modelo y se importan. Un `.actions.ts` no
importa otro `.actions.ts`.

`src/models/types.ts` es el vocabulario del dominio: solo tipos, sin runtime. Un
concepto nuevo aterriza ahí primero.

### Rutas

Un solo panel, para la Comisión. URLs en español.

| Ruta | Qué es |
|---|---|
| `/login` | Email + contraseña. Sin registro público |
| `/` | Panel inicial: indicadores del día |
| `/socios`, `/socios/nuevo`, `/socios/[id]` | Padrón, ficha de ingreso, ficha del socio con su estado de cuenta |
| `/cobranza` | Registrar pagos, cobranza del mes, listados de deuda |
| `/reportes` | Listados operativos y exportación |
| `/ajustes` | Disciplinas, categorías, valores de cuota (solo Administrador) |
| `/usuarios` | Usuarios internos y roles (solo Administrador) |
| `/auditoria` | Registro de auditoría (solo Administrador) |

El portal del socio (Fase 2) va a vivir en otro árbol (`/mi-cuenta`), con su
propio layout y su propio rol. No lo mezcles con el panel.

---

## Roles y permisos

Mínimo privilegio. **Tres roles internos** en la Fase 1; `socio` llega con el
portal en la Fase 2.

| Rol | Para | Puede |
|---|---|---|
| `admin` | Presidencia, Tesorería | Todo: usuarios y roles, ajustes y valores de cuota, baja y reactivación de socios, anulación de pagos, auditoría |
| `editor` | Secretaría | Alta y modificación de socios, registrar pagos, ver estados de cuenta. **No** borra ni anula historia, **no** administra usuarios ni ajustes |
| `consulta` | Resto de la Comisión | Solo lectura: padrón, listados, reportes, exportación. Nada de escritura |

**Roles configurables: decididos, van después de cuotas y pagos** (Tomás,
2026-09-27). El club va a poder crear sus propios roles tildando permisos de un
catálogo fijo (~12 permisos por acción); el rol Administrador queda bloqueado
con todos los permisos. Para no reescribir después: **toda regla nueva desde
el slice de cuotas chequea permisos, no roles** (`private.can('<permiso>')` en
SQL y el guard de permisos en `session.controller.ts`). Hoy `private.can`
resuelve con un mapeo fijo desde los 3 roles; el pipeline de roles lo pasa a
tabla y migra las reglas del slice 1, que todavía usan `has_role`.

Que la baja/reactivación y la anulación sean solo de `admin` es la lectura
estricta del contrato (2.3). Si la Comisión pide que Secretaría pueda dar de
baja, es un cambio de política que se confirma con ellos, no un ajuste de
código silencioso.

### La autorización real vive en Postgres

`proxy.ts` solo refresca la sesión: **no autoriza**. Cada page y cada Server
Action vuelven a verificar el rol, y **la defensa real son las RLS**. La
publishable key viaja en el browser: cualquier usuario logueado puede pegarle a
PostgREST directo sin pasar por nuestra UI. Si una regla tiene que valer contra
eso, va en una policy, un grant, un trigger o un CHECK — nunca solo en
TypeScript. El contrato lo promete textual (6.1): *"un usuario no puede acceder
a información fuera de su rol aun manipulando la aplicación"*.

- **Dos guards en `session.controller.ts`, y no son intercambiables:**
  `requirePanelAccess(...roles)` para pages y controllers de lectura
  (**redirige**: al login, a `/cambiar-contrasena` o al inicio) y
  `requireRole(...roles)` para Server Actions (**tira** `PermissionError`; un
  redirect adentro del try/catch de una action se tragaría como error). Toda
  page del panel pasa por `requirePanelAccess`, directo o vía su controller:
  **los layouts de Next no se vuelven a ejecutar al navegar del lado del
  cliente**, así que el chequeo de `(panel)/layout.tsx` solo cubre la carga
  completa. Sin esto, a alguien a quien le restablecen la contraseña con la
  sesión abierta el próximo click le muestra un padrón vacío por RLS.
- Los helpers de rol (`private.current_role()`, `private.has_role(...)`) viven en
  el schema `private` como `SECURITY DEFINER`. Una función `SECURITY DEFINER` en
  `public` es callable por `anon`.
- **Los grants son por columna** donde haga falta. Un grant de tabla es
  todo-o-nada, y una policy `FOR ALL` no distingue qué columna se escribe.
- **La sesión no vence nunca, a propósito.** Decisión de Tomás (2026-09-25): a
  un usuario no técnico lo frustra que lo saquen, y el costo de seguridad es
  bajo porque el acceso lo corta RLS, no la sesión. Un usuario desactivado o
  con contraseña restablecida deja de ver datos al instante aunque siga
  logueado. En concreto:
  - El access token dura 1 h (`jwt_expiry`, no subirlo) y se renueva solo con
    el refresh token, que no vence; `proxy.ts` refresca en cada navegación.
  - Cookies de `@supabase/ssr` con su default de 400 días. No acortar `maxAge`.
  - En el proyecto hosted (Pro), **"Time-box user sessions" e "Inactivity
    timeout" quedan en 0 (apagados)** y "Single session per user" apagado: la
    misma persona entra desde el celular y la compu.
  - Lo único que cierra la sesión es "Cerrar sesión". Cambiar la contraseña
    **no** saca al usuario: la sesión actual sigue viva y va directo al panel
    (Supabase puede cerrar las sesiones de OTROS dispositivos, eso está bien).
    Nunca llamar a `signOut()` después de un cambio de contraseña.
- **Sin registro público.** `[auth].enable_signup = false`. Los usuarios los crea
  un `admin` desde `/usuarios` vía Admin API. El rol vive en una tabla nuestra,
  no en `user_metadata` (que el propio usuario puede editar).

---

## Reglas que no se negocian

### Dinero

Todo son **centavos enteros** (`bigint` en Postgres, `number` en TS). Nunca
float. Helpers en `src/lib/money.ts`. Los montos se muestran sin decimales
(`formatCentsCompact`): en ARS no se usan en la práctica.

### Nada se borra

Este sistema es un registro institucional. **La historia no se edita ni se
borra**, ni siquiera por un `admin`:

- **Baja de socio** = cambio de estado con fecha y motivo (la ficha de egreso).
  La fila queda. La reactivación es otro evento, también con fecha y motivo.
- **Pago cargado mal** = **anulación** con motivo (solo `admin`), que lo saca del
  cálculo de deuda y deja rastro. Nunca un `DELETE`, nunca un `UPDATE` del monto.
- `authenticated` **no tiene `grant delete`** sobre ninguna tabla del dominio.
  Si en algún momento pensás que lo necesita, el diseño está mal.

### Auditoría en Postgres, no en TypeScript

Toda operación relevante (alta, modificación, baja, reactivación, pago,
anulación, cambios de ajustes y de usuarios, exportaciones) deja una fila en el
registro de auditoría: **quién, qué registro, qué cambió, cuándo**.

- Se escribe con **triggers**, no desde la app: un `INSERT` en TS se saltea
  pegándole a PostgREST directo; un trigger no.
- La tabla es **append-only**: sin grant de `update`/`delete` para nadie, y un
  trigger que rechaza `UPDATE` y `DELETE` incluso a `service_role`. El contrato
  dice que *"no puede editarse ni borrarse desde la aplicación"*.
- **El actor sale de `auth.uid()`.** Consecuencia directa: **las escrituras del
  dominio van con el cliente de sesión** (`lib/supabase/server.ts`), no con el
  admin client. Con la secret key `auth.uid()` es `null` y la auditoría queda
  sin autor. El admin client se reserva para lo que no tiene usuario (el cron de
  cuotas) o lo que la Admin API exige (crear usuarios de Auth), y en esos casos
  el actor se registra explícito.
- Las **exportaciones a CSV también se auditan**: es el momento en que datos
  personales salen del sistema.

### Cuotas: generación mensual idempotente

- Un cargo por socio por período, garantizado por un **índice único**
  `(member_id, period)`. `period` es el primer día del mes (`date`). Correr la
  generación dos veces no puede duplicar nada: el chequeo vive en la base, no en
  un `if`.
- La genera **pg_cron llamando una función SQL directamente**, sin HTTP. No hace
  falta un endpoint de Vercel para esto.
- **El monto se congela al generar.** Cambiar el valor de la cuota no reescribe
  cargos pasados: aplica desde el próximo período.
- **Zona horaria**: los períodos se calculan en `America/Argentina/Buenos_Aires`,
  nunca en UTC. Un cron a las 00:00 UTC corre a las 21:00 del día anterior en
  Argentina: el "1° del mes" en UTC es el último día del mes anterior acá.
- La deuda **se deriva** (cargos − pagos no anulados), no se guarda como un
  número que alguien actualiza. Un saldo almacenado es un saldo que se
  desincroniza.

Lo que muestran los Excel reales y el modelo tiene que soportar:

- **Un pago puede cubrir varios meses** (hay pagos de $30.000 y $60.000 con cuota
  de $10.000).
- **Saldo de arranque**: la planilla femenina trae "Saldo de 2025". La deuda
  previa al sistema entra como un cargo inicial, cargado por el club.
- Hoy la cuota es **$10.000 plana** para todas las categorías, pero el contrato
  exige que se pueda diferenciar por categoría o tipo de socio.

Cómo se imputa un pago a los meses (el más viejo primero, o elegidos a mano) y
cómo cobra un grupo familiar (cargo por integrante al responsable, o un cargo
de grupo) son decisiones abiertas: las resuelve el `feature-planner` y las
confirma la Comisión.

### Datos personales (Ley 25.326)

El sistema guarda DNI, fechas de nacimiento y datos de **menores de edad**.

- **Adjuntos** (certificados de apto físico, comprobantes de transferencia) en un
  bucket de Storage **privado**, servidos con URLs firmadas de vida corta. Nunca
  un bucket público, nunca la URL permanente en la base.
- **Nunca** loguear DNI, domicilio, teléfono, email ni nombres completos. Un log
  es un lugar donde los datos viven para siempre y con más lectores de los que
  uno cree. Loguear ids.
- Los CSV reales de `docs/relevamiento/` **no se commitean** y no se usan como
  fixtures. Los seeds y tests usan datos inventados.
- El club tiene que poder pedir la **exportación completa** de sus datos en
  CSV/JSON en cualquier momento (contrato, 10.2). Diseñar para que eso sea un
  script, no un proyecto.

### Formularios: nunca por GET

Todo `<form>` que manda datos lleva `method="post"` (y `action={formAction}`
cuando hay `useActionState`, para que funcione sin JavaScript). Sin `method`,
si el JS no carga —mala señal, un deploy a mitad de camino, un chunk que
devuelve 500— el navegador envía el formulario por GET con **cada campo en la
URL**. Pasó en este proyecto: la contraseña del login terminó en la barra de
direcciones, el historial y los logs del servidor. Con `action={función}`
escribilo **en mayúscula, `method="POST"`**: el SSR de React lo reemplaza por
el `"POST"` de la Server Action y el cliente hidrata con lo que diga el JSX;
en minúscula es un hydration mismatch en cada carga. Es mecánico: una regla de
`eslint.config.mjs` falla si un `<form>` no declara `method`. La única
excepción es una búsqueda que navega a un listado (`method="get"` explícito).

### Errores: dominio vs. interno

`src/lib/errors.ts` separa:

- **`DomainError`**: condición de negocio, su mensaje **es** interfaz ("Ya hay un
  socio con ese DNI"). El usuario lo ve y puede actuar.
- **Cualquier otra excepción**: falla nuestra. Se loguea en el servidor y el
  usuario recibe algo genérico. Un `catch` que devuelve `err.message` termina
  mostrando el detalle de una constraint de Postgres.

`zodToApiError` devuelve solo el primer mensaje y el campo, nunca el array
`issues`.

### Los tres clientes de Supabase

| Archivo | Rol | Cuándo |
|---|---|---|
| `lib/supabase/client.ts` | browser, respeta RLS | auth en el browser |
| `lib/supabase/server.ts` | servidor como el usuario, respeta RLS | **todo** lo del panel |
| `lib/supabase/admin.ts` | **bypassea RLS** | crear usuarios de Auth, jobs sin usuario |

`admin.ts` nunca se usa en respuesta a algo que mandó el browser sin validar
antes con Zod **y** verificar el rol en el servidor. Si una escritura con el
cliente de sesión da `permission denied`, la pregunta no es "qué grant falta"
sino "¿este rol debería poder hacer esto?".

### Lo que se agrega en Postgres, no en TypeScript

Si es una **invariante del dominio** (no un permiso), va en la base:

- Unicidad de DNI entre socios.
- Un cargo por socio por período.
- Montos `>= 0` con CHECK.
- Columnas inmutables (monto de un pago, período de un cargo, fecha de alta).
- Transiciones de estado del socio (activo ↔ baja) con fecha y motivo obligatorios.
- Append-only del registro de auditoría.

Y lo que es agregación va en una **RPC**, no en TS: PostgREST corta en `max_rows`
(1000) **sin error**. Con ~250 socios hoy no pasa; con 12 cargos por socio por
año pasa en seis meses, y el síntoma es una deuda total que da mal en silencio.

---

## Modelo de datos

Convenciones: `bigint generated always as identity` como PK, centavos en
`bigint`, `timestamptz` siempre (y `date` para períodos y fechas de
nacimiento), snake_case, **índice en toda FK**, RLS prendida en toda tabla.

El schema lo diseña el `feature-planner` en el primer pipeline de la Fase 1.
Los conceptos que tiene que cubrir: socios (con tipo practicante/no
practicante y estado), disciplinas, categorías, grupos familiares con
responsable, apto físico con adjunto, valores de cuota (por categoría y por
tipo), cargos por período, pagos con adjunto y anulación, eventos de
alta/baja/reactivación, usuarios internos con rol, auditoría.

Disciplinas y categorías son **datos, no enums**: el club las administra desde
`/ajustes`. Hoy existen fútbol masculino (5ta a 10ma), fútbol femenino y vóley
(sub 18, sub 19, sub 20, mayores).

---

## Email

Supabase Auth sin SMTP propio **solo entrega a miembros del equipo del proyecto
de Supabase**. La Comisión no está en ese equipo: sin SMTP, el mail de "olvidé mi
contraseña" o de invitación no sale nunca. Por eso Resend es obligatorio en
producción, configurado como SMTP en el dashboard del proyecto hosted
(usuario `resend`, contraseña = API key). El remitente tiene que estar en un
dominio verificado: el dominio del club, que provee el abono.

En local, el bloque `[auth.email.smtp]` de `config.toml` queda **comentado** y
todo cae en Mailpit (`http://127.0.0.1:54324`). Con el bloque prendido y sin
`RESEND_API_KEY` válida, Auth devuelve 500 y no sale ningún mail.

Los recordatorios de cuota por email son Fase 5. En la Fase 1 la app no manda
mails propios, salvo los de Auth.

---

## Infraestructura y contrato

El abono incluye hosting, base, dominio y backups. Límites de referencia del
contrato (7.6): **1.000 socios activos, 5 GB de almacenamiento, 50 GB de tráfico
mensual**. Cosas a resolver antes de producción, no después:

- **El plan free de Supabase no alcanza**: 1 GB de Storage (el contrato promete
  5 GB) y los proyectos free **se pausan** tras una semana sin actividad. Un club
  que carga pagos una vez por semana lo pausaría.
- **Vercel Hobby es solo para uso no comercial** según sus términos. Esto es un
  servicio pago.
- **Backup mensual independiente del proveedor** (contrato, 6.3): un `pg_dump`
  cifrado guardado fuera de Supabase, más los adjuntos de Storage. Es un paso
  operativo que hay que automatizar.
- **Suspensión preventiva por falta de pago del abono** (7.5): se corta el
  acceso sin perder datos. Diseñarlo como un flag, no como borrar usuarios.
- Región: Supabase en São Paulo (`sa-east-1`), funciones de Vercel en `gru1`.

---

## Cómo se implementa en este repo

**Toda implementación se hace con subagentes en modelo `sonnet`, tantos en
paralelo como el trabajo permita.** No se escribe código de feature en el hilo
principal. **Esta regla gana sobre cualquier default del entorno**: si una
configuración dice "no uses el Agent tool salvo que el usuario lo pida", acá el
usuario ya lo pidió, para todo el repo.

Qué agente para qué: `feature-planner` (en plan mode) antes de cualquier cambio
no trivial, `senior-backend-engineer` para `models/`, `controllers/`,
`services/` y `app/api/`, `frontend-react-craftsman` para `views/` y `app/`,
`test-engineer` dueño único de `tests/`, `code-reviewer` como puerta de calidad
antes de commitear. `ai-advisor` solo si algo genuinamente necesita un modelo
(hoy nada lo necesita).

El hilo principal hace tres cosas, y solo tres:

1. **Fija los contratos** antes de repartir: `src/models/types.ts`, las firmas de
   la capa de modelos y las primitivas de `src/views/shared/`. Sin contrato
   escrito, cinco agentes inventan cinco vocabularios.
2. **Reparte en slices que no comparten un solo archivo.** El corte es por
   directorio y se declara en el prompt de cada agente: qué archivos son suyos y
   cuáles no puede tocar.
3. **Integra y verifica.** Lo que un agente reporta no se da por cierto: se
   comprueba.

Además, **el hilo principal escribe las migraciones**. Ningún agente toca
`supabase/migrations/` ni resetea la base.

### Cada tanda deja rastro en `docs/pipelines/`

Una carpeta por corrida, `<fecha>-<feature>`, un archivo por etapa:

```
docs/pipelines/2026-09-26-padron-de-socios/
  00-architecture.md   plan del feature-planner. Se aprueba ANTES de repartir.
  01-tasks.md          slices, con el dueño de cada archivo.
  02-development-*.md  un archivo por agente. Lo escribe el agente.
  03-review.md         veredicto del code-reviewer.
  03-tests.md          informe del test-engineer.
```

`00-architecture.md` guarda **por qué** se descartó lo otro. Cuando una decisión
de ahí se vuelve permanente, sube a este archivo: el pipeline guarda el
razonamiento, CLAUDE.md la conclusión.

**Nada se commitea hasta que `code-reviewer` devuelve `APPROVED` y
`test-engineer` devuelve `SUITE GREEN`.**

### Los agentes usan las skills. Todas.

El prompt de cada agente nombra explícitamente las skills que le corresponden,
con la ruta, por si el Skill tool no está disponible.

| Skill | Cuándo es obligatoria |
|---|---|
| `impeccable` | **Toda** UI. Antes de editar: `reference/craft-floor.md`. Todo el panel es superficie de tarea: `reference/operate.md`. Para planificar una superficie: `shape` |
| `web-design-guidelines` | Antes de cerrar cualquier slice de UI |
| `frontend-design` | Decisiones de tratamiento visual dentro del mundo ya elegido |
| `vercel-react-best-practices` | Todo React/Next |
| `supabase` | Cualquier cosa que toque Supabase |
| `supabase-postgres-best-practices` | **Antes** de schema, migraciones, RLS, índices, triggers o queries |
| `grilling` / `grill-me` | Para estresar un plan antes de aprobarlo |
| `context7` (MCP) | Antes de usar la API de cualquier librería |

Reglas operativas:

- **Ningún agente corre `npm install`.** Instalaciones concurrentes corrompen
  `node_modules`. Las dependencias se instalan desde el hilo principal.
- **Ningún agente toca migraciones ni resetea la base.** Si encuentra un problema
  de schema, lo reporta con el SQL que cree necesario.
- El hook de `impeccable` corre solo después de cada edición de UI. Actuar sobre
  lo que reporta, no re-auditar a mano.

---

## Diseño

**Todo el sistema de la Fase 1 es una superficie Operate**: un panel de gestión
para una Comisión Directiva de voluntarios, no una vitrina. La vara son los
buenos paneles administrativos: el dato que se busca está a la vista, cargar un
pago lleva segundos, y se puede retomar después de una interrupción. **Claridad
por encima de densidad**: quienes lo usan no son técnicos y muchas veces entran
desde el celular.

La identidad es la del club: **naranja y blanco**. Vive en el color, la
tipografía y el logo; la estructura es la convención de la categoría, sin
rarezas.

**Dirección decidida (2026-09-25): el estándar de la categoría**, elegido a
propósito frente a direcciones más expresivas. La vara de terminación es
**Linear** (precisión, calma, estados claros) y el **panel de Mercado Pago**
(claridad para usuarios argentinos no técnicos). El contrato de dirección vive
en `.impeccable/surfaces/route.md` y todas las superficies lo heredan.

**Mobile first es indispensable.** Toda pantalla se diseña y se verifica
primero a 390px, con una mano; el escritorio es una adaptación de lo móvil,
nunca al revés. Una pantalla que solo se probó en desktop no está terminada.

`PRODUCT.md` tiene la verdad de producto; los briefs por superficie van en
`.impeccable/surfaces/`. La dirección visual se decide **una vez**, en el primer
pipeline de UI, y después se hereda: un agente que vuelve a correr
`concept-seed` produce una segunda identidad. **`DESIGN.md` se escribe al final,
desde lo construido.**

### Reglas duras del piso de calidad

- **Prohibido el kicker/eyebrow arriba de un título.**
- Nada de tarjetas anidadas, ni la plantilla de métrica-héroe, ni una grilla de
  tarjetas icono+título+texto como estructura de página.
- Nada de emoji ni glifos unicode como íconos: `lucide-react` o SVG propio.
- Monoespaciada solo para medición (montos, DNI), nunca de disfraz. Montos con
  numerales tabulares.
- Nada de texto con gradiente, ni `border-left` de color de más de 1px, ni
  sombras duras sin blur.
- Targets de 44px mínimo en todo lo que se toca.
- Toda superficie async tiene estado de carga, vacío y error.
- Contraste WCAG AA real, medido. El naranja institucional sobre blanco
  probablemente **no** pasa 4.5:1 para texto: se corrige el tono, no se ignora.
- **Tailwind v4**: una variable en valor arbitrario va `rounded-(--radius)`,
  **no** `rounded-[--radius]` (sintaxis v3, silenciosamente no emite CSS).

## Estilo

- **Idioma**: UI y comentarios en español rioplatense. Nombres de código en
  inglés. El dominio se nombra en inglés en el código (`member`, `fee`,
  `payment`, `category`, `discipline`, `family_group`) y en español en la UI
  (socio, cuota, pago, categoría, disciplina, grupo familiar).
- **Comentarios**: explican el *por qué*, no el *qué*.
- **Mobile-first**: la sede del club no tiene computadora fija, tiene un
  celular.

---

## Trampas conocidas

Heredadas de Burger Shop, mismo stack, mismas trampas:

- **Next 16 renombró `middleware.ts` a `proxy.ts`.** El viejo nombre no se carga.
- **`next.config.ts` se evalúa ANTES de que Next cargue los `.env`.** Una
  `process.env` ahí llega vacía.
- **Supabase no expone tablas nuevas al Data API automáticamente.** Sin `grant`
  la tabla devuelve vacío aunque las RLS estén perfectas: RLS decide qué *filas*,
  el GRANT decide si la *tabla* existe.
- **`service_role` TAMPOCO recibe privilegios sobre las tablas que crea una
  migración.** Sin el grant explícito, el admin client falla con
  `42501 permission denied`. Si agregás una tabla, verificalo con la secret key.
- **El EXECUTE de PUBLIC sobre funciones nuevas no se revoca por schema.**
  `alter default privileges ... in schema private revoke execute ... from
  public` no tiene efecto (solo se puede globalmente). Toda migración que crea
  funciones en `private` cierra con `revoke execute on all functions in schema
  private from public, anon` y otorga a mano las que usan las policies. Hay un
  test en `tests/db/grants-and-lockdown.test.ts` que lo atrapa.
- **`SECURITY DEFINER` en `public` es callable por `anon`.** Helpers en
  `private`; si una función TIENE que estar en `public`, `revoke execute ... from
  public, anon` y otorgar a mano, y verificar el rol en el cuerpo.
- **UPDATE en RLS necesita también policy de SELECT**, y `USING` + `WITH CHECK`.
- **`[auth.email] enable_signup` de `config.toml` NO es "permitir registros por
  email"**: apaga el proveedor de email entero, login incluido. El que cierra el
  registro público es `[auth] enable_signup`.
- **`config.toml` configura SOLO el stack local** y no se relee con `db reset`:
  los cambios de `[auth.*]` piden `db:stop` + `db:start`. En el proyecto hosted,
  auth, SMTP y hooks se configuran en el dashboard. Nunca correr `supabase config
  push`.
- **pg_cron corre en UTC.** Ver Cuotas.
- **pg_net crea SIEMPRE su propio schema `net`.** `extensions.http_get` da
  `function does not exist`.
- **Varias RPC se redefinen en migraciones posteriores**: la vigente es la de la
  migración más nueva. Editar la primera definición no cambia nada.
- **La región de Supabase es inmutable.** `sa-east-1`.
