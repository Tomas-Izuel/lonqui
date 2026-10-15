import type { Metadata } from 'next'
import { getAjustesCuotasData } from '@/controllers/settings.controller'
import { CuotasTabView } from '@/views/settings/settings-tab-views'

export const metadata: Metadata = { title: 'Cuotas · Ajustes — Lonqui' }

export default async function AjustesCuotasPage() {
  const { feePrices, billing, disciplines, categoriesByDiscipline } = await getAjustesCuotasData()
  return (
    <CuotasTabView
      feePrices={feePrices}
      billing={billing}
      disciplines={disciplines}
      categoriesByDiscipline={categoriesByDiscipline}
    />
  )
}
