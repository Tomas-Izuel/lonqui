'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { Amount } from '@/views/shared/money'
import { useOverlayParam, paymentOverlayValue } from '@/views/shared/overlay-params'
import { EditInSettingsLink } from '@/views/shared/edit-in-settings-link'
import { SETTINGS_LINKS } from '@/views/settings/settings-links'
import { MemberAccountAnswer } from '@/views/members/member-account-answer'
import { OpeningBalanceMonths } from '@/views/members/opening-balance-months'
import type { BillingStatus, Fee, ISODate, MemberAccount } from '@/models/types'

/**
 * Sección de cuenta, arriba del todo de la ficha (§13.6) — LA respuesta del
 * producto ("¿debe? ¿desde cuándo? ¿cuánto?"), por eso `MemberAccountAnswer`
 * (screenshot review, ronda 2) lleva el tratamiento más grande de toda la
 * ficha, antes de cualquier otro dato. Debajo: "Registrar pago" / "Pago del
 * grupo" (pipeline 2026-09-28-ui-expresiva, D1: abren el overlay de cobranza
 * sobre esta misma página con `useOverlayParam('pagar')`, nunca navegan a
 * `/caja/nuevo`) + "Indicar desde cuándo debía" (meses, no monto) cuando no hay uno vigente y la
 * facturación está activa.
 */
export function MemberAccountSection({
  memberId,
  familyGroupId,
  joinedOn,
  account,
  openingBalance,
  billing,
  canRegister,
  canActivateBilling = false,
}: {
  memberId: number
  familyGroupId: number | null
  /** Alta del socio: el "desde cuándo" solo tiene sentido si es anterior al inicio de la facturación. */
  joinedOn: ISODate
  account: MemberAccount
  openingBalance: Fee | null
  billing: BillingStatus
  canRegister: boolean
  canActivateBilling?: boolean
}) {
  const paymentOverlay = useOverlayParam('pagar')
  const [showOpeningForm, setShowOpeningForm] = useState(false)

  // Mismo criterio que el servidor: sin meses previos al inicio no hay nada que indicar.
  const canIndicateSince =
    canRegister &&
    billing.active &&
    billing.startPeriod != null &&
    billing.startPeriod <= billing.currentPeriod &&
    joinedOn.slice(0, 7) <= billing.startPeriod.slice(0, 7)

  return (
    <Panel title="Cuenta">
      <div className="flex flex-col gap-3">
        {/* `variant="plain"` (code-review, ronda 3): ya estamos dentro de
            `Panel title="Cuenta"` — la tarjeta propia de `MemberAccountAnswer`
            se leía como una tarjeta anidada dentro de otra. */}
        <MemberAccountAnswer account={account} variant="plain" />

        {!billing.active ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">La facturación de cuotas todavía no está activada.</p>
            {canActivateBilling ? (
              <EditInSettingsLink href={SETTINGS_LINKS.fees} className="self-start">
                Activar cuotas
              </EditInSettingsLink>
            ) : null}
          </div>
        ) : null}

        {canRegister ? (
          <div className="flex flex-wrap gap-2">
            {/* Overlay sobre la página actual (D1, pipeline 2026-09-28): nunca
                se navega a /caja/nuevo, que ahora es solo un redirect fino
                para links viejos guardados. */}
            <Button type="button" className="h-11" onClick={() => paymentOverlay.set(paymentOverlayValue({ mode: 'socio', memberId }))}>
              Registrar pago
            </Button>
            {familyGroupId != null ? (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => paymentOverlay.set(paymentOverlayValue({ mode: 'grupo', familyGroupId }))}
              >
                Pago del grupo
              </Button>
            ) : null}
          </div>
        ) : null}

        {openingBalance != null && canRegister && billing.active ? (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            Ya tiene un saldo anterior cargado: <Amount cents={openingBalance.amountCents} />.
          </p>
        ) : null}

        {openingBalance == null && canIndicateSince && billing.startPeriod != null ? (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {!showOpeningForm ? (
              <Button type="button" variant="outline" className="h-11 w-fit" onClick={() => setShowOpeningForm(true)}>
                Indicar desde cuándo debía
              </Button>
            ) : (
              <OpeningBalanceMonths
                memberId={memberId}
                startPeriod={billing.startPeriod}
                creditCents={Math.max(0, -account.balanceCents)}
                onCancel={() => setShowOpeningForm(false)}
              />
            )}
          </div>
        ) : null}
      </div>
    </Panel>
  )
}
