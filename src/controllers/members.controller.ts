import 'server-only'

import { requirePanelAccess } from '@/controllers/session.controller'
// `accounts.model.ts` lo escribe B2 en paralelo (pipeline 2026-09-27,
// 01-tasks.md B3): si todavía no aterrizó, esta importación y el typecheck
// fallan a propósito hasta que su archivo exista con esta firma
// (`getMemberAccountDetail(memberId): Promise<MemberAccountDetail>`, con
// facturación inactiva devuelve una cuenta en ceros — nunca `null`; `null`
// acá es SOLO por falta de `payments.read`). Documentado en el dev log.
import { getMemberAccountDetail } from '@/models/accounts.model'
import { getBillingStatus } from '@/models/billing.model'
import { getMemberDetail, searchMembers } from '@/models/members.model'
import type { MemberFilters, MemberPageData, MemberSummary, Page } from '@/models/types'

/**
 * Lecturas del padrón para Server Components. Re-verifica sesión (D10: la
 * defensa real es RLS, pero cada controller responde claro en vez de mostrar
 * listas vacías que parecen un bug). La lectura no exige un rol específico:
 * `consulta` también puede ver el padrón (matriz §6.5).
 *
 * El filtro de deuda y los campos calculados (`debtStatus`/`balanceCents`/
 * `monthsDue`) dependen del PERMISO `payments.read` de la sesión, no del rol
 * (00-architecture.md §13, T12): sin él, `searchMembers` ni los pide.
 */

export async function getPadron(filters: MemberFilters): Promise<Page<MemberSummary>> {
  const session = await requirePanelAccess()
  return searchMembers(filters, { includeDebt: session.permissions.includes('payments.read') })
}

/**
 * Ficha completa del socio: datos + estado de cuenta + estado de la
 * facturación (Revisión 3, §13.6). `account` viene `null` sin
 * `payments.read` (hoy los tres roles lo tienen; queda listo para cuando haya
 * roles configurables sin ese permiso) — nunca se llega a pedir la cuenta ni
 * se expone un resultado a medias.
 *
 * `MemberDetail.medicalClearanceUrl` queda SIEMPRE en `null` (lo que ya
 * devuelve `getMemberDetail` del modelo): la URL firmada del certificado ya
 * no se genera al renderizar la ficha (03-review.md, Major 4 — moría a los 60
 * segundos de abrir la página, el caso normal con el celular de la sede). La
 * firma ahora es bajo demanda, al click de "Ver certificado", con la nueva
 * Server Action `getMedicalClearanceUrl` de `members.actions.ts`.
 *
 * Tira `DomainError` con `status: 404` si el socio no existe (id inválido o
 * navegado a mano); la page lo puede mapear a `notFound()`.
 */
export async function getMemberPage(id: number): Promise<MemberPageData> {
  const session = await requirePanelAccess()
  const includeAccount = session.permissions.includes('payments.read')

  const [member, billing, account] = await Promise.all([
    getMemberDetail(id),
    getBillingStatus(),
    includeAccount ? getMemberAccountDetail(id) : Promise.resolve(null),
  ])

  return { member, account, billing }
}
