'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useHasPermission } from '@/views/shell/panel-session'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { MemberPicker } from '@/views/payments/member-picker'
import { RegisterPaymentSheetBody } from '@/views/payments/register-payment-sheet'
import { useOverlayParam, useCloseOverlay, parsePaymentOverlay } from '@/views/shared/overlay-params'
import { DURATION, EASE_ENTER, useMotionPreference } from '@/views/shared/motion'

const TITLES = { buscar: 'Registrar pago', socio: 'Registrar pago', grupo: 'Pago del grupo familiar' } as const

/**
 * Overlay global de cobranza (C7, pipeline 2026-09-28-ui-expresiva): un solo
 * host, montado una vez en el shell del panel (F-shell), que lee `?pagar=` y
 * decide qué mostrar. Los cuatro puntos de entrada (inicio, hub de cobranza,
 * ficha del socio, fila del padrón) nunca navegan — todos escriben el mismo
 * query param con `useOverlayParam('pagar')` (C2) y esto se prende encima de
 * donde ya estaban.
 *
 * Búsqueda → cobrar es UN SOLO `ResponsiveSheet` (nunca se cierra y reabre):
 * lo que cambia es el contenido de adentro, con `AnimatePresence` animando la
 * transición entre "buscar" (`MemberPicker`) y "socio:id"/"grupo:id"
 * (`RegisterPaymentSheetBody`) — la sensación es la de un asistente de un
 * paso al siguiente, no la de dos pantallas distintas.
 */
export function PaymentOverlayHost(): React.ReactElement | null {
  const { value } = useOverlayParam('pagar')
  const close = useCloseOverlay('pagar')
  const { pick } = useMotionPreference()
  const canRegister = useHasPermission('payments.register')
  const open = parsePaymentOverlay(value) !== null

  // Al cerrar, el param desaparece de la URL antes de que termine la
  // animación de salida: se sigue mostrando el último contenido válido para
  // que el sheet se vaya con su contenido y no vacío o de golpe.
  const [lastValue, setLastValue] = useState(value)
  if (open && value !== lastValue) setLastValue(value)
  const target = parsePaymentOverlay(open ? value : lastValue)

  // Solo oculta la interfaz: el permiso real lo vuelven a chequear la
  // Server Action y las RLS. Consulta nunca ve un formulario que no puede usar.
  if (!target || !canRegister) return null

  const stepKey =
    target.mode === 'buscar' ? 'buscar' : target.mode === 'socio' ? `socio-${target.memberId}` : `grupo-${target.familyGroupId}`

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      title={TITLES[target.mode]}
      footer={null}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stepKey}
          initial={pick({ opacity: 0, x: 16 }, { opacity: 0 })}
          animate={{ opacity: 1, x: 0 }}
          exit={pick({ opacity: 0, x: -16 }, { opacity: 0 })}
          transition={{ duration: DURATION.state, ease: EASE_ENTER }}
        >
          {target.mode === 'buscar' ? (
            <MemberPicker />
          ) : (
            <RegisterPaymentSheetBody
              memberId={target.mode === 'socio' ? target.memberId : undefined}
              familyGroupId={target.mode === 'grupo' ? target.familyGroupId : undefined}
              onDone={close}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </ResponsiveSheet>
  )
}
