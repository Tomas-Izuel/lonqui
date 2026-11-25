import { randomUUID } from 'node:crypto'
import { Client, type ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import { actAs, actAsSuperuser, createFamilyGroup, createMember, createUserWithRole, expectQueryError, isDbAvailable, withRollback } from './helpers'
import {
  actAsServiceRole,
  auditRows,
  consumeToken,
  createPortalAuthUser,
  createTokenCall,
  fakeDni,
  insertRawToken,
  issueToken,
  linkNewAccount,
  peekToken,
  portalWorld,
  tokenRow,
} from './portal-fixtures'

/**
 * App de socios, S2-T4 (base): LOS TOKENS DE ACCESO (`portal_access_tokens`) de punta a punta, contra el Postgres local.
 *   - emisión: vigencias 15 min / 30 min / 72 h por entrega y propósito, solo el SHA-256 en la base (ni en la fila ni en
 *     el audit_log), verificación de DNI según a quién se invita, reemisión que revoca lo pendiente;
 *   - uso: un solo canje (también en paralelo, con dos conexiones reales), vencido / revocado / bloqueado no sirven,
 *     cinco DNI mal bloquean, peek no consume;
 *   - tabla: los guards de UPDATE y DELETE, y la auditoría con el actor correcto (la sesión del panel al emitir y
 *     revocar; la persona misma, como actor explícito, al canjear).
 *
 * Todo con datos inventados dentro de `withRollback`, salvo la carrera en paralelo, que necesita transacciones reales
 * y limpia sus fixtures (ver el comentario de ese test).
 */
const dbAvailable = await isDbAvailable()
if (!dbAvailable) {
  console.warn('[tests/db] Postgres local no responde: se saltean los tests de tests/db/.')
}

const URL = process.env.LONQUI_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const MINUTE = 60
const HOUR = 60 * MINUTE

async function asUser<T>(client: ClientBase, userId: string, fn: () => Promise<T>): Promise<T> {
  await actAs(client, userId)
  try {
    return await fn()
  } finally {
    await actAsSuperuser(client)
  }
}

async function revoke(client: ClientBase, userId: string, tokenId: number, reason = 'Motivo de prueba'): Promise<void> {
  await asUser(client, userId, () => client.query(`select public.revoke_portal_token($1::bigint, $2::text)`, [tokenId, reason]))
}

describe.skipIf(!dbAvailable)('emisión: vigencia por entrega y propósito (D8)', () => {
  it('invitación por WhatsApp 72 h, invitación por QR 15 min, enlace de ingreso por WhatsApp 30 min, por QR 15 min: exactos al segundo', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const account = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId, relationship: 'guardian' })

      const inviteWa = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'whatsapp', replacePending: false })
      const inviteQr = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr', replacePending: false })
      const loginWa = await issueToken(client, w.adminId, { purpose: 'login', delivery: 'whatsapp', accountId: account.userId })
      const loginQr = await issueToken(client, w.adminId, { purpose: 'login', delivery: 'qr', accountId: account.userId, replacePending: false })

      expect((await tokenRow(client, inviteWa.tokenId)).ttl_seconds).toBe(72 * HOUR)
      expect((await tokenRow(client, inviteQr.tokenId)).ttl_seconds).toBe(15 * MINUTE)
      expect((await tokenRow(client, loginWa.tokenId)).ttl_seconds).toBe(30 * MINUTE)
      expect((await tokenRow(client, loginQr.tokenId)).ttl_seconds).toBe(15 * MINUTE)

      // El expires_at que devuelve la RPC es el que quedó guardado (JS pierde los microsegundos: se compara al milisegundo).
      const stored = await client.query<{ ok: boolean }>(`select abs(extract(epoch from expires_at - $2::timestamptz)) < 0.001 as ok from public.portal_access_tokens where id = $1`, [
        inviteWa.tokenId,
        inviteWa.expiresAt,
      ])
      expect(stored.rows[0].ok).toBe(true)
    })
  })
})

describe.skipIf(!dbAvailable)('emisión: en la base hay hash, nunca el valor', () => {
  it('el token en claro es de 256 bits en base64url, la fila guarda solo su SHA-256 y el valor no está en ninguna columna ni en el audit_log', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await issueToken(client, w.adminId, { memberId: w.memberId, replacePending: false })
      const b = await issueToken(client, w.adminId, { memberId: w.memberId, replacePending: false })

      for (const t of [a, b]) {
        expect(t.token, '32 bytes en base64url sin relleno = 43 caracteres').toMatch(/^[A-Za-z0-9_-]{43}$/)
        const row = await client.query<{ hash_ok: boolean; len: number }>(
          `select token_hash = sha256(convert_to($2, 'UTF8')) as hash_ok, length(token_hash) as len from public.portal_access_tokens where id = $1`,
          [t.tokenId, t.token],
        )
        expect(row.rows[0]).toEqual({ hash_ok: true, len: 32 })

        // Ninguna columna de la fila contiene el valor (ni su base64 ni su hex).
        const dump = await client.query<{ j: string }>(`select to_jsonb(t)::text as j from public.portal_access_tokens t where id = $1`, [t.tokenId])
        expect(dump.rows[0].j).not.toContain(t.token)

        // Ni la auditoría de esa fila (el trigger copia la fila entera): solo el hash.
        const audit = await auditRows(client, 'portal_access_tokens', t.tokenId)
        expect(audit.length).toBeGreaterThan(0)
        expect(JSON.stringify(audit)).not.toContain(t.token)
      }
      expect(a.token).not.toBe(b.token)

      // Barrido más ancho: nada de lo que se auditó en esta transacción lleva el valor, en ninguna tabla.
      const anywhere = await client.query(`select count(*)::int as n from public.audit_log where occurred_at >= now() and (new_data::text like $1 or old_data::text like $1)`, [
        `%${a.token}%`,
      ])
      expect(anywhere.rows[0].n).toBe(0)

      // Tras canjearlo tampoco aparece (el canje actualiza la fila y vuelve a auditar).
      const userId = await createPortalAuthUser(client)
      const consumed = await consumeToken(client, a.token, userId, { checkDni: w.memberDni })
      expect(consumed.status).toBe('ok')
      const after = await client.query(`select count(*)::int as n from public.audit_log where occurred_at >= now() and (new_data::text like $1 or old_data::text like $1)`, [
        `%${a.token}%`,
      ])
      expect(after.rows[0].n).toBe(0)
    })
  })

  it('con service_role no se puede leer el valor de ningún token ya emitido: la tabla no tiene ninguna columna con él', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId })
      await actAsServiceRole(client)
      const row = await client.query<{ j: string }>(`select to_jsonb(x)::text as j from public.portal_access_tokens x where id = $1`, [t.tokenId])
      await actAsSuperuser(client)
      expect(row.rows[0].j).not.toContain(t.token)
    })
  })
})

