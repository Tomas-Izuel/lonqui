import { Client, type ClientBase } from 'pg'
import { randomUUID } from 'node:crypto'

/**
 * Infraestructura compartida de `tests/db/`: corre contra el stack local de
 * Supabase (`127.0.0.1:54322`, user/pass `postgres`). Se saltea sola si la
 * base no responde (`npm test` sin Docker no puede fallar por esto).
 *
 * Regla de oro: NUNCA dejamos filas. `audit_log` es append-only (sin grant de
 * DELETE para nadie, ni para `postgres`) así que la única forma de no
 * ensuciar la base es que cada test corra dentro de una transacción con
 * ROLLBACK. Todo lo que un test necesita (usuarios de Auth, socios, grupos)
 * se crea y se deshace ahí adentro.
 */

const CONNECTION_STRING = process.env.LONQUI_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

let cachedAvailability: boolean | null = null

/** true si Postgres local responde. Se cachea por proceso: un solo intento de conexión por corrida de vitest. */
export async function isDbAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability

  const client = new Client({ connectionString: CONNECTION_STRING, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    await client.query('select 1')
    cachedAvailability = true
  } catch {
    cachedAvailability = false
  } finally {
    await client.end().catch(() => {})
  }
  return cachedAvailability
}

/**
 * Corre `fn` con un cliente `pg` dentro de `BEGIN ... ROLLBACK`. Cualquier
 * fixture que el test cree (auth.users, app_users, members, lo que sea) se
 * crea con este mismo cliente ANTES de simular el rol, y desaparece solo al
 * volver.
 */
export async function withRollback<T>(fn: (client: ClientBase) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: CONNECTION_STRING })
  await client.connect()
  try {
    await client.query('begin')
    try {
      return await fn(client)
    } finally {
      await client.query('rollback')
    }
  } finally {
    await client.end()
  }
}

export type FakeAuthUser = {
  id: string
  email: string
  encryptedPassword?: string
}

/**
 * Fila mínima y válida de `auth.users`. Los campos `*_token`/`email_change`
 * van en `''` explícito: `NULL` rompe GoTrue al listar usuarios (hallazgo real
 * de este pipeline, ver `02-development-backend-b1.md`). Se inserta como
 * `postgres` (superusuario, bypassea RLS), nunca como `authenticated`.
 */
export async function createAuthUser(client: ClientBase, input: FakeAuthUser): Promise<void> {
  await client.query(
    `insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, email_change, email_change_token_new, recovery_token,
      raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(),
      '', '', '', '',
      '{}'::jsonb, '{}'::jsonb, false, false, now(), now()
    )`,
    [input.id, input.email, input.encryptedPassword ?? fakeBcryptHash()],
  )
}

/** Un hash con forma de bcrypt real pero inventado: alcanza para las pruebas de "el hash cambió sí/no". */
function fakeBcryptHash(): string {
  return `$2a$10$${randomUUID().replace(/-/g, '')}`
}

export type FakeAppUser = {
  userId: string
  email: string
  displayName?: string
  role?: 'admin' | 'editor' | 'consulta'
  isActive?: boolean
  mustChangePassword?: boolean
}

/**
 * Fila de `app_users` insertada como `postgres`: bypassea el trigger guard y
 * el hecho de que `must_change_password` no tiene grant de UPDATE para nadie
 * (como superusuario no hace falta el grant). Así un fixture puede nacer con
 * el flag ya apagado, algo que ningún rol de la app puede hacer por sí mismo.
 */
