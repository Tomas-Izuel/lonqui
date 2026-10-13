import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { IncomeConceptRow } from '@/views/settings/income-concept-row'
import { NewIncomeConceptButton } from '@/views/settings/new-income-concept-button'
import type { CashConcept } from '@/models/types'

/**
 * Panel "Conceptos de ingreso": igual que disciplinas y categorías (subir/
 * bajar, editar, desactivar). Nunca se borra un concepto: uno desactivado deja
 * de ofrecerse pero los ingresos viejos lo siguen mostrando.
 */
export function IncomeConceptsSection({ concepts }: { concepts: CashConcept[] }) {
  const ordered = [...concepts].sort((a, b) => a.sortOrder - b.sortOrder)
  const ids = ordered.map((c) => c.id)

  return (
    <Panel
      title="Conceptos de ingreso"
      description="Lo que se elige al registrar un ingreso que no es cuota: sponsor, donación, indumentaria…"
      action={ordered.length > 0 ? <NewIncomeConceptButton /> : undefined}
    >
      {ordered.length === 0 ? (
        <EmptyState
          title="Cargá el primer concepto de ingreso"
          description="Sin conceptos no se pueden registrar otros ingresos. Podés marcar los que piden un sponsor."
          action={<NewIncomeConceptButton label="Cargar concepto" />}
        />
      ) : (
        <ul aria-label="Conceptos de ingreso" className="flex flex-col divide-y divide-border">
          {ordered.map((concept, index) => (
            <IncomeConceptRow key={concept.id} concept={concept} position={index} siblingIds={ids} />
          ))}
        </ul>
      )}
    </Panel>
  )
}
