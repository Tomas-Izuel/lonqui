import Link from 'next/link'
import { Amount } from '@/views/shared/money'
import { HeroFigure } from '@/views/shared/hero-figure'
import { collectionPct } from '@/views/dashboard/dashboard-helpers'
import { formatPeriod } from '@/lib/dates'
import type { DashboardSummary } from '@/models/types'

/**
 * Ronda 2 (revisión del coordinador sobre capturas reales): el panel "Este
 * mes" (efectivo/transferencia/cantidad de pagos) repetía información que ya
 * vive acá — se borró entero y este desglose ocupa su lugar, como una barra
 * FINA de 2 segmentos bajo el medidor con la etiqueta directa en texto
 * (dataviz: "un solo ratio → meter"; acá son dos magnitudes que suman el
 * cobrado, así que es categórico de 2 series — naranja institucional
 * (`--color-chart-brand`, marca no textual) para efectivo, tinta secundaria
 * para transferencia, orden fijo, nunca una leyenda aparte porque el texto de
 * abajo YA nombra cada segmento con su monto exacto).
 */
function CashTransferBreakdown({ summary }: { summary: DashboardSummary }) {
  const total = summary.cashCents + summary.transferCents
  const cashPct = total > 0 ? (summary.cashCents / total) * 100 : 0
  const transferPct = total > 0 ? 100 - cashPct : 0

  return (
    <div className="mt-2.5 flex flex-col gap-1.5 border-t border-foreground/10 pt-2.5">
      <div aria-hidden className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full bg-chart-brand" style={{ width: `${cashPct}%` }} />
        <div className="h-full bg-muted-foreground" style={{ width: `${transferPct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        Efectivo <Amount cents={summary.cashCents} className="font-medium text-foreground" /> · Transferencia{' '}
        <Amount cents={summary.transferCents} className="font-medium text-foreground" /> · {summary.paymentsCount}{' '}
        {summary.paymentsCount === 1 ? 'pago' : 'pagos'}
      </p>
    </div>
  )
}

/**
 * Un medidor lineal de "% de las cuotas del mes cobrado" (skill `dataviz`,
 * "un solo ratio contra un límite → Meter"): el relleno lleva el color de
 * estado que ya usa toda la app para "cobrado" (`--color-status-up-to-date`)
 * y el riel es el mismo tono más claro (opacidad, no un segundo hue) — nunca
 * un color inventado para esta única barra. Puede pasar el 100% (se cobran
 * meses viejos con el pago de hoy, route.md): el relleno se recorta a 100%
 * de ancho, el número real (que puede leer "134%") es lo que comunica el
 * excedente, no la barra. Debajo, el desglose efectivo/transferencia
 * (`CashTransferBreakdown`, ronda 2).
 */
function CollectionMeter({ summary }: { summary: DashboardSummary }) {
  const period = formatPeriod(summary.period)
  const pct = collectionPct(summary)
  const barWidth = pct == null ? 0 : Math.min(pct, 100)

  return (
    <Link
      href={`/cobranza/pagos?mes=${summary.period}`}
      className="group -m-2 flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg p-2 outline-none hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-72"
    >
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Cobrado en {period}</span>
        <span className="font-medium tabular-nums text-foreground">{pct != null ? `${pct}%` : 'Sin cuotas'}</span>
      </div>
      {/* Decorativo: el % ya está en el texto de arriba y el detalle en pesos
          abajo — un segundo rol/etiqueta acá solo duplicaría el anuncio. */}
      <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-status-up-to-date/15">
        <div className="h-full rounded-full bg-status-up-to-date transition-[width] duration-300" style={{ width: `${barWidth}%` }} />
      </div>
      <div className="flex flex-wrap items-baseline gap-1 text-xs text-muted-foreground">
        <Amount cents={summary.collectedCents} className="font-medium text-foreground" />
        <span>de</span>
        <Amount cents={summary.feesCents} />
        <span>en cuotas</span>
      </div>
      <CashTransferBreakdown summary={summary} />
    </Link>
  )
}

/**
 * La plata del inicio (D4/§8 de `00-architecture.md`): "Deuda total" es la
 * ÚNICA cifra hero de la página (`HeroFigure`, ≥48px, contrato C3) y el
 * medidor de cobranza del mes va al lado, secundario — nunca una segunda
 * cifra del mismo tamaño (eso sería la grilla de métrica-héroe que el piso
 * de calidad prohíbe). Las dos viven en un único bloque sobre
 * `bg-brand-soft` (la marca del club sin texto naranja encima, DESIGN.md):
 * es la única superficie de todo el panel que no es blanca, a propósito,
 * para que el primer vistazo a 390px aterrice acá.
 *
 * No reutiliza `Panel` (que fuerza `bg-card` blanco): reproduce su mismo
 * lenguaje visual (borde, radio, sombra) sobre `bg-brand-soft` — no es un
 * panel anidado, es el único bloque de nivel superior con este tratamiento.
 */
export function MoneySummaryStrip({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border/70 bg-brand-soft p-4 shadow-raised sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <HeroFigure
        label="Deuda total"
        cents={summary.totalDebtCents}
        href="/cobranza/deuda"
        countUpKey="inicio-deuda-total"
        tone="debt"
        supporting={
          summary.membersInDebt > 0
            ? `${summary.membersInDebt} ${summary.membersInDebt === 1 ? 'socio debe' : 'socios deben'}`
            : 'Ningún socio activo debe'
        }
      />
      <CollectionMeter summary={summary} />
    </section>
  )
}
