import { randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
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
 * Corrección de la fecha de alta (pipeline 2026-10-15-editar-fecha-ingreso,
 * §6.3 y §9). `public.correct_member_joined_on` es la ÚNICA puerta: arrastra
 * members + ficha de ingreso + inscripciones cargadas con la fecha vieja, y
 * rechaza lo que dejaría inconsistente lo ya generado. Fuera de la RPC las
 * tres columnas siguen inmutables.
 *
 * Fechas absolutas, todas <= 2026-10-14: son pasadas para siempre, así que los
 * tests no dependen del día en que corran. Solo "futura" usa club_today().
 * Cada test corre en BEGIN/ROLLBACK (el audit_log es append-only).
 */
const dbAvailable = await isDbAvailable()

const CALL = `select public.correct_member_joined_on($1, $2::date)`

async function joinedOn(client: ClientBase, memberId: number): Promise<string> {
  const r = await client.query<{ d: string }>(`select to_char(joined_on, 'YYYY-MM-DD') d from public.members where id = $1`, [memberId])
  return r.rows[0].d
}

async function admissionOn(client: ClientBase, memberId: number): Promise<string> {
  const r = await client.query<{ d: string }>(
    `select to_char(effective_on, 'YYYY-MM-DD') d from public.member_status_events where member_id = $1 and event_type = 'admission'`,
    [memberId],
  )
  return r.rows[0].d
}

async function membershipDates(client: ClientBase, membershipId: number): Promise<string> {
  const r = await client.query<{ d: string }>(`select to_char(joined_on, 'YYYY-MM-DD') d from public.member_categories where id = $1`, [membershipId])
  return r.rows[0].d
}

/** Escenario base: dos disciplinas (fútbol y vóley), socio de alta 2026-10-10 y su ficha de ingreso (la crea el trigger). */
async function baseMember(client: ClientBase, joined = '2026-10-10', birthDate: string | null = null) {
  const futbol = await createDiscipline(client, { name: `Fútbol JO ${randomUUID().slice(0, 6)}` })
  const voley = await createDiscipline(client, { name: `Vóley JO ${randomUUID().slice(0, 6)}` })
  const cat5ta = await createCategory(client, { disciplineId: futbol, name: '5ta JO' })
  const catSub18 = await createCategory(client, { disciplineId: voley, name: 'Sub 18 JO' })
  const memberId = await createMember(client, { firstName: 'Fecha', lastName: 'Corregida Test', joinedOn: joined, birthDate })
  return { futbol, voley, cat5ta, catSub18, memberId }
}

describe.skipIf(!dbAvailable)('correct_member_joined_on: cascada y auditoría', () => {
  it.each(['editor', 'admin'] as const)(
    '%s corrige hacia atrás: members, ficha de ingreso y TODAS las inscripciones de la fecha vieja; la de otra fecha no se toca; auditoría con actor en las tres tablas',
    async (role) => {
      await withRollback(async (client) => {
        const { cat5ta, catSub18, memberId } = await baseMember(client)
        const m1 = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-10-10' })
        const m2 = await openMemberCategory(client, { memberId, categoryId: catSub18, joinedOn: '2026-10-10' })
        // Una tercera disciplina inscripta DESPUÉS, con otra fecha.
        const otra = await createDiscipline(client, { name: `Hockey JO ${randomUUID().slice(0, 6)}` })
        const catOtra = await createCategory(client, { disciplineId: otra, name: 'Mayores JO' })
        const m3 = await openMemberCategory(client, { memberId, categoryId: catOtra, joinedOn: '2026-10-12' })

        const { userId } = await createUserWithRole(client, role)
        await actAs(client, userId)
        await client.query(CALL, [memberId, '2026-09-20'])
        await actAsSuperuser(client)

        expect(await joinedOn(client, memberId)).toBe('2026-09-20')
        expect(await admissionOn(client, memberId)).toBe('2026-09-20')
        expect(await membershipDates(client, m1)).toBe('2026-09-20')
        expect(await membershipDates(client, m2)).toBe('2026-09-20')
        expect(await membershipDates(client, m3)).toBe('2026-10-12')

        const eventId = (await client.query(`select id from public.member_status_events where member_id = $1 and event_type = 'admission'`, [memberId])).rows[0].id
        const rows = await client.query(
          `select table_name, record_id::text rid, actor_id, actor_source, changed_fields
           from public.audit_log where op = 'UPDATE' and actor_id = $1
             and ((table_name = 'members' and record_id::text = $2)
               or (table_name = 'member_status_events' and record_id::text = $3)
               or (table_name = 'member_categories' and record_id::text = any($4::text[])))`,
          [userId, String(memberId), String(eventId), [m1, m2, m3].map(String)],
        )
        const by = (t: string) => rows.rows.filter((r) => r.table_name === t)
        expect(by('members')).toHaveLength(1)
        expect(by('member_status_events')).toHaveLength(1)
        // Dos inscripciones corregidas, la tercera no deja rastro.
        expect(by('member_categories').map((r) => r.rid).sort()).toEqual([String(m1), String(m2)].sort())
        for (const r of rows.rows) expect(r.actor_source).toBe('session')
        expect(by('members')[0].changed_fields).toEqual(['joined_on'])
        expect(by('member_status_events')[0].changed_fields).toEqual(['effective_on'])
        for (const r of by('member_categories')) expect(r.changed_fields).toEqual(['joined_on'])
      })
    },
  )

  it('consulta no puede: insufficient_privilege, y no cambia nada', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client)
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)
      const err = await expectQueryError(client, CALL, [memberId, '2026-09-20'])
      expect(err.code).toBe('42501')
      expect(err.message).toMatch(/No tenés permiso/)
      await actAsSuperuser(client)
      expect(await joinedOn(client, memberId)).toBe('2026-10-10')
    })
  })

  it('anon no tiene EXECUTE (ni por el catálogo ni al llamarla)', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client)
      const priv = await client.query(
        `select has_function_privilege('anon', 'public.correct_member_joined_on(bigint,date)', 'EXECUTE') anon,
                has_function_privilege('public', 'public.correct_member_joined_on(bigint,date)', 'EXECUTE') pub,
                has_function_privilege('authenticated', 'public.correct_member_joined_on(bigint,date)', 'EXECUTE') auth`,
      )
      expect(priv.rows[0]).toEqual({ anon: false, pub: false, auth: true })

      await client.query(`set local role anon`)
      const err = await expectQueryError(client, CALL, [memberId, '2026-09-20'])
      expect(err.code).toBe('42501')
    })
  })

  it('las funciones de trigger nuevas de private no son ejecutables por anon ni public', async () => {
    await withRollback(async (client) => {
      const r = await client.query(
        `select p.proname,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon,
                has_function_privilege('public', p.oid, 'EXECUTE') pub
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname in ('members_joined_on_guard', 'member_status_events_update_guard')`,
      )
      expect(r.rowCount).toBe(2)
      for (const row of r.rows) expect(row, row.proname).toMatchObject({ anon: false, pub: false })
    })
  })

  it('misma fecha: no falla, no cambia nada y no deja NINGUNA fila de auditoría', async () => {
    await withRollback(async (client) => {
      const { cat5ta, memberId } = await baseMember(client)
      const m1 = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-10-10' })
      const { userId } = await createUserWithRole(client, 'editor')
      const before = await client.query(`select count(*)::int n from public.audit_log`)
      await actAs(client, userId)
      await client.query(CALL, [memberId, '2026-10-10'])
      await actAsSuperuser(client)
      const after = await client.query(`select count(*)::int n from public.audit_log`)
      expect(after.rows[0].n).toBe(before.rows[0].n)
      expect(await joinedOn(client, memberId)).toBe('2026-10-10')
      expect(await membershipDates(client, m1)).toBe('2026-10-10')
    })
  })

  it('socio inexistente: "El socio no existe"', async () => {
    await withRollback(async (client) => {
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const err = await expectQueryError(client, CALL, [999999999, '2026-09-20'])
      expect(err.message).toBe('El socio no existe')
    })
  })
})

