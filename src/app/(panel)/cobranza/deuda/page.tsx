import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getDebtListing } from '@/controllers/reports.controller'
import { listDisciplines } from '@/models/catalogs.model'
import { MemberAccountsListingView } from '@/views/payments/member-accounts-listing-view'

export const metadata: Metadata = { title: 'Con deuda — Club Naranja y Blanco' }

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function DebtListingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  await requirePanelPermission('payments.read')

  const categoriaIdRaw = firstValue(sp.categoriaId)
  const categoryId = categoriaIdRaw && /^\d+$/.test(categoriaIdRaw) ? Number(categoriaIdRaw) : undefined
  const status = firstValue(sp.status) === 'all' ? 'all' : undefined

  const [page, disciplines] = await Promise.all([getDebtListing({ categoryId, status }), listDisciplines()])

  return (
    <MemberAccountsListingView variant="in_debt" page={page} disciplines={disciplines} filters={{ categoryId, status }} />
  )
}
