'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { IDLE, TOUCH_ARM_MS, dragReduce, type DragEffect, type DragEvent, type DragState, type PointerKind } from '@/views/payments/month-drag'

/** Tras un arrastre el navegador igual dispara un `click`: se descarta si llega dentro de esta ventana. */
const CLICK_SUPPRESS_MS = 350

function indexAt(x: number, y: number): number | null {
  // Con touch el target del evento queda en la celda inicial: hay que preguntar qué hay bajo el dedo.
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-month-index]')
  if (!el) return null
  const index = Number(el.dataset.monthIndex)
  return Number.isInteger(index) ? index : null
}

function kindOf(pointerType: string): PointerKind {
  return pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse'
}

/**
 * Capa de punteros del arrastre sobre la grilla de meses. La regla vive en
 * `month-drag.ts`; esto solo traduce eventos del DOM y ejecuta los efectos.
 * Los handlers van en el `<ul>` y cada celda lleva `data-month-index`.
 *
 * Scroll en touch: las celdas usan `touch-action: pan-y`, así que antes de armar
 * el navegador scrollea normal (y manda `pointercancel`). Al armar, un listener
 * NATIVO `touchmove` no pasivo hace `preventDefault`: el de React es pasivo.
 */
export function useMonthDrag({
  onRange,
  onDragStart,
  enabled,
}: {
  onRange: (anchor: number, over: number) => void
  /** Se arma el arrastre: es el momento de guardar la selección base sobre la que se va a pintar. */
  onDragStart?: (anchor: number) => void
  enabled: boolean
}) {
  const [list, setList] = useState<HTMLUListElement | null>(null)
  const captureElRef = useRef<HTMLUListElement | null>(null)
  const stateRef = useRef<DragState>(IDLE)
  const timerRef = useRef<number | undefined>(undefined)
  const suppressUntilRef = useRef(0)
  const lastIndexRef = useRef<number | null>(null)
  const onRangeRef = useRef(onRange)
  const onDragStartRef = useRef(onDragStart)
  const pointerIdRef = useRef<number | undefined>(undefined)
  const dispatchRef = useRef<(event: DragEvent) => void>(() => {})

  useEffect(() => {
    onRangeRef.current = onRange
    onDragStartRef.current = onDragStart
  })

  const run = useCallback((effects: DragEffect[], pointerId?: number) => {
    for (const effect of effects) {
      if (effect.type === 'range') onRangeRef.current(effect.anchor, effect.over)
      else if (effect.type === 'suppressClick') suppressUntilRef.current = performance.now() + CLICK_SUPPRESS_MS
      else if (effect.type === 'timer') {
        window.clearTimeout(timerRef.current)
        timerRef.current = undefined
        if (effect.on) timerRef.current = window.setTimeout(() => dispatchRef.current({ type: 'armed' }), TOUCH_ARM_MS)
      } else if (effect.type === 'arm') {
        // El reductor ya pasó a `dragging`: el ancla es la celda donde empezó el gesto.
        const current = stateRef.current
        if (current.phase === 'dragging') onDragStartRef.current?.(current.anchor)
        navigator.vibrate?.(10)
        if (pointerId !== undefined) {
          try {
            captureElRef.current?.setPointerCapture(pointerId)
          } catch {
            // El puntero ya no existe: el arrastre sigue por hit-test.
          }
        }
      }
    }
  }, [])

  const dispatch = useCallback(
    (event: DragEvent) => {
      const { state, effects } = dragReduce(stateRef.current, event)
      stateRef.current = state
      run(effects, pointerIdRef.current)
    },
    [run],
  )
  useEffect(() => {
    dispatchRef.current = dispatch
  })

  useEffect(() => {
    if (!enabled || !list) return
    function blockScroll(event: TouchEvent) {
      if (stateRef.current.phase === 'dragging' && event.cancelable) event.preventDefault()
    }
    function blockMenu(event: Event) {
      if (stateRef.current.phase !== 'idle') event.preventDefault()
    }
    list.addEventListener('touchmove', blockScroll, { passive: false })
    list.addEventListener('contextmenu', blockMenu)
    return () => {
      list.removeEventListener('touchmove', blockScroll)
      list.removeEventListener('contextmenu', blockMenu)
      window.clearTimeout(timerRef.current)
    }
  }, [enabled, list])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLUListElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const index = indexAt(event.clientX, event.clientY)
      if (index === null) return
      pointerIdRef.current = event.pointerId
      captureElRef.current = event.currentTarget
      lastIndexRef.current = index
      dispatch({ type: 'down', index, pointerType: kindOf(event.pointerType), x: event.clientX, y: event.clientY })
    },
    [dispatch],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLUListElement>) => {
      if (stateRef.current.phase === 'idle') return
      // Mouse sin botón apretado: el `up` se perdió fuera de la ventana.
      if (event.pointerType === 'mouse' && event.buttons === 0) {
        dispatch({ type: 'cancel' })
        return
      }
      dispatch({ type: 'move', x: event.clientX, y: event.clientY })
      const index = indexAt(event.clientX, event.clientY)
      if (index !== lastIndexRef.current) {
        lastIndexRef.current = index
        dispatch({ type: 'enter', index })
      }
    },
    [dispatch],
  )

  const onPointerUp = useCallback(() => dispatch({ type: 'up' }), [dispatch])
  const onPointerCancel = useCallback(() => dispatch({ type: 'cancel' }), [dispatch])

  /** Los botones lo llaman antes de `onTap`: `true` = el `click` es la cola de un arrastre. */
  const consumeClick = useCallback(() => {
    if (performance.now() > suppressUntilRef.current) return false
    suppressUntilRef.current = 0
    return true
  }, [])

  return {
    setList,
    consumeClick,
    listProps: enabled ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } : {},
  }
}
