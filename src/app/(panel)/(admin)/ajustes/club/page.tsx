import type { Metadata } from 'next'
import { getAjustesClubData } from '@/controllers/settings.controller'
import { ClubTabView } from '@/views/settings/settings-tab-views'

export const metadata: Metadata = { title: 'Club · Ajustes — Lonqui' }

export default async function AjustesClubPage() {
  const { settings } = await getAjustesClubData()
  return <ClubTabView settings={settings} />
}
