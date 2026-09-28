import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  actAs,
  actAsSuperuser,
  allPublicTables,
  createAuthUser,
  createUserWithRole,
  expectQueryError,
  hasGrant,
  isDbAvailable,
  withRollback,
} from './helpers'

/**
 * S1 (`00-architecture.md` §6.5, `01-tasks.md`): la matriz de privilegios que
 * decide qué puede tocar cada rol desde el browser, DIRECTO contra
 * PostgREST (acá simulado con `set local role` + `request.jwt.claims`, que es
 * exactamente lo que PostgREST deja seteado). Esto no se puede probar con
 * mocks: la defensa real es la base, no el TypeScript de arriba.
 *
 * `dbAvailable` se resuelve con top-level await ANTES de que vitest arme el
 * árbol de tests: `describe.skipIf` necesita el valor ya listo en el momento
 * de la colección, no en un `beforeAll` (que corre después).
 */
const dbAvailable = await isDbAvailable()
if (!dbAvailable) {
  console.warn('[tests/db] Postgres local no responde: se saltean los tests de tests/db/.')
}

describe.skipIf(!dbAvailable)('Nada se borra: sin grant de DELETE para authenticated', () => {
  it('ninguna tabla de public otorga DELETE a authenticated', async () => {
    await withRollback(async (client) => {
      const tables = await allPublicTables(client)
      expect(tables.length).toBeGreaterThan(0)

      for (const table of tables) {
        const deletable = await hasGrant(client, 'authenticated', table, 'DELETE')
        expect(deletable, `la tabla "${table}" NO debería otorgar DELETE a authenticated`).toBe(false)
      }
    })
  })

  it('tampoco service_role tiene DELETE sobre audit_log', async () => {
    await withRollback(async (client) => {
      expect(await hasGrant(client, 'service_role', 'audit_log', 'DELETE')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'audit_log', 'UPDATE')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'audit_log', 'INSERT')).toBe(false)
    })
  })
})