describe.skipIf(!dbAvailable)('emisión: quién tiene que verificar un DNI (requires_dni_check)', () => {
  it('invitación: por WhatsApp pide DNI si el socio (o su grupo, con family_scope) tiene uno cargado; por QR nunca', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      // Un socio sin DNI dentro de un grupo donde el hermano SÍ tiene.
      const mixedGroup = await createFamilyGroup(client, { name: 'Grupo Mixto Ficticio' })
      const anchorNoDni = await createMember(client, { firstName: 'Eva', lastName: 'Sinpapeles', familyGroupId: mixedGroup })
      await createMember(client, { firstName: 'Fede', lastName: 'Conpapeles', dni: fakeDni(), familyGroupId: mixedGroup })

      const cases: Array<{ label: string; args: Parameters<typeof issueToken>[2]; expected: boolean }> = [
        { label: 'WhatsApp, socio con DNI', args: { memberId: w.soloId, delivery: 'whatsapp' }, expected: true },
        { label: 'QR, socio con DNI', args: { memberId: w.soloId, delivery: 'qr' }, expected: false },
        { label: 'WhatsApp, socio sin DNI y sin grupo', args: { memberId: w.noDniId, delivery: 'whatsapp' }, expected: false },
        { label: 'WhatsApp, ancla sin DNI, SIN family_scope (el hermano con DNI no cuenta)', args: { memberId: anchorNoDni, delivery: 'whatsapp' }, expected: false },
        { label: 'WhatsApp, ancla sin DNI, CON family_scope (el hermano con DNI cuenta)', args: { memberId: anchorNoDni, delivery: 'whatsapp', familyScope: true }, expected: true },
        { label: 'QR, grupo con DNI', args: { memberId: anchorNoDni, delivery: 'qr', familyScope: true }, expected: false },
      ]
      for (const c of cases) {
        const t = await issueToken(client, w.adminId, { ...c.args, replacePending: false })
        expect((await tokenRow(client, t.tokenId)).requires_dni_check, c.label).toBe(c.expected)
      }
    })
  })

  it('enlace de ingreso: por WhatsApp siempre pide el DNI de la cuenta; en persona (QR) no', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const account = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId })
      const wa = await issueToken(client, w.adminId, { purpose: 'login', delivery: 'whatsapp', accountId: account.userId })
      expect((await tokenRow(client, wa.tokenId)).requires_dni_check).toBe(true)
      const qr = await issueToken(client, w.adminId, { purpose: 'login', delivery: 'qr', accountId: account.userId })
      expect((await tokenRow(client, qr.tokenId)).requires_dni_check).toBe(false)
    })
  })
})

describe.skipIf(!dbAvailable)('emisión: reemitir revoca lo pendiente (y solo lo del mismo destino)', () => {
  it('emitir otra invitación para el mismo socio y alcance revoca la pendiente, con quién y por qué; la nueva queda viva', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const first = await issueToken(client, w.adminId, { memberId: w.memberId })
      const second = await issueToken(client, w.editorId, { memberId: w.memberId })

      const a = await tokenRow(client, first.tokenId)
      expect(a.revoked_at).not.toBeNull()
      expect(a.revoked_by).toBe(w.editorId)
      expect(a.revoke_reason).toBe('Reemplazado por un enlace nuevo')
      const b = await tokenRow(client, second.tokenId)
      expect(b.revoked_at).toBeNull()
      expect(b.consumed_at).toBeNull()

      expect((await peekToken(client, first.token, w.memberDni)).status, 'el reemplazado ya no sirve').toBe('invalid')
      expect((await peekToken(client, second.token, w.memberDni)).status).toBe('ok')
    })
  })

  it('p_replace_pending = false deja las dos vivas (invitar a OTRA persona: madre y padre)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const madre = await issueToken(client, w.adminId, { memberId: w.memberId, replacePending: false })
      const padre = await issueToken(client, w.adminId, { memberId: w.memberId, replacePending: false })
      expect((await tokenRow(client, madre.tokenId)).revoked_at).toBeNull()
      expect((await tokenRow(client, padre.tokenId)).revoked_at).toBeNull()
      expect((await peekToken(client, madre.token, w.memberDni)).status).toBe('ok')
      expect((await peekToken(client, padre.token, w.memberDni)).status).toBe('ok')
    })
  })

  it('el destino es socio + alcance: otro socio, o el mismo con family_scope distinto, NO se revoca; uno ya canjeado tampoco', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const own = await issueToken(client, w.adminId, { memberId: w.memberId, familyScope: false })
      const group = await issueToken(client, w.adminId, { memberId: w.memberId, familyScope: true })
      const other = await issueToken(client, w.adminId, { memberId: w.siblingId, familyScope: false })
      expect((await tokenRow(client, own.tokenId)).revoked_at, 'invitar al grupo no revoca la individual').toBeNull()
      expect((await tokenRow(client, group.tokenId)).revoked_at).toBeNull()
      expect((await tokenRow(client, other.tokenId)).revoked_at).toBeNull()

      // Se canjea la individual; reemitir después no la toca (ya es historia).
      const userId = await createPortalAuthUser(client)
      expect((await consumeToken(client, own.token, userId, { checkDni: w.memberDni })).status).toBe('ok')
      await issueToken(client, w.adminId, { memberId: w.memberId, familyScope: false })
      const consumed = await tokenRow(client, own.tokenId)
      expect(consumed.consumed_at).not.toBeNull()
      expect(consumed.revoked_at).toBeNull()
    })
  })

  it('un enlace de ingreso nuevo revoca el pendiente de LA MISMA cuenta y deja el de otra cuenta', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const acct1 = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId })
      const acct2 = await linkNewAccount(client, { adminId: w.adminId, memberId: w.noDniId })
      const first = await issueToken(client, w.adminId, { purpose: 'login', accountId: acct1.userId, delivery: 'whatsapp' })
      const otherAccount = await issueToken(client, w.adminId, { purpose: 'login', accountId: acct2.userId, delivery: 'whatsapp' })
      const second = await issueToken(client, w.adminId, { purpose: 'login', accountId: acct1.userId, delivery: 'qr' })
      expect((await tokenRow(client, first.tokenId)).revoked_at).not.toBeNull()
      expect((await tokenRow(client, second.tokenId)).revoked_at).toBeNull()
      expect((await tokenRow(client, otherAccount.tokenId)).revoked_at).toBeNull()
    })
  })

  it('una invitación nueva no revoca los enlaces de ingreso, ni al revés (el propósito cuenta)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const account = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId })
      const login = await issueToken(client, w.adminId, { purpose: 'login', accountId: account.userId, delivery: 'whatsapp' })
      await issueToken(client, w.adminId, { memberId: w.memberId })
      expect((await tokenRow(client, login.tokenId)).revoked_at).toBeNull()
      const invite = await issueToken(client, w.adminId, { memberId: w.siblingId })
      await issueToken(client, w.adminId, { purpose: 'login', accountId: account.userId, delivery: 'qr' })
      expect((await tokenRow(client, invite.tokenId)).revoked_at).toBeNull()
    })
  })
})

