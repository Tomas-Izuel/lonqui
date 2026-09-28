'use client'

import { useEffect, useRef, useState } from 'react'
import { animate, useReducedMotion } from 'motion/react'

/**
 * Vocabulario de movimiento único del panel (pipeline 2026-09-28-ui-expresiva,
 * D5). Todo componente que anime algo toma de acá la duración y la curva: si
 * cada vista inventa las suyas, el panel se siente armado a pedazos.
 *
 * Escala (impeccable `animate.md`, superficie Operate):
 * - `feedback` — respuesta a un toque (presionar, hover, check).
 * - `state` — cambio de estado dentro de la misma vista (pestaña, filtro,
 *   paso de "buscar" a "cobrar" dentro del overlay).
 * - `overlay` — entrada/salida de sheets y diálogos, layout.
 * - `focal` — el único momento autorado por vista (dibujo de un gráfico,
 *   conteo de la cifra principal la primera vez). Nunca en algo rutinario.
 *
 * En segundos, que es lo que espera `motion`.
 */
export const DURATION = { feedback: 0.12, state: 0.2, overlay: 0.35, focal: 0.6 } as const

/** Llegada: arranca rápido y se asienta, sin rebote (nada de bounce/elastic en Operate). */
export const EASE_ENTER = [0.16, 1, 0.3, 1] as const
/** Salida: más corta y acelerando — lo que se va no se queda mirando. */
export const EASE_EXIT = [0.4, 0, 1, 1] as const

/** Sheets que se sueltan o se cierran con el gesto. */
export const SPRING_OVERLAY = { type: 'spring', stiffness: 380, damping: 32 } as const
/** Indicadores que viajan entre destinos (nav activa, pestaña activa) con `layoutId`. */
export const SPRING_INDICATOR = { type: 'spring', stiffness: 500, damping: 40 } as const

/** Techo del escalonado de listas: pasado este total, la última fila espera de más. */
export const STAGGER = { step: 0.04, maxItems: 8 } as const

/** Delay de la fila `index` en una lista escalonada, con techo (las filas de más entran juntas). */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER.maxItems) * STAGGER.step
}

/**
 * Preferencia de movimiento del sistema. Reducido no es apagado: se sigue
 * animando opacidad y color, se saca el desplazamiento espacial (drag,
 * escalonado con traslación, gráficos que se dibujan). `pick(full, reduced)`
 * evita repetir el mismo `if` en cada componente.
 */
export function useMotionPreference(): { reduced: boolean; pick: <T>(full: T, reduced: T) => T } {
  const reduced = useReducedMotion() ?? false
  return { reduced, pick: (full, reducedValue) => (reduced ? reducedValue : full) }
}

function readFlag(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    // Modo privado o storage bloqueado: sin bandera, se anima; no es crítico.
    return false
  }
}

function writeFlag(key: string) {
  try {
    window.sessionStorage.setItem(key, '1')
  } catch {
    // Idem: si no se puede guardar, la próxima visita vuelve a contar. Aceptable.
  }
}

/**
 * Cuenta de 0 a `target` UNA sola vez por sesión del navegador y por `key`
 * (D5): Tesorería abre el inicio muchas veces por día y no tiene por qué
 * esperar la misma coreografía cada vez (`operate.md`). La primera apertura
 * del día se siente viva; las siguientes muestran el número de una.
 *
 * Devuelve el valor a mostrar en cada frame. En el servidor y en el primer
 * render del cliente devuelve `target` (sin desajuste de hidratación ni un
 * "$ 0" que parpadee si el JS tarda); la cuenta arranca en el efecto.
 * Con movimiento reducido no cuenta nunca.
 */
export function useCountUpOnce(target: number, key: string | undefined): number {
  // `null` = no se está contando: se muestra `target` tal cual. El estado solo
  // se escribe desde los callbacks de la animación, nunca directo en el efecto.
  const [frame, setFrame] = useState<number | null>(null)
  const { reduced } = useMotionPreference()
  const started = useRef(false)

  useEffect(() => {
    if (!key || reduced || started.current) return
    started.current = true
    if (readFlag(key)) return
    writeFlag(key)
    const controls = animate(0, target, {
      duration: DURATION.focal * 1.5,
      ease: EASE_ENTER,
      onUpdate: (latest) => setFrame(Math.round(latest)),
      onComplete: () => setFrame(null),
    })
    return () => {
      controls.stop()
      setFrame(null)
    }
  }, [target, key, reduced])

  return frame ?? target
}
