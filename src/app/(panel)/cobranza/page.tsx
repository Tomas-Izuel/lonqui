import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getCobranzaHub } from '@/controllers/reports.controller'
import { CobranzaHubView } from '@/views/payments/cobranza-hub-view'

export const metadata: Metadata = { title: 'Cobranza — Club Naranja y Blanco' }

/**
 * Hub de `/cobranza` (route-cobranza.md). El buscador de socio ya no vive
 * acá: "Registrar pago" abre `PaymentOverlayHost` (`?pagar=buscar`), que
 * busca con su propio debounce (`MemberPicker`) — esta page ya no necesita
 * `getPadron` ni el `?q=` que antes reenviaba.
 */
export default async function CobranzaPage() {
  const session = await requirePanelPermission('payments.read')
  const hub = await getCobranzaHub()

  return <CobranzaHubView collection={hub.collection} billing={hub.billing} daily={hub.daily} permissions={session.permissions} />
}
