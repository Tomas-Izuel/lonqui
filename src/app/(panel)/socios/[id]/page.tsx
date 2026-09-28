import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requirePanelAccess } from '@/controllers/session.controller'
import { getMemberPage } from '@/controllers/members.controller'
import { listDisciplines } from '@/models/catalogs.model'
import { isDomainError } from '@/lib/errors'
import { MemberDetailView } from '@/views/members/member-detail-view'

// Título genérico a propósito: nunca el DNI, y evita una segunda lectura de
// `getMemberPage` solo para el nombre en `generateMetadata` (repetiría la
// consulta y la firma de la URL del certificado).
export const metadata: Metadata = { title: 'Ficha del socio — Club Naranja y Blanco' }

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()

  const session = await requirePanelAccess()

  let data, disciplines
  try {
    ;[data, disciplines] = await Promise.all([getMemberPage(Number(id)), listDisciplines()])
  } catch (err) {
    if (isDomainError(err) && err.status === 404) notFound()
    throw err
  }

  return <MemberDetailView data={data} disciplines={disciplines} permissions={session.permissions} />
}
