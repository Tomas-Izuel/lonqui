'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type FilterOption = { value: string; label: string }

export type FilterDef = {
  /** Nombre del parámetro en la URL. */
  param: string
  label: string
  options: FilterOption[]
  /** Ej. "Todos", "Todas las categorías". */
  placeholder: string
  /** Deshabilitado con motivo visible (ej. deuda, hasta que exista el slice 2). */
  disabledReason?: string
}

// Radix no permite `value=""` en un <Select.Item>: un sentinel interno
// representa "sin filtro" y se traduce a "borrar el param" en el handler.
const ALL_VALUE = '__all__'

/**
 * Filtros que viven en `searchParams`, no en estado local: recargar la
 * página o compartir el link mantiene el filtro puesto (Product Principle:
 * "retomar después de una interrupción"). Cada cambio reinicia el cursor de
 * paginación.
 */
export function FilterBar({ filters, className }: { filters: FilterDef[]; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const hasActiveFilter = filters.some((f) => searchParams.get(f.param))

  function setParam(param: string, value: string) {
    const params = new URLSearchParams(searchParams)
    if (value) params.set(param, value)
    else params.delete(param)
    params.delete('cursor')
    router.replace(`${pathname}?${params.toString()}`)
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams)
    for (const f of filters) params.delete(f.param)
    params.delete('cursor')
    router.replace(`${pathname}?${params.toString()}`)
  }

  return (
    <div className={cn('flex flex-wrap items-start gap-3', className)}>
      {filters.map((filter) => {
        const trigger = (
          <Select
            value={searchParams.get(filter.param) ?? ALL_VALUE}
            onValueChange={(value) => setParam(filter.param, value === ALL_VALUE ? '' : value)}
            disabled={Boolean(filter.disabledReason)}
          >
            <SelectTrigger aria-label={filter.label}>
              <SelectValue placeholder={filter.placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{filter.placeholder}</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

        // Un tooltip no se abre al toque (finish review, fix 6): el motivo de
        // un filtro deshabilitado va como texto siempre visible, con una
        // etiqueta que nombre qué filtra ("Deuda"), no solo el placeholder
        // genérico del select ("Cualquiera").
        if (!filter.disabledReason) return <div key={filter.param}>{trigger}</div>

        return (
          <div key={filter.param} className="flex max-w-40 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{filter.label}</span>
            {trigger}
            <span className="text-xs text-muted-foreground">{filter.disabledReason}</span>
          </div>
        )
      })}
      {hasActiveFilter ? (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          Limpiar filtros
        </Button>
      ) : null}
    </div>
  )
}
