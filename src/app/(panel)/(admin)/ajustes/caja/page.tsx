import type { Metadata } from 'next'
import { getAjustesCajaData } from '@/controllers/settings.controller'
import { CajaTabView } from '@/views/settings/settings-tab-views'

export const metadata: Metadata = { title: 'Caja · Ajustes — Lonqui' }

export default async function AjustesCajaPage() {
  const { incomeConcepts } = await getAjustesCajaData()
  return <CajaTabView incomeConcepts={incomeConcepts} />
}
