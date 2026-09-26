import type { LucideIcon } from 'lucide-react'
import { Inbox, TriangleAlert } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type StateProps = {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

function StateBlock({
  icon: Icon,
  iconClassName,
  title,
  description,
  action,
  className,
}: StateProps & { icon: LucideIcon; iconClassName?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}>
      <Icon aria-hidden className={cn('size-8', iconClassName)} />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/**
 * Vacío que enseña: nunca "no hay nada". Explica qué se espera ver y, si
 * corresponde al rol, ofrece la acción que lo llena.
 */
export function EmptyState(props: StateProps) {
  return <StateBlock {...props} icon={Inbox} iconClassName="text-muted-foreground" />
}

/** Error de red o del servidor, con una acción de "Reintentar" cuando aplica. */
export function ErrorState(props: StateProps) {
  return <StateBlock {...props} icon={TriangleAlert} iconClassName="text-destructive" />
}

/**
 * Skeleton de una lista/tabla, no un spinner en medio del contenido
 * (operate.md). `rows` controla cuántas filas fantasma se dibujan.
 */
export function LoadingList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="status" aria-label="Cargando…">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border px-3 py-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/5" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  )
}
