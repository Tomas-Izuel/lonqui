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
  hasGrant,
  isDbAvailable,
  openMemberCategory,
  withRollback,
} from './helpers'

/**
 * S0 (`01-tasks.md`): `member_categories`, la tabla que reemplaza
 * `members.category_id`. Un socio puede estar en varios deportes; a lo sumo
 * una inscripción ABIERTA por disciplina; `members.member_type` es derivado,
 * nunca escrito por la app.
 *
 * Patrón de cada test: el fixture (disciplinas, categorías, socio) se arma
 * TODAVÍA como superusuario (el estado inicial de `withRollback`, antes de
 * llamar `actAs`), porque crear disciplinas/categorías exige `settings.manage`
 * (solo `admin`) y no es lo que el test quiere probar. Recién después se crea
 * el usuario del rol bajo prueba y se simula la sesión.
 */
const dbAvailable = await isDbAvailable()

describe.skipIf(!dbAvailable)('member_categories: inscripción abierta, una por disciplina', () => {
  it('una segunda inscripción abierta en la MISMA categoría viola el índice único', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test A' })
      const categoryId = await createCategory(client, { disciplineId, name: '5ta Test' })
      const memberId = await createMember(client, { firstName: 'Ana', lastName: 'Uno', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-02-01' })
      // El guard `member_categories_insert_guard` corre ANTES que la
      // constraint: detecta "ya inscripto en esta disciplina" (23514, con el
      // mensaje que nombra deporte y categoría) antes de que el índice único
      // llegue a evaluarse. El índice único es la red de seguridad para una
      // carrera real (dos inserts concurrentes que pasan el guard a la vez),
      // no el camino que ve un insert secuencial como este.
      const err = await expectQueryError(
        client,
        `insert into public.member_categories (member_id, category_id, joined_on) values ($1, $2, $3)`,
        [memberId, categoryId, '2026-03-01'],
      )
      expect(err.code).toBe('23514')
      expect(err.message).toMatch(/Ya está inscripto en/)
    })
  })

  it('dos disciplinas distintas simultáneas: permitido (un socio en varios deportes)', async () => {
    await withRollback(async (client) => {
      const futbol = await createDiscipline(client, { name: 'Fútbol Test B' })
      const voley = await createDiscipline(client, { name: 'Vóley Test B' })
      const catFutbol = await createCategory(client, { disciplineId: futbol, name: '5ta Test B' })
      const catVoley = await createCategory(client, { disciplineId: voley, name: 'Sub 18 Test B' })
      const memberId = await createMember(client, { firstName: 'Valentina', lastName: 'Dos Deportes', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      await openMemberCategory(client, { memberId, categoryId: catFutbol, joinedOn: '2026-01-15' })
      await openMemberCategory(client, { memberId, categoryId: catVoley, joinedOn: '2026-01-20' })

      const rows = await client.query(
        `select category_id from public.member_categories where member_id = $1 and left_on is null order by category_id`,
        [memberId],
      )
      expect(rows.rowCount).toBe(2)
    })
  })

  it('dos categorías abiertas de la MISMA disciplina: rechazado con el mensaje que nombra el deporte y la categoría', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test C' })
      const cat5ta = await createCategory(client, { disciplineId, name: '5ta Test C' })
      const cat6ta = await createCategory(client, { disciplineId, name: '6ta Test C' })
      const memberId = await createMember(client, { firstName: 'Joaquín', lastName: 'Ascenso', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-01-15' })
      const err = await expectQueryError(
        client,
        `insert into public.member_categories (member_id, category_id, joined_on) values ($1, $2, $3)`,
        [memberId, cat6ta, '2026-02-01'],
      )
      expect(err.code).toBe('23514')
      expect(err.message).toMatch(/Ya está inscripto en Fútbol Test C \(5ta Test C\)/)
    })
  })

  it('categoría dada de baja: rechazado', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Vóley Test D' })
      const categoryId = await createCategory(client, { disciplineId, name: 'Mayores Test D', isActive: false })
      const memberId = await createMember(client, { firstName: 'Rita', lastName: 'Inactiva', joinedOn: '2026-01-01' })

      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      const err = await expectQueryError(
        client,
        `insert into public.member_categories (member_id, category_id, joined_on) values ($1, $2, $3)`,
        [memberId, categoryId, '2026-02-01'],
      )
      expect(err.code).toBe('23514')
      expect(err.message).toBe('La categoría está dada de baja')
    })
  })

  it('joined_on anterior al alta del socio: rechazado', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test E' })
      const categoryId = await createCategory(client, { disciplineId, name: '7ma Test E' })
      const memberId = await createMember(client, { firstName: 'Mateo', lastName: 'Nuevo', joinedOn: '2026-03-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const err = await expectQueryError(
        client,
        `insert into public.member_categories (member_id, category_id, joined_on) values ($1, $2, $3)`,
        [memberId, categoryId, '2026-02-01'],
      )
      expect(err.code).toBe('23514')
      expect(err.message).toBe('La fecha no puede ser anterior a la fecha de alta del socio')
    })
  })

  it('joined_on futuro: rechazado', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test F' })
      const categoryId = await createCategory(client, { disciplineId, name: '8va Test F' })
      const memberId = await createMember(client, { firstName: 'Nahuel', lastName: 'Futuro', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const err = await expectQueryError(
        client,
        `insert into public.member_categories (member_id, category_id, joined_on) values ($1, $2, $3)`,
        [memberId, categoryId, '2099-01-01'],
      )
      expect(err.code).toBe('23514')
      expect(err.message).toBe('La fecha no puede ser futura')
    })
  })

  it('categoría inexistente: rechazado como violación de FK', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Camila', lastName: 'SinCategoria', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const err = await expectQueryError(
        client,
        `insert into public.member_categories (member_id, category_id, joined_on) values ($1, 9999999, $2)`,
        [memberId, '2026-02-01'],
      )
      expect(err.code).toBe('23503')
      expect(err.message).toBe('La categoría no existe')
    })
  })
})

