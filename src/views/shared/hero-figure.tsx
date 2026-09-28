'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { formatCentsCompact } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useCountUpOnce } from './motion'

/**
 * La cifra que lidera una vista: exactamente UNA por pantalla (D4, skill
 * `dataviz`). Nunca una grilla de estas — eso es la plantilla de
 * métrica-héroe que el piso de calidad rechaza.
 *
 * El `label` va ARRIBA del número y no es un kicker/eyebrow: un kicker es un
 * rótulo decorativo sobre un título que ya se explica solo; acá el número
 * solo no dice nada ("$ 1.250.000" ¿de qué?) y el rótulo es la mitad del
 * dato, en tipografía de lectura normal, sin mayúsculas sostenidas ni
 * tracking de rótulo.
 *
 * Tipografía proporcional a propósito (no `tabular-nums`): los numerales
 * tabulares son para columnas que alinean; un número grande y solo se lee
 * mejor con su espaciado natural.
 *
 * `tone` tiñe solo el número: `debt` en el rojo de estado (6,47:1), `neutral`
 * en tinta. Nunca el naranja institucional (no es color de texto).
 */
export function HeroFigure({
  label,
  cents,
  href,
  countUpKey,
  tone = 'neutral',
  supporting,
  className,
}: {
  label: string
  /** Centavos enteros. Se formatean sin decimales, como todo monto del panel. */
  cents: number
  /** Todo número es un link al listado que lo explica (brief del inicio). */
  href?: string
  /** Si se pasa, cuenta desde 0 una sola vez por sesión del navegador (`useCountUpOnce`). */
  countUpKey?: string
  tone?: 'neutral' | 'debt' | 'positive'
  /** Una línea de contexto debajo del número ("8 socios deben", "50% de las cuotas del mes"). */
  supporting?: React.ReactNode
  className?: string
}) {
  const shown = useCountUpOnce(cents, countUpKey)
  const counting = shown !== cents
  const value = (
    <span
      className={cn(
        'block text-4xl font-semibold tracking-tight sm:text-5xl',
        tone === 'debt' && 'text-status-in-debt',
        tone === 'positive' && 'text-status-up-to-date',
        tone === 'neutral' && 'text-foreground',
      )}
      // El valor real para lectores de pantalla, no cada frame del conteo.
      aria-hidden={counting ? true : undefined}
    >
      {formatCentsCompact(shown)}
    </span>
  )
  const srValue = counting ? <span className="sr-only">{formatCentsCompact(cents)}</span> : null

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {href ? (
        <Link
          href={href}
          className="group -mx-1 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {value}
          {srValue}
          <ChevronRight
            aria-hidden
            className="size-5 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </Link>
      ) : (
        <>
          {value}
          {srValue}
        </>
      )}
      {supporting ? <div className="text-sm text-muted-foreground">{supporting}</div> : null}
    </div>
  )
}
