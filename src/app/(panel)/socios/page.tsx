import type { Metadata } from 'next'
import { requirePanelAccess } from '@/controllers/session.controller'
import { getPadron } from '@/controllers/members.controller'
import { listDisciplines } from '@/models/catalogs.model'
import { MemberListView } from '@/views/members/member-list-view'
import type { MemberFilters, MemberStatus, MemberSummary, Page } from '@/models/types'

export const metadata: Metadata = { title: 'Socios — Club Naranja y Blanco' }

const LIST_PAGE_SIZE = 50
const MAX_ACCUMULATED_PAGES = 40

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseFilters(sp: SearchParams): MemberFilters {
  const q = firstValue(sp.q)?.trim()
  const categoryIdRaw = firstValue(sp.categoryId)
  const disciplineIdRaw = firstValue(sp.disciplineId)
  const statusRaw = firstValue(sp.status)
  const memberTypeRaw = firstValue(sp.memberType)

  const categoryId = categoryIdRaw ? Number(categoryIdRaw) : undefined
  const disciplineId = disciplineIdRaw ? Number(disciplineIdRaw) : undefined
  const status: MemberStatus | 'all' | undefined = statusRaw === 'inactive' || statusRaw === 'all' ? statusRaw : undefined
  const memberType = memberTypeRaw === 'practicing' || memberTypeRaw === 'non_practicing' ? memberTypeRaw : undefined

  return {
    q: q || undefined,
    categoryId: categoryId != null && Number.isFinite(categoryId) ? categoryId : undefined,
    disciplineId: disciplineId != null && Number.isFinite(disciplineId) ? disciplineId : undefined,
    status,
    memberType,
    limit: LIST_PAGE_SIZE,
  }
}

/**
 * "Ver más" acumulado en el servidor: `members.actions.ts` (B2) no expone
 * una lectura como Server Action, así que en vez de pedir una nueva acción
 * fuera de mi lane, cada click en "Ver más" solo sube `pages` en la URL y la
 * page vuelve a encadenar el keyset desde el principio esa cantidad de
 * veces. Con `LIST_PAGE_SIZE=50` y el tope contractual de 1.000 socios, son
 * como mucho 20 tandas — `MAX_ACCUMULATED_PAGES` deja margen sin abrir la
 * puerta a un `pages` arbitrariamente grande escrito a mano en la URL.
 */
async function loadAccumulatedPage(filters: MemberFilters, pageCount: number): Promise<Page<MemberSummary>> {
  let cursor: string | undefined
  let items: MemberSummary[] = []
  let nextCursor: string | null = null

  for (let i = 0; i < pageCount; i++) {
    const page = await getPadron({ ...filters, cursor })
    items = items.concat(page.items)
    nextCursor = page.nextCursor
    if (!nextCursor) break
    cursor = nextCursor
  }

  return { items, nextCursor }
}

export default async function SociosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const session = await requirePanelAccess()
  // Solo lectura defensiva: `(panel)/layout.tsx` ya garantiza sesión y rol
  // activo antes de renderizar esta page. `consulta` es el fallback de
  // menor privilegio si por algún motivo `role` llegara null acá.
  const role = session?.role ?? 'consulta'

  const filters = parseFilters(sp)
  const pagesRaw = Number(firstValue(sp.pages) ?? '1')
  const pageCount = Number.isFinite(pagesRaw) && pagesRaw > 0 ? Math.min(Math.trunc(pagesRaw), MAX_ACCUMULATED_PAGES) : 1

  const [page, disciplines] = await Promise.all([loadAccumulatedPage(filters, pageCount), listDisciplines()])

  return <MemberListView page={page} pageCount={pageCount} disciplines={disciplines} role={role} filters={filters} />
}
