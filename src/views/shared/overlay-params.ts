'use client'

import { useCallback, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * Overlays globales direccionables por URL (pipeline 2026-09-28, D1/D2):
 * `?pagar=buscar|socio:<id>|grupo:<id>` y `?ver=<id>`. El overlay vive encima
 * de la página donde se abrió — nunca se navega a otra ruta — y el botón
 * atrás del celular lo cierra, que es lo que la gente espera de un panel que
 * sube desde abajo.
 *
 * La única parte delicada es cerrar: si ESTA pestaña abrió el overlay
 * (`set`), cerrar es `history.back()` y la entrada desaparece del historial.
 * Si el param ya venía en la URL (link compartido, recarga), no hay una
 * entrada nuestra detrás: un `back()` sacaría a la persona de la app. Para
 * distinguir los dos casos, `set` deja una marca en `history.state`.
 *
 * Nunca se apilan dos overlays: abrir uno quita los otros params de overlay
 * de la misma URL (D2 — "Registrar pago" desde la vista rápida reemplaza
 * `ver` por `pagar`).
 */

export type OverlayName = 'pagar' | 'ver'

const OVERLAY_NAMES: OverlayName[] = ['pagar', 'ver']
const MARK = '__lonquiOverlay'

/** Overlay que esta pestaña acaba de abrir y todavía no marcó en el historial. */
let pendingMark: OverlayName | null = null

function hrefWith(pathname: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

function markedBy(name: OverlayName): boolean {
  const state = window.history.state as Record<string, unknown> | null
  return state?.[MARK] === name
}

function writeMark(name: OverlayName) {
  // Next guarda su propio estado en history.state: se agrega la marca sin pisarlo.
  const state = (window.history.state as Record<string, unknown> | null) ?? {}
  window.history.replaceState({ ...state, [MARK]: name }, '')
}

export function useOverlayParam(name: OverlayName): {
  value: string | null
  set: (value: string) => void
  clear: () => void
} {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const value = searchParams.get(name)
  const close = useCloseOverlay(name)

  // La marca se escribe DESPUÉS de que Next confirmó la navegación: su
  // `history.pushState` corre dentro de la transición del router, más tarde
  // que cualquier microtask del click. Escribirla antes la dejaba en la
  // entrada ANTERIOR (verificado en el navegador): cerrar hacía `replace`,
  // quedaba una entrada de más y "atrás" no salía del overlay. Cuando el
  // efecto ve el param ya presente, la URL y el historial ya son los nuevos.
  useEffect(() => {
    if (value !== null && pendingMark === name) {
      pendingMark = null
      writeMark(name)
    }
  }, [name, value])

  const set = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString())
      const replacingOther = OVERLAY_NAMES.some((other) => other !== name && params.has(other))
      const alreadyOpen = params.has(name)
      for (const other of OVERLAY_NAMES) params.delete(other)
      params.set(name, next)
      const href = hrefWith(pathname, params)

      // Ya había una capa abierta (otro overlay, o este mismo en otro paso,
      // p. ej. "buscar" → "socio:12"): se reemplaza la entrada en vez de
      // apilar otra, así un solo "atrás" cierra todo. La marca se hereda.
      if (replacingOther || alreadyOpen) {
        if (OVERLAY_NAMES.some(markedBy)) pendingMark = name
        router.replace(href, { scroll: false })
        return
      }
      pendingMark = name
      router.push(href, { scroll: false })
    },
    [name, pathname, router, searchParams],
  )

  return { value, set, clear: close }
}

/**
 * Cierra el overlay `name`: `back()` si esta pestaña lo abrió, `replace()`
 * sin el param si no (deep-link o recarga). Sin el param en la URL, no hace nada.
 */
export function useCloseOverlay(name: OverlayName): () => void {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return useCallback(() => {
    if (!searchParams.has(name)) return
    if (markedBy(name)) {
      router.back()
      return
    }
    const params = new URLSearchParams(searchParams.toString())
    params.delete(name)
    router.replace(hrefWith(pathname, params), { scroll: false })
  }, [name, pathname, router, searchParams])
}

export {
  parsePaymentOverlay,
  paymentOverlayValue,
  parseQuickViewParam,
  isPlainLeftClick,
  type PaymentOverlayTarget,
} from './overlay-values'
