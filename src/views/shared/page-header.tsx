/**
 * Encabezado de página: título (h1) + descripción opcional + una acción
 * primaria opcional. Sin kicker/eyebrow — el piso de calidad lo prohíbe sin
 * excepción: el título lleva su propio peso.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}
