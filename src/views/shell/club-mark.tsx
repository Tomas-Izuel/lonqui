import Image from 'next/image'

import { cn } from '@/lib/utils'

/**
 * Escudo del club. El PNG (465×512, transparente) trae su propia forma, así que
 * no lleva caja ni fondo de marca: el cuadrado de cada tamaño es solo el
 * contenedor que reserva el lugar, y `object-contain` deja el escudo entero
 * sin deformarlo (no es cuadrado). Es decorativo (`alt=""`): en todos los usos
 * el nombre del club se renderiza al lado, y repetirlo sería ruido para el
 * lector de pantalla. Se sirve tal cual desde /public: el archivo ya está
 * dimensionado para el uso más grande (lg), así que no hace falta `priority`.
 */
export function ClubMark({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dimensions = { sm: 'size-7', md: 'size-9', lg: 'size-14' }[size]

  return (
    <Image
      src="/escudo.png"
      alt=""
      width={465}
      height={512}
      className={cn('shrink-0 object-contain', dimensions, className)}
    />
  )
}
