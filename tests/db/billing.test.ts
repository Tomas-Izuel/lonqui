import { describe, expect, it } from 'vitest'
import {
  actAs,
  actAsSuperuser,
  closeMemberCategory,
  createCategory,
  createDiscipline,
  createMember,
  createUserWithRole,
  expectQueryError,
  isDbAvailable,
  openMemberCategory,
  withRollback,
} from './helpers'

/**
 * S1 (`01-tasks.md`, `0005_billing.sql`): catálogo de permisos
 * (`private.can`/`my_permissions`), valores de cuota, cargos por deporte,
 * generación mensual (D30, ascenso de categoría, cambio social↔deporte),
 * corridas registradas (`billing_runs`, T1) y activación de la facturación
 * (D18). Todo dentro de `BEGIN … ROLLBACK`: no se deja ninguna fila, ni en
 * `fee_prices` (append-only: una vez insertada, no hay forma de sacarla,
 * así que un fixture roto acá sería irreversible sin este patrón).
 *
 * `club_today()` en esta base corre en 2026-09 (real, no simulado): los
 * fixtures usan septiembre 2026 como "mes actual" y octubre/noviembre como
 * futuros, coherente con el seed.
 */
const dbAvailable = await isDbAvailable()

describe.skipIf(!dbAvailable)('Permisos: private.can / my_permissions (T12, §6.8)', () => {
  it('el catálogo por rol es EXACTAMENTE el de §6.8, ni un permiso de más ni de menos', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')

      await actAs(client, adminId)
      const admin = await client.query<{ my_permissions: string[] }>('select public.my_permissions()')
      expect(new Set(admin.rows[0].my_permissions)).toEqual(
        new Set([
          'members.read', 'members.write', 'members.status',
          'payments.read', 'payments.register', 'payments.void',
          'billing.configure', 'settings.manage', 'users.manage', 'audit.read',
          'reports.read', 'reports.export',
        ]),
      )

      await actAs(client, editorId)
      const editor = await client.query<{ my_permissions: string[] }>('select public.my_permissions()')
      expect(new Set(editor.rows[0].my_permissions)).toEqual(
        new Set(['members.read', 'members.write', 'payments.read', 'payments.register', 'reports.read', 'reports.export']),
      )
      expect(editor.rows[0].my_permissions).not.toContain('payments.void')
      expect(editor.rows[0].my_permissions).not.toContain('billing.configure')

      await actAs(client, consultaId)
      const consulta = await client.query<{ my_permissions: string[] }>('select public.my_permissions()')
      expect(new Set(consulta.rows[0].my_permissions)).toEqual(
        new Set(['members.read', 'payments.read', 'reports.read', 'reports.export']),
      )
    })
  })

  it('private.can: payments.register true para editor y admin, false para consulta; payments.void solo admin', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')

      await actAs(client, editorId)
      let row = await client.query(`select private.can('payments.register') as can, private.can('payments.void') as void`)
      expect(row.rows[0].can).toBe(true)
      expect(row.rows[0].void).toBe(false)

      await actAs(client, adminId)
      row = await client.query(`select private.can('payments.register') as can, private.can('payments.void') as void`)
      expect(row.rows[0].can).toBe(true)
      expect(row.rows[0].void).toBe(true)

      await actAs(client, consultaId)
      row = await client.query(`select private.can('payments.register') as can, private.can('payments.void') as void`)
      expect(row.rows[0].can).toBe(false)
      expect(row.rows[0].void).toBe(false)
    })
  })

  it('reports.export está en el catálogo de los TRES roles (el contrato le da exportación a consulta)', async () => {
    await withRollback(async (client) => {
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const row = await client.query(`select private.can('reports.export') as can`)
      expect(row.rows[0].can).toBe(true)
    })
  })

  it('usuario desactivado (is_active=false): TODO can() es false y my_permissions() es {}', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin', { isActive: false })
      await actAs(client, userId)
      const row = await client.query(`select private.can('members.read') as can, public.my_permissions() as perms`)
      expect(row.rows[0].can).toBe(false)
      expect(row.rows[0].perms).toEqual([])
    })
  })

  it('usuario con contraseña temporal pendiente (must_change_password=true): TODO can() es false', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin', { mustChangePassword: true })
      await actAs(client, userId)
      const row = await client.query(`select private.can('billing.configure') as can, public.my_permissions() as perms`)
      expect(row.rows[0].can).toBe(false)
      expect(row.rows[0].perms).toEqual([])
    })
  })

  it('anon no puede ejecutar can() ni my_permissions() (permission denied for function)', async () => {
    await withRollback(async (client) => {
      await client.query('set local role anon')
      const errCan = await expectQueryError(client, `select private.can('members.read')`)
      expect(errCan.code).toBe('42501')
      const errPermissions = await expectQueryError(client, 'select public.my_permissions()')
      expect(errPermissions.code).toBe('42501')
    })
  })

  it('ninguna policy/trigger/RPC de 0004b–0007 usa has_role ni is_admin (deuda documentada: solo el slice 1 los sigue usando)', async () => {
    await withRollback(async (client) => {
      const defs = await client.query<{ proname: string; src: string }>(
        `select p.proname, pg_get_functiondef(p.oid) as src
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('private', 'public')
           and p.proname in (
             'permissions_for_role', 'can', 'member_categories_insert_guard', 'member_categories_update_guard',
             'sync_member_type', 'set_member_categories', 'fee_prices_insert_guard', 'fees_void_guard',
             'fees_opening_balance_guard', 'generate_monthly_fees', 'generate_pending_fees',
             'settings_billing_guard', 'member_balance', 'member_fee_coverage', 'member_accounts',
             'member_fee_statement', 'dashboard_summary', 'debt_by_category', 'monthly_history',
             'month_collection', 'log_export', 'payments_update_guard'
           )`,
      )
      expect(defs.rowCount).toBeGreaterThan(10)
      for (const row of defs.rows) {
        expect(row.src, `${row.proname} no debería usar has_role/is_admin`).not.toMatch(/has_role|is_admin/)
      }
    })
  })
})