describe.skipIf(!dbAvailable)('emisión: lo que se rechaza', () => {
  it('argumentos inválidos y destinos que no existen tiran el error redactado, y no queda ningún token', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      await client.query(
        `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-03-01', 'Motivo ficticio de baja')`,
        [w.noDniId],
      )
      const blocked = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId })
      await actAs(client, w.adminId)
      await client.query(`select public.set_portal_account_status($1::uuid, 'blocked', 'Cuenta de prueba bloqueada')`, [blocked.userId])
      await actAsSuperuser(client)

      const before = await client.query(`select count(*)::int as n from public.portal_access_tokens`)
      const call = (args: Parameters<typeof createTokenCall>[0]) => createTokenCall(args)
      const cases: Array<{ label: string; args: Parameters<typeof createTokenCall>[0]; code: string; message: string }> = [
        { label: 'propósito inválido', args: { purpose: 'otro' as 'invite', memberId: w.memberId }, code: '23514', message: 'Tipo de enlace inválido' },
        { label: 'entrega inválida', args: { memberId: w.memberId, delivery: 'sms' as 'qr' }, code: '23514', message: 'Forma de entrega inválida' },
        { label: 'sin relación', args: { memberId: w.memberId, relationship: null }, code: '23514', message: 'Indicá si la invitación es para el socio o para quien responde por él' },
        { label: 'relación inválida', args: { memberId: w.memberId, relationship: 'tutor' as 'self' }, code: '23514', message: 'Indicá si la invitación es para el socio o para quien responde por él' },
        { label: 'socio inexistente', args: { memberId: 999_999_999 }, code: 'P0002', message: 'El socio no existe' },
        { label: 'sin socio', args: { memberId: null }, code: 'P0002', message: 'El socio no existe' },
        { label: 'socio dado de baja', args: { memberId: w.noDniId }, code: '23514', message: 'El socio está dado de baja' },
        { label: 'grupo para un socio sin grupo', args: { memberId: w.soloId, familyScope: true }, code: '23514', message: 'El socio no tiene grupo familiar' },
        { label: 'pedido inexistente', args: { memberId: w.memberId, requestId: 999_999_999 }, code: 'P0002', message: 'El pedido no existe' },
        { label: 'enlace de ingreso con socio', args: { purpose: 'login', accountId: blocked.userId, memberId: w.memberId }, code: '23514', message: 'Un enlace de ingreso es para una cuenta' },
        { label: 'enlace de ingreso con family_scope', args: { purpose: 'login', accountId: blocked.userId, familyScope: true }, code: '23514', message: 'Un enlace de ingreso es para una cuenta' },
        { label: 'enlace de ingreso para una cuenta bloqueada', args: { purpose: 'login', accountId: blocked.userId }, code: '23514', message: 'La cuenta no existe o está bloqueada' },
        { label: 'enlace de ingreso para una cuenta que no existe', args: { purpose: 'login', accountId: randomUUID() }, code: '23514', message: 'La cuenta no existe o está bloqueada' },
      ]
      for (const c of cases) {
        await actAs(client, w.adminId)
        const { sql, params } = call(c.args)
        const err = await expectQueryError(client, sql, params)
        await actAsSuperuser(client)
        expect(err.code, c.label).toBe(c.code)
        expect(err.message, c.label).toBe(c.message)
      }
      const after = await client.query(`select count(*)::int as n from public.portal_access_tokens`)
      // Solo sumaron los tokens que armó linkNewAccount ANTES de `before`: los rechazos no dejaron nada.
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })
  })

  it('un rechazo no revoca nada: la reemisión fallida deja viva la invitación anterior', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const live = await issueToken(client, w.adminId, { memberId: w.memberId })
      await actAs(client, w.adminId)
      const { sql, params } = createTokenCall({ memberId: w.memberId, relationship: 'tutor' as 'self' })
      const err = await expectQueryError(client, sql, params)
      await actAsSuperuser(client)
      expect(err.code).toBe('23514')
      expect((await tokenRow(client, live.tokenId)).revoked_at).toBeNull()
    })
  })
})

