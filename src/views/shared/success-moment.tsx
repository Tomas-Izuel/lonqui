'use client'

import { motion } from 'motion/react'
import { CircleCheck } from 'lucide-react'
import { DURATION, SPRING_OVERLAY, useMotionPreference } from '@/views/shared/motion'
import { formatCentsCompact } from '@/lib/money'

/**
 * El único momento autorado de un flujo de carga rápida (`animate.md`: "un
 * solo momento por vista, nunca una pantalla de celebración que demore el
 * flujo más rápido del sistema"): un check y el monto, visibles el tiempo
 * justo para confirmar antes de que el overlay se cierre solo. Nunca
 * bloquea, y con movimiento reducido es un fade simple, sin el resorte.
 * Sirve a pagos ("Pago registrado") y a otros ingresos ("Ingreso registrado").
 */
export function SuccessMoment({ amountCents, label }: { amountCents: number; label: string }) {
  const { reduced, pick } = useMotionPreference()
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <motion.span
        initial={pick({ scale: 0.6, opacity: 0 }, { opacity: 0 })}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: DURATION.state } : SPRING_OVERLAY}
        className="flex size-14 items-center justify-center rounded-full bg-status-up-to-date/10 text-status-up-to-date"
      >
        <CircleCheck aria-hidden className="size-8" />
      </motion.span>
      <div className="flex flex-col gap-0.5">
        <p className="text-lg font-semibold tabular-nums">{formatCentsCompact(amountCents)}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
