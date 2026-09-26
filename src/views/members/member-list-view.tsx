import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/views/shared/page-header'
import { SearchInput } from '@/views/shared/search-input'
import { FilterBar, type FilterDef } from '@/views/shared/filter-bar'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { EmptyState } from '@/views/shared/states'
import { MemberStatusPill } from '@/views/shared/status-pill'
import { Dni } from '@/views/shared/dni'
import { memberTypeLabels } from '@/views/shared/labels'
import { MedicalClearanceNotice } from '@/views/members/medical-clearance-notice'
import { MembersPagination } from '@/views/members/members-pagination'
import type { AppRole, DisciplineWithCategories, MemberFilters, MemberSummary, Page } from '@/models/types'

function categoryLabel(member: MemberSummary): string {
  if (member.memberType === 'non_practicing') return memberTypeLabels.non_practicing
  if (!member.categoryName) return 'Sin categoría'
  return member.disciplineName ? `${member.disciplineName} · ${member.categoryName}` : member.categoryName
}

/**
 * Vista del padrón. Cero data fetching (CLAUDE.md): todo llega resuelto de
 * `page.tsx`. `SearchInput`/`FilterBar`/`MembersPagination` son los únicos
 * Client Components — leen `searchParams` por su cuenta, así que no
 * necesitan que esta vista les pase el valor actual.
 */
export function MemberListView({
  page,
  pageCount,
  disciplines,
  role,
  filters,
}: {
  page: Page<MemberSummary>
  pageCount: number
  disciplines: DisciplineWithCategories[]
  role: AppRole
  filters: MemberFilters
}) {
  const canCreate = role === 'admin' || role === 'editor'
  const hasActiveFilter = Boolean(
    filters.q ||
      filters.categoryId != null ||
      filters.disciplineId != null ||
      filters.memberType ||
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
      disabledReason: 'Disponible cuando se activen las cuotas',
    },
  ]

  const columns: DataListColumn<MemberSummary>[] = [
    { key: 'name', header: 'Nombre', render: (m) => m.fullName },
    { key: 'dni', header: 'DNI', render: (m) => <Dni dni={m.dni} />, numeric: true },
    { key: 'category', header: 'Categoría', render: (m) => categoryLabel(m) },
    { key: 'status', header: 'Estado', render: (m) => <MemberStatusPill status={m.status} /> },
    { key: 'medical', header: 'Apto físico', render: (m) => <MedicalClearanceNotice status={m.medicalClearanceStatus} /> },
  ]

  function renderRow(m: MemberSummary): DataListRow {
    return {
      title: m.fullName,
      subtitle: (
        <span className="flex flex-wrap items-center gap-2">
          <Dni dni={m.dni} />
          <span>{categoryLabel(m)}</span>
        </span>
      ),
      meta: (
        <span className="flex flex-col items-end gap-1">
          <MemberStatusPill status={m.status} />
          <MedicalClearanceNotice status={m.medicalClearanceStatus} />
        </span>
      ),
      href: `/socios/${m.id}`,
    }
  }

  const emptyState = hasActiveFilter ? (
    <EmptyState
      title="No encontramos socios"
      description={
        filters.q
          ? `No hay resultados para "${filters.q}" con los filtros aplicados.`
          : 'Ningún socio coincide con los filtros aplicados.'
      }
    />
  ) : (
    <EmptyState
      title="Todavía no hay socios cargados"
      description="Cargá la primera ficha de ingreso para empezar el padrón."
      action={
        canCreate ? (
          <Button asChild>
            <Link href="/socios/nuevo">Cargar ficha de ingreso</Link>
          </Button>
        ) : undefined
      }
    />
  )

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

      <DataList items={page.items} getKey={(m) => m.id} columns={columns} renderRow={renderRow} emptyState={emptyState} />

      <MembersPagination nextCursor={page.nextCursor} currentPages={pageCount} />
    </div>
  )
}
