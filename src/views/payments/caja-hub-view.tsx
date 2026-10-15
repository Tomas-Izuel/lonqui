'use client'

import Link from 'next/link'
import { Banknote, HandCoins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/views/shared/page-header'
import { Panel } from '@/views/shared/panel'
import { HeroFigure } from '@/views/shared/hero-figure'
import { Amount } from '@/views/shared/money'
import { CajaTabs } from '@/views/payments/caja-tabs'
import { DailyCollectionChart, DailyCollectionTableHidden } from '@/views/payments/daily-collection-chart'
import { useOverlayParam } from '@/views/shared/overlay-params'
import { EditInSettingsLink } from '@/views/shared/edit-in-settings-link'
import { SETTINGS_LINKS } from '@/views/settings/settings-links'
import { formatPeriod } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import type { BillingStatus, CashMonthSummary, DailyCollectionPoint, DashboardSummary, Permission } from '@/models/types'

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
 * Cuotas vs. otros ingresos: el desglose de la cifra "Ingresado". Cada
 * etiqueta es un link al listado que la explica y lleva el monto escrito
 * (identidad nunca solo color). Tonos neutros (tinta fuerte / tinta suave):
 * ni el naranja ni los colores de estado, que ya significan otra cosa acá.
 * Los montos vienen de `cash`: no se suma nada en el cliente. Los anchos
 * sí se derivan, porque son geometría, no un total mostrado.
 */
function IncomeSplitBar({ feesCents, otherCents }: { feesCents: number; otherCents: number }) {
  const total = feesCents + otherCents
  if (total <= 0) return null
  const feesPct = (feesCents / total) * 100

  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Cuotas ${formatCentsCompact(feesCents)}, otros ingresos ${formatCentsCompact(otherCents)}`}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-foreground/80" style={{ width: `${feesPct}%` }} />
        <div className="h-full bg-foreground/30" style={{ width: `${100 - feesPct}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
        <Link href="/caja/cuotas" className="flex min-h-11 items-center gap-1.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span aria-hidden className="size-2 rounded-full bg-foreground/80" />
          Cuotas <Amount cents={feesCents} className="font-medium" />
        </Link>
        <Link href="/caja/ingresos" className="flex min-h-11 items-center gap-1.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span aria-hidden className="size-2 rounded-full bg-foreground/30" />
          Otros ingresos <Amount cents={otherCents} className="font-medium" />
        </Link>
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
 * Hub de `/caja` (route-caja.md). Cero data fetching: todo llega resuelto de
 * la page. Dos cifras héroe de igual peso (excepción explícita del brief
 * 2026-10-13): lo ingresado total y lo cobrado en cuotas contra la deuda.
 * Ninguna suma de centavos acá: todo total mostrado viene de `cash`.
 */
export function CajaHubView({
  cash,
  summary,
  billing,
  daily,
  permissions,
}: {
  cash: CashMonthSummary
  summary: DashboardSummary
  billing: BillingStatus
  daily: DailyCollectionPoint[]
  permissions: Permission[]
}) {
  const canRegisterPayment = permissions.includes('payments.register')
  const canRegisterIncome = permissions.includes('income.register')
  const paymentOverlay = useOverlayParam('pagar')
  const incomeOverlay = useOverlayParam('ingreso')
  const periodLabel = formatPeriod(cash.period)
  const totalCount = cash.paymentsCount + cash.otherIncomeCount

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Caja" description="Lo que ingresó al club y cómo viene la cobranza del mes." />
      <CajaTabs />

      {canRegisterPayment || canRegisterIncome ? (
        <div className="flex flex-col gap-2">
          {canRegisterPayment ? (
            <Button type="button" size="lg" className="h-12 w-full" onClick={() => paymentOverlay.set('buscar')}>
              <Banknote aria-hidden />
              Registrar pago
            </Button>
          ) : null}
          {canRegisterIncome ? (
            <Button type="button" variant="outline" size="lg" className="h-12 w-full" onClick={() => incomeOverlay.set('nuevo')}>
              <HandCoins aria-hidden />
              Registrar otro ingreso
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel>
          <div className="flex flex-col gap-4">
            <HeroFigure
              label={`Ingresado en ${periodLabel}`}
              cents={cash.totalCents}
              countUpKey={`caja-hub-total-${cash.period}`}
              supporting={`${totalCount} ${totalCount === 1 ? 'movimiento' : 'movimientos'}, cuotas y otros ingresos`}
            />
            <IncomeSplitBar feesCents={cash.feesCollectedCents} otherCents={cash.otherIncomeCents} />
            <CashTransferBar cashCents={cash.cashCents} transferCents={cash.transferCents} />
          </div>
        </Panel>

        <Panel>
          <div className="flex flex-col gap-4">
            {!billing.active ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">
                  Las cuotas todavía no están activadas: no hay cuotas del mes para comparar, pero se puede registrar un pago igual.
                </p>
                {permissions.includes('billing.configure') && permissions.includes('settings.manage') ? (
                  <EditInSettingsLink href={SETTINGS_LINKS.fees} className="self-start">
                    Activar cuotas
                  </EditInSettingsLink>
                ) : null}
              </div>
            ) : null}
            <HeroFigure
              label="Cobrado en cuotas"
              cents={cash.feesCollectedCents}
              href="/caja/cuotas"
              countUpKey={`caja-hub-fees-${cash.period}`}
              supporting={
                billing.active ? (
                  <span>
                    de <Amount cents={cash.feesCents} /> en cuotas de {periodLabel}
                  </span>
                ) : (
                  `${cash.paymentsCount} ${cash.paymentsCount === 1 ? 'pago' : 'pagos'}`
                )
              }
            />
            {billing.active ? <CollectionRateMeter collectedCents={cash.feesCollectedCents} feesCents={cash.feesCents} /> : null}
            <Link
              href="/caja/deuda"
              className="flex min-h-11 items-center rounded-lg text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span>
                <span className="font-medium tabular-nums">{summary.membersInDebt}</span>{' '}
                {summary.membersInDebt === 1 ? 'socio con deuda' : 'socios con deuda'} ·{' '}
                <Amount cents={summary.totalDebtCents} className="font-medium text-status-in-debt" /> adeudado
              </span>
            </Link>
          </div>
        </Panel>
      </div>

      <Panel title="Ritmo del mes" description="Lo cobrado día a día, acumulado.">
        <div className="flex flex-col gap-4">
          <DailyCollectionChart points={daily} feesCents={billing.active ? cash.feesCents : 0} />
          <DailyCollectionTableHidden points={daily} />
        </div>
      </Panel>

      <Panel
        title="Otros ingresos"
        description={periodLabel}
        action={
          cash.otherIncomeCount > 0 ? (
            <Link href="/caja/ingresos" className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">
              Ver todos
            </Link>
          ) : undefined
        }
      >
        {cash.byConcept.length === 0 && cash.otherIncomeCents === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">Todavía no se registraron otros ingresos en {periodLabel}.</p>
            {canRegisterIncome ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => incomeOverlay.set('nuevo')}>
                <HandCoins aria-hidden />
                Registrar otro ingreso
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted-foreground">Total del mes</span>
              <Amount cents={cash.otherIncomeCents} className="text-lg font-semibold" />
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {cash.byConcept.map((row) => (
                <li key={row.conceptId} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{row.conceptName}</span>
                  <Amount cents={row.amountCents} className="font-medium" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  )
}
