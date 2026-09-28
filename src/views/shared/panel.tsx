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
    <section className={cn('rounded-xl border border-border/70 bg-card shadow-raised', className)}>
      {title ? (
        // Apilado en móvil (finish review, fix 7 — "ceiling"): un título largo
        // ("Disciplinas y categorías") junto a una acción ("Nueva disciplina")
        // en una sola fila se aplastaban a 390px. Misma regla que `PageHeader`.
        <header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
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
