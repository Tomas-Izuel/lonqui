import type { Metadata } from 'next'
import { notFound, unstable_rethrow } from 'next/navigation'
import { requirePanelAccess } from '@/controllers/session.controller'
import { getMemberPage } from '@/controllers/members.controller'
import { getMemberPortalAccess } from '@/controllers/portal.controller'
import { log } from '@/lib/log'
import { listDisciplines } from '@/models/catalogs.model'
import { isDomainError } from '@/lib/errors'
import { MemberDetailView } from '@/views/members/member-detail-view'

// Título genérico a propósito: nunca el DNI, y evita una segunda lectura de
// `getMemberPage` solo para el nombre en `generateMetadata` (repetiría la
// consulta y la firma de la URL del certificado).
export const metadata: Metadata = { title: 'Ficha del socio — Lonqui' }

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  if (!/^\d+$/.test(id)) notFound()

  const session = await requirePanelAccess()

  let data, disciplines
  try {
    ;[data, disciplines] = await Promise.all([getMemberPage(Number(id)), listDisciplines()])
  } catch (err) {
    if (isDomainError(err) && err.status === 404) notFound()
    throw err
  }

  // "App de socios": solo con permiso, y como promesa sin esperar — la ficha pinta
  // primero y la sección llega por streaming. Si la lectura falla resuelve a `null`
  // (la sección muestra su error) en vez de tumbar la ficha entera.
  // SIEMPRE las cuentas que ven a ESTE socio (`getMemberPortalAccess`), también con grupo:
  // la lectura del grupo trae vínculos de los hermanos sin decir a quién apuntan, y
  // "Revocar vínculo" desde acá cortaría el acceso de otro socio (review S2, B1).
  const canSeePortal = session.permissions.includes('portal.invite') || session.permissions.includes('portal.review')
  const accessPromise = canSeePortal
    ? getMemberPortalAccess(data.member.id).catch((err: unknown) => {
        unstable_rethrow(err)
        log.error('socios.ficha.portalAccess', 'no se pudo leer la app de socios de la ficha', err, { memberId: data.member.id })
        return null
      })
    : null

  // `?invitar=<pedido>` llega desde la ficha de ingreso precargada (`/socios/nuevo?pedido=`).
  const invitarRaw = Array.isArray(sp.invitar) ? sp.invitar[0] : sp.invitar
  const autoInvite = invitarRaw && /^\d+$/.test(invitarRaw) ? { requestId: Number(invitarRaw) } : undefined

  return (
    <MemberDetailView
      data={data}
      disciplines={disciplines}
      permissions={session.permissions}
      portal={accessPromise ? { accessPromise, autoInvite } : undefined}
    />
  )
}
