import { randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import { actAs, actAsSuperuser, createFamilyGroup, createUserWithRole, expectQueryError, isDbAvailable, withRollback } from './helpers'
import {
  actAsServiceRole,
  auditRows,
  auditTrail,
  consumeToken,
  createPortalAuthUser,
  fakeDni,
  insertRawToken,
  issueToken,
  linkNewAccount,
  peekToken,
  portalWorld,
  submitRequest,
  tokenRow,
  visibleMemberIds,
} from './portal-fixtures'

/**
 * App de socios, S2-T4 (base): CUENTAS, VÍNCULOS Y PERMISOS contra el Postgres local.
 *   - `portal_member_ids()` (vista por `portal_me()`): vínculo directo; todo el grupo solo con family_scope y derivado
 *     en el momento (el hermano que entra aparece, el que sale desaparece); nada con el vínculo revocado o la cuenta
 *     bloqueada; el corte vale al instante con la sesión viva;
 *   - reglas del canje: DNI único entre cuentas activas, DNI del propio socio en un vínculo "self", un socio es "self" de
 *     una sola cuenta, un usuario del panel nunca es cuenta, una invitación a quien ya tiene cuenta SUMA vínculos;
 *   - matriz de permisos por rol (admin / editor / consulta / sin rol / anon / rol leído de user_metadata) para cada RPC
 *     del panel, el enlace de ingreso solo admin, y las lecturas de las cinco tablas;
 *   - revocar y bloquear: efecto, motivo, actor en la auditoría y guards de las tablas (nada se borra).
 *
 * Todo inventado, todo dentro de `withRollback`.
 */
const dbAvailable = await isDbAvailable()
if (!dbAvailable) {
  console.warn('[tests/db] Postgres local no responde: se saltean los tests de tests/db/.')
}

type World = Awaited<ReturnType<typeof portalWorld>>

async function asUser<T>(client: ClientBase, userId: string, fn: () => Promise<T>, pgRole: 'authenticated' | 'anon' = 'authenticated', extraClaims?: Record<string, unknown>): Promise<T> {
  await actAs(client, userId, { pgRole, extraClaims })
  try {
    return await fn()
  } finally {
    await actAsSuperuser(client)
  }
}

/** Corre una RPC del panel como `userId` y devuelve el error redactado ({code, message}) o null si prosperó. */
async function rpcError(client: ClientBase, userId: string, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string } | null> {
  await actAs(client, userId)
  await client.query('savepoint rpc_try')
  try {
    await client.query(sql, params)
    await client.query('release savepoint rpc_try')
    return null
  } catch (err) {
    await client.query('rollback to savepoint rpc_try')
    return err as { code?: string; message: string }
  } finally {
    await actAsSuperuser(client)
  }
}

async function account(client: ClientBase, userId: string) {
  const res = await client.query(`select * from public.portal_accounts where user_id = $1`, [userId])
  return res.rows[0] as {
    user_id: string
    first_name: string
    last_name: string
    dni: string
    phone_e164: string | null
    status: string
    blocked_reason: string | null
    blocked_at: Date | null
    blocked_by: string | null
    password_set_at: Date | null
    terms_accepted_at: Date
  }
}

async function links(client: ClientBase, userId: string) {
  const res = await client.query(
    `select id, member_id, relationship, family_scope, token_id, linked_by, revoked_at, revoked_by, revoke_reason from public.portal_account_members where account_id = $1 order by id`,
    [userId],
  )
  return res.rows as Array<{
    id: string
    member_id: string
    relationship: string
    family_scope: boolean
    token_id: string | null
    linked_by: string | null
    revoked_at: Date | null
    revoked_by: string | null
    revoke_reason: string | null
  }>
}

/** Los socios que devuelve `private.portal_member_ids()` para esa sesión, llamando a la función directo (sin pasar por portal_me). */
async function memberIdsDirect(client: ClientBase, userId: string): Promise<number[]> {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
  try {
    const res = await client.query<{ m: string }>(`select m from private.portal_member_ids() as t(m) order by m`)
    return res.rows.map((r) => Number(r.m))
  } finally {
    await actAsSuperuser(client)
  }
}

async function block(client: ClientBase, actorId: string, userId: string, reason = 'Cuenta bloqueada en la prueba') {
  await asUser(client, actorId, () => client.query(`select public.set_portal_account_status($1::uuid, 'blocked', $2::text)`, [userId, reason]))
}
async function unblock(client: ClientBase, actorId: string, userId: string) {
  await asUser(client, actorId, () => client.query(`select public.set_portal_account_status($1::uuid, 'active', 'Se desbloquea en la prueba')`, [userId]))
}
async function revokeLink(client: ClientBase, actorId: string, linkId: number, reason = 'Vínculo revocado en la prueba') {
  await asUser(client, actorId, () => client.query(`select public.revoke_portal_link($1::bigint, $2::text)`, [linkId, reason]))
}

// ---------------------------------------------------------------------------
// Quién ve a quién
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('portal_member_ids(): a qué socios llega una cuenta', () => {
  it('vínculo directo sin family_scope: solo ese socio, no su hermano ni nadie más', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, relationship: 'guardian', familyScope: false })
      expect(await visibleMemberIds(client, a.userId)).toEqual([w.memberId])
      expect(await memberIdsDirect(client, a.userId)).toEqual([w.memberId])
    })
  })

  it('con family_scope: todo el grupo (ancla incluida), y ningún socio de otro grupo ni sin grupo', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: true })
      expect(await visibleMemberIds(client, a.userId)).toEqual([w.memberId, w.siblingId].sort((x, y) => x - y))
      expect(await memberIdsDirect(client, a.userId)).toEqual([w.memberId, w.siblingId].sort((x, y) => x - y))
    })
  })

  it('family_scope con un socio SIN grupo: no hay grupo que derivar, ve solo al ancla (y create_portal_token ya lo impide)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      // El camino normal lo rechaza ("El socio no tiene grupo familiar")...
      await actAs(client, w.adminId)
      const err = await expectQueryError(client, `select * from public.create_portal_token('invite', 'qr', $1::bigint, true, 'guardian')`, [w.soloId])
      await actAsSuperuser(client)
      expect(err.message).toBe('El socio no tiene grupo familiar')
      // ... y aunque alguien insertara el vínculo a mano, la derivación no se rompe: un grupo nulo no empareja con otros sin grupo.
      const userId = await createPortalAuthUser(client)
      await client.query(
        `insert into public.portal_accounts (user_id, first_name, last_name, dni, terms_accepted_at) values ($1, 'Fulana', 'Inventada', $2, now())`,
        [userId, fakeDni()],
      )
      await client.query(`insert into public.portal_account_members (account_id, member_id, relationship, family_scope) values ($1, $2, 'guardian', true)`, [userId, w.soloId])
      expect(await visibleMemberIds(client, userId), 'el socio sin grupo no arrastra a los demás sin grupo').toEqual([w.soloId])
    })
  })

  it('el socio que se suma al grupo DESPUÉS aparece solo; el que sale o se muda a otro grupo deja de verse (derivado, no materializado)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: true })
      const sorted = (...ids: number[]) => ids.sort((x, y) => x - y)
      expect(await visibleMemberIds(client, a.userId)).toEqual(sorted(w.memberId, w.siblingId))

      // La Comisión agrega a Carla (antes sin grupo) al grupo en marzo.
      await client.query(`update public.members set family_group_id = $2 where id = $1`, [w.soloId, w.groupId])
      expect(await visibleMemberIds(client, a.userId), 'apareció sin tocar nada de la cuenta').toEqual(sorted(w.memberId, w.siblingId, w.soloId))
      expect(await memberIdsDirect(client, a.userId)).toEqual(sorted(w.memberId, w.siblingId, w.soloId))

      // Beto sale del grupo.
      await client.query(`update public.members set family_group_id = null where id = $1`, [w.siblingId])
      expect(await visibleMemberIds(client, a.userId)).toEqual(sorted(w.memberId, w.soloId))

      // Carla se muda a otro grupo.
      const other = await createFamilyGroup(client, { name: 'Otro Grupo Ficticio' })
      await client.query(`update public.members set family_group_id = $2 where id = $1`, [w.soloId, other])
      expect(await visibleMemberIds(client, a.userId)).toEqual([w.memberId])

      // No se materializó ninguna fila por hermano: sigue habiendo UN vínculo.
      expect((await links(client, a.userId)).length).toBe(1)
    })
  })

  it('la relación que informa portal_me: la del vínculo para el ancla, "family" para quien se ve por el grupo; y solo expone los campos previstos', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, relationship: 'guardian', familyScope: true })
      await actAs(client, a.userId)
      const res = await client.query(`select public.portal_me() as me`)
      await actAsSuperuser(client)
      const me = res.rows[0].me as { members: Array<Record<string, unknown>> } & Record<string, unknown>
      expect(Object.keys(me).sort(), 'ni DNI, ni teléfono, ni nada que no esté en el contrato').toEqual(['first_name', 'has_password', 'has_verified_email', 'last_name', 'members'])
      expect(me.has_password).toBe(false)
      expect(me.has_verified_email).toBe(false)
      const byId = new Map(me.members.map((m) => [m.member_id as number, m]))
      expect(byId.get(w.memberId)?.relationship).toBe('guardian')
      expect(byId.get(w.siblingId)?.relationship).toBe('family')
      for (const m of me.members) {
        expect(Object.keys(m).sort()).toEqual(['family_group_id', 'first_name', 'is_active', 'last_name', 'member_id', 'relationship'])
        expect(m.is_active).toBe(true)
        expect(m.family_group_id).toBe(w.groupId)
      }
    })
  })

  it('un socio dado de baja sigue visible para su cuenta, marcado is_active = false (el estado de cuenta de un ex socio sigue siendo suyo)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: true })
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-03-01', 'Motivo ficticio de baja')`,
        [w.siblingId],
      )
      await actAs(client, a.userId)
      const res = await client.query(`select public.portal_me() as me`)
      await actAsSuperuser(client)
      const sib = (res.rows[0].me.members as Array<{ member_id: number; is_active: boolean }>).find((m) => m.member_id === w.siblingId)
      expect(sib?.is_active).toBe(false)
    })
  })

  it('vínculo revocado: la cuenta deja de ver ese socio (y su grupo si era el de family_scope) al instante; la fila queda con quién y por qué', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: true })
      expect((await visibleMemberIds(client, a.userId)).length).toBe(2)
      await revokeLink(client, w.editorId, a.linkId, '  La familia se mudó de club  ')
      expect(await visibleMemberIds(client, a.userId)).toEqual([])
      expect(await memberIdsDirect(client, a.userId)).toEqual([])
      const [link] = await links(client, a.userId)
      expect(link.revoked_by).toBe(w.editorId)
      expect(link.revoke_reason).toBe('La familia se mudó de club')
      expect(link.revoked_at).not.toBeNull()
    })
  })

  it('revocar el vínculo con family_scope no afecta a un vínculo directo que la cuenta tiene con otro socio', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: true })
      const second = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr' })
      expect((await consumeToken(client, second.token, a.userId)).status, 'una invitación a quien ya tiene cuenta suma vínculos').toBe('ok')
      expect((await visibleMemberIds(client, a.userId)).length).toBe(3)
      await revokeLink(client, w.adminId, a.linkId)
      expect(await visibleMemberIds(client, a.userId)).toEqual([w.soloId])
    })
  })

  it('cuenta bloqueada: portal_me() es null y no ve a nadie, con la sesión viva; desbloquear lo devuelve', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: true })
      await actAs(client, a.userId)
      const before = await client.query(`select public.portal_me() as me`)
      expect(before.rows[0].me).not.toBeNull()

      await actAsSuperuser(client)
      await block(client, w.adminId, a.userId)
      // Misma sesión, mismo JWT: el corte es de la base, no de la sesión.
      await actAs(client, a.userId)
      const during = await client.query(`select public.portal_me() as me`)
      expect(during.rows[0].me).toBeNull()
      await actAsSuperuser(client)
      expect(await memberIdsDirect(client, a.userId)).toEqual([])

      await unblock(client, w.adminId, a.userId)
      expect((await visibleMemberIds(client, a.userId)).length).toBe(2)
    })
  })

  it('dos cuentas (madre y padre) sobre el mismo socio: las dos lo ven; revocar una no toca a la otra', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const madre = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const padre = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      expect(await visibleMemberIds(client, madre.userId)).toEqual([w.memberId])
      expect(await visibleMemberIds(client, padre.userId)).toEqual([w.memberId])
      await revokeLink(client, w.adminId, madre.linkId)
      expect(await visibleMemberIds(client, madre.userId)).toEqual([])
      expect(await visibleMemberIds(client, padre.userId)).toEqual([w.memberId])
    })
  })

  it('una sesión sin cuenta (huérfano, usuario del panel de cualquier rol) no ve a nadie: portal_me() es null y portal_member_ids() vacío', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: true })
      for (const id of [w.orphanId, w.adminId, w.editorId, w.consultaId]) {
        expect(await visibleMemberIds(client, id)).toEqual([])
        expect(await memberIdsDirect(client, id)).toEqual([])
      }
      // Y sin sesión (auth.uid() null) tampoco.
      await client.query(`select set_config('request.jwt.claims', '', true)`)
      const none = await client.query(`select count(*)::int as n from private.portal_member_ids()`)
      expect(none.rows[0].n).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('portal_mark_password_set(): marca, no recibe contraseñas', () => {
  it('marca password_set_at solo en la cuenta de la sesión y se refleja en portal_me; la auditoría registra a la cuenta como actor', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const b = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId })
      expect((await account(client, a.userId)).password_set_at).toBeNull()
      await asUser(client, a.userId, () => client.query(`select public.portal_mark_password_set()`))
      expect((await account(client, a.userId)).password_set_at).not.toBeNull()
      expect((await account(client, b.userId)).password_set_at, 'la otra cuenta no se toca').toBeNull()
      await actAs(client, a.userId)
      const me = await client.query(`select public.portal_me() as me`)
      await actAsSuperuser(client)
      expect(me.rows[0].me.has_password).toBe(true)

      const audit = await auditRows(client, 'portal_accounts', a.userId)
      expect(auditTrail(audit)).toEqual([
        ['INSERT', a.userId, 'explicit'],
        ['UPDATE', a.userId, 'session'],
      ])
      expect(audit[1].changed_fields).toEqual(['password_set_at'])
      // Y en la fila auditada no hay nada parecido a una contraseña ni a un hash.
      expect(JSON.stringify(audit)).not.toMatch(/password_hash|encrypted_password/)
    })
  })

  it('sin cuenta activa (huérfano, panel, cuenta bloqueada) tira 42501 y no cambia nada', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const blocked = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      await block(client, w.adminId, blocked.userId)
      for (const id of [w.orphanId, w.adminId, w.consultaId, blocked.userId]) {
        const err = await rpcError(client, id, `select public.portal_mark_password_set()`)
        expect(err, `esperaba 42501 para ${id}`).toMatchObject({ code: '42501', message: 'No hay una cuenta activa en esta sesión' })
      }
      expect((await account(client, blocked.userId)).password_set_at).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// Canje: reglas de la cuenta
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('canje de una invitación: nace la cuenta y el vínculo', () => {
  it('crea la cuenta con los datos recortados, el vínculo con la relación y el alcance de la invitación, y guarda quién invitó', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.editorId, { memberId: w.memberId, delivery: 'qr', familyScope: true, relationship: 'guardian' })
      const userId = await createPortalAuthUser(client)
      const dni = fakeDni()
      const res = await consumeToken(client, t.token, userId, { firstName: '  Marta ', lastName: ' Inventada  ', personDni: dni, phoneE164: '+5493511234567' })
      expect(res).toEqual({ status: 'ok', account_id: userId })

      const acct = await account(client, userId)
      expect(acct).toMatchObject({ first_name: 'Marta', last_name: 'Inventada', dni, phone_e164: '+5493511234567', status: 'active', blocked_reason: null, password_set_at: null })
      expect(acct.terms_accepted_at).not.toBeNull()

      const [link] = await links(client, userId)
      expect(link).toMatchObject({ member_id: String(w.memberId), relationship: 'guardian', family_scope: true, token_id: String(t.tokenId), linked_by: w.editorId, revoked_at: null })
    })
  })

  it('faltan datos (nombre, apellido, DNI de la persona, aceptar los términos, o DNI mal formado): missing_data y la invitación NO se gasta', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr' })
      const userId = await createPortalAuthUser(client)
      const bad = [
        { firstName: null },
        { lastName: null },
        { personDni: null },
        { termsAccepted: false },
        { personDni: '123456' },
        { personDni: '123456789' },
        { personDni: '12.345.678' },
        { personDni: '1234567a' },
      ] as const
      for (const o of bad) {
        expect((await consumeToken(client, t.token, userId, o)).status, JSON.stringify(o)).toBe('missing_data')
      }
      expect((await peekToken(client, t.token)).status, 'la invitación sigue viva').toBe('ok')
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [userId])).rows[0].n).toBe(0)
      expect((await tokenRow(client, t.tokenId)).consumed_at).toBeNull()
    })
  })

  it('p_user_id nulo es un error (check_violation), no un canje', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr' })
      await actAsServiceRole(client)
      const err = await expectQueryError(client, `select * from public.portal_token_consume($1::text, null, null, 'A', 'B', '12345678', null, true)`, [t.token])
      await actAsSuperuser(client)
      expect(err).toMatchObject({ code: '23514', message: 'Falta el usuario' })
    })
  })
})