describe.skipIf(!dbAvailable)('audit_log: append-only incluso para el dueño', () => {
  it('un UPDATE sobre audit_log falla como authenticated (sin grant, ni siquiera llega al trigger)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      await expect(client.query(`update public.audit_log set op = 'UPDATE' where id = 1`)).rejects.toThrow(
        /permission denied/i,
      )
    })
  })

  it('un UPDATE sobre audit_log falla como service_role (sin grant tampoco)', async () => {
    await withRollback(async (client) => {
      await client.query('set local role service_role')
      await expect(client.query(`update public.audit_log set op = 'UPDATE' where id = 1`)).rejects.toThrow(
        /permission denied/i,
      )
    })
  })

  it('un UPDATE sobre audit_log falla incluso como postgres (dueño de la tabla): lo frena el trigger, no el grant', async () => {
    await withRollback(async (client) => {
      // Ya somos postgres por defecto en withRollback. Insertamos una fila
      // real (vía el trigger de app_users) para tener un id que intentar tocar.
      const { userId } = await createUserWithRole(client, 'admin')
      const row = await client.query<{ id: number }>(
        `select id from public.audit_log where table_name = 'app_users' and record_id = $1 order by id desc limit 1`,
        [userId],
      )
      expect(row.rowCount).toBeGreaterThan(0)

      const updateErr = await expectQueryError(client, `update public.audit_log set op = 'UPDATE' where id = $1`, [
        row.rows[0].id,
      ])
      expect(updateErr.message).toMatch(/no se puede modificar/i)

      const deleteErr = await expectQueryError(client, `delete from public.audit_log where id = $1`, [
        row.rows[0].id,
      ])
      expect(deleteErr.message).toMatch(/no se puede modificar/i)
    })
  })

  it('la auditoría no se puede saltear: un INSERT en app_users por un admin deja una fila con su actor_id', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      const newUserId = randomUUID()
      await actAsSuperuser(client)
      await createAuthUser(client, { id: newUserId, email: `nuevo-${newUserId.slice(0, 8)}@lonqui.test` })

      await actAs(client, adminId)
      await client.query(
        `insert into public.app_users (user_id, email, display_name, role, created_by)
         values ($1, $2, 'Nuevo Editor', 'editor', $3)`,
        [newUserId, `nuevo-${newUserId.slice(0, 8)}@lonqui.test`, adminId],
      )

      await actAsSuperuser(client)
      const audit = await client.query(
        `select actor_id, op, new_data from public.audit_log where table_name = 'app_users' and record_id = $1`,
        [newUserId],
      )
      expect(audit.rowCount).toBe(1)
      expect(audit.rows[0].actor_id).toBe(adminId)
      expect(audit.rows[0].op).toBe('INSERT')
      expect(audit.rows[0].new_data.role).toBe('editor')
    })
  })

  it('un UPDATE que no cambia nada no genera fila de auditoría', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: targetId } = await createUserWithRole(client, 'editor', { displayName: 'Sin Cambios' })

      const before = await client.query(`select count(*) from public.audit_log where record_id = $1`, [targetId])

      await actAs(client, adminId)
      // UPDATE con exactamente el mismo valor que ya tenía.
      await client.query(`update public.app_users set display_name = 'Sin Cambios' where user_id = $1`, [targetId])

      await actAsSuperuser(client)
      const after = await client.query(`select count(*) from public.audit_log where record_id = $1`, [targetId])
      expect(after.rows[0].count).toBe(before.rows[0].count)
    })
  })

  it('un UPDATE que sí cambia display_name genera una fila con changed_fields = {display_name}', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: targetId } = await createUserWithRole(client, 'editor', { displayName: 'Nombre Viejo' })

      await actAs(client, adminId)
      await client.query(`update public.app_users set display_name = 'Nombre Nuevo' where user_id = $1`, [targetId])

      await actAsSuperuser(client)
      const audit = await client.query(
        `select changed_fields, actor_id from public.audit_log
         where record_id = $1 and op = 'UPDATE' order by id desc limit 1`,
        [targetId],
      )
      expect(audit.rows[0].changed_fields).toEqual(['display_name'])
      expect(audit.rows[0].actor_id).toBe(adminId)
    })
  })

  it('audit_log nunca contiene el marker de private.password_markers (tabla separada, sin auditar)', async () => {
    await withRollback(async (client) => {
      const auditedTables = await client.query<{ table_name: string }>(
        `select distinct table_name from public.audit_log`,
      )
      expect(auditedTables.rows.map((r) => r.table_name)).not.toContain('password_markers')
    })
  })

  it('no hay filas de login/logout en audit_log (T8: Auth ya tiene su propio audit_log_entries)', async () => {
    await withRollback(async (client) => {
      const result = await client.query(
        `select 1 from public.audit_log where table_name in ('auth.users', 'sessions', 'auth_sessions') limit 1`,
      )
      expect(result.rowCount).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('current_app_role(): cierre total', () => {
  it('un usuario de Auth sin fila en app_users tiene rol null y ve 0 filas en todo el dominio', async () => {
    await withRollback(async (client) => {
      const userId = randomUUID()
      await createAuthUser(client, { id: userId, email: `huerfano-${userId.slice(0, 8)}@lonqui.test` })
      await actAs(client, userId)

      const role = await client.query('select private.current_app_role() as role')
      expect(role.rows[0].role).toBeNull()

      for (const table of ['members', 'disciplines', 'categories', 'family_groups', 'settings', 'audit_log']) {
        const rows = await client.query(`select count(*) from public.${table}`)
        expect(Number(rows.rows[0].count), `${table} debería dar 0 filas`).toBe(0)
      }
    })
  })

  it('un rol puesto en user_metadata NO otorga nada (el rol vive solo en app_users)', async () => {
    await withRollback(async (client) => {
      const userId = randomUUID()
      await createAuthUser(client, { id: userId, email: `spoof-${userId.slice(0, 8)}@lonqui.test` })
      // Sin fila en app_users, pero con un claim de user_metadata que dice admin.
      await client.query('set local role authenticated')
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({
          sub: userId,
          role: 'authenticated',
          aud: 'authenticated',
          user_metadata: { role: 'admin' },
        }),
      ])

      const role = await client.query('select private.current_app_role() as role')
      expect(role.rows[0].role).toBeNull()

      const membersVisible = await client.query('select count(*) from public.members')
      expect(Number(membersVisible.rows[0].count)).toBe(0)
    })
  })

  it('con must_change_password=true, el admin no lee members ni audit_log, pero sí su propia fila de app_users', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin', { mustChangePassword: true })
      await actAs(client, userId)

      const own = await client.query('select must_change_password from public.app_users where user_id = $1', [userId])
      expect(own.rowCount).toBe(1)
      expect(own.rows[0].must_change_password).toBe(true)

      const members = await client.query('select count(*) from public.members')
      expect(Number(members.rows[0].count)).toBe(0)

      const audit = await client.query('select count(*) from public.audit_log')
      expect(Number(audit.rows[0].count)).toBe(0)
    })
  })

  it('con must_change_password=true, UPDATE app_users set must_change_password falla con permission denied (sin grant, ni para uno mismo)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin', { mustChangePassword: true })
      await actAs(client, userId)

      await expect(
        client.query('update public.app_users set must_change_password = false where user_id = $1', [userId]),
      ).rejects.toThrow(/permission denied/i)
    })
  })

  it('un usuario desactivado (is_active=false) tampoco tiene rol efectivo', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor', { isActive: false })
      await actAs(client, userId)
      const role = await client.query('select private.current_app_role() as role')
      expect(role.rows[0].role).toBeNull()
    })
  })
})

