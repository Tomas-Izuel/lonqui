import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/views/shared/page-header'
import { SearchInput } from '@/views/shared/search-input'
import { FilterBar, type FilterDef } from '@/views/shared/filter-bar'
import { MemberList } from '@/views/members/member-list'
import type { BillingStatus, DisciplineWithCategories, MemberFilters, MemberSummary, Page, Permission } from '@/models/types'

/**
 * Vista del padrón. Cero data fetching (CLAUDE.md): todo llega resuelto de
 * `page.tsx`, que solo carga la primera tanda. `SearchInput`/`FilterBar` leen
 * `searchParams` por su cuenta; `MemberList` (Client Component) acumula
 * "Ver más" llamando `loadMoreMembers` — ver su comentario para el porqué.
 *
 * `permissions`, nunca `role` (T12, CLAUDE.md): qué se muestra lo decide el
 * catálogo de permisos de la sesión.
 */
export function MemberListView({
  page,
  disciplines,
  permissions,
  filters,
  billing,
}: {
  page: Page<MemberSummary>
  disciplines: DisciplineWithCategories[]
  permissions: Permission[]
  filters: MemberFilters
  billing: BillingStatus
}) {
  const canCreate = permissions.includes('members.write')
  const canSeeDebt = permissions.includes('payments.read')
  const hasActiveFilter = Boolean(
    filters.q ||
      filters.categoryId != null ||
      filters.disciplineId != null ||
      filters.memberType ||
      (filters.debt && filters.debt !== 'any') ||
      (filters.status && filters.status !== 'active'),
  )

  const categoryOptions = disciplines.flatMap((d) =>
    d.categories.map((c) => ({ value: String(c.id), label: `${d.name} · ${c.name}` })),
  )

  const filterDefs: FilterDef[] = [
    {
      param: 'disciplineId',
      label: 'Disciplina',
      options: disciplines.map((d) => ({ value: String(d.id), label: d.name })),
      placeholder: 'Todas las disciplinas',
    },
    { param: 'categoryId', label: 'Categoría', options: categoryOptions, placeholder: 'Todas las categorías' },
    {
      param: 'memberType',
      label: 'Tipo',
      options: [
        { value: 'practicing', label: 'Practicante' },
        { value: 'non_practicing', label: 'No practicante' },
      ],
      placeholder: 'Todos los tipos',
    },
    {
      param: 'status',
      label: 'Estado',
      options: [
        { value: 'inactive', label: 'Dados de baja' },
        { value: 'all', label: 'Todos' },
      ],
      placeholder: 'Activos',
    },
    {
      param: 'debt',
      label: 'Condición de deuda',
      options: [
        { value: 'up_to_date', label: 'Al día' },
        { value: 'in_debt', label: 'Con deuda' },
      ],
      placeholder: 'Cualquiera',
      disabledReason: !canSeeDebt
        ? 'No tenés permiso para ver la deuda'
        : !billing.active
          ? 'Disponible cuando se activen las cuotas'
          : undefined,
    },
  ]

  // Filtros SIN cursor (parseFilters de la page nunca lo agrega): sirven de
  // `key` para remontar `MemberList` con estado fresco cuando cambia un
  // filtro real, y dejarlo montado (acumulando "Ver más") entre renders con
  // los mismos filtros — mismo patrón que `AuditList` en /auditoria.
  const filtersKey = JSON.stringify(filters)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Socios"
        description="Buscá por nombre o DNI, o filtrá por categoría y estado."
        action={
          canCreate ? (
            <Button asChild className="h-11">
              <Link href="/socios/nuevo">
                <Plus aria-hidden />
                Ficha de ingreso
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3">
        <SearchInput placeholder="Buscar por nombre o DNI…" />
        <FilterBar filters={filterDefs} />
      </div>

      <MemberList key={filtersKey} initialPage={page} filters={filters} canCreate={canCreate} hasActiveFilter={hasActiveFilter} />
    </div>
  )
}
