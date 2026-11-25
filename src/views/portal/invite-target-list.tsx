'use client'

import { useEffect, useState } from 'react'
import { Loader2, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { ChoiceGroup } from '@/views/income/choice-group'
import { DateTimeText } from '@/views/shared/date-text'
import { issuePortalInvite } from '@/controllers/portal.actions'
import { issueOpeningWhatsApp } from '@/views/portal/issue-link'
import type { IssuedPortalToken, PortalInviteTarget, PortalRelationship } from '@/models/types'

type RowState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'error'; message: string }
  | { phase: 'sent'; token: IssuedPortalToken; opened: boolean }

function targetKey(target: PortalInviteTarget): string {
  return `${target.familyGroupId ?? 'solo'}-${target.anchorMemberId}`
}

/**
 * Lista de "Invitar por categoría": un botón de WhatsApp por fila, uno
 * debajo del otro. Un clic emite la invitación y abre `wa.me` con el mensaje
 * armado; la persona del club toca enviar. Después del envío la fila queda
 * marcada (y con un botón para volver a abrir WhatsApp por si se cerró la
 * pestaña): el enlace vive solo en memoria de esta pantalla.
 */
export function InviteTargetList({ targets }: { targets: PortalInviteTarget[] }) {
  const [relationship, setRelationship] = useState<PortalRelationship>('guardian')
  const [rows, setRows] = useState<Record<string, RowState>>({})

  // Los enlaces emitidos viven solo en memoria: al salir de la pantalla (o volver desde el
  // caché de páginas) se descartan, igual que el QR.
  useEffect(() => {
    const discard = () => setRows({})
    window.addEventListener('pagehide', discard)
    return () => window.removeEventListener('pagehide', discard)
  }, [])

  async function send(target: PortalInviteTarget) {
    const key = targetKey(target)
    setRows((prev) => ({ ...prev, [key]: { phase: 'sending' } }))
    const { result, opened } = await issueOpeningWhatsApp('whatsapp', () =>
      issuePortalInvite({
        memberId: target.anchorMemberId,
        familyScope: target.familyGroupId != null,
        relationship,
        delivery: 'whatsapp',
      }),
    )
    setRows((prev) => ({
      ...prev,
      [key]: result.ok ? { phase: 'sent', token: result.data, opened } : { phase: 'error', message: result.error },
    }))
  }

  if (targets.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No hay nadie para invitar en esta categoría"
          description="Todos los grupos y socios de la categoría ya tienen una cuenta vinculada."
        />
      </Panel>
    )
  }

  const sentCount = Object.values(rows).filter((r) => r.phase === 'sent').length

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <ChoiceGroup
          label="Las invitaciones de esta lista son para"
          columns={1}
          value={relationship}
          onChange={setRelationship}
          errorId="relationship-error"
          options={[
            { value: 'guardian', label: 'Madre, padre o tutor del socio' },
            { value: 'self', label: 'El propio socio' },
          ]}
        />
      </Panel>

      <Panel
        title={`${targets.length} sin cuenta`}
        description={sentCount > 0 ? `${sentCount} invitación${sentCount === 1 ? '' : 'es'} armada${sentCount === 1 ? '' : 's'} en esta sesión` : undefined}
      >
        <ul className="-my-2 flex flex-col divide-y divide-border">
          {targets.map((target) => {
            const state = rows[targetKey(target)] ?? { phase: 'idle' }
            return (
              <li key={targetKey(target)} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{target.label}</span>
                  <span className="text-sm text-muted-foreground">{target.memberNames.join(', ')}</span>
                  {state.phase === 'error' ? (
                    <span role="alert" className="text-sm text-destructive">
                      {state.message}
                    </span>
                  ) : null}
                  {state.phase === 'sent' ? (
                    <span role="status" className="text-sm text-status-up-to-date">
                      Invitación armada · vence <DateTimeText instant={state.token.expiresAt} />
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {state.phase === 'sent' && state.token.whatsappUrl ? (
                    <Button asChild variant="outline" className="gap-2">
                      <a href={state.token.whatsappUrl} target="_blank" rel="noopener noreferrer">
                        <MessageCircle aria-hidden />
                        Abrir WhatsApp de nuevo<span className="sr-only"> para {target.label}</span>
                      </a>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="gap-2"
                      disabled={state.phase === 'sending' || !target.hasPhoneOnFile}
                      onClick={() => send(target)}
                    >
                      {state.phase === 'sending' ? <Loader2 aria-hidden className="animate-spin" /> : <MessageCircle aria-hidden />}
                      {!target.hasPhoneOnFile ? 'Sin teléfono cargado' : state.phase === 'sending' ? 'Generando…' : 'Invitar por WhatsApp'}
                      <span className="sr-only"> a {target.label}</span>
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}
