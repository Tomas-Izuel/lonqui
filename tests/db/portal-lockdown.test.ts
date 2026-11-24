import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  actAs,
  actAsSuperuser,
  createAuthUser,
  createFamilyGroup,
  createMember,
  createUserWithRole,
  isDbAvailable,
  withRollback,
} from './helpers'
import { consumeToken, createPortalAuthUser, fakeDni, issueToken, linkNewAccount, peekToken } from './portal-fixtures'
import { seedClub, type Seeds } from './seed-club'

/**
 * App de socios, S1-T2 (`docs/pipelines/2026-11-24-app-socios/`, `00-architecture.md` §4.D):
 * CIERRE DINÁMICO del panel.
 *
 * Hoy `private.current_app_role()` devuelve `null` para cualquier usuario de
 * Auth sin fila (activa) en `app_users`, y ocho policies (siete tablas y el
 * bucket `attachments`) abren con `current_app_role() is not null`. Mientras
 * el registro esté cerrado eso alcanza. Cuando existan usuarios de Auth que NO
 * son de la Comisión (los socios de la app), cualquier tabla, vista, función o
 * bucket nuevo que se olvide de cerrarse es una fuga de datos de menores.
 *
 * Por eso este test NO tiene una lista escrita a mano de objetos: los
 * descubre del catálogo (`pg_class`, `pg_proc`, `pg_attribute`,
 * `has_column_privilege`, `storage.buckets`) y prueba contra cada uno, como un
 * usuario de Auth autenticado SIN fila en `app_users` (y, de yapa, como `anon`):
 *
 *   1. toda tabla y vista de `public`: SELECT da cero filas o `42501`;
 *   2. todo INSERT / UPDATE / DELETE: falla o afecta 0 filas. Se arma con las
 *      columnas que el rol SÍ puede tocar, para que lo que se pruebe sea la RLS
 *      y no solo la falta de grant (si mañana alguien suma un grant, la RLS
 *      tiene que seguir frenando);
 *   3. toda función de `public` sin prefijo `portal_`: tiene que fallar con
 *      `42501` (insufficient_privilege). Cualquier otro desenlace es una
 *      EXCEPCIÓN y se declara en `FUNCTION_EXCEPTIONS` con función, SQLSTATE y
 *      motivo. Además se MIDEN LOS EFECTOS de cada llamada que no falla: se
 *      compara una foto (conteo + hash de filas) de todas las tablas de
 *      `public`, `private`, `storage` y `auth` antes y después, así que una
 *      función que escribe y devuelve `void`, `null` o `0` no pasa;
 *   3b. un tipo de argumento sin valor de prueba es ROJO (`argValue`): una
 *      función llamada con `NULL` suele devolver vacío sin haber probado nada;
 *   4. `storage`: se recorren los buckets del catálogo; el usuario no ve ningún
 *      objeto (sin filtro de bucket) ni ningún bucket, no escribe nada, y
 *      ningún bucket es público (un bucket público se sirve sin pasar por RLS:
 *      ningún probe de SQL lo vería).
 *
 * Una tabla, función o bucket nuevo entra solo en el recorrido y, si deja pasar
 * a este usuario, el test se pone rojo sin tocarlo.
 *
 * La BOMBA LATENTE. Agregar `'socio'` al CHECK de `app_users.role` y crear un
 * usuario con ese rol le abre el padrón entero (`current_app_role()` deja de
 * ser null). Diseño, en tres patas que se refuerzan:
 *
 *   a. GUARDA (es la que se pone roja): `app_users.role` solo admite
 *      admin / editor / consulta. Se intentan insertar roles de socio como
 *      `postgres` y tienen que dar `check_violation`, y se leen los literales
 *      del CHECK del catálogo: tienen que ser exactamente esos tres.
 *   b. DEMOSTRACIÓN (prueba que el detector detecta): dentro de la misma
 *      transacción que se deshace con ROLLBACK, se altera el CHECK, se crea un
 *      usuario con rol 'socio' y se corre el MISMO recorrido como ese usuario:
 *      tiene que encontrar fugas. Nada de DDL sobrevive.
 *   c. LÍMITE conocido de la guarda: cubre el CHECK, no la invariante. La
 *      invariante real es "NINGUNA cuenta de socio tiene fila en `app_users`".
 *      Un socio al que se le diera una fila con un rol del panel
 *      (`role = 'consulta'`, por ejemplo) abre el padrón igual y esta guarda no
 *      lo ve. Desde S2-T4 SÍ hay cuentas de socio que probar (último bloque del
 *      archivo): después de canjear una invitación, `app_users` no cambia y
 *      `private.current_app_role()` es `null` para esa cuenta, y el actor
 *      "cuenta de la app vinculada" recorre todo el cierre. La DEMOSTRACIÓN
 *      lista a mano las siete tablas con `current_app_role() is not null`: si
 *      alguien las endurece (por ejemplo a un `is_staff()`), se pone roja por
 *      una MEJORA; en ese caso actualizá la lista, no el CHECK.
 *
 * Mantenimiento para S2+: cada tabla, vista, bucket o función nuevos obligan a
 * extender `seedClub()` y `argValue()` EN LA MISMA TANDA (si no, el test de
 * "seed no vacuo" y el de tipos de argumento se ponen rojos a propósito).
 *
 * Los fixtures son inventados y todo corre dentro de `withRollback`: no queda
 * ninguna fila (el audit_log es append-only, por eso no se deja nada).
 */
const dbAvailable = await isDbAvailable()
if (!dbAvailable) {
  console.warn('[tests/db] Postgres local no responde: se saltean los tests de tests/db/.')
}

// ---------------------------------------------------------------------------
// Excepciones declaradas
// ---------------------------------------------------------------------------

/**
 * Prefijo de las RPC del portal (S2). El recorrido 'panel' de `scanFunctions` las EXCLUYE a propósito (son
 * SECURITY DEFINER y una cuenta de la app legítimamente obtiene datos de ellas): se recorren aparte con
 * `scope = 'portal'` para el huérfano y `anon` (que no obtienen nada), y sus reglas (tokens, permisos, funciones
 * solo de servicio) se prueban en `portal-accounts`, `portal-tokens` y `portal-requests`.
 */
const PORTAL_PREFIX = 'portal_'

type FunctionException = {
  why: string
  /** SQLSTATE con los que esta función puede fallar sin ser 42501 (insufficient_privilege). */
  sqlstates?: string[]
  /** Si la función puede EJECUTAR sin error para un usuario sin rol: forma exacta de lo permitido. */
  allowedRows?: (rows: Array<Record<string, unknown>>) => boolean
}

/**
 * Toda función de `public` sin prefijo `portal_` tiene que fallar con 42501 para un usuario sin rol. Lo demás va
 * acá, con motivo, y el test "las excepciones se sostienen" lo comprueba contra la base.
 */
const FUNCTION_EXCEPTIONS: Record<string, FunctionException> = {
  keep_alive: {
    // La llama el ping de Supabase para que el proyecto free no se pause; la ejecuta `anon` a propósito.
    why: 'ping de keep-alive: devuelve la constante true, ejecutable por anon a propósito, no lee datos',
    allowedRows: (rows) => rows.length === 1 && Object.values(rows[0])[0] === true,
  },
  my_permissions: {
    // SECURITY DEFINER: para un usuario sin rol efectivo devuelve el arreglo vacío (`{}`), nunca permisos.
    why: 'devuelve [] para quien no tiene rol efectivo',
    allowedRows: (rows) => rows.length === 1 && Array.isArray(Object.values(rows[0])[0]) && (Object.values(rows[0])[0] as unknown[]).length === 0,
  },
  confirm_password_changed: {
    // SECURITY DEFINER pero exige un marker propio en private.password_markers: sin marker tira P0002 antes de leer
    // o escribir nada. Un usuario sin rol no puede tener marker: solo lo crea mark_password_reset (admin, 42501).
    why: 'P0002 "no hay un cambio de contraseña pendiente": exige un marker propio que solo crea un admin',
    sqlstates: ['P0002'],
  },
  set_family_payment_responsible: {
    // INVOKER: no chequea permiso, depende de la RLS. Para quien no ve `members`, el `exists` da falso y tira 23514
    // ANTES de cualquier UPDATE. Con los mismos argumentos un admin SÍ la ejecuta (lo prueba el test de excepciones).
    why: '23514 porque la RLS le oculta el socio: es INVOKER y no escribe nada si no lo ve',
    sqlstates: ['23514'],
  },
}