describe.skipIf(!dbAvailable)('member_categories: cierre de inscripción (baja de una categoría)', () => {
  it('cerrar null -> valor una vez, sin motivo: OK', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test G' })
      const categoryId = await createCategory(client, { disciplineId, name: '9na Test G' })
      const memberId = await createMember(client, { firstName: 'Bruno', lastName: 'DejaFutbol', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const membershipId = await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })

      await client.query(`update public.member_categories set left_on = $2 where id = $1`, [membershipId, '2026-06-30'])

      const row = await client.query('select left_on, left_reason, left_by, left_at from public.member_categories where id = $1', [
        membershipId,
      ])
      expect(row.rows[0].left_on.toISOString().slice(0, 10)).toBe('2026-06-30')
      expect(row.rows[0].left_reason).toBeNull()
      expect(row.rows[0].left_by).toBe(userId)
      expect(row.rows[0].left_at).not.toBeNull()
    })
  })

  it('cerrar con motivo: el motivo queda', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test H' })
      const categoryId = await createCategory(client, { disciplineId, name: '10ma Test H' })
      const memberId = await createMember(client, { firstName: 'Sofía', lastName: 'ConMotivo', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const membershipId = await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })

      await closeMemberCategory(client, { membershipId, leftOn: '2026-05-31', leftReason: 'Se mudó de ciudad' })

      const row = await client.query('select left_reason from public.member_categories where id = $1', [membershipId])
      expect(row.rows[0].left_reason).toBe('Se mudó de ciudad')
    })
  })

  it('cerrar una inscripción ya cerrada: rechazado', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test I' })
      const categoryId = await createCategory(client, { disciplineId, name: '5ta Test I' })
      const memberId = await createMember(client, { firstName: 'Pablo', lastName: 'DobleCierre', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const membershipId = await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })
      await closeMemberCategory(client, { membershipId, leftOn: '2026-03-31' })

      const err = await expectQueryError(client, `update public.member_categories set left_on = $2 where id = $1`, [
        membershipId,
        '2026-06-30',
      ])
      expect(err.code).toBe('23514')
      expect(err.message).toBe('Esta inscripción ya está cerrada')
    })
  })

  it('volver left_on a null: rechazado (no se reabre así)', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test J' })
      const categoryId = await createCategory(client, { disciplineId, name: '6ta Test J' })
      const memberId = await createMember(client, { firstName: 'Quimey', lastName: 'Reapertura', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const membershipId = await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })

      // El UPDATE de la app siempre manda left_on con valor (Zod lo exige), pero
      // el trigger igual lo rechazaría: "para cerrar hace falta la fecha" es el
      // mismo guard que ataja un update directo con left_on = null.
      const err = await expectQueryError(client, `update public.member_categories set left_on = null where id = $1`, [membershipId])
      expect(err.code).toBe('23514')
    })
  })

  it('left_on futuro al cerrar: rechazado', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test K' })
      const categoryId = await createCategory(client, { disciplineId, name: '7ma Test K' })
      const memberId = await createMember(client, { firstName: 'Rita', lastName: 'FechaFutura', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const membershipId = await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })

      const err = await expectQueryError(client, `update public.member_categories set left_on = $2 where id = $1`, [
        membershipId,
        '2099-01-01',
      ])
      expect(err.code).toBe('23514')
      expect(err.message).toBe('La fecha no puede ser futura')
    })
  })

  it('UPDATE de category_id o joined_on: sin grant de columna (primera barrera) y con error de inmutabilidad si se bypasea (segunda barrera)', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test L' })
      const cat1 = await createCategory(client, { disciplineId, name: '8va Test L' })
      const cat2 = await createCategory(client, { disciplineId, name: '9na Test L' })
      const memberId = await createMember(client, { firstName: 'Uma', lastName: 'Inmutable', joinedOn: '2026-01-01' })
      const membershipId = await openMemberCategory(client, { memberId, categoryId: cat1, joinedOn: '2026-01-01' })

      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      // Primera barrera: ni `admin` tiene grant de UPDATE sobre `category_id`/
      // `joined_on` (los únicos grants de UPDATE son `left_on`/`left_reason`).
      const errCategory = await expectQueryError(client, `update public.member_categories set category_id = $2 where id = $1`, [
        membershipId,
        cat2,
      ])
      expect(errCategory.message).toMatch(/permission denied/i)

      const errJoined = await expectQueryError(client, `update public.member_categories set joined_on = $2 where id = $1`, [
        membershipId,
        '2026-02-01',
      ])
      expect(errJoined.message).toMatch(/permission denied/i)

      // Segunda barrera: aunque se bypasee el grant (superusuario), el
      // trigger `protect_immutable_columns` rechaza igual.
      await actAsSuperuser(client)
      const errCategorySuperuser = await expectQueryError(
        client,
        `update public.member_categories set category_id = $2 where id = $1`,
        [membershipId, cat2],
      )
      expect(errCategorySuperuser.message).toMatch(/no se puede modificar|immutable|inmutable/i)

      const errJoinedSuperuser = await expectQueryError(
        client,
        `update public.member_categories set joined_on = $2 where id = $1`,
        [membershipId, '2026-02-01'],
      )
      expect(errJoinedSuperuser.message).toMatch(/no se puede modificar|immutable|inmutable/i)
    })
  })

  it('DELETE sin privilegio: ni authenticated ni service_role pueden borrar', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test M' })
      const categoryId = await createCategory(client, { disciplineId, name: '10ma Test M' })
      const memberId = await createMember(client, { firstName: 'Vera', lastName: 'SinBorrado', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const membershipId = await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })

      const errAuthenticated = await expectQueryError(client, `delete from public.member_categories where id = $1`, [membershipId])
      expect(errAuthenticated.message).toMatch(/permission denied/i)

      await actAsSuperuser(client)
      expect(await hasGrant(client, 'authenticated', 'member_categories', 'DELETE')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'member_categories', 'DELETE')).toBe(false)

      // Como postgres (superusuario) SÍ llega al trigger `forbid_change`, que
      // rechaza el DELETE incluso bypaseando RLS/grants: nada se borra, ni
      // siquiera a mano en la base.
      const errSuperuser = await expectQueryError(client, `delete from public.member_categories where id = $1`, [membershipId])
      expect(errSuperuser.message).toMatch(/no se modifican ni se borran|forbid|not allowed|immutable/i)
    })
  })
})

