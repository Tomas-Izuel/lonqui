'use client'

import { useSyncExternalStore } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">{children}</div>
        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">{footer}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
