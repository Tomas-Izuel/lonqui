'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ResponsiveSheet } from '@/views/shared/responsive-sheet'
import { LoadingList, ErrorState } from '@/views/shared/states'
import { MemberStatusPill } from '@/views/shared/status-pill'
import { WhatsAppLink } from '@/views/shared/whatsapp-link'
import { categoriesLabel } from '@/views/payments/account-format'
import { useOverlayParam, useCloseOverlay, parseQuickViewParam, paymentOverlayValue } from '@/views/shared/overlay-params'
import { MemberAccountAnswer } from '@/views/members/member-account-answer'
import { getMemberQuickView } from '@/controllers/members.actions'
import { useHasPermission } from '@/views/shell/panel-session'
import type { MemberAccount } from '@/models/types'

type QuickViewData = MemberAccount & { phone: string | null }
type State = { status: 'idle' | 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: QuickViewData }

/**
 * Vista rápida del socio (pipeline 2026-09-28-ui-expresiva, D2): contesta
 * "¿debe? ¿desde cuándo? ¿cuánto?" en un toque desde el padrón o desde "los
 * más atrasados" del inicio, sin abrir la ficha completa. Montada UNA sola
 * vez en `AppShell` (C7, cero props): lee `?ver=<id>` de la URL actual y
 * nunca navega — el mismo `ResponsiveSheet`/patrón de `RegisterPaymentSheet`.
 *
 * `getMemberQuickView` (B1, `members.actions.ts`) ya chequea el permiso y
 * devuelve el mismo `MemberAccount` que alimenta el padrón y "los más
 * atrasados" — nunca se vuelve a formatear la línea de cuenta acá:
 * `accountLineText` es la única fuente de ese texto en toda la app.
 */
export function MemberQuickViewSheet(): React.ReactElement | null {
  const quickView = useOverlayParam('ver')
  const closeQuickView = useCloseOverlay('ver')
  const paymentOverlay = useOverlayParam('pagar')
  const canRegister = useHasPermission('payments.register')
  const memberId = parseQuickViewParam(quickView.value)
  const open = memberId != null

  // Mismo patrón que `RegisterPaymentSheet`: el pedido se vuelve a disparar
  // en el render (no en un `setState` síncrono dentro del efecto) cuando
  // cambia el id pedido — evita el "cascading render" que el lint de
  // vercel-react-best-practices marca.
  const [state, setState] = useState<State>({ status: 'idle' })
  const [trackedId, setTrackedId] = useState<number | null>(null)
  if (memberId !== trackedId) {
    setTrackedId(memberId)
    setState(memberId != null ? { status: 'loading' } : { status: 'idle' })
  }

  useEffect(() => {
    if (memberId == null) return
    let cancelled = false

    getMemberQuickView(memberId).then((result) => {
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
  }, [memberId])

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeQuickView()
      }}
      title={state.status === 'ready' ? state.data.fullName : 'Socio'}
      footer={null}
    >
      {state.status === 'idle' || state.status === 'loading' ? <LoadingList rows={3} /> : null}
      {state.status === 'error' ? <ErrorState title="No pudimos abrir la ficha" description={state.error} /> : null}
      {state.status === 'ready' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <MemberStatusPill status={state.data.status} />
            <span className="text-sm text-muted-foreground">{categoriesLabel(state.data.categories)}</span>
          </div>

          {/* La respuesta central del producto: "¿debe? ¿desde cuándo?
              ¿cuánto?", mismo tratamiento grande que la ficha (screenshot
              review, ronda 2) — nunca una pill al lado repitiendo el mismo
              estado en palabras chicas. */}
          <MemberAccountAnswer account={state.data} />

          <div className="flex flex-col gap-2">
            {canRegister ? (
              <Button
                type="button"
                className="h-11"
                onClick={() => paymentOverlay.set(paymentOverlayValue({ mode: 'socio', memberId: state.data.memberId }))}
              >
                Registrar pago
              </Button>
            ) : null}
            {state.data.phone ? <WhatsAppLink phone={state.data.phone} /> : null}
            <Button asChild variant="outline" className="h-11">
              <Link href={`/socios/${state.data.memberId}`}>Ver ficha completa</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </ResponsiveSheet>
  )
}