describe.skipIf(!dbAvailable)('member_type: derivado, sin grant de escritura', () => {
  it('UPDATE members set member_type: permission denied incluso para admin', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Walter', lastName: 'SinGrant', joinedOn: '2026-01-01' })

      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)

      const err = await expectQueryError(client, `update public.members set member_type = 'practicing' where id = $1`, [memberId])
      expect(err.message).toMatch(/permission denied/i)
    })
  })

  it('abrir una inscripción vuelve al socio practicing; cerrar la única lo vuelve non_practicing', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Vóley Test N' })
      const categoryId = await createCategory(client, { disciplineId, name: 'Sub 20 Test N' })
      const memberId = await createMember(client, { firstName: 'Ximena', lastName: 'Derivado', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const before = await client.query('select member_type from public.members where id = $1', [memberId])
      expect(before.rows[0].member_type).toBe('non_practicing')

      const membershipId = await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-02-01' })
      const afterOpen = await client.query('select member_type from public.members where id = $1', [memberId])
      expect(afterOpen.rows[0].member_type).toBe('practicing')

      await closeMemberCategory(client, { membershipId, leftOn: '2026-06-30' })
      const afterClose = await client.query('select member_type from public.members where id = $1', [memberId])
      expect(afterClose.rows[0].member_type).toBe('non_practicing')
    })
  })

  it('dos deportes: cerrar uno solo lo deja practicing igual', async () => {
    await withRollback(async (client) => {
      const futbol = await createDiscipline(client, { name: 'Fútbol Test O' })
      const voley = await createDiscipline(client, { name: 'Vóley Test O' })
      const catFutbol = await createCategory(client, { disciplineId: futbol, name: '5ta Test O' })
      const catVoley = await createCategory(client, { disciplineId: voley, name: 'Mayores Test O' })
      const memberId = await createMember(client, { firstName: 'Yamila', lastName: 'DosDeportes', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const futbolMembership = await openMemberCategory(client, { memberId, categoryId: catFutbol, joinedOn: '2026-01-01' })
      await openMemberCategory(client, { memberId, categoryId: catVoley, joinedOn: '2026-01-01' })
      await closeMemberCategory(client, { membershipId: futbolMembership, leftOn: '2026-06-30' })

      const row = await client.query('select member_type from public.members where id = $1', [memberId])
      expect(row.rows[0].member_type).toBe('practicing')
    })
  })
})

