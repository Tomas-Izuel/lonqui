import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Fila compacta etiqueta/valor (route.md, brief del panel inicial: "estilo
 * resumen de Mercado Pago"). Es DISTINTA de `DataList` (título/subtítulo/meta
 * de una entidad navegable): acá cada fila es UN indicador, siempre de una
 * sola línea, con el valor en numerales tabulares a la derecha.
 *
 * "Todo número es un link" (brief): con `href`, la fila entera navega al
 * listado filtrado que lo explica, con chevron. Candidato fuerte a
 * `views/shared/` si Tomás aprueba una de las composiciones — hoy vive acá
 * porque F3 no toca `views/shared/**` en esta ronda (ver dev log).
 */
export function DataRow({
  label,
  sublabel,
  value,
  href,
  tone = 'default',
  className,
}: {
  label: string
  sublabel?: string
  value: React.ReactNode
  href?: string
  tone?: 'default' | 'debt' | 'positive'
  className?: string
}) {
  const toneClass = tone === 'debt' ? 'text-status-in-debt' : tone === 'positive' ? 'text-status-up-to-date' : undefined

  const content = (
    <div className={cn('flex min-h-11 items-center justify-between gap-3 py-2', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm text-muted-foreground">{label}</span>
        {sublabel ? <span className="truncate text-xs text-muted-foreground">{sublabel}</span> : null}
      </div>
      <div className={cn('flex shrink-0 items-center gap-1 font-medium tabular-nums', toneClass)}>
        {value}
        {href ? <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
    </div>
  )

  if (!href) return content

  // Sin `-mx-1`/`rounded-md`: un `border-radius` sobre un elemento sin fondo
  // ni borde propios igual deja una costura visible en Chromium (confirmado
  // recortando capturas — ver dev log, bug del code-reviewer). Mismo patrón
  // que `DataList` (`views/shared/data-list.tsx`): el link ocupa la fila
  // entera a filo, sin inset ni esquinas — así la fila que navega se ve
  // IGUAL a sus hermanas en reposo, y solo se distingue en hover/foco.
  return (
    <Link href={href} className="block hover:bg-muted/50 focus-visible:bg-muted/50">
      {content}
    </Link>
  )
}

/** Un grupo de `DataRow` con divisores finos, la unidad que compone cada `Panel`. */
export function DataRowGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col divide-y divide-border', className)}>{children}</div>
}
