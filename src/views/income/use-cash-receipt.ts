'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { getCashReceiptUrlAction } from '@/controllers/income.actions'

/**
 * "Ver comprobante": la URL firmada (60 s) se pide recién al tocar, nunca se
 * guarda ni se muestra. Se abre una pestaña en el mismo gesto del toque y
 * después se le asigna la URL: si se esperara a la respuesta para abrirla, el
 * bloqueador de popups del celular la frenaría. Mismo patrón que
 * `MonthPaymentsList.handleViewReceipt`.
 */
export function useCashReceipt(): { openingId: number | null; open: (movementId: number) => Promise<void> } {
  const [openingId, setOpeningId] = useState<number | null>(null)

  async function open(movementId: number) {
    setOpeningId(movementId)
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null

    try {
      const result = await getCashReceiptUrlAction({ movementId })
      if (!result.ok) {
        popup?.close()
        toast.error(result.error)
        return
      }
      if (!result.data.url) {
        popup?.close()
        toast.error('Este ingreso no tiene comprobante cargado')
        return
      }
      if (popup) popup.location.href = result.data.url
      else window.location.href = result.data.url
    } catch {
      popup?.close()
      toast.error('No pudimos abrir el comprobante. Probá de nuevo.')
    } finally {
      setOpeningId(null)
    }
  }

  return { openingId, open }
}
