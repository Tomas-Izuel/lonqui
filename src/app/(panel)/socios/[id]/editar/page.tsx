import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requirePanelAccess } from '@/controllers/session.controller'
import { getMemberPage } from '@/controllers/members.controller'
import { listDisciplines } from '@/models/catalogs.model'
import { listFamilyGroups } from '@/models/family-groups.model'
import { isDomainError } from '@/lib/errors'
import { AccessDenied } from '@/views/shell/access-denied'
import { MemberForm } from '@/views/members/member-form'

export const metadata: Metadata = { title: 'Editar socio — Lonqui' }

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()

  const session = await requirePanelAccess()

  if (!session.permissions.includes('members.write')) {
    return <AccessDenied />
  }

  let data, disciplines, familyGroups
  try {
    ;[data, disciplines, familyGroups] = await Promise.all([getMemberPage(Number(id)), listDisciplines(), listFamilyGroups()])
  } catch (err) {
    if (isDomainError(err) && err.status === 404) notFound()
    throw err
  }

  return <MemberForm mode="edit" member={data.member} disciplines={disciplines} familyGroups={familyGroups} />
}
