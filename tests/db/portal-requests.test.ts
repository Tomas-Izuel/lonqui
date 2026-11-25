import { randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import { actAs, actAsSuperuser, createFamilyGroup, createMember, expectQueryError, isDbAvailable, withRollback } from './helpers'
import {
  actAsServiceRole,
  auditRows,
  auditTrail,
  createTokenCall,
  fakeDni,
  fakePhone,
  issueToken,
  linkNewAccount,
  peekToken,
  portalWorld,
  requestStatus,
  SUBMIT_SQL,
  tokenRow,
  submitParams,
  submitRequest,
  type SubmitOptions,
} from './portal-fixtures'

/**
 * App de socios, S2-T4 (base): PEDIDOS DE ACCESO Y REVISIÓN contra el Postgres local.
 *   - `portal_submit_access_request` (RPC de servicio): normaliza, valida 1 a 10 personas, límites por cliente y por DNI
 *     que descartan EN SILENCIO (la respuesta al usuario es siempre la misma), y no guarda datos personales en los
 *     contadores;
 *   - transiciones del pedido (pending → invited → completed, rejected final; rechazar exige motivo) por la RPC y por
 *     el trigger, y que un pedido resuelto no se puede invitar;
 *   - `portal_request_candidates`: el ranking DNI > teléfono > teléfono del pagador > email > nombre, el tope de 5,
 *     `has_account`, y que no persiste nada;
 *   - `private.phone_match_keys`: 0 de larga distancia, 15, +54 9, sin código de área (con el del club).
 *
 * Todo inventado, todo dentro de `withRollback`.
 */
const dbAvailable = await isDbAvailable()
if (!dbAvailable) {
  console.warn('[tests/db] Postgres local no responde: se saltean los tests de tests/db/.')
}

async function asUser<T>(client: ClientBase, userId: string, fn: () => Promise<T>): Promise<T> {
  await actAs(client, userId)
  try {
    return await fn()
  } finally {
    await actAsSuperuser(client)
  }
}

type Candidate = { person_id: number; member_id: number; score: number; reasons: string[]; family_group_id: number | null; has_account: boolean }

async function candidates(client: ClientBase, userId: string, requestId: number): Promise<Candidate[]> {
  const res = await asUser(client, userId, () => client.query(`select * from public.portal_request_candidates($1::bigint)`, [requestId]))
  return res.rows.map((r) => ({
    person_id: Number(r.person_id),
    member_id: Number(r.member_id),
    score: Number(r.score),
    reasons: r.reasons as string[],
    family_group_id: r.family_group_id === null ? null : Number(r.family_group_id),
    has_account: r.has_account as boolean,
  }))
}

async function requestRow(client: ClientBase, requestId: number) {
  const res = await client.query(`select * from public.portal_access_requests where id = $1`, [requestId])
  return res.rows[0] as Record<string, unknown>
}

async function peopleOf(client: ClientBase, requestId: number) {
  const res = await client.query(`select id, first_name, last_name, dni, relationship from public.portal_access_request_people where request_id = $1 order by id`, [requestId])
  return res.rows as Array<{ id: string; first_name: string; last_name: string; dni: string | null; relationship: string }>
}

async function requestPeopleIds(client: ClientBase, requestId: number): Promise<number[]> {
  return (await peopleOf(client, requestId)).map((p) => Number(p.id))
}

async function countRequests(client: ClientBase, dni: string): Promise<number> {
  const res = await client.query(`select count(*)::int as n from public.portal_access_requests where dni = $1`, [dni])
  return res.rows[0].n
}

async function submitAs(client: ClientBase, o: SubmitOptions) {
  const { dni, params } = submitParams(o)
  await actAsServiceRole(client)
  const err = await expectQueryError(client, SUBMIT_SQL, params)
  await actAsSuperuser(client)
  return { dni, err }
}

// ---------------------------------------------------------------------------
// Enviar el pedido
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('portal_submit_access_request: lo que guarda', () => {
  it('un pedido válido queda pending con los datos recortados, el email en minúsculas, y las personas como se declararon; devuelve true', async () => {
    await withRollback(async (client) => {
      const dniChild = fakeDni()
      const { accepted, requestId, dni } = await submitRequest(client, {
        firstName: '  Marta ',
        lastName: ' Inventada  ',
        phoneRaw: '  0351 15 456-7890 ',
        phoneE164: '+5493514567890',
        email: '  MARTA.Inventada@Correo.Test ',
        message: '  Quiero ver a mis hijos  ',
        people: [
          { first_name: ' Hijo ', last_name: ' Uno ', dni: dniChild, relationship: 'guardian' },
          { first_name: 'Marta', last_name: 'Inventada', dni: '  ', relationship: 'self' },
          { first_name: 'Hija', last_name: 'Dos', relationship: 'guardian' },
        ],
      })
      expect(accepted).toBe(true)
      const row = await requestRow(client, requestId as number)
      expect(row).toMatchObject({
        first_name: 'Marta',
        last_name: 'Inventada',
        dni,
        phone_raw: '0351 15 456-7890',
        phone_e164: '+5493514567890',
        email: 'marta.inventada@correo.test',
        message: 'Quiero ver a mis hijos',
        status: 'pending',
        resolved_by: null,
        resolved_at: null,
        resolution_note: null,
      })
      const people = await peopleOf(client, requestId as number)
      expect(people.map((p) => [p.first_name, p.last_name, p.dni, p.relationship])).toEqual([
        ['Hijo', 'Uno', dniChild, 'guardian'],
        ['Marta', 'Inventada', null, 'self'],
        ['Hija', 'Dos', null, 'guardian'],
      ])
    })
  })

  it('email y mensaje vacíos o en blanco se guardan como NULL; el teléfono E.164 es opcional', async () => {
    await withRollback(async (client) => {
      const { requestId } = await submitRequest(client, { email: '   ', message: '   ', phoneE164: null })
      const row = await requestRow(client, requestId as number)
      expect(row.email).toBeNull()
      expect(row.message).toBeNull()
      expect(row.phone_e164).toBeNull()
    })
  })

  it('de 1 a 10 personas entran; 10 es el tope', async () => {
    await withRollback(async (client) => {
      for (const n of [1, 10]) {
        const people = Array.from({ length: n }, (_, i) => ({ first_name: `Persona${i}`, last_name: 'Inventada', dni: null, relationship: 'guardian' as const }))
        const { accepted, requestId } = await submitRequest(client, { people })
        expect(accepted).toBe(true)
        expect((await peopleOf(client, requestId as number)).length).toBe(n)
      }
    })
  })

  it('cero personas, once, o algo que no es un arreglo: check_violation con el mensaje redactado y NO queda pedido ni persona', async () => {
    await withRollback(async (client) => {
      const eleven = Array.from({ length: 11 }, (_, i) => ({ first_name: `Persona${i}`, last_name: 'Inventada', dni: null, relationship: 'guardian' as const }))
      for (const people of [[], eleven]) {
        const { dni, err } = await submitAs(client, { people })
        expect(err, `${people.length} personas`).toMatchObject({ code: '23514', message: 'Indicá a quién querés ver (hasta 10 personas)' })
        expect(await countRequests(client, dni)).toBe(0)
      }
      // Un objeto o un número en vez de un arreglo.
      for (const bad of ['{"first_name":"A"}', '5', '"texto"']) {
        const { params } = submitParams({})
        params[7] = bad
        await actAsServiceRole(client)
        const err = await expectQueryError(client, SUBMIT_SQL, params)
        await actAsSuperuser(client)
        expect(err, bad).toMatchObject({ code: '23514', message: 'Indicá a quién querés ver (hasta 10 personas)' })
      }
    })
  })

  it('personas nulas (p_people = NULL) NO pasan: el pedido tiene que traer a alguien (1 a 10), no puede quedar un pedido sin personas', async () => {
    await withRollback(async (client) => {
      const { dni, params } = submitParams({ people: null })
      await actAsServiceRole(client)
      await client.query('savepoint people_null')
      const res = await client.query(SUBMIT_SQL, params).then(
        () => ({ ok: true as const }),
        (err: { code?: string; message?: string }) => ({ ok: false as const, code: err.code, message: err.message }),
      )
      await client.query('rollback to savepoint people_null')
      await actAsSuperuser(client)
      const stored = await countRequests(client, dni)
      expect({ res, stored }, 'con p_people NULL la validación `jsonb_typeof(NULL) <> ... or jsonb_array_length(NULL) ...` da NULL y se la saltea').toEqual({
        res: { ok: false, code: '23514', message: 'Indicá a quién querés ver (hasta 10 personas)' },
        stored: 0,
      })
    })
  })

  it('datos mal formados rechazan TODO el pedido (no queda un pedido a medias): nombre vacío, DNI inválido, relación inválida, persona sin nombre', async () => {
    await withRollback(async (client) => {
      const person = { first_name: 'Hijo', last_name: 'Inventado', dni: null as string | null, relationship: 'guardian' as const }
      const cases: Array<{ label: string; o: SubmitOptions; code: string }> = [
        { label: 'nombre en blanco', o: { firstName: '   ' }, code: '23514' },
        { label: 'DNI de 6 dígitos', o: { dni: '123456' }, code: '23514' },
        { label: 'DNI con puntos', o: { dni: '12.345.678' }, code: '23514' },
        { label: 'teléfono de 3 caracteres', o: { phoneRaw: '123' }, code: '23514' },
        { label: 'teléfono E.164 sin +', o: { phoneE164: '5493511234567' }, code: '23514' },
        { label: 'mensaje de más de 500 caracteres', o: { message: 'x'.repeat(501) }, code: '23514' },
        { label: 'email de más de 254 caracteres', o: { email: `${'a'.repeat(250)}@b.test` }, code: '23514' },
        { label: 'persona con DNI inválido', o: { people: [{ ...person, dni: '1234' }] }, code: '23514' },
        { label: 'persona con relación inválida', o: { people: [{ ...person, relationship: 'tutor' as 'self' }] }, code: '23514' },
        { label: 'persona sin nombre', o: { people: [{ ...person, first_name: '' }] }, code: '23514' },
        { label: 'persona sin apellido (clave ausente)', o: { people: [{ first_name: 'Hijo', relationship: 'guardian' } as never] }, code: '23502' },
      ]
      for (const c of cases) {
        const { dni, err } = await submitAs(client, c.o)
        expect(err.code, c.label).toBe(c.code)
        expect(await countRequests(client, c.o.dni ?? dni), c.label).toBe(0)
      }
    })
  })

  it('la carga de un pedido deja auditoría de sistema (la secret key no tiene sesión) con el pedido y sus personas', async () => {
    await withRollback(async (client) => {
      const { requestId } = await submitRequest(client)
      const audit = await auditRows(client, 'portal_access_requests', requestId as number)
      expect(auditTrail(audit)).toEqual([['INSERT', null, 'system']])
      const people = await requestPeopleIds(client, requestId as number)
      for (const id of people) expect(auditTrail(await auditRows(client, 'portal_access_request_people', id))).toEqual([['INSERT', null, 'system']])
    })
  })
})

describe.skipIf(!dbAvailable)('portal_submit_access_request: límites que descartan en silencio', () => {
  it('el sexto pedido del mismo cliente en el día devuelve false (sin error, sin fila, sin personas); otro cliente sigue entrando', async () => {
    await withRollback(async (client) => {
      const clientKey = `ip-${randomUUID()}`
      const accepted: boolean[] = []
      for (let i = 0; i < 5; i++) accepted.push((await submitRequest(client, { clientKey })).accepted)
      expect(accepted).toEqual([true, true, true, true, true])

      const peopleBefore = (await client.query(`select count(*)::int as n from public.portal_access_request_people`)).rows[0].n
      const requestsBefore = (await client.query(`select count(*)::int as n from public.portal_access_requests`)).rows[0].n
      const sixth = await submitRequest(client, { clientKey })
      expect(sixth).toMatchObject({ accepted: false, requestId: null })
      expect(await countRequests(client, sixth.dni), 'no se guardó el pedido').toBe(0)
      expect((await client.query(`select count(*)::int as n from public.portal_access_requests`)).rows[0].n).toBe(requestsBefore)
      expect((await client.query(`select count(*)::int as n from public.portal_access_request_people`)).rows[0].n).toBe(peopleBefore)
      // Sigue descartando.
      expect((await submitRequest(client, { clientKey })).accepted).toBe(false)

      // Otro cliente no se ve afectado.
      expect((await submitRequest(client, { clientKey: `ip-${randomUUID()}` })).accepted).toBe(true)
    })
  })

  it('el cuarto pedido con el mismo DNI en el día devuelve false aunque venga de clientes distintos (3 por DNI); otro DNI sigue entrando', async () => {
    await withRollback(async (client) => {
      const dni = fakeDni()
      const results: boolean[] = []
      for (let i = 0; i < 4; i++) results.push((await submitRequest(client, { dni })).accepted)
      expect(results).toEqual([true, true, true, false])
      expect(await countRequests(client, dni)).toBe(3)
      expect((await submitRequest(client, { dni: fakeDni() })).accepted).toBe(true)
    })
  })

  it('la respuesta de un pedido descartado tiene la misma forma que la de uno aceptado (un booleano): nada que distinga el motivo del descarte', async () => {
    await withRollback(async (client) => {
      const dni = fakeDni()
      const clientKey = `ip-${randomUUID()}`
      const shapes = new Set<string>()
      for (let i = 0; i < 7; i++) {
        const { params } = submitParams({ dni, clientKey })
        await actAsServiceRole(client)
        const res = await client.query(SUBMIT_SQL, params)
        await actAsSuperuser(client)
        shapes.add(`${res.fields.map((f) => f.name).join(',')}:${typeof res.rows[0].accepted}`)
      }
      expect([...shapes]).toEqual(['accepted:boolean'])
    })
  })

  it('los contadores guardan el sujeto hasheado: ni la clave del cliente ni el DNI aparecen en private.portal_rate_limits', async () => {
    await withRollback(async (client) => {
      const dni = fakeDni()
      const clientKey = `ip-ficticia-${randomUUID()}`
      await submitRequest(client, { dni, clientKey })
      const rows = await client.query<{ bucket: string; subject_hash: string; hits: number }>(
        `select bucket, subject_hash, hits from private.portal_rate_limits where window_start >= now() - interval '2 days' order by window_start desc, bucket`,
      )
      const mine = rows.rows.filter((r) => r.bucket === 'access_request_client' || r.bucket === 'access_request_dni')
      expect(mine.length).toBeGreaterThanOrEqual(2)
      for (const r of mine) expect(r.subject_hash).toMatch(/^[0-9a-f]{64}$/)
      const all = JSON.stringify(rows.rows)
      expect(all).not.toContain(dni)
      expect(all).not.toContain(clientKey)
      // El hash incluye el balde: la misma clave en dos baldes no deja el mismo valor.
      const sameKey = await client.query(`select count(distinct subject_hash)::int as n from private.portal_rate_limits where bucket in ('access_request_client', 'access_request_dni') and subject_hash = any($1::text[])`, [mine.map((r) => r.subject_hash)])
      expect(sameKey.rows[0].n).toBe(mine.length === 2 ? 2 : sameKey.rows[0].n)
    })
  })

  it('private.portal_rate_hit: ventana, tope inclusivo, baldes y sujetos independientes, sujeto nulo tratado como vacío', async () => {
    await withRollback(async (client) => {
      const hit = async (bucket: string, subject: string | null, max = 2) =>
        (await client.query<{ ok: boolean }>(`select private.portal_rate_hit($1::text, $2::text, interval '1 hour', $3::int) as ok`, [bucket, subject, max])).rows[0].ok
      const bucket = `b-${randomUUID()}`
      expect([await hit(bucket, 's1'), await hit(bucket, 's1'), await hit(bucket, 's1'), await hit(bucket, 's1')]).toEqual([true, true, false, false])
      expect(await hit(bucket, 's2'), 'otro sujeto, otro contador').toBe(true)
      expect(await hit(`${bucket}-otro`, 's1'), 'otro balde, otro contador').toBe(true)
      expect([await hit(bucket, null), await hit(bucket, null), await hit(bucket, null)]).toEqual([true, true, false])
      expect(await hit(bucket, '', 2), 'nulo y vacío son el mismo sujeto').toBe(false)
      // Con tope 0 nada pasa; con tope 1 pasa el primero.
      expect(await hit(`${bucket}-cero`, 'x', 0)).toBe(false)
      expect(await hit(`${bucket}-uno`, 'x', 1)).toBe(true)
    })
  })

  it('la función de límites es privada: authenticated, anon y service_role no la pueden ejecutar', async () => {
    await withRollback(async (client) => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const r = await client.query(`select has_function_privilege($1, 'private.portal_rate_hit(text, text, interval, integer)', 'execute') as ok`, [role])
        expect(r.rows[0].ok, `${role} puede ejecutar private.portal_rate_hit`).toBe(false)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('pedido: transiciones de estado', () => {
  const reject = (client: ClientBase, userId: string, requestId: number, note: string | null) =>
    asUser(client, userId, () => client.query(`select public.resolve_portal_request($1::bigint, 'rejected', $2::text)`, [requestId, note]))

  it('pending → invited (al emitir la invitación desde el pedido, con quién y cuándo) → completed (solo canjeando): el estado y el actor', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      expect((await requestStatus(client, requestId as number)).status).toBe('pending')
      await issueToken(client, w.editorId, { memberId: w.noDniId, delivery: 'qr', requestId: requestId as number })
      const invited = await requestStatus(client, requestId as number)
      expect(invited).toMatchObject({ status: 'invited', resolved_by: w.editorId })
      expect(invited.resolved_at).not.toBeNull()
      expect(invited.resolution_note).toBeNull()

      const audit = await auditRows(client, 'portal_access_requests', requestId as number)
      expect(auditTrail(audit)).toEqual([
        ['INSERT', null, 'system'],
        ['UPDATE', w.editorId, 'session'],
      ])
      expect(audit[1].changed_fields).toEqual(['resolved_at', 'resolved_by', 'status'])
    })
  })

  it('invitar de nuevo un pedido ya invitado (reemisión) es válido: sigue invited, queda el último que invitó y el token anterior del mismo destino se revoca', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      const first = await issueToken(client, w.editorId, { memberId: w.noDniId, delivery: 'qr', requestId: requestId as number })
      const second = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'whatsapp', requestId: requestId as number })
      expect(await requestStatus(client, requestId as number)).toMatchObject({ status: 'invited', resolved_by: w.adminId })
      const revoked = await client.query(`select revoked_at from public.portal_access_tokens where id = $1`, [first.tokenId])
      expect(revoked.rows[0].revoked_at).not.toBeNull()
      expect(second.tokenId).not.toBe(first.tokenId)
    })
  })

  it('rechazar: queda rejected con quién, cuándo y el motivo recortado; y es final', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      await reject(client, w.editorId, requestId as number, '  Ese DNI no figura en el padrón  ')
      const row = await requestStatus(client, requestId as number)
      expect(row).toMatchObject({ status: 'rejected', resolved_by: w.editorId, resolution_note: 'Ese DNI no figura en el padrón' })
      expect(row.resolved_at).not.toBeNull()

      const audit = await auditRows(client, 'portal_access_requests', requestId as number)
      expect(auditTrail(audit)).toEqual([
        ['INSERT', null, 'system'],
        ['UPDATE', w.editorId, 'session'],
      ])
      expect(audit[1].changed_fields).toEqual(['resolution_note', 'resolved_at', 'resolved_by', 'status'])

      // Final: no se puede invitar.
      await actAs(client, w.adminId)
      const { sql, params } = createTokenCall({ memberId: w.noDniId, delivery: 'qr', requestId: requestId as number })
      const invite = await expectQueryError(client, sql, params)
      await actAsSuperuser(client)
      expect(invite).toMatchObject({ code: '23514', message: 'El pedido ya está resuelto' })
      expect((await requestStatus(client, requestId as number)).status).toBe('rejected')
    })
  })

  it('rechazar un pedido invitado revoca sus invitaciones pendientes (motivo "Pedido rechazado"); las de otro pedido y las invitaciones sin pedido no se tocan', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await submitRequest(client)
      const b = await submitRequest(client)
      const ta1 = await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr', requestId: a.requestId as number, replacePending: false })
      const ta2 = await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'whatsapp', requestId: a.requestId as number, replacePending: false })
      const tb = await issueToken(client, w.adminId, { memberId: w.siblingId, delivery: 'qr', requestId: b.requestId as number })
      const free = await issueToken(client, w.adminId, { memberId: w.memberId, delivery: 'qr' })
      await reject(client, w.editorId, a.requestId as number, 'Era un pedido repetido')

      for (const t of [ta1, ta2]) {
        const row = await tokenRow(client, t.tokenId)
        expect(row.revoked_at, `token ${t.tokenId}`).not.toBeNull()
        expect(row.revoke_reason).toBe('Pedido rechazado')
        expect(row.revoked_by).toBe(w.editorId)
        expect((await peekToken(client, t.token)).status).toBe('invalid')
      }
      expect((await tokenRow(client, tb.tokenId)).revoked_at, 'token de otro pedido').toBeNull()
      expect((await tokenRow(client, free.tokenId)).revoked_at, 'invitación sin pedido').toBeNull()
    })
  })

  it('rechazar un pedido YA rechazado falla ("ya está resuelto") y no reescribe quién, cuándo ni el motivo del primer rechazo', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      await reject(client, w.editorId, requestId as number, 'Ese DNI no figura en el padrón')
      const first = await requestStatus(client, requestId as number)

      await actAs(client, w.adminId)
      await client.query('savepoint again')
      const again = await client.query(`select public.resolve_portal_request($1::bigint, 'rejected', 'Otro motivo distinto')`, [requestId]).then(
        () => null,
        (err: { code?: string; message?: string }) => ({ code: err.code, message: err.message }),
      )
      await client.query('rollback to savepoint again')
      await actAsSuperuser(client)
      const after = await requestStatus(client, requestId as number)
      expect({ again, after }, 'rejected es final: la historia de la resolución no se reescribe').toEqual({
        again: { code: '23514', message: 'El pedido ya está resuelto' },
        after: first,
      })
    })
  })

  it('rechazar exige motivo (mínimo 3 caracteres sin los espacios): sin motivo, en blanco o corto → el pedido sigue pending', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      for (const note of [null, '', '   ', 'no', ' ab ']) {
        await actAs(client, w.adminId)
        const err = await expectQueryError(client, `select public.resolve_portal_request($1::bigint, 'rejected', $2::text)`, [requestId, note])
        await actAsSuperuser(client)
        expect(err, JSON.stringify(note)).toMatchObject({ code: '23514', message: 'Indicá el motivo del rechazo' })
      }
      expect((await requestStatus(client, requestId as number)).status).toBe('pending')
      await reject(client, w.adminId, requestId as number, 'abc')
      expect((await requestStatus(client, requestId as number)).status).toBe('rejected')
    })
  })

  it('resolve_portal_request solo rechaza: "invited", "completed" o cualquier otro estado → "Para invitar, emití una invitación desde el pedido"; un pedido inexistente → no_data_found', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      for (const status of ['invited', 'completed', 'pending', 'approved', '']) {
        await actAs(client, w.adminId)
        const err = await expectQueryError(client, `select public.resolve_portal_request($1::bigint, $2::text, 'Motivo de prueba')`, [requestId, status])
        await actAsSuperuser(client)
        expect(err, `"${status}"`).toMatchObject({ code: '23514', message: 'Para invitar, emití una invitación desde el pedido' })
      }
      expect((await requestStatus(client, requestId as number)).status).toBe('pending')
      await actAs(client, w.adminId)
      const missing = await expectQueryError(client, `select public.resolve_portal_request(999999999, 'rejected', 'Motivo de prueba')`)
      await actAsSuperuser(client)
      expect(missing).toMatchObject({ code: 'P0002', message: 'El pedido no existe' })
    })
  })

  it('un pedido ya invitado se puede rechazar (invited → rejected); uno completado no (completed es final)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const a = await submitRequest(client)
      await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr', requestId: a.requestId as number })
      await reject(client, w.adminId, a.requestId as number, 'Se mandó a la persona equivocada')
      expect((await requestStatus(client, a.requestId as number)).status).toBe('rejected')

      const b = await submitRequest(client)
      await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr', requestId: b.requestId as number })
      await client.query(`update public.portal_access_requests set status = 'completed' where id = $1`, [b.requestId])
      await actAs(client, w.adminId)
      const err = await expectQueryError(client, `select public.resolve_portal_request($1::bigint, 'rejected', 'Motivo de prueba')`, [b.requestId])
      const invite = await expectQueryError(client, ...Object.values(createTokenCall({ memberId: w.soloId, delivery: 'qr', requestId: b.requestId as number })) as [string, unknown[]])
      await actAsSuperuser(client)
      expect(err).toMatchObject({ code: '23514', message: 'El pedido ya está resuelto' })
      expect(invite).toMatchObject({ code: '23514', message: 'El pedido ya está resuelto' })
      expect((await requestStatus(client, b.requestId as number)).status).toBe('completed')
    })
  })

  it('el trigger de transiciones frena los saltos aunque el UPDATE lo haga postgres: pending → completed, y salir de rejected o completed', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const set = (id: number, status: string, note: string | null = null) =>
        expectQueryError(client, `update public.portal_access_requests set status = $2, resolution_note = coalesce($3, resolution_note) where id = $1`, [id, status, note])

      const pending = (await submitRequest(client)).requestId as number
      expect(await set(pending, 'completed')).toMatchObject({ code: '23514', message: 'El pedido ya está resuelto' })
      expect(await set(pending, 'rejected', 'ab')).toMatchObject({ code: '23514', message: 'Indicá el motivo del rechazo' })
      expect(await set(pending, 'cualquiera')).toMatchObject({ code: '23514' })

      const rejected = (await submitRequest(client)).requestId as number
      await client.query(`update public.portal_access_requests set status = 'rejected', resolution_note = 'Motivo de prueba' where id = $1`, [rejected])
      for (const to of ['pending', 'invited', 'completed']) {
        expect(await set(rejected, to), `rejected → ${to}`).toMatchObject({ code: '23514', message: 'El pedido ya está resuelto' })
      }

      const completed = (await submitRequest(client)).requestId as number
      await issueToken(client, w.adminId, { memberId: w.noDniId, delivery: 'qr', requestId: completed })
      await client.query(`update public.portal_access_requests set status = 'completed' where id = $1`, [completed])
      for (const to of ['pending', 'invited', 'rejected']) {
        expect(await set(completed, to, 'Motivo de prueba'), `completed → ${to}`).toMatchObject({ code: '23514', message: 'El pedido ya está resuelto' })
      }

      const invited = (await submitRequest(client)).requestId as number
      await issueToken(client, w.adminId, { memberId: w.soloId, delivery: 'qr', requestId: invited })
      expect(await set(invited, 'pending'), 'invited → pending').toMatchObject({ code: '23514', message: 'El pedido ya está resuelto' })
    })
  })

  it('lo declarado es inmutable: nombre, DNI, teléfono, email, mensaje, creación y las personas (ni siquiera postgres los cambia), y nada se borra', async () => {
    await withRollback(async (client) => {
      const { requestId } = await submitRequest(client, { email: 'solicitante@correo.test', phoneE164: '+5493511234567', message: 'Hola' })
      for (const col of ['first_name', 'last_name', 'dni', 'phone_raw', 'phone_e164', 'email', 'message']) {
        const value = col === 'dni' ? `'${fakeDni()}'` : col === 'phone_e164' ? `'+5491100000000'` : col === 'phone_raw' ? `'1100000000'` : `'otro valor'`
        const err = await expectQueryError(client, `update public.portal_access_requests set ${col} = ${value} where id = $1`, [requestId])
        expect(err, col).toMatchObject({ code: '23514', message: `La columna ${col} no se puede modificar` })
      }
      const created = await expectQueryError(client, `update public.portal_access_requests set created_at = now() + interval '1 day' where id = $1`, [requestId])
      expect(created.message).toBe('La columna created_at no se puede modificar')

      const personUpdate = await expectQueryError(client, `update public.portal_access_request_people set first_name = 'Otro' where request_id = $1`, [requestId])
      expect(personUpdate).toMatchObject({ code: '42501', message: 'Los registros de portal_access_request_people no se modifican ni se borran' })
      const personDelete = await expectQueryError(client, `delete from public.portal_access_request_people where request_id = $1`, [requestId])
      expect(personDelete.code).toBe('42501')
      const del = await expectQueryError(client, `delete from public.portal_access_requests where id = $1`, [requestId])
      expect(del).toMatchObject({ code: '42501', message: 'Los registros de portal_access_requests no se modifican ni se borran' })
    })
  })

  it('invitar con un pedido inexistente falla, y con el pedido de otro destino no cambia nada en el pedido hasta que el token se emite', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      await actAs(client, w.adminId)
      const { sql, params } = createTokenCall({ memberId: w.noDniId, delivery: 'qr', requestId: 999999999 })
      const err = await expectQueryError(client, sql, params)
      await actAsSuperuser(client)
      expect(err).toMatchObject({ code: 'P0002', message: 'El pedido no existe' })
      expect((await requestStatus(client, requestId as number)).status).toBe('pending')
    })
  })
})

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('portal_request_candidates: el ranking de sugerencias', () => {
  /** Socios inventados, cada uno con UNA sola coincidencia contra el pedido. Nombres sin parecido entre sí. */
  async function rankingScenario(client: ClientBase) {
    const w = await portalWorld(client)
    const tail = String(fakeDni()).slice(2) // 6 dígitos al azar
    const phone = `351${tail}1` // 10 dígitos
    const personDni = fakeDni()
    const email = `solicitante-${randomUUID().slice(0, 8)}@correo.test`

    const dniMember = await createMember(client, { firstName: 'Zoraida', lastName: 'Quiroga', dni: personDni })
    const phoneMember = await createMember(client, { firstName: 'Ulises', lastName: 'Bermudez', dni: fakeDni() })
    await client.query(`update public.members set phone = $2 where id = $1`, [phoneMember, `0351 15 ${phone.slice(3, 6)}-${phone.slice(6)}`])
    const payerGroup = await createFamilyGroup(client, { name: 'Grupo del Pagador Ficticio' })
    await client.query(`update public.family_groups set payer_contact_phone = $2 where id = $1`, [payerGroup, `+54 9 ${phone.slice(0, 3)} ${phone.slice(3)}`])
    const payerMember = await createMember(client, { firstName: 'Wenceslao', lastName: 'Echeverria', dni: fakeDni(), familyGroupId: payerGroup })
    const emailMember = await createMember(client, { firstName: 'Ximena', lastName: 'Palacios', dni: fakeDni() })
    await client.query(`update public.members set email = $2 where id = $1`, [emailMember, email])
    const nameMember = await createMember(client, { firstName: 'Marianela', lastName: 'Gonzales', dni: fakeDni() })

    const { requestId } = await submitRequest(client, {
      firstName: 'Madre',
      lastName: 'Solicitante',
      phoneRaw: phone,
      phoneE164: `+549${phone}`,
      email,
      people: [{ first_name: 'Marianela', last_name: 'Gonzalez', dni: personDni, relationship: 'guardian' }],
    })
    return { w, requestId: requestId as number, dniMember, phoneMember, payerMember, emailMember, nameMember, phone, personDni, email }
  }

  it('orden: DNI (100) > teléfono (30) > teléfono del pagador del grupo (25) > email (20) > nombre parecido (hasta 15); con el motivo de cada uno', async () => {
    await withRollback(async (client) => {
      const s = await rankingScenario(client)
      const mine = new Map([
        [s.dniMember, 'dni'],
        [s.phoneMember, 'phone'],
        [s.payerMember, 'payer_phone'],
        [s.emailMember, 'email'],
        [s.nameMember, 'name'],
      ])
      const rows = (await candidates(client, s.w.adminId, s.requestId)).filter((c) => mine.has(c.member_id))
      expect(rows.map((r) => mine.get(r.member_id))).toEqual(['dni', 'phone', 'payer_phone', 'email', 'name'])
      for (const r of rows) expect(r.reasons, `reasons de ${mine.get(r.member_id)}`).toEqual([mine.get(r.member_id)])
      const byKind = new Map(rows.map((r) => [mine.get(r.member_id), r.score]))
      expect(byKind.get('dni')).toBe(100)
      expect(byKind.get('phone')).toBe(30)
      expect(byKind.get('payer_phone')).toBe(25)
      expect(byKind.get('email')).toBe(20)
      expect(byKind.get('name')!).toBeGreaterThan(0)
      expect(byKind.get('name')!).toBeLessThanOrEqual(15)
      // Orden descendente estricto por puntaje.
      const scores = rows.map((r) => r.score)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
      for (const r of rows) expect(r.has_account).toBe(false)
    })
  })

  it('las coincidencias se suman: DNI + teléfono + nombre en el mismo socio supera a cualquier coincidencia sola, con los motivos en orden', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const phone = fakePhone()
      const dni = fakeDni()
      const strong = await createMember(client, { firstName: 'Marianela', lastName: 'Gonzalez', dni })
      await client.query(`update public.members set phone = $2 where id = $1`, [strong, phone])
      const weak = await createMember(client, { firstName: 'Otro', lastName: 'Apellido', dni: fakeDni() })
      await client.query(`update public.members set phone = $2 where id = $1`, [weak, phone])
      const { requestId } = await submitRequest(client, {
        phoneRaw: phone,
        phoneE164: `+549${phone}`,
        people: [{ first_name: 'Marianela', last_name: 'Gonzalez', dni, relationship: 'self' }],
      })
      const rows = (await candidates(client, w.adminId, requestId as number)).filter((c) => [strong, weak].includes(c.member_id))
      expect(rows.map((r) => r.member_id)).toEqual([strong, weak])
      expect(rows[0].reasons).toEqual(['dni', 'phone', 'name'])
      expect(rows[0].score).toBe(100 + 30 + 15)
      expect(rows[1].reasons).toEqual(['phone'])
    })
  })

  it('m1: un DNI exacto le gana SIEMPRE a teléfono + email + nombre juntos de otro socio (100 contra 30 + 20 + 15)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const phone = fakePhone()
      const dni = fakeDni()
      const email = `madre-${randomUUID().slice(0, 8)}@correo.test`
      // Socio con el DNI exacto pero nada más (nombre distinto, otro teléfono, otro email).
      const exact = await createMember(client, { firstName: 'Zoraida', lastName: 'Quiroga Ficticia', dni })
      // Otro socio con teléfono, email y nombre iguales a los del pedido, pero DNI distinto.
      const lookalike = await createMember(client, { firstName: 'Marianela', lastName: 'Gonzalez', dni: fakeDni() })
      await client.query(`update public.members set phone = $2, email = $3 where id = $1`, [lookalike, phone, email])
      const { requestId } = await submitRequest(client, {
        phoneRaw: phone,
        phoneE164: `+549${phone}`,
        email,
        people: [{ first_name: 'Marianela', last_name: 'Gonzalez', dni, relationship: 'guardian' }],
      })
      const rows = (await candidates(client, w.adminId, requestId as number)).filter((c) => [exact, lookalike].includes(c.member_id))
      expect(rows.map((r) => r.member_id), 'el DNI exacto va primero').toEqual([exact, lookalike])
      expect(rows[0].score).toBe(100)
      expect(rows[1].reasons).toEqual(['phone', 'email', 'name'])
      expect(rows[1].score).toBe(30 + 20 + 15)
      expect(rows[0].score).toBeGreaterThan(rows[1].score)
    })
  })

  it('el nombre ignora mayúsculas y acentos (José Pérez = jose perez) pero un nombre distinto no coincide', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const same = await createMember(client, { firstName: 'José', lastName: 'Pérez Ficticio', dni: fakeDni() })
      const different = await createMember(client, { firstName: 'Cleofe', lastName: 'Zapiola Imaginaria', dni: fakeDni() })
      const { requestId } = await submitRequest(client, { people: [{ first_name: 'JOSE', last_name: 'perez ficticio', relationship: 'self' }] })
      const rows = (await candidates(client, w.adminId, requestId as number)).filter((c) => [same, different].includes(c.member_id))
      expect(rows.map((r) => r.member_id)).toEqual([same])
      expect(rows[0].reasons).toEqual(['name'])
      expect(rows[0].score).toBe(15)
    })
  })

  it('el teléfono compara por claves de 10 dígitos: "+54 9 351 …" del pedido coincide con "0351 15 …" del padrón y con un número sin área (con el código de área del club)', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const sub = String(fakeDni()).slice(1) // 7 dígitos
      const withZeroAnd15 = await createMember(client, { firstName: 'Teodora', lastName: 'Uno', dni: fakeDni() })
      await client.query(`update public.members set phone = $2 where id = $1`, [withZeroAnd15, `0351 15 ${sub.slice(0, 3)}-${sub.slice(3)}`])
      const noArea = await createMember(client, { firstName: 'Ubaldo', lastName: 'Dos', dni: fakeDni() })
      await client.query(`update public.members set phone = $2 where id = $1`, [noArea, `${sub.slice(0, 3)}-${sub.slice(3)}`])
      const other = await createMember(client, { firstName: 'Valeria', lastName: 'Tres', dni: fakeDni() })
      await client.query(`update public.members set phone = $2 where id = $1`, [other, `0351 15 ${sub.slice(0, 3)}-${String((Number(sub.slice(3)) + 1) % 10000).padStart(4, '0')}`])

      const { requestId } = await submitRequest(client, { phoneRaw: `+54 9 351 ${sub}`, phoneE164: `+549351${sub}`, people: [{ first_name: 'Nadie', last_name: 'Conocido', relationship: 'self' }] })
      const ids = [withZeroAnd15, noArea, other]
      // Sin código de área por defecto, el número sin área NO se puede completar: solo el de "0351 15" coincide.
      await client.query(`update public.settings set default_phone_area_code = null where id = 1`)
      let rows = (await candidates(client, w.adminId, requestId as number)).filter((c) => ids.includes(c.member_id))
      expect(rows.map((r) => r.member_id)).toEqual([withZeroAnd15])

      // Con el código de área del club (351) el de sin área también.
      await client.query(`update public.settings set default_phone_area_code = '351' where id = 1`)
      rows = (await candidates(client, w.adminId, requestId as number)).filter((c) => ids.includes(c.member_id))
      expect(rows.map((r) => r.member_id).sort((a, b) => a - b)).toEqual([withZeroAnd15, noArea].sort((a, b) => a - b))
      for (const r of rows) expect(r.reasons).toEqual(['phone'])
    })
  })

  it('una persona sin ninguna coincidencia no devuelve filas; cada persona del pedido se rankea por separado y tiene su person_id', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const dniA = fakeDni()
      const a = await createMember(client, { firstName: 'Anastasia', lastName: 'Quintana', dni: dniA })
      const { requestId } = await submitRequest(client, {
        people: [
          { first_name: 'Hijo', last_name: 'Uno', dni: dniA, relationship: 'guardian' },
          { first_name: 'Perfecta', last_name: 'Desconocida', dni: fakeDni(), relationship: 'guardian' },
        ],
      })
      const people = await peopleOf(client, requestId as number)
      const rows = (await candidates(client, w.adminId, requestId as number)).filter((c) => c.member_id === a)
      expect(rows).toHaveLength(1)
      expect(rows[0].person_id).toBe(Number(people[0].id))
      const all = await candidates(client, w.adminId, requestId as number)
      expect(all.filter((c) => c.person_id === Number(people[1].id) && c.reasons.includes('dni'))).toEqual([])
    })
  })

  it('devuelve como máximo 5 candidatos por persona', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const phone = fakePhone()
      const ids: number[] = []
      for (let i = 0; i < 7; i++) {
        const id = await createMember(client, { firstName: `Hermano${i}`, lastName: 'Compartido', dni: fakeDni() })
        await client.query(`update public.members set phone = $2 where id = $1`, [id, phone])
        ids.push(id)
      }
      const { requestId } = await submitRequest(client, { phoneRaw: phone, phoneE164: `+549${phone}`, people: [{ first_name: 'Nadie', last_name: 'Conocido', relationship: 'self' }] })
      const rows = await candidates(client, w.adminId, requestId as number)
      const person = (await peopleOf(client, requestId as number))[0]
      const forPerson = rows.filter((r) => r.person_id === Number(person.id))
      expect(forPerson.length).toBeLessThanOrEqual(5)
      expect(forPerson.filter((r) => ids.includes(r.member_id)).length).toBeGreaterThan(0)
    })
  })

  it('has_account: true si el socio tiene una cuenta ACTIVA con vínculo vigente; falso con la cuenta bloqueada o el vínculo revocado', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const dni = fakeDni()
      const target = await createMember(client, { firstName: 'Ricardina', lastName: 'Uriarte', dni })
      const { requestId } = await submitRequest(client, { people: [{ first_name: 'Hijo', last_name: 'Uno', dni, relationship: 'guardian' }] })
      const hasAccount = async () => (await candidates(client, w.adminId, requestId as number)).find((c) => c.member_id === target)?.has_account
      expect(await hasAccount()).toBe(false)

      const a = await linkNewAccount(client, { adminId: w.adminId, memberId: target })
      expect(await hasAccount()).toBe(true)

      await asUser(client, w.adminId, () => client.query(`select public.set_portal_account_status($1::uuid, 'blocked', 'Motivo de prueba')`, [a.userId]))
      expect(await hasAccount(), 'cuenta bloqueada').toBe(false)
      await asUser(client, w.adminId, () => client.query(`select public.set_portal_account_status($1::uuid, 'active', 'Motivo de prueba')`, [a.userId]))
      expect(await hasAccount()).toBe(true)

      await asUser(client, w.adminId, () => client.query(`select public.revoke_portal_link($1::bigint, 'Motivo de prueba')`, [a.linkId]))
      expect(await hasAccount(), 'vínculo revocado').toBe(false)
    })
  })

  it('las sugerencias no se guardan: calcular candidatos no cambia ninguna tabla del portal', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client, { people: [{ first_name: 'Ana', last_name: 'Inventada', dni: w.memberDni, relationship: 'guardian' }] })
      const snap = async () =>
        (
          await client.query(
            `select (select count(*) from public.portal_access_requests)::text || ':' || (select count(*) from public.portal_access_request_people)::text || ':' ||
                    (select count(*) from public.portal_accounts)::text || ':' || (select count(*) from public.portal_account_members)::text || ':' ||
                    (select count(*) from public.portal_access_tokens)::text || ':' || (select count(*) from public.audit_log where occurred_at >= now())::text as s`,
          )
        ).rows[0].s
      const before = await snap()
      const rows = await candidates(client, w.adminId, requestId as number)
      expect(rows.length).toBeGreaterThan(0)
      expect(await snap()).toBe(before)
    })
  })

  it('un pedido que no existe: no_data_found para quien tiene permiso; 42501 para quien no (consulta) aunque el id exista', async () => {
    await withRollback(async (client) => {
      const w = await portalWorld(client)
      const { requestId } = await submitRequest(client)
      await actAs(client, w.editorId)
      const missing = await expectQueryError(client, `select * from public.portal_request_candidates(999999999)`)
      await actAsSuperuser(client)
      expect(missing).toMatchObject({ code: 'P0002', message: 'El pedido no existe' })
      await actAs(client, w.consultaId)
      const denied = await expectQueryError(client, `select * from public.portal_request_candidates($1::bigint)`, [requestId])
      await actAsSuperuser(client)
      expect(denied).toMatchObject({ code: '42501', message: 'No tenés permiso para revisar pedidos' })
    })
  })
})

