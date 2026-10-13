'use client'

import { useState } from 'react'
import { useHasPermission } from '@/views/shell/panel-session'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { useOverlayParam, useCloseOverlay, parseIncomeOverlay } from '@/views/shared/overlay-params'
import { IncomeFormBody } from '@/views/income/income-form-body'

/**
 * Overlay global de "Registrar otro ingreso": un solo host montado en el
 * shell (junto a `PaymentOverlayHost`) que lee `?ingreso=nuevo|sponsor:<id>`.
 * Abre y cierra por `history` igual que pagos, así "atrás" en el celular lo
 * cierra y un deep-link se cierra con `replace`.
 */
export function IncomeOverlayHost(): React.ReactElement | null {
  const { value } = useOverlayParam('ingreso')
  const close = useCloseOverlay('ingreso')
  const canRegister = useHasPermission('income.register')
  const open = parseIncomeOverlay(value) !== null

  // Al cerrar, el param desaparece de la URL antes de que termine la
  // animación de salida: se sigue mostrando el último contenido válido.
  const [lastValue, setLastValue] = useState(value)
  if (open && value !== lastValue) setLastValue(value)
  const target = parseIncomeOverlay(open ? value : lastValue)

  // Solo oculta la interfaz: el permiso real lo vuelven a chequear la Server
  // Action y las RLS. Consulta nunca ve un formulario que no puede usar.
  if (!target || !canRegister) return null

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title="Registrar otro ingreso"
      footer={null}
    >
      {/* `key`: cada apertura arranca con un formulario nuevo (y un `batchId` nuevo). */}
      <IncomeFormBody key={value ?? lastValue ?? 'nuevo'} sponsorId={target.sponsorId} onDone={close} />
    </ResponsiveSheet>
  )
}
