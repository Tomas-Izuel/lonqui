# 02 — Desarrollo backend: B1 (`getMemberQuickView` + `getDailyCollection`)

Agente: `senior-backend-engineer`. Lane `backend`, tarea B1 de `01-tasks.md`,
con la firma final tomada del **Addendum del hilo principal** (agregado de
alcance 1: ritmo de cobranza del mes en `/cobranza`).

Archivos propios tocados (únicos, según el corte del pipeline):

- `src/controllers/members.actions.ts` — agregado `getMemberQuickView`, sin
  tocar ningún export existente.
- `src/controllers/reports.controller.ts` — `CobranzaHubData` gana `daily`,
  `getCobranzaHub` la resuelve en paralelo.
- `src/models/reports.model.ts` — nueva `getDailyCollection`.

No se tocó `src/models/types.ts` (el hilo principal ya había agregado
`DailyCollectionPoint` en Ola 0/addendum) ni ninguna migración (la RPC
`public.daily_collection` ya estaba aplicada, `20260928120000_daily_collection.sql`,
y los tipos de `database.types.ts` ya tenían la entrada `daily_collection`
regenerada).

## 1. `getMemberQuickView` (`src/controllers/members.actions.ts`)

```ts
'use server'
export async function getMemberQuickView(
  memberId: number,
): Promise<ActionResult<MemberAccount & { phone: string | null }>>
```

Contrato exacto pedido por B1:

- `requirePermission('payments.read')` primero — la vista rápida siempre
  muestra el estado de cuenta, así que el permiso que la habilita es el de
  cuenta (mismo criterio que el resto de `reports.controller.ts`, no
  `members.read`).
- `memberId` se valida con Zod (`z.object({ memberId: z.number().int().positive() }).strict()`)
  aunque el parámetro ya llega tipado como `number` desde TS: la Server
  Action la puede invocar cualquier código que hable el protocolo de Next
  (el input real en runtime es `unknown` hasta que Zod lo confirma), y todas
  las demás actions del archivo validan en el borde de la misma forma.
- Reusa `getMemberAccount(memberId)` de `src/models/accounts.model.ts`, sin
  tocarlo (ya devuelve exactamente `MemberAccount`, incluye socios inactivos
  — `status_filter: 'all'` — porque la ficha completa también muestra la
  cuenta de un socio dado de baja).
- `null` → `throw new DomainError('No encontramos ese socio')`, capturado por
  el `catch` de la action como cualquier otra (`failure(err, 'members.getMemberQuickView')`).
- **Segunda lectura, no una RPC nueva**: `MemberAccount` no trae `phone`
  (`member_accounts` no lo selecciona — confirmado contra `types.ts` y contra
  `MemberAccountRow` en `reports.model.ts`). El botón "WhatsApp" de la vista
  rápida (F-socios, `WhatsAppLink` ya existente) lo necesita. Se resuelve con
  `createClient()` (cliente de **sesión**, respeta RLS — nunca el admin
  client para una lectura del panel) y
  `supabase.from('members').select('phone').eq('id', memberId).maybeSingle()`.
  Dos llamadas a Postgres por invocación, tal como pide la spec, ninguna más.
  `maybeSingle()` en vez de `single()`: si por algún motivo la fila de
  `members` no estuviera (no debería pasar, `getMemberAccount` ya la
  confirmó), la action no explota — devuelve `phone: null` en vez de un 500.

### Reglas de negocio / invariantes protegidos

- **Permiso antes que dato**: si `requirePermission` tira `PermissionError`,
  la action nunca llega a `getMemberAccount` ni a la segunda lectura — cero
  filas leídas sin permiso confirmado en el servidor. La RLS de `members` es
  la defensa real (misma que ya expone `phone` a la ficha completa); este
  chequeo es la re-verificación que evita mostrarle a alguien sin permiso el
  error crudo de Postgres en vez de un `ActionResult` de error limpio.
- **Nunca un throw sin capturar**: tanto el `PermissionError` de
  `requirePermission` como el `DomainError` de "socio no encontrado" caen en
  el mismo `catch` → `failure()`. La vista (`MemberQuickViewSheet`, F-socios)
  solo tiene que manejar la forma `ActionResult`, nunca un error no
  capturado.
- **Qué necesita un `tests/db/`** (tal como lo pide la spec de B1): hoy los 3
  roles fijos (`admin`, `editor`, `consulta`) tienen `payments.read`, así que
  no hay un camino de "rol sin permiso" para probar en runtime todavía. Lo
  verificable hoy es:
  1. Sin sesión (o con una `PermissionError` forzada) → `ActionResult` de
     error, nunca una excepción que llegue al cliente.
  2. Con sesión pero `memberId` de un socio inexistente → `{ ok: false,
     error: 'No encontramos ese socio' }`, nunca un throw sin capturar.
  3. El día que exista un rol/permiso configurado sin `payments.read`
     (pipeline de roles configurables, CLAUDE.md), un test de integración
     contra la RLS real de `members`/`member_accounts` es el que prueba que
     ese usuario no recibe el objeto ni por esta action ni pegándole
     directo a PostgREST — no algo que se pueda probar solo en TypeScript.