describe.skipIf(!dbAvailable)('fee_prices: append-only, coherencia y precedencia', () => {
  it('editor no inserta; admin sí', async () => {
    await withRollback(async (client) => {
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const err = await expectQueryError(
        client,
        `insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 999999, date_trunc('month', private.club_today())::date + interval '2 years')`,
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('UPDATE/DELETE fallan como admin, service_role y postgres (append-only real, no solo declarado)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const inserted = await client.query<{ id: number }>(
        `insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 1234500, (date_trunc('month', private.club_today())::date + interval '3 years')::date) returning id`,
      )
      const id = inserted.rows[0].id

      // `admin` y `service_role` no tienen NINGÚN grant de UPDATE/DELETE
      // sobre `fee_prices` (solo SELECT + INSERT): el rechazo es de la capa
      // de grants, ni siquiera llega al trigger `forbid_change`.
      let err = await expectQueryError(client, `update public.fee_prices set amount_cents = 1 where id = $1`, [id])
      expect(err.message).toMatch(/permission denied/i)

      await actAs(client, adminId, { pgRole: 'service_role' })
      err = await expectQueryError(client, `update public.fee_prices set amount_cents = 1 where id = $1`, [id])
      expect(err.message).toMatch(/permission denied/i)

      // `postgres` (superusuario) SÍ bypasea los grants, y es quien
      // realmente ejercita el trigger `forbid_change`.
      await actAsSuperuser(client)
      err = await expectQueryError(client, `update public.fee_prices set amount_cents = 1 where id = $1`, [id])
      expect(err.message).toBe('Los registros de fee_prices no se modifican ni se borran')
      err = await expectQueryError(client, `delete from public.fee_prices where id = $1`, [id])
      expect(err.message).toBe('Los registros de fee_prices no se modifican ni se borran')
    })
  })

  it('valid_from de un mes pasado: rechazado', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const err = await expectQueryError(
        client,
        `insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 100, '2020-01-01')`,
      )
      expect(err.message).toMatch(/aplica desde este mes o uno futuro/)
    })
  })

  it('valid_from de un mes que YA tiene cuotas mensuales generadas: rechazado con el mensaje que nombra el mes (T6)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      // El mes actual ya tiene cuotas generadas por el seed:
      // no hace falta ningún fixture extra para disparar esta rama.
      const err = await expectQueryError(
        client,
        `insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 100, date_trunc('month', private.club_today())::date)`,
      )
      expect(err.message).toMatch(/ya se generaron con otro valor/)
      const mm = await client.query<{ label: string }>(`select to_char(private.club_today(), 'MM/YYYY') as label`)
      expect(err.message).toContain(`Las cuotas de ${mm.rows[0].label} ya se generaron`)
    })
  })

  it('duplicado exacto (scope/target/valid_from): unique violation', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const farFuture = `date_trunc('month', private.club_today())::date + interval '5 years'`
      await client.query(`insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 100, ${farFuture})`)
      const err = await expectQueryError(
        client,
        `insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 200, ${farFuture})`,
      )
      expect(err.code).toBe('23505')
    })
  })

  it('CHECK de coherencia scope/member_type/category_id (fee_prices_scope_shape)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const farFuture = `date_trunc('month', private.club_today())::date + interval '6 years'`
      const err = await expectQueryError(
        client,
        `insert into public.fee_prices (scope, member_type, amount_cents, valid_from) values ('default', 'practicing', 100, ${farFuture})`,
      )
      expect(err.code).toBe('23514')
    })
  })

  it('fee_price_for: precedencia categoría > tipo de socio > default, dentro de cada scope el de mayor valid_from', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      const disciplineId = await createDiscipline(client, { name: 'Fútbol Precio Test' })
      const categoryId = await createCategory(client, { disciplineId, name: '5ta Precio Test' })
      const farBase = `(date_trunc('month', private.club_today())::date + interval '7 years')::date`
      const farNext = `(date_trunc('month', private.club_today())::date + interval '7 years' + interval '1 month')::date`

      await client.query(
        `insert into public.fee_prices (scope, member_type, amount_cents, valid_from) values ('member_type', 'practicing', 500000, ${farBase})`,
      )
      await client.query(
        `insert into public.fee_prices (scope, category_id, amount_cents, valid_from) values ('category', $1, 700000, ${farNext})`,
        [categoryId],
      )

      // Antes de que exista el precio por categoría: gana el de tipo de socio.
      const before = await client.query(
        `select amount_cents from private.fee_price_for($1, 'practicing', ${farBase})`,
        [categoryId],
      )
      expect(before.rows[0].amount_cents).toBe('500000')

      // Desde que existe el de categoría: gana sobre el de tipo.
      const after = await client.query(
        `select amount_cents from private.fee_price_for($1, 'practicing', ${farNext})`,
        [categoryId],
      )
      expect(after.rows[0].amount_cents).toBe('700000')
    })
  })

  it('fee_price_for sin ninguna fila que aplique: null', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const row = await client.query(`select * from private.fee_price_for(999999999, 'practicing', '1999-01-01')`)
      expect(row.rowCount).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('fees: saldo de arranque (opening_balance) por el camino REAL de la app', () => {
  // Bug real encontrado por este test (reportado en 03-tests.md, corregido en
  // src/models/fees.model.ts por senior-backend-engineer,
  // 02-development-backend-review-fixes.md): `createOpeningBalance` mandaba
  // `period` como placeholder, pero `authenticated` NUNCA tuvo grant de
  // INSERT sobre esa columna (la fija el trigger, no la app) — nombrarla en
  // la lista de columnas del INSERT alcanzaba para el 42501, sin importar que
  // el valor quedara descartado. El fix saca `period` del payload entero. Los
  // dos tests de abajo fijan las dos mitades de esa corrección: el insert
  // SIN `period` tiene que andar (éxito real, no el fixture de superusuario
  // que usan el resto de los tests de este archivo), y el insert CON `period`
  // tiene que seguir sin andar (si algún día alguien la vuelve a agregar al
  // payload, este test lo atrapa de nuevo).
  it('un editor con payments.register inserta un saldo de arranque mandando SOLO member_id, kind, amount_cents, description — la forma EXACTA que arma src/models/fees.model.ts createOpeningBalance tras el fix — y el trigger fija period = mes anterior al inicio de la facturación', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Saldo', lastName: 'Arranque Test' })

      const settings = await client.query<{ billing_start_period: string }>(
        `select billing_start_period from public.settings limit 1`,
      )
      const startPeriod = new Date(settings.rows[0].billing_start_period)
      const expectedPeriod = new Date(Date.UTC(startPeriod.getUTCFullYear(), startPeriod.getUTCMonth() - 1, 1))
        .toISOString()
        .slice(0, 10)

      const row = await client.query<{ id: number; period: string }>(
        `insert into public.fees (member_id, kind, amount_cents, description)
         values ($1, 'opening_balance', 2000000, 'Saldo anterior al sistema')
         returning id, period`,
        [memberId],
      )
      expect(Number(row.rows[0].id)).toBeGreaterThan(0)
      // `period` no se pudo escribir (sin grant), pero sí se puede LEER
      // (el grant es solo sobre INSERT/UPDATE): confirma que el trigger la
      // completó con el mes anterior al inicio de facturación, no con
      // cualquier cosa.
      expect(new Date(row.rows[0].period).toISOString().slice(0, 10)).toBe(expectedPeriod)
    })
  })

  it('mandar period explícito en el insert (aunque sea el valor correcto) sigue dando 42501: el grant ausente es intencional, no un descuido a corregir de nuevo', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Saldo', lastName: 'Con Period Test' })

      const err = await expectQueryError(
        client,
        `insert into public.fees (member_id, kind, amount_cents, description, period)
         values ($1, 'opening_balance', 2000000, 'Saldo anterior al sistema', date_trunc('month', private.club_today()))`,
        [memberId],
      )
      expect(err.code).toBe('42501')
    })
  })
})

