'use client'

import type { ActionResult } from '@/lib/action-result'
import { openPendingTab } from '@/views/portal/whatsapp-tab'
import type { IssuedPortalToken, PortalTokenDelivery } from '@/models/types'

const NO_PHONE_ERROR = 'No hay un teléfono cargado para mandar el mensaje por WhatsApp. Elegí el QR en pantalla o cargá el teléfono en la ficha.'
const NETWORK_ERROR = 'No pudimos completar la operación. Revisá tu conexión e intentá de nuevo.'

/**
 * Emite un enlace y, si la entrega es por WhatsApp, abre `wa.me` en la pestaña
 * que se reservó en el mismo gesto del clic (ver `whatsapp-tab.ts`).
 */
export async function issueOpeningWhatsApp(
  delivery: PortalTokenDelivery,
  issue: () => Promise<ActionResult<IssuedPortalToken>>,
): Promise<{ result: ActionResult<IssuedPortalToken>; opened: boolean }> {
  const tab = delivery === 'whatsapp' ? openPendingTab() : null

  let result: ActionResult<IssuedPortalToken>
  try {
    result = await issue()
  } catch {
    result = { ok: false, error: NETWORK_ERROR }
  }

  if (!result.ok) {
    tab?.close()
    return { result, opened: false }
  }

  // El backend ya no emite nada cuando no hay teléfono para WhatsApp (tira un error antes),
  // así que esto es solo defensa: sin enlace no hay nada que abrir ni nada vivo que limpiar.
  if (delivery === 'whatsapp' && !result.data.whatsappUrl) {
    tab?.close()
    return { result: { ok: false, error: NO_PHONE_ERROR }, opened: false }
  }

  const opened = tab && result.data.whatsappUrl ? tab.navigate(result.data.whatsappUrl) : false
  if (tab && !opened) tab.close()
  return { result, opened }
}
