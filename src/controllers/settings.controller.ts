import 'server-only'

import { requirePanelPermission } from '@/controllers/session.controller'
import { getSettings } from '@/models/settings.model'
import { listDisciplines } from '@/models/catalogs.model'
import { getFeePricesOverview } from '@/models/fee-prices.model'
import { getBillingStatus } from '@/models/billing.model'
import type { BillingStatus, DisciplineWithCategories, FeePricesOverview, Settings } from '@/models/types'

export type SettingsPageData = {
  settings: Settings
  /** Todas, incluidas las inactivas: acá se administra el catálogo completo. */
  disciplines: DisciplineWithCategories[]
  /**
   * Solo las categorías ACTIVAS, agrupadas por disciplina: es lo que puede
   * elegir el selector de "valor de cuota por categoría" — no tiene sentido
   * fijar un precio nuevo para una categoría que el club ya dio de baja.
   */
  categoriesByDiscipline: DisciplineWithCategories[]
  feePrices: FeePricesOverview
  billing: BillingStatus
}

/**
 * Lectura combinada para `/ajustes`: settings del club + disciplinas con
 * categorías + valores de cuota + estado de la facturación.
 *
 * `(admin)/layout.tsx` ya bloquea la ruta a quien no es admin (D10), pero la
 * re-verificación acá es la que corresponde al controller: la defensa real
 * sigue siendo RLS, esto es responder claro en vez de dejar que una llamada
 * fuera de lugar devuelva datos que la UI no esperaba filtrar. Desde el
 * pipeline `2026-09-27-cuotas-pagos-panel` (T12/D20) el chequeo es por
 * PERMISO (`settings.manage`), no por rol: con el mapeo de hoy es lo mismo
 * (solo `admin` lo tiene), pero cuando exista el pipeline de roles
 * configurables esta firma no cambia.
 *
 * Los selects de disciplina/categoría del padrón (solo activas) no pasan por
 * acá: `listDisciplines({ includeInactive: false })` de `catalogs.model.ts` es
 * una lectura plana que cualquier page puede llamar directo (CLAUDE.md,
 * "cuándo hace falta un controller").
 */
export async function getSettingsPage(): Promise<SettingsPageData> {
  await requirePanelPermission('settings.manage')

  const [settings, disciplines, categoriesByDiscipline, feePrices, billing] = await Promise.all([
    getSettings(),
    listDisciplines({ includeInactive: true }),
    listDisciplines({ includeInactive: false }),
    getFeePricesOverview(),
    getBillingStatus(),
  ])

  return { settings, disciplines, categoriesByDiscipline, feePrices, billing }
}
