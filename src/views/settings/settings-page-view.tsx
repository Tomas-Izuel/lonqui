import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { DisciplineGroup } from '@/views/settings/discipline-group'
import { NewDisciplineButton } from '@/views/settings/new-discipline-button'
import { ClubSettingsForm } from '@/views/settings/club-settings-form'
import { FeePricesSection } from '@/views/settings/fee-prices-section'
import { BillingSection } from '@/views/settings/billing-section'
import type { BillingStatus, DisciplineWithCategories, FeePricesOverview, Settings } from '@/models/types'

/**
 * `/ajustes`. Cero data fetching (CLAUDE.md): recibe todo ya resuelto por
 * `getSettingsPage()` (Server Component, `page.tsx`). Server Component en sí
 * mismo — el estado interactivo vive en los islands hijos (`DisciplineGroup`,
 * `ClubSettingsForm`, `FeePricesSection`, `BillingSection`), lo más abajo
 * posible del árbol.
 *
 * Orden de los paneles: catálogo (disciplinas y categorías) → su precio
 * (valores de cuota, que referencian esas categorías) → activación de la
 * facturación (que exige el valor por defecto de arriba) → datos generales
 * del club. Cada panel es su propia sección, ninguna anidada (piso de
 * calidad).
 */
export function SettingsPageView({
  settings,
  disciplines,
  categoriesByDiscipline,
  feePrices,
  billing,
}: {
  settings: Settings
  disciplines: DisciplineWithCategories[]
  categoriesByDiscipline: DisciplineWithCategories[]
  feePrices: FeePricesOverview
  billing: BillingStatus
}) {
  const disciplineIds = disciplines.map((d) => d.id)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Ajustes" description="Disciplinas, categorías, cuotas y datos del club." />

      <Panel
        title="Disciplinas y categorías"
        description="Ordená, agregá categorías y desactivá lo que ya no se usa."
        action={disciplines.length > 0 ? <NewDisciplineButton /> : undefined}
      >
        {disciplines.length === 0 ? (
          <EmptyState
            title="Cargá la primera disciplina"
            description="Después vas a poder agregarle categorías, ordenarla y desactivarla si hace falta."
            action={<NewDisciplineButton label="Cargar disciplina" />}
          />
        ) : (
          <ul aria-label="Disciplinas" className="flex flex-col divide-y divide-border">
            {disciplines.map((discipline, index) => (
              <DisciplineGroup key={discipline.id} discipline={discipline} position={index} siblingIds={disciplineIds} />
            ))}
          </ul>
        )}
      </Panel>

      <FeePricesSection
        feePrices={feePrices}
        billing={billing}
        disciplines={disciplines}
        categoriesByDiscipline={categoriesByDiscipline}
      />

      <BillingSection billing={billing} hasDefaultFeePrice={feePrices.current.default !== null} />

      <Panel title="Datos del club" description="El nombre que ve el club en todo el sistema.">
        <ClubSettingsForm settings={settings} />
      </Panel>
    </div>
  )
}
