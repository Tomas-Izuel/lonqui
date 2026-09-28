'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DateTimeText } from '@/views/shared/date-text'
import { auditOpLabels, memberStatusEventLabels } from '@/views/shared/labels'
import { auditFieldLabel, auditRecordPhrase } from '@/views/audit/audit-labels'
import type { AuditEntryDetail, MemberStatusEventType } from '@/models/types'

/**
 * Columnas técnicas que no le sirven a la Comisión (03-review.md, minor 13):
 * `search_text` es la columna derivada de búsqueda ("lucia ejemplo 30111222",
 * un DNI crudo sin ninguna razón para estar acá), `id`/`created_by`/
 * `uploaded_by` son uuids o ids internos sin traducción posible en esta
 * vista, y `updated_at`/`created_at` ya se muestran como la fecha del
 * movimiento en el encabezado del sheet.
 */
const HIDDEN_FIELDS = new Set(['id', 'search_text', 'created_by', 'uploaded_by', 'updated_at', 'created_at'])

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Filas con antes/después por campo. En INSERT no hay "antes" (fila nueva);
 * en UPDATE solo se muestran los campos que cambiaron (`changedFields`, ya
 * resuelto por `audit.model.ts`) — nunca el JSON crudo como interfaz
 * principal (anti-objetivo del brief route-auditoria.md).
 */
function detailRows(entry: AuditEntryDetail): { field: string; before: string; after: string }[] {
  const oldData = entry.oldData ?? {}
  const newData = entry.newData ?? {}
  const fields = entry.op === 'INSERT' ? Object.keys(newData) : (entry.changedFields ?? [])

  return fields
    .filter((field) => !HIDDEN_FIELDS.has(field))
    .map((field) => ({
      field: auditFieldLabel(entry.tableName, field),
      before: entry.op === 'INSERT' ? '—' : formatValue(oldData[field]),
      after: formatValue(newData[field]),
    }))
}

function AuditDetailSheetInner({ entry }: { entry: AuditEntryDetail }) {
  const [open, setOpen] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleOpenChange(next: boolean) {
    // El cierre visual es inmediato (estado local); la URL se limpia
    // después, así la animación de salida no espera a la navegación.
    setOpen(next)
    if (!next) {
      const params = new URLSearchParams(searchParams)
      params.delete('detalle')
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    }
  }

  const rows = detailRows(entry)
  const eventType =
    entry.tableName === 'member_status_events' && typeof entry.newData?.event_type === 'string'
      ? memberStatusEventLabels[entry.newData.event_type as MemberStatusEventType]
      : null

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          {/* `eventType` (Alta/Baja/Reactivación) manda cuando hay `newData`
              con `event_type`: es más preciso que el genérico "un movimiento
              de alta o baja" de `auditRecordPhrase` para esta tabla, porque
              acá SÍ tenemos el valor, a diferencia del listado. */}
          <SheetTitle>
            {auditOpLabels[entry.op]} {eventType ?? auditRecordPhrase(entry.tableName, entry.recordLabel)}
          </SheetTitle>
          <SheetDescription>
            <DateTimeText instant={entry.occurredAt} /> — {entry.actorName ?? 'Sistema'}
            {entry.recordId ? ` — registro #${entry.recordId}` : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este movimiento no tiene campos para mostrar.</p>
          ) : (
            rows.map((row) => (
              // Apilado (campo arriba, valores abajo): legible a 390px sin
              // scroll horizontal, no una tabla ancha (spec F3).
              <div key={row.field} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                <span className="text-sm font-medium">{row.field}</span>
                {entry.op === 'INSERT' ? (
                  <span className="text-sm tabular-nums">{row.after}</span>
                ) : (
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground line-through decoration-destructive/60 tabular-nums">{row.before}</span>
                    <span className="tabular-nums">{row.after}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Detalle expandible de /auditoria (searchParam `detalle`). `entry` llega ya
 * resuelto por `getAuditEntry` desde `page.tsx`: esta vista no hace fetch.
 * La `key` en `entry.id` remonta el sheet cuando se abre un registro
 * distinto sin haber cerrado el anterior (estado de apertura fresco).
 */
export function AuditDetailSheet({ entry }: { entry: AuditEntryDetail | null }) {
  if (!entry) return null
  return <AuditDetailSheetInner key={entry.id} entry={entry} />
}