describe.skipIf(!dbAvailable)('peek: valida sin consumir', () => {
  it('un token vivo da ok con su propósito y alcance, y mirar no gasta nada (se puede mirar las veces que sea)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr', familyScope: true })
      for (let i = 0; i < 3; i++) {
        const peek = await peekToken(client, t.token)
        expect(peek.status).toBe('ok')
        expect(peek.purpose).toBe('invite')
        expect(peek.family_scope).toBe(true)
        expect(Number(peek.token_id)).toBe(t.tokenId)
      }
      const row = await tokenRow(client, t.tokenId)
      expect(row.consumed_at).toBeNull()
      expect(row.failed_checks).toBe(0)
    })
  })

  it("lo inexistente, vacío o nulo da 'invalid' y no se distingue de un token vencido, usado o revocado", async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      for (const bad of ['', 'no-es-un-token', randomUUID(), 'A'.repeat(43)]) {
        const peek = await peekToken(client, bad)
        expect(peek).toEqual({ status: 'invalid', token_id: null, purpose: null, account_id: null, family_scope: null })
      }
      await actAsServiceRole(client)
      const nul = await client.query(`select * from public.portal_token_peek(null, null)`)
      await actAsSuperuser(client)
      expect(nul.rows[0].status).toBe('invalid')

      // Mismo cuerpo de respuesta para vencido, revocado y usado: nada que distinga el motivo.
      const expired = await insertRawToken(client, { token: 'tok-vencido-ficticio', createdBy: w.adminId, memberId: w.memberId, createdOffset: '-2 hours', expiresOffset: '-1 hour' })
      expect(expired).toBeGreaterThan(0)
      const revoked = await issueToken(client, w.adminId, { memberId: w.siblingId })
      await revoke(client, w.adminId, revoked.tokenId)
      const used = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr' })
      await consumeToken(client, used.token, await createPortalAuthUser(client), { personDni: w.soloDni })
      const shapes = [await peekToken(client, 'tok-vencido-ficticio'), await peekToken(client, revoked.token), await peekToken(client, used.token)]
      for (const s of shapes) expect(s).toEqual({ status: 'invalid', token_id: null, purpose: null, account_id: null, family_scope: null })
    })
  })
})

describe.skipIf(!dbAvailable)('vencimiento y revocación: no sirven', () => {
  it('un token vencido no se mira ni se canjea, y no crea cuenta ni vínculo', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      await insertRawToken(client, { token: 'tok-vencido-1', createdBy: w.adminId, memberId: w.memberId, delivery: 'qr', createdOffset: '-30 minutes', expiresOffset: '-15 minutes' })
      expect((await peekToken(client, 'tok-vencido-1')).status).toBe('invalid')
      const userId = await createPortalAuthUser(client)
      expect((await consumeToken(client, 'tok-vencido-1', userId)).status).toBe('invalid')
      const accounts = await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [userId])
      expect(accounts.rows[0].n).toBe(0)
      const links = await client.query(`select count(*)::int as n from public.portal_account_members where account_id = $1`, [userId])
      expect(links.rows[0].n).toBe(0)
    })
  })

  it('borde exacto: expires_at = ahora ya venció; un segundo antes de vencer todavía sirve', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      await insertRawToken(client, { token: 'tok-en-el-borde', createdBy: w.adminId, memberId: w.memberId, delivery: 'qr', createdOffset: '-1 hour', expiresOffset: '0 seconds' })
      await insertRawToken(client, { token: 'tok-un-segundo', createdBy: w.adminId, memberId: w.siblingId, delivery: 'qr', createdOffset: '-1 hour', expiresOffset: '1 second' })
      expect((await peekToken(client, 'tok-en-el-borde')).status, 'expires_at = now(): la condición es expires_at > now()').toBe('invalid')
      expect((await peekToken(client, 'tok-un-segundo')).status).toBe('ok')
      const userId = await createPortalAuthUser(client)
      expect((await consumeToken(client, 'tok-en-el-borde', userId)).status).toBe('invalid')
      expect((await consumeToken(client, 'tok-un-segundo', userId, { personDni: fakeDni() })).status).toBe('ok')
    })
  })

  it('un token revocado a mano no se mira ni se canjea; revocar guarda quién y por qué', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr' })
      await revoke(client, w.editorId, t.tokenId, '  Se mandó al teléfono equivocado  ')
      const row = await tokenRow(client, t.tokenId)
      expect(row.revoked_by).toBe(w.editorId)
      expect(row.revoke_reason, 'se guarda sin los espacios de los bordes').toBe('Se mandó al teléfono equivocado')
      expect((await peekToken(client, t.token)).status).toBe('invalid')
      const userId = await createPortalAuthUser(client)
      expect((await consumeToken(client, t.token, userId)).status).toBe('invalid')
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [userId])).rows[0].n).toBe(0)
    })
  })

  it('revocar de nuevo, sin motivo, o un id que no existe: error redactado, y el token queda como estaba', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId })
      await actAs(client, w.adminId)
      const noReason = await expectQueryError(client, `select public.revoke_portal_token($1::bigint, '  ')`, [t.tokenId])
      expect(noReason).toMatchObject({ code: '23514', message: 'Indicá el motivo' })
      const short = await expectQueryError(client, `select public.revoke_portal_token($1::bigint, 'ab')`, [t.tokenId])
      expect(short.code).toBe('23514')
      const missing = await expectQueryError(client, `select public.revoke_portal_token(999999999, 'Motivo de prueba')`)
      expect(missing).toMatchObject({ code: 'P0002', message: 'El enlace no existe' })
      await actAsSuperuser(client)
      expect((await tokenRow(client, t.tokenId)).revoked_at, 'los rechazos no lo revocaron').toBeNull()

      await revoke(client, w.adminId, t.tokenId)
      await actAs(client, w.adminId)
      const twice = await expectQueryError(client, `select public.revoke_portal_token($1::bigint, 'Motivo de prueba')`, [t.tokenId])
      expect(twice).toMatchObject({ code: '23514', message: 'El enlace ya no está vigente' })
      await actAsSuperuser(client)
    })
  })

  it('un token ya canjeado no se puede revocar (es historia)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr' })
      await consumeToken(client, t.token, await createPortalAuthUser(client), { personDni: w.soloDni })
      await actAs(client, w.adminId)
      const err = await expectQueryError(client, `select public.revoke_portal_token($1::bigint, 'Motivo de prueba')`, [t.tokenId])
      await actAsSuperuser(client)
      expect(err).toMatchObject({ code: '23514', message: 'El enlace ya no está vigente' })
    })
  })
})

