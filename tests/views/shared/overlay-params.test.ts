import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * `overlay-params.ts` (pipeline 2026-09-28-ui-expresiva, C2): overlays
 * direccionables por URL. Las funciones puras (parseo, click plano) viven en
 * `overlay-values.ts` (sin `'use client'`, las importa también un Server
 * Component) y se prueban ahí de origen. Los hooks
 * (`useOverlayParam`/`useCloseOverlay`) dependen de `next/navigation` y de
 * `window.history.state` — se mockean los dos en el borde externo y se
 * "renderiza" el hook con `react-dom/server` (no hace falta jsdom para
 * `useCallback`, que solo necesita un render real para no tirar "Invalid
 * hook call").
 *
 * Contrato post-fix de `code-reviewer` (race real, verificado en un
 * navegador de verdad por el hilo principal): `set()` YA NO escribe la marca
 * de forma sincrónica/en un microtask — solo dejaba constancia de qué
 * overlay abrió esta pestaña con `pendingMark` a nivel de módulo. Quien
 * ESCRIBE la marca en `history.state` es un `useEffect` dentro de
 * `useOverlayParam`, que corre en el próximo render una vez que `value` ya
 * refleja el param (después de que el router de Next confirmó la
 * navegación). `react-dom/server` (`renderToStaticMarkup`) NO ejecuta
 * efectos —es una limitación real, no un descuido—, así que estos tests no
 * pueden reproducir "abrir con set() Y QUE LA MARCA QUEDE ESCRITA" de punta a
 * punta: eso lo verificó a mano el hilo principal en un navegador real (ver
 * `03-tests.md`). Lo que SÍ se prueba acá, sin jsdom:
 * - `set()` llama a `push`/`replace` con el href correcto (la mitad
 *   sincrónica, sin marca).
 * - `useCloseOverlay` reacciona correctamente a los DOS estados posibles de
 *   `history.state` que el efecto puede haber dejado (marcado → `back()`;
 *   no marcado, deep link o recarga → `replace()`), simulando ese estado a
 *   mano en vez de esperar que el efecto lo escriba.
 *
 * Para poder correr el efecto de verdad (y no solo sus dos extremos) hace
 * falta `jsdom`/`happy-dom` como `environment` de estos archivos en
 * `vitest.config.ts` más `@testing-library/react` (`render` + `act`) para
 * disparar el commit con efectos — ninguno de los dos está instalado hoy. No
 * los instalé (no me corresponde); lo dejo dicho para quien lo necesite.
 */

let mockSearchParams = new URLSearchParams()
let mockPathname = '/socios'
const pushMock = vi.fn()
const replaceMock = vi.fn()
const backMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: backMock }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}))

const { useOverlayParam, useCloseOverlay } = await import('@/views/shared/overlay-params')

// Funciones puras: importadas de su origen real (`overlay-values.ts`), no del
// re-export de `overlay-params.ts` — así el test sigue valiendo si algún día
// el re-export cambia o desaparece.
const { parsePaymentOverlay, paymentOverlayValue, parseQuickViewParam, isPlainLeftClick, parseIncomeOverlay, incomeOverlayValue } = await import(
  '@/views/shared/overlay-values'
)

/** Estado de `window.history` simulado: lo que `markedBy`/`writeMark` leen y escriben. */
let historyState: Record<string, unknown> | null = null

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  mockPathname = '/socios'
  historyState = null
  pushMock.mockClear()
  replaceMock.mockClear()
  backMock.mockClear()
  vi.stubGlobal('window', {
    history: {
      get state() {
        return historyState
      },
      replaceState: (state: Record<string, unknown> | null) => {
        historyState = state
      },
    },
  })
})

/** Ejecuta `useHook` dentro de un componente real (sin DOM): hace falta para que `useCallback` no explote. */
function renderHook<T>(useHook: () => T): T {
  let captured!: T
  function TestComponent() {
    captured = useHook()
    return null
  }
  renderToStaticMarkup(React.createElement(TestComponent))
  return captured
}

