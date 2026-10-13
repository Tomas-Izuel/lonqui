import { randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
import { describe, expect, it } from 'vitest'
import { actAs, actAsSuperuser, createUserWithRole, expectQueryError, hasGrant, isDbAvailable, withRollback } from './helpers'

/**
 * Caja: otros ingresos (`cash_movements`), sponsors y conceptos
 * (`cash_concepts`). Todo lo que importa vive en Postgres (RLS, grants por
 * columna, triggers, índices únicos, RPC), así que se prueba contra la base
 * real y como el rol que de verdad llega por PostgREST: `set local role
 * authenticated` + `request.jwt.claims`.
 *
 * Fixtures inventados y propios de cada test (transacción + rollback). Los
 * conceptos y sponsors se crean con nombres al azar: no dependemos del seed
 * ni de lo que el QA manual haya dejado en la base local, ni de conteos
 * absolutos (los totales se miden como DELTA sobre un mes que el test elige).
 */
const dbAvailable = await isDbAvailable()

type Ctx = { adminId: string; editorId: string; consultaId: string }

async function users(client: ClientBase): Promise<Ctx> {
  const { userId: adminId } = await createUserWithRole(client, 'admin')
  const { userId: editorId } = await createUserWithRole(client, 'editor')
  const { userId: consultaId } = await createUserWithRole(client, 'consulta')
  return { adminId, editorId, consultaId }
}

async function createConcept(
  client: ClientBase,
  input: { requiresSponsor?: boolean; isActive?: boolean; name?: string } = {},
): Promise<number> {
  await actAsSuperuser(client)
  const row = await client.query<{ id: string }>(
    `insert into public.cash_concepts (name, requires_sponsor, is_active) values ($1, $2, $3) returning id`,
    [input.name ?? `Concepto ${randomUUID().slice(0, 8)}`, input.requiresSponsor ?? false, input.isActive ?? true],
  )
  return Number(row.rows[0].id)
}

async function createSponsor(client: ClientBase, input: { name?: string; active?: boolean } = {}): Promise<number> {
  await actAsSuperuser(client)
  const active = input.active ?? true
  const row = await client.query<{ id: string }>(
    active
      ? `insert into public.sponsors (name) values ($1) returning id`
      : `insert into public.sponsors (name, is_active, deactivated_at, deactivated_by, deactivation_reason)
         values ($1, false, now(), '00000000-0000-0000-0000-000000000000', 'fixture desactivado') returning id`,
    [input.name ?? `Sponsor ${randomUUID().slice(0, 8)}`],
  )
  return Number(row.rows[0].id)
}

type MovementInput = {
  conceptId: number
  sponsorId?: number | null
  amountCents?: number
  occurredOn?: string
  method?: 'cash' | 'transfer'
  batchId?: string
  description?: string | null
  receiptPath?: string | null
}

/** INSERT con el rol que esté activo en la sesión. */
async function insertMovement(client: ClientBase, input: MovementInput): Promise<number> {
  const row = await client.query<{ id: string }>(
    `insert into public.cash_movements (concept_id, sponsor_id, amount_cents, occurred_on, method, batch_id, description, receipt_storage_path)
     values ($1, $2, $3, coalesce($4::date, private.club_today()), $5, $6, $7, $8) returning id`,
    [
      input.conceptId,
      input.sponsorId ?? null,
      input.amountCents ?? 1_000_000,
      input.occurredOn ?? null,
      input.method ?? 'cash',
      input.batchId ?? randomUUID(),
      input.description ?? null,
      input.receiptPath ?? null,
    ],
  )
  return Number(row.rows[0].id)
}

async function movementRow(client: ClientBase, id: number) {
  await actAsSuperuser(client)
  const row = await client.query(`select *, occurred_on::text as occurred_on_text from public.cash_movements where id = $1`, [id])
  return row.rows[0]
}

describe.skipIf(!dbAvailable)('cash_concepts: matriz por rol', () => {
  it('consulta y editor leen conceptos; anon no ve nada ni tiene grant', async () => {
    await withRollback(async (client) => {
      const { consultaId, editorId } = await users(client)
      const conceptId = await createConcept(client)

      for (const id of [consultaId, editorId]) {
        await actAs(client, id)
        const r = await client.query(`select id from public.cash_concepts where id = $1`, [conceptId])
        expect(r.rowCount).toBe(1)
      }

      await actAsSuperuser(client)
      await client.query('set local role anon')
      const err = await expectQueryError(client, `select id from public.cash_concepts`)
      expect(err.code).toBe('42501')
    })
  })

  it('un usuario sin fila en app_users (o con rol puesto en user_metadata) no ve ningún concepto', async () => {
    await withRollback(async (client) => {
      const conceptId = await createConcept(client)
      const ghost = randomUUID()
      await actAs(client, ghost, { extraClaims: { user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } })
      const r = await client.query(`select id from public.cash_concepts where id = $1`, [conceptId])
      expect(r.rowCount).toBe(0)
    })
  })

  it('solo admin crea y edita conceptos: consulta y editor chocan con RLS', async () => {
    await withRollback(async (client) => {
      const { adminId, editorId, consultaId } = await users(client)
      const conceptId = await createConcept(client, { name: `Original ${randomUUID().slice(0, 6)}` })

      for (const id of [consultaId, editorId]) {
        await actAs(client, id)
        const ins = await expectQueryError(client, `insert into public.cash_concepts (name) values ('Intruso concepto')`)
        expect(ins.message).toMatch(/row-level security/i)

        // UPDATE bloqueado por RLS: no tira, afecta 0 filas (y el valor no cambia).
        const upd = await client.query(`update public.cash_concepts set name = 'Pisado por intruso' where id = $1`, [conceptId])
        expect(upd.rowCount).toBe(0)
      }

      await actAs(client, adminId)
      const created = await client.query(`insert into public.cash_concepts (name, requires_sponsor) values ($1, true) returning id`, [
        `Nuevo ${randomUUID().slice(0, 6)}`,
      ])
      expect(created.rowCount).toBe(1)
      const upd = await client.query(`update public.cash_concepts set is_active = false where id = $1`, [conceptId])
      expect(upd.rowCount).toBe(1)

      await actAsSuperuser(client)
      const after = await client.query(`select name, is_active from public.cash_concepts where id = $1`, [conceptId])
      expect(after.rows[0].name).not.toBe('Pisado por intruso')
      expect(after.rows[0].is_active).toBe(false)
    })
  })

  it('direction, id y created_at son inmutables: sin grant para admin y trigger incluso para postgres', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      const conceptId = await createConcept(client)

      await actAs(client, adminId)
      for (const col of ['direction', 'created_at']) {
        const err = await expectQueryError(client, `update public.cash_concepts set ${col} = ${col} where id = $1`, [conceptId])
        expect(err.code, col).toBe('42501')
      }

      await actAsSuperuser(client)
      const err = await expectQueryError(client, `update public.cash_concepts set direction = 'expense' where id = $1`, [conceptId])
      // Primero salta el CHECK (hoy solo 'income') o el trigger de inmutables: en ambos casos no cambia.
      expect(err.message).toMatch(/direction|no se puede modificar|check/i)
    })
  })

  it('el nombre es único sin distinguir mayúsculas ni espacios en los bordes', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      const name = `Rifa ${randomUUID().slice(0, 6)}`
      await createConcept(client, { name })

      await actAs(client, adminId)
      const err = await expectQueryError(client, `insert into public.cash_concepts (name) values ($1)`, [`  ${name.toUpperCase()} `])
      expect(err.code).toBe('23505')
    })
  })

  it('nombre muy corto o vacío: CHECK', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      await actAs(client, adminId)
      const err = await expectQueryError(client, `insert into public.cash_concepts (name) values (' a ')`)
      expect(err.code).toBe('23514')
    })
  })
})