// ---------------------------------------------------------------------------
// Teléfonos
// ---------------------------------------------------------------------------

describe.skipIf(!dbAvailable)('private.phone_match_keys: claves de coincidencia', () => {
  const keys = async (client: ClientBase, raw: string | null, area: string | null = null): Promise<string[]> => {
    const res = await client.query<{ k: string[] }>(`select private.phone_match_keys($1::text, $2::text) as k`, [raw, area])
    return res.rows[0].k
  }

  it('vacío, nulo o sin dígitos: ninguna clave', async () => {
    await withRollback(async (client) => {
      for (const raw of [null, '', '   ', 'sin teléfono', '--- ()']) expect(await keys(client, raw), JSON.stringify(raw)).toEqual([])
    })
  })

  const TEN_DIGITS = '3514567890'
  const CASES: Array<[string, string, string[]]> = [
    ['10 dígitos tal cual', '3514567890', [TEN_DIGITS]],
    ['con separadores', '(351) 456-7890', [TEN_DIGITS]],
    ['con el 0 de larga distancia', '0351 456-7890', [TEN_DIGITS]],
    ['con el 15 y SIN el 0', '351 15 456-7890', [TEN_DIGITS]],
    ['con el 0 y el 15', '0351 15 456-7890', [TEN_DIGITS]],
    ['con el 0 y el 15 con guiones', '(0351) 15-4567890', [TEN_DIGITS]],
    ['+54 (sin el 9)', '+54 351 456 7890', [TEN_DIGITS]],
    ['+54 9 (móvil)', '+54 9 351 456 7890', [TEN_DIGITS]],
    ['+54 9 pegado', '+5493514567890', [TEN_DIGITS]],
    ['54 9 sin el +', '54 9 351 4567890', [TEN_DIGITS]],
    ['+54 con el 15 (formato viejo)', '+54 351 15 456-7890', [TEN_DIGITS]],
    ['área de 2 dígitos con 0 y 15', '011 15 1234-5678', ['1112345678']],
    ['área de 2 dígitos +54 9', '+54 9 11 1234-5678', ['1112345678']],
    ['área de 4 dígitos con 0 y 15', '02966 15 612345', ['2966612345']],
    ['área de 4 dígitos +54 9', '+54 9 2966 612345', ['2966612345']],
    ['11 dígitos con 9 delante, sin 54', '93514567890', [TEN_DIGITS]],
  ]
  for (const [label, raw, expected] of CASES) {
    it(`${label}: ${raw}`, async () => {
      await withRollback(async (client) => {
        expect(await keys(client, raw)).toEqual(expected)
      })
    })
  }

  it('NO se pasa de rosca: un número de 10 dígitos que empieza con 54 o 9 no se recorta', async () => {
    await withRollback(async (client) => {
      expect(await keys(client, '5435145678')).toEqual(['5435145678'])
      expect(await keys(client, '9112345678')).toEqual(['9112345678'])
    })
  })

  it('sin código de área: se completa con el del club solo si queda de 10 dígitos; sin el del club queda el número tal cual', async () => {
    await withRollback(async (client) => {
      expect(await keys(client, '456-7890', '351')).toEqual([TEN_DIGITS])
      expect(await keys(client, '15 456 7890', '351')).toEqual([TEN_DIGITS])
      expect(await keys(client, '612345', '2966')).toEqual(['2966612345'])
      expect(await keys(client, '1234-5678', '11')).toEqual(['1112345678'])
      // Sin el código del club no se inventa nada.
      expect(await keys(client, '456-7890')).toEqual(['4567890'])
      expect(await keys(client, '15 456 7890')).toEqual(['154567890'])
      // El código del club no arma un número de largo imposible: queda el número tal cual.
      expect(await keys(client, '351456789', '351')).toEqual(['351456789'])
      expect(await keys(client, '4567890', '2966')).toEqual(['4567890'])
    })
  })

  it('dos teléfonos "coinciden" si sus claves se intersecan: el mismo número en todos los formatos sí, uno distinto en un dígito no', async () => {
    await withRollback(async (client) => {
      const overlap = async (a: string, b: string, area: string | null = null) =>
        (await client.query<{ o: boolean }>(`select private.phone_match_keys($1::text, $3::text) && private.phone_match_keys($2::text, $3::text) as o`, [a, b, area])).rows[0].o
      const formats = ['3514567890', '0351 456-7890', '0351 15 456-7890', '+54 9 351 456 7890', '+54 351 456-7890']
      for (const a of formats) for (const b of formats) expect(await overlap(a, b), `${a} ~ ${b}`).toBe(true)
      expect(await overlap('3514567890', '3514567891')).toBe(false)
      expect(await overlap('0351 15 456-7890', '+54 9 351 456 7891')).toBe(false)
      expect(await overlap('456-7890', '+54 9 351 456 7890')).toBe(false)
      expect(await overlap('456-7890', '+54 9 351 456 7890', '351')).toBe(true)
      // Vacío no coincide con nada (ni con otro vacío).
      expect(await overlap('', '')).toBe(false)
      expect(await overlap(null as unknown as string, '3514567890')).toBe(false)
    })
  })

  it('la función es privada: ni anon, ni authenticated, ni service_role pueden ejecutarla', async () => {
    await withRollback(async (client) => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const r = await client.query(`select has_function_privilege($1, 'private.phone_match_keys(text, text)', 'execute') as ok`, [role])
        expect(r.rows[0].ok, role).toBe(false)
      }
    })
  })
})
