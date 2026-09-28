import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LoadingList } from '@/views/shared/states'
import { cn } from '@/lib/utils'

export type DataListColumn<T> = {
  key: string
  header: string
  render: (item: T) => React.ReactNode
  /** Columnas de medición (montos, DNI): alineadas a la derecha, tabular. */
  numeric?: boolean
  className?: string
}

export type DataListRow = {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /**
   * Debajo del subtítulo (ej. pills de estado, badges): vive en la misma
   * columna flexible que el título, nunca a la derecha. Un badge que no
   * envuelve (`whitespace-nowrap`) no puede competir por ancho contra el
   * título — por eso `meta` nunca es un vecino `shrink-0` del título, sino
   * parte de su misma columna.
   */
  meta?: React.ReactNode
  /**
   * Fijo a la derecha de la fila (ej. el menú de acciones de la fila): SIEMPRE
   * `shrink-0` y de ancho acotado (un ícono, un botón chico), nunca texto
   * libre — es lo único que puede convivir con el título sin arriesgar
   * empujarlo a ancho 0.
   */
  actions?: React.ReactNode
  href?: string
}

type DataListProps<T> = {
  items: T[]
  getKey: (item: T) => string | number
  /** Columnas para la tabla en ≥ md. */
  columns: DataListColumn<T>[]
  /** Fila apilable para < md. */
  renderRow: (item: T) => DataListRow
  loading?: boolean
  loadingRows?: number
  emptyState?: React.ReactNode
  className?: string
}

/**
 * Entrada escalonada de las primeras filas (pipeline 2026-09-28, motion.ts:
 * STAGGER). CSS puro (tw-animate-css) y no `motion`: `DataList` se usa desde
 * Server Components que le pasan funciones (`renderRow`), así que no puede
 * volverse Client Component. Solo anima al montar la fila (cambio de filtro
 * o de página = filas nuevas); `motion-reduce` deja solo la opacidad.
 */
const STAGGER_STEP_MS = 40
const STAGGER_MAX_ROWS = 8

function rowEntrance(index: number): { className: string; style: React.CSSProperties } {
  return {
    className:
      'animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-300 ease-(--ease-out-expo) motion-reduce:slide-in-from-bottom-0',
    style: { animationDelay: `${Math.min(index, STAGGER_MAX_ROWS) * STAGGER_STEP_MS}ms` },
  }
}

/**
 * Lista/tabla responsive: filas apilables en móvil (`< md`), tabla en
 * escritorio. Nunca las dos estructuras a la vez — es el mismo dato, dos
 * lecturas del layout, como pide la convención de la categoría.
 */
export function DataList<T>({
  items,
  getKey,
  columns,
  renderRow,
  loading,
  loadingRows = 5,
  emptyState,
  className,
}: DataListProps<T>) {
  if (loading) return <LoadingList rows={loadingRows} className={className} />
  if (items.length === 0 && emptyState) return <div className={className}>{emptyState}</div>

  return (
    <div className={className}>
      {/* Móvil: filas apilables */}
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border/70 bg-card shadow-raised md:hidden">
        {items.map((item, itemIndex) => {
          const row = renderRow(item)
          const entrance = rowEntrance(itemIndex)
          const content = (
            <div className="flex min-h-11 items-center gap-3 px-3 py-3">
              {/*
                Título con prioridad real: `min-w-0 flex-1` en la única columna
                que puede crecer. `meta` (badges de estado) va DEBAJO del
                subtítulo, en esta misma columna — nunca al lado, para que un
                badge que no envuelve no lo empuje a ancho 0 (finish review,
                fix 1). Lo único a la derecha es `actions` (menú de fila) y el
                chevron, ambos `shrink-0` y de ancho chico y previsible.
              */}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">{row.title}</span>
                {row.subtitle ? <span className="truncate text-sm text-muted-foreground">{row.subtitle}</span> : null}
                {row.meta ? <div className="flex flex-wrap items-center gap-1.5">{row.meta}</div> : null}
              </div>
              {row.actions ? <div className="flex shrink-0 items-center">{row.actions}</div> : null}
              {row.href ? <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
            </div>
          )
          return (
            <li key={getKey(item)} className={entrance.className} style={entrance.style}>
              {row.href ? (
                <Link href={row.href} className="block transition-colors duration-150 hover:bg-muted/50 focus-visible:bg-muted/50 active:bg-muted">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          )
        })}
      </ul>

      {/* Escritorio: tabla */}
      <div className="hidden overflow-hidden rounded-xl border border-border/70 bg-card shadow-raised md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
                <TableHead key={col.key} className={cn(col.numeric && 'text-right tabular-nums', col.className)}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, itemIndex) => {
              const row = renderRow(item)
              const entrance = rowEntrance(itemIndex)
              const rowContent = columns.map((col) => (
                <TableCell key={col.key} className={cn(col.numeric && 'text-right tabular-nums', col.className)}>
                  {col.render(item)}
                </TableCell>
              ))
              return row.href ? (
                <TableRow key={getKey(item)} className={cn('cursor-pointer', entrance.className)} style={entrance.style}>
                  {columns.map((col, index) => (
                    <TableCell key={col.key} className={cn(col.numeric && 'text-right tabular-nums', col.className, 'p-0')}>
                      {/*
                        Un solo link accesible por fila, en la primera celda
                        (finish review, nit 16): las demás repetían el mismo
                        destino cinco veces para un lector de pantalla. El
                        resto queda clickeable visualmente con `tabIndex={-1}`
                        y `aria-hidden`, fuera del recorrido de tab y sin
                        anunciarse de nuevo.
                      */}
                      <Link
                        href={row.href!}
                        className="block px-2 py-2.5 focus-visible:bg-muted/50"
                        {...(index === 0 ? {} : { tabIndex: -1, 'aria-hidden': true })}
                      >
                        {col.render(item)}
                      </Link>
                    </TableCell>
                  ))}
                </TableRow>
              ) : (
                <TableRow key={getKey(item)} className={entrance.className} style={entrance.style}>
                  {rowContent}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