describe.skipIf(!dbAvailable)('Anti-lockout de admins', () => {
  it('un admin no puede cambiar su propio rol', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      await expect(
        client.query(`update public.app_users set role = 'editor' where user_id = $1`, [userId]),
      ).rejects.toThrow(/no podés cambiar tu propio rol/i)
    })
  })

  it('un admin no puede desactivarse a sí mismo', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      await expect(
        client.query(`update public.app_users set is_active = false where user_id = $1`, [userId]),
      ).rejects.toThrow(/no podés cambiar tu propio rol ni desactivar/i)
    })
  })

  it('degradar al ÚLTIMO admin activo de toda la base falla', async () => {
    await withRollback(async (client) => {
      // Para aislar "el último admin" de verdad, hay que dejar exactamente
      // UNO activo en toda la tabla (el seed/bootstrap puede traer varios).
      // Cada desactivación es una sentencia SEPARADA (no un UPDATE masivo):
      // el guard corre por fila con una sub-select que lee el estado ya
      // confirmado de sentencias anteriores DE LA MISMA transacción, así que
      // desactivar de a una, dejando siempre otra activa hasta el final,
      // nunca dispara el bloqueo antes de tiempo.
      const { userId: lastAdmin } = await createUserWithRole(client, 'admin')
      const existing = await client.query<{ user_id: string }>(
        `select user_id from public.app_users where role = 'admin' and is_active and user_id <> $1`,
        [lastAdmin],
      )
      for (const row of existing.rows) {
        await client.query(`update public.app_users set is_active = false where user_id = $1`, [row.user_id])
      }

      const activeAdmins = await client.query(`select count(*) from public.app_users where role = 'admin' and is_active`)
      expect(activeAdmins.rows[0].count).toBe('1')

      // Como postgres (superusuario): bypassea RLS, pero el trigger de guard
      // corre igual (no depende de privilegios, solo de auth.uid()/los datos).
      // auth.uid() es null acá (sin jwt.claims), así que el chequeo de
      // "no te cambies tu propio rol" no aplica y llegamos al chequeo real.
      const err = await expectQueryError(
        client,
        `update public.app_users set role = 'editor' where user_id = $1`,
        [lastAdmin],
      )
      expect(err.message).toMatch(/al menos un administrador activo/i)
    })
  })

  it('con dos admins activos, degradar a uno de los dos SÍ funciona (el otro sigue siendo admin)', async () => {
    await withRollback(async (client) => {
      const { userId: adminA } = await createUserWithRole(client, 'admin')
      const { userId: adminB } = await createUserWithRole(client, 'admin')

      await actAs(client, adminA)
      await client.query(`update public.app_users set role = 'editor' where user_id = $1`, [adminB])

      const check = await client.query('select role from public.app_users where user_id = $1', [adminB])
      expect(check.rows[0].role).toBe('editor')
    })
  })
})

