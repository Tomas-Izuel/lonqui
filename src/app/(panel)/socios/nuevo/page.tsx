import type { Metadata } from 'next'
import { requirePanelAccess } from '@/controllers/session.controller'
import { listDisciplines } from '@/models/catalogs.model'
import { listFamilyGroups } from '@/models/family-groups.model'
import { AccessDenied } from '@/views/shell/access-denied'
import { MemberForm } from '@/views/members/member-form'

export const metadata: Metadata = { title: 'Ficha de ingreso — Club Naranja y Blanco' }

/**
 * `consulta` no ve el botón de alta en `/socios`, pero la ruta igual se
 * re-verifica acá (D10: cada page vuelve a chequear el rol) por si alguien
 * la pega a mano. `createMember` (B2) también la exige — esto es solo para
 * responder claro en vez de que el formulario falle recién al enviar.
 */
export default async function NewMemberPage() {
  const session = await requirePanelAccess()

  if (!session.permissions.includes('members.write')) {
    return <AccessDenied />
  }

  const [disciplines, familyGroups] = await Promise.all([listDisciplines(), listFamilyGroups()])

  return <MemberForm mode="create" disciplines={disciplines} familyGroups={familyGroups} />
}
