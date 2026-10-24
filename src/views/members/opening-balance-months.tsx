'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingList, EmptyState, ErrorState } from '@/views/shared/states'
import { MonthStrip } from '@/views/payments/month-strip'
import { tapCell, isBeforeStart, openingBalanceFromSelection, type Selection } from '@/views/payments/month-selection'
import { createOpeningBalanceFromMonths, getPaymentMonthOptions } from '@/controllers/payments.actions'
import { formatCentsCompact } from '@/lib/money'
import { formatPeriod, periodRangeLabel } from '@/lib/dates'
import type { ISODate, PaymentMonthOption } from '@/models/types'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; options: PaymentMonthOption[] }

/**
 * "Indicar desde cuándo debía": la misma tira de meses del formulario de pago,
 * pero solo con los meses anteriores al sistema. Crea únicamente el saldo
 * anterior (no registra ningún pago). Las celdas y su valor salen de la RPC; el
 * cliente solo suma las marcadas para el total que envía.
 */
export function OpeningBalanceMonths({
  memberId,
  startPeriod,
  creditCents,
  onCancel,
}: {
  memberId: number
  startPeriod: ISODate
  /** Saldo a favor del socio (>= 0): balance forward lo aplica solo al nuevo saldo anterior. */
  creditCents: number
  onCancel: () => void
}) {
  const router = useRouter()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [selection, setSelection] = useState<Selection>(null)
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
        setLoad({ status: 'ready', options: result.data.filter((o) => o.kind === 'pre_system') })
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
  const opening = openingBalanceFromSelection(options, selection, overrideCents ?? undefined)

  function retry() {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!opening || pending || !totalValid) return
    setPending(true)
    setAmountError(null)
    setFormError(null)
    try {
      const result = await createOpeningBalanceFromMonths({
        memberId,
        fromPeriod: opening.fromPeriod,
        toPeriod: opening.toPeriod,
        amountCents: opening.amountCents,
      })
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
        title="No hay meses anteriores para indicar"
        action={
          <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
            Cerrar
          </Button>
        }
      />
    )
  }

  const amount = opening?.amountCents ?? 0
  const creditNote =
    creditCents > 0 && amount > 0
      ? creditCents >= amount
        ? `El saldo a favor de ${formatCentsCompact(creditCents)} va a cubrir todo este saldo anterior.`
        : `El saldo a favor de ${formatCentsCompact(creditCents)} va a cubrir parte de este saldo anterior.`
      : null

  return (
    <form onSubmit={onSubmit} noValidate method="post" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {beforeStart
          ? `Las cuotas arrancan en ${formatPeriod(startPeriod)}. Tocá el primer mes que debe: se marcan todos hasta este mes.`
          : `Meses de antes de ${formatPeriod(startPeriod)}. Tocá el primer mes que debe: se marcan todos hasta el inicio del sistema.`}
      </p>
      <MonthStrip
        options={options}
        selection={selection}
        onTap={(index) => {
          setAmountError(null)
          setOverrideCents(null)
          setTotalValid(true)
          setSelection((current) => tapCell(options, current, index, { preSystemOpen: true }))
        }}
        variant="default"
        preSystem={{
          open: true,
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
      {opening ? (
        <p className="text-sm">
          {periodRangeLabel(opening.fromPeriod, opening.toPeriod)} ·{' '}
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
        <Button type="submit" disabled={pending || !opening || amount <= 0 || !totalValid} className="h-11">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {pending ? 'Guardando…' : opening ? `Cargar saldo anterior de ${formatCentsCompact(amount)}` : 'Marcá desde qué mes debe'}
        </Button>
        <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
