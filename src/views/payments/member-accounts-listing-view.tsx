import { PageHeader } from '@/views/shared/page-header'
import { FilterBar, type FilterDef } from '@/views/shared/filter-bar'
import { MemberAccountsList } from '@/views/payments/member-accounts-list'
import { type ListingVariant } from '@/views/payments/account-format'
import type { AccountListFilters, DisciplineWithCategories, MemberAccount, Page } from '@/models/types'

export type { ListingVariant }

const COPY: Record<ListingVariant, { title: string; description: string; emptyTitle: string; emptyDescription: string }> = {
  in_debt: {
    title: 'Con deuda',
    description: 'Socios que deben una o más cuotas, ordenados por meses adeudados.',
    emptyTitle: 'Nadie debe',
    emptyDescription: 'No hay socios con deuda para estos filtros.',
  },
  up_to_date: {
    title: 'Al día',
    description: 'Socios sin deuda, incluidos los que tienen saldo a favor.',
    emptyTitle: 'No hay socios al día',
    emptyDescription: 'Ningún socio está al día con estos filtros.',
  },
}

/**
 * `/cobranza/deuda` y `/cobranza/al-dia` (route-cobranza.md): mismo shape,
 * distinto filtro de `debt` (lo fija la page llamando a `getDebtListing`/
 * `getUpToDateListing`, y lo vuelve a fijar `MemberAccountsList` en cada
 * "Ver más" vía `loadMoreMemberAccounts`). `page` ya viene ordenado por meses
 * adeudados desc (`reports.model.ts`): la vista no reordena. Cero data
 * fetching acá (Server Component): la lista y su acumulado en "Ver más" son
 * responsabilidad de `MemberAccountsList` (Client Component).
 */
export function MemberAccountsListingView({
  variant,
  page,
  disciplines,
  filters,
}: {
  variant: ListingVariant
  page: Page<MemberAccount>
  disciplines: DisciplineWithCategories[]
  filters: Pick<AccountListFilters, 'categoryId' | 'status'>
}) {
  const copy = COPY[variant]
  const hasActiveFilter = filters.categoryId != null || filters.status === 'all'
  const categoryOptions = disciplines.flatMap((d) => d.categories.map((c) => ({ value: String(c.id), label: `${d.name} · ${c.name}` })))

  const filterDefs: FilterDef[] = [
    { param: 'categoriaId', label: 'Categoría', options: categoryOptions, placeholder: 'Todas las categorías' },
    {
      param: 'status',
      label: 'Estado',
      options: [{ value: 'all', label: 'Incluir dados de baja' }],
      placeholder: 'Solo activos',
    },
  ]

  // Filtros SIN cursor: sirven de `key` para remontar `MemberAccountsList`
  // con estado fresco cuando cambia un filtro real (mismo patrón que
  // `MemberListView`/`filtersKey`), y dejarlo montado (acumulando "Ver más")
  // entre renders con los mismos filtros.
  const filtersKey = JSON.stringify({ variant, ...filters })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={copy.title} description={copy.description} />
      <FilterBar filters={filterDefs} />
      <MemberAccountsList
        key={filtersKey}
        variant={variant}
        initialPage={page}
        filters={filters}
        emptyTitle={copy.emptyTitle}
        emptyDescription={hasActiveFilter ? 'No hay resultados con los filtros aplicados.' : copy.emptyDescription}
      />
    </div>
  )
}
