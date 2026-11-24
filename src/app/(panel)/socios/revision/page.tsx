import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { listPortalRequests } from '@/controllers/portal.controller'
import { ReviewListView } from '@/views/portal/review-list-view'

// Título genérico: la Revisión maneja datos de gente que todavía no es socia.
export const metadata: Metadata = { title: 'Revisión — Lonqui' }

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const session = await requirePanelPermission('portal.review')

  const estado = Array.isArray(sp.estado) ? sp.estado[0] : sp.estado
  const status = estado === 'resueltos' ? 'resolved' : 'pending'
  const requests = await listPortalRequests({ status })

  return <ReviewListView requests={requests} status={status} canInviteByCategory={session.permissions.includes('portal.invite')} />
}