describe.skipIf(!dbAvailable)('set_member_categories: cambio en bloque, atómico', () => {
  it('abre dos, después reemplaza una (el ascenso) sin tocar la otra, y {} cierra todo', async () => {
    await withRollback(async (client) => {
      const futbol = await createDiscipline(client, { name: 'Fútbol Test P' })
      const voley = await createDiscipline(client, { name: 'Vóley Test P' })
      const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta Test P' })
      const cat6ta = await createCategory(client, { disciplineId: futbol, name: '6ta Test P' })
      const catSub18 = await createCategory(client, { disciplineId: voley, name: 'Sub 18 Test P' })
      const memberId = await createMember(client, { firstName: 'Zoe', lastName: 'Ascenso', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      await client.query(`select public.set_member_categories($1, $2, $3)`, [memberId, [cat5ta, catSub18], '2026-01-15'])
      const openedFirst = await client.query(
        'select category_id from public.member_categories where member_id = $1 and left_on is null order by category_id',
        [memberId],
      )
      // `category_id` es bigint: el driver `pg` lo devuelve como string, por eso `Number(...)` antes de comparar.
      expect(openedFirst.rows.map((r) => Number(r.category_id)).sort()).toEqual([cat5ta, catSub18].sort())

      // Ascenso: 5ta -> 6ta, Sub 18 queda intacta (mismo joined_on viejo).
      await client.query(`select public.set_member_categories($1, $2, $3)`, [memberId, [cat6ta, catSub18], '2026-07-01'])
      const afterAscent = await client.query(
        `select category_id, joined_on, left_on from public.member_categories where member_id = $1 order by category_id, joined_on`,
        [memberId],
      )
      const open = afterAscent.rows.filter((r) => r.left_on === null)
      expect(open.map((r) => Number(r.category_id)).sort()).toEqual([cat6ta, catSub18].sort())
      const sub18Row = open.find((r) => Number(r.category_id) === catSub18)
      expect(sub18Row?.joined_on.toISOString().slice(0, 10)).toBe('2026-01-15') // no se tocó

      const closed5ta = afterAscent.rows.find((r) => Number(r.category_id) === cat5ta)
      expect(closed5ta?.left_on?.toISOString().slice(0, 10)).toBe('2026-07-01')

      // {} cierra todo -> non_practicing.
      await client.query(`select public.set_member_categories($1, $2)`, [memberId, []])
      const memberType = await client.query('select member_type from public.members where id = $1', [memberId])
      expect(memberType.rows[0].member_type).toBe('non_practicing')
    })
  })

  it('dos categorías de la misma disciplina en la lista: rechazado', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test Q' })
      const cat5ta = await createCategory(client, { disciplineId, name: '5ta Test Q' })
      const cat6ta = await createCategory(client, { disciplineId, name: '6ta Test Q' })
      const memberId = await createMember(client, { firstName: 'Ariel', lastName: 'DosCategorias', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)

      const err = await expectQueryError(client, `select public.set_member_categories($1, $2)`, [memberId, [cat5ta, cat6ta]])
      expect(err.message).toBe('Elegí una sola categoría por deporte')
    })
  })

  it('como consulta: insufficient_privilege', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test R' })
      const categoryId = await createCategory(client, { disciplineId, name: '7ma Test R' })
      const memberId = await createMember(client, { firstName: 'Benicio', lastName: 'Consulta', joinedOn: '2026-01-01' })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)

      const err = await expectQueryError(client, `select public.set_member_categories($1, $2)`, [memberId, [categoryId]])
      expect(err.message).toBe('No tenés permiso para modificar socios')
    })
  })
})

