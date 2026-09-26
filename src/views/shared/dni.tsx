import { cn } from '@/lib/utils'

/**
 * DNI con numerales tabulares. `null` (o `hasDni: false`) se muestra como
 * "DNI pendiente" en tinta secundaria — nunca un guion o un vacío que se
 * confunda con un dato faltante por error de carga.
 */
export function Dni({ dni, className }: { dni: string | null; className?: string }) {
  if (!dni) {
    return <span className={cn('text-muted-foreground', className)}>DNI pendiente</span>
  }
  return <span className={cn('tabular-nums', className)}>{dni}</span>
}
