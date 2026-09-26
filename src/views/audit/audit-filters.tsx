import { FilterBar, type FilterDef } from '@/views/shared/filter-bar'
import { SearchInput } from '@/views/shared/search-input'
import { AuditDateRangeFilter } from '@/views/audit/audit-date-range-filter'
import { AUDITED_TABLE_OPTIONS } from '@/views/audit/audit-labels'

/**
 * Filtros de /auditoria: tabla y usuario por `FilterBar` (select, spec:
 * "etiquetas en español"), rango de fechas por `AuditDateRangeFilter`, id de
 * registro reusando `SearchInput` con otro `paramName` (mismo debounce y
 * escritura en `searchParams` que la búsqueda de socios, sin reinventar
 * nada). No es un Client Component: solo compone otros que ya lo son.
 */
export function AuditFilters({ actorOptions }: { actorOptions: { value: string; label: string }[] }) {
  const filters: FilterDef[] = [
    { param: 'tableName', label: 'Tabla', options: AUDITED_TABLE_OPTIONS, placeholder: 'Todas las tablas' },
    { param: 'actorId', label: 'Usuario', options: actorOptions, placeholder: 'Todos los usuarios' },
  ]

  return (
    <div className="flex flex-col gap-3">
      <FilterBar filters={filters} />
      <div className="flex flex-wrap items-center gap-2">
        <AuditDateRangeFilter />
        <SearchInput paramName="recordId" placeholder="ID de registro" className="max-w-48" />
      </div>
    </div>
  )
}
