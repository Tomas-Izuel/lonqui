'use client'

import { motion } from 'motion/react'
import { DURATION, EASE_ENTER, useMotionPreference } from '@/views/shared/motion'

/**
 * Llegada del bloque del formulario de `/login` y `/cambiar-contrasena`: un
 * único fundido con un leve asentamiento, una sola vez por montaje (los
 * `initial`/`animate` de `motion` no se repiten al re-renderizar mientras se
 * escribe o se corrige un error). Con movimiento reducido, sin desplazamiento.
 * Ya no hay tarjeta: el nombre quedó por compatibilidad con el layout.
 *
 * `'use client'` queda acá y no en `AuthLayout`, que sigue siendo Server
 * Component; las pages entran como `children` ya renderizados en el servidor.
 */
export function AuthCard({ children }: { children: React.ReactNode }) {
  const { pick } = useMotionPreference()

  return (
    <motion.div
      initial={{ opacity: 0, y: pick(8, 0) }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.overlay, ease: EASE_ENTER }}
    >
      {children}
    </motion.div>
  )
}
