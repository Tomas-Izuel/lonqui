import 'server-only'

import { requirePanelPermission } from '@/controllers/session.controller'
import { getSettings } from '@/models/settings.model'
import { listDisciplines } from '@/models/catalogs.model'
import { getFeePricesOverview } from '@/models/fee-prices.model'
import { getBillingStatus } from '@/models/billing.model'
import { listCashConcepts } from '@/models/cash-concepts.model'
import type { BillingStatus, CashConcept, DisciplineWithCategories, FeePricesOverview, Settings } from '@/models/types'

/**
 * Lecturas de `/ajustes`, una por pestaña (`/ajustes/cuotas|deportes|caja|club`).
 * Cada pestaña es una page propia: carga solo lo suyo, no el combo entero.
 *
 * Todas re-verifican `settings.manage` (por PERMISO, no por rol; D20): el
 * layout `(admin)` ya bloquea la ruta, pero los layouts no se re-ejecutan al
 * navegar del lado del cliente, y la defensa real sigue siendo RLS.
 */

export type AjustesCuotasData = {
  feePrices: FeePricesOverview
  billing: BillingStatus
  /** Todas, incluidas las inactivas: para etiquetar valores históricos. */
  disciplines: DisciplineWithCategories[]
  /**
   * Solo categorías ACTIVAS: es lo que ofrece "Nuevo valor"; no tiene sentido
   * fijar un precio para una categoría que el club dio de baja.
   */
  categoriesByDiscipline: DisciplineWithCategories[]
}

export type AjustesDeportesData = {
  /** Todas, incluidas las inactivas: acá se administra el catálogo completo. */
  disciplines: DisciplineWithCategories[]
}

export type AjustesCajaData = {
  /** Todos, incluidos los inactivos: acá se administra el catálogo. */
  incomeConcepts: CashConcept[]
}

export type AjustesClubData = { settings: Settings }

export async function getAjustesCuotasData(): Promise<AjustesCuotasData> {
  await requirePanelPermission('settings.manage')

  const [feePrices, billing, disciplines, categoriesByDiscipline] = await Promise.all([
    getFeePricesOverview(),
    getBillingStatus(),
    listDisciplines({ includeInactive: true }),
    listDisciplines({ includeInactive: false }),
  ])

  return { feePrices, billing, disciplines, categoriesByDiscipline }
}

export async function getAjustesDeportesData(): Promise<AjustesDeportesData> {
  await requirePanelPermission('settings.manage')
  return { disciplines: await listDisciplines({ includeInactive: true }) }
}

export async function getAjustesCajaData(): Promise<AjustesCajaData> {
  await requirePanelPermission('settings.manage')
  return { incomeConcepts: await listCashConcepts({ includeInactive: true }) }
}

export async function getAjustesClubData(): Promise<AjustesClubData> {
  await requirePanelPermission('settings.manage')
  return { settings: await getSettings() }
}
