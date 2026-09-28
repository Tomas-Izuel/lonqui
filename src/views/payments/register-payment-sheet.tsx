'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'motion/react'
import { CircleCheck } from 'lucide-react'
import { LoadingList, ErrorState } from '@/views/shared/states'
import { PaymentForm } from '@/views/payments/payment-form'
import { GroupPaymentForm } from '@/views/payments/group-payment-form'
import { getPaymentFormData } from '@/controllers/payments.actions'
import { DURATION, SPRING_OVERLAY, useMotionPreference } from '@/views/shared/motion'
import { formatCentsCompact } from '@/lib/money'
import type { PaymentFormData } from '@/models/types'

type State = { status: 'idle' | 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: PaymentFormData }

/**
 * El único momento autorado del flujo de cobranza (D5/`animate.md`: "un solo
 * momento por vista, nunca una pantalla de celebración que demore el flujo
 * más rápido del sistema"): un check y el monto, visibles el tiempo justo
 * para confirmar antes de que el sheet se cierre solo. Nunca bloquea —no hay
 * botón, no hay nada que tocar— y con movimiento reducido es un fade simple,
 * sin el resorte de escala.
 */
function PaymentSuccessMoment({ amountCents }: { amountCents: number }) {
  const { reduced, pick } = useMotionPreference()
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <motion.span
        initial={pick({ scale: 0.6, opacity: 0 }, { opacity: 0 })}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: DURATION.state } : SPRING_OVERLAY}
        className="flex size-14 items-center justify-center rounded-full bg-status-up-to-date/10 text-status-up-to-date"
      >
        <CircleCheck aria-hidden className="size-8" />
      </motion.span>
      <div className="flex flex-col gap-0.5">
        <p className="text-lg font-semibold tabular-nums">{formatCentsCompact(amountCents)}</p>
        <p className="text-sm text-muted-foreground">Pago registrado</p>
      </div>
    </div>
  )
}

/**
 * Contenido del overlay de pago (búsqueda → cobrar, `PaymentOverlayHost` es
 * quien monta el `ResponsiveSheet` y la transición `AnimatePresence` entre
 * pasos): pide `getPaymentFormData` (Server Action) al montarse —solo
 * entonces, nunca antes— y renderiza `PaymentForm` o `GroupPaymentForm` según
 * traiga `familyGroup`. Extraído de lo que antes era `RegisterPaymentSheet`
 * (sheet + fetch en un solo componente): ahora el sheet lo posee
 * `PaymentOverlayHost` (uno solo, persistente entre "buscar" y "socio:id"),
 * y esto es solo el contenido que cambia adentro.
 *
 * Al terminar, NO llama a `onDone` directo: pasa por el momento autorado de
 * arriba (`PaymentSuccessMoment`) y recién ahí cierra + refresca — el toast
 * de éxito ya lo dispara `PaymentForm`/`GroupPaymentForm` en el momento del
 * registro, así que queda de rastro aunque el sheet ya se haya cerrado.
 */
export function RegisterPaymentSheetBody({
  memberId,
  familyGroupId,
  onDone,
}: {
  /** Uno de los dos, igual que `getPaymentFormData`. */
  memberId?: number
  familyGroupId?: number
  /** Cierra el overlay (siempre llega ya envuelto por `useCloseOverlay('pagar')`). */
  onDone: () => void
}) {
  const router = useRouter()
  const [state, setState] = useState<State>({ status: 'idle' })
  const [successAmountCents, setSuccessAmountCents] = useState<number | null>(null)
  const closeTimeoutRef = useRef<number | undefined>(undefined)

  // Si el overlay se cierra a mano (Esc, backdrop) mientras el check todavía
  // está en pantalla, el cierre "de verdad" que programó `handleSuccess` no
  // tiene sentido: `onDone`/`router.refresh()` en un componente ya desmontado
  // no rompe nada (son referencias estables), pero tampoco hace falta.
  useEffect(() => {
    return () => window.clearTimeout(closeTimeoutRef.current)
  }, [])

  // Mismo patrón que `MemberPicker`/`SearchInput`: el "loading" se fija en el
  // render cuando cambia a QUÉ socio o grupo corresponde este pedido, no
  // dentro del cuerpo del efecto (evita el `setState` síncrono al principio
  // de un efecto, que dispara un render en cascada).
  const requestKey = `${memberId ?? ''}:${familyGroupId ?? ''}`
  const [trackedKey, setTrackedKey] = useState(requestKey)
  if (requestKey !== trackedKey) {
    setTrackedKey(requestKey)
    setState({ status: 'loading' })
  }

  useEffect(() => {
    let cancelled = false

    getPaymentFormData({ memberId, familyGroupId }).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setState({ status: 'error', error: result.error })
        return
      }
      setState({ status: 'ready', data: result.data })
    })

    return () => {
      cancelled = true
    }
  }, [memberId, familyGroupId])

  function handleSuccess(amountCents: number) {
    setSuccessAmountCents(amountCents)
    // El check queda visible un instante (`focal`, `motion.ts`) antes de
    // cerrar de verdad: cerrar de una desaparecería el sheet antes de que
    // nadie llegue a ver la confirmación.
    closeTimeoutRef.current = window.setTimeout(() => {
      onDone()
      router.refresh()
    }, DURATION.focal * 1000)
  }

  if (successAmountCents != null) {
    return <PaymentSuccessMoment amountCents={successAmountCents} />
  }

  return (
    <>
      {state.status === 'idle' || state.status === 'loading' ? <LoadingList rows={3} /> : null}
      {state.status === 'error' ? (
        <ErrorState title="No pudimos abrir el formulario" description={state.error} />
      ) : null}
      {state.status === 'ready' ? (
        state.data.familyGroup ? (
          <GroupPaymentForm
            members={state.data.members}
            familyGroup={state.data.familyGroup}
            onDone={() => {}}
            onSuccess={handleSuccess}
          />
        ) : (
          <PaymentForm member={state.data.members[0]} onDone={() => {}} onSuccess={handleSuccess} />
        )
      ) : null}
    </>
  )
}
