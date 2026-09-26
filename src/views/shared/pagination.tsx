'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

/**
 * Paginación keyset: no hay números de página, solo "Ver más" que pide el
 * próximo cursor. `onLoadMore` hace el fetch (vía Server Action o router) y
 * devuelve si quedan más resultados.
 */
export function Pagination({
  nextCursor,
  onLoadMore,
  className,
}: {
  nextCursor: string | null
  onLoadMore: (cursor: string) => void | Promise<void>
  className?: string
}) {
  const [isPending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)

  if (!nextCursor) return null

  function handleClick() {
    setLoading(true)
    startTransition(async () => {
      try {
        await onLoadMore(nextCursor!)
      } finally {
        setLoading(false)
      }
    })
  }

  const busy = isPending || loading

  return (
    <div className={className}>
      <Button type="button" variant="outline" onClick={handleClick} disabled={busy} className="w-full sm:w-auto">
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        Ver más
      </Button>
    </div>
  )
}
