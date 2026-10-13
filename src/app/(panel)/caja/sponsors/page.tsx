import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getSponsorsPage } from '@/controllers/income.controller'
import { SponsorsView } from '@/views/income/sponsors-view'

export const metadata: Metadata = { title: 'Sponsors — Lonqui' }

export default async function SponsorsPage() {
  await requirePanelPermission('income.read')
  const sponsors = await getSponsorsPage()
  return <SponsorsView sponsors={sponsors} />
}
