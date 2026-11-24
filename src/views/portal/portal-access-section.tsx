'use client'

import { Suspense, use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Ban, KeyRound, Link2Off, ShieldCheck, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { EmptyState, ErrorState, LoadingList } from '@/views/shared/states'
import { StatusPill, type StatusPillVariant } from '@/views/shared/status-pill'
import { DateTimeText } from '@/views/shared/date-text'
import { ReasonDialog, type ReasonDialogValues } from '@/views/shared/reason-dialog'
import { InviteDialog } from '@/views/portal/invite-dialog'
import { LoginLinkDialog } from '@/views/portal/login-link-dialog'
import { deliveryLabels, linkRelationshipLabels, tokenPurposeLabels, tokenStateLabels } from '@/views/portal/portal-labels'
import { revokePortalLink, revokePortalToken, setPortalAccountStatus } from '@/controllers/portal.actions'
import type { ActionResult } from '@/lib/action-result'
import type {
  Permission,
  PortalAccessOverview,
  PortalLinkedAccount,
  PortalRelationship,
  PortalTokenState,
  PortalTokenSummary,
} from '@/models/types'

export type PortalSectionProps = {
  /**
   * Resuelve a `null` si la lectura falló (la page la atrapa): así un error de
   * esta sección no tumba la ficha entera. Es una promesa para que la ficha
   * pinte primero y esta sección llegue por streaming.
   */
  accessPromise: Promise<PortalAccessOverview | null>
  memberId: number
  familyGroupId: number | null
  defaultRelationship: PortalRelationship
  permissions: Permission[]
  /** Viene de `/socios/nuevo?pedido=`: abre el diálogo de invitar ya atado a ese pedido. */
  autoInvite?: { requestId: number }
}

const TOKEN_PILL: Record<PortalTokenState, StatusPillVariant> = {
  pending: 'up-to-date',
  consumed: 'credit',
  revoked: 'member-inactive',
  expired: 'member-inactive',
  locked: 'member-inactive',
}

type DialogState =
  | { type: 'invite' }
  | { type: 'revoke-link'; account: PortalLinkedAccount }
  | { type: 'block'; account: PortalLinkedAccount }
  | { type: 'unblock'; account: PortalLinkedAccount }
  | { type: 'login-link'; account: PortalLinkedAccount }
  | { type: 'revoke-token'; token: PortalTokenSummary }

/**
 * "App de socios" en la ficha del socio (o de su grupo): cuentas vinculadas,
 * invitaciones vivas y las acciones. Ocultar un botón es UX, nunca la defensa:
 * cada action y cada RPC vuelven a exigir el permiso.
 */
export function PortalAccessSection(props: PortalSectionProps) {
  return (
    <Panel title="App de socios" description="Quién entra a la app y a quién ve. Cada invitación la manda una persona del club.">
      <Suspense fallback={<LoadingList rows={2} />}>
        <PortalAccessBody {...props} />
      </Suspense>
    </Panel>
  )
}

function PortalAccessBody({ accessPromise, memberId, familyGroupId, defaultRelationship, permissions, autoInvite }: PortalSectionProps) {
  const access = use(accessPromise)
  const router = useRouter()
  const [dialog, setDialog] = useState<DialogState | null>(autoInvite ? { type: 'invite' } : null)

  if (!access) {
    return (
      <ErrorState
        title="No pudimos cargar la app de socios"
        description="Revisá tu conexión e intentá de nuevo."
        action={
          <Button type="button" onClick={() => router.refresh()}>
            Reintentar
          </Button>
        }
      />
    )
  }

  const canInvite = permissions.includes('portal.invite')
  const canReview = permissions.includes('portal.review')
  const canLoginLink = permissions.includes('portal.login_link')
  const hasLiveInvite = access.tokens.some((t) => t.purpose === 'invite' && t.state === 'pending')

  function closeDialog() {
    setDialog(null)
    // Quita `?invitar=` de la URL para que recargar no vuelva a abrir el diálogo.
    if (autoInvite) router.replace(`/socios/${memberId}`)
  }

  async function runAction(action: Promise<ActionResult>, success: string): Promise<{ ok: true } | { ok: false; error: string; field?: string }> {
    const result = await action
    if (!result.ok) return result
    toast.success(success)
    router.refresh()
    return { ok: true }
  }

  const reasonDialog = (() => {
    if (!dialog) return null
    switch (dialog.type) {
      case 'revoke-link':
        return {
          title: `Revocar el vínculo de ${accountName(dialog.account)}`,
          consequence: `La cuenta deja de ver ${
            dialog.account.familyScope ? 'a todo el grupo familiar' : 'a este socio'
          } al instante, aunque tenga la app abierta. La cuenta y el historial no se borran: queda anotado quién lo revocó y por qué.`,
          actionLabel: 'Revocar vínculo',
          onConfirm: ({ reason }: ReasonDialogValues) =>
            runAction(revokePortalLink({ linkId: dialog.account.linkId, reason }), 'Vínculo revocado'),
        }
      case 'block':
        return {
          title: `Bloquear la cuenta de ${accountName(dialog.account)}`,
          consequence:
            'La cuenta deja de poder entrar y de ver a todos sus socios al instante, aunque tenga la app abierta. Se anulan sus enlaces de ingreso pendientes. No se borra nada y se puede desbloquear.',
          actionLabel: 'Bloquear cuenta',
          onConfirm: ({ reason }: ReasonDialogValues) =>
            runAction(setPortalAccountStatus({ accountId: dialog.account.accountId, status: 'blocked', reason }), 'Cuenta bloqueada'),
        }
      case 'unblock':
        return {
          title: `Desbloquear la cuenta de ${accountName(dialog.account)}`,
          consequence: 'La cuenta vuelve a poder entrar y ver a sus socios. Queda anotado quién la desbloqueó y por qué.',
          actionLabel: 'Desbloquear cuenta',
          onConfirm: ({ reason }: ReasonDialogValues) =>
            runAction(setPortalAccountStatus({ accountId: dialog.account.accountId, status: 'active', reason }), 'Cuenta desbloqueada'),
        }
      case 'revoke-token':
        return {
          title: `Anular ${dialog.token.purpose === 'login' ? 'el enlace de ingreso' : 'la invitación'}`,
          consequence: 'El enlace deja de servir al instante. Si ya se mandó, quien lo reciba no va a poder usarlo. Queda anotado el motivo.',
          actionLabel: 'Anular',
          onConfirm: ({ reason }: ReasonDialogValues) =>
            runAction(revokePortalToken({ tokenId: dialog.token.id, reason }), 'Enlace anulado'),
        }
      default:
        return null
    }
  })()

  return (
    <div className="flex flex-col gap-5">
      {canInvite ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {access.accounts.length === 0
              ? 'Nadie entró todavía. Invitá a quien va a usar la app.'
              : 'Podés invitar a otra persona: la invitación vigente no se pisa si lo elegís.'}
          </p>
          <Button type="button" onClick={() => setDialog({ type: 'invite' })} className="gap-2 sm:shrink-0">
            <Smartphone aria-hidden />
            Invitar a la app
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="portal-accounts-heading" className="flex flex-col gap-2">
        <h3 id="portal-accounts-heading" className="text-sm font-medium">
          Cuentas vinculadas
        </h3>
        {access.accounts.length === 0 ? (
          <EmptyState
            className="py-6"
            title="Todavía no hay cuentas vinculadas"
            description="Cuando alguien entre con una invitación, aparece acá."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {access.accounts.map((account) => (
              <li key={account.linkId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{accountName(account)}</span>
                  {account.accountStatus === 'blocked' ? <StatusPill variant="member-inactive">Cuenta bloqueada</StatusPill> : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {linkRelationshipLabels[account.relationship]}
                  {account.familyScope ? ' · Ve a todo el grupo familiar' : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  Entró <DateTimeText instant={account.linkedAt} />
                  {account.linkedByName ? ` · Invitó ${account.linkedByName}` : ''}
                </p>
                {account.lastLoginLink ? (
                  <p className="text-xs text-muted-foreground">
                    Último enlace de ingreso: <DateTimeText instant={account.lastLoginLink.createdAt} />
                    {account.lastLoginLink.createdByName ? ` · Lo emitió ${account.lastLoginLink.createdByName}` : ''}
                    {account.lastLoginLink.consumedAt ? ' · Usado' : ' · Sin usar'}
                  </p>
                ) : null}
                {canReview || canLoginLink ? (
                  <div className="flex flex-wrap gap-2">
                    {canReview ? (
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog({ type: 'revoke-link', account })}>
                        <Link2Off aria-hidden />
                        Revocar vínculo
                      </Button>
                    ) : null}
                    {canReview && account.accountStatus === 'active' ? (
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog({ type: 'block', account })}>
                        <Ban aria-hidden />
                        Bloquear cuenta
                      </Button>
                    ) : null}
                    {canReview && account.accountStatus === 'blocked' ? (
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog({ type: 'unblock', account })}>
                        <ShieldCheck aria-hidden />
                        Desbloquear cuenta
                      </Button>
                    ) : null}
                    {canLoginLink && account.accountStatus === 'active' ? (
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setDialog({ type: 'login-link', account })}>
                        <KeyRound aria-hidden />
                        Enlace de ingreso
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canLoginLink && access.accounts.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Un enlace de ingreso lo puede abrir quien lo emite: es solo para Administradores y queda registrado.
          </p>
        ) : null}
      </section>

      {access.tokens.length > 0 ? (
        <section aria-labelledby="portal-tokens-heading" className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 id="portal-tokens-heading" className="text-sm font-medium">
            Invitaciones y enlaces
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {access.tokens.map((token) => {
              const canRevoke = token.state === 'pending' && (token.purpose === 'login' ? canLoginLink : canInvite)
              return (
                <li key={token.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <span className="text-sm font-medium">{tokenPurposeLabels[token.purpose]}</span>
                  <StatusPill variant={TOKEN_PILL[token.state]}>{tokenStateLabels[token.state]}</StatusPill>
                  <span className="text-xs text-muted-foreground">
                    {deliveryLabels[token.delivery]}
                    {token.familyScope ? ' · A todo el grupo' : ''}
                    {token.createdByName ? ` · ${token.createdByName}` : ''} · <DateTimeText instant={token.createdAt} />
                  </span>
                  {canRevoke ? (
                    <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setDialog({ type: 'revoke-token', token })}>
                      Anular
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {canInvite ? (
        <InviteDialog
          // Remonta al abrir de nuevo: el formulario arranca limpio y el QR anterior no sobrevive.
          key={dialog?.type === 'invite' ? 'open' : 'closed'}
          open={dialog?.type === 'invite'}
          onOpenChange={(open) => (open ? setDialog({ type: 'invite' }) : closeDialog())}
          memberId={memberId}
          familyGroupId={familyGroupId}
          defaultRelationship={defaultRelationship}
          hasExistingAccount={access.accounts.length > 0}
          hasLiveInvite={hasLiveInvite}
          hasPhoneOnFile={access.hasPhoneOnFile}
          requestId={autoInvite?.requestId}
        />
      ) : null}

      {dialog?.type === 'login-link' ? (
        <LoginLinkDialog
          open
          onOpenChange={(open) => !open && closeDialog()}
          accountId={dialog.account.accountId}
          accountName={accountName(dialog.account)}
        />
      ) : null}

      {reasonDialog ? (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && closeDialog()}
          showDate={false}
          title={reasonDialog.title}
          consequence={reasonDialog.consequence}
          actionLabel={reasonDialog.actionLabel}
          onConfirm={reasonDialog.onConfirm}
        />
      ) : null}
    </div>
  )
}

function accountName(account: PortalLinkedAccount): string {
  return `${account.firstName} ${account.lastName}`.trim()
}
