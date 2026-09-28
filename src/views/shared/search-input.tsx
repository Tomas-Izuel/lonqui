'use client'

import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Buscador con debounce que escribe en `searchParams` (no en estado local):
 * así "retomar después de una interrupción" funciona — recargar la página o
 * volver con el botón atrás mantiene la búsqueda. Reinicia el cursor de
 * paginación en cada cambio.
 */
export function SearchInput({
  paramName = 'q',
  placeholder = 'Buscar por nombre o DNI…',
  className,
  autoFocus,
}: {
  paramName?: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlValue = searchParams.get(paramName) ?? ''
  const [value, setValue] = useState(urlValue)
  const [, startTransition] = useTransition()

  // El valor de la URL manda si algo la cambia por fuera (ej. "Limpiar
  // filtros"): ajuste durante el render, no en un efecto — evita el
  // "cascading render" de sincronizar estado local con una prop externa
  // desde un `useEffect` (react-hooks/set-state-in-effect).
  const [trackedUrlValue, setTrackedUrlValue] = useState(urlValue)
  if (urlValue !== trackedUrlValue) {
    setTrackedUrlValue(urlValue)
    setValue(urlValue)
  }

  useEffect(() => {
    const current = searchParams.get(paramName) ?? ''
    if (value === current) return

    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams)
      if (value) params.set(paramName, value)
      else params.delete(paramName)
      params.delete('cursor')
      startTransition(() => router.replace(`${pathname}?${params.toString()}`))
    }, 300)

    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-ejecuta solo con `value`
  }, [value])

  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        className="h-11 pl-9"
        {...(value ? { style: { paddingRight: '2.25rem' } } : {})}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onClick={() => setValue('')}
        >
          <X aria-hidden />
          <span className="sr-only">Limpiar búsqueda</span>
        </Button>
      ) : null}
    </div>
  )
}
