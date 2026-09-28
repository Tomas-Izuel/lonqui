'use client'

import { Banknote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { HeroFigure } from '@/views/shared/hero-figure'
import { Amount } from '@/views/shared/money'
import { CobranzaTabs } from '@/views/payments/cobranza-tabs'
import { DailyCollectionChart, DailyCollectionTableHidden } from '@/views/payments/daily-collection-chart'
import { useOverlayParam } from '@/views/shared/overlay-params'
import { formatPeriod } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import type { BillingStatus, DailyCollectionPoint, MonthCollection, Permission } from '@/models/types'

/**
 * Efectivo vs. transferencia: dos segmentos con etiqueta directa (amount +
 * nombre del medio) en vez de una leyenda aparte — a solo dos series, una
 * leyenda separada es una indirección de más (dataviz: "identidad nunca solo
 * color", ya cubierto acá con el texto de cada etiqueta). `chart-brand` (la
 * marca del club) para efectivo, tinta para transferencia: ninguno es un
 * color de estado, así que no se pisan con "al día"/"en deuda".
 */
function CashTransferBar({ cashCents, transferCents }: { cashCents: number; transferCents: number }) {
  const total = cashCents + transferCents
  if (total <= 0) return null
  const cashPct = (cashCents / total) * 100

  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Efectivo ${formatCentsCompact(cashCents)}, transferencia ${formatCentsCompact(transferCents)}`}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-chart-brand" style={{ width: `${cashPct}%` }} />
        <div className="h-full bg-foreground/70" style={{ width: `${100 - cashPct}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-chart-brand" />
          Efectivo <Amount cents={cashCents} className="font-medium" />
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-foreground/70" />
          Transferencia <Amount cents={transferCents} className="font-medium" />
        </span>
      </div>
    </div>
  )
}

/**
 * "% de las cuotas del mes cobrado" (agregado de alcance 1): mismo lenguaje
 * visual que el medidor del inicio (relleno de estado "cobrado", riel del
 * mismo tono más claro), reescrito acá porque `dashboard/` no se importa
 * desde `payments/` (slices sin archivos compartidos).
 */
function CollectionRateMeter({ collectedCents, feesCents }: { collectedCents: number; feesCents: number }) {
  const pct = feesCents > 0 ? Math.round((collectedCents / feesCents) * 100) : null
  const barWidth = pct == null ? 0 : Math.min(pct, 100)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Cuotas del mes cobradas</span>
        <span className="font-medium tabular-nums">{pct != null ? `${pct}%` : 'Sin cuotas'}</span>
      </div>
      <div
        role="img"
        aria-label={pct != null ? `${pct}% de las cuotas del mes cobrado` : 'Todavía no se generaron las cuotas de este mes'}
        className="h-2 w-full overflow-hidden rounded-full bg-status-up-to-date/15"
      >
        <div className="h-full rounded-full bg-status-up-to-date transition-[width] duration-300" style={{ width: `${barWidth}%` }} />
      </div>
    </div>
  )
}

/**
 * Hub de `/cobranza` (route-cobranza.md). Cero data fetching: todo llega
 * resuelto de la page. El buscador que antes vivía acá (una lista de
 * resultados con `<Link>` a `/cobranza/nuevo`) desapareció: "Registrar pago"
 * ahora abre el overlay global (`PaymentOverlayHost`, `?pagar=buscar`) sobre
 * esta misma pantalla — la redirección que Tomás señaló ("muchas
 * redirecciones") ya no existe para el flujo más usado del sistema.
 */
export function CobranzaHubView({
  collection,
  billing,
  daily,
  permissions,
}: {
  collection: MonthCollection
  billing: BillingStatus
  daily: DailyCollectionPoint[]
  permissions: Permission[]
}) {
  const canRegister = permissions.includes('payments.register')
  const paymentOverlay = useOverlayParam('pagar')
  const periodLabel = formatPeriod(collection.period)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Cobranza" description="Registrá pagos y mirá cómo viene el mes." />
      <CobranzaTabs />

      {canRegister ? (
        <Button type="button" size="lg" className="h-12 w-full" onClick={() => paymentOverlay.set('buscar')}>
          <Banknote aria-hidden />
          Registrar pago
        </Button>
      ) : null}

      <Panel title="Este mes" description={periodLabel}>
        <div className="flex flex-col gap-4">
          {!billing.active ? (
            <p className="text-sm text-muted-foreground">
              Las cuotas todavía no están activadas: no hay cuotas del mes para comparar, pero se puede registrar un pago igual.
            </p>
          ) : null}
          <HeroFigure
            label={`Cobrado en ${periodLabel}`}
            cents={collection.collectedCents}
            href="/cobranza/pagos"
            countUpKey={`cobranza-hub-${collection.period}`}
            supporting={
              billing.active ? (
                <span>
                  <Amount cents={collection.feesCents} /> en cuotas de {periodLabel} · {collection.paymentsCount}{' '}
                  {collection.paymentsCount === 1 ? 'pago' : 'pagos'}
                </span>
              ) : (
                `${collection.paymentsCount} ${collection.paymentsCount === 1 ? 'pago' : 'pagos'}`
              )
            }
          />
          {billing.active ? <CollectionRateMeter collectedCents={collection.collectedCents} feesCents={collection.feesCents} /> : null}
          <CashTransferBar cashCents={collection.cashCents} transferCents={collection.transferCents} />
        </div>
      </Panel>

      <Panel title="Ritmo del mes" description="Lo cobrado día a día, acumulado.">
        <div className="flex flex-col gap-4">
          <DailyCollectionChart points={daily} feesCents={billing.active ? collection.feesCents : 0} />
          <DailyCollectionTableHidden points={daily} />
        </div>
      </Panel>
    </div>
  )
}
