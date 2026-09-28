'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { motion, useDragControls, useMotionValue, animate, type PanInfo } from 'motion/react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SPRING_OVERLAY, useMotionPreference } from '@/views/shared/motion'

const DESKTOP_QUERY = '(min-width: 768px)'

function subscribeToDesktopQuery(callback: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function getIsDesktopSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches
}

/** Sin viewport en el servidor, el primer render es siempre el sheet desde abajo — correcto para el caso más común (el celular de la sede). */
function getIsDesktopServerSnapshot() {
  return false
}

/**
 * `true` desde `md` (768px), igual que la barra lateral de `AppShell` — un
 * solo punto de corte para "es escritorio" en todo el panel.
 * `useSyncExternalStore` en vez de `useEffect` + `useState`: `matchMedia` ya
 * es una fuente externa con su propio evento de cambio, exactamente lo que
 * el hook está pensado para leer, sin el render en cascada de sincronizar un
 * estado propio desde un efecto (vercel-react-best-practices).
 */
function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeToDesktopQuery, getIsDesktopSnapshot, getIsDesktopServerSnapshot)
}

/** Umbral de desplazamiento (px) o velocidad (px/s) del gesto para cerrar en vez de volver a su lugar. */
const DISMISS_OFFSET = 120
const DISMISS_VELOCITY = 600

export type ResponsiveSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Botones del pie (Cancelar + Guardar, con `form="<id>"` apuntando al `<form>` de `children`). */
  footer: React.ReactNode
  children: React.ReactNode
}

/**
 * Formulario de alta/edición corto (disciplina, categoría): sheet desde
 * abajo en móvil, diálogo centrado de ancho acotado desde `md` (feedback
 * directo de Tomás — el sheet desde abajo en escritorio "se ve raro": media
 * pantalla en blanco a los costados y la hoja pegada al borde inferior de un
 * viewport mucho más alto que el contenido). Un solo primitivo para no
 * repetir el mismo `if` de breakpoint en cada `*-form-sheet.tsx`.
 *
 * `children` es el `<form>` completo (con su propio `id`, para que los
 * botones del `footer` puedan usar `form="<id>"` y quedar fuera del árbol
 * scrolleable); acá solo se le da el padding y el scroll propio de cada
 * modo, que si no quedaría duplicado o ausente según el modo.
 */
export function ResponsiveSheet({ open, onOpenChange, title, description, footer, children }: ResponsiveSheetProps) {
  const isDesktop = useIsDesktop()
  const { reduced } = useMotionPreference()
  const dragY = useMotionValue(0)
  const dragControls = useDragControls()

  // Al abrir, el panel arranca siempre en reposo: si no se resetea acá, la
  // próxima apertura heredaría el offset de un arrastre cancelado (soltado
  // antes de llegar al umbral) de la vez anterior. Se hace en la apertura y
  // no en el cierre para no pisar la animación de salida mientras todavía se
  // ve (Radix mantiene el nodo montado durante el `data-closed:animate-out`).
  useEffect(() => {
    if (open) dragY.set(0)
  }, [open, dragY])

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">{children}</div>
          <DialogFooter>{footer}</DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  function handleDragEnd(_: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) {
      onOpenChange(false)
      return
    }
    // No llegó al umbral: vuelve a su lugar con el mismo resorte del cierre
    // (`SPRING_OVERLAY`) — coherente con "algo que se suelta", no un snap seco.
    animate(dragY, 0, SPRING_OVERLAY)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        El contenedor de Radix queda SIN pintura propia (`bg-transparent`,
        sin sombra ni borde): solo posiciona y recorta. Todo lo que se ve
        —fondo, borde superior, sombra— vive en el `motion.div` de adentro,
        que es el que de verdad se traduce con el arrastre. Si el fondo
        quedara acá afuera, arrastrar el handle dejaría un hueco blanco fijo
        arriba en vez de revelar el overlay de atrás (D8).
      */}
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-xl border-t-0 bg-transparent p-0 shadow-none">
        <motion.div
          drag={reduced ? false : 'y'}
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0 }}
          dragElastic
          onDragEnd={handleDragEnd}
          style={reduced ? undefined : { y: dragY }}
          className="flex max-h-[85dvh] flex-col rounded-t-xl border-t border-border bg-popover shadow-lg"
        >
          {/*
            Handle visual: NO es él mismo el elemento arrastrable (evita que
            `motion` lo traduzca por su cuenta además del panel entero, lo que
            duplicaría el desplazamiento) — dispara el gesto del panel de
            arriba vía `dragControls.start`, patrón oficial de `motion` para
            "handle chico controla un elemento más grande". `children` nunca
            tiene `drag`: su scroll interno (un formulario largo) sigue
            andando sin competir con el gesto de cierre.

            Es un `<button>` real, no un `div` decorativo: un `div` con
            `aria-label` sin rol no se anuncia de forma confiable (no entra
            en el árbol de accesibilidad como algo con nombre), y un gesto de
            arrastre no es operable por teclado en ningún sistema. El botón
            resuelve las dos cosas — nombre accesible + foco/Enter/Espacio
            nativos — y cierra por click/teclado sin arrastrar; arrastrar más
            allá del pequeño umbral de `motion` (unos px) activa el gesto en
            vez del click, así que las dos formas conviven en el mismo
            elemento sin pisarse. `h-11` (44px) es el área de toque real; el
            pill visible sigue siendo el mismo indicador chico de siempre.
          */}
          {reduced ? null : (
            <button
              type="button"
              onPointerDown={(event) => dragControls.start(event)}
              onClick={() => onOpenChange(false)}
              aria-label="Cerrar"
              className="flex h-11 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
            >
              <span aria-hidden className="block h-1.5 w-10 rounded-full bg-border" />
            </button>
          )}
          <SheetHeader className={reduced ? undefined : 'pt-0'}>
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">{children}</div>
          <SheetFooter className="flex-row justify-end gap-2 border-t border-border">{footer}</SheetFooter>
        </motion.div>
      </SheetContent>
    </Sheet>
  )
}
