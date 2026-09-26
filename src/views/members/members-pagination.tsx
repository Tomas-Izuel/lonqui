'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Pagination } from '@/views/shared/pagination'

/**
 * "Ver más" del padrón. `members.actions.ts` (B2) no expone una lectura como
 * Server Action — solo `getPadron` del controller, que es `server-only` y no
 * se puede llamar desde un Client Component. En vez de pedir una nueva acción
 * (fuera de mi lane), la page (Server Component) acumula tandas de
 * `getPadron` encadenando el keyset internamente: acá solo incrementamos
 * `pages` en la URL, que dispara un nuevo render de la page con una tanda
 * más. Documentado en el dev log: cambiar un filtro no resetea `pages`
 * (F1's `FilterBar`/`SearchInput` solo limpian `cursor`, que acá no se usa),
 * así que tras filtrar se puede ver más de una página de una — inofensivo a
 * la escala del club (200–250 socios), nunca resultados incorrectos.
 */
export function MembersPagination({ nextCursor, currentPages }: { nextCursor: string | null; currentPages: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleLoadMore() {
    const params = new URLSearchParams(searchParams)
    params.set('pages', String(currentPages + 1))
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return <Pagination nextCursor={nextCursor} onLoadMore={handleLoadMore} />
}