describe.skipIf(!dbAvailable)('un DNI, una cuenta (dni_has_account)', () => {
  it('con un DNI que ya tiene una cuenta activa: dni_has_account, la invitación NO se consume y no nace la segunda cuenta', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const first = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const invite = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr' })
      const second = await createPortalAuthUser(client)
      expect((await consumeToken(client, invite.token, second, { personDni: first.dni })).status).toBe('dni_has_account')
      expect((await peekToken(client, invite.token)).status, 'la invitación sigue viva para abrirla con la sesión iniciada').toBe('ok')
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [second])).rows[0].n).toBe(0)
    })
  })

  it('el índice único lo hace cumplir también por debajo: dos cuentas activas con el mismo DNI son 23505; una bloqueada no cuenta', async () => {
    await withRollback(async (client) => {
      const dni = fakeDni()
      const [u1, u2, u3] = [await createPortalAuthUser(client), await createPortalAuthUser(client), await createPortalAuthUser(client)]
      const insert = (id: string) =>
        client.query(`insert into public.portal_accounts (user_id, first_name, last_name, dni, terms_accepted_at) values ($1, 'Ana', 'Inventada', $2, now())`, [id, dni])
      await insert(u1)
      const dup = await expectQueryError(client, `insert into public.portal_accounts (user_id, first_name, last_name, dni, terms_accepted_at) values ($1, 'Ana', 'Inventada', $2, now())`, [u2, dni])
      expect(dup.code).toBe('23505')
      expect(dup.message).toMatch(/portal_accounts_dni_key/)

      // Bloqueada la primera, el DNI queda libre para una cuenta nueva...
      await client.query(`update public.portal_accounts set status = 'blocked', blocked_at = now(), blocked_reason = 'Motivo de prueba' where user_id = $1`, [u1])
      await insert(u2)
      // ... y desbloquear la vieja choca con la nueva.
      const back = await expectQueryError(client, `update public.portal_accounts set status = 'active', blocked_at = null, blocked_reason = null where user_id = $1`, [u1])
      expect(back.code).toBe('23505')
      void u3
    })
  })

  it('desbloquear por la RPC cuando otra cuenta activa tomó el DNI mientras tanto falla (unique_violation) y la cuenta sigue bloqueada', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const old = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      await block(client, w.adminId, old.userId)
      // La misma persona vuelve con otro usuario de Auth y toma su DNI (el DNI de una bloqueada no cuenta).
      const again = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId, dni: old.dni })
      expect(again.userId).not.toBe(old.userId)
      const err = await rpcError(client, w.adminId, `select public.set_portal_account_status($1::uuid, 'active', 'Se desbloquea en la prueba')`, [old.userId])
      expect(err?.code).toBe('23505')
      expect((await account(client, old.userId)).status).toBe('blocked')
    })
  })

  it('formato y datos mínimos de la cuenta se verifican en la tabla (DNI de 7 u 8 dígitos, nombres no vacíos, teléfono E.164, bloqueo con motivo)', async () => {
    await withRollback(async (client) => {
      const insert = async (over: Partial<Record<'dni' | 'first' | 'phone', string | null>>) => {
        const userId = await createPortalAuthUser(client)
        return expectQueryError(
          client,
          `insert into public.portal_accounts (user_id, first_name, last_name, dni, phone_e164, terms_accepted_at) values ($1, $2, 'Inventada', $3, $4, now())`,
          [userId, over.first ?? 'Ana', over.dni ?? fakeDni(), over.phone ?? null],
        )
      }
      expect((await insert({ dni: '123456' })).code).toBe('23514')
      expect((await insert({ dni: '123456789' })).code).toBe('23514')
      expect((await insert({ dni: '12.345.678' })).code).toBe('23514')
      expect((await insert({ first: '   ' })).code).toBe('23514')
      expect((await insert({ phone: '3511234567' })).code, 'el teléfono guardado es E.164').toBe('23514')

      const userId = await createPortalAuthUser(client)
      await client.query(`insert into public.portal_accounts (user_id, first_name, last_name, dni, terms_accepted_at) values ($1, 'Ana', 'Inventada', $2, now())`, [userId, fakeDni()])
      const noReason = await expectQueryError(client, `update public.portal_accounts set status = 'blocked', blocked_at = now() where user_id = $1`, [userId])
      expect(noReason.message).toMatch(/portal_accounts_blocked_has_reason/)
      const inconsistent = await expectQueryError(client, `update public.portal_accounts set blocked_at = now() where user_id = $1`, [userId])
      expect(inconsistent.message, 'activa con blocked_at: incoherente').toMatch(/portal_accounts_blocked_has_reason/)
    })
  })
})

