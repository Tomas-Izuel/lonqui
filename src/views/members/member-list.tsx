'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { Pagination } from '@/views/shared/pagination'
import { EmptyState } from '@/views/shared/states'
import { DebtStatusPill, MemberStatusPill } from '@/views/shared/status-pill'
import { Dni } from '@/views/shared/dni'
import { MedicalClearanceNotice } from '@/views/members/medical-clearance-notice'
import { Amount } from '@/views/shared/money'
import { categoriesLabel } from '@/views/payments/account-format'
import { useOverlayParam, isPlainLeftClick } from '@/views/shared/overlay-params'
import { loadMoreMembers } from '@/controllers/members.actions'
import type { MemberFilters, MemberSummary, Page } from '@/models/types'

/**
 * "Fútbol masculino · 5ta, Vóley · Sub 18" o "No practicante" (Revisión 3,
 * §13.2): un socio puede jugar más de un deporte, así que ya no hay un único
 * par disciplina/categoría. `categoriesLabel` es la misma función que usa
 * `PaymentForm` (F1, `account-format.ts`) para el mismo texto.
 */
function categoryLabel(member: MemberSummary): string {
  return categoriesLabel(member.categories)
}

/** "3 meses · $30.000" / "Saldo a favor $5.000" / "Al día". Solo con `payments.read` (`debtStatus` viene undefined si no). */
function debtMeta(member: MemberSummary): React.ReactNode {
  if (member.debtStatus == null) return null
  if (member.debtStatus === 'in_debt') {
    return (
      <span className="text-xs text-muted-foreground">
        {member.monthsDue} {member.monthsDue === 1 ? 'mes' : 'meses'} · <Amount cents={member.balanceCents ?? 0} />
      </span>
    )
  }
  if (member.debtStatus === 'credit') {
    return (
      <span className="text-xs text-muted-foreground">
        Saldo a favor <Amount cents={Math.abs(member.balanceCents ?? 0)} />
      </span>
    )
  }
  return null
}

/**
 * Lista del padrón con "Ver más" acumulado en el cliente (03-review.md, major
 * 5): antes cada click re-encadenaba el keyset entero desde el principio vía
 * `pages` en la URL, con hasta 20 viajes a Postgres por click y un
 * `loading.tsx` de página completa en cada uno. Ahora "Ver más" llama
 * `loadMoreMembers` (Server Action de solo lectura) y junta el resultado al
 * estado ya montado — mismo patrón que `AuditList` en /auditoria.
 *
 * `filters` NUNCA lleva `cursor`: lo agrega este componente en cada pedido.
 * El padre (`MemberListView`) le pone a esta lista una `key` derivada de los
 * filtros (sin cursor) para remontarla con estado fresco cuando cambia un
 * filtro real, y dejarla montada (acumulando) cuando lo único que cambia es
 * "Ver más".
 */
