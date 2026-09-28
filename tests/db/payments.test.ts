import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { actAs, actAsSuperuser, createMember, createUserWithRole, expectQueryError, hasGrant, isDbAvailable, withRollback } from './helpers'

/**
 * S2 (`01-tasks.md`, `20260927130100_payments.sql`): pagos, idempotencia del
 * lote (`batch_id`), inmutabilidad, anulación y comprobante.
 */
const dbAvailable = await isDbAvailable()

describe.skipIf(!dbAvailable)('payments: quién puede cargar', () => {
  it('consulta no inserta', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Uno', lastName: 'Consulta', joinedOn: '2026-01-01' })
      const { userId } = await createUserWithRole(client, 'consulta')
      await actAs(client, userId)

      const err = await expectQueryError(
        client,
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'cash', $2)`,
        [memberId, randomUUID()],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })

  it('editor inserta con created_by propio; con created_by ajeno explícito la policy lo rechaza', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Dos', lastName: 'Editor', joinedOn: '2026-01-01' })
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)

      const ok = await client.query(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'cash', $2) returning created_by`,
        [memberId, randomUUID()],
      )
      expect(ok.rows[0].created_by).toBe(editorId)

      await actAsSuperuser(client)
      const { userId: otherId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const err = await expectQueryError(
        client,
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id, created_by) values ($1, 1000000, current_date, 'cash', $2, $3)`,
        [memberId, randomUUID(), otherId],
      )
      expect(err.message).toMatch(/row-level security|permission denied/i)
    })
  })
})

describe.skipIf(!dbAvailable)('payments: lote atómico e idempotente (batch_id)', () => {
  it('INSERT de tres filas con el mismo batch_id es atómico: si una falla, ninguna queda', async () => {
    await withRollback(async (client) => {
      const memberA = await createMember(client, { firstName: 'A', lastName: 'Lote', joinedOn: '2026-01-01' })
      const memberB = await createMember(client, { firstName: 'B', lastName: 'Lote', joinedOn: '2026-01-01' })
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const batchId = randomUUID()

      const before = Number((await client.query(`select count(*)::int as n from public.payments`)).rows[0].n)
      // La tercera fila tiene amount_cents <= 0: viola el CHECK y aborta TODA
      // la sentencia (un solo INSERT con N filas es una sola transacción).
      const err = await expectQueryError(
        client,
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values
         ($1, 1000000, current_date, 'cash', $3),
         ($2, 1000000, current_date, 'cash', $3),
         ($1, 0, current_date, 'cash', $3)`,
        [memberA, memberB, batchId],
      )
      expect(err.code).toBe('23514')
      const after = Number((await client.query(`select count(*)::int as n from public.payments`)).rows[0].n)
      expect(after).toBe(before)
    })
  })

  it('segunda inserción con el mismo (batch_id, member_id): unique violation', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Doble', lastName: 'Toque', joinedOn: '2026-01-01' })
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const batchId = randomUUID()

      await client.query(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'cash', $2)`,
        [memberId, batchId],
      )
      const err = await expectQueryError(
        client,
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'cash', $2)`,
        [memberId, batchId],
      )
      expect(err.code).toBe('23505')
    })
  })

  it('no existe un índice suelto payments_batch_id_idx (solo el compuesto batch_id+member_id)', async () => {
    await withRollback(async (client) => {
      const idx = await client.query(`select indexname from pg_indexes where tablename = 'payments' and indexname = 'payments_batch_id_idx'`)
      expect(idx.rowCount).toBe(0)
      const compound = await client.query(`select indexname from pg_indexes where tablename = 'payments' and indexname = 'payments_batch_member_key'`)
      expect(compound.rowCount).toBe(1)
    })
  })
})

