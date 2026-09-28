import { describe, expect, it } from 'vitest'
import {
  actAs,
  actAsSuperuser,
  createFamilyGroup,
  createMember,
  createUserWithRole,
  expectQueryError,
  isDbAvailable,
  withRollback,
} from './helpers'

/**
 * S3 (`01-tasks.md`): el padrón. Transiciones de estado, unicidad de DNI y de
 * responsable de pago, y el trigger de auditoría en las cuatro tablas.
 */
const dbAvailable = await isDbAvailable()

describe.skipIf(!dbAvailable)('alta de un socio: la ficha de ingreso es automática', () => {
  it('insertar un socio crea el evento admission con effective_on = joined_on y status = active', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const memberId = await createMember(client, { firstName: 'Ana', lastName: 'Alta', joinedOn: '2026-02-15' })

      const member = await client.query('select status, status_changed_on from public.members where id = $1', [
        memberId,
      ])
      expect(member.rows[0].status).toBe('active')

      const event = await client.query(
        `select event_type, effective_on, reason from public.member_status_events where member_id = $1`,
        [memberId],
      )
      expect(event.rowCount).toBe(1)
      expect(event.rows[0].event_type).toBe('admission')
      expect(event.rows[0].effective_on.toISOString().slice(0, 10)).toBe('2026-02-15')
      expect(event.rows[0].reason).toBe('Ficha de ingreso')
    })
  })

  it('editor inserta un socio pero NO puede insertar un evento de estado a mano (solo el trigger lo hace)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const memberId = await createMember(client, { firstName: 'Bruno', lastName: 'Editor Test' })

      const err = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', current_date, 'Se fue del club')`,
        [memberId],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('un admin manual insertando "admission" cuando ya hay eventos previos falla', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Carla', lastName: 'Doble Alta' })

      const err = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'admission', current_date, 'Ficha de ingreso manual')`,
        [memberId],
      )
      expect(err.message).toMatch(/ya tiene su ficha de ingreso/i)
    })
  })

  it('cada alta deja su fila de auditoría con el actor correcto', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Dana', lastName: 'Auditada' })

      // audit_log solo lo lee admin (RLS): volvemos a superusuario para
      // inspeccionar el resultado, no para probar el permiso de lectura.
      await actAsSuperuser(client)
      const audit = await client.query(
        `select actor_id, op from public.audit_log where table_name = 'members' and record_id = $1`,
        [memberId],
      )
      expect(audit.rowCount).toBe(1)
      expect(audit.rows[0].actor_id).toBe(userId)
      expect(audit.rows[0].op).toBe('INSERT')
    })
  })
})

describe.skipIf(!dbAvailable)('baja, reactivación: transiciones de estado', () => {
  it('withdrawal sobre un socio activo lo pasa a inactive con status_changed_on = effective_on', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Elena', lastName: 'Baja Test' })

      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-03-01', 'Se mudó de ciudad')`,
        [memberId],
      )

      const row = await client.query('select status, status_changed_on from public.members where id = $1', [
        memberId,
      ])
      expect(row.rows[0].status).toBe('inactive')
      expect(row.rows[0].status_changed_on.toISOString().slice(0, 10)).toBe('2026-03-01')
    })
  })

  it('una segunda baja sobre un socio ya inactivo falla con el mensaje "ya está dado de baja"', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Fabio', lastName: 'Doble Baja' })
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', current_date, 'Motivo uno')`,
        [memberId],
      )

      const err = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', current_date, 'Motivo dos')`,
        [memberId],
      )
      expect(err.message).toMatch(/ya está dado de baja/i)
    })
  })

  it('reactivation sobre un socio inactivo lo vuelve a active', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Gina', lastName: 'Reactivada' })
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-01-10', 'Motivo baja')`,
        [memberId],
      )
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'reactivation', '2026-04-01', 'Volvió al club')`,
        [memberId],
      )

      const row = await client.query('select status, status_changed_on from public.members where id = $1', [
        memberId,
      ])
      expect(row.rows[0].status).toBe('active')
      expect(row.rows[0].status_changed_on.toISOString().slice(0, 10)).toBe('2026-04-01')
    })
  })

  it('reactivation sobre un socio ya activo falla con "ya está activo"', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Hugo', lastName: 'Ya Activo' })

      const err = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'reactivation', current_date, 'Intento inválido')`,
        [memberId],
      )
      expect(err.message).toMatch(/ya está activo/i)
    })
  })

  it('una fecha futura en la baja falla', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Ines', lastName: 'Fecha Futura' })

      const farFuture = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
      const err = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', $2, 'No puede ser futura')`,
        [memberId, farFuture],
      )
      expect(err.message).toMatch(/no puede ser futura/i)
    })
  })

  it('una fecha anterior a joined_on falla', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Jorge', lastName: 'Fecha Anterior', joinedOn: '2026-06-01' })

      const err = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-01-01', 'Anterior al alta')`,
        [memberId],
      )
      expect(err.message).toMatch(/anterior a la fecha de alta/i)
    })
  })

  it('un motivo de 2 caracteres (o vacío tras recortar) falla el CHECK de longitud', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Karla', lastName: 'Motivo Corto' })

      const err = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', current_date, 'ok')`,
        [memberId],
      )
      expect(err.code).toBe('23514')
    })
  })

  it('editor NO puede dar de baja ni reactivar (solo admin): el INSERT viola la RLS', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Lucía', lastName: 'Solo Admin Baja' })
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const err = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', current_date, 'Editor no puede')`,
        [memberId],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('consulta no escribe nada: ni socios ni eventos', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Marta', lastName: 'Consulta Test' })
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)

      const insertMemberErr = await expectQueryError(
        client,
        `insert into public.members (first_name, last_name, joined_on) values ('X', 'Y', current_date)`,
      )
      expect(insertMemberErr.message).toMatch(/row-level security|permission denied/i)

      const insertEventErr = await expectQueryError(
        client,
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', current_date, 'Consulta no puede')`,
        [memberId],
      )
      expect(insertEventErr.message).toMatch(/row-level security|permission denied/i)
    })
  })
})