describe.skipIf(!dbAvailable)('un solo uso', () => {
  it('el primer canje da ok y marca consumed_at/consumed_by; el segundo (misma persona u otra) da invalid y no suma nada', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr' })
      const first = await createPortalAuthUser(client)
      const second = await createPortalAuthUser(client)

      const ok = await consumeToken(client, t.token, first, { personDni: w.soloDni })
      expect(ok).toEqual({ status: 'ok', account_id: first })
      const row = await tokenRow(client, t.tokenId)
      expect(row.consumed_by).toBe(first)
      expect(row.consumed_at).not.toBeNull()

      expect((await consumeToken(client, t.token, first, { personDni: w.soloDni })).status, 'la misma persona, otra vez').toBe('invalid')
      expect((await consumeToken(client, t.token, second, { personDni: fakeDni() })).status, 'otra persona').toBe('invalid')
      expect((await peekToken(client, t.token)).status).toBe('invalid')
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [second])).rows[0].n).toBe(0)
      expect((await client.query(`select count(*)::int as n from public.portal_account_members where member_id = $1`, [w.soloId])).rows[0].n).toBe(1)
    })
  })

  it('un enlace de ingreso también es de un solo uso', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const account = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId })
      const login = await issueToken(client, w.adminId, { purpose: 'login', accountId: account.userId, delivery: 'qr' })
      expect(await consumeToken(client, login.token, account.userId)).toEqual({ status: 'ok', account_id: account.userId })
      expect((await consumeToken(client, login.token, account.userId)).status).toBe('invalid')
    })
  })
})

describe.skipIf(!dbAvailable)('verificación de DNI: cinco fallidos lo bloquean', () => {
  it('peek: cuatro DNI mal dan dni_mismatch; el quinto bloquea; después ni el DNI correcto sirve, ni peek ni canje', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'whatsapp' })
      expect((await tokenRow(client, t.tokenId)).requires_dni_check).toBe(true)

      const wrong = (n: number) => `1000000${n}`
      for (let i = 1; i <= 4; i++) {
        expect((await peekToken(client, t.token, wrong(i))).status, `intento ${i}`).toBe('dni_mismatch')
        expect((await tokenRow(client, t.tokenId)).failed_checks).toBe(i)
      }
      // El correcto antes del quinto sirve, pero no reinicia el contador.
      expect((await peekToken(client, t.token, w.memberDni)).status).toBe('ok')
      expect((await tokenRow(client, t.tokenId)).failed_checks).toBe(4)

      expect((await peekToken(client, t.token, wrong(5))).status, 'el quinto fallido ya devuelve locked').toBe('locked')
      expect((await tokenRow(client, t.tokenId)).failed_checks).toBe(5)

      expect((await peekToken(client, t.token, w.memberDni)).status, 'ni el DNI correcto').toBe('locked')
      expect((await peekToken(client, t.token, null)).status).toBe('locked')
      const userId = await createPortalAuthUser(client)
      expect((await consumeToken(client, t.token, userId, { checkDni: w.memberDni, personDni: fakeDni() })).status).toBe('locked')
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [userId])).rows[0].n).toBe(0)
      // Sigue sin consumirse y el contador no se pasa de 5 (hay un CHECK entre 0 y 5).
      const row = await tokenRow(client, t.tokenId)
      expect(row.failed_checks).toBe(5)
      expect(row.consumed_at).toBeNull()
    })
  })

  it('sin DNI en un token que lo exige: dni_required, y NO suma un intento', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'whatsapp' })
      const peek = await peekToken(client, t.token, null)
      expect(peek.status).toBe('dni_required')
      expect(Number(peek.token_id)).toBe(t.tokenId)
      expect((await tokenRow(client, t.tokenId)).failed_checks).toBe(0)
    })
  })

  it('canje: un DNI mal suma un intento, devuelve dni_mismatch y no crea cuenta; sin DNI también cuenta como fallido', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'whatsapp' })
      const userId = await createPortalAuthUser(client)
      expect((await consumeToken(client, t.token, userId, { checkDni: '10000001', personDni: fakeDni() })).status).toBe('dni_mismatch')
      expect((await consumeToken(client, t.token, userId, { checkDni: null, personDni: fakeDni() })).status).toBe('dni_mismatch')
      const row = await tokenRow(client, t.tokenId)
      expect(row.failed_checks).toBe(2)
      expect(row.consumed_at).toBeNull()
      expect((await client.query(`select count(*)::int as n from public.portal_accounts where user_id = $1`, [userId])).rows[0].n).toBe(0)
      // Y con el DNI bueno todavía se puede.
      expect((await consumeToken(client, t.token, userId, { checkDni: w.memberDni, personDni: fakeDni() })).status).toBe('ok')
    })
  })

  it('quinto fallo en el canje: devuelve locked (como peek) y bloquea los siguientes intentos', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'whatsapp' })
      const userId = await createPortalAuthUser(client)
      const statuses: string[] = []
      for (let i = 0; i < 5; i++) statuses.push((await consumeToken(client, t.token, userId, { checkDni: '10000001', personDni: fakeDni() })).status)
      // El quinto fallo ya dice 'locked' (igual que peek), no 'dni_mismatch'.
      expect(statuses).toEqual(['dni_mismatch', 'dni_mismatch', 'dni_mismatch', 'dni_mismatch', 'locked'])
      expect((await tokenRow(client, t.tokenId)).failed_checks).toBe(5)
      expect((await consumeToken(client, t.token, userId, { checkDni: w.memberDni, personDni: fakeDni() })).status).toBe('locked')
      expect((await peekToken(client, t.token, w.memberDni)).status).toBe('locked')
    })
  })

  it('qué DNI vale: el del socio ancla; el del hermano solo con family_scope; el de un socio ajeno nunca', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const own = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'whatsapp', familyScope: false })
      expect((await peekToken(client, own.token, w.memberDni)).status).toBe('ok')
      expect((await peekToken(client, own.token, w.siblingDni)).status, 'sin family_scope el hermano no cuenta').toBe('dni_mismatch')
      expect((await peekToken(client, own.token, w.soloDni)).status, 'un socio de otro grupo no cuenta').toBe('dni_mismatch')

      const group = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'whatsapp', familyScope: true })
      expect((await peekToken(client, group.token, w.siblingDni)).status, 'con family_scope vale el de cualquiera del grupo').toBe('ok')
      expect((await peekToken(client, group.token, w.memberDni)).status).toBe('ok')
      expect((await peekToken(client, group.token, w.soloDni)).status).toBe('dni_mismatch')
    })
  })

  it('enlace de ingreso por WhatsApp: vale el DNI de la cuenta (no el del socio vinculado si es otro), y también se bloquea a los cinco', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      // Cuenta de una madre: su DNI NO es el del hijo vinculado.
      const account = await linkNewAccount(client, { adminId: w.adminId, memberId: w.memberId, relationship: 'guardian' })
      const login = await issueToken(client, w.adminId, { purpose: 'login', accountId: account.userId, delivery: 'whatsapp' })
      expect((await peekToken(client, login.token, w.memberDni)).status, 'el DNI del hijo no es el de la cuenta').toBe('dni_mismatch')
      expect((await peekToken(client, login.token, account.dni)).status).toBe('ok')
      for (let i = 0; i < 4; i++) await peekToken(client, login.token, '10000009')
      expect((await peekToken(client, login.token, account.dni)).status).toBe('locked')
    })
  })

  it('QR (sin verificación): un DNI cualquiera no suma intentos ni importa', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr' })
      for (const dni of [null, '10000001', w.memberDni]) expect((await peekToken(client, t.token, dni)).status).toBe('ok')
      expect((await tokenRow(client, t.tokenId)).failed_checks).toBe(0)
    })
  })
})

