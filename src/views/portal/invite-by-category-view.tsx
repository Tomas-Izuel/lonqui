import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { InviteTargetList } from '@/views/portal/invite-target-list'
import type { DisciplineWithCategories, PortalInviteTarget } from '@/models/types'

/**
 * `/socios/invitar`: elegir una categoría y ver quién no tiene cuenta, con un
 * botón de WhatsApp por fila. El selector es un formulario GET a propósito
 * (la categoría es un id, no un dato personal) para que la lista sea
 * enlazable y funcione sin JavaScript.
 */
export function InviteByCategoryView({
  disciplines,
  categoryId,
  targets,
}: {
  disciplines: DisciplineWithCategories[]
  categoryId: number | null
  /** `null` mientras no se eligió una categoría. */
  targets: PortalInviteTarget[] | null
}) {
  const hasCategories = disciplines.some((d) => d.categories.length > 0)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Invitar por categoría"
        description="Los grupos y socios de una categoría que todavía no tienen cuenta en la app. Cada mensaje lo mandás vos desde WhatsApp."
        action={
          <Button asChild variant="outline">
            <Link href="/socios/revision">Ir a Revisión</Link>
          </Button>
        }
      />

      <Panel>
        <form method="get" action="/socios/invitar" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="categoria" className="text-sm font-medium">
              Categoría
            </label>
            <select
              id="categoria"
              name="categoria"
              defaultValue={categoryId != null ? String(categoryId) : ''}
              required
              autoComplete="off"
              disabled={!hasCategories}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                Elegí una categoría
              </option>
              {disciplines.map((discipline) =>
                discipline.categories.length > 0 ? (
                  <optgroup key={discipline.id} label={discipline.name}>
                    {discipline.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
          </div>
          <Button type="submit" disabled={!hasCategories}>
            Ver quién falta
          </Button>
        </form>
      </Panel>

      {targets == null ? (
        <Panel>
          <EmptyState
            title="Elegí una categoría"
            description="Te mostramos los grupos familiares y socios que todavía no tienen cuenta, para invitarlos de a uno."
          />
        </Panel>
      ) : (
        <InviteTargetList key={categoryId ?? 'none'} targets={targets} />
      )}
    </div>
  )
}