export function MemberList({
  initialPage,
  filters,
  canCreate,
  hasActiveFilter,
}: {
  initialPage: Page<MemberSummary>
  filters: MemberFilters
  canCreate: boolean
  hasActiveFilter: boolean
}) {
  const [state, setState] = useState<{ items: MemberSummary[]; nextCursor: string | null }>({
    items: initialPage.items,
    nextCursor: initialPage.nextCursor,
  })
  const [loadError, setLoadError] = useState<string | null>(null)
  const quickView = useOverlayParam('ver')

  /**
   * La fila sigue siendo un `<a href="/socios/[id]">` real, tanto en la fila
   * apilable como en cada celda de la tabla (`DataList`, sin tocar) — clic
   * medio, Cmd/Ctrl+click y lectores de pantalla siguen yendo directo a la
   * ficha completa, porque esos gestos nunca disparan este `click` (D2,
   * `00-architecture.md`). Un click plano sí: se intercepta en captura
   * (antes de que el propio `Link` navegue) y abre la vista rápida en su
   * lugar — mismo patrón que usa `next/link` para no robarle los
   * modificadores al navegador, documentado en `isPlainLeftClick`.
   */
  function handleRowClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!isPlainLeftClick(event)) return
    const anchor = (event.target as HTMLElement).closest('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    const match = /^\/socios\/(\d+)$/.exec(anchor.getAttribute('href') ?? '')
    if (!match) return
    event.preventDefault()
    quickView.set(match[1])
  }

  async function handleLoadMore(cursor: string) {
    setLoadError(null)
    // Objeto armado a mano, no `filters` tal cual (03-review.md, segunda
    // pasada, R1): `memberFiltersSchema` en el servidor es `.strict()` y
    // rechaza cualquier campo que no espera — en particular `limit`, que
    // `socios/page.tsx` nunca mete acá a propósito, y cualquier `cursor` de
    // arrastre que pudiera colarse. Solo estos cinco viajan.
    const result = await loadMoreMembers({
      filters: {
        q: filters.q,
        categoryId: filters.categoryId,
        disciplineId: filters.disciplineId,
        status: filters.status,
        memberType: filters.memberType,
        debt: filters.debt,
      },
      cursor,
    })
    if (!result.ok) {
      setLoadError(result.error)
      return
    }
    setState((prev) => ({ items: [...prev.items, ...result.data.items], nextCursor: result.data.nextCursor }))
  }

  // El filtro por defecto ya dice "Activos" (route.md): repetir el pill
  // "Activo" en cada fila de esa vista es ruido, no información. Solo se
  // marca lo que se sale de lo esperado — las bajas— o, en la vista "Todos",
  // cualquier estado (ahí sí hace falta distinguir). Fix 7, finish review.
  const showStatusOnActiveView = filters.status === 'inactive' || filters.status === 'all'

  const columns: DataListColumn<MemberSummary>[] = [
    { key: 'name', header: 'Nombre', render: (m) => m.fullName },
    { key: 'dni', header: 'DNI', render: (m) => <Dni dni={m.dni} />, numeric: true },
    { key: 'category', header: 'Categoría', render: (m) => categoryLabel(m) },
    { key: 'status', header: 'Estado', render: (m) => <MemberStatusPill status={m.status} /> },
    { key: 'debt', header: 'Cuenta', render: (m) => (m.debtStatus ? <DebtStatusPill status={m.debtStatus} /> : '—') },
    { key: 'medical', header: 'Apto físico', render: (m) => <MedicalClearanceNotice status={m.medicalClearanceStatus} /> },
  ]

  function renderRow(m: MemberSummary): DataListRow {
    return {
      title: m.fullName,
      subtitle: (
        <span className="flex flex-wrap items-center gap-2">
          <Dni dni={m.dni} />
          <span>{categoryLabel(m)}</span>
        </span>
      ),
      meta: (
        <>
          {showStatusOnActiveView || m.status === 'inactive' ? <MemberStatusPill status={m.status} /> : null}
          {m.debtStatus ? <DebtStatusPill status={m.debtStatus} /> : null}
          {debtMeta(m)}
          <MedicalClearanceNotice status={m.medicalClearanceStatus} />
        </>
      ),
      href: `/socios/${m.id}`,
    }
  }

  const emptyState = hasActiveFilter ? (
    <EmptyState
      title="No encontramos socios"
      description={
        filters.q
          ? `No hay resultados para "${filters.q}" con los filtros aplicados.`
          : 'Ningún socio coincide con los filtros aplicados.'
      }
    />
  ) : (
    <EmptyState
      title="Todavía no hay socios cargados"
      description="Cargá la primera ficha de ingreso para empezar el padrón."
      action={
        canCreate ? (
          <Button asChild>
            <Link href="/socios/nuevo">Cargar ficha de ingreso</Link>
          </Button>
        ) : undefined
      }
    />
  )

  return (
    <div className="flex flex-col gap-3" onClickCapture={handleRowClickCapture}>
      <DataList items={state.items} getKey={(m) => m.id} columns={columns} renderRow={renderRow} emptyState={emptyState} />
      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : null}
      <Pagination nextCursor={state.nextCursor} onLoadMore={handleLoadMore} />
    </div>
  )
}