describe.skipIf(!dbAvailable)('guards de la tabla portal_access_tokens', () => {
  it('ni siquiera postgres cambia el hash, el destino ni la vigencia de un token vivo: solo contador, consumo y revocación', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId })
      const attempts = [
        `update public.portal_access_tokens set token_hash = sha256('otro'::bytea) where id = $1`,
        `update public.portal_access_tokens set expires_at = expires_at + interval '1 year' where id = $1`,
        `update public.portal_access_tokens set member_id = ${w.siblingId} where id = $1`,
        `update public.portal_access_tokens set family_scope = not family_scope where id = $1`,
        `update public.portal_access_tokens set requires_dni_check = false where id = $1`,
        `update public.portal_access_tokens set created_by = '${w.editorId}' where id = $1`,
        `update public.portal_access_tokens set delivery = 'qr' where id = $1`,
      ]
      for (const sql of attempts) {
        const err = await expectQueryError(client, sql, [t.tokenId])
        expect(err.code, sql).toBe('42501')
        expect(err.message).toBe('Los enlaces de acceso no se modifican')
      }
      // El contador no baja (desbloquearse a sí mismo).
      await client.query(`update public.portal_access_tokens set failed_checks = 3 where id = $1`, [t.tokenId])
      const down = await expectQueryError(client, `update public.portal_access_tokens set failed_checks = 2 where id = $1`, [t.tokenId])
      expect(down.code).toBe('42501')
      // Y el CHECK topa el contador en 5.
      const over = await expectQueryError(client, `update public.portal_access_tokens set failed_checks = 6 where id = $1`, [t.tokenId])
      expect(over.code).toBe('23514')
    })
  })

  it('un token consumido o revocado ya no cambia por ningún camino', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const used = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr' })
      await consumeToken(client, used.token, await createPortalAuthUser(client), { personDni: w.soloDni })
      const revoked = await issueToken(client, w.adminId, { memberId: w.memberId })
      await revoke(client, w.adminId, revoked.tokenId)

      for (const id of [used.tokenId, revoked.tokenId]) {
        const bump = await expectQueryError(client, `update public.portal_access_tokens set failed_checks = failed_checks + 1 where id = $1`, [id])
        expect(bump).toMatchObject({ code: '23514', message: 'El enlace ya no está vigente' })
        const reopen = await expectQueryError(client, `update public.portal_access_tokens set revoked_at = null, revoke_reason = null, consumed_at = null, consumed_by = null where id = $1`, [id])
        expect(reopen.code).toBe('23514')
      }
    })
  })

  it('no se borra ni siquiera como postgres (trigger), y authenticated / anon / service_role no tienen DELETE ni UPDATE', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId })
      const del = await expectQueryError(client, `delete from public.portal_access_tokens where id = $1`, [t.tokenId])
      expect(del).toMatchObject({ code: '42501', message: 'Los registros de portal_access_tokens no se modifican ni se borran' })

      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const priv of ['insert', 'update', 'delete', 'truncate']) {
          const has = await client.query(`select has_table_privilege($1, 'public.portal_access_tokens', $2) as ok`, [role, priv])
          expect(has.rows[0].ok, `${role} no debería tener ${priv} sobre portal_access_tokens`).toBe(false)
        }
      }
      // service_role tampoco borra por la vía real.
      await actAsServiceRole(client)
      const viaService = await expectQueryError(client, `delete from public.portal_access_tokens where id = $1`, [t.tokenId])
      await actAsSuperuser(client)
      expect(viaService.code).toBe('42501')
      expect((await tokenRow(client, t.tokenId)).id).toBeDefined()
    })
  })

  it('el CHECK de destino: una invitación sin socio, o un enlace de ingreso con socio, no existen ni insertando directo', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const account = await linkNewAccount(client, { adminId: w.adminId, memberId: w.soloId })
      const bad = [
        { purpose: 'invite', member: null, account: null, rel: 'guardian' },
        { purpose: 'invite', member: w.memberId, account: account.userId, rel: 'guardian' },
        { purpose: 'invite', member: w.memberId, account: null, rel: null },
        { purpose: 'login', member: w.memberId, account: account.userId, rel: null },
        { purpose: 'login', member: null, account: null, rel: null },
      ]
      for (const b of bad) {
        const err = await expectQueryError(
          client,
          `insert into public.portal_access_tokens (purpose, token_hash, member_id, account_id, relationship, delivery, requires_dni_check, expires_at, created_by)
           values ($1, sha256(convert_to($2, 'UTF8')), $3, $4, $5, 'qr', false, now() + interval '1 hour', $6)`,
          [b.purpose, randomUUID(), b.member, b.account, b.rel, w.adminId],
        )
        expect(err.code, JSON.stringify(b)).toBe('23514')
        expect(err.message).toMatch(/portal_access_tokens_target/)
      }
    })
  })
})