describe.skipIf(!dbAvailable)('vínculo "self": el socio con DNI cargado solo se vincula con ese DNI', () => {
  it('self con un DNI distinto al del socio: self_dni_mismatch y la invitación no se gasta; con el DNI del socio: ok', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr', relationship: 'self' })
      const userId = await createPortalAuthUser(client)
      expect((await consumeToken(client, t.token, userId, { personDni: fakeDni() })).status).toBe('self_dni_mismatch')
      expect((await peekToken(client, t.token)).status).toBe('ok')
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [userId])).rows[0].n).toBe(0)

      expect(await consumeToken(client, t.token, userId, { personDni: w.soloDni })).toEqual({ status: 'ok', account_id: userId })
      const [link] = await links(client, userId)
      expect(link.relationship).toBe('self')
    })
  })

  it('self sobre un socio SIN DNI cargado: se acepta cualquier DNI de la persona (no hay contra qué comparar)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr', relationship: 'self' })
      expect((await consumeToken(client, t.token, await createPortalAuthUser(client), { personDni: fakeDni() })).status).toBe('ok')
    })
  })

  it('guardian sobre un socio con DNI NO exige que coincida (la madre no tiene el DNI del hijo)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr', relationship: 'guardian' })
      expect((await consumeToken(client, t.token, await createPortalAuthUser(client), { personDni: fakeDni() })).status).toBe('ok')
    })
  })

  it('una cuenta que ya existe usa SU DNI para la regla self (no el que mande la app): si no coincide con el socio, self_dni_mismatch', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const mom = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const t = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr', relationship: 'self' })
      // La app manda el DNI del socio en personDni, pero la cuenta ya existe con otro: manda el de la cuenta.
      expect((await consumeToken(client, t.token, mom.userId, { personDni: w.soloDni })).status).toBe('self_dni_mismatch')
      expect((await links(client, mom.userId)).length).toBe(1)
    })
  })

  it('member_has_self_account: un socio es "self" de UNA sola cuenta; una segunda invitación self falla sin gastarse; guardian sí se puede; revocado el self, otra cuenta puede', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const first = await linkNewAccount(client, { adminId: w.adminId, memberId: w.noDniId, relationship: 'self' })

      const second = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr', relationship: 'self' })
      const other = await createPortalAuthUser(client)
      expect((await consumeToken(client, second.token, other, { personDni: fakeDni() })).status).toBe('member_has_self_account')
      expect((await peekToken(client, second.token)).status).toBe('ok')
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [other])).rows[0].n).toBe(0)

      // Un tutor sobre el mismo socio sí.
      const guardian = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr', relationship: 'guardian', replacePending: false })
      expect((await consumeToken(client, guardian.token, other, { personDni: fakeDni() })).status).toBe('ok')

      // Revocado el self, otra cuenta puede ser "self".
      await revokeLink(client, w.adminId, first.linkId)
      const third = await createPortalAuthUser(client)
      expect((await consumeToken(client, second.token, third, { personDni: fakeDni() })).status).toBe('ok')
    })
  })

  it('el índice único de "self" también lo hace cumplir por debajo (23505)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      await linkNewAccount(client, { adminId: w.adminId, memberId: w.noDniId, relationship: 'self' })
      const other = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId, relationship: 'guardian' })
      const err = await expectQueryError(client, `insert into public.portal_account_members (account_id, member_id, relationship) values ($1, $2, 'self')`, [other.userId, w.noDniId])
      expect(err.code).toBe('23505')
      expect(err.message).toMatch(/portal_account_members_one_self/)
      // Y un mismo par cuenta-socio no se vincula dos veces mientras esté vigente.
      const dup = await expectQueryError(client, `insert into public.portal_account_members (account_id, member_id, relationship) values ($1, $2, 'guardian')`, [other.userId, w.soloId])
      expect(dup.message).toMatch(/portal_account_members_active_key/)
    })
  })
})