describe.skipIf(!dbAvailable)('members.status y joined_on son inmutables desde la app', () => {
  it('UPDATE members set status directo falla con permission denied (columna sin grant), para editor Y para admin', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Nadia', lastName: 'Status Directo' })

      for (const role of ['editor', 'admin'] as const) {
        // Cada vuelta crea un usuario nuevo: hay que volver a ser
        // superusuario ANTES, si no el INSERT en auth.users corre todavía
        // como `authenticated` (el `SET LOCAL ROLE` de la vuelta anterior
        // sigue vigente el resto de la transacción).
        await actAsSuperuser(client)
        const { userId } = await createUserWithRole(client, role)
        await actAs(client, userId)
        const err = await expectQueryError(client, `update public.members set status = 'inactive' where id = $1`, [
          memberId,
        ])
        expect(err.message, `rol ${role} no debería poder escribir status`).toMatch(/permission denied/i)
      }
    })
  })

  it('UPDATE members set joined_on falla: la columna no tiene grant de UPDATE para nadie', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'admin')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Oscar', lastName: 'Joined On', joinedOn: '2026-01-01' })

      const err = await expectQueryError(client, `update public.members set joined_on = '2020-01-01' where id = $1`, [
        memberId,
      ])
      expect(err.message).toMatch(/permission denied/i)
    })
  })

  it('REGRESIÓN: ni siquiera como postgres (superusuario, sin RLS ni grants) se puede tocar joined_on: lo frena el trigger', async () => {
    await withRollback(async (client) => {
      // Sin actAs: seguimos siendo postgres. Este es el escenario real que
      // protege el trigger `protect_immutable_columns`, porque ningún cliente
      // de la app (ni siquiera el admin client con service_role) tiene grant
      // de UPDATE sobre members en absoluto.
      const memberId = await createMember(client, { firstName: 'Pedro', lastName: 'Trigger Directo', joinedOn: '2026-01-01' })
      const err = await expectQueryError(client, `update public.members set joined_on = '2020-01-01' where id = $1`, [
        memberId,
      ])
      expect(err.message).toMatch(/no se puede modificar/i)
    })
  })
})

describe.skipIf(!dbAvailable)('DNI: unicidad parcial (nullable con carga histórica)', () => {
  it('dos socios con el mismo DNI: el segundo falla', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await createMember(client, { firstName: 'Pablo', lastName: 'DNI Uno', dni: '99000001' })

      const err = await expectQueryError(
        client,
        `insert into public.members (first_name, last_name, dni, joined_on) values ('Otro', 'Con Mismo DNI', '99000001', current_date)`,
      )
      expect(err.code).toBe('23505')
    })
  })

  it('dos socios SIN DNI: está permitido (no chocan entre null)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const idA = await createMember(client, { firstName: 'Quimey', lastName: 'Sin DNI Uno', dni: null })
      const idB = await createMember(client, { firstName: 'Rita', lastName: 'Sin DNI Dos', dni: null })
      expect(idA).not.toBe(idB)
    })
  })

  it('DNI de menos de 7 dígitos viola el CHECK de formato', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const err = await expectQueryError(
        client,
        `insert into public.members (first_name, last_name, dni, joined_on) values ('X', 'Y', '123', current_date)`,
      )
      expect(err.code).toBe('23514')
    })
  })
})

