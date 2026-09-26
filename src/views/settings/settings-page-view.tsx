import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { DisciplineGroup } from '@/views/settings/discipline-group'
import { NewDisciplineButton } from '@/views/settings/new-discipline-button'
import { ClubSettingsForm } from '@/views/settings/club-settings-form'
import type { DisciplineWithCategories, Settings } from '@/models/types'

/**
 * `/ajustes`. Cero data fetching (CLAUDE.md): recibe `settings` y
 * `disciplines` ya resueltos por `getSettingsPage()` (Server Component,
 * `page.tsx`). Server Component en sí mismo — el estado interactivo vive en
 * los islands hijos (`DisciplineGroup`, `ClubSettingsForm`, etc.), lo más
 * abajo posible del árbol.
 *
 * "Valores de cuota" (slice 2) NO tiene lugar en esta página todavía: el
 * spec pide explícitamente que no haya un botón muerto apuntando a algo que
 * no existe. No hay panel reservado ni placeholder — se agrega cuando el
 * slice 2 lo necesite.
 */
export function SettingsPageView({
  settings,
  disciplines,
}: {
  settings: Settings
  disciplines: DisciplineWithCategories[]
}) {
  const disciplineIds = disciplines.map((d) => d.id)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Ajustes" description="Disciplinas, categorías y datos del club." />

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

      <Panel title="Datos del club" description="El nombre que ve el club en todo el sistema.">
        <ClubSettingsForm settings={settings} />
      </Panel>
    </div>
  )
}