describe.skipIf(!dbAvailable)('un usuario del panel nunca es una cuenta de la app (staff_account)', () => {
  it('con cualquier rol del panel: staff_account, la invitación sigue viva, no nace cuenta ni vínculo y app_users no cambia', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr' })
      const appUsersBefore = await client.query(`select count(*)::int as n, md5(string_agg(u::text, '|' order by user_id)) as h from public.app_users u`)
      for (const staffId of [w.adminId, w.editorId, w.consultaId]) {
        expect(await consumeToken(client, t.token, staffId, { personDni: fakeDni() })).toEqual({ status: 'staff_account', account_id: null })
        expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [staffId])).rows[0].n).toBe(0)
        expect((await client.query(`select count(*)::int as n from public.portal_account_members where account_id = $1`, [staffId])).rows[0].n).toBe(0)
      }
      expect((await peekToken(client, t.token)).status, 'el token no se gastó').toBe('ok')
      const after = await client.query(`select count(*)::int as n, md5(string_agg(u::text, '|' order by user_id)) as h from public.app_users u`)
      expect(after.rows[0]).toEqual(appUsersBefore.rows[0])
    })
  })

  it('también un usuario del panel INACTIVO sigue siendo del panel (la fila existe): staff_account', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const ex = await createUserWithRole(client, 'editor', { isActive: false })
      const t = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr' })
      expect((await consumeToken(client, t.token, ex.userId, { personDni: fakeDni() })).status).toBe('staff_account')
    })
  })

  it('un enlace de ingreso tampoco lo canjea un usuario del panel', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.noDniId })
      const login = await issueToken(client, w.adminId, { purpose: 'login', accountId: a.userId, delivery: 'qr' })
      expect((await consumeToken(client, login.token, w.adminId)).status).toBe('staff_account')
      expect((await peekToken(client, login.token)).status).toBe('ok')
    })
  })
})

