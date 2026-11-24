import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { listCategoryInviteTargets } from '@/controllers/portal.controller'
import { listDisciplines } from '@/models/catalogs.model'
import { InviteByCategoryView } from '@/views/portal/invite-by-category-view'

export const metadata: Metadata = { title: 'Invitar por categoría — Lonqui' }

export default async function InviteByCategoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  await requirePanelPermission('portal.invite')

  const raw = Array.isArray(sp.categoria) ? sp.categoria[0] : sp.categoria
  const categoryId = raw && /^\d+$/.test(raw) ? Number(raw) : null

  const [disciplines, targets] = await Promise.all([
    listDisciplines(),
    categoryId != null ? listCategoryInviteTargets(categoryId) : Promise.resolve(null),
  ])

  return <InviteByCategoryView disciplines={disciplines} categoryId={categoryId} targets={targets} />
}
