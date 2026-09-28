'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { LoadingList, ErrorState } from '@/views/shared/states'
import { PaymentForm } from '@/views/payments/payment-form'
import { GroupPaymentForm } from '@/views/payments/group-payment-form'
import { getPaymentFormData } from '@/controllers/payments.actions'
import type { PaymentFormData } from '@/models/types'

export type RegisterPaymentSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Uno de los dos, igual que `getPaymentFormData` (F1, `payments.actions.ts`). */
  memberId?: number
  familyGroupId?: number
}

type State = { status: 'idle' | 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: PaymentFormData }

/**
 * Componente reutilizable para registrar un pago SIN salir de donde se abrió
 * (pensado para F2: importarlo desde la ficha del socio si prefiere un sheet
 * a navegar a `/cobranza/nuevo`). El flujo aprobado en
 * `00-architecture.md` §10 / `01-tasks.md` F2 es un link directo a
 * `/cobranza/nuevo?socio=…&volver=/socios/<id>` — más simple y es lo que
 * `/cobranza/nuevo` (page.tsx) ya implementa. Esto queda como alternativa
 * documentada (dev log F1) por si F2 prefiere no navegar afuera de la ficha;
 * no tiene su propio caso de uso probado en este pipeline.
 *
 * Pide los datos con `getPaymentFormData` (Server Action, `payments.actions.ts`)
 * recién al abrirse — no antes — para no pagar la RPC en cada render de la
 * ficha. Al terminar, cierra el sheet y refresca la ruta actual (los montos
 * de la ficha vuelven a leerse del servidor).
 */
export function RegisterPaymentSheet({ open, onOpenChange, memberId, familyGroupId }: RegisterPaymentSheetProps) {
  const router = useRouter()
  const [state, setState] = useState<State>({ status: 'idle' })

  // Qué pedido corresponde mostrar ahora mismo: null si el sheet está
  // cerrado. Cuando cambia (se abre, o se abre para otro socio/grupo) se
  // vuelve a 'loading' EN EL RENDER, mismo patrón que `SearchInput` — evita
  // el `setState` síncrono al principio del efecto (cascading renders); el
  // efecto de abajo solo dispara el pedido y escribe el resultado en su
  // callback async, que es la forma que el lint sí acepta.
  const requestKey = open ? `${memberId ?? ''}:${familyGroupId ?? ''}` : null
  const [trackedKey, setTrackedKey] = useState<string | null>(null)
  if (requestKey !== trackedKey) {
    setTrackedKey(requestKey)
    setState(requestKey ? { status: 'loading' } : { status: 'idle' })
  }

  useEffect(() => {
    if (!requestKey) return
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
  }, [requestKey, memberId, familyGroupId])

  function handleDone() {
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={familyGroupId != null ? 'Pago del grupo familiar' : 'Registrar pago'}
      footer={null}
    >
      {state.status === 'idle' || state.status === 'loading' ? <LoadingList rows={3} /> : null}
      {state.status === 'error' ? (
        <ErrorState title="No pudimos abrir el formulario" description={state.error} />
      ) : null}
      {state.status === 'ready' ? (
        state.data.familyGroup ? (
          <GroupPaymentForm members={state.data.members} familyGroup={state.data.familyGroup} onDone={handleDone} />
        ) : (
          <PaymentForm member={state.data.members[0]} onDone={handleDone} />
        )
      ) : null}
    </ResponsiveSheet>
  )
}