describe.skipIf(!dbAvailable)('correct_member_joined_on: rechazos', () => {
  async function rejects(setup: (c: ClientBase) => Promise<{ memberId: number }>, newDate: string) {
    let result: { message: string; code?: string } | undefined
    await withRollback(async (client) => {
      const { memberId } = await setup(client)
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      result = await expectQueryError(client, CALL, [memberId, newDate])
    })
    return result!
  }

  it('fecha futura (mañana en hora del club, el borde): rechazada; hoy se acepta', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client, '2026-10-10')
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const t = await client.query<{ today: string; tomorrow: string }>(
        `select to_char(private.club_today(), 'YYYY-MM-DD') today, to_char(private.club_today() + 1, 'YYYY-MM-DD') tomorrow`,
      )
      const err = await expectQueryError(client, CALL, [memberId, t.rows[0].tomorrow])
      expect(err.code).toBe('23514')
      expect(err.message).toMatch(/no puede ser futura/)
      await client.query(CALL, [memberId, t.rows[0].today])
      await actAsSuperuser(client)
      expect(await joinedOn(client, memberId)).toBe(t.rows[0].today)
    })
  })

  it('anterior a la fecha de nacimiento: rechazada; el mismo día de nacimiento se acepta', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client, '2026-10-10', '2015-05-10')
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const err = await expectQueryError(client, CALL, [memberId, '2015-05-09'])
      expect(err.message).toMatch(/anterior a la fecha de nacimiento/)
      await client.query(CALL, [memberId, '2015-05-10'])
      await actAsSuperuser(client)
      expect(await joinedOn(client, memberId)).toBe('2015-05-10')
    })
  })

  it('hacia adelante pasando una baja: "baja o reactivación del 05/10/2026"; justo ese día se acepta', async () => {
    const setup = async (client: ClientBase) => {
      const { memberId } = await baseMember(client, '2026-09-01')
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-10-05', 'fixture de baja')`,
        [memberId],
      )
      return { memberId }
    }
    const err = await rejects(setup, '2026-10-08')
    expect(err.code).toBe('23514')
    expect(err.message).toContain('baja o reactivación del 05/10/2026')

    await withRollback(async (client) => {
      const { memberId } = await setup(client)
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await client.query(CALL, [memberId, '2026-10-05'])
    })
  })

  it('hacia adelante pasando una reactivación (baja anterior ya cubierta): nombra la fecha más temprana que quedaría antes del alta', async () => {
    const err = await rejects(async (client) => {
      const { memberId } = await baseMember(client, '2026-08-01')
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-09-01', 'fixture baja')`,
        [memberId],
      )
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'reactivation', '2026-10-01', 'fixture reactivación')`,
        [memberId],
      )
      return { memberId }
    }, '2026-09-15')
    expect(err.message).toContain('baja o reactivación del 01/09/2026')
  })

  it('hacia adelante pasando una inscripción de OTRA fecha: "está inscripto en Disciplina (Categoría) desde el …"', async () => {
    let disciplineName = ''
    const err = await rejects(async (client) => {
      const { cat5ta, futbol, memberId } = await baseMember(client, '2026-10-01')
      disciplineName = (await client.query(`select name from public.disciplines where id = $1`, [futbol])).rows[0].name
      await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-10-05' })
      return { memberId }
    }, '2026-10-08')
    expect(err.code).toBe('23514')
    expect(err.message).toBe(
      `El socio está inscripto en ${disciplineName} (5ta JO) desde el 05/10/2026: la fecha de alta no puede ser posterior`,
    )
  })

  it('hacia adelante pasando el cierre de una inscripción de la fecha vieja: "estuvo inscripto en … hasta el …", nunca el texto crudo del CHECK', async () => {
    let disciplineName = ''
    const err = await rejects(async (client) => {
      const { cat5ta, futbol, memberId } = await baseMember(client, '2026-09-01')
      disciplineName = (await client.query(`select name from public.disciplines where id = $1`, [futbol])).rows[0].name
      const mc = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-09-01' })
      await closeMemberCategory(client, { membershipId: mc, leftOn: '2026-09-10', leftReason: 'fixture' })
      return { memberId }
    }, '2026-09-20')
    expect(err.code).toBe('23514')
    expect(err.message).toBe(
      `El socio estuvo inscripto en ${disciplineName} (5ta JO) hasta el 10/09/2026: la fecha de alta no puede ser posterior`,
    )
    expect(err.message).not.toMatch(/left_after_joined|violates check constraint/)
  })

  it('cierre justo el día de la nueva fecha: se acepta (el borde)', async () => {
    await withRollback(async (client) => {
      const { cat5ta, memberId } = await baseMember(client, '2026-09-01')
      const mc = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-09-01' })
      await closeMemberCategory(client, { membershipId: mc, leftOn: '2026-09-10', leftReason: 'fixture' })
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await client.query(CALL, [memberId, '2026-09-10'])
      await actAsSuperuser(client)
      expect(await membershipDates(client, mc)).toBe('2026-09-10')
    })
  })

  it('cuota mensual NO anulada en un mes anterior al nuevo: "Ya hay cuotas generadas desde 09/2026"', async () => {
    const err = await rejects(async (client) => {
      const { memberId } = await baseMember(client, '2026-09-10')
      await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, '2026-09-01', 'monthly', 1000000, 'fixture')`,
        [memberId],
      )
      return { memberId }
    }, '2026-10-03')
    expect(err.code).toBe('23514')
    expect(err.message).toContain('Ya hay cuotas generadas desde 09/2026')
  })

  it('fecha nueva dentro del MISMO mes de la cuota (2026-09-15): pasa', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client, '2026-09-10')
      await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, '2026-09-01', 'monthly', 1000000, 'fixture')`,
        [memberId],
      )
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await client.query(CALL, [memberId, '2026-09-15'])
      await actAsSuperuser(client)
      expect(await joinedOn(client, memberId)).toBe('2026-09-15')
    })
  })

  it('cuota mensual ANULADA no bloquea', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client, '2026-09-10')
      const fee = await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, '2026-09-01', 'monthly', 1000000, 'fixture') returning id`,
        [memberId],
      )
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, adminId)
      await client.query(`update public.fees set voided_at = now(), voided_by = $2, void_reason = 'fixture anulada' where id = $1`, [fee.rows[0].id, adminId])
      await actAs(client, userId)
      await client.query(CALL, [memberId, '2026-10-03'])
      await actAsSuperuser(client)
      expect(await joinedOn(client, memberId)).toBe('2026-10-03')
    })
  })

  it('saldo de arranque (opening_balance) de período anterior NO bloquea, y sigue intacto', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client, '2026-09-10')
      const fee = await client.query(
        `insert into public.fees (member_id, kind, amount_cents, description) values ($1, 'opening_balance', 2000000, 'fixture arranque') returning id, period, amount_cents`,
        [memberId],
      )
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await client.query(CALL, [memberId, '2026-10-03'])
      await actAsSuperuser(client)
      const after = await client.query(`select period, amount_cents from public.fees where id = $1`, [fee.rows[0].id])
      expect(after.rows[0]).toEqual({ period: fee.rows[0].period, amount_cents: fee.rows[0].amount_cents })
    })
  })

  it('§9: un pago NO anulado anterior a la nueva fecha NO bloquea (la deuda sale de las cuotas); el pago queda intacto', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client, '2026-09-01')
      const pay = await client.query(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, '2026-09-25', 'cash', $2) returning id`,
        [memberId, randomUUID()],
      )
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await client.query(CALL, [memberId, '2026-10-01'])
      await actAsSuperuser(client)
      expect(await joinedOn(client, memberId)).toBe('2026-10-01')
      const after = await client.query(`select to_char(paid_on, 'YYYY-MM-DD') d, amount_cents::text a, voided_at from public.payments where id = $1`, [pay.rows[0].id])
      expect(after.rows[0]).toEqual({ d: '2026-09-25', a: '1000000', voided_at: null })
    })
  })

  it('un rechazo no deja nada a medias: ni members, ni ficha de ingreso, ni inscripciones', async () => {
    await withRollback(async (client) => {
      const { cat5ta, memberId } = await baseMember(client, '2026-09-10')
      const m1 = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-09-10' })
      await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, '2026-09-01', 'monthly', 1000000, 'fixture')`,
        [memberId],
      )
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      // Pasa todos los chequeos previos y cae recién en el de las cuotas.
      const err = await expectQueryError(client, CALL, [memberId, '2026-10-03'])
      expect(err.message).toMatch(/Ya hay cuotas generadas/)
      await actAsSuperuser(client)
      expect(await joinedOn(client, memberId)).toBe('2026-09-10')
      expect(await admissionOn(client, memberId)).toBe('2026-09-10')
      expect(await membershipDates(client, m1)).toBe('2026-09-10')
      const touched = await client.query(
        `select count(*)::int n from public.audit_log where op = 'UPDATE' and 'joined_on' = any(changed_fields) and table_name in ('members','member_categories')
           and (record_id::text = $1 or record_id::text = $2)`,
        [String(memberId), String(m1)],
      )
      expect(touched.rows[0].n).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('correct_member_joined_on: consecuencia en el generador', () => {
  it('mover el alta a un mes anterior hace que ese mes pase a ser objetivo de generación (y con la categoría arrastrada); la cuota ya generada del mes siguiente no cambia', async () => {
    await withRollback(async (client) => {
      // Mes anterior al actual, calculado: el test no se vence con el calendario.
      const clock = await client.query<{ prev: string; cur: string; prevMid: string }>(
        `select to_char(date_trunc('month', private.club_today()) - interval '1 month', 'YYYY-MM-DD') prev,
                to_char(date_trunc('month', private.club_today()), 'YYYY-MM-DD') cur,
                to_char(date_trunc('month', private.club_today()) - interval '1 month' + interval '19 days', 'YYYY-MM-DD') "prevMid"`,
      )
      const { prev, cur, prevMid } = clock.rows[0]
      const { cat5ta, memberId } = await baseMember(client, cur)
      const mc = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: cur })
      const fee = await client.query(
        `insert into public.fees (member_id, period, kind, amount_cents, category_id, discipline_id, description)
         select $1, $2::date, 'monthly', 1000000, $3, discipline_id, 'fixture' from public.categories where id = $3
         returning id, amount_cents::text amount, fee_price_id`,
        [memberId, cur, cat5ta],
      )

      const targets = (p: string) =>
        client.query(`select category_id::text c from private.monthly_fee_targets($1::date) where member_id = $2`, [p, memberId])
      expect((await targets(prev)).rowCount).toBe(0)

      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await client.query(CALL, [memberId, prevMid])
      await actAsSuperuser(client)

      const after = await targets(prev)
      expect(after.rows).toEqual([{ c: String(cat5ta) }])
      expect(await membershipDates(client, mc)).toBe(prevMid)

      const feeAfter = await client.query(`select amount_cents::text amount, fee_price_id from public.fees where id = $1`, [fee.rows[0].id])
      expect(feeAfter.rows[0]).toEqual({ amount: fee.rows[0].amount, fee_price_id: fee.rows[0].fee_price_id })
    })
  })
})

