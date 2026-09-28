import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getMonthPaymentsPage } from '@/controllers/payments.controller'
import { getMonthCollection } from '@/models/reports.model'
import { toPeriod } from '@/lib/dates'
import { MonthPaymentsView } from '@/views/payments/month-payments-view'

export const metadata: Metadata = { title: 'Pagos del mes — Club Naranja y Blanco' }

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const PERIOD_RE = /^\d{4}-\d{2}$/

/**
 * `/cobranza/pagos?mes=YYYY-MM`. `getMonthCollection` es una lectura plana de
 * `reports.model.ts` (sin nada que orquestar): mismo criterio ya usado en
 * `/socios/page.tsx` con `getBillingStatus()` directo desde el modelo.
 */
export default async function MonthPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const session = await requirePanelPermission('payments.read')

  const mesRaw = firstValue(sp.mes)
  const period = mesRaw && PERIOD_RE.test(mesRaw) ? `${mesRaw}-01` : toPeriod()

  const [page, collection] = await Promise.all([getMonthPaymentsPage(period), getMonthCollection(period)])

  return (
    <MonthPaymentsView
      period={period}
      collection={collection}
      page={page}
      canVoid={session.permissions.includes('payments.void')}
    />
  )
}
