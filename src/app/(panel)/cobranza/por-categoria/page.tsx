import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getDebtByCategoryPage } from '@/controllers/reports.controller'
import { DebtByCategoryView } from '@/views/payments/debt-by-category-view'

export const metadata: Metadata = { title: 'Deuda por categoría — Lonqui' }

export default async function DebtByCategoryPage() {
  await requirePanelPermission('payments.read')
  const { rows, totalCents } = await getDebtByCategoryPage()

  return <DebtByCategoryView rows={rows} totalCents={totalCents} />
}
