'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { DateTimeText } from '@/views/shared/date-text'
import { EmptyState } from '@/views/shared/states'
import { Pagination } from '@/views/shared/pagination'
import { auditOpLabels } from '@/views/shared/labels'
import { auditFieldLabel, auditRecordName, auditRecordPhrase } from '@/views/audit/audit-labels'
import type { AuditEntry, Page } from '@/models/types'

type AccumulatedState = { items: AuditEntry[]; nextCursor: string | null; appliedCursor: string | null }

/**
 * Lista keyset de /auditoria con "Ver más" (spec: "miles de filas al año;
 * paginación por cursor"). El filtrado vive en `searchParams` (como
 * `FilterBar`/`SearchInput`), pero acumular páginas ahí perdería lo ya
 * cargado en cada "Ver más" — por eso este componente junta las páginas en
 * estado de React.
 *
 * `page`/`requestedCursor` llegan del Server Component (`page.tsx`): la vista
 * nunca hace fetch. `AuditPageView` (el padre) le pone a este componente una
 * `key` derivada de los filtros SIN el cursor, así que un cambio de filtro lo
 * remonta entero (estado fresco) y un cambio de solo el cursor ("Ver más")
 * lo deja montado — acá dentro, el ajuste de estado ocurre DURANTE el
 * render, mismo patrón que `SearchInput` (evita el `useEffect` de
 * sincronización y el warning de "cascading renders").
 */
export function AuditList({
  page,
  requestedCursor,
  hasActiveFilter,
}: {
  page: Page<AuditEntry>
  requestedCursor: string | null
  hasActiveFilter: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [state, setState] = useState<AccumulatedState>({
    items: page.items,
    nextCursor: page.nextCursor,
    appliedCursor: requestedCursor,
  })
  if (state.appliedCursor !== requestedCursor) {
    setState({
      items: requestedCursor ? [...state.items, ...page.items] : page.items,
      nextCursor: page.nextCursor,
      appliedCursor: requestedCursor,
    })
  }

  function detailHref(id: number): string {
    const params = new URLSearchParams(searchParams)
    params.set('detalle', String(id))
    return `${pathname}?${params.toString()}`
  }

  function handleLoadMore(cursor: string) {
    const params = new URLSearchParams(searchParams)
    params.set('cursor', cursor)
    router.replace(`${pathname}?${params.toString()}`)
  }

  const columns: DataListColumn<AuditEntry>[] = [
    { key: 'when', header: 'Fecha y hora', className: 'tabular-nums whitespace-nowrap', render: (e) => <DateTimeText instant={e.occurredAt} /> },
    { key: 'who', header: 'Quién', render: (e) => e.actorName ?? 'Sistema' },
    // El nombre del registro (`recordLabel`), no el id: "Ejemplo, Lucía", no
    // "#42" — el id queda para el detalle, secundario (finish review, fix 3).
    { key: 'what', header: 'Qué', render: (e) => auditRecordName(e.tableName, e.recordLabel) },
    { key: 'op', header: 'Operación', render: (e) => auditOpLabels[e.op] },
    {
      key: 'fields',
      header: 'Campos cambiados',
      render: (e) =>
        e.changedFields && e.changedFields.length > 0 ? e.changedFields.map((f) => auditFieldLabel(e.tableName, f)).join(', ') : '—',
    },
  ]

  function renderRow(e: AuditEntry): DataListRow {
    const fieldLabels = e.changedFields && e.changedFields.length > 0 ? e.changedFields.map((f) => auditFieldLabel(e.tableName, f)) : null
    return {
      title: e.actorName ?? 'Sistema',
      // "Modificó a Ejemplo, Lucía": el idioma del club, no la tabla ni el id
      // internos (finish review, fix 3). Los campos cambiados NO van acá:
      // `subtitle` es de una sola línea (`truncate` en `DataList`) y Presidencia
      // tiene que poder leer QUÉ cambió sin abrir la fila (finish review,
      // segundo pase) — van en `meta`, en su propia línea con `line-clamp-2`.
      subtitle: `${auditOpLabels[e.op]} ${auditRecordPhrase(e.tableName, e.recordLabel)}`,
      meta: (
        <>
          {fieldLabels ? <span className="line-clamp-2 w-full text-xs text-muted-foreground">{fieldLabels.join(', ')}</span> : null}
          <DateTimeText instant={e.occurredAt} className="text-xs text-muted-foreground" />
        </>
      ),
      href: detailHref(e.id),
    }
  }

  const emptyState = hasActiveFilter ? (
    <EmptyState title="Sin resultados para este filtro" description="Probá ampliar el rango de fechas o cambiar el filtro." />
  ) : (
    <EmptyState title="Todavía no hay movimientos" description="Cuando alguien cargue o modifique algo, va a aparecer acá." />
  )

  return (
    <div className="flex flex-col gap-3">
      <DataList items={state.items} getKey={(e) => e.id} columns={columns} renderRow={renderRow} emptyState={emptyState} />
      <Pagination nextCursor={state.nextCursor} onLoadMore={handleLoadMore} />
    </div>
  )
}
