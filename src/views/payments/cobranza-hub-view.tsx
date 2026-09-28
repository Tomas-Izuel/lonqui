import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { SearchInput } from '@/views/shared/search-input'
import { Amount } from '@/views/shared/money'
import { EmptyState } from '@/views/shared/states'
import { formatPeriod } from '@/lib/dates'
import type { BillingStatus, MemberSummary, MonthCollection, Permission } from '@/models/types'

type HubLink = { href: string; label: string }

const LISTING_LINKS: HubLink[] = [
  { href: '/cobranza/pagos', label: 'Pagos del mes' },
  { href: '/cobranza/deuda', label: 'Con deuda' },
  { href: '/cobranza/al-dia', label: 'Al día' },
  { href: '/cobranza/por-categoria', label: 'Deuda por categoría' },
]

function HubRow({ href, label }: HubLink) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-11 items-center justify-between gap-3 px-3 py-3 hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <span className="font-medium">{label}</span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Hub de `/cobranza` (route-cobranza.md). Cero data fetching: `collection`,
 * `billing` y `searchResults` llegan resueltos de la page. El buscador de
 * socio escribe `?q=` (mismo `SearchInput` que `/socios`) y la page vuelve a
 * pedir el padrón filtrado — no hay combobox propio: es el mismo patrón ya
 * establecido en el resto del panel, no uno nuevo para esta pantalla.
 */
export function CobranzaHubView({
  collection,
  billing,
  permissions,
  q,
  searchResults,
}: {
  collection: MonthCollection
  billing: BillingStatus
  permissions: Permission[]
  q?: string
  searchResults: MemberSummary[] | null
}) {
  const canRegister = permissions.includes('payments.register')
  const periodLabel = formatPeriod(collection.period)
  const percent = collection.feesCents > 0 ? Math.round((collection.collectedCents / collection.feesCents) * 100) : null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Cobranza" description="Registrá pagos y mirá cómo viene el mes." />

      {canRegister ? (
        <Panel title="Registrar pago" description="Buscá al socio para cargar su pago.">
          <div className="flex flex-col gap-3">
            <SearchInput placeholder="Buscar por nombre o DNI…" autoFocus />
            {q ? (
              searchResults && searchResults.length > 0 ? (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {searchResults.map((member) => (
                    <li key={member.id}>
                      <Link
                        href={`/cobranza/nuevo?socio=${member.id}&volver=${encodeURIComponent('/cobranza')}`}
                        className="flex min-h-11 items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{member.fullName}</span>
                          <span className="text-xs text-muted-foreground">{member.dni ?? 'DNI pendiente'}</span>
                        </span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No encontramos socios" description={`Sin resultados para "${q}".`} />
              )
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="Este mes" description={periodLabel}>
        {!billing.active ? (
          <p className="text-sm text-muted-foreground">Las cuotas todavía no están activadas: no hay cuotas del mes para comparar.</p>
        ) : null}
        <div className="flex flex-col divide-y divide-border">
          <StatRow label={`Cobrado en ${periodLabel}`} value={<Amount cents={collection.collectedCents} />} />
          {billing.active ? (
            <>
              <StatRow label={`Cuotas de ${periodLabel}`} value={<Amount cents={collection.feesCents} />} />
              <StatRow label="Del valor de las cuotas del mes" value={percent != null ? `${percent}%` : '—'} />
            </>
          ) : null}
          <StatRow label="Efectivo" value={<Amount cents={collection.cashCents} />} />
          <StatRow label="Transferencia" value={<Amount cents={collection.transferCents} />} />
          <StatRow label="Cantidad de pagos" value={collection.paymentsCount} />
        </div>
      </Panel>

      <Panel title="Listados">
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {LISTING_LINKS.map((link) => (
            <HubRow key={link.href} {...link} />
          ))}
        </ul>
      </Panel>
    </div>
  )
}
