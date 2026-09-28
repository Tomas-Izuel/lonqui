import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getCobranzaHub } from '@/controllers/reports.controller'
import { getPadron } from '@/controllers/members.controller'
import { CobranzaHubView } from '@/views/payments/cobranza-hub-view'

export const metadata: Metadata = { title: 'Cobranza — Club Naranja y Blanco' }

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Hub de `/cobranza` (route-cobranza.md). El buscador de socio (visible solo
 * con `payments.register`) escribe `?q=` con el mismo `SearchInput` que
 * `/socios` — no hay combobox propio: reusa `getPadron` (controller de
 * lectura de B3, ya pensado para Server Components), el mismo mecanismo que
 * ya resuelve "retomar después de una interrupción" en el resto del panel.
 * `status: 'all'` a propósito: un socio de baja con deuda también se busca
 * acá para cobrarle (D14).
 */
export default async function CobranzaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const session = await requirePanelPermission('payments.read')
  const q = firstValue(sp.q)?.trim() || undefined

  const canSearch = session.permissions.includes('payments.register')

  const [hub, searchResults] = await Promise.all([
    getCobranzaHub(),
    canSearch && q ? getPadron({ q, status: 'all', limit: 8 }) : Promise.resolve(null),
  ])

  return (
    <CobranzaHubView
      collection={hub.collection}
      billing={hub.billing}
      permissions={session.permissions}
      q={q}
      searchResults={searchResults ? searchResults.items : null}
    />
  )
}
