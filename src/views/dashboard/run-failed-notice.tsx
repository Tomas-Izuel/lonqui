'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { generatePendingFees } from '@/controllers/billing.actions'
import { formatPeriod } from '@/lib/dates'
import type { BillingStatus } from '@/models/types'

/**
 * Aviso T1: la corrida del mes falló o no corrió. Solo se monta si el
 * llamador ya verificó `currentPeriodRun` en 'failed'/'missing' Y el permiso
 * `billing.configure` — nunca un banner permanente, nunca visible para quien
 * no puede reintentar (route.md, 01-tasks F3). Vive arriba de "Este mes".
 */
export function RunFailedNotice({ billing }: { billing: BillingStatus }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleRetry() {
    setPending(true)
    try {
      const result = await generatePendingFees()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.data.generated > 0
          ? `Se generaron ${result.data.generated} ${result.data.generated === 1 ? 'cuota' : 'cuotas'}.`
          : 'No había cuotas pendientes por generar.',
      )
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  const reason = billing.lastRun?.errorMessage

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-status-in-debt/30 bg-status-in-debt/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-in-debt" />
        <p className="text-sm text-foreground">
          No se generaron las cuotas de {formatPeriod(billing.currentPeriod)}
          {reason ? <span className="text-muted-foreground"> — {reason}</span> : null}.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={handleRetry} disabled={pending}>
        {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
        {pending ? 'Reintentando…' : 'Reintentar'}
      </Button>
    </div>
  )
}
