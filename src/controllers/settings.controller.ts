import 'server-only'

import { requirePanelAccess } from './session.controller'
import { getSettings } from '@/models/settings.model'
import { listDisciplines } from '@/models/catalogs.model'
import type { DisciplineWithCategories, Settings } from '@/models/types'

/**
 * Lectura combinada para `/ajustes`: settings del club + disciplinas con
 * categorías, **incluidas las inactivas** (a diferencia de los selects del
 * padrón, acá el admin tiene que poder reactivar lo que dio de baja).
 *
 * `(admin)/layout.tsx` ya bloquea la ruta a quien no es admin (D10), pero la
 * re-verificación acá es la que corresponde al controller: la defensa real
 * sigue siendo RLS, esto es responder claro en vez de dejar que una llamada
 * fuera de lugar devuelva datos que la UI no esperaba filtrar.
 *
 * Los selects de disciplina/categoría del padrón (solo activas) no pasan por
 * acá: `listDisciplines({ includeInactive: false })` de `catalogs.model.ts` es
 * una lectura plana que cualquier page puede llamar directo (CLAUDE.md,
 * "cuándo hace falta un controller").
 */
export async function getSettingsPage(): Promise<{ settings: Settings; disciplines: DisciplineWithCategories[] }> {
  await requirePanelAccess('admin')

  const [settings, disciplines] = await Promise.all([getSettings(), listDisciplines({ includeInactive: true })])

  return { settings, disciplines }
}
