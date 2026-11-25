import type { Metadata } from 'next'
import { requirePanelAccess } from '@/controllers/session.controller'
import { getPortalRequestPrefill } from '@/controllers/portal.controller'
import { listDisciplines } from '@/models/catalogs.model'
import { listFamilyGroups } from '@/models/family-groups.model'
import { AccessDenied } from '@/views/shell/access-denied'
import { MemberForm } from '@/views/members/member-form'

export const metadata: Metadata = { title: 'Ficha de ingreso — Lonqui' }

/**
 * `consulta` no ve el botón de alta en `/socios`, pero la ruta igual se
 * re-verifica acá (D10: cada page vuelve a chequear el rol) por si alguien
 * la pega a mano. `createMember` (B2) también la exige — esto es solo para
 * responder claro en vez de que el formulario falle recién al enviar.
 */
export default async function NewMemberPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const session = await requirePanelAccess()

  if (!session.permissions.includes('members.write')) {
    return <AccessDenied />
  }

  // `?pedido=<id>` (desde Revisión): precarga la ficha con lo que declaró la persona.
  // Solo con `portal.review` — sin él la lectura redirigiría, y una ficha de ingreso
  // común no tiene por qué fallar por un parámetro de más.
  const pedidoRaw = Array.isArray(sp.pedido) ? sp.pedido[0] : sp.pedido
  const pedidoId = pedidoRaw && /^\d+$/.test(pedidoRaw) ? Number(pedidoRaw) : null

  const [disciplines, familyGroups, prefill] = await Promise.all([
    listDisciplines(),
    listFamilyGroups(),
    pedidoId != null && session.permissions.includes('portal.review')
      ? getPortalRequestPrefill(pedidoId)
      : Promise.resolve(null),
  ])

  return <MemberForm mode="create" disciplines={disciplines} familyGroups={familyGroups} prefill={prefill ?? undefined} />
}