describe.skipIf(!dbAvailable)('enlace de ingreso: es para UNA cuenta y una cuenta activa', () => {
  it('canjearlo con otro usuario es account_mismatch y no se gasta; con la cuenta correcta, ok', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const login = await issueToken(client, w.adminId, { purpose: 'login', accountId: a.userId, delivery: 'qr' })
      const stranger = await createPortalAuthUser(client)
      expect((await consumeToken(client, login.token, stranger)).status).toBe('account_mismatch')
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [stranger])).rows[0].n).toBe(0)
      expect((await peekToken(client, login.token)).status).toBe('ok')
      expect(await consumeToken(client, login.token, a.userId)).toEqual({ status: 'ok', account_id: a.userId })
      expect((await tokenRow(client, login.tokenId)).consumed_by).toBe(a.userId)
    })
  })

  it('bloquear la cuenta revoca sus enlaces de ingreso pendientes; y si igual hubiera uno vivo (insertado a mano), el canje da account_blocked', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const login = await issueToken(client, w.adminId, { purpose: 'login', accountId: a.userId, delivery: 'qr' })
      await block(client, w.adminId, a.userId)
      const row = await tokenRow(client, login.tokenId)
      expect(row.revoked_at).not.toBeNull()
      expect(row.revoke_reason).toBe('Cuenta bloqueada')
      expect(row.revoked_by).toBe(w.adminId)
      expect((await consumeToken(client, login.token, a.userId)).status).toBe('invalid')

      await insertRawToken(client, { token: 'tok-ingreso-a-mano', createdBy: w.adminId, purpose: 'login', accountId: a.userId, relationship: null, delivery: 'qr' })
      expect(await consumeToken(client, 'tok-ingreso-a-mano', a.userId)).toEqual({ status: 'account_blocked', account_id: null })
      expect((await peekToken(client, 'tok-ingreso-a-mano')).status, 'peek no mira la cuenta: lo frena el canje').toBe('ok')
    })
  })

  it('bloquear no toca las invitaciones sin canjear de los socios, ni los enlaces de otra cuenta', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const b = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId })
      const invite = await issueToken(client, w.adminId, { memberId: w.siblingId })
      const loginB = await issueToken(client, w.adminId, { purpose: 'login', accountId: b.userId, delivery: 'qr' })
      await block(client, w.adminId, a.userId)
      expect((await tokenRow(client, invite.tokenId)).revoked_at).toBeNull()
      expect((await tokenRow(client, loginB.tokenId)).revoked_at).toBeNull()
    })
  })
})

describe.skipIf(!dbAvailable)('invitar a quien ya tiene cuenta: suma vínculos, no crea otra cuenta', () => {
  it('una invitación por otro hijo, abierta con la sesión de la cuenta existente, agrega el vínculo y deja UNA sola cuenta', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const t = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr', relationship: 'guardian' })
      expect(await consumeToken(client, t.token, a.userId, { personDni: fakeDni(), firstName: 'OtroNombre' })).toEqual({ status: 'ok', account_id: a.userId })
      const acct = await account(client, a.userId)
      expect(acct.first_name, 'los datos de la cuenta existente no se pisan con los que manda la app').toBe('Persona')
      expect(acct.dni).toBe(a.dni)
      const all = await links(client, a.userId)
      expect(all.filter((l) => l.revoked_at === null).map((l) => Number(l.member_id)).sort((x, y) => x - y)).toEqual([w.memberId, w.soloId].sort((x, y) => x - y))
    })
  })

  it('una invitación con family_scope a un socio ya vinculado SIN scope amplía el vínculo: el viejo se revoca (queda la historia) y nace uno nuevo con scope', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: false })
      expect(await visibleMemberIds(client, a.userId)).toEqual([w.memberId])
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr', familyScope: true, relationship: 'guardian' })
      expect((await consumeToken(client, t.token, a.userId)).status).toBe('ok')
      const all = await links(client, a.userId)
      expect(all).toHaveLength(2)
      expect(all[0]).toMatchObject({ family_scope: false, revoke_reason: 'Reemplazado por una invitación nueva', revoked_by: a.userId })
      expect(all[0].revoked_at).not.toBeNull()
      expect(all[1]).toMatchObject({ family_scope: true, revoked_at: null, token_id: String(t.tokenId) })
      expect(await visibleMemberIds(client, a.userId)).toEqual([w.memberId, w.siblingId].sort((x, y) => x - y))
    })
  })

  it('una invitación SIN scope a quien ya tiene scope no lo reduce: el vínculo sigue igual y la invitación se gasta', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, familyScope: true })
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr', familyScope: false, relationship: 'guardian' })
      expect((await consumeToken(client, t.token, a.userId)).status).toBe('ok')
      const all = await links(client, a.userId)
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({ family_scope: true, revoked_at: null })
      expect((await tokenRow(client, t.tokenId)).consumed_by).toBe(a.userId)
      expect((await visibleMemberIds(client, a.userId)).length).toBe(2)
    })
  })

  it('la cuenta bloqueada no suma vínculos (account_blocked) y la invitación no se gasta', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      await block(client, w.adminId, a.userId)
      const t = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr' })
      expect(await consumeToken(client, t.token, a.userId)).toEqual({ status: 'account_blocked', account_id: null })
      expect((await peekToken(client, t.token)).status).toBe('ok')
      expect((await links(client, a.userId)).length).toBe(1)
    })
  })
})

describe.skipIf(!dbAvailable)('canje y pedido de acceso', () => {
  it('canjear una invitación que salió de un pedido lo pasa a completed, y conserva quién lo invitó', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      const t = await issueToken(client, w.editorId, { memberId: w.noDniId, delivery: 'qr', requestId })
      const invited = await client.query(`select status, resolved_by from public.portal_access_requests where id = $1`, [requestId])
      expect(invited.rows[0]).toEqual({ status: 'invited', resolved_by: w.editorId })
      expect((await consumeToken(client, t.token, await createPortalAuthUser(client))).status).toBe('ok')
      const done = await client.query(`select status, resolved_by, resolved_at from public.portal_access_requests where id = $1`, [requestId])
      expect(done.rows[0].status).toBe('completed')
      expect(done.rows[0].resolved_by).toBe(w.editorId)
    })
  })

  it('un pedido rechazado después de invitar sigue rechazado aunque la invitación se canjee (rejected es final)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      const t = await issueToken(client, w.editorId, { memberId: w.noDniId, delivery: 'qr', requestId })
      await asUser(client, w.editorId, () => client.query(`select public.resolve_portal_request($1::bigint, 'rejected', 'Era un pedido repetido')`, [requestId]))
      await consumeToken(client, t.token, await createPortalAuthUser(client))
      const row = await client.query(`select status from public.portal_access_requests where id = $1`, [requestId])
      expect(row.rows[0].status).toBe('rejected')
    })
  })
})

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('permisos: el catálogo por rol', () => {
  it('portal.review y portal.invite: admin y editor; portal.login_link: SOLO admin; consulta, un rol desconocido y null: nada', async () => {
    await withRollback(async (client) => {
      const perms = async (role: string | null) => (await client.query(`select private.permissions_for_role($1::text) as p`, [role])).rows[0].p as string[]
      const portal = (list: string[]) => list.filter((p) => p.startsWith('portal.')).sort()
      expect(portal(await perms('admin'))).toEqual(['portal.invite', 'portal.login_link', 'portal.review'])
      expect(portal(await perms('editor'))).toEqual(['portal.invite', 'portal.review'])
      expect(portal(await perms('consulta'))).toEqual([])
      expect(portal(await perms('socio'))).toEqual([])
      expect(await perms('portal')).toEqual([])
      expect(await perms(null)).toEqual([])
    })
  })

  it('my_permissions() devuelve lo mismo por la sesión: el editor no ve portal.login_link, la cuenta de la app ve []', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const mine = async (id: string) => {
        await actAs(client, id)
        const r = await client.query(`select public.my_permissions() as p`)
        await actAsSuperuser(client)
        return (r.rows[0].p as string[]).filter((p) => p.startsWith('portal.')).sort()
      }
      expect(await mine(w.adminId)).toEqual(['portal.invite', 'portal.login_link', 'portal.review'])
      expect(await mine(w.editorId)).toEqual(['portal.invite', 'portal.review'])
      expect(await mine(w.consultaId)).toEqual([])
      expect(await mine(a.userId)).toEqual([])
      expect(await mine(w.orphanId)).toEqual([])
    })
  })
})