describe.skipIf(!dbAvailable)('mark_password_reset / confirm_password_changed', () => {
  it('mark_password_reset como editor (no admin, no service_role) falla', async () => {
    await withRollback(async (client) => {
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      const { userId: targetId } = await createUserWithRole(client, 'consulta')

      await actAs(client, editorId)
      await expect(client.query('select public.mark_password_reset($1)', [targetId])).rejects.toThrow(
        /no tenés permiso/i,
      )
    })
  })

  it('mark_password_reset como admin: prende el flag y guarda el marker', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: targetId } = await createUserWithRole(client, 'editor', { mustChangePassword: false })

      await actAs(client, adminId)
      await client.query('select public.mark_password_reset($1)', [targetId])

      await actAsSuperuser(client)
      const row = await client.query('select must_change_password from public.app_users where user_id = $1', [
        targetId,
      ])
      expect(row.rows[0].must_change_password).toBe(true)

      const marker = await client.query('select * from private.password_markers where user_id = $1', [targetId])
      expect(marker.rowCount).toBe(1)
    })
  })

  it('mark_password_reset como service_role (bootstrap) está permitido', async () => {
    await withRollback(async (client) => {
      const { userId: targetId } = await createUserWithRole(client, 'admin', { mustChangePassword: false })

      await client.query('set local role service_role')
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ role: 'service_role' }),
      ])
      await client.query('select public.mark_password_reset($1)', [targetId])

      await actAsSuperuser(client)
      const row = await client.query('select must_change_password from public.app_users where user_id = $1', [
        targetId,
      ])
      expect(row.rows[0].must_change_password).toBe(true)
    })
  })

  it('REGRESIÓN blocker 2: resetear una contraseña YA prendida deja auditoría igual (password_reset_at siempre cambia)', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      // Nace con el flag YA prendido (usuario que nunca entró, o un segundo reseteo).
      const { userId: targetId } = await createUserWithRole(client, 'editor', { mustChangePassword: true })

      await actAs(client, adminId)
      await client.query('select public.mark_password_reset($1)', [targetId])

      await actAsSuperuser(client)
      // Antes de este fix, un UPDATE que no cambia must_change_password (ya
      // estaba en true) no generaba fila: un admin podía "resetear" sin
      // dejar rastro. Ahora password_reset_at cambia siempre.
      const audit = await client.query(
        `select changed_fields, actor_id from public.audit_log
         where table_name = 'app_users' and record_id = $1 and op = 'UPDATE'
         order by id desc limit 1`,
        [targetId],
      )
      expect(audit.rowCount).toBeGreaterThan(0)
      expect(audit.rows[0].changed_fields).toContain('password_reset_at')
      expect(audit.rows[0].actor_id).toBe(adminId)
    })
  })

  it('REGRESIÓN blocker 2: DOS reseteos seguidos dejan DOS filas de auditoría, no una', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: targetId } = await createUserWithRole(client, 'editor', { mustChangePassword: true })

      await actAs(client, adminId)
      await client.query('select public.mark_password_reset($1)', [targetId])
      await client.query('select public.mark_password_reset($1)', [targetId])

      await actAsSuperuser(client)
      const audit = await client.query(
        `select count(*) from public.audit_log where table_name = 'app_users' and record_id = $1 and op = 'UPDATE'`,
        [targetId],
      )
      expect(Number(audit.rows[0].count)).toBeGreaterThanOrEqual(2)
    })
  })

  it('password_reset_at no tiene grant de UPDATE para nadie: solo lo escribe mark_password_reset', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      await expect(
        client.query('update public.app_users set password_reset_at = now() where user_id = $1', [userId]),
      ).rejects.toThrow(/permission denied/i)
    })
  })

  it('confirm_password_changed sin marker pendiente falla', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin', { mustChangePassword: true })
      await actAs(client, userId)
      await expect(client.query('select public.confirm_password_changed()')).rejects.toThrow(
        /no hay un cambio de contraseña pendiente/i,
      )
    })
  })

  it('confirm_password_changed con el hash SIN cambiar falla y el flag sigue prendido', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: targetId } = await createUserWithRole(client, 'editor', { mustChangePassword: false })

      await actAs(client, adminId)
      await client.query('select public.mark_password_reset($1)', [targetId])

      await actAs(client, targetId)
      // El hash de auth.users no cambió: confirm tiene que fallar.
      const err = await expectQueryError(client, 'select public.confirm_password_changed()')
      expect(err.message).toMatch(/no cambió/i)

      await actAsSuperuser(client)
      const row = await client.query('select must_change_password from public.app_users where user_id = $1', [
        targetId,
      ])
      expect(row.rows[0].must_change_password).toBe(true)
    })
  })

  it('confirm_password_changed tras cambiar encrypted_password (simulado) apaga el flag y fija password_changed_at', async () => {
    await withRollback(async (client) => {
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId: targetId } = await createUserWithRole(client, 'editor', { mustChangePassword: false })

      await actAs(client, adminId)
      await client.query('select public.mark_password_reset($1)', [targetId])

      // Simula que la persona cambió su contraseña de verdad: el hash de
      // auth.users cambia. Se hace como postgres (auth.users es de GoTrue,
      // no del dominio; ningún rol de la app puede tocarlo directo).
      await actAsSuperuser(client)
      await client.query(`update auth.users set encrypted_password = '$2a$10$nuevo-hash-simulado' where id = $1`, [
        targetId,
      ])

      await actAs(client, targetId)
      const confirmed = await client.query('select public.confirm_password_changed() as ok')
      expect(confirmed.rows[0].ok).toBe(true)

      await actAsSuperuser(client)
      const row = await client.query(
        'select must_change_password, password_changed_at from public.app_users where user_id = $1',
        [targetId],
      )
      expect(row.rows[0].must_change_password).toBe(false)
      expect(row.rows[0].password_changed_at).not.toBeNull()

      const marker = await client.query('select cleared_at from private.password_markers where user_id = $1', [
        targetId,
      ])
      expect(marker.rows[0].cleared_at).not.toBeNull()
    })
  })
})

