import { describe, expect, it } from 'vitest'
import {
  IDLE,
  TOUCH_ARM_MS,
  TOUCH_MOVE_TOLERANCE_PX,
  dragReduce,
  type DragEvent,
  type DragState,
  type DragStep,
  type PointerKind,
} from '@/views/payments/month-drag'

/**
 * Máquina de estados pura del arrastre (00-architecture §7.3). Sin DOM: la
 * interacción real de punteros (touch, scroll, captura) NO se prueba acá, queda
 * en la verificación manual de §11. Se prueba la regla: cuándo se arma, qué
 * rango emite y cuándo el `click` posterior es un toque y cuándo se descarta.
 */
function run(events: DragEvent[], from: DragState = IDLE): { state: DragState; log: DragStep['effects'][] } {
  let state = from
  const log: DragStep['effects'][] = []
  for (const e of events) {
    const r = dragReduce(state, e)
    state = r.state
    log.push(r.effects)
  }
  return { state, log }
}
const flat = (log: DragStep['effects'][]) => log.flat()
const down = (index: number, pointerType: PointerKind, x = 100, y = 100): DragEvent => ({ type: 'down', index, pointerType, x, y })
const ranges = (log: DragStep['effects'][]) => flat(log).filter((e) => e.type === 'range')

describe('constantes', () => {
  it('mantener apretado 250 ms y tolerancia de 8 px (lo que promete el spec)', () => {
    expect(TOUCH_ARM_MS).toBe(250)
    expect(TOUCH_MOVE_TOLERANCE_PX).toBe(8)
  })
})

describe('mouse y lápiz', () => {
  for (const kind of ['mouse', 'pen'] as const) {
    it(`${kind}: down queda pendiente, sin temporizador y sin rango`, () => {
      const r = dragReduce(IDLE, down(2, kind))
      expect(r.state).toMatchObject({ phase: 'pending', anchor: 2, pointerType: kind })
      expect(r.effects).toEqual([{ type: 'timer', on: false }])
    })

    it(`${kind}: se arma al entrar en OTRA celda y emite el rango (ancla, celda)`, () => {
      const { state, log } = run([down(2, kind), { type: 'enter', index: 5 }])
      expect(state).toMatchObject({ phase: 'dragging', anchor: 2, over: 5 })
      expect(log[1]).toEqual([{ type: 'arm' }, { type: 'range', anchor: 2, over: 5 }])
    })

    it(`${kind}: volver a entrar en la celda inicial NO arma (sigue siendo un toque)`, () => {
      const { state, log } = run([down(2, kind), { type: 'enter', index: 2 }])
      expect(state.phase).toBe('pending')
      expect(flat(log).some((e) => e.type === 'arm' || e.type === 'range')).toBe(false)
    })

    it(`${kind}: soltar sin arrastrar es un toque: el click NO se descarta`, () => {
      const { state, log } = run([down(2, kind), { type: 'up' }])
      expect(state).toEqual(IDLE)
      expect(flat(log).some((e) => e.type === 'suppressClick')).toBe(false)
    })

    it(`${kind}: la selección sigue en vivo celda por celda, también hacia atrás`, () => {
      const { log } = run([down(4, kind), { type: 'enter', index: 6 }, { type: 'enter', index: 7 }, { type: 'enter', index: 1 }])
      expect(ranges(log)).toEqual([
        { type: 'range', anchor: 4, over: 6 },
        { type: 'range', anchor: 4, over: 7 },
        { type: 'range', anchor: 4, over: 1 },
      ])
    })

    it(`${kind}: repetir la misma celda no emite rango de nuevo`, () => {
      const { log } = run([down(4, kind), { type: 'enter', index: 6 }, { type: 'enter', index: 6 }])
      expect(ranges(log)).toHaveLength(1)
    })

    it(`${kind}: soltar tras arrastrar vuelve a idle y descarta el click que sigue`, () => {
      const { state, log } = run([down(0, kind), { type: 'enter', index: 3 }, { type: 'up' }])
      expect(state).toEqual(IDLE)
      expect(log[2]).toEqual([{ type: 'suppressClick' }])
    })

    it(`${kind}: el movimiento no hace nada (la tolerancia es solo del dedo)`, () => {
      const r = run([down(0, kind), { type: 'move', x: 500, y: 500 }])
      expect(r.state.phase).toBe('pending')
    })
  }

  it('el evento armed (temporizador) es ignorado con mouse', () => {
    const { state, log } = run([down(0, 'mouse'), { type: 'armed' }])
    expect(state.phase).toBe('pending')
    expect(flat(log).some((e) => e.type === 'arm')).toBe(false)
  })
})