type Matrix = { rpc: string; allowed: Array<keyof Roles>; call: (w: World, f: Fixtures) => { sql: string; params: unknown[] } }
type Roles = { admin: string; editor: string; consulta: string; orphan: string; portalAccount: string }
type Fixtures = { accountId: string; linkId: number; inviteTokenId: number; loginTokenId: number; requestId: number }

describe.skipIf(!dbAvailable)('permisos: matriz por rol de cada RPC del panel (y anon)', () => {
  const MATRIX: Matrix[] = [
    {
      rpc: 'create_portal_token (invite)',
      allowed: ['admin', 'editor'],
      call: (w) => ({ sql: `select * from public.create_portal_token('invite', 'qr', $1::bigint, false, 'guardian')`, params: [w.noDniId] }),
    },
    {
      rpc: 'create_portal_token (login): solo admin',
      allowed: ['admin'],
      call: (_w, f) => ({ sql: `select * from public.create_portal_token('login', 'qr', null, false, null, $1::uuid)`, params: [f.accountId] }),
    },
    {
      rpc: 'revoke_portal_token (de una invitación)',
      allowed: ['admin', 'editor'],
      call: (_w, f) => ({ sql: `select public.revoke_portal_token($1::bigint, 'Motivo de prueba')`, params: [f.inviteTokenId] }),
    },
    {
      rpc: 'revoke_portal_token (de un enlace de ingreso): solo admin',
      allowed: ['admin'],
      call: (_w, f) => ({ sql: `select public.revoke_portal_token($1::bigint, 'Motivo de prueba')`, params: [f.loginTokenId] }),
    },
    {
      rpc: 'portal_request_candidates',
      allowed: ['admin', 'editor'],
      call: (_w, f) => ({ sql: `select * from public.portal_request_candidates($1::bigint)`, params: [f.requestId] }),
    },
    {
      rpc: 'resolve_portal_request (rechazar)',
      allowed: ['admin', 'editor'],
      call: (_w, f) => ({ sql: `select public.resolve_portal_request($1::bigint, 'rejected', 'Motivo de prueba')`, params: [f.requestId] }),
    },
    {
      rpc: 'revoke_portal_link',
      allowed: ['admin', 'editor'],
      call: (_w, f) => ({ sql: `select public.revoke_portal_link($1::bigint, 'Motivo de prueba')`, params: [f.linkId] }),
    },
    {
      rpc: 'set_portal_account_status (bloquear)',
      allowed: ['admin', 'editor'],
      call: (_w, f) => ({ sql: `select public.set_portal_account_status($1::uuid, 'blocked', 'Motivo de prueba')`, params: [f.accountId] }),
    },
  ]

  async function fixtures(client: ClientBase) {
    const w = await portalWorld(client)
    const acct = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
    const invite = await issueToken(client, w.adminId, { memberId: w.siblingId })
    const login = await issueToken(client, w.adminId, { purpose: 'login', accountId: acct.userId, delivery: 'qr' })
    const { requestId } = await submitRequest(client)
    const roles: Roles = { admin: w.adminId, editor: w.editorId, consulta: w.consultaId, orphan: w.orphanId, portalAccount: acct.userId }
    const f: Fixtures = { accountId: acct.userId, linkId: acct.linkId, inviteTokenId: invite.tokenId, loginTokenId: login.tokenId, requestId: requestId as number }
    return { w, roles, f }
  }

  /** Corre la llamada como ese usuario dentro de un savepoint que SIEMPRE se deshace: cada celda de la matriz parte del mismo estado. */
  async function attempt(client: ClientBase, userId: string, sql: string, params: unknown[], pgRole: 'authenticated' | 'anon' = 'authenticated', extraClaims?: Record<string, unknown>) {
    await actAs(client, userId, { pgRole, extraClaims })
    await client.query('savepoint celda')
    try {
      await client.query(sql, params)
      return { ok: true as const }
    } catch (err) {
      const e = err as { code?: string; message: string }
      return { ok: false as const, code: e.code, message: e.message }
    } finally {
      await client.query('rollback to savepoint celda')
      await actAsSuperuser(client)
    }
  }

  for (const entry of MATRIX) {
    it(`${entry.rpc}: permitido a ${entry.allowed.join(' y ')}; denegado (42501) a los demás, a una cuenta de la app y a anon`, async () => {
      await withRollback(async (client) => {
        const { w, roles, f } = await fixtures(client)
        const { sql, params } = entry.call(w, f)
        for (const role of Object.keys(roles) as Array<keyof Roles>) {
          const res = await attempt(client, roles[role], sql, params)
          if (entry.allowed.includes(role)) expect(res, `${role} tendría que poder: ${JSON.stringify(res)}`).toEqual({ ok: true })
          else expect(res, `${role} no tendría que poder`).toMatchObject({ ok: false, code: '42501' })
        }
        const anon = await attempt(client, randomUUID(), sql, params, 'anon')
        expect(anon, 'anon no tiene EXECUTE').toMatchObject({ ok: false, code: '42501' })
      })
    })
  }

  it('un rol leído de user_metadata / app_metadata del JWT no otorga nada: un huérfano con claims de admin recibe 42501 en toda la matriz', async () => {
    await withRollback(async (client) => {
      const { w, roles, f } = await fixtures(client)
      const claims = { user_metadata: { role: 'admin' }, app_metadata: { role: 'admin', roles: ['admin'] }, user_role: 'admin' }
      for (const entry of MATRIX) {
        const { sql, params } = entry.call(w, f)
        const res = await attempt(client, roles.orphan, sql, params, 'authenticated', claims)
        expect(res, `${entry.rpc} con claims de admin falsos`).toMatchObject({ ok: false, code: '42501' })
      }
    })
  })

  it('un usuario del panel DESACTIVADO, o con el cambio de contraseña pendiente, pierde los permisos del portal al instante', async () => {
    await withRollback(async (client) => {
      const { w, f } = await fixtures(client)
      const inactive = await createUserWithRole(client, 'admin', { isActive: false })
      const mustChange = await createUserWithRole(client, 'admin', { mustChangePassword: true })
      for (const entry of MATRIX) {
        const { sql, params } = entry.call(w, f)
        for (const id of [inactive.userId, mustChange.userId]) {
          expect(await attempt(client, id, sql, params), `${entry.rpc}`).toMatchObject({ ok: false, code: '42501' })
        }
      }
    })
  })

  it('el orden de los chequeos no filtra nada: sin permiso, ni siquiera se distingue un id que existe de uno que no (siempre 42501)', async () => {
    await withRollback(async (client) => {
      const { roles } = await fixtures(client)
      const calls = [
        `select public.revoke_portal_link(999999999, 'Motivo de prueba')`,
        `select * from public.portal_request_candidates(999999999)`,
        `select public.resolve_portal_request(999999999, 'rejected', 'Motivo de prueba')`,
        `select public.set_portal_account_status('${randomUUID()}'::uuid, 'blocked', 'Motivo de prueba')`,
      ]
      for (const sql of calls) {
        const res = await attempt(client, roles.consulta, sql, [])
        expect(res, sql).toMatchObject({ ok: false, code: '42501' })
      }
    })
  })
})