// El viejo CHECK simétrico "practicing ⇔ category_id" desapareció con S0
// (slice 2): `members` ya no tiene `category_id`, y `member_type` lo deriva
// el trigger `sync_member_type` de `member_categories` (AFTER INSERT/UPDATE),
// nunca un valor que la app mande. Esa cobertura vive ahora en
// `tests/db/member-categories.test.ts` (inscripción abierta → 'practicing',
// cerrar la única inscripción → 'non_practicing', columna `member_type` sin
// grant de escritura para `authenticated`).

describe.skipIf(!dbAvailable)('responsable de pago: unicidad y RPC atómica', () => {
  it('dos responsables en el mismo grupo: el segundo viola el índice único parcial', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const groupId = await createFamilyGroup(client, { name: 'Familia Responsable Doble' })
      await createMember(client, {
        firstName: 'Tomás',
        lastName: 'Responsable Uno',
        familyGroupId: groupId,
        isPaymentResponsible: true,
      })

      const err = await expectQueryError(
        client,
        `insert into public.members (first_name, last_name, family_group_id, is_payment_responsible, joined_on)
         values ('Otro', 'Responsable Dos', $1, true, current_date)`,
        [groupId],
      )
      expect(err.code).toBe('23505')
    })
  })

  it('responsable sin grupo (family_group_id null) viola el CHECK', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const err = await expectQueryError(
        client,
        `insert into public.members (first_name, last_name, is_payment_responsible, joined_on)
         values ('X', 'Y', true, current_date)`,
      )
      expect(err.code).toBe('23514')
    })
  })

  it('set_family_payment_responsible cambia el responsable atómicamente (el anterior se limpia solo)', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const groupId = await createFamilyGroup(client, { name: 'Familia RPC' })
      const memberA = await createMember(client, {
        firstName: 'Uma',
        lastName: 'Responsable A',
        familyGroupId: groupId,
      })
      const memberB = await createMember(client, { firstName: 'Vera', lastName: 'Responsable B', familyGroupId: groupId })

      await client.query('select public.set_family_payment_responsible($1, $2)', [groupId, memberA])
      let rows = await client.query<{ id: string; is_payment_responsible: boolean }>(
        'select id, is_payment_responsible from public.members where family_group_id = $1 order by id',
        [groupId],
      )
      // `id` es bigint: pg lo devuelve como string, hay que convertir antes de comparar.
      expect(rows.rows.find((r) => Number(r.id) === memberA)?.is_payment_responsible).toBe(true)
      expect(rows.rows.find((r) => Number(r.id) === memberB)?.is_payment_responsible).toBe(false)

      // Cambiar al otro: el índice único parcial nunca ve dos responsables a la vez.
      await client.query('select public.set_family_payment_responsible($1, $2)', [groupId, memberB])
      rows = await client.query(
        'select id, is_payment_responsible from public.members where family_group_id = $1 order by id',
        [groupId],
      )
      expect(rows.rows.find((r) => Number(r.id) === memberA)?.is_payment_responsible).toBe(false)
      expect(rows.rows.find((r) => Number(r.id) === memberB)?.is_payment_responsible).toBe(true)
    })
  })

  it('set_family_payment_responsible con un socio que no pertenece al grupo falla', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const groupId = await createFamilyGroup(client, { name: 'Familia RPC Ajena' })
      const otroGroupId = await createFamilyGroup(client, { name: 'Otra Familia' })
      const memberId = await createMember(client, { firstName: 'Walter', lastName: 'De Otro Grupo', familyGroupId: otroGroupId })

      const err = await expectQueryError(client, 'select public.set_family_payment_responsible($1, $2)', [
        groupId,
        memberId,
      ])
      expect(err.message).toMatch(/no pertenece a ese grupo familiar/i)
    })
  })
})

describe.skipIf(!dbAvailable)('búsqueda normalizada (acentos, mayúsculas)', () => {
  it('"nunez" encuentra a un socio cargado como "Núñez"', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await createMember(client, { firstName: 'Julián', lastName: 'Núñez' })

      const result = await client.query(
        `select id from public.members where search_text ilike '%' || private.normalize_text('nunez') || '%'`,
      )
      expect(result.rowCount).toBeGreaterThan(0)
    })
  })

  it('"PEREZ" (mayúsculas, sin acento) encuentra a un socio cargado como "Pérez"', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await createMember(client, { firstName: 'Marina', lastName: 'Pérez' })

      const result = await client.query(
        `select id from public.members where search_text ilike '%' || private.normalize_text('PEREZ') || '%'`,
      )
      expect(result.rowCount).toBeGreaterThan(0)
    })
  })

  it('la búsqueda por DNI también pasa por search_text', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const memberId = await createMember(client, { firstName: 'Xavier', lastName: 'Con Dni', dni: '99000002' })

      const result = await client.query(
        `select id from public.members where search_text ilike '%99000002%' and id = $1`,
        [memberId],
      )
      expect(result.rowCount).toBe(1)
    })
  })
})
