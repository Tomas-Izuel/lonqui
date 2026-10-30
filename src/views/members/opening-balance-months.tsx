'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingList, EmptyState, ErrorState } from '@/views/shared/states'
import { MonthStrip } from '@/views/payments/month-strip'
import {
  firstJoinedIndex,
  isBeforeStart,
  openingMonthsFromSelection,
  openingScope,
  type Selection,
} from '@/views/payments/month-selection'
import { createOpeningBalanceMonths, getPaymentMonthOptions } from '@/controllers/payments.actions'
import { formatCentsCompact } from '@/lib/money'
import { formatPeriod, periodListLabel } from '@/lib/dates'
import type { ISODate, PaymentMonthOption } from '@/models/types'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; options: PaymentMonthOption[] }

/**
 * "Indicar desde cuándo debía" / "Agregar meses anteriores": la misma tira de
 * meses del formulario de pago, solo con los meses anteriores al sistema. Crea
 * únicamente el saldo anterior, una fila por mes (no registra ningún pago).
 * Tocar un mes fija desde cuándo debía; el tramo llega hasta el último mes
 * previo, y si la fecha de alta es anterior la deuda arranca en el alta. Las
 * celdas y su valor salen de la RPC; el cliente solo arma los meses a enviar.
 */
export function OpeningBalanceMonths({
  memberId,
  joinedOn,
  startPeriod,
  hasOpeningBalance,
  creditCents,
  onCancel,
}: {
  memberId: number
  /** Alta del socio: alimenta el aviso cuando los meses tocados son anteriores. */
  joinedOn: ISODate
  startPeriod: ISODate
  /** Ya tiene meses cargados: cambia el texto cuando no queda nada por agregar. */
  hasOpeningBalance: boolean
  /** Saldo a favor del socio (>= 0): un trigger lo imputa solo a las filas nuevas del saldo anterior, de la más vieja a la más nueva. */
  creditCents: number
  onCancel: () => void
}) {
  const router = useRouter()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [selection, setSelection] = useState<Selection>([])
  const [overrideCents, setOverrideCents] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [totalValid, setTotalValid] = useState(true)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getPaymentMonthOptions({ memberId })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) return setLoad({ status: 'error', message: result.error })
        const options = result.data.filter((o) => o.kind === 'pre_system')
        setLoad({ status: 'ready', options })
        // Si el alta es anterior a algún mes previo, la deuda arranca ahí: viene marcado.
        const joined = firstJoinedIndex(options)
        setSelection(joined === -1 ? [] : [joined])
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error', message: 'No pudimos cargar los meses. Probá de nuevo.' })
      })
    return () => {
      cancelled = true
    }
  }, [memberId, attempt])

  const options = load.status === 'ready' ? load.options : []
  const beforeStart = isBeforeStart(options)
  const months = openingMonthsFromSelection(options, selection, overrideCents ?? undefined)
  const amount = months.reduce((total, m) => total + m.amountCents, 0)
  const hasSpan = months.length > 0
  // Alta posterior a un mes marcado: la deuda arranca en el marcado y se avisa (no bloquea).
  const beforeJoined = selection.some((i) => options[i]?.beforeJoined)
  // Acá no hay pago: el alcance solo rotula el total (siempre de F al último mes previo, sin arrastre).
  const scope = openingScope(options, selection, { openingBalanceOverrideCents: overrideCents, creditCents }, { payment: false })

  function retry() {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasSpan || pending || !totalValid) return
    setPending(true)
    setAmountError(null)
    setFormError(null)
    try {
      const result = await createOpeningBalanceMonths({ memberId, months })
      if (!result.ok) {
        if (result.field === 'amountCents') setAmountError(result.error)
        else setFormError(result.error)
        return
      }
      toast.success('Saldo anterior cargado')
      router.refresh()
      onCancel()
    } catch {
      setFormError('No pudimos cargar el saldo anterior. Probá de nuevo.')
    } finally {
      setPending(false)
    }
  }

  if (load.status === 'loading') return <LoadingList rows={2} />
  if (load.status === 'error') {
    return (
      <ErrorState
        title="No pudimos cargar los meses"
        description={load.message}
        action={
          <Button type="button" variant="outline" className="h-11" onClick={retry}>
            Reintentar
          </Button>
        }
      />
    )
  }
  if (options.length === 0) {
    return (
      <EmptyState
        title={hasOpeningBalance ? 'No quedan meses anteriores para agregar' : 'No hay meses anteriores para indicar'}
        action={
          <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
            Cerrar
          </Button>
        }
      />
    )
  }

  const creditNote =
    creditCents > 0 && amount > 0
      ? creditCents >= amount
        ? `El saldo a favor de ${formatCentsCompact(creditCents)} va a cubrir todo este saldo anterior.`
        : `El saldo a favor de ${formatCentsCompact(creditCents)} va a cubrir parte de este saldo anterior.`
      : null

  return (
    <form onSubmit={onSubmit} noValidate method="post" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {`Tocá el primer mes que debe: la deuda se cuenta desde ahí hasta ${formatPeriod(options[options.length - 1].period)}. Si la fecha de alta es anterior, arranca en la fecha de alta.`}
        {beforeStart ? ` Las cuotas arrancan en ${formatPeriod(startPeriod)}.` : null}
      </p>
      <MonthStrip
        options={options}
        selection={selection}
        onTap={(index) => {
          setAmountError(null)
          setOverrideCents(null)
          setTotalValid(true)
          // Acá no hay pago: el mes tocado es solo "desde cuándo debía". Tocarlo otra vez lo suelta.
          setSelection((current) => (current.length === 1 && current[0] === index ? [] : [index]))
        }}
        joinedWarning={beforeJoined ? { joinedPeriod: `${joinedOn.slice(0, 7)}-01`, memberId } : null}
        variant="default"
        preSystem={{
          open: true,
          scope,
          startPeriod,
          overrideCents,
          onValidityChange: setTotalValid,
          onOverrideChange: (cents) => {
            setAmountError(null)
            setOverrideCents(cents)
          },
        }}
        coverage={null}
        disabled={pending}
      />
      {amountError ? (
        <p role="alert" className="text-sm text-destructive">
          {amountError}
        </p>
      ) : null}
      {hasSpan ? (
        <p className="text-sm">
          {periodListLabel(months.map((m) => m.period))} ·{' '}
          <span className="font-medium tabular-nums">{formatCentsCompact(amount)}</span>
        </p>
      ) : null}
      {creditNote ? <p className="text-sm text-muted-foreground">{creditNote}</p> : null}
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !hasSpan || amount <= 0 || !totalValid} className="h-11">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {pending
            ? 'Guardando…'
            : hasSpan
              ? `Cargar saldo anterior de ${formatCentsCompact(amount)} (${months.length === 1 ? '1 mes' : `${months.length} meses`})`
              : 'Marcá desde qué mes debe'}
        </Button>
        <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