describe.skipIf(!dbAvailable)('sponsors: matriz por rol', () => {
  it('consulta lee pero no escribe; anon no tiene ni el grant', async () => {
    await withRollback(async (client) => {
      const { consultaId } = await users(client)
      const sponsorId = await createSponsor(client)

      await actAs(client, consultaId)
      const read = await client.query(`select id from public.sponsors where id = $1`, [sponsorId])
      expect(read.rowCount).toBe(1)

      const ins = await expectQueryError(client, `insert into public.sponsors (name) values ('Intruso SA')`)
      expect(ins.message).toMatch(/row-level security/i)
      const upd = await client.query(`update public.sponsors set name = 'Pisado SA' where id = $1`, [sponsorId])
      expect(upd.rowCount).toBe(0)

      await actAsSuperuser(client)
      await client.query('set local role anon')
      const anon = await expectQueryError(client, `select id from public.sponsors`)
      expect(anon.code).toBe('42501')
    })
  })

  it('editor crea y edita datos, y created_by sale de auth.uid() (no se puede falsear)', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      await actAs(client, editorId)
      const name = `Sponsor ${randomUUID().slice(0, 8)}`
      const created = await client.query<{ id: string; created_by: string }>(
        `insert into public.sponsors (name, contact_name, phone, email) values ($1, 'Contacto Inventado', '2923 555-0000', 'x@ejemplo.test') returning id, created_by`,
        [name],
      )
      expect(created.rows[0].created_by).toBe(editorId)

      const upd = await client.query(`update public.sponsors set notes = 'Aporta en abril', phone = '2923 555-1111' where id = $1`, [
        created.rows[0].id,
      ])
      expect(upd.rowCount).toBe(1)

      // created_by explícito: no hay grant de INSERT sobre esa columna.
      const spoof = await expectQueryError(client, `insert into public.sponsors (name, created_by) values ('Falso SA', $1)`, [adminId])
      expect(spoof.code).toBe('42501')
    })
  })

  it('el email se guarda en minúsculas: con mayúsculas el CHECK lo rechaza', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      await actAs(client, editorId)
      const err = await expectQueryError(client, `insert into public.sponsors (name, email) values ('Mail SA', 'Compras@Ejemplo.TEST')`)
      expect(err.code).toBe('23514')
    })
  })

  it('el nombre es único sin distinguir mayúsculas (23505) y tiene largo mínimo', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const name = `Ferretería ${randomUUID().slice(0, 6)}`
      await createSponsor(client, { name })

      await actAs(client, editorId)
      const dup = await expectQueryError(client, `insert into public.sponsors (name) values ($1)`, [name.toUpperCase()])
      expect(dup.code).toBe('23505')
      const short = await expectQueryError(client, `insert into public.sponsors (name) values (' x ')`)
      expect(short.code).toBe('23514')
    })
  })

  it('editor NO desactiva ni reactiva (42501 del guard); consulta tampoco (RLS)', async () => {
    await withRollback(async (client) => {
      const { editorId, consultaId } = await users(client)
      const activeId = await createSponsor(client)
      const inactiveId = await createSponsor(client, { active: false })

      await actAs(client, editorId)
      const deactivate = await expectQueryError(
        client,
        `update public.sponsors set is_active = false, deactivation_reason = 'Cerró el local' where id = $1`,
        [activeId],
      )
      expect(deactivate.code).toBe('42501')
      const reactivate = await expectQueryError(client, `update public.sponsors set is_active = true where id = $1`, [inactiveId])
      expect(reactivate.code).toBe('42501')

      await actAs(client, consultaId)
      const consulta = await client.query(`update public.sponsors set is_active = true where id = $1`, [inactiveId])
      expect(consulta.rowCount).toBe(0)
    })
  })

  it('admin desactiva con motivo: el guard fija deactivated_at y deactivated_by = auth.uid(), aunque el cliente mande otros', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      const sponsorId = await createSponsor(client)

      await actAs(client, adminId)
      // deactivated_at/by no tienen grant de UPDATE: no hay forma de mandarlos.
      const spoof = await expectQueryError(client, `update public.sponsors set deactivated_by = $2 where id = $1`, [sponsorId, randomUUID()])
      expect(spoof.code).toBe('42501')

      await client.query(`update public.sponsors set is_active = false, deactivation_reason = 'Cerró el local' where id = $1`, [sponsorId])

      await actAsSuperuser(client)
      const row = await client.query(`select is_active, deactivated_by, deactivated_at, deactivation_reason from public.sponsors where id = $1`, [sponsorId])
      expect(row.rows[0].is_active).toBe(false)
      expect(row.rows[0].deactivated_by).toBe(adminId)
      expect(row.rows[0].deactivated_at).toBeInstanceOf(Date)
      expect(row.rows[0].deactivation_reason).toBe('Cerró el local')
    })
  })

  it('desactivar sin motivo, o con motivo de menos de 3 caracteres, se rechaza', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      const sponsorId = await createSponsor(client)

      await actAs(client, adminId)
      for (const reason of [null, '', '  ', 'ab']) {
        const err = await expectQueryError(client, `update public.sponsors set is_active = false, deactivation_reason = $2 where id = $1`, [sponsorId, reason])
        expect(err.code, `motivo ${JSON.stringify(reason)}`).toBe('23514')
      }
      await actAsSuperuser(client)
      const row = await client.query(`select is_active from public.sponsors where id = $1`, [sponsorId])
      expect(row.rows[0].is_active).toBe(true)
    })
  })

  it('tocar la tríada sin cambiar is_active (motivo suelto sobre un sponsor activo o ya desactivado) se rechaza', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      const activeId = await createSponsor(client)
      const inactiveId = await createSponsor(client, { active: false })

      await actAs(client, adminId)
      const onActive = await expectQueryError(client, `update public.sponsors set deactivation_reason = 'motivo suelto' where id = $1`, [activeId])
      expect(onActive.code).toBe('23514')
      const onInactive = await expectQueryError(client, `update public.sponsors set deactivation_reason = 'otro motivo' where id = $1`, [inactiveId])
      expect(onInactive.code).toBe('23514')
    })
  })

  it('reactivar limpia la tríada completa; el motivo viejo queda en la auditoría', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      const sponsorId = await createSponsor(client)

      await actAs(client, adminId)
      await client.query(`update public.sponsors set is_active = false, deactivation_reason = 'Pausa por obras' where id = $1`, [sponsorId])
      await client.query(`update public.sponsors set is_active = true where id = $1`, [sponsorId])

      await actAsSuperuser(client)
      const row = await client.query(`select is_active, deactivated_at, deactivated_by, deactivation_reason from public.sponsors where id = $1`, [sponsorId])
      expect(row.rows[0]).toEqual({ is_active: true, deactivated_at: null, deactivated_by: null, deactivation_reason: null })

      const audit = await client.query(
        `select old_data, new_data from public.audit_log where table_name = 'sponsors' and record_id = $1 and op = 'UPDATE' order by id`,
        [String(sponsorId)],
      )
      expect(audit.rowCount).toBe(2)
      // El motivo de la baja sigue siendo recuperable: está en el old_data de la reactivación.
      expect(audit.rows[1].old_data.deactivation_reason).toBe('Pausa por obras')
      expect(audit.rows[1].new_data.deactivation_reason).toBeNull()
    })
  })

  it('el guard de estado vale también para postgres sin sesión: sin sponsors.deactivate no hay cambio de estado', async () => {
    await withRollback(async (client) => {
      const sponsorId = await createSponsor(client)
      const err = await expectQueryError(client, `update public.sponsors set is_active = false, deactivation_reason = 'Sin sesión' where id = $1`, [sponsorId])
      expect(err.code).toBe('42501')
      const row = await client.query(`select is_active from public.sponsors where id = $1`, [sponsorId])
      expect(row.rows[0].is_active).toBe(true)
    })
  })

  it('id y created_at son inmutables incluso para postgres', async () => {
    await withRollback(async (client) => {
      const sponsorId = await createSponsor(client)
      const err = await expectQueryError(client, `update public.sponsors set created_at = now() - interval '1 day' where id = $1`, [sponsorId])
      expect(err.message).toMatch(/no se puede modificar/i)
    })
  })

  it('editar datos con el guard: un rol sin income.register no los toca (la policy lo corta antes)', async () => {
    await withRollback(async (client) => {
      const { adminId, consultaId } = await users(client)
      const sponsorId = await createSponsor(client)

      await actAs(client, consultaId)
      const upd = await client.query(`update public.sponsors set name = 'Cambiado SA' where id = $1`, [sponsorId])
      expect(upd.rowCount).toBe(0)

      // Un admin (tiene ambos permisos) edita el nombre sin tocar el estado.
      await actAs(client, adminId)
      const ok = await client.query(`update public.sponsors set name = $2 where id = $1`, [sponsorId, `Renombrado ${randomUUID().slice(0, 6)}`])
      expect(ok.rowCount).toBe(1)
    })
  })
})

