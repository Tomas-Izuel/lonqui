import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { StatusPill, type StatusPillVariant } from '@/views/shared/status-pill'
import { DateTimeText } from '@/views/shared/date-text'
import { cn } from '@/lib/utils'
import { requestStatusLabels } from '@/views/portal/portal-labels'
import type { PortalAccessRequest, PortalRequestStatus } from '@/models/types'

const STATUS_PILL: Record<PortalRequestStatus, StatusPillVariant> = {
  pending: 'in-debt',
  invited: 'up-to-date',
  completed: 'up-to-date',
  rejected: 'member-inactive',
}

const TABS = [
  { status: 'pending', href: '/socios/revision', label: 'Pendientes' },
  { status: 'resolved', href: '/socios/revision?estado=resueltos', label: 'Resueltos' },
] as const

function wantedNames(request: PortalAccessRequest): string {
  if (request.people.length === 0) return 'No indicó a quién quiere ver'
  return request.people.map((p) => `${p.firstName} ${p.lastName}`.trim()).join(', ')
}

/**
 * Lista de Revisión. Muestra lo que alcanza para decidir sin abrir el pedido
 * (quién pide, a quién quiere ver, desde cuándo); la evidencia de los socios
 * sugeridos se calcula al abrirlo, contra el padrón de ese momento.
 */
export function ReviewListView({
  requests,
  status,
  canInviteByCategory,
}: {
  requests: PortalAccessRequest[]
  status: 'pending' | 'resolved'
  canInviteByCategory: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Revisión"
        description="Pedidos de acceso a la app de socios. Cada uno se resuelve invitando al socio correcto o rechazándolo."
        action={
          canInviteByCategory ? (
            <Button asChild variant="outline">
              <Link href="/socios/invitar">Invitar por categoría</Link>
            </Button>
          ) : undefined
        }
      />

      <nav aria-label="Estado de los pedidos" className="flex gap-1 rounded-xl bg-muted p-1">
        {TABS.map((tab) => (
          <Link
            key={tab.status}
            href={tab.href}
            aria-current={tab.status === status ? 'page' : undefined}
            className={cn(
              'flex min-h-11 flex-1 items-center justify-center rounded-lg px-3.5 text-sm font-medium transition-colors',
              tab.status === status ? 'bg-background text-foreground shadow-raised' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {requests.length === 0 ? (
        <Panel>
          <EmptyState
            title={status === 'pending' ? 'No hay pedidos pendientes' : 'Todavía no se resolvió ningún pedido'}
            description={
              status === 'pending'
                ? 'Cuando alguien pida acceso desde la app y no tenga invitación, aparece acá.'
                : 'Los pedidos invitados o rechazados quedan acá, nunca se borran.'
            }
          />
        </Panel>
      ) : (
        <Panel title={status === 'pending' ? `${requests.length} para revisar` : 'Últimos resueltos'}>
          <ul className="-my-2 flex flex-col divide-y divide-border">
            {requests.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/socios/revision/${request.id}`}
                  className="flex min-h-14 items-center gap-3 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">
                      {request.firstName} {request.lastName}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">Quiere ver a: {wantedNames(request)}</span>
                    <span className="text-xs text-muted-foreground">
                      <DateTimeText instant={request.createdAt} />
                      {request.resolvedByName ? ` · Resolvió ${request.resolvedByName}` : ''}
                    </span>
                  </div>
                  {status === 'resolved' ? (
                    <StatusPill variant={STATUS_PILL[request.status]}>{requestStatusLabels[request.status]}</StatusPill>
                  ) : request.status === 'invited' ? (
                    // `invitationLive` false: todas las invitaciones murieron (venció o se anuló).
                    request.invitationLive === false ? (
                      <StatusPill variant="in-debt">Invitación vencida</StatusPill>
                    ) : (
                      <StatusPill variant="up-to-date">Invitación vigente</StatusPill>
                    )
                  ) : null}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
