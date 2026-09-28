import type { Metadata } from 'next'
import { getAuditPage, getAuditEntry, listAuditActorOptions } from '@/controllers/audit.controller'
import { AUDITED_TABLES } from '@/models/audit.model'
import { PageHeader } from '@/views/shared/page-header'
import { AuditFilters } from '@/views/audit/audit-filters'
import { AuditList } from '@/views/audit/audit-list'
import { AuditDetailSheet } from '@/views/audit/audit-detail-sheet'
import type { AuditedTable, AuditFilters as AuditFiltersInput } from '@/models/types'

export const metadata: Metadata = { title: 'Auditoría — Club Naranja y Blanco' }

// Blocker B1 (03-review.md, tercera pasada): las tres tablas de cobranza
// (fee_prices/fees/payments) ya aparecen en el select de `audit-labels.ts`
// pero acá se validaban contra un Set propio desatualizado —quedado en las 8
// tablas del slice 1— y ese filtro nunca hacía match. Una sola fuente
// (`AUDITED_TABLES` del modelo) para no volver a desincronizar las dos listas.
const AUDITED_TABLE_SET = new Set<string>(AUDITED_TABLES)

type RawSearchParams = Record<string, string | string[] | undefined>

function readParam(sp: RawSearchParams, key: string): string | undefined {
  const value = sp[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Solo lectura (spec F3). `getAuditPage`/`getAuditEntry` ya exigen `admin`
 * (`requireRole` adentro, antes de tocar la base — B3 dev log): no hace
 * falta repetir el chequeo acá. El filtro "quién" se alimenta de
 * `listAuditActorOptions()` (03-review.md, minor 8): antes usaba
 * `listUsers()`, que pagina la Admin API de Auth con la secret key en cada
 * render de esta page solo para armar un select — innecesario y acopla
 * `/auditoria` al controller de usuarios.
 *
 * El detalle vive en el searchParam `detalle` (no una ruta `/auditoria/[id]`):
 * así el filtro, la página del listado y el registro abierto quedan en la
 * misma URL, compartible y recargable, mismo principio que `FilterBar`.
 */
export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams

  const tableNameParam = readParam(sp, 'tableName')
  const filters: AuditFiltersInput = {
    tableName: tableNameParam && AUDITED_TABLE_SET.has(tableNameParam) ? (tableNameParam as AuditedTable) : undefined,
    actorId: readParam(sp, 'actorId'),
    from: readParam(sp, 'from'),
    to: readParam(sp, 'to'),
    recordId: readParam(sp, 'recordId'),
    cursor: readParam(sp, 'cursor') ?? null,
    limit: 30,
  }

  const detailIdParam = readParam(sp, 'detalle')
  const detailId = detailIdParam && /^\d+$/.test(detailIdParam) ? Number(detailIdParam) : null

  const [page, entry, actors] = await Promise.all([
    getAuditPage(filters),
    detailId ? getAuditEntry(detailId) : Promise.resolve(null),
    listAuditActorOptions(),
  ])

  const actorOptions = actors
    .map((a) => ({ value: a.userId, label: a.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))

  const hasActiveFilter = Boolean(filters.tableName || filters.actorId || filters.from || filters.to || filters.recordId)
  // Reinicia lo acumulado por "Ver más" cuando cambia CUALQUIER filtro (no
  // el cursor): ver el comentario en `AuditList` sobre por qué esto vive en
  // la `key` de React en vez de un `useEffect`.
  const filtersKey = JSON.stringify([filters.tableName, filters.actorId, filters.from, filters.to, filters.recordId])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Auditoría" description="Quién tocó qué, y cuándo. Solo lectura." />
      <AuditFilters actorOptions={actorOptions} />
      <AuditList key={filtersKey} page={page} requestedCursor={filters.cursor ?? null} hasActiveFilter={hasActiveFilter} />
      <AuditDetailSheet entry={entry} />
    </div>
  )
}