describe.skipIf(!dbAvailable)('cash_movements: matriz por rol e INSERT', () => {
  it('consulta no registra (RLS); editor y admin sí, y created_by = auth.uid()', async () => {
    await withRollback(async (client) => {
      const { consultaId, editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)

      await actAs(client, consultaId)
      const err = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 100, 'cash', $2)`, [
        conceptId,
        randomUUID(),
      ])
      expect(err.message).toMatch(/row-level security/i)

      for (const id of [editorId, adminId]) {
        await actAs(client, id)
        const movementId = await insertMovement(client, { conceptId })
        const row = await movementRow(client, movementId)
        expect(row.created_by).toBe(id)
        expect(row.direction).toBe('income')
      }
    })
  })

  it('anon no tiene ni SELECT ni INSERT sobre las tres tablas', async () => {
    await withRollback(async (client) => {
      for (const table of ['cash_movements', 'sponsors', 'cash_concepts']) {
        await actAsSuperuser(client)
        await client.query('set local role anon')
        const err = await expectQueryError(client, `select 1 from public.${table}`)
        expect(err.code, table).toBe('42501')
      }
    })
  })

  it('un rol viene solo de app_users: user_metadata.role = admin no habilita nada, ni leer ni escribir', async () => {
    await withRollback(async (client) => {
      const conceptId = await createConcept(client)
      const ghost = randomUUID()
      await actAs(client, ghost, { extraClaims: { user_metadata: { role: 'admin' }, app_metadata: { role: 'admin' } } })
      const err = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id, created_by) values ($1, 100, 'cash', $2, $3)`, [
        conceptId,
        randomUUID(),
        ghost,
      ])
      // created_by no tiene grant de INSERT: ya falla por ahí, y de todos modos RLS lo cortaría.
      expect(err.code).toBe('42501')
      const err2 = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 100, 'cash', $2)`, [
        conceptId,
        randomUUID(),
      ])
      expect(err2.message).toMatch(/row-level security/i)
    })
  })

  it('direction es siempre income: un egreso no entra (CHECK) y created_by no se puede mandar', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const expense = await expectQueryError(
        client,
        `insert into public.cash_movements (direction, concept_id, amount_cents, method, batch_id) values ('expense', $1, 100, 'cash', $2)`,
        [conceptId, randomUUID()],
      )
      expect(expense.code).toBe('23514')
    })
  })

  it('el monto es entero positivo: 0 y negativos se rechazan, 1 centavo entra (borde)', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      for (const amount of [0, -1, -1_000_000]) {
        const err = await expectQueryError(
          client,
          `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, $2, 'cash', $3)`,
          [conceptId, amount, randomUUID()],
        )
        expect(err.code, `monto ${amount}`).toBe('23514')
      }
      const id = await insertMovement(client, { conceptId, amountCents: 1 })
      expect((await movementRow(client, id)).amount_cents).toBe('1')
    })
  })

  it('medio inválido (ni efectivo ni transferencia): CHECK', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const err = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 100, 'cheque', $2)`, [
        conceptId,
        randomUUID(),
      ])
      expect(err.code).toBe('23514')
    })
  })

  it('batch_id único: reenviar el mismo lote es 23505 (el modelo lo traduce a "ya registrado") y no duplica la fila', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      const batchId = randomUUID()

      await actAs(client, editorId)
      await insertMovement(client, { conceptId, batchId, amountCents: 500_000 })
      const dup = await expectQueryError(
        client,
        `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 500000, 'cash', $2)`,
        [conceptId, batchId],
      )
      expect(dup.code).toBe('23505')
      expect(dup.message).toMatch(/cash_movements_batch_id_key/)

      const count = await client.query(`select count(*)::int as n from public.cash_movements where batch_id = $1`, [batchId])
      expect(count.rows[0].n).toBe(1)
    })
  })

  it('batch_id concurrente: dos conexiones con el mismo lote dejan UNA sola fila', async () => {
    // Fuera de withRollback: la carrera tiene que ocurrir entre transacciones
    // reales. Se limpia lo que sí se puede (fixtures de auth/concepto); la fila
    // de caja anulada queda como cualquier otra (nada se borra), con un
    // concepto de nombre aleatorio y desactivado.
    const { Client } = await import('pg')
    const url = process.env.LONQUI_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    const setup = new Client({ connectionString: url })
    await setup.connect()
    const userId = randomUUID()
    const batchId = randomUUID()
    try {
      await createUserWithRole(setup, 'editor', { userId })
      const concept = await setup.query<{ id: string }>(`insert into public.cash_concepts (name) values ($1) returning id`, [
        `Carrera ${randomUUID().slice(0, 8)}`,
      ])
      const conceptId = Number(concept.rows[0].id)

      const attempt = async () => {
        const c = new Client({ connectionString: url })
        await c.connect()
        try {
          await c.query('begin')
          await c.query(`set local role authenticated`)
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated' })])
          await c.query(`insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 100, 'cash', $2)`, [conceptId, batchId])
          await c.query('commit')
          return 'ok' as const
        } catch (err) {
          await c.query('rollback').catch(() => {})
          return (err as { code?: string }).code ?? 'error'
        } finally {
          await c.end()
        }
      }

      const results = await Promise.all([attempt(), attempt(), attempt()])
      expect(results.filter((r) => r === 'ok')).toHaveLength(1)
      expect(results.filter((r) => r === '23505')).toHaveLength(2)

      const count = await setup.query(`select count(*)::int as n from public.cash_movements where batch_id = $1`, [batchId])
      expect(count.rows[0].n).toBe(1)
    } finally {
      // El movimiento y el concepto quedan (append-only de hecho: sin grant de delete para la app).
      // Como postgres sí podemos limpiar los fixtures que no son historia.
      await setup.query(`delete from public.cash_movements where batch_id = $1`, [batchId]).catch(() => {})
      await setup.query(`delete from public.cash_concepts where name like 'Carrera %'`).catch(() => {})
      await setup.query(`delete from public.app_users where user_id = $1`, [userId]).catch(() => {})
      await setup.query(`delete from auth.users where id = $1`, [userId]).catch(() => {})
      await setup.end()
    }
  })

  it('fecha: hoy entra; mañana, antes de 2020 y el 31/12/2019 se rechazan; 1/1/2020 entra', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)

      const today = await client.query<{ d: string }>(`select private.club_today()::text as d`)
      const tomorrow = await client.query<{ d: string }>(`select (private.club_today() + 1)::text as d`)

      const okToday = await insertMovement(client, { conceptId, occurredOn: today.rows[0].d })
      expect(okToday).toBeGreaterThan(0)

      const future = await expectQueryError(
        client,
        `insert into public.cash_movements (concept_id, amount_cents, method, batch_id, occurred_on) values ($1, 100, 'cash', $2, $3)`,
        [conceptId, randomUUID(), tomorrow.rows[0].d],
      )
      expect(future.message).toBe('La fecha del ingreso no puede ser futura')

      const old = await expectQueryError(
        client,
        `insert into public.cash_movements (concept_id, amount_cents, method, batch_id, occurred_on) values ($1, 100, 'cash', $2, '2019-12-31')`,
        [conceptId, randomUUID()],
      )
      expect(old.message).toBe('La fecha del ingreso es demasiado vieja')

      const edge = await insertMovement(client, { conceptId, occurredOn: '2020-01-01' })
      expect(edge).toBeGreaterThan(0)
    })
  })

  it('concepto desactivado, inexistente, o que pide sponsor sin sponsor: rechazados con mensaje de dominio', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const inactive = await createConcept(client, { isActive: false })
      const needsSponsor = await createConcept(client, { requiresSponsor: true })
      const sponsorId = await createSponsor(client)
      await actAs(client, editorId)

      const e1 = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 100, 'cash', $2)`, [inactive, randomUUID()])
      expect(e1.message).toBe('El concepto está desactivado')

      const e2 = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values (999999999, 100, 'cash', $1)`, [randomUUID()])
      expect(e2.message).toBe('El concepto no existe')

      const e3 = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 100, 'cash', $2)`, [needsSponsor, randomUUID()])
      expect(e3.message).toBe('Elegí el sponsor')

      // Con sponsor, el mismo concepto entra.
      const ok = await insertMovement(client, { conceptId: needsSponsor, sponsorId })
      expect(ok).toBeGreaterThan(0)
    })
  })

  it('sponsor desactivado o inexistente: rechazado, aunque el concepto no lo pida', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      const inactiveSponsor = await createSponsor(client, { active: false })
      await actAs(client, editorId)

      const e1 = await expectQueryError(client, `insert into public.cash_movements (concept_id, sponsor_id, amount_cents, method, batch_id) values ($1, $2, 100, 'cash', $3)`, [
        conceptId,
        inactiveSponsor,
        randomUUID(),
      ])
      expect(e1.message).toBe('El sponsor está desactivado')

      const e2 = await expectQueryError(client, `insert into public.cash_movements (concept_id, sponsor_id, amount_cents, method, batch_id) values ($1, 999999999, 100, 'cash', $2)`, [
        conceptId,
        randomUUID(),
      ])
      expect(e2.message).toBe('El sponsor no existe')
    })
  })

  it('un sponsor o concepto que se desactiva DESPUÉS no rompe los movimientos viejos (siguen visibles y cuentan)', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      const sponsorId = await createSponsor(client)

      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId, sponsorId, amountCents: 700_000 })

      await actAs(client, adminId)
      await client.query(`update public.sponsors set is_active = false, deactivation_reason = 'Dejó de aportar' where id = $1`, [sponsorId])
      await client.query(`update public.cash_concepts set is_active = false where id = $1`, [conceptId])

      const row = await client.query(`select id, voided_at from public.cash_movements where id = $1`, [id])
      expect(row.rowCount).toBe(1)
      expect(row.rows[0].voided_at).toBeNull()
    })
  })

  it('el comprobante solo puede apuntar a cash-receipts/ (no a payment-receipts ni a una URL)', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)

      for (const bad of ['payment-receipts/1/a.pdf', 'https://x.test/a.pdf', '../cash-receipts/a.pdf']) {
        const err = await expectQueryError(
          client,
          `insert into public.cash_movements (concept_id, amount_cents, method, batch_id, receipt_storage_path) values ($1, 100, 'transfer', $2, $3)`,
          [conceptId, randomUUID(), bad],
        )
        expect(err.code, bad).toBe('23514')
      }
      const ok = await insertMovement(client, { conceptId, method: 'transfer', receiptPath: `cash-receipts/${randomUUID()}/${randomUUID()}.pdf` })
      expect(ok).toBeGreaterThan(0)
    })
  })

  it('descripción: hasta 500 caracteres entran, 501 no', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      expect(await insertMovement(client, { conceptId, description: 'x'.repeat(500) })).toBeGreaterThan(0)
      const err = await expectQueryError(
        client,
        `insert into public.cash_movements (concept_id, amount_cents, method, batch_id, description) values ($1, 100, 'cash', $2, $3)`,
        [conceptId, randomUUID(), 'x'.repeat(501)],
      )
      expect(err.code).toBe('23514')
    })
  })
})

describe.skipIf(!dbAvailable)('cash_movements: inmutabilidad y nada se borra', () => {
  const immutable: Array<{ col: string; value: string }> = [
    { col: 'amount_cents', value: '1' },
    { col: 'occurred_on', value: `'2021-05-05'` },
    { col: 'method', value: `'transfer'` },
    { col: 'description', value: `'editado'` },
    { col: 'batch_id', value: `'${randomUUID()}'` },
    { col: 'created_at', value: `now() - interval '1 day'` },
    { col: 'direction', value: `'income'` },
  ]

  it('monto, fecha, medio, detalle, lote y creación: sin grant de UPDATE para editor ni admin', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId, amountCents: 900_000 })

      for (const who of [editorId, adminId]) {
        await actAs(client, who)
        for (const { col, value } of immutable) {
          const err = await expectQueryError(client, `update public.cash_movements set ${col} = ${value} where id = $1`, [id])
          expect(err.code, `${col} como ${who === adminId ? 'admin' : 'editor'}`).toBe('42501')
        }
      }
      expect((await movementRow(client, id)).amount_cents).toBe('900000')
    })
  })

  it('tampoco como postgres (dueño): el trigger de inmutables corta concepto, sponsor, monto, fecha, medio, detalle, lote y autor', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      const otherConcept = await createConcept(client)
      const sponsorId = await createSponsor(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId, sponsorId, amountCents: 900_000, description: 'original' })
      await actAsSuperuser(client)

      const changes: Array<[string, string, unknown[]]> = [
        ['concept_id', `$2`, [otherConcept]],
        ['sponsor_id', `null`, []],
        ['amount_cents', `1`, []],
        ['occurred_on', `'2021-05-05'`, []],
        ['method', `'transfer'`, []],
        ['description', `'editado'`, []],
        ['batch_id', `'${randomUUID()}'`, []],
        ['created_by', `'${randomUUID()}'`, []],
        ['created_at', `now() - interval '1 day'`, []],
      ]
      for (const [col, expr, extra] of changes) {
        const err = await expectQueryError(client, `update public.cash_movements set ${col} = ${expr} where id = $1`, [id, ...extra])
        expect(err.message, col).toMatch(new RegExp(`La columna ${col} no se puede modificar`))
      }
      const row = await movementRow(client, id)
      expect(row.amount_cents).toBe('900000')
      expect(row.description).toBe('original')
    })
  })

  it('ni authenticated ni service_role ni anon tienen DELETE (ni UPDATE/INSERT service_role) sobre las tres tablas', async () => {
    await withRollback(async (client) => {
      for (const table of ['cash_movements', 'sponsors', 'cash_concepts']) {
        for (const role of ['authenticated', 'service_role', 'anon']) {
          expect(await hasGrant(client, role, table, 'DELETE'), `${role} DELETE ${table}`).toBe(false)
        }
        for (const priv of ['INSERT', 'UPDATE']) {
          expect(await hasGrant(client, 'service_role', table, priv), `service_role ${priv} ${table}`).toBe(false)
          expect(await hasGrant(client, 'anon', table, priv), `anon ${priv} ${table}`).toBe(false)
        }
      }
    })
  })

  it('un DELETE directo como admin falla con permission denied y la fila queda', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, adminId)
      const id = await insertMovement(client, { conceptId })
      for (const table of ['cash_movements']) {
        const err = await expectQueryError(client, `delete from public.${table} where id = $1`, [id])
        expect(err.code).toBe('42501')
      }
      const err = await expectQueryError(client, `delete from public.sponsors where id = 1`)
      expect(err.code).toBe('42501')
      const err2 = await expectQueryError(client, `delete from public.cash_concepts where id = $1`, [conceptId])
      expect(err2.code).toBe('42501')
      expect(await movementRow(client, id)).toBeTruthy()
    })
  })

  it('las FK son on delete restrict: ni postgres borra un concepto o sponsor con movimientos', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      const sponsorId = await createSponsor(client)
      await actAs(client, editorId)
      await insertMovement(client, { conceptId, sponsorId })
      await actAsSuperuser(client)
      const c = await expectQueryError(client, `delete from public.cash_concepts where id = $1`, [conceptId])
      expect(c.code).toBe('23503')
      const s = await expectQueryError(client, `delete from public.sponsors where id = $1`, [sponsorId])
      expect(s.code).toBe('23503')
    })
  })
})

describe.skipIf(!dbAvailable)('cash_movements: anulación y comprobante (guard de UPDATE)', () => {
  async function seeded(client: ClientBase) {
    const ctx = await users(client)
    const conceptId = await createConcept(client)
    await actAs(client, ctx.editorId)
    const id = await insertMovement(client, { conceptId, amountCents: 2_000_000, method: 'transfer' })
    return { ...ctx, conceptId, id }
  }

  it('editor y consulta NO anulan: editor recibe 42501 del guard, consulta 0 filas por RLS', async () => {
    await withRollback(async (client) => {
      const { id, editorId, consultaId } = await seeded(client)

      await actAs(client, editorId)
      const err = await expectQueryError(client, `update public.cash_movements set voided_at = now(), void_reason = 'Cargado dos veces' where id = $1`, [id])
      expect(err.code).toBe('42501')

      await actAs(client, consultaId)
      const upd = await client.query(`update public.cash_movements set void_reason = 'Cargado dos veces', voided_at = now() where id = $1`, [id])
      expect(upd.rowCount).toBe(0)

      expect((await movementRow(client, id)).voided_at).toBeNull()
    })
  })

  it('admin anula con motivo: el guard fija voided_by = auth.uid() y voided_at = now(), pisando lo que mande el cliente', async () => {
    await withRollback(async (client) => {
      const { id, adminId } = await seeded(client)
      await actAs(client, adminId)
      await client.query(
        `update public.cash_movements set voided_at = '2000-01-01', voided_by = $2, void_reason = 'Cargado dos veces' where id = $1`,
        [id, randomUUID()],
      )
      const row = await movementRow(client, id)
      expect(row.voided_by).toBe(adminId)
      expect(row.voided_at.getFullYear()).toBeGreaterThanOrEqual(2026)
      expect(row.void_reason).toBe('Cargado dos veces')
      // El monto sigue intacto: se anula, no se edita.
      expect(row.amount_cents).toBe('2000000')
    })
  })

  it('motivo ausente, vacío o de menos de 3 caracteres: se rechaza; con 3 exactos entra (borde)', async () => {
    await withRollback(async (client) => {
      const { id, adminId } = await seeded(client)
      await actAs(client, adminId)
      for (const reason of [null, '', '   ', 'ab', ' ab ']) {
        const err = await expectQueryError(client, `update public.cash_movements set voided_at = now(), void_reason = $2 where id = $1`, [id, reason])
        expect(err.code, `motivo ${JSON.stringify(reason)}`).toBe('23514')
      }
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'abc' where id = $1`, [id])
      expect((await movementRow(client, id)).void_reason).toBe('abc')
    })
  })

  it('anular dos veces falla, y el motivo original no se pisa', async () => {
    await withRollback(async (client) => {
      const { id, adminId } = await seeded(client)
      await actAs(client, adminId)
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Primer motivo' where id = $1`, [id])
      const err = await expectQueryError(client, `update public.cash_movements set voided_at = now(), void_reason = 'Segundo motivo' where id = $1`, [id])
      expect(err.message).toBe('Este ingreso ya está anulado')
      expect((await movementRow(client, id)).void_reason).toBe('Primer motivo')
    })
  })

  it('no se puede "desanular": poner voided_* en null falla', async () => {
    await withRollback(async (client) => {
      const { id, adminId } = await seeded(client)
      await actAs(client, adminId)
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Error de carga' where id = $1`, [id])
      const err = await expectQueryError(client, `update public.cash_movements set voided_at = null, voided_by = null, void_reason = null where id = $1`, [id])
      expect(err.message).toBe('Este ingreso ya está anulado')
      expect((await movementRow(client, id)).voided_at).not.toBeNull()
    })
  })

  it('un movimiento anulado sigue existiendo y legible para todos los roles', async () => {
    await withRollback(async (client) => {
      const { id, adminId, consultaId } = await seeded(client)
      await actAs(client, adminId)
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Error de carga' where id = $1`, [id])
      await actAs(client, consultaId)
      const r = await client.query(`select void_reason from public.cash_movements where id = $1`, [id])
      expect(r.rowCount).toBe(1)
      expect(r.rows[0].void_reason).toBe('Error de carga')
    })
  })

  it('comprobante: editor lo adjunta una vez (null a valor); reemplazarlo o quitarlo falla', async () => {
    await withRollback(async (client) => {
      const { id, editorId } = await seeded(client)
      const path = `cash-receipts/${randomUUID()}/${randomUUID()}.pdf`
      await actAs(client, editorId)
      await client.query(`update public.cash_movements set receipt_storage_path = $2, receipt_filename = 'comprobante.pdf' where id = $1`, [id, path])
      expect((await movementRow(client, id)).receipt_storage_path).toBe(path)

      await actAs(client, editorId)
      const replace = await expectQueryError(client, `update public.cash_movements set receipt_storage_path = $2 where id = $1`, [id, `cash-receipts/${randomUUID()}/otro.pdf`])
      expect(replace.message).toBe('El comprobante ya está cargado y no se reemplaza')
      const remove = await expectQueryError(client, `update public.cash_movements set receipt_storage_path = null where id = $1`, [id])
      expect(remove.message).toBe('El comprobante ya está cargado y no se reemplaza')
    })
  })

  it('comprobante: consulta no adjunta (0 filas), prefijo ajeno rechazado, anulado no lleva comprobante', async () => {
    await withRollback(async (client) => {
      const { id, editorId, consultaId, adminId } = await seeded(client)

      await actAs(client, consultaId)
      const upd = await client.query(`update public.cash_movements set receipt_storage_path = $2 where id = $1`, [id, `cash-receipts/${randomUUID()}/a.pdf`])
      expect(upd.rowCount).toBe(0)

      await actAs(client, editorId)
      const bad = await expectQueryError(client, `update public.cash_movements set receipt_storage_path = 'payment-receipts/1/a.pdf' where id = $1`, [id])
      expect(bad.code).toBe('23514')

      // Anular y adjuntar en el mismo UPDATE (admin): el guard lo rechaza.
      await actAs(client, adminId)
      const both = await expectQueryError(
        client,
        `update public.cash_movements set voided_at = now(), void_reason = 'Error de carga', receipt_storage_path = $2 where id = $1`,
        [id, `cash-receipts/${randomUUID()}/a.pdf`],
      )
      expect(both.message).toBe('Un ingreso anulado no lleva comprobante')

      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Error de carga' where id = $1`, [id])
      await actAs(client, editorId)
      const afterVoid = await expectQueryError(client, `update public.cash_movements set receipt_storage_path = $2 where id = $1`, [id, `cash-receipts/${randomUUID()}/b.pdf`])
      expect(afterVoid.message).toBe('Un ingreso anulado no lleva comprobante')
    })
  })

  it('la triada de anulación incoherente (motivo sin fecha) no entra ni como postgres', async () => {
    await withRollback(async (client) => {
      const { id } = await seeded(client)
      await actAsSuperuser(client)
      // Como postgres el guard igual corre y completa voided_by/at; lo que NO puede es dejar motivo corto.
      const err = await expectQueryError(client, `update public.cash_movements set voided_at = now(), void_reason = 'x' where id = $1`, [id])
      expect(err.code).toBe('23514')
    })
  })
})