describe.skipIf(!dbAvailable)('permisos: quién lee las cinco tablas del portal (RLS)', () => {
  const TABLES = ['portal_accounts', 'portal_account_members', 'portal_access_tokens', 'portal_access_requests', 'portal_access_request_people']

  it('admin y editor las ven con filas; consulta, un huérfano, una cuenta de la app y anon no ven ninguna fila', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const acct = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      await issueToken(client, w.adminId, { memberId: w.siblingId })
      await submitRequest(client)
      const count = async (userId: string, table: string, pgRole: 'authenticated' | 'anon' = 'authenticated') => {
        await actAs(client, userId, { pgRole })
        await client.query('savepoint lectura')
        try {
          const res = await client.query(`select count(*)::int as n from public.${table}`)
          return Number(res.rows[0].n)
        } catch (err) {
          expect((err as { code?: string }).code).toBe('42501')
          return -1
        } finally {
          await client.query('rollback to savepoint lectura')
          await actAsSuperuser(client)
        }
      }
      for (const table of TABLES) {
        expect(await count(w.adminId, table), `admin ve ${table}`).toBeGreaterThan(0)
        expect(await count(w.editorId, table), `editor ve ${table}`).toBeGreaterThan(0)
        for (const [label, id] of [['consulta', w.consultaId], ['huérfano', w.orphanId], ['cuenta de la app', acct.userId]] as const) {
          expect(await count(id, table), `${label} no ve ${table}`).toBe(0)
        }
        expect(await count(randomUUID(), table, 'anon'), `anon no ve ${table}`).toBe(-1)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Revocar y bloquear: efecto, errores, auditoría, guards
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('revocar un vínculo', () => {
  it('deja fila de auditoría con el actor de la sesión y solo los campos de la revocación', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      await revokeLink(client, w.editorId, a.linkId, 'Motivo de la prueba de auditoría')
      const audit = await auditRows(client, 'portal_account_members', a.linkId)
      expect(auditTrail(audit)).toEqual([
        ['INSERT', a.userId, 'explicit'],
        ['UPDATE', w.editorId, 'session'],
      ])
      expect(audit[1].changed_fields).toEqual(['revoke_reason', 'revoked_at', 'revoked_by'])
      expect(audit[1].new_data?.revoke_reason).toBe('Motivo de la prueba de auditoría')
    })
  })

  it('errores redactados: sin motivo, motivo corto, vínculo inexistente o ya revocado; ninguno cambia nada', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const call = (id: number | string, reason: string) => rpcError(client, w.adminId, `select public.revoke_portal_link($1::bigint, $2::text)`, [id, reason])
      expect(await call(a.linkId, '   ')).toMatchObject({ code: '23514', message: 'Indicá el motivo' })
      expect(await call(a.linkId, 'no')).toMatchObject({ code: '23514', message: 'Indicá el motivo' })
      expect(await call(999999999, 'Motivo de prueba')).toMatchObject({ code: '23514', message: 'El vínculo no existe o ya está revocado' })
      expect((await links(client, a.userId))[0].revoked_at).toBeNull()
      await revokeLink(client, w.adminId, a.linkId)
      expect(await call(a.linkId, 'Motivo de prueba')).toMatchObject({ code: '23514', message: 'El vínculo no existe o ya está revocado' })
    })
  })

  it('revocar es definitivo: volver a vincular es OTRA fila, y la historia queda (nada se borra)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      await revokeLink(client, w.adminId, a.linkId)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr' })
      expect((await consumeToken(client, t.token, a.userId)).status).toBe('ok')
      const all = await links(client, a.userId)
      expect(all).toHaveLength(2)
      expect(all[0].revoked_at).not.toBeNull()
      expect(all[1].revoked_at).toBeNull()
      expect(await visibleMemberIds(client, a.userId)).toEqual([w.memberId])
    })
  })
})

describe.skipIf(!dbAvailable)('bloquear y desbloquear una cuenta', () => {
  it('bloquear guarda quién, cuándo y por qué; desbloquear limpia los tres; las dos cosas auditan al que tenía la sesión', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      await block(client, w.editorId, a.userId, '  Se perdió el teléfono y lo tiene otra persona  ')
      expect(await account(client, a.userId)).toMatchObject({
        status: 'blocked',
        blocked_reason: 'Se perdió el teléfono y lo tiene otra persona',
        blocked_by: w.editorId,
      })
      expect((await account(client, a.userId)).blocked_at).not.toBeNull()
      await unblock(client, w.adminId, a.userId)
      expect(await account(client, a.userId)).toMatchObject({ status: 'active', blocked_reason: null, blocked_by: null, blocked_at: null })

      const audit = await auditRows(client, 'portal_accounts', a.userId)
      expect(auditTrail(audit)).toEqual([
        ['INSERT', a.userId, 'explicit'],
        ['UPDATE', w.editorId, 'session'],
        ['UPDATE', w.adminId, 'session'],
      ])
      expect(audit[1].changed_fields).toEqual(['blocked_at', 'blocked_by', 'blocked_reason', 'status'])
      expect(audit[2].changed_fields).toEqual(['blocked_at', 'blocked_by', 'blocked_reason', 'status'])
    })
  })

  it('errores redactados: estado inválido, sin motivo, cuenta inexistente, ya en ese estado; ninguno cambia nada', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const call = (id: string, status: string, reason: string) =>
        rpcError(client, w.adminId, `select public.set_portal_account_status($1::uuid, $2::text, $3::text)`, [id, status, reason])
      expect(await call(a.userId, 'suspended', 'Motivo de prueba')).toMatchObject({ code: '23514', message: 'Estado inválido' })
      expect(await call(a.userId, 'blocked', ' ')).toMatchObject({ code: '23514', message: 'Indicá el motivo' })
      expect(await call(a.userId, 'blocked', 'ab')).toMatchObject({ code: '23514', message: 'Indicá el motivo' })
      expect(await call(randomUUID(), 'blocked', 'Motivo de prueba')).toMatchObject({ code: 'P0002', message: 'La cuenta no existe' })
      expect(await call(a.userId, 'active', 'Motivo de prueba')).toMatchObject({ code: '23514', message: 'La cuenta ya está en ese estado' })
      expect((await account(client, a.userId)).status).toBe('active')
      await block(client, w.adminId, a.userId)
      expect(await call(a.userId, 'blocked', 'Motivo de prueba')).toMatchObject({ code: '23514', message: 'La cuenta ya está en ese estado' })
    })
  })
})