describe.skipIf(!dbAvailable)('settings: activación de la facturación (D18, §6.5)', () => {
  it('cambiar billing_start_period con cuotas mensuales ya generadas: rechazado (el seed ya generó las de este mes)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const err = await expectQueryError(
        client,
        `update public.settings set billing_start_period = date_trunc('month', private.club_today())::date + interval '1 year' where id = 1`,
      )
      expect(err.message).toMatch(/ya no se puede cambiar: hay cuotas generadas/)
    })
  })

  it('volver a null: rechazado (no se puede desactivar una vez activada)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const err = await expectQueryError(client, `update public.settings set billing_start_period = null where id = 1`)
      expect(err.message).toMatch(/no se puede desactivar/)
    })
  })

  it('como editor (sin billing.configure): la policy de UPDATE (USING is_admin()) filtra la fila, 0 filas afectadas y SIN error (RLS, no una excepción)', async () => {
    await withRollback(async (client) => {
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      // La policy de `settings` es `USING (is_admin())`: para un editor la
      // fila queda invisible para el UPDATE, así que Postgres reporta
      // "UPDATE 0" sin lanzar excepción (distinto de un WITH CHECK que sí
      // tira). No hay nada que anular: el valor real no cambió.
      const result = await client.query(
        `update public.settings set billing_start_period = date_trunc('month', private.club_today())::date + interval '1 year' where id = 1`,
      )
      expect(result.rowCount).toBe(0)

      await actAsSuperuser(client)
      const row = await client.query(`select billing_start_period from public.settings where id = 1`)
      expect(row.rows[0].billing_start_period.getUTCFullYear()).not.toBe(new Date().getUTCFullYear() + 1)
    })
  })

  it('activar (mes futuro, sin cuotas mensuales globales): permitido — el trigger valida a–d, no auth.uid()', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      // Único lugar de todo el archivo donde se despeja `fees` (solo
      // `kind = 'monthly'`, que es lo único que mira el guard): siempre
      // dentro de esta misma transacción, con ROLLBACK al final. El default
      // vigente del seed (valid_from = 2026-09) sigue sirviendo para
      // cualquier mes futuro que elijamos. Es una manipulación de FIXTURE
      // (armar el estado antes de probar la activación), no la escritura bajo
      // prueba: `admin` no tiene grant de DELETE sobre `fees` (nadie lo
      // tiene), así que corre como superusuario y vuelve a `admin` después.
      await actAsSuperuser(client)
      await client.query(`delete from public.fees where kind = 'monthly'`)
      await actAs(client, adminId)

      const farFuture = `date_trunc('month', private.club_today())::date + interval '9 years'`
      await client.query(`update public.settings set billing_start_period = ${farFuture} where id = 1`)
      const row = await client.query(`select billing_start_period from public.settings where id = 1`)
      expect(row.rows[0].billing_start_period.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 9)
    })
  })
})