describe.skipIf(!dbAvailable)('auditoría de la caja: actor y changed_fields', () => {
  it('el alta de un ingreso deja una fila INSERT con el actor de la sesión y el monto en new_data', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId, amountCents: 1_234_500 })

      await actAsSuperuser(client)
      const audit = await client.query(
        `select actor_id, actor_source, op, new_data from public.audit_log where table_name = 'cash_movements' and record_id = $1`,
        [String(id)],
      )
      expect(audit.rowCount).toBe(1)
      expect(audit.rows[0].actor_id).toBe(editorId)
      expect(audit.rows[0].actor_source).toBe('session')
      expect(audit.rows[0].op).toBe('INSERT')
      expect(audit.rows[0].new_data.amount_cents).toBe(1_234_500)
    })
  })

  it('la anulación deja UPDATE con el actor admin y changed_fields con los campos de anulación (y NO el monto)', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId })
      await actAs(client, adminId)
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Cargado dos veces' where id = $1`, [id])

      await actAsSuperuser(client)
      const audit = await client.query(
        `select actor_id, op, changed_fields, old_data, new_data from public.audit_log where table_name = 'cash_movements' and record_id = $1 and op = 'UPDATE'`,
        [String(id)],
      )
      expect(audit.rowCount).toBe(1)
      expect(audit.rows[0].actor_id).toBe(adminId)
      expect([...audit.rows[0].changed_fields].sort()).toEqual(['void_reason', 'voided_at', 'voided_by'])
      expect(audit.rows[0].old_data.void_reason).toBeNull()
      expect(audit.rows[0].new_data.void_reason).toBe('Cargado dos veces')
    })
  })

  it('adjuntar comprobante audita solo los campos del comprobante', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId, method: 'transfer' })
      await client.query(`update public.cash_movements set receipt_storage_path = $2, receipt_filename = 'a.pdf' where id = $1`, [id, `cash-receipts/${randomUUID()}/a.pdf`])
      await actAsSuperuser(client)
      const audit = await client.query(`select actor_id, changed_fields from public.audit_log where table_name = 'cash_movements' and record_id = $1 and op = 'UPDATE'`, [String(id)])
      expect(audit.rows[0].actor_id).toBe(editorId)
      expect([...audit.rows[0].changed_fields].sort()).toEqual(['receipt_filename', 'receipt_storage_path'])
    })
  })

  it('sponsors: alta con actor, edición con changed_fields del campo tocado, y desactivación con el motivo en new_data', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      await actAs(client, editorId)
      const created = await client.query<{ id: string }>(`insert into public.sponsors (name) values ($1) returning id`, [`Sponsor ${randomUUID().slice(0, 8)}`])
      const id = created.rows[0].id
      await client.query(`update public.sponsors set notes = 'Aporta en abril' where id = $1`, [id])
      await actAs(client, adminId)
      await client.query(`update public.sponsors set is_active = false, deactivation_reason = 'Cerró el local' where id = $1`, [id])

      await actAsSuperuser(client)
      const audit = await client.query(
        `select actor_id, op, changed_fields, new_data from public.audit_log where table_name = 'sponsors' and record_id = $1 order by id`,
        [id],
      )
      expect(audit.rows.map((r) => r.op)).toEqual(['INSERT', 'UPDATE', 'UPDATE'])
      expect(audit.rows[0].actor_id).toBe(editorId)
      expect(audit.rows[1].actor_id).toBe(editorId)
      expect(audit.rows[1].changed_fields).toContain('notes')
      expect(audit.rows[1].changed_fields).not.toContain('is_active')
      expect(audit.rows[2].actor_id).toBe(adminId)
      expect(audit.rows[2].changed_fields).toEqual(expect.arrayContaining(['is_active', 'deactivation_reason', 'deactivated_at', 'deactivated_by']))
      expect(audit.rows[2].new_data.deactivation_reason).toBe('Cerró el local')
    })
  })

  it('conceptos: alta y desactivación auditadas con el actor admin', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      await actAs(client, adminId)
      const created = await client.query<{ id: string }>(`insert into public.cash_concepts (name) values ($1) returning id`, [`Concepto ${randomUUID().slice(0, 8)}`])
      const id = created.rows[0].id
      await client.query(`update public.cash_concepts set is_active = false where id = $1`, [id])

      await actAsSuperuser(client)
      const audit = await client.query(`select actor_id, op, changed_fields from public.audit_log where table_name = 'cash_concepts' and record_id = $1 order by id`, [id])
      expect(audit.rows.map((r) => r.op)).toEqual(['INSERT', 'UPDATE'])
      expect(audit.rows.every((r) => r.actor_id === adminId)).toBe(true)
      expect(audit.rows[1].changed_fields).toContain('is_active')
    })
  })
})