describe.skipIf(!dbAvailable)('member_categories: permisos por rol y auditoría', () => {
  it('editor lee e inserta; consulta solo lee', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test S' })
      const categoryId = await createCategory(client, { disciplineId, name: '8va Test S' })
      const memberId = await createMember(client, { firstName: 'Carla', lastName: 'Permisos', joinedOn: '2026-01-01' })

      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })

      await actAsSuperuser(client)
      // Una segunda categoría REAL (existente, activa, disciplina distinta a
      // la que el socio ya tiene abierta): así el guard de inserción la deja
      // pasar y lo único que puede frenar el INSERT es la policy de RLS de
      // `consulta` — con una categoría inexistente, o repetida en la misma
      // disciplina, el guard la rechazaría ANTES de llegar a la policy, y el
      // test no probaría lo que dice probar.
      const otherDisciplineId = await createDiscipline(client, { name: 'Fútbol Test S2' })
      const otherCategoryId = await createCategory(client, { disciplineId: otherDisciplineId, name: '5ta Test S2' })

      const { userId: consultaId } = await createUserWithRole(client, 'consulta')
      await actAs(client, consultaId)

      const read = await client.query('select id from public.member_categories where member_id = $1', [memberId])
      expect(read.rowCount).toBe(1)

      const err = await expectQueryError(
        client,
        `insert into public.member_categories (member_id, category_id, joined_on) values ($1, $2, current_date)`,
        [memberId, otherCategoryId],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('cada INSERT y UPDATE deja una fila en audit_log con el actor', async () => {
    await withRollback(async (client) => {
      const disciplineId = await createDiscipline(client, { name: 'Fútbol Test T' })
      const categoryId = await createCategory(client, { disciplineId, name: '9na Test T' })
      const memberId = await createMember(client, { firstName: 'Dario', lastName: 'Auditado', joinedOn: '2026-01-01' })

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const membershipId = await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })
      await closeMemberCategory(client, { membershipId, leftOn: '2026-06-30' })

      // `audit_log` solo lo lee `admin` (RLS); como superusuario bypasea RLS
      // para verificar el contenido sin necesitar otro usuario.
      await actAsSuperuser(client)
      const rows = await client.query(
        `select op, actor_id from public.audit_log where table_name = 'member_categories' and record_id = $1::text order by occurred_at`,
        [String(membershipId)],
      )
      expect(rows.rows.map((r) => r.op)).toEqual(['INSERT', 'UPDATE'])
      expect(rows.rows.every((r) => r.actor_id === userId)).toBe(true)
    })
  })
})
