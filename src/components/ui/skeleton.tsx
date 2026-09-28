import { cn } from "cn"

/**
 * `bg-border` (no `bg-muted`): dentro de un `Panel` blanco, `bg-muted`
 * (#F7F7F8) es casi indistinguible del fondo — el pulso se veía apagado.
 * `--border` (#E5E7EB) da el contraste que hace visible el "esto está
 * cargando" tanto sobre el panel blanco como sobre el lienzo (`--canvas`).
 *
 * Shimmer (gradiente que se desplaza) en vez de pulso de opacidad: se lee
 * como "cargando" sin parpadear. Con movimiento reducido, bloque quieto.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-shimmer rounded-md bg-linear-to-r from-border/50 via-border to-border/50 bg-size-[200%_100%] motion-reduce:animate-none motion-reduce:bg-border/70", className)}
      {...props}
    />
  )
}

export { Skeleton }