describe.skipIf(!dbAvailable)('cash_month_summary', () => {
  // Un mes del pasado (>= 2020, no futuro): los datos del seed viven en el
  // mes actual y el anterior, así que se mide como DELTA igual.
  const PERIOD = '2025-03-01'

  async function summary(client: ClientBase, period: string | null = PERIOD) {
    const r = await client.query(`select * from public.cash_month_summary($1::date)`, [period])
    return r.rows[0]
  }

  it('suma efectivo y transferencia, excluye anulados y agrupa por concepto', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const donation = await createConcept(client)
      const sale = await createConcept(client)

      await actAs(client, adminId)
      const before = await summary(client)

      await actAs(client, editorId)
      await insertMovement(client, { conceptId: donation, amountCents: 1_000_000, method: 'cash', occurredOn: '2025-03-10' })
      await insertMovement(client, { conceptId: donation, amountCents: 250_050, method: 'transfer', occurredOn: '2025-03-11' })
      await insertMovement(client, { conceptId: sale, amountCents: 3_000_000, method: 'cash', occurredOn: '2025-03-12' })
      const voided = await insertMovement(client, { conceptId: sale, amountCents: 9_999_900, method: 'transfer', occurredOn: '2025-03-13' })

      await actAs(client, adminId)
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Error de carga' where id = $1`, [voided])
      const after = await summary(client)

      const delta = (k: string) => Number(after[k]) - Number(before[k])
      expect(delta('other_income_cents')).toBe(4_250_050)
      expect(delta('other_income_count')).toBe(3)
      expect(delta('cash_cents')).toBe(4_000_000)
      expect(delta('transfer_cents')).toBe(250_050)
      expect(delta('total_cents')).toBe(4_250_050)
      // Las cuotas no se mueven por registrar otros ingresos.
      expect(after.fees_collected_cents).toBe(before.fees_collected_cents)

      const byConcept = new Map<string, { amount_cents: number; count: number; concept_name: string }>(
        (after.by_concept as Array<{ concept_id: number; concept_name: string; amount_cents: number; count: number }>).map((c) => [String(c.concept_id), c]),
      )
      expect(byConcept.get(String(donation))).toMatchObject({ amount_cents: 1_250_050, count: 2 })
      expect(byConcept.get(String(sale))).toMatchObject({ amount_cents: 3_000_000, count: 1 })
    })
  })

  it('fees_collected_cents y el desglose de cuotas son EXACTAMENTE los de month_collection (una sola definición de "cobrado")', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      await actAs(client, adminId)
      for (const period of [PERIOD, null, '2026-09-01']) {
        const s = await summary(client, period)
        const mc = (await client.query(`select * from public.month_collection($1::date)`, [period])).rows[0]
        expect(s.fees_collected_cents).toBe(mc.collected_cents)
        expect(s.fees_cents).toBe(mc.fees_cents)
        expect(s.fees_count).toBe(mc.fees_count)
        expect(s.payments_count).toBe(mc.payments_count)
        expect(s.period.toISOString()).toBe(mc.period.toISOString())
        expect(Number(s.total_cents)).toBe(Number(mc.collected_cents) + Number(s.other_income_cents))
        expect(Number(s.cash_cents) + Number(s.transfer_cents)).toBe(Number(s.total_cents))
      }
    })
  })

  it('mes sin movimientos: otros ingresos en cero y by_concept es [] (no null)', async () => {
    await withRollback(async (client) => {
      const { consultaId } = await users(client)
      await actAs(client, consultaId)
      const s = await summary(client, '2021-01-01')
      expect(Number(s.other_income_cents)).toBe(0)
      expect(s.other_income_count).toBe(0)
      expect(s.by_concept).toEqual([])
    })
  })

  it('borde de mes: el último día entra en su mes y el día 1 en el siguiente; target_period a mitad de mes se normaliza', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, adminId)
      const marBefore = await summary(client, '2025-03-01')
      const aprBefore = await summary(client, '2025-04-01')

      await actAs(client, editorId)
      await insertMovement(client, { conceptId, amountCents: 100_000, occurredOn: '2025-03-31' })
      await insertMovement(client, { conceptId, amountCents: 700_000, occurredOn: '2025-04-01' })

      await actAs(client, adminId)
      const mar = await summary(client, '2025-03-17')
      const apr = await summary(client, '2025-04-01')
      expect(Number(mar.other_income_cents) - Number(marBefore.other_income_cents)).toBe(100_000)
      expect(Number(apr.other_income_cents) - Number(aprBefore.other_income_cents)).toBe(700_000)
      expect(mar.period.toISOString().slice(0, 10)).toBe('2025-03-01')
    })
  })

  it('un ingreso anulado después deja de contar; el movimiento sigue existiendo', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId, amountCents: 5_000_000, occurredOn: '2025-03-20' })
      await actAs(client, adminId)
      const withIt = await summary(client)
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Error de carga' where id = $1`, [id])
      const without = await summary(client)
      expect(Number(withIt.other_income_cents) - Number(without.other_income_cents)).toBe(5_000_000)
      expect(Number(withIt.other_income_count) - Number(without.other_income_count)).toBe(1)
      expect((await movementRow(client, id)).id).toBe(String(id))
    })
  })

  it('los montos devueltos son centavos enteros (bigint), sin decimales', async () => {
    await withRollback(async (client) => {
      const { adminId } = await users(client)
      await actAs(client, adminId)
      const s = await summary(client, null)
      for (const k of ['total_cents', 'fees_collected_cents', 'other_income_cents', 'cash_cents', 'transfer_cents']) {
        expect(String(s[k]), k).toMatch(/^-?\d+$/)
      }
    })
  })

  it('permisos: anon no ejecuta la RPC', async () => {
    await withRollback(async (client) => {
      await client.query('set local role anon')
      const err = await expectQueryError(client, `select * from public.cash_month_summary(null)`)
      expect(err.code).toBe('42501')
    })
  })

  it('un usuario sin rol (user_metadata.role = admin) no puede leer el resumen', async () => {
    await withRollback(async (client) => {
      await actAs(client, randomUUID(), { extraClaims: { user_metadata: { role: 'admin' } } })
      const err = await expectQueryError(client, `select * from public.cash_month_summary(null)`)
      expect(err.code).toBe('42501')
    })
  })
})

