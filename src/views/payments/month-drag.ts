/**
 * Máquina de estados pura del arrastre sobre la grilla de meses (00-architecture §7.3).
 * Sin React ni DOM: el hook `use-month-drag` traduce punteros a eventos y ejecuta
 * los efectos; acá vive solo la regla, para probarla en Node.
 *
 *   idle → pending (pointerdown sobre una celda) → dragging (armado) → idle
 *
 * - Mouse/lápiz: se arma al entrar en OTRA celda con el botón apretado.
 * - Dedo: se arma por mantener apretado (`TOUCH_ARM_MS`) sin moverse más de
 *   `TOUCH_MOVE_TOLERANCE_PX`; si se mueve antes es scroll y se descarta, así
 *   la grilla no secuestra el scroll del sheet.
 */

export type PointerKind = 'mouse' | 'touch' | 'pen'

export const TOUCH_ARM_MS = 250
export const TOUCH_MOVE_TOLERANCE_PX = 8

export type DragState =
  | { phase: 'idle' }
  | { phase: 'pending'; anchor: number; pointerType: PointerKind; startX: number; startY: number }
  /** `moved`: ya salió de la celda inicial (hubo `range`). Armado por mantener apretado sin moverse = `false`. */
  | { phase: 'dragging'; anchor: number; over: number; pointerType: PointerKind; moved: boolean }

export type DragEvent =
  | { type: 'down'; index: number; pointerType: PointerKind; x: number; y: number }
  /** Movimiento del puntero (sirve para la tolerancia del dedo antes de armar). */
  | { type: 'move'; x: number; y: number }
  /** Venció el temporizador de mantener apretado. */
  | { type: 'armed' }
  /** El puntero pasó a estar sobre la celda `index` (`null` = fuera de las celdas). */
  | { type: 'enter'; index: number | null }
  | { type: 'up' }
  | { type: 'cancel' }

export type DragEffect =
  /** La selección en vivo: el ancla y la celda sobre la que está el puntero. */
  | { type: 'range'; anchor: number; over: number }
  /** Recién armado: el hook captura el puntero, bloquea el scroll y vibra. */
  | { type: 'arm' }
  | { type: 'timer'; on: boolean }
  /** Terminó un arrastre: el `click` que sigue no es un toque. */
  | { type: 'suppressClick' }

export type DragStep = { state: DragState; effects: DragEffect[] }

export const IDLE: DragState = { phase: 'idle' }

function step(state: DragState, effects: DragEffect[] = []): DragStep {
  return { state, effects }
}

export function dragReduce(state: DragState, event: DragEvent): DragStep {
  switch (event.type) {
    case 'down': {
      // Un `down` siempre reinicia: un `up` perdido (soltó fuera de la ventana) no deja nada colgado.
      const next: DragState = { phase: 'pending', anchor: event.index, pointerType: event.pointerType, startX: event.x, startY: event.y }
      return step(next, [{ type: 'timer', on: event.pointerType === 'touch' }])
    }

    case 'move': {
      if (state.phase !== 'pending' || state.pointerType !== 'touch') return step(state)
      const moved = Math.hypot(event.x - state.startX, event.y - state.startY)
      // Se movió antes de armar: es scroll, no arrastre.
      if (moved > TOUCH_MOVE_TOLERANCE_PX) return step(IDLE, [{ type: 'timer', on: false }])
      return step(state)
    }

    case 'armed': {
      if (state.phase !== 'pending' || state.pointerType !== 'touch') return step(state)
      const next: DragState = { phase: 'dragging', anchor: state.anchor, over: state.anchor, pointerType: 'touch', moved: false }
      // Armar solo bloquea el scroll y vibra: un toque lento sobre la misma celda sigue siendo un toque
      // (lo resuelve el `click` del botón), no un rango de una celda.
      return step(next, [{ type: 'arm' }])
    }

    case 'enter': {
      if (event.index === null) return step(state)
      if (state.phase === 'pending') {
        // El dedo no arma por moverse: solo por mantener apretado.
        if (state.pointerType === 'touch' || event.index === state.anchor) return step(state)
        const next: DragState = { phase: 'dragging', anchor: state.anchor, over: event.index, pointerType: state.pointerType, moved: true }
        return step(next, [{ type: 'arm' }, { type: 'range', anchor: state.anchor, over: event.index }])
      }
      if (state.phase === 'dragging' && event.index !== state.over) {
        return step({ ...state, over: event.index, moved: true }, [{ type: 'range', anchor: state.anchor, over: event.index }])
      }
      return step(state)
    }

    case 'up': {
      // Sin haber salido de la celda inicial no hubo `range`: el `click` es un toque y no se descarta.
      if (state.phase === 'dragging') return step(IDLE, state.moved ? [{ type: 'suppressClick' }] : [])
      // Sin arrastre es un toque normal: el `click` del botón hace el resto.
      return step(IDLE, state.phase === 'pending' ? [{ type: 'timer', on: false }] : [])
    }

    case 'cancel':
      // `pointercancel` deja lo que hubiera: la selección en vivo ya está aplicada.
      return step(IDLE, [{ type: 'timer', on: false }])
  }
}
