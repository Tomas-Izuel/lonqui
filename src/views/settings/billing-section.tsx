'use client'

import { useState, useTransition } from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { PeriodText } from '@/views/shared/date-text'
import { ActivateBillingSheet } from '@/views/settings/activate-billing-sheet'
import { BillingRunsList } from '@/views/settings/billing-runs-list'
import { generatePendingFees } from '@/controllers/billing.actions'
import type { BillingStatus } from '@/models/types'

export type BillingSectionProps = {
  billing: BillingStatus
  /** Si no hay valor por defecto, "Activar cuotas" queda deshabilitado con el motivo escrito (D18: el orden de carga es valor por defecto → activar → saldos de arranque). */
  hasDefaultFeePrice: boolean
}

/**
 * Panel "Cuotas" (route-ajustes.md, F4, T1): estado de la facturación, aviso
 * de una corrida fallida o ausente con "Reintentar", y las últimas corridas
 * plegadas. Todo detrás de `billing.configure` (solo lo alcanza esta page,
 * ya detrás de `(admin)/layout.tsx` y de `getSettingsPage()` — ver dev log).
 */
export function BillingSection({ billing, hasDefaultFeePrice }: BillingSectionProps) {
  const [activateOpen, setActivateOpen] = useState(false)
  const [generating, startGenerating] = useTransition()

  const notice = billing.currentPeriodRun === 'failed' || billing.currentPeriodRun === 'missing'

  function handleGenerate() {
    startGenerating(async () => {
      const result = await generatePendingFees()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const { generated } = result.data
      toast.success(generated > 0 ? `Se generaron ${generated} ${generated === 1 ? 'cuota' : 'cuotas'}.` : 'No había cuotas pendientes para generar.')
    })
  }

  return (
    <Panel title="Cuotas" description="Generación mensual automática y su historial.">
      <div className="flex flex-col gap-4">
        {!billing.active ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              El orden es: primero un valor de cuota por defecto (arriba), después activar desde qué mes se cobra.
            </p>
            <Button
              onClick={() => setActivateOpen(true)}
              disabled={!hasDefaultFeePrice}
              className="h-11 w-fit"
            >
              Activar cuotas
            </Button>
            {!hasDefaultFeePrice ? (
              <p className="text-sm text-muted-foreground">Cargá primero un valor de cuota por defecto para poder activar.</p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Los dos hechos que Tesorería busca primero acá, con más peso
                que antes (`text-base font-semibold`, antes `text-sm
                font-medium`): "¿está activo?" y "¿hasta cuándo generó?" son
                la clarity que pidió Tomás para esta sección. */}
            <dl className="grid grid-cols-1 gap-4 rounded-lg bg-muted/40 p-3 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Activas desde</dt>
                <dd className="text-base font-semibold tabular-nums">
                  <PeriodText period={billing.startPeriod!} />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Último mes generado</dt>
                <dd className="text-base font-semibold tabular-nums">
                  {billing.lastGeneratedPeriod ? <PeriodText period={billing.lastGeneratedPeriod} /> : 'Todavía ninguno'}
                </dd>
              </div>
            </dl>

            {notice ? (
              <div role="alert" className="flex flex-col gap-2 rounded-lg border border-status-in-debt/30 bg-status-in-debt/5 p-3">
                <div className="flex items-start gap-2">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-in-debt" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">
                      No se generaron las cuotas de <PeriodText period={billing.currentPeriod} />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {billing.lastRun?.errorMessage ?? 'No corrió ninguna generación automática este mes.'}
                    </p>
                  </div>
                </div>
                <Button size="sm" onClick={handleGenerate} disabled={generating} className="h-11 w-fit">
                  {generating ? <Loader2 aria-hidden className="animate-spin" /> : null}
                  {generating ? 'Generando…' : 'Reintentar'}
                </Button>
              </div>
            ) : billing.pendingPeriods.length > 0 ? (
              <Button onClick={handleGenerate} disabled={generating} variant="outline" className="h-11 w-fit">
                {generating ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {generating
                  ? 'Generando…'
                  : `Generar cuotas ahora (${billing.pendingPeriods.length} ${billing.pendingPeriods.length === 1 ? 'pendiente' : 'pendientes'})`}
              </Button>
            ) : null}
          </div>
        )}

        <BillingRunsList runs={billing.recentRuns} />
      </div>

      <ActivateBillingSheet open={activateOpen} onOpenChange={setActivateOpen} billing={billing} />
    </Panel>
  )
}
