'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type TemporaryPasswordPayload = { password: string; forLabel: string }

/**
 * Muestra la contraseña temporal UNA sola vez (spec F3 / D8). Vive solo en el
 * estado de React del padre (`UsersView`): nunca en la URL, en localStorage ni
 * en el historial del navegador. Al cerrar, el padre descarta el valor
 * (`onOpenChange(false)` → `setTempPassword(null)`) y no hay forma de volver
 * a verla — ni siquiera queda en este componente, que se desmonta.
 *
 * Sin botón de cerrar (X) ni cierre por click afuera o Escape: la única
 * salida es el botón que confirma que ya se la pasó a la persona. Es la misma
 * lógica que "confirmá que guardaste tus códigos de recuperación" en otros
 * productos — el valor no se puede recuperar si se pierde antes de copiarlo.
 */
export function TemporaryPasswordDialog({
  payload,
  onOpenChange,
}: {
  payload: TemporaryPasswordPayload | null
  onOpenChange: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!payload) return
    try {
      await navigator.clipboard.writeText(payload.password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API puede fallar (permisos, contexto no seguro, navegador
      // viejo): la contraseña sigue visible en pantalla para copiarla a mano
      // con selección de texto (`select-all` en el <span>).
    }
  }

  return (
    <Dialog open={payload !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Contraseña temporal{payload ? ` de ${payload.forLabel}` : ''}</DialogTitle>
          <DialogDescription>
            Pasásela a la persona. Le va a pedir que la cambie al entrar. Esta es la única vez que se muestra.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <span className="flex-1 text-base font-semibold tracking-wide tabular-nums select-all">{payload?.password}</span>
          <Button type="button" variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied ? 'Copiada' : 'Copiar'}
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Ya se la anoté
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
