import { Panel } from '@/views/shared/panel'
import { DashboardHeader } from '@/views/dashboard/dashboard-header'
import { BillingInactiveNotice } from '@/views/dashboard/billing-inactive-notice'
import { RunFailedNotice } from '@/views/dashboard/run-failed-notice'
import { MoneySummaryStrip } from '@/views/dashboard/money-summary-strip'
import { MonthDetailRows } from '@/views/dashboard/month-rows'
import { DebtDetailRows, TopDebtorsList } from '@/views/dashboard/debt-rows'
import { PriorityExtras } from '@/views/dashboard/priority-extras'
import { HistoryChart } from '@/views/dashboard/history-chart'
import { HistoryTableHidden } from '@/views/dashboard/history-table'
import { PadronHeadlineRows, MedicalClearanceRows, CategoryList } from '@/views/dashboard/padron-rows'
import { shouldShowRunNotice } from '@/views/dashboard/dashboard-helpers'
import type { DashboardData, SessionInfo } from '@/models/types'

/**
 * Panel inicial definitivo (F3, fase 2). Contenido de "Qué hay que
 * resolver" — la composición que Tomás eligió el 2026-09-28 entre las 3
 * propuestas de la ronda `impeccable shape` (ver `.impeccable/surfaces/
 * route-inicio.md`, decisión registrada ahí). El nombre "variante B" de la
 * ronda de propuestas queda solo en ese documento histórico; acá es,
 * simplemente, el inicio.
 *
 * Después de la plata en una línea (`MoneySummaryStrip`), lo primero que se
 * lee no es un resumen sino una lista priorizada de pendientes con su
 * monto y su link: la generación fallida (si corresponde), a quién llamar
 * (los más atrasados) y el resto (deuda de bajas, aptos vencidos).
 * Responde primero "¿qué tengo que hacer hoy?", no "¿cómo estamos?".
 *
 * Cero data fetching (CLAUDE.md): recibe `data` y `session` ya resueltos
 * por `(panel)/page.tsx`.
 */
export function DashboardContent({ data, session, greeting }: { data: DashboardData; session: SessionInfo; greeting: string }) {
  const { summary, topDebtors, byCategory, history, billing } = data
  const canConfigureBilling = session.permissions.includes('billing.configure')
  const runNoticeVisible = shouldShowRunNotice(billing, session.permissions)
  const extras = summary.billingActive ? <PriorityExtras summary={summary} /> : null

  return (
    <div className="flex flex-col gap-5">
      <DashboardHeader greeting={greeting} permissions={session.permissions} />

      {!summary.billingActive ? (
        <Panel title="Cuotas">
          <BillingInactiveNotice canConfigure={canConfigureBilling} />
        </Panel>
      ) : (
        <>
          <MoneySummaryStrip summary={summary} />

          <Panel title="Qué hay que resolver">
            {runNoticeVisible ? <RunFailedNotice billing={billing} /> : null}
            <p className={runNoticeVisible ? 'mt-4 mb-2 text-sm font-medium' : 'mb-2 text-sm font-medium'}>
              Los socios más atrasados
            </p>
            <TopDebtorsList members={topDebtors} />
            {extras ? (
              <>
                <p className="mt-4 mb-2 text-sm font-medium">Otros pendientes</p>
                {extras}
              </>
            ) : null}
          </Panel>

          <Panel title="Este mes">
            <MonthDetailRows summary={summary} />
          </Panel>

          <Panel title="Deuda">
            <DebtDetailRows summary={summary} />
          </Panel>
        </>
      )}

      <Panel title="Evolución" description="Cobrado y deuda al cierre, últimos 12 meses">
        <HistoryChart points={history} />
        <HistoryTableHidden points={history} />
      </Panel>

      <Panel title="Padrón">
        <PadronHeadlineRows summary={summary} />
        <div className="my-4 border-t border-border" />
        <MedicalClearanceRows summary={summary} />
        <p className="mt-4 mb-2 text-sm font-medium">Socios y deuda por categoría</p>
        <CategoryList rows={byCategory} />
      </Panel>
    </div>
  )
}
