'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SETTINGS_LINKS } from '@/views/settings/settings-links'
import { EmptyState, ErrorState, LoadingList } from '@/views/shared/states'
import { SuccessMoment } from '@/views/shared/success-moment'
import { useHasPermission } from '@/views/shell/panel-session'
import { IncomeForm } from '@/views/income/income-form'
import { DURATION } from '@/views/shared/motion'
import { getIncomeFormData } from '@/controllers/income.actions'
import type { IncomeFormData } from '@/models/types'

type State = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: IncomeFormData }

/**
 * Contenido del overlay de ingreso: pide `getIncomeFormData` (Server Action)
 * al montarse, y renderiza el formulario. Al registrar, muestra el momento
 * autorado (`SuccessMoment`, el mismo de pagos) el tiempo de `DURATION.focal`
 * y recién ahí cierra + refresca; el toast ya lo dispara `IncomeForm`.
 */
export function IncomeFormBody({ sponsorId, onDone }: { sponsorId?: number; onDone: () => void }) {
  const router = useRouter()
  const canManageSettings = useHasPermission('settings.manage')
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [successAmountCents, setSuccessAmountCents] = useState<number | null>(null)
  const closeTimeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(closeTimeoutRef.current), [])

  useEffect(() => {
    let cancelled = false
    getIncomeFormData()
      .then((result) => {
        if (cancelled) return
        setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', error: result.error })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', error: 'No pudimos cargar el formulario. Revisá tu conexión.' })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  function handleSuccess(amountCents: number) {
    setSuccessAmountCents(amountCents)
    // El check queda visible un instante antes de cerrar de verdad: cerrar de
    // una desaparecería el sheet antes de que nadie vea la confirmación.
    closeTimeoutRef.current = window.setTimeout(() => {
      onDone()
      router.refresh()
    }, DURATION.focal * 1000)
  }

  if (successAmountCents != null) return <SuccessMoment amountCents={successAmountCents} label="Ingreso registrado" />

  if (state.status === 'loading') return <LoadingList rows={3} />

  if (state.status === 'error') {
    return (
      <ErrorState
        title="No pudimos abrir el formulario"
        description={state.error}
        action={
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              setState({ status: 'loading' })
              setAttempt((n) => n + 1)
            }}
          >
            Reintentar
          </Button>
        }
      />
    )
  }

  if (state.data.concepts.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay conceptos de ingreso"
        description={
          canManageSettings
            ? 'Cargá al menos uno en Ajustes (por ejemplo Sponsor o Indumentaria) para poder registrar ingresos.'
            : 'Pedile a Tesorería que cargue los conceptos de ingreso en Ajustes.'
        }
        action={
          canManageSettings ? (
            <Button asChild variant="outline" className="h-11">
              <Link href={SETTINGS_LINKS.cash}>Cargar conceptos</Link>
            </Button>
          ) : undefined
        }
      />
    )
  }

  return <IncomeForm data={state.data} initialSponsorId={sponsorId} onSuccess={handleSuccess} />
}