describe.skipIf(!dbAvailable)('sponsor_summaries', () => {
  async function summaries(client: ClientBase, year: number | null, sponsorId: number | null) {
    const r = await client.query(
      `select sponsor_id::text, name, is_active, year_total_cents::text, all_time_total_cents::text, contributions_count, last_contribution_on::text, last_contribution_cents::text
       from public.sponsor_summaries($1::int, $2::bigint)`,
      [year, sponsorId],
    )
    return r.rows
  }

  it('borde de año: el aporte del 31/12 cuenta para el año que cierra y el del 1/1 para el que abre', async () => {
    await withRollback(async (client) => {
      const { editorId, consultaId } = await users(client)
      const conceptId = await createConcept(client)
      const sponsorId = await createSponsor(client)
      await actAs(client, editorId)
      await insertMovement(client, { conceptId, sponsorId, amountCents: 1_000_000, occurredOn: '2025-12-31' })
      await insertMovement(client, { conceptId, sponsorId, amountCents: 2_000_000, occurredOn: '2026-01-01' })

      await actAs(client, consultaId)
      const y2025 = await summaries(client, 2025, sponsorId)
      const y2026 = await summaries(client, 2026, sponsorId)
      expect(y2025).toHaveLength(1)
      expect(y2025[0].year_total_cents).toBe('1000000')
      expect(y2026[0].year_total_cents).toBe('2000000')
      expect(y2025[0].all_time_total_cents).toBe('3000000')
      expect(y2025[0].contributions_count).toBe(2)
      expect(y2025[0].last_contribution_on).toBe('2026-01-01')
      expect(y2025[0].last_contribution_cents).toBe('2000000')
    })
  })

  it('un aporte anulado no cuenta ni como total, ni como cantidad, ni como último aporte', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      const sponsorId = await createSponsor(client)
      await actAs(client, editorId)
      await insertMovement(client, { conceptId, sponsorId, amountCents: 1_000_000, occurredOn: '2025-06-01' })
      const voided = await insertMovement(client, { conceptId, sponsorId, amountCents: 8_000_000, occurredOn: '2025-07-01' })
      await actAs(client, adminId)
      await client.query(`update public.cash_movements set voided_at = now(), void_reason = 'Error de carga' where id = $1`, [voided])

      const [row] = await summaries(client, 2025, sponsorId)
      expect(row.year_total_cents).toBe('1000000')
      expect(row.all_time_total_cents).toBe('1000000')
      expect(row.contributions_count).toBe(1)
      expect(row.last_contribution_on).toBe('2025-06-01')
      expect(row.last_contribution_cents).toBe('1000000')
    })
  })

  it('sponsor sin aportes: ceros y sin último aporte (no desaparece del listado)', async () => {
    await withRollback(async (client) => {
      const { consultaId } = await users(client)
      const sponsorId = await createSponsor(client)
      await actAs(client, consultaId)
      const [row] = await summaries(client, null, sponsorId)
      expect(row).toMatchObject({ year_total_cents: '0', all_time_total_cents: '0', contributions_count: 0, last_contribution_on: null, last_contribution_cents: null })
    })
  })

  it('un solo id devuelve una sola fila; un id inexistente, ninguna; el listado trae activos antes que desactivados', async () => {
    await withRollback(async (client) => {
      const { consultaId } = await users(client)
      const active = await createSponsor(client, { name: `ZZ Activo ${randomUUID().slice(0, 6)}` })
      const inactive = await createSponsor(client, { name: `AA Inactivo ${randomUUID().slice(0, 6)}`, active: false })
      await actAs(client, consultaId)

      expect(await summaries(client, null, active)).toHaveLength(1)
      expect(await summaries(client, null, 999_999_999)).toHaveLength(0)

      const all = await summaries(client, null, null)
      const ids = all.map((r) => r.sponsor_id)
      expect(ids.indexOf(String(active))).toBeLessThan(ids.indexOf(String(inactive)))
      // Ningún sponsor activo aparece después de uno desactivado.
      const firstInactive = all.findIndex((r) => !r.is_active)
      if (firstInactive >= 0) expect(all.slice(firstInactive).every((r) => !r.is_active)).toBe(true)
    })
  })

  it('anon no ejecuta; un usuario sin rol tampoco', async () => {
    await withRollback(async (client) => {
      await client.query('set local role anon')
      const err = await expectQueryError(client, `select * from public.sponsor_summaries()`)
      expect(err.code).toBe('42501')
      await actAsSuperuser(client)
      await actAs(client, randomUUID())
      const err2 = await expectQueryError(client, `select * from public.sponsor_summaries()`)
      expect(err2.code).toBe('42501')
    })
  })
})