export async function createAppUser(client: ClientBase, input: FakeAppUser): Promise<void> {
  await client.query(
    `insert into public.app_users (user_id, email, display_name, role, is_active, must_change_password)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.userId,
      input.email,
      input.displayName ?? 'Persona de Prueba',
      input.role ?? 'consulta',
      input.isActive ?? true,
      input.mustChangePassword ?? false,
    ],
  )
}

/** Auth user + app_users en un solo paso: el caso común de fixture. */
export async function createUserWithRole(
  client: ClientBase,
  role: 'admin' | 'editor' | 'consulta',
  overrides?: Partial<FakeAppUser> & Partial<FakeAuthUser>,
): Promise<{ userId: string; email: string }> {
  const userId = overrides?.userId ?? overrides?.id ?? randomUUID()
  const email = overrides?.email ?? `${role}-${userId.slice(0, 8)}@lonqui.test`

  await createAuthUser(client, { id: userId, email, encryptedPassword: overrides?.encryptedPassword })
  await createAppUser(client, {
    userId,
    email,
    role,
    displayName: overrides?.displayName,
    isActive: overrides?.isActive,
    mustChangePassword: overrides?.mustChangePassword,
  })

  return { userId, email }
}

/**
 * Simula ser ese usuario, EXACTAMENTE como lo hace PostgREST: cambia el rol
 * de sesión a `authenticated` (para que los grants/RLS de ese rol apliquen) y
 * fija `request.jwt.claims` con lo mínimo que `auth.uid()`/`auth.role()`
 * necesitan. No emite un JWT firmado de verdad: no hace falta, porque acá
 * estamos DENTRO de Postgres, en el mismo lugar donde PostgREST deja esas
 * variables de sesión después de validar el JWT.
 */
export async function actAs(
  client: ClientBase,
  userId: string,
  options?: { pgRole?: 'authenticated' | 'anon' | 'service_role'; extraClaims?: Record<string, unknown> },
): Promise<void> {
  const pgRole = options?.pgRole ?? 'authenticated'
  const claims = { sub: userId, role: pgRole, aud: 'authenticated', ...options?.extraClaims }
  await client.query(`set local role ${pgRole}`)
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
}

/** Vuelve a ser `postgres` (superusuario), típico para armar fixtures a mitad de un test. */
export async function actAsSuperuser(client: ClientBase): Promise<void> {
  await client.query('reset role')
  await client.query(`select set_config('request.jwt.claims', '', true)`)
}

/**
 * `id` es `bigint` en todas estas tablas: el driver `pg` lo devuelve como
 * `string` para no perder precisión más allá de `Number.MAX_SAFE_INTEGER`.
 * En estos tests los ids son chicos: convertir a `number` es seguro y evita
 * que cada fixture tenga que acordarse de hacerlo.
 */
function idOf(row: { id: number | string }): number {
  return Number(row.id)
}

export async function createDiscipline(
  client: ClientBase,
  input: { name: string; isActive?: boolean; sortOrder?: number },
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `insert into public.disciplines (name, is_active, sort_order) values ($1, $2, $3) returning id`,
    [input.name, input.isActive ?? true, input.sortOrder ?? 0],
  )
  return idOf(result.rows[0])
}

export async function createCategory(
  client: ClientBase,
  input: { disciplineId: number; name: string; isActive?: boolean },
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `insert into public.categories (discipline_id, name, is_active) values ($1, $2, $3) returning id`,
    [input.disciplineId, input.name, input.isActive ?? true],
  )
  return idOf(result.rows[0])
}

export type FakeMember = {
  firstName: string
  lastName: string
  dni?: string | null
  birthDate?: string | null
  familyGroupId?: number | null
  isPaymentResponsible?: boolean
  joinedOn?: string
}

/**
 * `created_by` NO va en el INSERT: la columna toma `default auth.uid()` sola,
 * y el grant de INSERT de `members` (S3) no incluye esa columna a propósito
 * (nadie la manda a mano). Escribirla explícito, aunque sea con el mismo
 * valor, pide un privilegio que `authenticated` no tiene y tira "permission
 * denied" — confirmado corriendo esto contra la base real.
 *
 * Desde S0 (slice 2, `member_categories`) `members` ya NO tiene `category_id`
 * ni `member_type` escribible: nace `non_practicing` (el default de la
 * columna) y lo vuelve `practicing` el trigger `sync_member_type` en cuanto
 * se le abre una inscripción con `openMemberCategory`.
 */
export async function createMember(client: ClientBase, input: FakeMember): Promise<number> {
  const result = await client.query<{ id: number }>(
    `insert into public.members (first_name, last_name, dni, birth_date, family_group_id, is_payment_responsible, joined_on)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      input.firstName,
      input.lastName,
      input.dni ?? null,
      input.birthDate ?? null,
      input.familyGroupId ?? null,
      input.isPaymentResponsible ?? false,
      input.joinedOn ?? '2026-01-01',
    ],
  )
  return idOf(result.rows[0])
}

/**
 * Abre una inscripción en `member_categories` (socio ↔ categoría), tal cual
 * la escribiría `set_member_categories`/la action de alta. El trigger
 * `sync_member_type` pone `members.member_type = 'practicing'` solo.
 * Se inserta con el cliente actual (respeta el rol simulado con `actAs`):
 * si el fixture necesita bypassear permisos, llamar con `actAsSuperuser`
 * antes.
 */
export async function openMemberCategory(
  client: ClientBase,
  input: { memberId: number; categoryId: number; joinedOn?: string },
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `insert into public.member_categories (member_id, category_id, joined_on) values ($1, $2, $3) returning id`,
    [input.memberId, input.categoryId, input.joinedOn ?? '2026-01-01'],
  )
  return idOf(result.rows[0])
}

/** Cierra una inscripción abierta (`left_on`/`left_reason` null → valor, una vez). */
export async function closeMemberCategory(
  client: ClientBase,
  input: { membershipId: number; leftOn: string; leftReason?: string | null },
): Promise<void> {
  await client.query(`update public.member_categories set left_on = $2, left_reason = $3 where id = $1`, [
    input.membershipId,
    input.leftOn,
    input.leftReason ?? null,
  ])
}

export async function createFamilyGroup(client: ClientBase, input?: { name?: string }): Promise<number> {
  const result = await client.query<{ id: number }>(
    `insert into public.family_groups (name) values ($1) returning id`,
    [input?.name ?? null],
  )
  return idOf(result.rows[0])
}

/**
 * Corre `sql` esperando que falle, y deja la transacción SEGUIR usable
 * después (Postgres aborta toda la transacción tras un error; sin un
 * SAVEPOINT, cualquier query posterior fallaría con "current transaction is
 * aborted" en vez de con el error real que queremos inspeccionar).
 */
export async function expectQueryError(
  client: ClientBase,
  sql: string,
  params?: unknown[],
): Promise<{ message: string; code?: string }> {
  await client.query('savepoint expect_error')
  try {
    await client.query(sql, params)
    throw new Error(`Se esperaba que esta consulta fallara, pero tuvo éxito: ${sql}`)
  } catch (err) {
    await client.query('rollback to savepoint expect_error')
    return err as { message: string; code?: string }
  }
}

/** Cuenta filas de `information_schema.role_table_grants` para (rol, tabla, privilegio). */
export async function hasGrant(
  client: ClientBase,
  role: string,
  table: string,
  privilege: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1 from information_schema.role_table_grants
     where grantee = $1 and table_schema = 'public' and table_name = $2 and privilege_type = $3`,
    [role, table, privilege],
  )
  return (result.rowCount ?? 0) > 0
}

export async function allPublicTables(client: ClientBase): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  )
  return result.rows.map((r) => r.table_name)
}