/**
 * Lo mismo para las `portal_*` (S2-T4). Un usuario sin cuenta de la app y `anon` tienen que fallar con 42501 en todas;
 * la única que puede EJECUTAR sin error para un huérfano es `portal_me()` (authenticated sí la tiene), y devuelve NULL.
 * `portal_mark_password_set()` tira 42501 desde el cuerpo. Las tres de servicio ni siquiera son ejecutables (42501 por
 * falta de EXECUTE).
 */
const PORTAL_FUNCTION_EXCEPTIONS: Record<string, FunctionException> = {
  portal_me: {
    why: 'para una sesión sin cuenta activa de la app devuelve NULL (jsonb), nunca datos',
    allowedRows: (rows) => rows.length === 1 && Object.values(rows[0])[0] === null,
  },
}

// ---------------------------------------------------------------------------
// Seed (invented data only)
// ---------------------------------------------------------------------------

/** Tablas de una sola fila que crea la migración (no el seed): tienen filas sin que `seedClub()` inserte nada. */
const SINGLETON_FROM_MIGRATION = ['settings']

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

type ProbeResult =
  | { ok: true; rowCount: number; rows: Array<Record<string, unknown>> }
  | { ok: false; code: string | undefined; message: string }

/**
 * Corre `sql` dentro de un SAVEPOINT: pase lo que pase (error o éxito) la
 * transacción sigue usable. Si el éxito fuera una fuga, queda dentro del
 * ROLLBACK final de `withRollback`.
 */