describe('dedo', () => {
  it('down arranca el temporizador de mantener apretado', () => {
    const r = dragReduce(IDLE, down(3, 'touch'))
    expect(r.state).toMatchObject({ phase: 'pending', anchor: 3, pointerType: 'touch' })
    expect(r.effects).toEqual([{ type: 'timer', on: true }])
  })

  it('entrar en otra celda antes de armar NO arma: el dedo solo arma por mantener apretado', () => {
    const { state, log } = run([down(3, 'touch'), { type: 'enter', index: 5 }])
    expect(state.phase).toBe('pending')
    expect(flat(log).some((e) => e.type === 'arm' || e.type === 'range')).toBe(false)
  })

  it('moverse dentro de la tolerancia (justo 8 px) sigue pendiente', () => {
    const { state } = run([down(3, 'touch', 100, 100), { type: 'move', x: 108, y: 100 }])
    expect(state.phase).toBe('pending')
  })

  it('moverse un pixel más allá de la tolerancia es scroll: vuelve a idle y apaga el temporizador', () => {
    const r = run([down(3, 'touch', 100, 100), { type: 'move', x: 100, y: 109 }])
    expect(r.state).toEqual(IDLE)
    expect(r.log[1]).toEqual([{ type: 'timer', on: false }])
  })

  it('la tolerancia es distancia, no por eje: 6 px + 6 px (≈8,5) ya es scroll', () => {
    expect(run([down(3, 'touch', 100, 100), { type: 'move', x: 106, y: 106 }]).state).toEqual(IDLE)
  })

  it('tras descartar por scroll, un armed tardío no arma nada', () => {
    const { state, log } = run([down(3, 'touch'), { type: 'move', x: 300, y: 300 }, { type: 'armed' }])
    expect(state).toEqual(IDLE)
    expect(flat(log).some((e) => e.type === 'arm')).toBe(false)
  })

  it('armed: pasa a arrastrando y emite arm, pero NO un rango de una celda (un toque lento sigue siendo toque)', () => {
    const r = run([down(3, 'touch'), { type: 'armed' }])
    expect(r.state).toMatchObject({ phase: 'dragging', anchor: 3, over: 3, pointerType: 'touch' })
    expect(r.log[1]).toEqual([{ type: 'arm' }])
    expect(ranges(r.log)).toHaveLength(0)
  })

  it('mantener apretado y soltar en la MISMA celda: sin rango y el click NO se descarta (cuenta como tocar)', () => {
    const { state, log } = run([down(3, 'touch'), { type: 'armed' }, { type: 'up' }])
    expect(state).toEqual(IDLE)
    expect(ranges(log)).toHaveLength(0)
    expect(flat(log).some((e) => e.type === 'suppressClick')).toBe(false)
  })

  it('armado, el primer rango sale recién al entrar en OTRA celda', () => {
    const { log } = run([down(3, 'touch'), { type: 'armed' }, { type: 'enter', index: 3 }, { type: 'enter', index: 6 }])
    expect(ranges(log)).toEqual([{ type: 'range', anchor: 3, over: 6 }])
  })

  it('armado y arrastrado: soltar descarta el click que sigue', () => {
    const { state, log } = run([down(3, 'touch'), { type: 'armed' }, { type: 'enter', index: 6 }, { type: 'up' }])
    expect(state).toEqual(IDLE)
    expect(log[3]).toEqual([{ type: 'suppressClick' }])
  })

  it('armado, mover el dedo ya no descarta (el scroll lo bloquea el hook): sigue arrastrando', () => {
    const { state } = run([down(3, 'touch', 100, 100), { type: 'armed' }, { type: 'move', x: 400, y: 400 }])
    expect(state.phase).toBe('dragging')
  })

  it('armado, entrar y volver a la celda inicial: el rango vuelve a (ancla, ancla) y el click se descarta', () => {
    const { log, state } = run([down(3, 'touch'), { type: 'armed' }, { type: 'enter', index: 5 }, { type: 'enter', index: 3 }, { type: 'up' }])
    expect(ranges(log)).toEqual([
      { type: 'range', anchor: 3, over: 5 },
      { type: 'range', anchor: 3, over: 3 },
    ])
    expect(flat(log).filter((e) => e.type === 'suppressClick')).toHaveLength(1)
    expect(state).toEqual(IDLE)
  })

  it('soltar antes de armar es un toque normal: apaga el temporizador y no descarta el click', () => {
    const { state, log } = run([down(3, 'touch'), { type: 'up' }])
    expect(state).toEqual(IDLE)
    expect(log[1]).toEqual([{ type: 'timer', on: false }])
  })
})

describe('cancel, down repetido y eventos sueltos', () => {
  it('pointercancel durante el arrastre: vuelve a idle y NO emite nada más (deja la selección aplicada)', () => {
    const { state, log } = run([down(0, 'mouse'), { type: 'enter', index: 4 }, { type: 'cancel' }])
    expect(state).toEqual(IDLE)
    expect(log[2]).toEqual([{ type: 'timer', on: false }])
    expect(ranges([log[2]])).toHaveLength(0)
  })

  it('cancel estando pendiente con dedo apaga el temporizador', () => {
    const r = run([down(0, 'touch'), { type: 'cancel' }])
    expect(r.state).toEqual(IDLE)
    expect(r.log[1]).toContainEqual({ type: 'timer', on: false })
  })

  it('un down siempre reinicia: un up perdido no deja un arrastre colgado', () => {
    const { state } = run([down(0, 'mouse'), { type: 'enter', index: 4 }, down(7, 'mouse')])
    expect(state).toMatchObject({ phase: 'pending', anchor: 7 })
  })

  it('eventos en idle no hacen nada ni inventan estado', () => {
    for (const e of [{ type: 'move', x: 1, y: 1 }, { type: 'armed' }, { type: 'enter', index: 3 }, { type: 'up' }] as DragEvent[]) {
      const r = dragReduce(IDLE, e)
      expect(r.state).toEqual(IDLE)
      expect(r.effects).toEqual([])
    }
  })

  it('enter fuera de las celdas (null) no cambia nada, ni pendiente ni arrastrando', () => {
    const pending = run([down(2, 'mouse'), { type: 'enter', index: null }])
    expect(pending.state.phase).toBe('pending')
    const dragging = run([down(2, 'mouse'), { type: 'enter', index: 4 }, { type: 'enter', index: null }])
    expect(dragging.state).toMatchObject({ phase: 'dragging', over: 4 })
    expect(ranges([dragging.log[2]])).toHaveLength(0)
  })

  it('es pura: no muta el estado de entrada', () => {
    const s: DragState = { phase: 'pending', anchor: 1, pointerType: 'mouse', startX: 0, startY: 0 }
    const snap = JSON.stringify(s)
    dragReduce(s, { type: 'enter', index: 4 })
    expect(JSON.stringify(s)).toBe(snap)
  })
})