describe.skipIf(!dbAvailable)('payments: fecha, inmutabilidad', () => {
  it('paid_on de mañana (zona club): rechazado', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Futuro', lastName: 'Pago', joinedOn: '2026-01-01' })
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const err = await expectQueryError(
        client,
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, private.club_today() + 1, 'cash', $2)`,
        [memberId, randomUUID()],
      )
      expect(err.message).toBe('La fecha del pago no puede ser futura')
    })
  })

  it('paid_on anterior a 2020-01-01: rechazado', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Viejo', lastName: 'Pago', joinedOn: '2026-01-01' })
      const { userId } = await createUserWithRole(client, 'editor')
      await actAs(client, userId)
      const err = await expectQueryError(
        client,
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, '2019-12-31', 'cash', $2)`,
        [memberId, randomUUID()],
      )
      expect(err.message).toBe('La fecha del pago es demasiado vieja')
    })
  })

  it('UPDATE amount_cents falla como admin y como postgres (inmutable)', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Fijo', lastName: 'Monto', joinedOn: '2026-01-01' })
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const payment = await client.query(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'cash', $2) returning id`,
        [memberId, randomUUID()],
      )
      const id = payment.rows[0].id

      // `amount_cents` no tiene grant de UPDATE para `authenticated`
      // (ninguna combinación de rol de app): la primera barrera es
      // "permission denied", ni siquiera admin llega al trigger.
      await actAsSuperuser(client)
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const errAdmin = await expectQueryError(client, `update public.payments set amount_cents = 1 where id = $1`, [id])
      expect(errAdmin.message).toMatch(/permission denied/i)

      // Como superusuario (bypasea el grant) SÍ llega al trigger
      // `protect_immutable_columns`, que rechaza igual.
      await actAsSuperuser(client)
      const errSuper = await expectQueryError(client, `update public.payments set amount_cents = 1 where id = $1`, [id])
      expect(errSuper.message).toMatch(/no se puede|immutable|forbid/i)
    })
  })

  it('authenticated sin DELETE; service_role sin INSERT/UPDATE, con SELECT', async () => {
    await withRollback(async (client) => {
      // `hasGrant` lee `information_schema.role_table_grants`, que solo
      // muestra lo visible para el rol de sesión ACTUAL: hay que consultarlo
      // como superusuario (miembro de todos los roles), no simulando
      // `authenticated`, o los grants de `service_role` quedan invisibles.
      expect(await hasGrant(client, 'authenticated', 'payments', 'DELETE')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'payments', 'DELETE')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'payments', 'INSERT')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'payments', 'UPDATE')).toBe(false)
      expect(await hasGrant(client, 'service_role', 'payments', 'SELECT')).toBe(true)
    })
  })
})

describe.skipIf(!dbAvailable)('payments: anulación y comprobante', () => {
  it('anular como editor: error; como admin: OK, audit_log con changed_fields = {voided_at, voided_by, void_reason}; anular dos veces: error', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Anular', lastName: 'Pago', joinedOn: '2026-01-01' })
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const payment = await client.query(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'cash', $2) returning id`,
        [memberId, randomUUID()],
      )
      const id = payment.rows[0].id

      const errEditor = await expectQueryError(
        client,
        `update public.payments set voided_at = now(), voided_by = $2, void_reason = 'motivo valido' where id = $1`,
        [id, editorId],
      )
      expect(errEditor.message).toBe('No tenés permiso para anular pagos')

      await actAsSuperuser(client)
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      await client.query(`update public.payments set voided_at = now(), voided_by = $2, void_reason = 'motivo valido' where id = $1`, [
        id,
        adminId,
      ])

      await actAsSuperuser(client)
      const audit = await client.query(
        `select changed_fields from public.audit_log where table_name = 'payments' and record_id = $1::text and op = 'UPDATE' order by occurred_at desc limit 1`,
        [String(id)],
      )
      expect(new Set(audit.rows[0].changed_fields)).toEqual(new Set(['voided_at', 'voided_by', 'void_reason']))

      await actAs(client, adminId)
      const errTwice = await expectQueryError(
        client,
        `update public.payments set voided_at = now(), voided_by = $2, void_reason = 'de nuevo' where id = $1`,
        [id, adminId],
      )
      expect(errTwice.message).toBe('Este pago ya está anulado')
    })
  })

  it('adjuntar comprobante null->valor como editor: OK; reemplazarlo: error; quitarlo (null): error', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'Comprobante', lastName: 'Pago', joinedOn: '2026-01-01' })
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const payment = await client.query(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'transfer', $2) returning id`,
        [memberId, randomUUID()],
      )
      const id = payment.rows[0].id

      await client.query(
        `update public.payments set receipt_storage_path = $2, receipt_filename = $3 where id = $1`,
        [id, 'payment-receipts/1/a.png', 'a.png'],
      )
      const afterAttach = await client.query(`select receipt_storage_path from public.payments where id = $1`, [id])
      expect(afterAttach.rows[0].receipt_storage_path).toBe('payment-receipts/1/a.png')

      const errReplace = await expectQueryError(
        client,
        `update public.payments set receipt_storage_path = $2 where id = $1`,
        [id, 'payment-receipts/1/b.png'],
      )
      expect(errReplace.message).toBe('El comprobante ya está cargado y no se reemplaza')

      const errRemove = await expectQueryError(client, `update public.payments set receipt_storage_path = null where id = $1`, [id])
      expect(errRemove.message).toBe('El comprobante ya está cargado y no se reemplaza')
    })
  })

  it('adjuntar comprobante a un pago YA anulado: rechazado', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'YaAnulado', lastName: 'Pago', joinedOn: '2026-01-01' })
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const payment = await client.query(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'transfer', $2) returning id`,
        [memberId, randomUUID()],
      )
      const id = payment.rows[0].id

      await actAsSuperuser(client)
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      await client.query(`update public.payments set voided_at = now(), voided_by = $2, void_reason = 'motivo valido' where id = $1`, [
        id,
        adminId,
      ])

      const err = await expectQueryError(
        client,
        `update public.payments set receipt_storage_path = $2, receipt_filename = 'x.png' where id = $1`,
        [id, 'payment-receipts/1/x.png'],
      )
      expect(err.message).toBe('Un pago anulado no lleva comprobante')
    })
  })

  it('anular y adjuntar comprobante en la MISMA sentencia: rechazado', async () => {
    await withRollback(async (client) => {
      const memberId = await createMember(client, { firstName: 'MismoUpdate', lastName: 'Pago', joinedOn: '2026-01-01' })
      const { userId: editorId } = await createUserWithRole(client, 'editor')
      await actAs(client, editorId)
      const payment = await client.query(
        `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 1000000, current_date, 'transfer', $2) returning id`,
        [memberId, randomUUID()],
      )
      const id = payment.rows[0].id

      await actAsSuperuser(client)
      const { userId: adminId } = await createUserWithRole(client, 'admin')
      await actAs(client, adminId)
      const err = await expectQueryError(
        client,
        `update public.payments set voided_at = now(), voided_by = $2, void_reason = 'motivo valido', receipt_storage_path = $3, receipt_filename = 'x.png' where id = $1`,
        [id, adminId, 'payment-receipts/1/x.png'],
      )
      expect(err.message).toBe('Un pago anulado no lleva comprobante')
    })
  })
})