describe.skipIf(!dbAvailable)('auditoría de tokens: el actor correcto', () => {
  it('emitir y revocar auditan a quien tenía la sesión (source = session); reemplazar audita al que emitió el nuevo', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const first = await issueToken(client, w.adminId, { memberId: w.memberId })
      const second = await issueToken(client, w.editorId, { memberId: w.memberId })
      await revoke(client, w.adminId, second.tokenId, 'Revocada a mano en la prueba')

      const a = await auditRows(client, 'portal_access_tokens', first.tokenId)
      expect(a.map((r) => [r.op, r.actor_id, r.actor_source])).toEqual([
        ['INSERT', w.adminId, 'session'],
        ['UPDATE', w.editorId, 'session'],
      ])
      expect(a[1].changed_fields).toEqual(['revoke_reason', 'revoked_at', 'revoked_by'])

      const b = await auditRows(client, 'portal_access_tokens', second.tokenId)
      expect(b.map((r) => [r.op, r.actor_id, r.actor_source])).toEqual([
        ['INSERT', w.editorId, 'session'],
        ['UPDATE', w.adminId, 'session'],
      ])
    })
  })

  it('canjear audita a LA PERSONA como actor explícito (no hay sesión: la secret key no tiene auth.uid()): token, cuenta y vínculo', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr', familyScope: true })
      const userId = await createPortalAuthUser(client)
      expect((await consumeToken(client, t.token, userId, { personDni: fakeDni() })).status).toBe('ok')

      const tokenAudit = await auditRows(client, 'portal_access_tokens', t.tokenId)
      expect(tokenAudit.map((r) => [r.op, r.actor_id, r.actor_source])).toEqual([
        ['INSERT', w.adminId, 'session'],
        ['UPDATE', userId, 'explicit'],
      ])
      expect(tokenAudit[1].changed_fields).toEqual(['consumed_at', 'consumed_by'])

      const account = await auditRows(client, 'portal_accounts', userId)
      expect(account.map((r) => [r.op, r.actor_id, r.actor_source])).toEqual([['INSERT', userId, 'explicit']])

      const link = await client.query<{ id: string }>(`select id from public.portal_account_members where account_id = $1`, [userId])
      const linkAudit = await auditRows(client, 'portal_account_members', link.rows[0].id)
      expect(linkAudit.map((r) => [r.op, r.actor_id, r.actor_source])).toEqual([['INSERT', userId, 'explicit']])
      // linked_by guarda quién invitó (el admin), distinto del actor de la fila.
      expect(linkAudit[0].new_data?.linked_by).toBe(w.adminId)
    })
  })

  it('el actor explícito del canje NO se filtra a lo que venga después en la misma conexión: es de la transacción (set_config local)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const t = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr' })
      await consumeToken(client, t.token, await createPortalAuthUser(client), { personDni: fakeDni() })
      // Dentro de ESTA transacción el valor sigue puesto (la transacción es la misma): la garantía es la de producción,
      // donde cada RPC de PostgREST es su propia transacción. Se prueba lo que sí se puede: que un cambio hecho por una
      // sesión real después del canje se audite con ESA sesión (auth.uid() manda sobre app.actor_id).
      const second = await issueToken(client, w.editorId, { memberId: w.siblingId, delivery: 'qr' })
      const audit = await auditRows(client, 'portal_access_tokens', second.tokenId)
      expect(audit[0]).toMatchObject({ actor_id: w.editorId, actor_source: 'session' })
    })
  })
})

