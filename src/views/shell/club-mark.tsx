import { cn } from '@/lib/utils'

/**
 * Placeholder tipográfico del escudo: el escudo real todavía no llegó. Un
 * monograma "NB" (Naranja y Blanco) sobre el naranja de marca — nunca un
 * emoji — pensado para reemplazarse por la imagen real sin tocar el layout
 * que lo rodea (mismo tamaño cuadrado, mismo radio).
 */
export function ClubMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dimensions = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-14 text-xl' }[size]

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-brand font-heading font-bold text-brand-foreground',
        dimensions,
        className,
      )}
    >
      NB
    </span>
  )
}
