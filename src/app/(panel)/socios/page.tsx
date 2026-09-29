import type { Metadata } from 'next'
import { requirePanelAccess } from '@/controllers/session.controller'
import { getPadron } from '@/controllers/members.controller'
import { listDisciplines } from '@/models/catalogs.model'
import { PADRON_PAGE_SIZE } from '@/models/members.model'
import { getBillingStatus } from '@/models/billing.model'
import { MemberListView } from '@/views/members/member-list-view'
import type { MemberFilters, MemberStatus } from '@/models/types'

export const metadata: Metadata = { title: 'Socios — Lonqui' }

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * SIN `limit`: este objeto viaja tal cual a `MemberListView` → `MemberList`
 * (Client Component) y de ahí a la Server Action `loadMoreMembers`, cuyo
 * `memberFiltersSchema` es `.strict()` y no tiene ese campo — antes lo
 * rechazaba siempre y "Ver más" nunca funcionaba (03-review.md, segunda
 * pasada, R1). El tamaño de página lo decide el servidor (`PADRON_PAGE_SIZE`,
 * `members.model.ts`), nunca un `limit` que arrastre el cliente.
 */
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
  const debtRaw = firstValue(sp.debt)
  const debt = debtRaw === 'up_to_date' || debtRaw === 'in_debt' ? debtRaw : undefined

  return {
    q: q || undefined,
    categoryId: categoryId != null && Number.isFinite(categoryId) ? categoryId : undefined,
    disciplineId: disciplineId != null && Number.isFinite(disciplineId) ? disciplineId : undefined,
    status,
    memberType,
    debt,
  }
}

export default async function SociosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const session = await requirePanelAccess()

  const filters = parseFilters(sp)

  // `getBillingStatus()` es una lectura plana de `billing.model.ts`, sin
  // controller (01-tasks.md, F2): solo decide si el filtro de deuda del
  // padrón se muestra habilitado, no arma ningún estado de cuenta acá.
  //
  // Solo la primera tanda (03-review.md, major 5): "Ver más" ya no pasa por
  // acá — lo resuelve `MemberList` (Client Component) llamando a la Server
  // Action `loadMoreMembers` y acumulando en su propio estado, sin volver a
  // disparar esta page ni su `loading.tsx`. `limit` va SOLO en este objeto
  // nuevo, nunca mezclado en `filters` (que sigue de largo hacia el cliente).
  const [page, disciplines, billing] = await Promise.all([
    getPadron({ ...filters, limit: PADRON_PAGE_SIZE }),
    listDisciplines(),
    getBillingStatus(),
  ])

  return <MemberListView page={page} disciplines={disciplines} permissions={session.permissions} filters={filters} billing={billing} />
}
