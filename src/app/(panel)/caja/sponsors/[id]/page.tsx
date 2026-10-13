import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getSponsorDetailPage } from '@/controllers/income.controller'
import { SponsorDetailView } from '@/views/income/sponsor-detail-view'

// Título genérico a propósito: el nombre del sponsor no va en el título de la pestaña.
export const metadata: Metadata = { title: 'Sponsor — Lonqui' }

export default async function SponsorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) notFound()

  const session = await requirePanelPermission('income.read')
  const detail = await getSponsorDetailPage(Number(id))
  if (!detail) notFound()

  return <SponsorDetailView detail={detail} canVoid={session.permissions.includes('income.void')} />
}
