import 'server-only'

import { requirePanelAccess } from '@/controllers/session.controller'
import { getMemberDetail, searchMembers } from '@/models/members.model'
import { getSignedUrl } from '@/services/storage.service'
import type { MemberDetail, MemberFilters, MemberSummary, Page } from '@/models/types'

/**
 * Lecturas del padrón para Server Components. Re-verifica sesión (D10: la
 * defensa real es RLS, pero cada controller responde claro en vez de mostrar
 * listas vacías que parecen un bug). La lectura no exige un rol específico:
 * `consulta` también puede ver el padrón (matriz §6.5).
 */

export async function getPadron(filters: MemberFilters): Promise<Page<MemberSummary>> {
  await requirePanelAccess()
  return searchMembers(filters)
}

/**
 * Ficha completa del socio. Es la ÚNICA lectura que arma la URL firmada del
 * apto vigente (60 s), y solo cuando hay adjunto: `getMemberDetail` del
 * modelo nunca la resuelve, para no acoplar el modelo a Storage.
 *
 * Tira `DomainError` con `status: 404` si el socio no existe (id inválido o
 * navegado a mano); la page lo puede mapear a `notFound()`.
 */
export async function getMemberPage(id: number): Promise<MemberDetail> {
  await requirePanelAccess()
  const detail = await getMemberDetail(id)

  if (detail.currentMedicalClearance?.storagePath) {
    detail.medicalClearanceUrl = await getSignedUrl(detail.currentMedicalClearance.storagePath, 60)
  }

  return detail
}