/**
 * Contrato entre el schema y la traducción de errores de los modelos
 * (`cash-movements.model`, `sponsors.model`, `cash-concepts.model`): los
 * modelos reconocen la violación por el NOMBRE del constraint/índice y por el
 * mensaje que redacta la migración. Si alguien renombra un índice o cambia un
 * texto, el usuario vería un error interno en vez del mensaje de dominio:
 * estos tests lo atrapan en la base real, que es donde nace el texto.
 */
describe.skipIf(!dbAvailable)('caja: nombres de constraint que los modelos traducen', () => {
  it('los nombres reales coinciden con los que busca el modelo (monto, comprobante, tríadas, batch, nombres únicos)', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      const sponsorId = await createSponsor(client)
      const fixedName = `Nombre ${randomUUID().slice(0, 6)}`
      await createConcept(client, { name: fixedName })
      await createSponsor(client, { name: fixedName })
      const batchId = randomUUID()

      await actAs(client, editorId)
      await insertMovement(client, { conceptId, batchId })
      const batch = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 1, 'cash', $2)`, [conceptId, batchId])
      expect(batch.code).toBe('23505')
      expect(batch.message).toContain('cash_movements_batch_id_key')

      const amount = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id) values ($1, 0, 'cash', $2)`, [conceptId, randomUUID()])
      expect(amount.message).toContain('cash_movements_amount_cents_check')

      const receipt = await expectQueryError(client, `insert into public.cash_movements (concept_id, amount_cents, method, batch_id, receipt_storage_path) values ($1, 1, 'cash', $2, 'x/y.pdf')`, [conceptId, randomUUID()])
      expect(receipt.message).toContain('cash_movements_receipt_storage_path_check')

      const sponsorDup = await expectQueryError(client, `insert into public.sponsors (name) values ($1)`, [fixedName])
      expect(sponsorDup.message).toContain('sponsors_name_key')

      await actAs(client, adminId)
      const conceptDup = await expectQueryError(client, `insert into public.cash_concepts (name) values ($1)`, [fixedName])
      expect(conceptDup.code).toBe('23505')
      const conceptShort = await expectQueryError(client, `insert into public.cash_concepts (name) values ('a')`)
      expect(conceptShort.message).toContain('cash_concepts_name_check')

      // Motivo corto al desactivar: lo corta el guard con su texto (el modelo lo mapea a field reason).
      const sponsorReason = await expectQueryError(client, `update public.sponsors set is_active = false, deactivation_reason = null where id = $1`, [sponsorId])
      expect(sponsorReason.message).toBe('Para desactivar un sponsor hace falta un motivo')
      const sponsorShort = await expectQueryError(client, `update public.sponsors set is_active = false, deactivation_reason = 'ab' where id = $1`, [sponsorId])
      expect(sponsorShort.message).toBe('Para desactivar un sponsor hace falta un motivo')
    })
  })

  it('el UPDATE que hace el modelo para anular (solo void_reason) completa voided_at/voided_by en el guard', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId })

      await actAs(client, adminId)
      await client.query(`update public.cash_movements set void_reason = 'Cargado dos veces' where id = $1`, [id])
      const row = await movementRow(client, id)
      expect(row.voided_by).toBe(adminId)
      expect(row.voided_at).toBeInstanceOf(Date)
    })
  })

  it('motivo corto en el UPDATE de solo void_reason: el guard rechaza con su mensaje', async () => {
    await withRollback(async (client) => {
      const { editorId, adminId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId })
      await actAs(client, adminId)
      const err = await expectQueryError(client, `update public.cash_movements set void_reason = 'ab' where id = $1`, [id])
      expect(err.message).toBe('Para anular un ingreso hace falta un motivo')
    })
  })

  it('editor con el UPDATE del modelo (solo void_reason): 42501 que el modelo traduce a PermissionError', async () => {
    await withRollback(async (client) => {
      const { editorId } = await users(client)
      const conceptId = await createConcept(client)
      await actAs(client, editorId)
      const id = await insertMovement(client, { conceptId })
      const err = await expectQueryError(client, `update public.cash_movements set void_reason = 'Cargado dos veces' where id = $1`, [id])
      expect(err.code).toBe('42501')
    })
  })
})