describe.skipIf(!dbAvailable)('concurrencia real: dos conexiones, transacciones reales', () => {
  /**
   * Fuera de `withRollback` a propósito: la carrera tiene que ocurrir entre transacciones commiteadas. Se toma el mismo
   * advisory lock que usa `withRollback` (a nivel sesión) para no pisarse con los otros archivos de tests de base mientras
   * corren los `alter table ... disable trigger` de la limpieza. Qué NO se puede borrar: el audit_log (append-only) deja
   * sus filas, con ids de este test; todo lo demás (tokens, vínculos, cuentas, socios, usuarios) se borra apagando un
   * instante los triggers de "nada se borra" y volviéndolos a prender siempre.
   */
  it('dos canjes simultáneos del mismo token: uno gana, el otro recibe invalid, y queda UNA cuenta y UN vínculo; con DNI mal en ráfaga el contador se clava en 5', async () => {
    const setup = new Client({ connectionString: URL })
    await setup.connect()
    await setup.query('select pg_advisory_lock(7_261_029)')
    const tag = randomUUID().slice(0, 8)
    const adminId = randomUUID()
    const userIds: string[] = [randomUUID(), randomUUID()]
    let freeMemberId = 0
    let dniMemberId = 0
    try {
      await createUserWithRole(setup, 'admin', { userId: adminId })
      for (const id of userIds) await setup.query(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_token, email_change, email_change_token_new, recovery_token, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, 'x', now(), '', '', '', '', '{}', '{}', false, false, now(), now())`, [id, `carrera-${id.slice(0, 8)}@lonqui.test`])
      freeMemberId = await createMember(setup, { firstName: `Carrera${tag}`, lastName: 'Inventada' })
      const dni = fakeDni()
      dniMemberId = await createMember(setup, { firstName: `Rafaga${tag}`, lastName: 'Inventada', dni })

      const issue = async (memberId: number, delivery: 'qr' | 'whatsapp') => {
        await setup.query('begin')
        try {
          const t = await issueToken(setup, adminId, { memberId, delivery })
          await setup.query('commit')
          return t
        } catch (err) {
          await setup.query('rollback').catch(() => {})
          throw err
        }
      }
      const raceToken = await issue(freeMemberId, 'qr')
      const burstToken = await issue(dniMemberId, 'whatsapp')

      // --- canje simultáneo --------------------------------------------------------------------------------------
      const consumeAttempt = async (userId: string) => {
        const c = new Client({ connectionString: URL })
        await c.connect()
        try {
          await c.query('begin')
          await actAsServiceRole(c)
          const res = await c.query<{ status: string }>(`select status from public.portal_token_consume($1::text, $2::uuid, null, 'Persona', 'Inventada', $3::text, null, true)`, [raceToken.token, userId, fakeDni()])
          // Se retiene la transacción un instante con el lock tomado: el otro canje tiene que ESPERAR, no colarse.
          await c.query('select pg_sleep(0.25)')
          await c.query('commit')
          return res.rows[0].status
        } catch (err) {
          await c.query('rollback').catch(() => {})
          return `error:${(err as { code?: string }).code ?? 'x'}`
        } finally {
          await c.end()
        }
      }
      const results = await Promise.all(userIds.map((u) => consumeAttempt(u)))
      expect([...results].sort(), `resultados: ${results.join(', ')}`).toEqual(['invalid', 'ok'])

      const accounts = await setup.query(`select user_id from public.portal_accounts where user_id = any($1::uuid[])`, [userIds])
      expect(accounts.rowCount, 'una sola cuenta').toBe(1)
      const winner = accounts.rows[0].user_id as string
      expect(results[userIds.indexOf(winner)]).toBe('ok')
      const links = await setup.query(`select count(*)::int as n from public.portal_account_members where member_id = $1`, [freeMemberId])
      expect(links.rows[0].n, 'un solo vínculo').toBe(1)
      const row = await tokenRow(setup, raceToken.tokenId)
      expect(row.consumed_by).toBe(winner)

      // --- ráfaga de DNI mal (peek en paralelo) ---------------------------------------------------------------------
      const peekAttempt = async (n: number) => {
        const c = new Client({ connectionString: URL })
        await c.connect()
        try {
          await c.query('begin')
          await actAsServiceRole(c)
          const res = await c.query<{ status: string }>(`select status from public.portal_token_peek($1::text, $2::text)`, [burstToken.token, `1000000${n}`])
          await c.query('commit')
          return res.rows[0].status
        } catch (err) {
          await c.query('rollback').catch(() => {})
          return `error:${(err as { code?: string }).code ?? 'x'}`
        } finally {
          await c.end()
        }
      }
      const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => peekAttempt(i)))
      expect(burst.filter((s) => s === 'dni_mismatch'), `ráfaga: ${burst.join(', ')}`).toHaveLength(4)
      expect(burst.filter((s) => s === 'locked')).toHaveLength(4)
      expect((await tokenRow(setup, burstToken.tokenId)).failed_checks, 'el contador no se pasa de 5 aunque lleguen ocho a la vez').toBe(5)
    } finally {
      const quiet = async (sql: string, params?: unknown[]) => {
        try {
          await setup.query(sql, params)
        } catch {
          /* limpieza best-effort */
        }
      }
      const memberIds = [freeMemberId, dniMemberId].filter(Boolean)
      const noDelete: Array<[string, string]> = [
        ['public.portal_account_members', 'portal_account_members_no_delete'],
        ['public.portal_access_tokens', 'portal_access_tokens_no_delete'],
        ['public.portal_accounts', 'portal_accounts_no_delete'],
        ['public.member_status_events', 'member_status_events_no_change'],
      ]
      try {
        for (const [table, trigger] of noDelete) await quiet(`alter table ${table} disable trigger ${trigger}`)
        await quiet(`delete from public.portal_account_members where member_id = any($1::bigint[])`, [memberIds])
        await quiet(`delete from public.portal_access_tokens where member_id = any($1::bigint[])`, [memberIds])
        await quiet(`delete from public.portal_accounts where user_id = any($1::uuid[])`, [userIds])
        await quiet(`delete from public.member_status_events where member_id = any($1::bigint[])`, [memberIds])
        await quiet(`delete from public.members where id = any($1::bigint[])`, [memberIds])
      } finally {
        for (const [table, trigger] of noDelete) await quiet(`alter table ${table} enable trigger ${trigger}`)
      }
      await quiet(`delete from public.app_users where user_id = $1`, [adminId])
      await quiet(`delete from auth.users where id = any($1::uuid[])`, [[adminId, ...userIds]])
      await setup.query('select pg_advisory_unlock(7_261_029)').catch(() => {})
      await setup.end()
    }
  })
})