describe.skipIf(!dbAvailable)('REGRESIÓN minor 7: schema private sin EXECUTE para PUBLIC', () => {
  it('ninguna función de private es ejecutable por PUBLIC (el revoke de la fundación no había surtido efecto)', async () => {
    await withRollback(async (client) => {
      const result = await client.query<{ proname: string }>(
        `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private'
           and has_function_privilege('public', p.oid, 'execute')`,
      )
      expect(result.rows, `funciones de private aún ejecutables por PUBLIC: ${JSON.stringify(result.rows)}`).toEqual(
        [],
      )
    })
  })

  it('anon sigue sin poder ejecutar los helpers de private (ni siquiera los que sí usan las policies)', async () => {
    await withRollback(async (client) => {
      const result = await client.query<{ proname: string }>(
        `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private'
           and has_function_privilege('anon', p.oid, 'execute')`,
      )
      expect(result.rows).toEqual([])
    })
  })

  it('authenticated SÍ puede seguir ejecutando los helpers que las policies necesitan (current_app_role, has_role, is_admin)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      // Si el revoke masivo se hubiera comido estos también, cualquier SELECT
      // sobre una tabla del dominio fallaría con "permission denied for
      // function", no con una policy que simplemente no deja ver filas.
      await expect(client.query('select private.current_app_role()')).resolves.toBeDefined()
      await expect(client.query(`select private.has_role('admin')`)).resolves.toBeDefined()
      await expect(client.query('select private.is_admin()')).resolves.toBeDefined()
    })
  })
})

describe.skipIf(!dbAvailable)('REGRESIÓN blocker 3: cambiar de grupo familiar limpia el responsable de pago', () => {
  it('sacar a la responsable de su grupo (family_group_id = null) ya no choca con el CHECK: la deja de ser responsable', async () => {
    await withRollback(async (client) => {
      const groupId = await client.query<{ id: number }>(
        `insert into public.family_groups (name) values ('Familia de Prueba') returning id`,
      )
      const memberId = await client.query<{ id: number }>(
        `insert into public.members (first_name, last_name, member_type, family_group_id, is_payment_responsible, joined_on)
         values ('Ana', 'Responsable', 'non_practicing', $1, true, '2026-01-01') returning id`,
        [groupId.rows[0].id],
      )

      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      // Antes del fix, esto violaba members_responsible_has_group (CHECK:
      // is_payment_responsible -> family_group_id is not null) con un error
      // genérico. Ahora el trigger apaga el flag antes de que el CHECK corra.
      await client.query('update public.members set family_group_id = null where id = $1', [memberId.rows[0].id])

      const row = await client.query(
        'select family_group_id, is_payment_responsible from public.members where id = $1',
        [memberId.rows[0].id],
      )
      expect(row.rows[0].family_group_id).toBeNull()
      expect(row.rows[0].is_payment_responsible).toBe(false)
    })
  })

  it('mover a la responsable a OTRO grupo (con o sin responsable propio) también le apaga el flag, sin chocar con el índice único', async () => {
    await withRollback(async (client) => {
      const oldGroup = await client.query<{ id: number }>(
        `insert into public.family_groups (name) values ('Grupo Viejo') returning id`,
      )
      const newGroup = await client.query<{ id: number }>(
        `insert into public.family_groups (name) values ('Grupo Nuevo') returning id`,
      )
      const newGroupResponsible = await client.query<{ id: number }>(
        `insert into public.members (first_name, last_name, member_type, family_group_id, is_payment_responsible, joined_on)
         values ('Responsable', 'Del Grupo Nuevo', 'non_practicing', $1, true, '2026-01-01') returning id`,
        [newGroup.rows[0].id],
      )
      const movedMember = await client.query<{ id: number }>(
        `insert into public.members (first_name, last_name, member_type, family_group_id, is_payment_responsible, joined_on)
         values ('Ana', 'Se Muda', 'non_practicing', $1, true, '2026-01-01') returning id`,
        [oldGroup.rows[0].id],
      )

      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      // Sin el fix, esto violaba members_one_responsible_per_group (ya hay
      // un responsable en el grupo nuevo). Ahora el flag se apaga solo.
      await client.query('update public.members set family_group_id = $1 where id = $2', [
        newGroup.rows[0].id,
        movedMember.rows[0].id,
      ])

      const moved = await client.query('select is_payment_responsible from public.members where id = $1', [
        movedMember.rows[0].id,
      ])
      expect(moved.rows[0].is_payment_responsible).toBe(false)

      // El responsable original del grupo nuevo no se vio afectado.
      const untouched = await client.query('select is_payment_responsible from public.members where id = $1', [
        newGroupResponsible.rows[0].id,
      ])
      expect(untouched.rows[0].is_payment_responsible).toBe(true)
    })
  })

  it('actualizar OTRA columna (no family_group_id) no toca is_payment_responsible', async () => {
    await withRollback(async (client) => {
      const group = await client.query<{ id: number }>(
        `insert into public.family_groups (name) values ('Grupo Estable') returning id`,
      )
      const member = await client.query<{ id: number }>(
        `insert into public.members (first_name, last_name, member_type, family_group_id, is_payment_responsible, joined_on)
         values ('Ana', 'Responsable', 'non_practicing', $1, true, '2026-01-01') returning id`,
        [group.rows[0].id],
      )

      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      await client.query(`update public.members set phone = '+54 9 11 5555-5555' where id = $1`, [member.rows[0].id])

      const row = await client.query('select is_payment_responsible from public.members where id = $1', [
        member.rows[0].id,
      ])
      expect(row.rows[0].is_payment_responsible).toBe(true)
    })
  })
})

