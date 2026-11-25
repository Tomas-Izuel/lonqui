import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getNextPendingRequestId, getPortalRequestDetail, listPortalRequests } from '@/controllers/portal.controller'
import { ReviewDetailView, type ReviewNav } from '@/views/portal/review-detail-view'

// Nunca el nombre ni el DNI en el título (datos personales).
export const metadata: Metadata = { title: 'Pedido de acceso — Lonqui' }

export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const requestId = Number(id)

  const session = await requirePanelPermission('portal.review')
  const [detail, pending] = await Promise.all([getPortalRequestDetail(requestId), listPortalRequests({ status: 'pending' })])
  if (!detail) notFound()
  // El mejor candidato primero: es el que la pantalla deja elegido por defecto.
  const sortedDetail = { ...detail, candidates: [...detail.candidates].sort((a, b) => b.score - a.score) }

  // Anterior y siguiente salen de la cola de pendientes (más viejo primero). Si este
  // pedido ya no está en ella (recién resuelto, o de la solapa Resueltos), el siguiente
  // es el próximo pendiente después de su id.
  const index = pending.findIndex((r) => r.id === requestId)
  const nav: ReviewNav =
    index >= 0
      ? {
          prevId: pending[index - 1]?.id ?? null,
          nextId: pending[index + 1]?.id ?? null,
          position: { index, total: pending.length },
        }
      : { prevId: null, nextId: await getNextPendingRequestId(requestId), position: null }

  return <ReviewDetailView key={requestId} detail={sortedDetail} nav={nav} permissions={session.permissions} />
}
