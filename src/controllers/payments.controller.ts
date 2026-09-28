import 'server-only'

import { requirePanelPermission } from '@/controllers/session.controller'
import { getMonthPaymentsPage as getMonthPaymentsPageRows } from '@/models/payments.model'
import type { Page, PaymentListItem } from '@/models/types'

/**
 * Lecturas de pagos para Server Components.
 *
 * Mismo patrón que `getPadron`/`loadMoreMembers` en `members.controller.ts` /
 * `members.actions.ts`: la carga inicial de una page pasa por acá (redirige
 * si falta el permiso), y el "Ver más" es una Server Action
 * (`loadMoreMonthPayments`, en `payments.actions.ts`) que re-verifica con
 * `requirePermission` porque un redirect adentro de una action se tragaría
 * como error.
 */

/** Primera página de los pagos del mes (cursor null), para el listado de cobranza. */
export async function getMonthPaymentsPage(period: string): Promise<Page<PaymentListItem>> {
  await requirePanelPermission('payments.read')
  return getMonthPaymentsPageRows(period, null)
}
