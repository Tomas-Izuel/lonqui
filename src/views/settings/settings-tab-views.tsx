import { Panel } from '@/views/shared/panel'
import { EmptyState, LoadingList } from '@/views/shared/states'
import { DisciplineGroup } from '@/views/settings/discipline-group'
import { NewDisciplineButton } from '@/views/settings/new-discipline-button'
import { ClubSettingsForm } from '@/views/settings/club-settings-form'
import { FeePricesSection } from '@/views/settings/fee-prices-section'
import { BillingSection } from '@/views/settings/billing-section'
import { IncomeConceptsSection } from '@/views/settings/income-concepts-section'
import type { BillingStatus, CashConcept, DisciplineWithCategories, FeePricesOverview, Settings } from '@/models/types'

/*
 * Una vista por pestaña de `/ajustes`. Cero data fetching: reciben todo de la
 * page (Server Component). `gap-6` entre paneles, el mismo ritmo que
 * `/usuarios` y `/auditoria`.
 */

export function CuotasTabView({
  feePrices,
  billing,
  disciplines,
  categoriesByDiscipline,
}: {
  feePrices: FeePricesOverview
  billing: BillingStatus
  disciplines: DisciplineWithCategories[]
  categoriesByDiscipline: DisciplineWithCategories[]
}) {
  return (
    <div className="flex flex-col gap-6">
      <FeePricesSection
        feePrices={feePrices}
        billing={billing}
        disciplines={disciplines}
        categoriesByDiscipline={categoriesByDiscipline}
      />
      <BillingSection billing={billing} hasDefaultFeePrice={feePrices.current.default !== null} />
    </div>
  )
}

export function DeportesTabView({ disciplines }: { disciplines: DisciplineWithCategories[] }) {
  const disciplineIds = disciplines.map((d) => d.id)
  return (
    <div className="flex flex-col gap-6">
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
    </div>
  )
}

export function CajaTabView({ incomeConcepts }: { incomeConcepts: CashConcept[] }) {
  return (
    <div className="flex flex-col gap-6">
      <IncomeConceptsSection concepts={incomeConcepts} />
    </div>
  )
}

export function ClubTabView({ settings }: { settings: Settings }) {
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Datos del club" description="El nombre que ve el club en todo el sistema.">
        <ClubSettingsForm settings={settings} />
      </Panel>
    </div>
  )
}

/** Esqueleto por pestaña: mismos títulos de panel que la vista real, para que no salte el layout. */
export function SettingsTabLoading({ panels }: { panels: { title: string; rows: number }[] }) {
  return (
    <div className="flex flex-col gap-6">
      {panels.map((panel) => (
        <Panel key={panel.title} title={panel.title}>
          <LoadingList rows={panel.rows} />
        </Panel>
      ))}
    </div>
  )
}
