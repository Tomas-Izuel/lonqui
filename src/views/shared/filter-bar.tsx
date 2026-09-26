'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {filters.map((filter) => {
        const trigger = (
          <Select
            key={filter.param}
            value={searchParams.get(filter.param) ?? ALL_VALUE}
            onValueChange={(value) => setParam(filter.param, value === ALL_VALUE ? '' : value)}
            disabled={Boolean(filter.disabledReason)}
          >
            <SelectTrigger aria-label={filter.label} className="h-9">
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

        if (!filter.disabledReason) return trigger

        return (
          <Tooltip key={filter.param}>
            <TooltipTrigger asChild>
              <span className="inline-flex">{trigger}</span>
            </TooltipTrigger>
            <TooltipContent>{filter.disabledReason}</TooltipContent>
          </Tooltip>
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
