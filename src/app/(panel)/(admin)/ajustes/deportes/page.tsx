import type { Metadata } from 'next'
import { getAjustesDeportesData } from '@/controllers/settings.controller'
import { DeportesTabView } from '@/views/settings/settings-tab-views'

export const metadata: Metadata = { title: 'Deportes · Ajustes — Lonqui' }

export default async function AjustesDeportesPage() {
  const { disciplines } = await getAjustesDeportesData()
  return <DeportesTabView disciplines={disciplines} />
}