describe.skipIf(!dbAvailable)('las tablas del portal: nada se escribe ni se borra por fuera de las RPC', () => {
  const TABLES = ['portal_accounts', 'portal_account_members', 'portal_access_tokens', 'portal_access_requests', 'portal_access_request_people']

  it('anon, authenticated y service_role no tienen INSERT, UPDATE, DELETE ni TRUNCATE (a nivel tabla ni de columna) sobre ninguna', async () => {
    await withRollback(async (client) => {
      for (const table of TABLES) {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          for (const priv of ['insert', 'update', 'delete', 'truncate']) {
            const t = await client.query(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${table}`, priv])
            expect(t.rows[0].ok, `${role} tiene ${priv} sobre ${table}`).toBe(false)
          }
          for (const priv of ['insert', 'update']) {
            const c = await client.query(`select has_any_column_privilege($1, $2, $3) as ok`, [role, `public.${table}`, priv])
            expect(c.rows[0].ok, `${role} tiene ${priv} en alguna columna de ${table}`).toBe(false)
          }
        }
        // Y la cola privada de límites no es de nadie más que de postgres.
      }
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const priv of ['select', 'insert', 'update', 'delete']) {
          const r = await client.query(`select has_table_privilege($1, 'private.portal_rate_limits', $2) as ok`, [role, priv])
          expect(r.rows[0].ok, `${role} tiene ${priv} sobre private.portal_rate_limits`).toBe(false)
        }
      }
    })
  })

  it('un admin con JWT real no puede insertar, actualizar ni borrar en ninguna (42501), y las tablas quedan idénticas', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      await issueToken(client, w.adminId, { memberId: w.siblingId })
      await submitRequest(client)
      const snap = async () => {
        const out: string[] = []
        for (const t of TABLES) out.push((await client.query(`select count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h from public.${t} x`)).rows[0].h)
        return out
      }
      const before = await snap()
      await actAs(client, w.adminId)
      const attempts = [
        `insert into public.portal_accounts (user_id, first_name, last_name, dni, terms_accepted_at) values ('${randomUUID()}', 'A', 'B', '${fakeDni()}', now())`,
        `update public.portal_accounts set status = 'blocked', blocked_at = now(), blocked_reason = 'Motivo de prueba' where user_id = '${a.userId}'`,
        `delete from public.portal_accounts`,
        `insert into public.portal_account_members (account_id, member_id, relationship) values ('${a.userId}', ${w.siblingId}, 'guardian')`,
        `update public.portal_account_members set revoked_at = now(), revoke_reason = 'Motivo de prueba'`,
        `delete from public.portal_account_members`,
        `update public.portal_access_tokens set failed_checks = 0`,
        `delete from public.portal_access_tokens`,
        `update public.portal_access_requests set status = 'rejected', resolution_note = 'Motivo de prueba'`,
        `delete from public.portal_access_requests`,
        `delete from public.portal_access_request_people`,
        `update public.portal_access_request_people set first_name = 'X'`,
      ]
      for (const sql of attempts) {
        const err = await expectQueryError(client, sql)
        expect(err.code, sql).toBe('42501')
      }
      await actAsSuperuser(client)
      expect(await snap()).toEqual(before)
    })
  })

  it('los guards frenan hasta a postgres: columnas inmutables de la cuenta, campos del vínculo y DELETE en las cinco tablas', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const { requestId } = await submitRequest(client)
      for (const col of ['user_id', 'dni', 'terms_accepted_at', 'created_at']) {
        const value = col === 'user_id' ? `'${randomUUID()}'::uuid` : col === 'dni' ? `'${fakeDni()}'` : `now() + interval '1 day'`
        const err = await expectQueryError(client, `update public.portal_accounts set ${col} = ${value} where user_id = $1`, [a.userId])
        expect(err, col).toMatchObject({ code: '23514', message: `La columna ${col} no se puede modificar` })
      }
      for (const set of [`family_scope = true`, `relationship = 'self'`, `member_id = ${w.siblingId}`, `account_id = '${w.adminId}'`]) {
        const err = await expectQueryError(client, `update public.portal_account_members set ${set} where id = $1`, [a.linkId])
        expect(err, set).toMatchObject({ code: '42501', message: 'Los vínculos no se modifican: se revocan' })
      }
      await revokeLink(client, w.adminId, a.linkId)
      const again = await expectQueryError(client, `update public.portal_account_members set revoke_reason = 'Otro motivo distinto' where id = $1`, [a.linkId])
      expect(again).toMatchObject({ code: '23514', message: 'El vínculo ya está revocado' })

      for (const [table, where] of [
        ['portal_accounts', `user_id = '${a.userId}'`],
        ['portal_account_members', `id = ${a.linkId}`],
        ['portal_access_tokens', `id = ${a.tokenId}`],
        ['portal_access_requests', `id = ${requestId}`],
        ['portal_access_request_people', `request_id = ${requestId}`],
      ] as const) {
        const del = await expectQueryError(client, `delete from public.${table} where ${where}`)
        expect(del, table).toMatchObject({ code: '42501', message: `Los registros de ${table} no se modifican ni se borran` })
      }
    })
  })

  it('un usuario de Auth con cuenta de la app no se puede borrar de auth.users (la historia se queda): FK restrict', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const err = await expectQueryError(client, `delete from auth.users where id = $1`, [a.userId])
      expect(err.code).toBe('23503')
    })
  })
})

describe.skipIf(!dbAvailable)('settings.default_phone_area_code', () => {
  it('lo cambia un admin; editor y consulta no (la fila no cambia); 2 a 4 dígitos sin cero, o null', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const read = async () => (await client.query(`select default_phone_area_code as c from public.settings where id = 1`)).rows[0].c as string | null
      await asUser(client, w.adminId, () => client.query(`update public.settings set default_phone_area_code = '351' where id = 1`))
      expect(await read()).toBe('351')

      for (const id of [w.editorId, w.consultaId]) {
        await actAs(client, id)
        await client.query('savepoint ajuste')
        let rows = 0
        try {
          rows = (await client.query(`update public.settings set default_phone_area_code = '11' where id = 1`)).rowCount ?? 0
        } catch (err) {
          expect((err as { code?: string }).code).toBe('42501')
        }
        await client.query('rollback to savepoint ajuste')
        await actAsSuperuser(client)
        expect(rows).toBe(0)
      }
      expect(await read()).toBe('351')

      for (const bad of ['0351', '1', '12345', '35a', ' 351']) {
        await actAs(client, w.adminId)
        const err = await expectQueryError(client, `update public.settings set default_phone_area_code = $1 where id = 1`, [bad])
        await actAsSuperuser(client)
        expect(err.code, `"${bad}"`).toBe('23514')
      }
      for (const good of ['11', '2966', null]) {
        await client.query(`update public.settings set default_phone_area_code = $1 where id = 1`, [good])
        expect(await read()).toBe(good)
      }
    })
  })
})