async function probe(client: ClientBase, sql: string, params?: unknown[]): Promise<ProbeResult> {
  await client.query('savepoint probe')
  try {
    const res = await client.query(sql, params)
    await client.query('release savepoint probe')
    return { ok: true, rowCount: res.rowCount ?? 0, rows: res.rows as Array<Record<string, unknown>> }
  } catch (err) {
    await client.query('rollback to savepoint probe')
    const e = err as { code?: string; message?: string }
    return { ok: false, code: e.code, message: e.message ?? String(err) }
  }
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`

type Column = { name: string; generated: boolean; identity: boolean; canInsert: boolean; canUpdate: boolean }
type Relation = { name: string; kind: string; cols: Column[] }
type FnArg = { type: string; composite: boolean; tname: string; name: string | null }
type Fn = { name: string; kind: string; args: FnArg[] }

type Actor = { label: string; pgRole: 'authenticated' | 'anon'; userId: string }

/** Tablas y vistas de `public` (sin las de extensiones) con lo que `pgRole` puede insertar / actualizar. Se corre como superusuario. */
async function discoverRelations(client: ClientBase, pgRole: string): Promise<Relation[]> {
  const res = await client.query<{ name: string; kind: string; cols: Column[] }>(
    `select c.relname as name, c.relkind as kind,
            coalesce(json_agg(json_build_object(
              'name', a.attname,
              'generated', a.attgenerated <> '',
              'identity', a.attidentity <> '',
              'canInsert', has_column_privilege($1::name, c.oid, a.attnum, 'INSERT'),
              'canUpdate', has_column_privilege($1::name, c.oid, a.attnum, 'UPDATE')
            ) order by a.attnum) filter (where a.attnum is not null), '[]'::json) as cols
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
      group by c.oid, c.relname, c.relkind
      order by c.relname`,
    [pgRole],
  )
  return res.rows
}

/** Funciones (y procedures) invocables de `public`, sin las de extensiones ni las de trigger. Se corre como superusuario. */
async function discoverFunctions(client: ClientBase): Promise<Fn[]> {
  const res = await client.query<{ name: string; kind: string; args: FnArg[] }>(
    `select p.proname as name, p.prokind as kind,
            coalesce((
              select json_agg(json_build_object(
                       'type', format_type(t.oid, null),
                       'composite', t.typtype = 'c',
                       'tname', t.typname,
                       -- el n-ésimo argumento de ENTRADA (proargnames incluye también las columnas OUT/TABLE: se filtran por modo)
                       'name', case when p.proargnames is null then null else (
                         select x.nm
                           from unnest(p.proargnames, coalesce(p.proargmodes, array_fill('i'::"char", array[cardinality(p.proargnames)]))) with ordinality as x(nm, md, i)
                          where x.md in ('i', 'b', 'v')
                          order by x.i
                         offset (u.ord::int - 1) limit 1
                       ) end
                     ) order by u.ord)
                from unnest(string_to_array(nullif(p.proargtypes::text, ''), ' ')::oid[]) with ordinality as u(oid, ord)
                join pg_type t on t.oid = u.oid
            ), '[]'::json) as args
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind in ('f', 'p')
        and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      order by p.proname, p.oid`,
  )
  return res.rows
}

/** Una fila real (como texto de record) de un tipo compuesto, para pasarla como argumento. Se corre como superusuario. */
async function sampleCompositeRow(client: ClientBase, tname: string): Promise<string | null> {
  const res = await client.query<{ r: string }>(`select x::text as r from public.${q(tname)} x limit 1`)
  return res.rows[0]?.r ?? null
}

/**
 * Valores de argumento plausibles por tipo, con ids reales del seed: así la función llega hasta su chequeo de permiso.
 * `undefined` = tipo SIN valor de prueba: el recorrido lo reporta como rojo (jamás se llama con NULL). Una función nueva
 * con un tipo nuevo obliga a agregar un caso acá.
 */
function argValue(arg: FnArg, seeds: Seeds, composite: string | null): string | undefined {
  if (arg.composite) return composite ?? undefined
  switch (arg.type) {
    case 'bigint':
      if (arg.name && /group/i.test(arg.name)) return String(seeds.groupId)
      if (arg.name && /sponsor/i.test(arg.name)) return String(seeds.sponsorId)
      // S2: las RPC del portal buscan el objeto ANTES o DESPUÉS del permiso según el caso; con ids reales llegan al chequeo de permiso.
      if (arg.name && /token/i.test(arg.name)) return String(seeds.pendingTokenId)
      if (arg.name && /link/i.test(arg.name)) return String(seeds.portalLinkId)
      if (arg.name && /request/i.test(arg.name)) return String(seeds.requestId)
      return String(seeds.memberId)
    case 'integer':
      return '12'
    case 'smallint':
      return '1'
    case 'numeric':
      return '1'
    case 'bigint[]':
      return `{${seeds.memberId}}`
    case 'integer[]':
      return '{1}'
    case 'text':
      // S2: vocabularios cerrados de las RPC del portal. Con 'cash' fallarían por argumento inválido (23514) ANTES de
      // llegar al chequeo de permiso, y el recorrido no probaría el permiso.
      if (arg.name === 'p_purpose') return 'invite'
      if (arg.name === 'p_delivery') return 'whatsapp'
      if (arg.name === 'p_relationship') return 'guardian'
      if (arg.name === 'p_status') return 'blocked'
      return 'cash'
    case 'text[]':
      return '{cash}'
    case 'date':
      return '2026-02-01'
    case 'timestamp with time zone':
      return '2026-02-01T12:00:00-03:00'
    case 'timestamp without time zone':
      return '2026-02-01 12:00:00'
    case 'uuid':
      // La cuenta de la app sembrada (para llegar más hondo con el admin); el resto, un uuid cualquiera.
      if (arg.name === 'p_account_id') return seeds.portalAccountId
      return randomUUID()
    case 'uuid[]':
      return `{${randomUUID()}}`
    case 'jsonb':
    case 'json':
      return '[]'
    case 'boolean':
      return 'true'
    default:
      return undefined
  }
}

type Call = { name: string; label: string; sql: string; params: string[] }

/** 'panel' = toda función de public SIN prefijo portal_; 'portal' = las portal_* (S2). */
type FnScope = 'panel' | 'portal'

/** Arma una llamada por función (las `portal_*` o las que no lo son, según `scope`) con argumentos reales; lo que no se pueda armar queda en `problems`. Superusuario. */
async function buildCalls(client: ClientBase, seeds: Seeds, scope: FnScope = 'panel'): Promise<{ calls: Call[]; problems: string[] }> {
  const fns = (await discoverFunctions(client)).filter((f) => f.name.startsWith(PORTAL_PREFIX) === (scope === 'portal'))
  const composites = new Map<string, string | null>()
  const calls: Call[] = []
  const problems: string[] = []
  for (const fn of fns) {
    const label = `${fn.name}(${fn.args.map((a) => a.type).join(', ')})`
    let buildable = true
    const params: string[] = []
    for (const [i, arg] of fn.args.entries()) {
      if (arg.composite && !composites.has(arg.tname)) composites.set(arg.tname, await sampleCompositeRow(client, arg.tname))
      const value = argValue(arg, seeds, arg.composite ? (composites.get(arg.tname) ?? null) : null)
      if (value === undefined) {
        problems.push(
          `FUNCTION ${label}: no hay valor de prueba para el argumento ${i + 1} de tipo "${arg.type}"${arg.composite ? ' (compuesto sin filas en el seed)' : ''}: ` +
            `agregá un caso en argValue() o sembrá una fila; llamarla con NULL no prueba nada`,
        )
        buildable = false
      } else params.push(value)
    }
    if (!buildable) continue
    const placeholders = fn.args.map((a, i) => `$${i + 1}::${a.composite ? `public.${q(a.tname)}` : a.type}`).join(', ')
    calls.push({
      name: fn.name,
      label,
      sql: fn.kind === 'p' ? `call public.${q(fn.name)}(${placeholders})` : `select * from public.${q(fn.name)}(${placeholders})`,
      params,
    })
  }
  return { calls, problems }
}

async function becomeActor(client: ClientBase, actor: Actor): Promise<void> {
  await actAs(client, actor.userId, { pgRole: actor.pgRole })
}

// ---------------------------------------------------------------------------
// Efectos: foto de TODAS las tablas donde una función podría escribir
// ---------------------------------------------------------------------------

/** Tablas de `public`, `private`, `storage` y `auth` descubiertas del catálogo (sin las de extensiones). Superusuario. */
async function discoverEffectTables(client: ClientBase): Promise<string[]> {
  const res = await client.query<{ t: string }>(
    `select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as t
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private', 'storage', 'auth')
        and c.relkind in ('r', 'p')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
      order by 1`,
  )
  return res.rows.map((r) => r.t)
}

/** Conteo + hash del contenido de cada tabla: cualquier INSERT/UPDATE/DELETE cambia la foto. Superusuario. */
async function snapshotEffects(client: ClientBase, tables: string[]): Promise<Map<string, string>> {
  const snap = new Map<string, string>()
  for (const t of tables) {
    const res = await client.query<{ h: string }>(
      `select count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h from ${t} x`,
    )
    snap.set(t, res.rows[0].h)
  }
  return snap
}

function changedTables(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after.keys()].filter((t) => before.get(t) !== after.get(t))
}

// ---------------------------------------------------------------------------
// Recorridos (cada uno devuelve la lista de fugas; [] = cerrado)
// ---------------------------------------------------------------------------

/** Lecturas: toda tabla / vista de `public` da cero filas o `permission denied`. */
async function scanReads(client: ClientBase, actor: Actor): Promise<string[]> {
  await actAsSuperuser(client)
  const relations = await discoverRelations(client, actor.pgRole)
  const leaks: string[] = []
  await becomeActor(client, actor)
  for (const rel of relations) {
    const res = await probe(client, `select count(*)::int as n from public.${q(rel.name)}`)
    if (res.ok) {
      const n = Number(res.rows[0].n)
      if (n > 0) leaks.push(`SELECT public.${rel.name}: ${n} filas visibles`)
    } else if (res.code !== '42501') {
      leaks.push(`SELECT public.${rel.name}: error inesperado (${res.code}) ${res.message}`)
    }
  }
  await actAsSuperuser(client)
  return leaks
}

/** Escrituras: todo INSERT falla; todo UPDATE / DELETE falla o afecta 0 filas. */
async function scanWrites(client: ClientBase, actor: Actor): Promise<string[]> {
  await actAsSuperuser(client)
  const relations = await discoverRelations(client, actor.pgRole)

  // Una fila real de cada tabla (si tiene): el INSERT la re-inserta, así la RLS es lo primero que se evalúa
  // (el WITH CHECK corre ANTES que los NOT NULL y que el índice único): si la RLS dejara pasar, el error
  // sería 23505/23502 y no 42501, y el test lo marca.
  const sampleRows = new Map<string, unknown>()
  for (const rel of relations) {
    if (rel.kind !== 'r' && rel.kind !== 'p') continue
    const res = await client.query(`select to_jsonb(t) as j from public.${q(rel.name)} t limit 1`)
    sampleRows.set(rel.name, res.rows[0]?.j ?? {})
  }

  const tables = relations.filter((r) => r.kind === 'r' || r.kind === 'p')
  const insertAttempt = (rel: Relation) => {
    const writable = rel.cols.filter((c) => !c.generated)
    const grantedCols = writable.filter((c) => c.canInsert)
    const cols = grantedCols.length > 0 ? grantedCols : writable
    const colList = cols.map((c) => q(c.name)).join(', ')
    const name = `public.${q(rel.name)}`
    return {
      sql: `insert into ${name} (${colList}) overriding system value
            select ${colList} from jsonb_populate_record(null::${name}, $1::jsonb)`,
      params: [JSON.stringify(sampleRows.get(rel.name) ?? {})],
    }
  }

  const leaks: string[] = []

  // Pasada A, mundo real: con los triggers prendidos, ningún INSERT puede prosperar (cualquier error sirve).
  await becomeActor(client, actor)
  for (const rel of tables) {
    const { sql, params } = insertAttempt(rel)
    const res = await probe(client, sql, params)
    if (res.ok) leaks.push(`INSERT ${rel.name} (triggers activos): la fila entró (${res.rowCount})`)
  }

  // Pasada B, foco en la RLS: algunos BEFORE triggers (fee_prices, member_categories, member_status_events)
  // validan y tiran ANTES de que Postgres evalúe el WITH CHECK, y taparían una policy abierta. Se apagan los
  // triggers de usuario DENTRO DE UN SAVEPOINT que se deshace al final: restaura el estado exacto (incluidos los
  // triggers ENABLE ALWAYS) y descarta cualquier escritura que se hubiera colado, así el recorrido siguiente arranca limpio.
  await actAsSuperuser(client)
  await client.query('savepoint pasada_b')
  for (const rel of tables) await client.query(`alter table public.${q(rel.name)} disable trigger user`)
  await becomeActor(client, actor)
  for (const rel of relations) {
    const isTable = rel.kind === 'r' || rel.kind === 'p'
    const name = `public.${q(rel.name)}`

    // INSERT
    if (isTable) {
      const { sql, params } = insertAttempt(rel)
      const res = await probe(client, sql, params)
      if (res.ok) leaks.push(`INSERT ${rel.name}: la fila entró (${res.rowCount})`)
      else if (res.code !== '42501') leaks.push(`INSERT ${rel.name}: rechazado por otra cosa que permisos/RLS (${res.code}) ${res.message}`)
    } else {
      const res = await probe(client, `insert into ${name} default values`)
      // Vista: sin grant da 42501; una vista no actualizable da 55000. Ambas son "no se puede".
      if (res.ok) leaks.push(`INSERT ${rel.name} (vista): entró (${res.rowCount})`)
      else if (res.code !== '42501' && res.code !== '55000') leaks.push(`INSERT ${rel.name} (vista): error inesperado (${res.code}) ${res.message}`)
    }

    // UPDATE (sobre una columna que el rol SÍ puede actualizar, si hay; sino sobre la primera editable)
    const updatable = rel.cols.filter((c) => !c.generated && !c.identity)
    const col = updatable.find((c) => c.canUpdate) ?? updatable[0]
    if (col) {
      const res = await probe(client, `update ${name} set ${q(col.name)} = ${q(col.name)}`)
      if (res.ok && res.rowCount > 0) leaks.push(`UPDATE ${rel.name}: afectó ${res.rowCount} filas`)
      else if (!res.ok && res.code !== '42501' && !(res.code === '55000' && !isTable))
        leaks.push(`UPDATE ${rel.name}: error inesperado (${res.code}) ${res.message}`)
    }

    // DELETE
    const del = await probe(client, `delete from ${name}`)
    if (del.ok && del.rowCount > 0) leaks.push(`DELETE ${rel.name}: afectó ${del.rowCount} filas`)
    else if (!del.ok && del.code !== '42501' && !(del.code === '55000' && !isTable))
      leaks.push(`DELETE ${rel.name}: error inesperado (${del.code}) ${del.message}`)
  }
  await actAsSuperuser(client)
  await client.query('rollback to savepoint pasada_b')
  return leaks
}

/**
 * Funciones: toda función de `public` sin prefijo `portal_` falla con 42501, salvo las excepciones declaradas
 * (SQLSTATE o resultado exacto, con motivo). Toda llamada que NO falla se mide: si cambió el contenido de cualquier tabla
 * de public/private/storage/auth, es fuga aunque devuelva `void`, `null`, `0` o `false`.
 */
async function scanFunctions(client: ClientBase, actor: Actor, seeds: Seeds, scope: FnScope = 'panel'): Promise<string[]> {
  await actAsSuperuser(client)
  const { calls, problems } = await buildCalls(client, seeds, scope)
  const exceptions = scope === 'portal' ? PORTAL_FUNCTION_EXCEPTIONS : FUNCTION_EXCEPTIONS
  const effectTables = await discoverEffectTables(client)
  let before = await snapshotEffects(client, effectTables)

  const leaks: string[] = [...problems]
  await becomeActor(client, actor)
  for (const call of calls) {
    const res = await probe(client, call.sql, call.params)
    const exception = exceptions[call.name]

    if (!res.ok) {
      if (res.code === '42501') continue
      if (res.code && exception?.sqlstates?.includes(res.code)) continue
      leaks.push(
        `FUNCTION ${call.label}: falló con ${res.code} en vez de 42501 (${res.message}). Si es una defensa legítima, declarala en FUNCTION_EXCEPTIONS con función, SQLSTATE y motivo`,
      )
      continue
    }

    if (!exception?.allowedRows) {
      leaks.push(`FUNCTION ${call.label}: se ejecutó sin error (${res.rows.length} filas) y no es una excepción declarada; tenía que fallar con 42501`)
    } else if (!exception.allowedRows(res.rows)) {
      leaks.push(`FUNCTION ${call.label}: la excepción declarada (${exception.why}) devolvió otra cosa: ${JSON.stringify(res.rows)}`)
    }

    // Efectos: una foto antes y después de cada llamada que prosperó.
    await actAsSuperuser(client)
    const after = await snapshotEffects(client, effectTables)
    const changed = changedTables(before, after)
    before = after
    if (changed.length > 0) leaks.push(`FUNCTION ${call.label}: MODIFICÓ DATOS en ${changed.join(', ')}`)
    await becomeActor(client, actor)
  }
  await actAsSuperuser(client)
  return leaks
}

/** Storage: recorre los buckets del catálogo; no se ve ningún objeto ni bucket, no se escribe nada y ningún bucket es público. */
async function scanStorage(client: ClientBase, actor: Actor): Promise<string[]> {
  const leaks: string[] = []
  await actAsSuperuser(client)
  const buckets = (await client.query<{ id: string; public: boolean }>(`select id, public from storage.buckets order by id`)).rows
  // Un bucket público se sirve por la URL pública sin pasar por RLS: ningún probe de SQL lo detecta, se mira el flag.
  for (const b of buckets) if (b.public) leaks.push(`storage.buckets: "${b.id}" es PÚBLICO (se sirve sin RLS ni URL firmada)`)

  await becomeActor(client, actor)
  const read = await probe(client, `select count(*)::int as n from storage.objects`)
  if (read.ok) {
    if (Number(read.rows[0].n) > 0) leaks.push(`storage.objects (todos los buckets): ${read.rows[0].n} objetos visibles`)
  } else if (read.code !== '42501') leaks.push(`storage.objects SELECT: error inesperado (${read.code}) ${read.message}`)

  const readBuckets = await probe(client, `select count(*)::int as n from storage.buckets`)
  if (readBuckets.ok) {
    if (Number(readBuckets.rows[0].n) > 0) leaks.push(`storage.buckets: ${readBuckets.rows[0].n} buckets visibles`)
  } else if (readBuckets.code !== '42501') leaks.push(`storage.buckets SELECT: error inesperado (${readBuckets.code}) ${readBuckets.message}`)

  // Tampoco puede subir a ningún bucket (aunque el path "parezca" válido): no hay policy de INSERT para él.
  for (const b of buckets) {
    const insert = await probe(client, `insert into storage.objects (bucket_id, name) values ($1, $2)`, [b.id, `payment-receipts/${randomUUID()}.pdf`])
    if (insert.ok) leaks.push(`storage.objects INSERT en "${b.id}": el objeto entró`)
    else if (insert.code !== '42501') leaks.push(`storage.objects INSERT en "${b.id}": error inesperado (${insert.code}) ${insert.message}`)
  }

  const update = await probe(client, `update storage.objects set name = name`)
  if (update.ok && update.rowCount > 0) leaks.push(`storage.objects UPDATE: afectó ${update.rowCount}`)
  else if (!update.ok && update.code !== '42501') leaks.push(`storage.objects UPDATE: error inesperado (${update.code}) ${update.message}`)

  const del = await probe(client, `delete from storage.objects`)
  if (del.ok && del.rowCount > 0) leaks.push(`storage.objects DELETE: afectó ${del.rowCount}`)
  else if (!del.ok && del.code !== '42501') leaks.push(`storage.objects DELETE: error inesperado (${del.code}) ${del.message}`)

  await actAsSuperuser(client)
  return leaks
}

async function scanAll(client: ClientBase, actor: Actor, seeds: Seeds): Promise<string[]> {
  return [
    ...(await scanReads(client, actor)),
    ...(await scanWrites(client, actor)),
    ...(await scanFunctions(client, actor, seeds)),
    ...(await scanStorage(client, actor)),
  ]
}

/** Usuario de Auth "huérfano": existe en `auth.users`, no tiene fila en `app_users`. */
async function createOrphanAuthUser(client: ClientBase): Promise<string> {
  const userId = randomUUID()
  await createAuthUser(client, { id: userId, email: `socio-${userId.slice(0, 8)}@lonqui.test` })
  return userId
}

/** La invariante real detrás de la bomba: una cuenta que no es del panel NO tiene fila en app_users. Superusuario. */
async function expectNoStaffRow(client: ClientBase, userId: string): Promise<void> {
  await actAsSuperuser(client)
  const rows = await client.query(`select 1 from public.app_users where user_id = $1`, [userId])
  expect(rows.rowCount, 'una cuenta que no es del panel no puede tener fila en app_users').toBe(0)
}

/** Conteo de filas de cada tabla/vista descubierta. Superusuario. */
async function relationCounts(client: ClientBase): Promise<Map<string, number>> {
  const relations = await discoverRelations(client, 'authenticated')
  const counts = new Map<string, number>()
  for (const rel of relations) {
    const res = await client.query(`select count(*)::int as n from public.${q(rel.name)}`)
    counts.set(rel.name, Number(res.rows[0].n))
  }
  return counts
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('cierre dinámico: el catálogo se recorre solo y el seed no es vacuo', () => {
  it('el descubrimiento encuentra el dominio real (si no encuentra nada, el resto del archivo no prueba nada)', async () => {
    await withRollback(async (client) => {
      const relations = await discoverRelations(client, 'authenticated')
      const names = relations.map((r) => r.name)
      for (const expected of ['members', 'family_groups', 'fees', 'payments', 'audit_log', 'app_users', 'cash_movements', 'fee_status', 'payment_credit']) {
        expect(names, `discoverRelations no vio "${expected}"`).toContain(expected)
      }
      expect(relations.find((r) => r.name === 'fee_status')?.kind).toBe('v')
      expect(relations.find((r) => r.name === 'members')?.kind).toBe('r')

      const fns = (await discoverFunctions(client)).map((f) => f.name)
      for (const expected of ['member_accounts', 'register_payment_batch', 'generate_pending_fees', 'my_permissions', 'keep_alive']) {
        expect(fns, `discoverFunctions no vio "${expected}"`).toContain(expected)
      }

      const effectTables = await discoverEffectTables(client)
      for (const expected of ['public.members', 'public.audit_log', 'private.password_markers', 'storage.objects', 'auth.users']) {
        expect(effectTables, `discoverEffectTables no vio "${expected}"`).toContain(expected)
      }
    })
  })

  it('cada excepción declarada de funciones existe en el catálogo (una excepción huérfana es una puerta olvidada)', async () => {
    await withRollback(async (client) => {
      const fns = (await discoverFunctions(client)).map((f) => f.name)
      for (const name of Object.keys(FUNCTION_EXCEPTIONS)) {
        expect(fns, `la excepción "${name}" ya no existe: sacala de FUNCTION_EXCEPTIONS`).toContain(name)
      }
    })
  })

  it('PostgREST solo expone public y graphql_public: un schema nuevo expuesto obliga a extender el recorrido', () => {
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')
    const line = config.split('\n').find((l) => /^\s*schemas\s*=/.test(l))
    expect(line, 'no se encontró `schemas = [...]` en [api] de supabase/config.toml').toBeDefined()
    const schemas = [...(line ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
    expect(
      schemas,
      'config.toml expone otro schema: este archivo solo recorre `public` (y storage): extendé discoverRelations/discoverFunctions antes de exponerlo',
    ).toEqual(['graphql_public', 'public'])
  })

  it('el seed deja filas NUEVAS en toda tabla y vista descubierta (no se apoya en datos de desarrollo que ya hubiera)', async () => {
    await withRollback(async (client) => {
      const before = await relationCounts(client)
      await seedClub(client)
      const after = await relationCounts(client)
      const notSeeded: string[] = []
      for (const [name, n] of after) {
        if (SINGLETON_FROM_MIGRATION.includes(name)) {
          if (n === 0) notSeeded.push(`${name} (singleton de migración vacío)`)
        } else if (n <= (before.get(name) ?? 0)) notSeeded.push(name)
      }
      expect(notSeeded, `seedClub() no agregó filas a: ${notSeeded.join(', ')}. Sumalas al seed: sin eso su "cero filas" no prueba nada`).toEqual([])
    })
  })

  it('contraparte: un admin SÍ ve lo sembrado (tablas, vistas, RPC y adjunto), así que el cero del socio no es un seed roto', async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      const member = await client.query(`select count(*)::int as n from public.members where id = $1`, [seeds.memberId])
      expect(member.rows[0].n).toBe(1)
      const group = await client.query(`select count(*)::int as n from public.family_groups where id = $1`, [seeds.groupId])
      expect(group.rows[0].n).toBe(1)
      const fees = await client.query(`select count(*)::int as n from public.fees where member_id = $1`, [seeds.memberId])
      expect(fees.rows[0].n).toBe(1)
      const payments = await client.query(`select count(*)::int as n from public.payments where member_id = $1`, [seeds.memberId])
      expect(payments.rows[0].n).toBe(1)
      const view = await client.query(`select count(*)::int as n from public.fee_status where member_id = $1`, [seeds.memberId])
      expect(view.rows[0].n).toBeGreaterThan(0)
      const credit = await client.query(`select credit_cents from public.payment_credit where member_id = $1`, [seeds.creditMemberId])
      expect(credit.rowCount).toBe(1)
      expect(Number(credit.rows[0].credit_cents)).toBe(50000)
      const accounts = await client.query(`select * from public.member_accounts($1::bigint[], 'all', null)`, [`{${seeds.memberId}}`])
      expect(accounts.rowCount).toBeGreaterThan(0)
      const storage = await client.query(`select count(*)::int as n from storage.objects where bucket_id = 'attachments' and name = $1`, [seeds.storageObjectName])
      expect(storage.rows[0].n).toBe(1)
    })
  })

  it('contraparte por función: con los mismos argumentos, un admin NUNCA recibe 42501 (el 42501 del socio es por el rol, no por los argumentos ni por un grant que falta)', async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { calls, problems } = await buildCalls(client, seeds)
      expect(problems).toEqual([])
      expect(calls.length).toBeGreaterThan(15)

      const denied: string[] = []
      await actAs(client, adminId)
      for (const call of calls) {
        const res = await probe(client, call.sql, call.params)
        if (!res.ok && res.code === '42501') denied.push(`${call.label}: ${res.message}`)
      }
      expect(denied, `el admin recibió 42501: el recorrido del socio no demuestra nada para estas funciones`).toEqual([])
    })
  })

  it('las excepciones declaradas se sostienen contra la base', async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      const orphanId = await createOrphanAuthUser(client)

      // set_family_payment_responsible: con ids reales (socio dentro del grupo) un admin SÍ la ejecuta; el 23514 del
      // socio sin rol es entonces culpa de la RLS que le oculta al socio, no de los argumentos.
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const ok = await probe(client, `select public.set_family_payment_responsible($1::bigint, $2::bigint)`, [seeds.groupId, seeds.memberId])
      expect(ok.ok, `el admin debería poder: ${JSON.stringify(ok)}`).toBe(true)
      await actAs(client, orphanId)
      const denied = await probe(client, `select public.set_family_payment_responsible($1::bigint, $2::bigint)`, [seeds.groupId, seeds.memberId])
      expect(denied.ok).toBe(false)
      if (!denied.ok) expect(denied.code).toBe('23514')
      await actAsSuperuser(client)
      const member = await client.query(`select is_payment_responsible from public.members where id = $1`, [seeds.memberId])
      expect(member.rows[0].is_payment_responsible, 'el admin lo dejó como responsable; el intento del socio no deshizo ni hizo nada más').toBe(true)

      // confirm_password_changed: el P0002 es exactamente "no hay marker propio". Con un marker pendiente (que solo crea
      // un admin vía mark_password_reset) la función pasa de largo ese chequeo: el marker es la puerta.
      await expectNoStaffRow(client, orphanId)
      const markers = await client.query(`select 1 from private.password_markers where user_id = $1`, [orphanId])
      expect(markers.rowCount).toBe(0)
      await actAs(client, orphanId)
      const noMarker = await probe(client, `select public.confirm_password_changed()`)
      expect(noMarker.ok).toBe(false)
      if (!noMarker.ok) expect(noMarker.code).toBe('P0002')

      await actAsSuperuser(client)
      const { userId: staffId } = await createUserWithRole(client, 'editor')
      await client.query(`insert into private.password_markers (user_id, marker, set_by) values ($1, 'marker-ficticio', $2)`, [staffId, adminId])
      await actAs(client, staffId)
      const withMarker = await probe(client, `select public.confirm_password_changed()`)
      expect(withMarker.ok || withMarker.code !== 'P0002', 'con un marker pendiente la función tiene que pasar el chequeo que da P0002').toBe(true)

      // Y el socio sin rol no puede fabricarse ese marker: mark_password_reset es solo de admin.
      await actAs(client, orphanId)
      const forge = await probe(client, `select public.mark_password_reset($1::uuid)`, [orphanId])
      expect(forge.ok).toBe(false)
      if (!forge.ok) expect(forge.code).toBe('42501')
    })
  })
})

const ACTORS: Array<{ kind: 'orphan' | 'anon' | 'portal'; label: string; canCallPrivate: boolean; build: (client: ClientBase) => Promise<Actor> }> = [
  {
    kind: 'orphan',
    label: 'usuario de Auth sin fila en app_users (el socio-por-venir)',
    canCallPrivate: true,
    build: async (client) => ({ label: 'auth sin app_users', pgRole: 'authenticated', userId: await createOrphanAuthUser(client) }),
  },
  {
    kind: 'anon',
    label: 'anon (la publishable key sin sesión)',
    // anon ni siquiera tiene USAGE sobre el schema private: es una defensa más, la prueba el recorrido de abajo.
    canCallPrivate: false,
    build: async () => ({ label: 'anon', pgRole: 'anon', userId: randomUUID() }),
  },
  {
    // S2-T4: el socio REAL. Una cuenta de la app con un vínculo con family_scope a un socio con grupo: ve lo suyo por
    // portal_me() y por NADA más. Es el actor que justifica todo el archivo: antes de S2 no existía y el huérfano era un modelo.
    kind: 'portal',
    label: 'cuenta de la app de socios, vinculada a un socio y a su grupo familiar',
    canCallPrivate: true,
    build: async (client) => {
      const admin = await createUserWithRole(client, 'admin')
      const groupId = await createFamilyGroup(client)
      const memberId = await createMember(client, { firstName: 'Vinculado', lastName: 'Inventado', dni: fakeDni(), familyGroupId: groupId })
      const account = await linkNewAccount(client, { adminId: admin.userId, memberId, relationship: 'guardian', familyScope: true })
      return { label: 'cuenta de la app', pgRole: 'authenticated', userId: account.userId }
    },
  },
]

for (const actorSpec of ACTORS) {
  describe.skipIf(!dbAvailable)(`cierre dinámico como ${actorSpec.label}`, () => {
    it.skipIf(!actorSpec.canCallPrivate)('private.current_app_role() es null y no hay fila en app_users: no hay rol efectivo', async () => {
      await withRollback(async (client) => {
        await seedClub(client)
        const actor = await actorSpec.build(client)
        await expectNoStaffRow(client, actor.userId)
        await becomeActor(client, actor)
        const role = await client.query('select private.current_app_role() as role')
        expect(role.rows[0].role).toBeNull()
      })
    })

    it('toda tabla y vista de public da cero filas o permission denied', async () => {
      await withRollback(async (client) => {
        await seedClub(client)
        const actor = await actorSpec.build(client)
        expect(await scanReads(client, actor)).toEqual([])
      })
    })

    it('todo insert, update y delete sobre public falla o afecta 0 filas (probado sobre las columnas que el rol sí puede tocar)', async () => {
      await withRollback(async (client) => {
        await seedClub(client)
        const actor = await actorSpec.build(client)
        expect(await scanWrites(client, actor)).toEqual([])
      })
    })

    it('toda función de public sin prefijo portal_ falla con 42501 (salvo las excepciones declaradas) y ninguna modifica datos', async () => {
      await withRollback(async (client) => {
        const seeds = await seedClub(client)
        const actor = await actorSpec.build(client)
        expect(await scanFunctions(client, actor, seeds)).toEqual([])
      })
    })

    it('storage: cero objetos y cero buckets visibles (todos los buckets), nada se escribe y ningún bucket es público', async () => {
      await withRollback(async (client) => {
        await seedClub(client)
        const actor = await actorSpec.build(client)
        expect(await scanStorage(client, actor)).toEqual([])
      })
    })
  })
}

describe.skipIf(!dbAvailable)('cierre dinámico: nada cambió en ninguna tabla después de todos los intentos', () => {
  it('foto de public, private, storage y auth antes y después de los recorridos de escritura, funciones y storage: idéntica', async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      for (const actor of [
        { label: 'auth sin app_users', pgRole: 'authenticated' as const, userId: await createOrphanAuthUser(client) },
        { label: 'anon', pgRole: 'anon' as const, userId: randomUUID() },
      ]) {
        await actAsSuperuser(client)
        const tables = await discoverEffectTables(client)
        const before = await snapshotEffects(client, tables)

        await scanWrites(client, actor)
        await scanFunctions(client, actor, seeds)
        await scanStorage(client, actor)

        await actAsSuperuser(client)
        const after = await snapshotEffects(client, tables)
        expect(changedTables(before, after), `${actor.label}: estas tablas cambiaron`).toEqual([])
      }
    })
  })
})

describe.skipIf(!dbAvailable)("la bomba latente: 'socio' en app_users.role abre el padrón", () => {
  /** Roles del panel: los únicos que `app_users.role` puede admitir. Un rol nuevo es una decisión de producto, no un ALTER suelto. */
  const STAFF_ROLES = ['admin', 'consulta', 'editor']

  it("GUARDA: app_users.role rechaza 'socio' y cualquier rol que no sea del panel (check_violation)", async () => {
    await withRollback(async (client) => {
      for (const role of ['socio', 'portal', 'member', 'miembro', 'user', 'tutor']) {
        const userId = randomUUID()
        await createAuthUser(client, { id: userId, email: `bomba-${userId.slice(0, 8)}@lonqui.test` })
        const res = await probe(
          client,
          `insert into public.app_users (user_id, email, display_name, role) values ($1, $2, 'Prueba Bomba', $3)`,
          [userId, `bomba-${userId.slice(0, 8)}@lonqui.test`, role],
        )
        expect(
          res.ok,
          `app_users admitió role='${role}': current_app_role() is not null abre el padrón a ese usuario (ver comment on column app_users.role)`,
        ).toBe(false)
        if (!res.ok) expect(res.code, `role='${role}' tendría que fallar por el CHECK, no por otra cosa`).toBe('23514')
      }
    })
  })

  it('GUARDA: los literales del CHECK de app_users.role son exactamente admin, consulta y editor', async () => {
    await withRollback(async (client) => {
      const res = await client.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
           from pg_constraint
          where conrelid = 'public.app_users'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'`,
      )
      expect(res.rowCount, 'tiene que haber un CHECK sobre app_users.role').toBeGreaterThan(0)
      const literals = new Set<string>()
      // Depende de cómo imprime Postgres el `= ANY (ARRAY[...])`; el camino por INSERT de arriba no depende del formato.
      for (const row of res.rows) for (const m of row.def.matchAll(/'([^']+)'::text/g)) literals.add(m[1])
      expect([...literals].sort()).toEqual(STAFF_ROLES)
    })
  })

  it("DEMOSTRACIÓN: con 'socio' admitido, un usuario con ese rol ve el padrón; el recorrido lo detecta (y todo se deshace)", async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      await actAsSuperuser(client)

      // Mundo alterado: se reemplaza el CHECK por uno que admite 'socio' (en un SAVEPOINT; el DDL de Postgres es transaccional).
      await client.query('savepoint bomba')
      const checks = await client.query<{ conname: string }>(
        `select conname from pg_constraint
          where conrelid = 'public.app_users'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'`,
      )
      for (const c of checks.rows) await client.query(`alter table public.app_users drop constraint ${q(c.conname)}`)
      await client.query(`alter table public.app_users add constraint app_users_role_check check (role in ('admin', 'editor', 'consulta', 'socio'))`)

      const socioId = randomUUID()
      await createAuthUser(client, { id: socioId, email: `socio-bomba-${socioId.slice(0, 8)}@lonqui.test` })
      await client.query(
        `insert into public.app_users (user_id, email, display_name, role, must_change_password) values ($1, $2, 'Socio Bomba', 'socio', false)`,
        [socioId, `socio-bomba-${socioId.slice(0, 8)}@lonqui.test`],
      )

      const actor: Actor = { label: 'socio (rol agregado al CHECK)', pgRole: 'authenticated', userId: socioId }
      await becomeActor(client, actor)
      const role = await client.query('select private.current_app_role() as role')
      expect(role.rows[0].role, 'con el rol en app_users, current_app_role() deja de ser null').toBe('socio')

      const leaks = await scanAll(client, actor, seeds)
      // Las siete tablas con `current_app_role() is not null` y el bucket attachments se abren. Si esta lista se pone
      // roja porque alguien ENDURECIÓ esas policies (p. ej. a un is_staff()), es una mejora: actualizá la lista.
      for (const expected of ['members', 'family_groups', 'disciplines', 'categories', 'settings', 'member_status_events', 'medical_clearances']) {
        expect(
          leaks.some((l) => l.startsWith(`SELECT public.${expected}:`)),
          `el recorrido tendría que detectar que "${expected}" se abre al rol socio (si endurecieron esa policy, actualizá esta lista); fugas halladas: ${leaks.join(' | ')}`,
        ).toBe(true)
      }
      expect(leaks.some((l) => l.startsWith('storage.objects (todos los buckets)'))).toBe(true)

      // Deshacer el mundo alterado y comprobar que el CHECK real volvió.
      await actAsSuperuser(client)
      await client.query('rollback to savepoint bomba')
      const restored = await client.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.app_users'::regclass and conname = 'app_users_role_check'`,
      )
      expect(restored.rows[0].def).not.toContain('socio')
      const gone = await client.query(`select 1 from public.app_users where user_id = $1`, [socioId])
      expect(gone.rowCount).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('el detector detecta: tabla, policy, función y bucket nuevos y abiertos se marcan solos', () => {
  it('mutaciones dentro del ROLLBACK: tabla sin RLS, policy abierta con DELETE otorgado y funciones que devuelven datos o escriben', async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      const actor: Actor = { label: 'auth sin app_users', pgRole: 'authenticated', userId: await createOrphanAuthUser(client) }

      // Línea base: cerrado.
      expect(await scanAll(client, actor, seeds)).toEqual([])

      // Mutación 1: una tabla nueva (como las de S2) con grants pero SIN RLS, con una fila.
      await client.query(`create table public.zz_mutante (id int primary key, dato text)`)
      await client.query(`insert into public.zz_mutante values (1, 'dato ficticio')`)
      await client.query(`grant select, insert, update, delete on public.zz_mutante to authenticated`)
      // Mutación 2: policy abierta de par en par sobre family_groups, más el grant de DELETE que hoy no existe.
      await client.query(`grant delete on public.family_groups to authenticated`)
      await client.query(`create policy zz_abierta on public.family_groups for all to authenticated using (true) with check (true)`)
      // Mutación 3: función nueva (sin prefijo portal_) que devuelve datos del padrón, ejecutable por authenticated.
      await client.query(
        `create function public.zz_filtra() returns bigint language sql stable security definer set search_path = '' as $$ select count(*) from public.members $$`,
      )
      await client.query(`grant execute on function public.zz_filtra() to authenticated`)
      // Mutación 4 (B1): función que ESCRIBE y devuelve void (se ve como '' ): solo la foto de efectos la delata.
      await client.query(
        `create function public.zz_escribe() returns void language sql volatile security definer set search_path = '' as $$ insert into public.sponsors (name) values ('Sponsor Mutante') $$`,
      )
      await client.query(`grant execute on function public.zz_escribe() to authenticated`)
      // Mutación 5 (B2): función abierta que valida su entrada con P0001: antes se confundía con una defensa.
      await client.query(
        `create function public.zz_valida(n bigint) returns void language plpgsql security definer set search_path = '' as $$ begin raise exception 'argumento inválido'; end $$`,
      )
      await client.query(`grant execute on function public.zz_valida(bigint) to authenticated`)
      // Mutación 6 (M1): función con un tipo de argumento sin valor de prueba.
      await client.query(
        `create function public.zz_tipo(i interval) returns bigint language sql stable security definer set search_path = '' as $$ select count(*) from public.members $$`,
      )
      await client.query(`grant execute on function public.zz_tipo(interval) to authenticated`)
      // ... y una portal_* con los mismos datos: queda afuera a propósito (se prueba aparte en S2).
      await client.query(
        `create function public.portal_zz_ok() returns bigint language sql stable security definer set search_path = '' as $$ select count(*) from public.members $$`,
      )
      await client.query(`grant execute on function public.portal_zz_ok() to authenticated`)

      const reads = await scanReads(client, actor)
      expect(reads.some((l) => l.startsWith('SELECT public.zz_mutante:'))).toBe(true)
      expect(reads.some((l) => l.startsWith('SELECT public.family_groups:'))).toBe(true)

      const writes = await scanWrites(client, actor)
      for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
        expect(writes.some((l) => l.startsWith(`${op} zz_mutante`)), `${op} zz_mutante no se detectó: ${writes.join(' | ')}`).toBe(true)
        expect(writes.some((l) => l.startsWith(`${op} family_groups`)), `${op} family_groups no se detectó: ${writes.join(' | ')}`).toBe(true)
      }

      const fns = await scanFunctions(client, actor, seeds)
      expect(fns.some((l) => l.startsWith('FUNCTION zz_filtra()'))).toBe(true)
      expect(fns.some((l) => l.startsWith('FUNCTION zz_escribe()') && l.includes('MODIFICÓ DATOS') && l.includes('public.sponsors')), fns.join(' | ')).toBe(true)
      expect(fns.some((l) => l.startsWith('FUNCTION zz_valida(bigint)') && l.includes('P0001')), fns.join(' | ')).toBe(true)
      expect(fns.some((l) => l.startsWith('FUNCTION zz_tipo(interval)') && l.includes('no hay valor de prueba')), fns.join(' | ')).toBe(true)
      expect(fns.some((l) => l.includes('portal_zz_ok'))).toBe(false)
      // ... que el recorrido de las portal_* (S2-T4) SÍ atrapa: una portal_* nueva abierta para un huérfano devuelve datos.
      const portalFns = await scanFunctions(client, actor, seeds, 'portal')
      expect(portalFns.some((l) => l.startsWith('FUNCTION portal_zz_ok()')), portalFns.join(' | ')).toBe(true)
      const unclassified = await classifyPortalFunctions(client)
      expect(unclassified.some((l) => l.includes('portal_zz_ok')), unclassified.join(' | ')).toBe(true)

      // Mutación 7 (M2): un bucket nuevo y PÚBLICO, con un objeto y una policy de lectura abierta.
      await client.query(`insert into storage.buckets (id, name, public) values ('zz-publico', 'zz-publico', true)`)
      await client.query(`insert into storage.objects (bucket_id, name) values ('zz-publico', 'fixture/zz.bin')`)
      await client.query(`create policy zz_storage on storage.objects for select to authenticated using (true)`)
      const storage = await scanStorage(client, actor)
      expect(storage.some((l) => l.includes('"zz-publico" es PÚBLICO')), storage.join(' | ')).toBe(true)
      expect(storage.some((l) => l.startsWith('storage.objects (todos los buckets)')), storage.join(' | ')).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// S2-T4: las portal_*
// ---------------------------------------------------------------------------

/** Las portal_* que el socio (o cualquier sesión) puede llamar. Cada una resuelve la cuenta desde auth.uid() en el cuerpo. */
const PORTAL_SESSION_FUNCTIONS = ['portal_me', 'portal_mark_password_set']
/** portal_* para el PANEL: ejecutables por authenticated, pero el cuerpo exige portal.review. */
const PORTAL_PANEL_FUNCTIONS = ['portal_request_candidates']
/** portal_* SOLO de servicio (las llama /api/v1 con la secret key): ni anon ni authenticated. */
const PORTAL_SERVICE_ONLY_FUNCTIONS = ['portal_token_peek', 'portal_token_consume', 'portal_submit_access_request']

type PortalFnPrivilege = { name: string; sig: string; anon: boolean; authenticated: boolean; service: boolean }

/** EXECUTE efectivo (incluye PUBLIC) de cada portal_* para anon, authenticated y service_role. Superusuario. */
async function portalFunctionPrivileges(client: ClientBase): Promise<PortalFnPrivilege[]> {
  const res = await client.query<PortalFnPrivilege>(
    `select p.proname as name, p.oid::regprocedure::text as sig,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
            has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and left(p.proname, 7) = 'portal_'
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      order by p.proname, p.oid`,
  )
  return res.rows
}

/**
 * Toda portal_* tiene que estar clasificada (sesión / panel / servicio) y tener EXACTAMENTE el EXECUTE de su clase:
 * anon nunca; authenticated solo si no es de servicio; service_role siempre. Una portal_* nueva sin clasificar es un
 * problema (el prefijo no es una excusa: es SECURITY DEFINER). Devuelve los problemas ([] = ok).
 */
async function classifyPortalFunctions(client: ClientBase): Promise<string[]> {
  await actAsSuperuser(client)
  const problems: string[] = []
  for (const fn of await portalFunctionPrivileges(client)) {
    const serviceOnly = PORTAL_SERVICE_ONLY_FUNCTIONS.includes(fn.name)
    const known = serviceOnly || PORTAL_SESSION_FUNCTIONS.includes(fn.name) || PORTAL_PANEL_FUNCTIONS.includes(fn.name)
    if (!known) {
      problems.push(`${fn.sig}: portal_* sin clasificar: agregala a PORTAL_SESSION_FUNCTIONS, PORTAL_PANEL_FUNCTIONS o PORTAL_SERVICE_ONLY_FUNCTIONS`)
      continue
    }
    if (fn.anon) problems.push(`${fn.sig}: anon puede ejecutarla`)
    if (serviceOnly && fn.authenticated) problems.push(`${fn.sig}: es de servicio y authenticated puede ejecutarla`)
    if (!serviceOnly && !fn.authenticated) problems.push(`${fn.sig}: authenticated no puede ejecutarla (la usa el panel / el socio)`)
    // service_role solo tiene que poder las de servicio: las del socio y del panel resuelven a la persona desde auth.uid(), que con la secret key es null.
    if (serviceOnly && !fn.service) problems.push(`${fn.sig}: service_role no puede ejecutarla`)
  }
  return problems
}

describe.skipIf(!dbAvailable)('portal_*: el catálogo clasificado y cerrado (S2-T4)', () => {
  it('toda portal_* está clasificada y tiene el EXECUTE exacto de su clase: anon ninguna, de servicio solo service_role', async () => {
    await withRollback(async (client) => {
      expect(await classifyPortalFunctions(client)).toEqual([])
      // La lista no es decorativa: las ocho que escribió la migración existen.
      const names = (await portalFunctionPrivileges(client)).map((f) => f.name)
      for (const expected of [...PORTAL_SESSION_FUNCTIONS, ...PORTAL_PANEL_FUNCTIONS, ...PORTAL_SERVICE_ONLY_FUNCTIONS]) {
        expect(names, `la clasificación nombra "${expected}" y ya no existe: actualizá la lista`).toContain(expected)
      }
    })
  })

  it('las tres de servicio no se pueden ejecutar de verdad: authenticated (incluso un admin) y anon reciben 42501, y la base no cambia', async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      const issued = await issueToken(client, seeds.adminId, { memberId: seeds.creditMemberId, delivery: 'qr', replacePending: true })
      const accountUser = await createPortalAuthUser(client)
      const orphanId = await createOrphanAuthUser(client)
      const effectTables = await discoverEffectTables(client)
      const before = await snapshotEffects(client, effectTables)

      const calls: Array<{ label: string; sql: string; params: unknown[] }> = [
        { label: 'portal_token_peek', sql: `select * from public.portal_token_peek($1::text, null)`, params: [issued.token] },
        {
          label: 'portal_token_consume',
          sql: `select * from public.portal_token_consume($1::text, $2::uuid, null, 'Ficticia', 'Inventada', $3::text, null, true)`,
          params: [issued.token, accountUser, fakeDni()],
        },
        {
          label: 'portal_submit_access_request',
          sql: `select public.portal_submit_access_request('Ficticia', 'Inventada', $1::text, '3511234567', null, null, null, '[{"first_name":"Hijo","last_name":"Inventado","relationship":"guardian"}]'::jsonb, 'ip-ficticia')`,
          params: [fakeDni()],
        },
      ]
      const actors: Array<{ label: string; pgRole: 'authenticated' | 'anon'; userId: string }> = [
        { label: 'admin del panel', pgRole: 'authenticated', userId: seeds.adminId },
        { label: 'cuenta de la app', pgRole: 'authenticated', userId: seeds.portalAccountId },
        { label: 'huérfano', pgRole: 'authenticated', userId: orphanId },
        { label: 'anon', pgRole: 'anon', userId: randomUUID() },
      ]
      for (const actor of actors) {
        for (const call of calls) {
          await actAs(client, actor.userId, { pgRole: actor.pgRole })
          const res = await probe(client, call.sql, call.params)
          expect(res.ok, `${actor.label} pudo ejecutar ${call.label}`).toBe(false)
          if (!res.ok) expect(res.code, `${actor.label} / ${call.label}: ${res.message}`).toBe('42501')
        }
      }
      await actAsSuperuser(client)
      const after = await snapshotEffects(client, effectTables)
      expect(changedTables(before, after), 'ningún intento denegado puede dejar rastro').toEqual([])

      // Contraparte: service_role SÍ las ejecuta (si no, el 42501 de arriba sería un grant roto para todos).
      const peek = await peekToken(client, issued.token)
      expect(peek.status).toBe('ok')
    })
  })

  for (const actorSpec of ACTORS.filter((a) => a.kind !== 'portal')) {
    it(`como ${actorSpec.label}: toda portal_* falla con 42501 o devuelve NULL sin modificar nada (misma exigencia que el resto de public)`, async () => {
      await withRollback(async (client) => {
        const seeds = await seedClub(client)
        const actor = await actorSpec.build(client)
        const { calls, problems } = await buildCalls(client, seeds, 'portal')
        expect(problems).toEqual([])
        expect(calls.map((c) => c.name).sort(), 'el recorrido tiene que cubrir todas las portal_*').toEqual(
          [...PORTAL_SESSION_FUNCTIONS, ...PORTAL_PANEL_FUNCTIONS, ...PORTAL_SERVICE_ONLY_FUNCTIONS].sort(),
        )
        expect(await scanFunctions(client, actor, seeds, 'portal')).toEqual([])
      })
    })
  }

  it('contraparte: la cuenta vinculada SÍ obtiene datos de portal_me() (el NULL del huérfano no es un portal_me roto)', async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      await actAs(client, seeds.portalAccountId)
      const me = await client.query(`select public.portal_me() as me`)
      const members = (me.rows[0].me?.members ?? []) as Array<{ member_id: number }>
      expect(members.map((m) => m.member_id)).toContain(seeds.memberId)
    })
  })

  it('el seed cubre también private.portal_rate_limits (el límite de pedidos dejó su rastro)', async () => {
    await withRollback(async (client) => {
      const before = await client.query(`select count(*)::int as n from private.portal_rate_limits`)
      await seedClub(client)
      const after = await client.query(`select count(*)::int as n from private.portal_rate_limits`)
      expect(after.rows[0].n).toBeGreaterThan(before.rows[0].n)
    })
  })

  it('canjear una invitación NO toca app_users y la cuenta nueva no tiene rol del panel: current_app_role() es null y el padrón sigue cerrado (la invariante real detrás de la bomba)', async () => {
    await withRollback(async (client) => {
      const seeds = await seedClub(client)
      const userId = await createPortalAuthUser(client)

      const snapshot = async () => (await snapshotEffects(client, ['public.app_users'])).get('public.app_users')
      const before = await snapshot()
      const issued = await issueToken(client, seeds.adminId, { memberId: seeds.memberId, delivery: 'qr', familyScope: true, replacePending: false })
      const consumed = await consumeToken(client, issued.token, userId, { personDni: fakeDni() })
      expect(consumed.status).toBe('ok')
      expect(await snapshot(), 'canjear una invitación no puede agregar ni cambiar filas de app_users').toBe(before)
      await expectNoStaffRow(client, userId)

      await actAs(client, userId)
      const role = await client.query('select private.current_app_role() as role')
      expect(role.rows[0].role).toBeNull()
      const perms = await client.query(`select public.my_permissions() as p`)
      expect(perms.rows[0].p).toEqual([])
      // Y el padrón, cerrado: es una cuenta REAL con vínculo a un socio con grupo, no un huérfano.
      const members = await probe(client, `select count(*)::int as n from public.members`)
      expect(members.ok && Number(members.rows[0].n)).toBe(0)
      const groups = await probe(client, `select count(*)::int as n from public.family_groups`)
      expect(groups.ok && Number(groups.rows[0].n)).toBe(0)
      // ... y portal_me() sí le muestra lo suyo.
      const me = await client.query(`select public.portal_me() as me`)
      expect((me.rows[0].me.members as Array<{ member_id: number }>).some((m) => m.member_id === seeds.memberId)).toBe(true)
    })
  })
})