describe.skipIf(!dbAvailable)('Slice 2 (cuotas y pagos): sin DELETE en ninguna tabla nueva', () => {
  it('authenticated no tiene grant de DELETE en member_categories, fee_prices, fees, payments ni billing_runs', async () => {
    await withRollback(async (client) => {
      for (const table of ['member_categories', 'fee_prices', 'fees', 'payments', 'billing_runs']) {
        expect(await hasGrant(client, 'authenticated', table, 'DELETE'), `authenticated no debería poder DELETE en ${table}`).toBe(
          false,
        )
      }
    })
  })

  it('service_role no tiene grant de INSERT/UPDATE en fee_prices, fees ni payments (solo SELECT, para backups/exportación completa)', async () => {
    await withRollback(async (client) => {
      for (const table of ['fee_prices', 'fees', 'payments']) {
        expect(await hasGrant(client, 'service_role', table, 'INSERT'), `service_role no debería poder INSERT en ${table}`).toBe(
          false,
        )
        expect(await hasGrant(client, 'service_role', table, 'UPDATE'), `service_role no debería poder UPDATE en ${table}`).toBe(
          false,
        )
        expect(await hasGrant(client, 'service_role', table, 'SELECT'), `service_role debería poder SELECT en ${table}`).toBe(true)
      }
      // billing_runs y member_categories: service_role ni siquiera con SELECT
      // salvo lo que ya prueban billing.test.ts / member-categories.test.ts;
      // acá solo se confirma la ausencia de escritura.
      expect(await hasGrant(client, 'service_role', 'member_categories', 'INSERT')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'member_categories', 'UPDATE')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'billing_runs', 'INSERT')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'billing_runs', 'UPDATE')).toBe(false)
    })
  })

  it('anon no puede ejecutar ninguna RPC nueva del slice 2', async () => {
    await withRollback(async (client) => {
      await client.query('set local role anon')
      const calls = [
        `select public.my_permissions()`,
        `select public.set_member_categories(1, array[]::bigint[])`,
        `select * from public.member_accounts()`,
        `select * from public.member_fee_statement(1)`,
        `select * from public.month_collection()`,
        `select * from public.dashboard_summary()`,
        `select * from public.debt_by_category()`,
        `select * from public.monthly_history(1)`,
        `select * from public.generate_pending_fees()`,
        `select public.log_export('members', '{}'::jsonb, 1)`,
      ]
      for (const sql of calls) {
        const err = await expectQueryError(client, sql)
        expect(err.message, `anon no debería poder ejecutar: ${sql}`).toMatch(/permission denied/i)
      }
    })
  })
})
