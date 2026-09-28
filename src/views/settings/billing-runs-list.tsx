import { ChevronDown } from 'lucide-react'
import { DateTimeText } from '@/views/shared/date-text'
import { StatusPill, type StatusPillVariant } from '@/views/shared/status-pill'
import type { BillingRun, BillingRunStatus } from '@/models/types'

/**
 * Etiquetas propias de esta sección (no en `views/shared/labels.ts`: ese
 * archivo no es mío en esta tarea — CLAUDE.md, ownership de F4).
 */
const RUN_STATUS_LABEL: Record<BillingRunStatus, string> = {
  ok: 'Correcta',
  error: 'Con error',
  skipped: 'Sin cuotas que generar',
}

/** Reusa las variantes que ya tiene `StatusPill`: no hay una propia para "corrida", así que se toma prestado el semáforo verde/rojo/neutro. */
const RUN_STATUS_VARIANT: Record<BillingRunStatus, StatusPillVariant> = {
  ok: 'up-to-date',
  error: 'in-debt',
  skipped: 'member-inactive',
}

function feesCreatedLabel(count: number): string {
  return `${count} ${count === 1 ? 'cuota creada' : 'cuotas creadas'}`
}

/**
 * "Últimas corridas" plegado (T1, route-ajustes.md). Puede tener filas aunque
 * la facturación no esté activa todavía: el cron registra una fila `skipped`
 * igual (00-architecture.md §6.4), así que esta lista vive fuera del `if`
 * activo/inactivo de `BillingSection`.
 */
export function BillingRunsList({ runs }: { runs: BillingRun[] }) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span>Últimas corridas</span>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="border-t border-border px-3">
        {runs.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">Todavía no corrió ninguna generación.</p>
        ) : (
          <ul aria-label="Últimas corridas de generación" className="flex flex-col divide-y divide-border">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <DateTimeText instant={run.startedAt} className="font-medium" />
                    <span className="text-muted-foreground">· {run.trigger === 'cron' ? 'Automática' : (run.actorName ?? 'Manual')}</span>
                  </div>
                  <StatusPill variant={RUN_STATUS_VARIANT[run.status]}>{RUN_STATUS_LABEL[run.status]}</StatusPill>
                </div>
                <p className="text-xs text-muted-foreground">{feesCreatedLabel(run.feesCreated)}</p>
                {run.errorMessage ? <p className="text-xs text-status-in-debt">{run.errorMessage}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
