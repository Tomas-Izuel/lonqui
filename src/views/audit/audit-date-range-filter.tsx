'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'

/**
 * Rango de fechas de /auditoria (`from`/`to`, interpretados en la zona del
 * club por `audit.model.ts`). Escribe en `searchParams`, igual que
 * `FilterBar`/`SearchInput`: recargar o compartir el link mantiene el rango
 * puesto, y borra `cursor` en cada cambio (reinicia la paginación).
 */
export function AuditDateRangeFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  function setParam(name: 'from' | 'to', value: string) {
    const params = new URLSearchParams(searchParams)
    if (value) params.set(name, value)
    else params.delete(name)
    params.delete('cursor')
    router.replace(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="audit-from">
        Desde
      </label>
      <Input
        id="audit-from"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => setParam('from', e.target.value)}
        className="h-9 w-[8.5rem] tabular-nums"
      />
      <span aria-hidden className="text-sm text-muted-foreground">
        –
      </span>
      <label className="sr-only" htmlFor="audit-to">
        Hasta
      </label>
      <Input
        id="audit-to"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => setParam('to', e.target.value)}
        className="h-9 w-[8.5rem] tabular-nums"
      />
    </div>
  )
}