describe('parsePaymentOverlay / paymentOverlayValue', () => {
  it('"buscar" → { mode: "buscar" }, ida y vuelta', () => {
    const target = parsePaymentOverlay('buscar')
    expect(target).toEqual({ mode: 'buscar' })
    expect(paymentOverlayValue(target!)).toBe('buscar')
  })

  it('"socio:12" → { mode: "socio", memberId: 12 }, ida y vuelta', () => {
    const target = parsePaymentOverlay('socio:12')
    expect(target).toEqual({ mode: 'socio', memberId: 12 })
    expect(paymentOverlayValue(target!)).toBe('socio:12')
  })

  it('"grupo:7" → { mode: "grupo", familyGroupId: 7 }, ida y vuelta', () => {
    const target = parsePaymentOverlay('grupo:7')
    expect(target).toEqual({ mode: 'grupo', familyGroupId: 7 })
    expect(paymentOverlayValue(target!)).toBe('grupo:7')
  })

  it('null, vacío, formas desconocidas o ids no numéricos/no positivos → null (nunca revienta)', () => {
    expect(parsePaymentOverlay(null)).toBeNull()
    expect(parsePaymentOverlay('')).toBeNull()
    expect(parsePaymentOverlay('otra-cosa')).toBeNull()
    expect(parsePaymentOverlay('socio:')).toBeNull()
    expect(parsePaymentOverlay('socio:abc')).toBeNull()
    expect(parsePaymentOverlay('socio:0')).toBeNull()
    expect(parsePaymentOverlay('socio:-5')).toBeNull()
  })
})

describe('parseQuickViewParam', () => {
  it('un id positivo entero parsea', () => {
    expect(parseQuickViewParam('42')).toBe(42)
  })

  it('null, vacío, no numérico, 0 o negativo → null', () => {
    expect(parseQuickViewParam(null)).toBeNull()
    expect(parseQuickViewParam('')).toBeNull()
    expect(parseQuickViewParam('abc')).toBeNull()
    expect(parseQuickViewParam('0')).toBeNull()
    expect(parseQuickViewParam('-3')).toBeNull()
    // Con signo o decimal: la regex de dígitos puros los rechaza.
    expect(parseQuickViewParam('12.5')).toBeNull()
    expect(parseQuickViewParam('+12')).toBeNull()
  })
})

describe('isPlainLeftClick', () => {
  function click(overrides: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) {
    return { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides } as React.MouseEvent
  }

  it('click izquierdo sin modificadores: true', () => {
    expect(isPlainLeftClick(click({}))).toBe(true)
  })

  it('botón del medio (nueva pestaña) o cualquier modificador: false, igual que next/link', () => {
    expect(isPlainLeftClick(click({ button: 1 }))).toBe(false)
    expect(isPlainLeftClick(click({ metaKey: true }))).toBe(false)
    expect(isPlainLeftClick(click({ ctrlKey: true }))).toBe(false)
    expect(isPlainLeftClick(click({ shiftKey: true }))).toBe(false)
    expect(isPlainLeftClick(click({ altKey: true }))).toBe(false)
  })
})

