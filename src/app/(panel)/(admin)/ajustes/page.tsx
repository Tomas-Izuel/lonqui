import type { Metadata } from 'next'
import { getSettingsPage } from '@/controllers/settings.controller'
import { SettingsPageView } from '@/views/settings/settings-page-view'

export const metadata: Metadata = { title: 'Ajustes — Lonqui' }

/**
 * Routing fino (CLAUDE.md): la page llama al controller y renderiza la vista.
 * `(admin)/layout.tsx` ya bloqueó el acceso a quien no es admin; `getSettingsPage`
 * vuelve a verificar el rol antes de tocar la base (defensa en profundidad).
 */
export default async function AjustesPage() {
  const { settings, disciplines, categoriesByDiscipline, feePrices, billing } = await getSettingsPage()

  return (
    <SettingsPageView
      settings={settings}
      disciplines={disciplines}
      categoriesByDiscipline={categoriesByDiscipline}
      feePrices={feePrices}
      billing={billing}
    />
  )
}
