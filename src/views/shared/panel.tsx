import { cn } from '@/lib/utils'

/**
 * Sección de contenido con título (h2) y cuerpo. NO se anida: un `Panel`
 * dentro de otro `Panel` es exactamente lo que el piso de calidad prohíbe.
 * Si una vista necesita agrupar más de un bloque, son `Panel` hermanos, no
 * anidados.
 */
export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      {title ? (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-heading text-base font-semibold text-balance">{title}</h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}
