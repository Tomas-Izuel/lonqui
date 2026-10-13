'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

const GENERIC_ERROR = 'No se pudo exportar. Probá de nuevo.'

/** Nombre del `Content-Disposition: attachment; filename="..."`; con fallback. */
function filenameFrom(res: Response): string {
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') ?? '')
  return match?.[1] ?? 'ingresos.csv'
}

/**
 * Mejora progresiva: el `<a href>` sigue siendo un link común (sin JS descarga
 * directo). Con JS se pide por `fetch` para NO guardar como CSV un JSON de error:
 * solo si la respuesta es ok se baja el Blob. El body de error es
 * `{ error: string }` (`toApiError`); un 5xx es genérico y nunca se muestra su texto.
 */
export function ExportCsvButton({ href }: { href: string }) {
  const [pending, setPending] = useState(false)

  async function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(href)
      if (!res.ok) {
        let message = GENERIC_ERROR
        if (res.status < 500) {
          const body: unknown = await res.json().catch(() => null)
          const error = (body as { error?: unknown } | null)?.error
          if (typeof error === 'string' && error) message = error
        }
        toast.error(message)
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = filenameFrom(res)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(GENERIC_ERROR)
    } finally {
      setPending(false)
    }
  }

  return (
    <Button asChild variant="outline" className="h-11">
      <a href={href} download onClick={onClick} aria-disabled={pending} className={pending ? 'pointer-events-none opacity-60' : undefined}>
        {pending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Download aria-hidden />}
        {pending ? 'Exportando…' : 'Exportar CSV'}
      </a>
    </Button>
  )
}
