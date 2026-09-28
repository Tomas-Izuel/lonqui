import { Panel } from '@/views/shared/panel'
import { CategoryDebtChart } from '@/views/payments/category-debt-chart'
import { DashboardHeader } from '@/views/dashboard/dashboard-header'
import { BillingInactiveNotice } from '@/views/dashboard/billing-inactive-notice'
import { RunFailedNotice } from '@/views/dashboard/run-failed-notice'
import { MoneySummaryStrip } from '@/views/dashboard/money-summary-strip'
import { TopDebtorsList } from '@/views/dashboard/debt-rows'
import { PriorityExtras } from '@/views/dashboard/priority-extras'
import { HistoryChart } from '@/views/dashboard/history-chart'
import { HistoryTableHidden } from '@/views/dashboard/history-table'
import { PadronHeadlineRows, MedicalClearanceRows } from '@/views/dashboard/padron-rows'
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
 * Después de la plata (`MoneySummaryStrip`: la única `HeroFigure` de la
 * página, "Deuda total", con el medidor de cobranza del mes y el desglose
 * efectivo/transferencia al lado, sobre `bg-brand-soft`), lo primero que se
 * lee no es un resumen sino una lista priorizada de pendientes con su monto y
 * su link: la generación fallida (si corresponde), a quién llamar (los más
 * atrasados, con entrada escalonada) y el resto (deuda de bajas, aptos
 * vencidos). Responde primero "¿qué tengo que hacer hoy?", no "¿cómo
 * estamos?". Orden final: plata → Qué hay que resolver → Evolución → Padrón.
 *
 * Pipeline 2026-09-28-ui-expresiva (queja de Tomás: "todo números, ni un
 * gráfico, ni una animación"): la cifra hero cuenta una vez por sesión
 * (`countUpKey`), el gráfico de evolución se dibuja una sola vez al montar
 * (`useChartEntrance`, nunca en cada hover) y "socios y deuda por categoría"
 * pasó de una columna de números a `CategoryDebtChart` (barra de magnitud).
 *
 * Ronda 2 (revisión del coordinador sobre capturas reales a 390/1440 con
 * datos de demo): se borraron los `Panel`s "Este mes" y "Deuda" enteros —
 * repetían la plata que ya se ve arriba ("81 socios deben" salía en el hero
 * Y en "Deuda"; "Deuda de socios dados de baja" salía en "Otros pendientes"
 * Y en "Deuda"; efectivo/transferencia ya viven en el desglose del hero).
 * Ver `02-development-frontend-inicio.md` para el detalle completo.
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
        <CategoryDebtChart rows={byCategory} variant="compact" />
      </Panel>
    </div>
  )
}