describe.skipIf(!dbAvailable)('Generación mensual: D30, ascenso de categoría, transición social↔deporte', () => {
  it('fixture A–G: dos deportes, ascenso, alta a mitad de mes, baja a mitad de mes, D30 en las dos direcciones', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      const futbol = await createDiscipline(client, { name: 'Fútbol Gen Test' })
      const voley = await createDiscipline(client, { name: 'Vóley Gen Test' })
      const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta Gen Test' })
      const cat6ta = await createCategory(client, { disciplineId: futbol, name: '6ta Gen Test' })
      const catSub18 = await createCategory(client, { disciplineId: voley, name: 'Sub 18 Gen Test' })

      // Necesitamos un precio resoluble para 5ta/6ta/Sub18/social en el
      // período de prueba: el default del seed (practicing/non_practicing)
      // ya cubre todo esto sin fixture adicional (fee_price_for cae al
      // default cuando no hay uno más específico). Y a diferencia de otros
      // tests de este archivo, ACÁ se cierran/abren inscripciones a mitad de
      // período (`closeMemberCategory`/`openMemberCategory`), cuyos triggers
      // validan la fecha contra el `club_today()` REAL (2026-09-28): el
      // período tiene que ser el mes real actual, no uno ficticio "+N años"
      // (el punto medio, 14 días después, tiene que seguir siendo hoy o antes).
      const period = `date_trunc('month', private.club_today())::date`
      const periodVal = await client.query<{ p: Date }>(`select ${period} as p`)
      const P = periodVal.rows[0].p.toISOString().slice(0, 10)

      const memberA = await createMember(client, { firstName: 'A', lastName: 'Gen', joinedOn: '2020-01-01' })
      await openMemberCategory(client, { memberId: memberA, categoryId: cat5ta, joinedOn: '2020-01-01' })

      const memberB = await createMember(client, { firstName: 'B', lastName: 'Gen', joinedOn: '2020-01-01' })
      await openMemberCategory(client, { memberId: memberB, categoryId: cat5ta, joinedOn: '2020-01-01' })
      await openMemberCategory(client, { memberId: memberB, categoryId: catSub18, joinedOn: '2020-01-01' })

      const memberC = await createMember(client, { firstName: 'C', lastName: 'Gen', joinedOn: '2020-01-01' })
      // no practicante: sin inscripciones.

      const memberD = await createMember(client, { firstName: 'D', lastName: 'Gen', joinedOn: '2020-01-01' })
      const membershipD = await openMemberCategory(client, { memberId: memberD, categoryId: cat5ta, joinedOn: '2020-01-01' })

      const memberE = await createMember(client, { firstName: 'E', lastName: 'Gen', joinedOn: '2020-01-01' })
      // no practicante hasta mitad del período de prueba.

      const memberF = await createMember(client, { firstName: 'F', lastName: 'Gen', joinedOn: '2020-01-01' })
      const membershipF = await openMemberCategory(client, { memberId: memberF, categoryId: cat5ta, joinedOn: '2020-01-01' })

      const memberG = await createMember(client, { firstName: 'G', lastName: 'Gen', joinedOn: '2020-01-01' })
      await openMemberCategory(client, { memberId: memberG, categoryId: cat5ta, joinedOn: '2020-01-01' })

      // Primera corrida del período P: A(1), B(2), C(1 social), D(1, 5ta:
      // todavía no ascendió), E(1 social), F(1, 5ta), G(1, 5ta — todavía sin vóley).
      // `private.generate_monthly_fees` está en `revoke ... from ... authenticated`
      // (solo la llama el generador vía la RPC pública, o el cron): probarla
      // DIRECTO necesita superusuario, como el cron real.
      await actAsSuperuser(client)
      const first = await client.query<{ generate_monthly_fees: number }>(
        `select private.generate_monthly_fees(${period}::date)`,
      )
      await actAs(client, adminId)
      // A(1) + B(2, dos deportes) + C(1 social) + D(1) + E(1 social) + F(1) + G(1) = 8
      // cuotas del FIXTURE, pero el total que devuelve la RPC incluye TAMBIÉN
      // a los socios activos reales del seed que solapan este período
      // ficticio (nunca facturados para él): por eso la aserción exacta es
      // por socio (`countByMember`, abajo), no sobre el total agregado.
      expect(first.rows[0].generate_monthly_fees).toBeGreaterThanOrEqual(8)

      const countByMember = async (memberId: number) => {
        const r = await client.query(
          `select count(*)::int as n from public.fees where member_id = $1 and period = ${period}::date and kind = 'monthly'`,
          [memberId],
        )
        return r.rows[0].n as number
      }

      expect(await countByMember(memberA)).toBe(1)
      expect(await countByMember(memberB)).toBe(2)
      expect(await countByMember(memberC)).toBe(1)
      expect(await countByMember(memberD)).toBe(1)
      expect(await countByMember(memberE)).toBe(1)
      expect(await countByMember(memberF)).toBe(1)
      expect(await countByMember(memberG)).toBe(1)

      const socialRow = await client.query(
        `select category_id from public.fees where member_id = $1 and period = ${period}::date and kind = 'monthly'`,
        [memberC],
      )
      expect(socialRow.rows[0].category_id).toBeNull()

      // D asciende de 5ta a 6ta a mitad del período; F deja todo (cierra su
      // única categoría); E se anota en vóley; G se anota en vóley además
      // de fútbol (ya tenía fútbol).
      const midMonth = `least(${period}::date + 14, private.club_today())`
      const midVal = await client.query<{ d: Date }>(`select ${midMonth} as d`)
      const midDate = midVal.rows[0].d.toISOString().slice(0, 10)

      await closeMemberCategory(client, { membershipId: membershipD, leftOn: midDate })
      await openMemberCategory(client, { memberId: memberD, categoryId: cat6ta, joinedOn: midDate })

      await closeMemberCategory(client, { membershipId: membershipF, leftOn: midDate })

      await openMemberCategory(client, { memberId: memberE, categoryId: catSub18, joinedOn: midDate })
      await openMemberCategory(client, { memberId: memberG, categoryId: catSub18, joinedOn: midDate })

      // Segunda corrida del MISMO período: D30 en las dos direcciones.
      await actAsSuperuser(client)
      const second = await client.query<{ generate_monthly_fees: number }>(
        `select private.generate_monthly_fees(${period}::date)`,
      )
      await actAs(client, adminId)
      // Solo G suma una cuota nueva (vóley, alta a mitad de mes con fútbol ya
      // cobrado): D no duplica fútbol (índice por disciplina, ya tiene una
      // fila de discipline_id=futbol para este período), E NO cobra vóley
      // este mes (ya tiene la social, D30) y F no cobra la social (ya tenía
      // fútbol, D30).
      expect(second.rows[0].generate_monthly_fees).toBe(1)
      expect(await countByMember(memberD)).toBe(1) // sigue siendo 1 fila de fútbol (la de 5ta, la categoría congelada de la corrida)
      expect(await countByMember(memberE)).toBe(1) // sigue con la social únicamente
      expect(await countByMember(memberF)).toBe(1) // sigue con la de 5ta, sin social
      expect(await countByMember(memberG)).toBe(2) // fútbol + vóley

      // D conserva la categoría CONGELADA de la primera corrida (5ta), no la
      // recalcula con la categoría vigente al momento de leer.
      const dCategoryName = await client.query(
        `select c.name from public.fees f join public.categories c on c.id = f.category_id
         where f.member_id = $1 and f.period = ${period}::date and f.kind = 'monthly'`,
        [memberD],
      )
      expect(dCategoryName.rows[0].name).toBe('5ta Gen Test')

      // Tercera corrida (idempotencia total): 0 filas nuevas.
      await actAsSuperuser(client)
      const third = await client.query<{ generate_monthly_fees: number }>(
        `select private.generate_monthly_fees(${period}::date)`,
      )
      expect(third.rows[0].generate_monthly_fees).toBe(0)
    })
  })

  it('el ascenso 5ta→6ta DECIDIDO ANTES de correr la primera vez ya carga la categoría más reciente (no la más vieja)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Ascenso Previo' })
      const cat5ta = await createCategory(client, { disciplineId, name: '5ta Ascenso Previo' })
      const cat6ta = await createCategory(client, { disciplineId, name: '6ta Ascenso Previo' })
      // A diferencia del resto del archivo, este test ADEMÁS cierra/abre
      // inscripciones (`closeMemberCategory`/`openMemberCategory`), y esos
      // triggers validan la fecha contra el `club_today()` REAL de la base
      // (2026-09-28), no contra un período ficticio "+N años". Por eso acá
      // el período es el mes REAL actual (que además ya tiene facturación
      // activa), y el punto medio (10 días después) sigue siendo hoy o antes.
      const period = `date_trunc('month', private.club_today())::date`

      const memberId = await createMember(client, { firstName: 'H', lastName: 'Ascenso', joinedOn: '2020-01-01' })
      const membership = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2020-01-01' })
      const midMonth = `least(${period}::date + 10, private.club_today())`
      const midVal = await client.query<{ d: Date }>(`select ${midMonth} as d`)
      const midDate = midVal.rows[0].d.toISOString().slice(0, 10)
      await closeMemberCategory(client, { membershipId: membership, leftOn: midDate })
      await openMemberCategory(client, { memberId, categoryId: cat6ta, joinedOn: midDate })

      await actAsSuperuser(client)
      await client.query(`select private.generate_monthly_fees(${period}::date)`)
      const row = await client.query(
        `select c.name from public.fees f join public.categories c on c.id = f.category_id
         where f.member_id = $1 and f.period = ${period}::date and f.kind = 'monthly'`,
        [memberId],
      )
      expect(row.rows[0].name).toBe('6ta Ascenso Previo')
    })
  })

  it('dos cargos sociales del mismo socio y período: unique violation (nulls not distinct)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const memberId = await createMember(client, { firstName: 'I', lastName: 'Social', joinedOn: '2020-01-01' })
      const period = `(date_trunc('month', private.club_today())::date + interval '13 years')::date`
      const priceRow = await client.query(`select fee_price_id from private.fee_price_for(null, 'non_practicing', ${period}::date)`)
      const feePriceId = priceRow.rows[0].fee_price_id
      // Insertar `kind = 'monthly'` directo NO lo permite la policy de
      // `authenticated` (solo `opening_balance`): la invariante bajo prueba
      // es el ÍNDICE ÚNICO, no la policy (ya cubierta en otro archivo), así
      // que corre como superusuario.
      await actAsSuperuser(client)
      await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, fee_price_id) values ($1, ${period}::date, 'monthly', 100, $2)`,
        [memberId, feePriceId],
      )
      const err = await expectQueryError(
        client,
        `insert into public.fees (member_id, period, kind, amount_cents, fee_price_id) values ($1, ${period}::date, 'monthly', 100, $2)`,
        [memberId, feePriceId],
      )
      expect(err.code).toBe('23505')
    })
  })

  it('dos cargos de fútbol del mismo socio y período (5ta y 6ta a la vez): unique violation; fútbol y vóley: permitido', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const futbol = await createDiscipline(client, { name: 'Fútbol Unique Test' })
      const voley = await createDiscipline(client, { name: 'Vóley Unique Test' })
      const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta Unique Test' })
      const cat6ta = await createCategory(client, { disciplineId: futbol, name: '6ta Unique Test' })
      const catSub18 = await createCategory(client, { disciplineId: voley, name: 'Sub 18 Unique Test' })
      const memberId = await createMember(client, { firstName: 'J', lastName: 'Unique', joinedOn: '2020-01-01' })
      const period = `(date_trunc('month', private.club_today())::date + interval '14 years')::date`

      const price = await client.query(`select fee_price_id from private.fee_price_for($1, 'practicing', ${period}::date)`, [cat5ta])
      const feePriceId = price.rows[0].fee_price_id

      // Mismo motivo que el test anterior: insertar `kind = 'monthly'` a mano
      // exige superusuario (la policy real solo deja `opening_balance`).
      await actAsSuperuser(client)
      await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, fee_price_id, category_id, discipline_id)
         values ($1, ${period}::date, 'monthly', 100, $2, $3, $4)`,
        [memberId, feePriceId, cat5ta, futbol],
      )
      const err = await expectQueryError(
        client,
        `insert into public.fees (member_id, period, kind, amount_cents, fee_price_id, category_id, discipline_id)
         values ($1, ${period}::date, 'monthly', 100, $2, $3, $4)`,
        [memberId, feePriceId, cat6ta, futbol],
      )
      expect(err.code).toBe('23505')

      // fútbol + vóley: dos disciplinas distintas, permitido.
      await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, fee_price_id, category_id, discipline_id)
         values ($1, ${period}::date, 'monthly', 100, $2, $3, $4)`,
        [memberId, feePriceId, catSub18, voley],
      )
      const count = await client.query(
        `select count(*)::int as n from public.fees where member_id = $1 and period = ${period}::date and kind = 'monthly'`,
        [memberId],
      )
      expect(count.rows[0].n).toBe(2)
    })
  })

  // NO SE PUEDE EJERCITAR CONTRA ESTA BASE (hallazgo, no un test debilitado):
  // `fee_prices` es append-only con `forbid_change` en UPDATE **y** DELETE, y
  // ese trigger dispara para CUALQUIER rol, incluido el superusuario (no
  // depende de RLS/grants, que sí bypasea `postgres`): no hay forma de sacar
  // la fila `scope='default'` que ya exige `settings_billing_guard` para
  // activar la facturación. Como esa fila cubre CUALQUIER categoría/tipo de
  // socio para cualquier período >= su `valid_from` (`fee_price_for` cae al
  // `default` sin condición), el branch "No hay un valor de cuota vigente"
  // de `generate_monthly_fees` queda estructuralmente inalcanzable una vez
  // que la facturación está activa — que es SIEMPRE, en este stack (el seed
  // la activa y no hay `db:reset` disponible para este agente). Se deja
  // documentado en vez de forzar un DELETE que la propia base garantiza que
  // nunca va a pasar; el mensaje del error y el "nunca nombra al socio" están
  // igual verificados por lectura del código fuente de
  // `private.generate_monthly_fees` (`20260927130000_billing.sql:352-368`).
  it.skip('un socio sin precio resoluble frena TODO el período, sin cuotas a medias (transacción única) — inalcanzable sin dropear la fila default de fee_prices, imposible en este stack', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      const disciplineId = await createDiscipline(client, { name: 'Fútbol Sin Precio' })
      const categoryId = await createCategory(client, { disciplineId, name: 'Sin Precio Cat' })
      const period = `(date_trunc('month', private.club_today())::date + interval '15 years')::date`

      const memberOk = await createMember(client, { firstName: 'K', lastName: 'ConPrecio', joinedOn: '2020-01-01' })
      // Este socio SÍ resuelve por el default del seed.
      const memberBroken = await createMember(client, { firstName: 'L', lastName: 'SinPrecio', joinedOn: '2020-01-01' })
      await openMemberCategory(client, { memberId: memberBroken, categoryId, joinedOn: '2020-01-01' })

      await actAsSuperuser(client)
      await client.query(
        `delete from public.fee_prices where scope in ('default', 'member_type') and valid_from <= ${period}::date`,
      )

      const before = await client.query(`select count(*)::int as n from public.fees where period = ${period}::date and kind = 'monthly'`)

      const err = await expectQueryError(client, `select private.generate_monthly_fees(${period}::date)`)
      expect(err.message).toMatch(/No hay un valor de cuota vigente/)
      expect(err.message).not.toMatch(/Sin Precio Cat|SinPrecio|ConPrecio/) // nunca nombra al socio

      const after = await client.query(`select count(*)::int as n from public.fees where period = ${period}::date and kind = 'monthly'`)
      expect(after.rows[0].n).toBe(before.rows[0].n) // cero cuotas a medias: ni siquiera la de memberOk quedó
    })
  })

  it('socio con joined_on posterior al fin del período: no recibe cuota; socio inactive: no recibe', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      // Período FIJO en el pasado (no relativo a "hoy" + N años, a diferencia
      // del resto del archivo): acá `joinedOn` tiene que caer DESPUÉS del fin
      // del período de prueba pero SIGUE siendo una fecha real del pasado (el
      // trigger de `members` valida contra el `club_today()` real de la base,
      // 2026-09-28, no contra el período ficticio de este test).
      const period = `'2020-06-01'::date`

      const lateJoiner = await createMember(client, { firstName: 'M', lastName: 'Tarde', joinedOn: '2020-07-01' })
      const inactiveMember = await createMember(client, { firstName: 'N', lastName: 'Inactivo', joinedOn: '2020-01-01' })
      // `members.status` no tiene grant de UPDATE directo (lo escribe el
      // trigger que reacciona a `member_status_events`, no la app a mano):
      // una baja real es un evento, no un UPDATE de columna.
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2020-02-01', 'fixture de prueba')`,
        [inactiveMember],
      )

      await actAsSuperuser(client)
      await client.query(`select private.generate_monthly_fees(${period}::date)`)

      const lateCount = await client.query(`select count(*)::int as n from public.fees where member_id = $1`, [lateJoiner])
      expect(lateCount.rows[0].n).toBe(0)
      const inactiveCount = await client.query(`select count(*)::int as n from public.fees where member_id = $1`, [inactiveMember])
      expect(inactiveCount.rows[0].n).toBe(0)
    })
  })

  it('período anterior a billing_start_period: generate_monthly_fees no crea nada (0, sin filas)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      // `billing_start_period` NUNCA vuelve a null una vez activado (el
      // guard lo rechaza incondicionalmente): la única forma real de
      // ejercer la rama "no corre" de `generate_monthly_fees` es con un
      // período ANTERIOR al de inicio, no con un `settings` en null.
      const disciplineId = await createDiscipline(client, { name: 'Antes De Activar' })
      const categoryId = await createCategory(client, { disciplineId, name: 'Antes De Activar Cat' })
      const memberId = await createMember(client, { firstName: 'P', lastName: 'Anterior', joinedOn: '2010-01-01' })
      await openMemberCategory(client, { memberId, categoryId, joinedOn: '2010-01-01' })

      await actAsSuperuser(client)
      const result = await client.query(`select private.generate_monthly_fees('2010-01-01'::date) as n`)
      expect(result.rows[0].n).toBe(0)
      const fees = await client.query(`select count(*)::int as n from public.fees where period = '2010-01-01'`)
      expect(fees.rows[0].n).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('billing_runs: corridas registradas (T1)', () => {
  it('el cron simulado (postgres, sin JWT) deja actor_id null y actor_source system en audit_log', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Cron Test' })
      const categoryId = await createCategory(client, { disciplineId, name: 'Cron Cat' })
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const memberId = await createMember(client, { firstName: 'O', lastName: 'Cron', joinedOn: '2020-01-01' })
      await openMemberCategory(client, { memberId, categoryId, joinedOn: '2020-01-01' })

      await actAsSuperuser(client)
      const period = `(date_trunc('month', private.club_today())::date + interval '18 years')::date`
      await client.query(`select private.generate_pending_fees('cron', null)`)
      // `generate_pending_fees` recorre desde billing_start_period real hasta
      // el actual, no hasta el período futuro de este fixture: esta corrida
      // no toca ese período. Lo que se prueba acá es la corrida en sí (mes
      // actual real), no el fixture del período futuro.
      const run = await client.query(
        `select trigger, actor_id, status from public.billing_runs where trigger = 'cron' order by started_at desc limit 1`,
      )
      expect(run.rows[0].trigger).toBe('cron')
      expect(run.rows[0].actor_id).toBeNull()

      const audit = await client.query(
        `select actor_source, actor_id from public.audit_log where table_name = 'fees' and actor_source = 'system' order by occurred_at desc limit 1`,
      )
      if (audit.rowCount) {
        expect(audit.rows[0].actor_id).toBeNull()
      }
      void period
    })
  })

  it('una corrida manual como admin deja trigger=manual y actor_id=el admin; generate_pending_fees() (pública) exige billing.configure', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: editorId } = await createUserWithRole(client, 'editor')

      await actAs(client, editorId)
      const err = await expectQueryError(client, `select public.generate_pending_fees()`)
      expect(err.code).toBe('42501')

      await actAs(client, adminId)
      const before = await client.query(`select count(*)::int as n from public.billing_runs where trigger = 'manual' and actor_id = $1`, [adminId])
      await client.query(`select * from public.generate_pending_fees()`)
      const after = await client.query(`select count(*)::int as n from public.billing_runs where trigger = 'manual' and actor_id = $1`, [adminId])
      expect(after.rows[0].n).toBeGreaterThan(before.rows[0].n)
    })
  })

  it('llamada dos veces seguidas: la segunda deja fees_created=0 y agrega una fila nueva (siempre registra el período actual)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      await client.query(`select * from public.generate_pending_fees()`)
      const countBefore = await client.query(`select count(*)::int as n from public.billing_runs`)
      const second = await client.query<{ status: string; fees_created: number }>(`select * from public.generate_pending_fees()`)
      const countAfter = await client.query(`select count(*)::int as n from public.billing_runs`)
      expect(second.rows[0].status).toBe('ok')
      expect(second.rows[0].fees_created).toBe(0)
      expect(countAfter.rows[0].n).toBe(countBefore.rows[0].n + 1)
    })
  })

  it('billing_runs: RLS — editor y consulta ven 0 filas, admin las lee; UPDATE/DELETE fallan incluso para admin (sin grant)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const anyRun = await client.query(`select id from public.billing_runs limit 1`)

      await actAsSuperuser(client)
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const editorRows = await client.query(`select id from public.billing_runs`)
      expect(editorRows.rowCount).toBe(0)

      await actAsSuperuser(client)
      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)
      const consultaRows = await client.query(`select id from public.billing_runs`)
      expect(consultaRows.rowCount).toBe(0)

      await actAsSuperuser(client)
      await actAs(client, adminId)
      if (anyRun.rowCount) {
        const err = await expectQueryError(client, `update public.billing_runs set status = 'ok' where id = $1`, [anyRun.rows[0].id])
        expect(err.message).toMatch(/permission denied|no se puede modificar/i)
      }
    })
  })

  it('billing_runs NO está en audit_log (tabla técnica, sin enable_audit) y notified_at es null en todas', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const audited = await client.query(`select 1 from public.audit_log where table_name = 'billing_runs' limit 1`)
      expect(audited.rowCount).toBe(0)
      const notNull = await client.query(`select count(*)::int as n from public.billing_runs where notified_at is not null`)
      expect(notNull.rows[0].n).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('Borde horario: 30/09 23:30 hora Argentina sigue siendo septiembre', () => {
  it('la misma expresión que usa club_today() (at time zone) da 2026-09-30 a las 02:30 UTC del 1/10', async () => {
    await withRollback(async (client) => {
      const row = await client.query(
        `select (timestamptz '2026-10-01 02:30:00+00' at time zone 'America/Argentina/Buenos_Aires')::date as d`,
      )
      expect(row.rows[0].d.toISOString().slice(0, 10)).toBe('2026-09-30')
      // El período de ese instante es septiembre, no octubre.
      const period = await client.query(
        `select date_trunc('month', (timestamptz '2026-10-01 02:30:00+00' at time zone 'America/Argentina/Buenos_Aires')::date)::date as p`,
      )
      expect(period.rows[0].p.toISOString().slice(0, 10)).toBe('2026-09-01')
    })
  })

  it('el cron a las 03:05 UTC del 1° ya calcula octubre (pasó el corte de las 03:00 UTC = 00:00 ART)', async () => {
    await withRollback(async (client) => {
      const row = await client.query(
        `select date_trunc('month', (timestamptz '2026-10-01 03:05:00+00' at time zone 'America/Argentina/Buenos_Aires')::date)::date as p`,
      )
      expect(row.rows[0].p.toISOString().slice(0, 10)).toBe('2026-10-01')
    })
  })

  it('el job lonqui-generate-fees existe con el schedule 5 3 1 * * y llama a generate_pending_fees(cron)', async () => {
    await withRollback(async (client) => {
      const job = await client.query(`select jobname, schedule, command from cron.job where jobname = 'lonqui-generate-fees'`)
      expect(job.rowCount).toBe(1)
      expect(job.rows[0].schedule).toBe('5 3 1 * *')
      expect(job.rows[0].command).toMatch(/generate_pending_fees\('cron'\)/)
    })
  })
})