## 2. `getDailyCollection` (`src/models/reports.model.ts`) + `CobranzaHubData`

```ts
// reports.model.ts
export async function getDailyCollection(targetPeriod?: string): Promise<DailyCollectionPoint[]>
```

Mismo molde que `getMonthCollection`: llama a la RPC `daily_collection`
(`SECURITY INVOKER`, chequea `payments.read` en el cuerpo con
`private.require_permission`, migración `20260928120000_daily_collection.sql`),
sin argumento cuando `targetPeriod` es `undefined` (la RPC ya tiene
`default null` y resuelve al mes del club con `private.club_today()`, nunca
`new Date()` de TypeScript). Se agregó `order('day', { ascending: true })`
por explicitud, aunque la función ya devuelve las filas ordenadas — mismo
criterio defensivo que `listDebtByCategory`/`getMonthlyHistory` en el mismo
archivo (no depender del plan de ejecución implícito).

Tipos crudos (`DailyCollectionRowRaw`, snake_case) → `DailyCollectionPoint`
(camelCase, ya declarado en `types.ts` por el hilo principal) con
`mapDailyCollectionPoint`, siguiendo el mismo patrón de mapeo fila-por-fila
que el resto del archivo (`.overrideTypes` en vez de confiar en la
nulabilidad que infiere el generador de tipos para funciones).

`reports.controller.ts`:

```ts
export type CobranzaHubData = {
  collection: MonthCollection
  billing: BillingStatus
  daily: DailyCollectionPoint[]
}

export async function getCobranzaHub(): Promise<CobranzaHubData> {
  await requirePanelPermission('payments.read')
  const [collection, billing, daily] = await Promise.all([
    getMonthCollection(),
    getBillingStatus(),
    getDailyCollection(),
  ])
  return { collection, billing, daily }
}
```

`daily` se pide en paralelo con `collection`/`billing` (mismo `Promise.all`),
no en cascada — mismo criterio de todo el archivo (`getDashboard` ya hacía lo
mismo con 5 llamadas).

### Reglas de negocio / invariantes protegidos

- **Doble chequeo de permiso, mismo motivo que el resto del archivo**:
  `getCobranzaHub` ya llama a `requirePanelPermission('payments.read')` antes
  de tocar cualquier modelo; `daily_collection` lo vuelve a chequear en el
  cuerpo de la función SQL. Redundante a propósito — la RLS/el chequeo en
  Postgres es la autorización real, el de acá evita el error crudo.
- **Nada se agrega en TypeScript**: el acumulado (`cumulativeCents`) viene
  sumado desde la base (`sum(...) over (order by d.day)`), nunca reconstruido
  sumando `collectedCents` en el modelo — mismo criterio que `totalDebtCents`
  en `getDebtByCategoryPage` (CLAUDE.md: las agregaciones van en RPC, no en
  TS).
- **Zona horaria**: `daily_collection` corta el rango en `private.club_today()`
  (hora argentina), no en `now()`/UTC — nada que este modelo necesite
  replicar, ya resuelto en la migración. `getDailyCollection` no le pasa
  ninguna fecha calculada en TypeScript salvo que `targetPeriod` venga
  explícito desde quien la llama (hoy nadie lo hace: F-cobranza consume el
  mes actual vía `getCobranzaHub`).
- **Qué necesita un `tests/db/`**: la RPC en sí (rango de días correcto en
  hora argentina, acumulado correcto, `payments.read` bloqueando sin permiso,
  tope de 31 filas) — nada de eso se puede probar sin Postgres real. La
  responsabilidad de este slice es que `getDailyCollection` pase por el
  cliente de sesión y mapee la fila tal cual la devuelve la función; no
  duplica esa lógica.

## 3. Decisiones y alcance

- No se tocó `getMonthCollection`, `registerPayment`, `voidPayment` ni
  ningún otro export existente — fuera de alcance explícito de B1.
- No se agregó ninguna RPC nueva ni se tocó `supabase/migrations/**`: la
  migración de `daily_collection` ya estaba aplicada por el hilo principal
  antes de repartir esta tarea (Ola 0 / addendum).
- `getMemberQuickView` vive en `members.actions.ts` (no en un `.controller.ts`
  nuevo) porque así lo fija la firma congelada de B1 — es una Server Action
  que un Client Component (`MemberQuickViewSheet`, F-socios) va a invocar
  directo.

## 4. Verificación

```
npm run typecheck   → limpio, cero errores (repo completo, incluidas las
                        slices de frontend en curso de otros agentes)
npx eslint src/controllers/members.actions.ts src/controllers/reports.controller.ts \
           src/models/reports.model.ts
                     → limpio, cero warnings/errors
```

No se corrió `npm test` (fuera del alcance de este agente: `test-engineer` es
el dueño único de la suite; no se escribió ningún archivo de test).

## 5. Nada pendiente de schema

No se requiere ningún grant, policy ni índice nuevo: la RPC `daily_collection`
y la columna `members.phone` ya están expuestas a `authenticated` con la
misma RLS que usan `member_accounts` y la ficha completa del socio,
respectivamente. Nada que reportar al hilo principal.