describe('useOverlayParam / useCloseOverlay: back vs. replace', () => {
  it('abrir con set(): empuja (push) el href correcto, SIN escribir la marca todavía (eso lo hace el efecto, en el próximo render)', () => {
    const overlay = renderHook(() => useOverlayParam('ver'))

    overlay.set('123')

    expect(pushMock).toHaveBeenCalledWith('/socios?ver=123', { scroll: false })
    expect(replaceMock).not.toHaveBeenCalled()
    // Sin efectos (renderToStaticMarkup no los corre), `history.state` queda
    // tal cual estaba: la escritura de la marca es responsabilidad del
    // `useEffect`, no de `set()`. Que el efecto la escriba de verdad está
    // verificado a mano en un navegador real (ver comentario de archivo).
    expect(historyState).toBeNull()
  })

  it('history.state YA tiene la marca de este overlay (el estado que el efecto deja tras un set() real): cerrar usa back()', () => {
    // Se simula el resultado del efecto en vez de correrlo: lo que prueba
    // este test es la reacción de `useCloseOverlay` a `history.state`
    // marcado, no que `set()` lo escriba (eso no se puede reproducir sin
    // jsdom/@testing-library — ver comentario de archivo).
    historyState = { __lonquiOverlay: 'ver' }
    mockSearchParams = new URLSearchParams('ver=123')

    const close = renderHook(() => useCloseOverlay('ver'))
    close()

    expect(backMock).toHaveBeenCalledOnce()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('el param ya viene en la URL al montar (deep link/recarga, sin marca en history.state): cerrar usa replace(), nunca back()', () => {
    // `history.state` sigue en null: nadie de ESTA pestaña abrió el overlay.
    mockSearchParams = new URLSearchParams('ver=123')

    const close = renderHook(() => useCloseOverlay('ver'))
    close()

    expect(backMock).not.toHaveBeenCalled()
    expect(replaceMock).toHaveBeenCalledWith('/socios', { scroll: false })
  })

  it('abrir un overlay con el otro ya abierto REEMPLAZA la entrada (replace), nunca apila con push', () => {
    mockSearchParams = new URLSearchParams('pagar=buscar')

    const overlay = renderHook(() => useOverlayParam('ver'))
    overlay.set('55')

    expect(replaceMock).toHaveBeenCalledWith('/socios?ver=55', { scroll: false })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('cerrar sin el param en la URL no hace nada (ni back ni replace)', () => {
    mockSearchParams = new URLSearchParams()
    const close = renderHook(() => useCloseOverlay('ver'))
    close()
    expect(backMock).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalled()
  })
})

describe('parseIncomeOverlay / incomeOverlayValue (?ingreso=)', () => {
  it('"nuevo" y "sponsor:<id>" parsean y vuelven al mismo valor (ida y vuelta)', () => {
    expect(parseIncomeOverlay('nuevo')).toEqual({ mode: 'nuevo' })
    expect(incomeOverlayValue({ mode: 'nuevo' })).toBe('nuevo')
    expect(parseIncomeOverlay('sponsor:7')).toEqual({ mode: 'nuevo', sponsorId: 7 })
    expect(incomeOverlayValue({ mode: 'nuevo', sponsorId: 7 })).toBe('sponsor:7')
  })

  it.each([null, '', 'otra-cosa', 'sponsor:', 'sponsor:abc', 'sponsor:0', 'sponsor:-5', 'sponsor:1.5', 'sponsor:7:8', 'socio:1', 'NUEVO', ' nuevo', 'sponsor:99999999999999999999'])(
    '%j no es un valor válido: null, nunca revienta ni abre un overlay a medias',
    (value) => {
      expect(parseIncomeOverlay(value)).toBeNull()
    },
  )
})

describe('?ingreso= convive con ?pagar= y ?ver= sin apilarse (exclusión mutua)', () => {
  it('abrir ingreso con pagar abierto: replace, quita pagar y deja solo ingreso', () => {
    mockPathname = '/caja'
    mockSearchParams = new URLSearchParams('pagar=buscar')
    const overlay = renderHook(() => useOverlayParam('ingreso'))
    overlay.set('nuevo')
    expect(replaceMock).toHaveBeenCalledWith('/caja?ingreso=nuevo', { scroll: false })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('abrir ingreso con ver abierto: replace, quita ver', () => {
    mockPathname = '/caja'
    mockSearchParams = new URLSearchParams('ver=12')
    renderHook(() => useOverlayParam('ingreso')).set('sponsor:3')
    expect(replaceMock).toHaveBeenCalledWith('/caja?ingreso=sponsor%3A3', { scroll: false })
  })

  it('al revés: abrir pagar o ver con ingreso abierto también lo quita', () => {
    mockPathname = '/caja'
    mockSearchParams = new URLSearchParams('ingreso=nuevo')
    renderHook(() => useOverlayParam('pagar')).set('buscar')
    expect(replaceMock).toHaveBeenLastCalledWith('/caja?pagar=buscar', { scroll: false })
    renderHook(() => useOverlayParam('ver')).set('9')
    expect(replaceMock).toHaveBeenLastCalledWith('/caja?ver=9', { scroll: false })
  })

  it('conserva los demás params de la URL (mes, concepto) al abrir y al cerrar', () => {
    mockPathname = '/caja/ingresos'
    mockSearchParams = new URLSearchParams('mes=2026-09&concepto=3')
    renderHook(() => useOverlayParam('ingreso')).set('nuevo')
    expect(pushMock).toHaveBeenCalledWith('/caja/ingresos?mes=2026-09&concepto=3&ingreso=nuevo', { scroll: false })

    mockSearchParams = new URLSearchParams('mes=2026-09&concepto=3&ingreso=nuevo')
    renderHook(() => useCloseOverlay('ingreso'))()
    expect(replaceMock).toHaveBeenCalledWith('/caja/ingresos?mes=2026-09&concepto=3', { scroll: false })
  })

  it('ingreso abierto por esta pestaña (con marca): cerrar usa back(); deep link sin marca: replace()', () => {
    mockSearchParams = new URLSearchParams('ingreso=nuevo')
    historyState = { __lonquiOverlay: 'ingreso' }
    renderHook(() => useCloseOverlay('ingreso'))()
    expect(backMock).toHaveBeenCalledOnce()

    backMock.mockClear()
    historyState = null
    renderHook(() => useCloseOverlay('ingreso'))()
    expect(backMock).not.toHaveBeenCalled()
    expect(replaceMock).toHaveBeenCalled()
  })

  it('la marca de OTRO overlay no cuenta: cerrar ingreso con marca de "ver" usa replace()', () => {
    mockSearchParams = new URLSearchParams('ingreso=nuevo')
    historyState = { __lonquiOverlay: 'ver' }
    renderHook(() => useCloseOverlay('ingreso'))()
    expect(backMock).not.toHaveBeenCalled()
    expect(replaceMock).toHaveBeenCalled()
  })
})