describe.skipIf(!dbAvailable)('joined_on y ficha de ingreso: inmutables FUERA de la RPC', () => {
  it('como postgres, sin la llave: members.joined_on, member_categories.joined_on, member_status_events.effective_on y el DELETE siguen rechazados', async () => {
    await withRollback(async (client) => {
      const { cat5ta, memberId } = await baseMember(client)
      const mc = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-10-10' })

      expect((await expectQueryError(client, `update public.members set joined_on = '2026-09-01' where id = $1`, [memberId])).message).toMatch(/no se puede modificar/)
      expect((await expectQueryError(client, `update public.member_categories set joined_on = '2026-09-01' where id = $1`, [mc])).message).toMatch(/no se puede modificar/)
      expect(
        (await expectQueryError(client, `update public.member_status_events set effective_on = '2026-09-01' where member_id = $1`, [memberId])).message,
      ).toMatch(/no se modifican ni se borran/)
      expect((await expectQueryError(client, `delete from public.member_status_events where member_id = $1`, [memberId])).message).toMatch(/no se modifican ni se borran/)
      expect(await joinedOn(client, memberId)).toBe('2026-10-10')
    })
  })

  it.each(['editor', 'admin'] as const)('%s por PostgREST/UPDATE directo: permission denied (sin grant) en las tres columnas', async (role) => {
    await withRollback(async (client) => {
      const { cat5ta, memberId } = await baseMember(client)
      const mc = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-10-10' })
      const { userId } = await createUserWithRole(client, role)
      await actAs(client, userId)
      for (const sql of [
        [`update public.members set joined_on = '2026-09-01' where id = $1`, memberId],
        [`update public.member_categories set joined_on = '2026-09-01' where id = $1`, mc],
        [`update public.member_status_events set effective_on = '2026-09-01' where member_id = $1`, memberId],
      ] as const) {
        const err = await expectQueryError(client, sql[0], [sql[1]])
        expect(err.code, sql[0]).toBe('42501')
      }
    })
  })

  it('la llave es del socio: con el GUC apuntando a OTRO id, el UPDATE directo sigue rechazado', async () => {
    await withRollback(async (client) => {
      const { cat5ta, memberId } = await baseMember(client)
      const mc = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-10-10' })
      await client.query(`select set_config('lonqui.joined_on_correction', '999999', true)`)
      expect((await expectQueryError(client, `update public.members set joined_on = '2026-09-01' where id = $1`, [memberId])).message).toMatch(/no se puede modificar/)
      expect((await expectQueryError(client, `update public.member_categories set joined_on = '2026-09-01' where id = $1`, [mc])).message).toMatch(/no se puede modificar/)
      expect(
        (await expectQueryError(client, `update public.member_status_events set effective_on = '2026-09-01' where member_id = $1`, [memberId])).message,
      ).toMatch(/no se modifican ni se borran/)
    })
  })

  it('aun con la llave correcta, la ficha de ingreso solo cambia effective_on (otra columna o un evento que no es admission: rechazado) y el DELETE sigue prohibido', async () => {
    await withRollback(async (client) => {
      const { cat5ta, memberId } = await baseMember(client, '2026-09-01')
      const mc = await openMemberCategory(client, { memberId, categoryId: cat5ta, joinedOn: '2026-09-01' })
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-10-05', 'fixture baja')`,
        [memberId],
      )
      await client.query(`select set_config('lonqui.joined_on_correction', $1, true)`, [String(memberId)])
      const msg = /no se modifican ni se borran/
      expect((await expectQueryError(client, `update public.member_status_events set reason = 'x' where member_id = $1 and event_type = 'admission'`, [memberId])).message).toMatch(msg)
      expect(
        (await expectQueryError(client, `update public.member_status_events set effective_on = '2026-10-06' where member_id = $1 and event_type = 'withdrawal'`, [memberId])).message,
      ).toMatch(msg)
      expect((await expectQueryError(client, `delete from public.member_status_events where member_id = $1`, [memberId])).message).toMatch(msg)
      // Y una inscripción no cambia nada más que joined_on en la misma sentencia.
      expect(
        (await expectQueryError(client, `update public.member_categories set joined_on = '2026-08-01', left_on = '2026-09-02' where id = $1`, [mc])).message,
      ).toMatch(/no se puede modificar/)
    })
  })

  it('la llave no sobrevive a la operación: después de una corrección, un UPDATE directo en la MISMA transacción sigue rechazado', async () => {
    await withRollback(async (client) => {
      const { memberId } = await baseMember(client)
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      await client.query(CALL, [memberId, '2026-09-20'])
      await actAsSuperuser(client)
      expect((await expectQueryError(client, `update public.members set joined_on = '2026-09-01' where id = $1`, [memberId])).message).toMatch(/no se puede modificar/)
    })
  })
})
