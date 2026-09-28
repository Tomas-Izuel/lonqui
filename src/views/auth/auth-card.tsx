'use client'

import { motion } from 'motion/react'
import { DURATION, EASE_ENTER, useMotionPreference } from '@/views/shared/motion'

/**
 * Envoltorio de la tarjeta de `/login` y `/cambiar-contrasena` (pipeline
 * 2026-09-28-ui-expresiva, F-polish): el único momento autorado de esta
 * superficie (animate.md, "Operate: un momento que la superficie se ganó")
 * es la llegada de la tarjeta blanca sobre la banda de marca, una sola vez
 * por montaje — nunca se repite mientras se escribe o se corrige un error,
 * porque `initial`/`animate` de un componente `motion` solo corren al montar,
 * no en cada re-render del mismo formulario. Con movimiento reducido, sin
 * desplazamiento: solo el fundido (animate.md, accesibilidad).
 *
 * `'use client'` queda acá, no en `AuthLayout` (CLAUDE.md, "empujar
 * 'use client' lo más abajo posible"): el layout sigue siendo Server
 * Component y `children` (las pages de `/login` y `/cambiar-contrasena`,
 * también Server Components) se renderizan en el servidor antes de pasar
 * como children a este wrapper cliente.
 */
export function AuthCard({ children }: { children: React.ReactNode }) {
  const { pick } = useMotionPreference()

  return (
    <motion.div
      initial={{ opacity: 0, y: pick(12, 0) }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.overlay, ease: EASE_ENTER }}
      className="-mt-8 rounded-2xl border border-border bg-card p-6 shadow-lifted"
    >
      {children}
    </motion.div>
  )
}
