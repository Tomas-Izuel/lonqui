import { randomUUID } from 'node:crypto'
import type { ClientBase } from 'pg'
import { actAsSuperuser, createCategory, createDiscipline, createFamilyGroup, createMember, createUserWithRole, openMemberCategory } from './helpers'
import { issueToken, linkNewAccount, submitRequest } from './portal-fixtures'

/**
 * Seed del club para el cierre dinámico (`portal-lockdown.test.ts`): una fila inventada en CADA tabla y vista de
 * `public` (el test de "seed no vacuo" lo exige). Vive acá, aparte del test, para que quien agregue tablas o buckets
 * (S2+) lo extienda sin tocar el recorrido. Todo corre dentro de `withRollback`.
 */

export type Seeds = {
  memberId: number
  withdrawnMemberId: number
  creditMemberId: number
  groupId: number
  sponsorId: number
  storageObjectName: string
  adminId: string
  /** Cuenta de la app de socios (vinculada a `memberId` con family_scope). */
  portalAccountId: string
  portalLinkId: number
  /** Token de invitación ya canjeado (el que creó la cuenta). */
  consumedTokenId: number
  /** Token de invitación vivo (QR) sobre `creditMemberId`. */
  pendingTokenId: number
  /** Pedido de acceso pendiente. */
  requestId: number
}

/** Un socio con grupo, categoría, cuota, pago, caja, apto, baja y un objeto en CADA bucket de storage. Todo inventado. */
export async function seedClub(client: ClientBase): Promise<Seeds> {
  await actAsSuperuser(client)
  const tag = randomUUID().slice(0, 8)

  const groupId = await createFamilyGroup(client, { name: `Grupo Ficticio ${tag}` })
  const disciplineId = await createDiscipline(client, { name: `Disciplina Ficticia ${tag}` })
  const categoryId = await createCategory(client, { disciplineId, name: `Categoria Ficticia ${tag}` })
  const memberId = await createMember(client, {
    firstName: 'Ficticia',
    lastName: `Prueba${tag}`,
    dni: '00000000',
    familyGroupId: groupId,
    joinedOn: '2026-01-01',
  })
  await openMemberCategory(client, { memberId, categoryId, joinedOn: '2026-01-01' })

  const withdrawnMemberId = await createMember(client, { firstName: 'Ficticio', lastName: `Baja${tag}`, joinedOn: '2026-01-01' })
  await client.query(
    `insert into public.member_status_events (member_id, event_type, effective_on, reason) values ($1, 'withdrawal', '2026-03-01', 'Motivo ficticio de baja')`,
    [withdrawnMemberId],
  )
  // Un pago sin cuotas: queda entero como saldo a favor y asegura una fila en `payment_credit` con crédito.
  const creditMemberId = await createMember(client, { firstName: 'Ficticio', lastName: `Credito${tag}`, joinedOn: '2026-01-01' })
  await client.query(
    `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 50000, '2026-02-12', 'transfer', $2)`,
    [creditMemberId, randomUUID()],
  )

  await client.query(`insert into public.fee_prices (scope, amount_cents, valid_from) values ('default', 1000000, '2090-01-01')`)
  await client.query(
    `insert into public.fees (member_id, period, kind, amount_cents, description) values ($1, '2026-02-01', 'monthly', 1000000, 'fixture')`,
    [memberId],
  )
  await client.query(
    `insert into public.payments (member_id, amount_cents, paid_on, method, batch_id) values ($1, 400000, '2026-02-10', 'cash', $2)`,
    [memberId, randomUUID()],
  )
  await client.query(
    `insert into public.medical_clearances (member_id, expires_on, storage_path, original_filename) values ($1, '2027-01-01', $2, 'apto-ficticio.pdf')`,
    [memberId, `medical-clearances/${memberId}/apto-ficticio.pdf`],
  )
  await client.query(`insert into public.billing_runs (period, trigger, status, fees_created) values ('2026-02-01', 'manual', 'ok', 1)`)
  const concept = await client.query<{ id: string }>(`insert into public.cash_concepts (name) values ($1) returning id`, [`Concepto Ficticio ${tag}`])
  const sponsor = await client.query<{ id: string }>(`insert into public.sponsors (name) values ($1) returning id`, [`Sponsor Ficticio ${tag}`])
  await client.query(
    `insert into public.cash_movements (concept_id, sponsor_id, amount_cents, occurred_on, method, batch_id)
     values ($1, $2, 250000, '2026-02-11', 'cash', $3)`,
    [concept.rows[0].id, sponsor.rows[0].id, randomUUID()],
  )
  // Alguien con rol del panel: también hace que `app_users` y `audit_log` tengan filas propias.
  const admin = await createUserWithRole(client, 'admin', { displayName: 'Admin Ficticio' })

  // App de socios (S2): una cuenta con su vínculo (invitación canjeada), una invitación pendiente y un pedido de acceso.
  // Todo por las RPC reales (create_portal_token como el admin; portal_token_consume y portal_submit_access_request como
  // service_role): así las cinco tablas portal_* y private.portal_rate_limits quedan con filas auténticas.
  const portal = await linkNewAccount(client, { adminId: admin.userId, memberId, relationship: 'guardian', familyScope: true })
  const pending = await issueToken(client, admin.userId, { memberId: creditMemberId, delivery: 'qr', relationship: 'guardian' })
  const request = await submitRequest(client, { people: [{ first_name: 'Hijo', last_name: `Pedido${tag}`, dni: null, relationship: 'guardian' }] })

  // Un objeto en cada bucket (los del catálogo, no una lista fija). `storage.objects` lo escribe `postgres`, como Storage.
  const buckets = await client.query<{ id: string }>(`select id from storage.buckets order by id`)
  let storageObjectName = ''
  for (const b of buckets.rows) {
    const name = b.id === 'attachments' ? `medical-clearances/${memberId}/apto-ficticio-${tag}.pdf` : `fixture/${tag}.bin`
    if (b.id === 'attachments') storageObjectName = name
    await client.query(`insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, null)`, [b.id, name])
  }

  return {
    memberId,
    withdrawnMemberId,
    creditMemberId,
    groupId,
    sponsorId: Number(sponsor.rows[0].id),
    storageObjectName,
    adminId: admin.userId,
    portalAccountId: portal.userId,
    portalLinkId: portal.linkId,
    consumedTokenId: portal.tokenId,
    pendingTokenId: pending.tokenId,
    requestId: request.requestId as number,
  }
}
