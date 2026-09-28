'use server'

import { requirePermission } from '@/controllers/session.controller'
import { failure, invalid, success, type ActionResult } from '@/lib/action-result'
import { zodToApiError } from '@/lib/errors'
import { listMemberAccounts, loadMoreMemberAccountsSchema } from '@/models/reports.model'
import type { MemberAccount, Page } from '@/models/types'

/**
 * "Cargar más" de los listados paginados de `/cobranza` (con deuda, al día):
 * mismo patrón que `loadMoreMembers` (`members.actions.ts`) y
 * `loadMoreMonthPayments` (`payments.actions.ts`) — `requirePermission`
 * primero (T12, nunca por rol), después `schema.safeParse` (el input viene de
 * un Client Component, así que se valida en el borde), después el modelo.
 *
 * Un solo permiso (`payments.read`) alcanza para los dos listados que la
 * consumen: `getDebtListing` y `getUpToDateListing` ya piden ese mismo
 * permiso en `reports.controller.ts` para la primera página, así que esta
 * Server Action no reabre una puerta que la primera página no tuviera.
 *
 * La regla "al día incluye saldo a favor" vive en `listMemberAccounts`
 * (`reports.model.ts`), no acá: esta action no sabe qué significa cada
 * `debt_status`, solo reenvía el filtro que F1 le pasa.
 */
export async function loadMoreMemberAccounts(input: unknown): Promise<ActionResult<Page<MemberAccount>>> {
  try {
    await requirePermission('payments.read')

    const parsed = loadMoreMemberAccountsSchema.safeParse(input)
    if (!parsed.success) {
      const { body } = zodToApiError(parsed.error)
      return invalid(body.error, body.field)
    }

    const page = await listMemberAccounts(parsed.data)
    return success(page)
  } catch (err) {
    return failure(err, 'reports.loadMoreMemberAccounts')
  }
}
