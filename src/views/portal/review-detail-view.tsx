'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, UserPlus, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { StatusPill } from '@/views/shared/status-pill'
import { Dni } from '@/views/shared/dni'
import { DateTimeText } from '@/views/shared/date-text'
import { ReasonDialog, type ReasonDialogValues } from '@/views/shared/reason-dialog'
import { ReviewInviteForm, REVIEW_INVITE_FORM_ID } from '@/views/portal/review-invite-form'
import { candidateReasonLabels, relationshipLabels, requestStatusLabels } from '@/views/portal/portal-labels'
import { rejectPortalRequest } from '@/controllers/portal.actions'
import { cn } from '@/lib/utils'
import type { Permission, PortalCandidate, PortalRequestDetail } from '@/models/types'

export type ReviewNav = {
  prevId: number | null
  nextId: number | null
  /** Lugar entre los pendientes, si este pedido es uno de ellos. */
  position: { index: number; total: number } | null
}

const LIST_HREF = '/socios/revision'

function hrefFor(id: number | null): string {
  return id != null ? `${LIST_HREF}/${id}` : LIST_HREF
}

/** Teclear en un campo de texto no dispara atajos; un radio o un botón sí los deja pasar. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) return !['radio', 'checkbox', 'button', 'submit'].includes(target.type)
  return false
}

/**
 * Atajos de la pantalla: j / k siguiente y anterior, i invitar, r rechazar.
 * No disparan escribiendo en un campo, con Ctrl/Cmd/Alt, ni con un diálogo
 * abierto (el resultado de la invitación y el motivo del rechazo son
 * diálogos: un atajo ahí sería un accidente).
 */
function useReviewShortcuts(handlers: {
  enabled: boolean
  next: () => void
  prev: () => void
  invite: (() => void) | null
  reject: (() => void) | null
}) {
  const { enabled, next, prev, invite, reject } = handlers
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      const key = event.key.toLowerCase()
      if (key === 'j') next()
      else if (key === 'k') prev()
      else if (key === 'i' && invite) invite()
      else if (key === 'r' && reject) reject()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, next, prev, invite, reject])
}

function candidateKey(candidate: PortalCandidate): string {
  return `${candidate.personId}-${candidate.memberId}`
}

/**
 * Detalle de un pedido de acceso: quién pide, a quién quiere ver, los socios
 * sugeridos con su evidencia y la acción en un paso ("Invitar"). Las
 * sugerencias se calcularon al abrir contra el padrón de ese momento.
 */
export function ReviewDetailView({ detail, nav, permissions }: { detail: PortalRequestDetail; nav: ReviewNav; permissions: Permission[] }) {
  const { request, candidates } = detail
  const router = useRouter()
  // Solo se preselecciona un candidato con evidencia más fuerte que "Nombre parecido": el atajo
  // `i` emite una invitación real, y un homónimo no debería quedar elegido sin que nadie lo mire.
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const first = candidates[0]
    return first && first.reasons.some((reason) => reason !== 'name') ? candidateKey(first) : null
  })
  const [rejecting, setRejecting] = useState(false)
  // Atajos de una sola tecla: se pueden apagar (WCAG 2.1.4).
  const [shortcutsOn, setShortcutsOn] = useState(true)

  const selected = candidates.find((c) => candidateKey(c) === selectedKey) ?? null
  const open = request.status === 'pending' || request.status === 'invited'
  const canInvite = open && selected != null && permissions.includes('portal.invite')
  // `invited` también se rechaza: la RPC acepta ambos y rechazar anula la invitación que quedara viva.
  const inviteDead = request.status === 'invited' && request.invitationLive === false
  const canReject = open && permissions.includes('portal.review')
  const canCreateMember = open && permissions.includes('members.write')

  const goNext = useCallback(() => {
    if (nav.nextId != null) router.push(hrefFor(nav.nextId))
    else toast.message('No hay otro pedido pendiente después de este')
  }, [nav.nextId, router])
  const goPrev = useCallback(() => {
    if (nav.prevId != null) router.push(hrefFor(nav.prevId))
    else toast.message('No hay otro pedido pendiente antes de este')
  }, [nav.prevId, router])
  const triggerInvite = useCallback(() => {
    const form = document.getElementById(REVIEW_INVITE_FORM_ID)
    // Con el botón deshabilitado ya hay una invitación en camino: no se manda otra.
    if (form instanceof HTMLFormElement && !form.querySelector('button[type="submit"]:disabled')) form.requestSubmit()
  }, [])
  const triggerReject = useCallback(() => setRejecting(true), [])

  useReviewShortcuts({
    enabled: shortcutsOn,
    next: goNext,
    prev: goPrev,
    invite: canInvite ? triggerInvite : null,
    reject: canReject ? triggerReject : null,
  })

  async function handleReject({ reason }: ReasonDialogValues) {
    const result = await rejectPortalRequest({ requestId: request.id, note: reason })
    if (!result.ok) return result
    toast.success('Pedido rechazado')
    router.push(hrefFor(result.data.nextRequestId))
    return { ok: true } as const
  }

  const declaredPerson = selected ? request.people.find((p) => p.id === selected.personId) : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href={LIST_HREF}>
            <ArrowLeft aria-hidden />
            Revisión
          </Link>
        </Button>
        <div className="flex items-center gap-1">
          {nav.position ? (
            <span className="px-2 text-sm text-muted-foreground tabular-nums">
              Pedido {nav.position.index + 1} de {nav.position.total}
            </span>
          ) : null}
          <NavButton href={nav.prevId != null ? hrefFor(nav.prevId) : null} label="Pedido anterior" shortcut="k" icon={ChevronLeft} />
          <NavButton href={nav.nextId != null ? hrefFor(nav.nextId) : null} label="Siguiente pedido pendiente" shortcut="j" icon={ChevronRight} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-heading text-xl font-semibold text-balance sm:text-2xl">
          Pedido de {request.firstName} {request.lastName}
        </h1>
        {request.status !== 'pending' ? (
          <StatusPill variant={request.status === 'rejected' ? 'member-inactive' : inviteDead ? 'in-debt' : 'up-to-date'}>
            {inviteDead ? 'Invitación vencida' : request.status === 'invited' ? 'Invitación vigente' : requestStatusLabels[request.status]}
          </StatusPill>
        ) : null}
      </div>

      <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
        <p>
          {shortcutsOn ? (
            <>
              Atajos: <kbd className="font-sans">j</kbd> / <kbd className="font-sans">k</kbd> siguiente y anterior
              {canInvite ? <> · <kbd className="font-sans">i</kbd> invitar</> : null}
              {canReject ? <> · <kbd className="font-sans">r</kbd> rechazar</> : null}
            </>
          ) : (
            'Atajos de teclado apagados'
          )}
        </p>
        <Button type="button" variant="ghost" size="sm" aria-pressed={shortcutsOn} onClick={() => setShortcutsOn((on) => !on)}>
          {shortcutsOn ? 'Apagar atajos' : 'Encender atajos'}
        </Button>
      </div>

      {request.status === 'invited' && open ? (
        <p role="note" className="rounded-lg bg-muted px-3 py-2 text-sm">
          {inviteDead
            ? 'La invitación de este pedido venció o se anuló. Podés reemitirla; si no corresponde, rechazalo.'
            : 'Este pedido tiene una invitación vigente. Si no corresponde, rechazalo; reemitirla anula la anterior.'}
        </p>
      ) : null}

      <Panel title="Quién pide">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Info label="DNI declarado">
            <Dni dni={request.dni} />
          </Info>
          <Info label="Teléfono declarado">{request.phoneRaw}</Info>
          <Info label="Email">{request.email ?? '—'}</Info>
          <Info label="Pidió">
            <DateTimeText instant={request.createdAt} />
          </Info>
          {request.message ? (
            <Info label="Mensaje" className="sm:col-span-2">
              {request.message}
            </Info>
          ) : null}
        </dl>
        {request.resolvedAt ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {request.status === 'rejected' ? 'Rechazado' : 'Resuelto'} <DateTimeText instant={request.resolvedAt} />
            {request.resolvedByName ? ` por ${request.resolvedByName}` : ''}
            {request.resolutionNote ? `: ${request.resolutionNote}` : ''}
          </p>
        ) : null}
      </Panel>

      <Panel title="A quién quiere ver">
        {request.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No indicó a nadie.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {request.people.map((person) => (
              <li key={person.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                <span className="font-medium">
                  {person.firstName} {person.lastName}
                </span>
                <span className="text-sm text-muted-foreground">
                  {relationshipLabels[person.relationship]}
                  {person.dni ? (
                    <>
                      {' · DNI '}
                      <Dni dni={person.dni} />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Socios sugeridos"
        description="Se calculan con el padrón de este momento. Elegí el correcto antes de invitar."
        action={
          canCreateMember ? (
            <Button asChild variant="outline" className="gap-1.5">
              <Link href={`/socios/nuevo?pedido=${request.id}`}>
                <UserPlus aria-hidden />
                Crear el socio
              </Link>
            </Button>
          ) : undefined
        }
      >
        {candidates.length === 0 ? (
          <EmptyState
            className="py-6"
            title="No encontramos un socio parecido"
            description="Buscalo a mano en el padrón o, si todavía no es socio, creá su ficha de ingreso: vuelve acá con la invitación lista."
            action={
              <Button asChild variant="outline">
                <Link href="/socios">Buscar en el padrón</Link>
              </Button>
            }
          />
        ) : (
          <fieldset className="flex flex-col">
            <legend className="sr-only">Socio a invitar</legend>
            <ul className="-my-1 flex flex-col divide-y divide-border">
              {candidates.map((candidate) => {
                const key = candidateKey(candidate)
                const checked = key === selectedKey
                const person = request.people.find((p) => p.id === candidate.personId)
                return (
                  <li key={key} className={cn('flex items-start gap-2 py-3', checked && 'bg-muted/50')}>
                    <label className="flex min-h-11 flex-1 cursor-pointer items-start gap-3 px-1">
                      <input
                        type="radio"
                        name="candidate"
                        checked={checked}
                        onChange={() => setSelectedKey(key)}
                        className="mt-0.5 size-5 shrink-0 accent-primary"
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="font-medium">{candidate.memberName}</span>
                        {person ? (
                          <span className="text-xs text-muted-foreground">
                            Sugerido para {person.firstName} {person.lastName}
                          </span>
                        ) : null}
                        <span className="flex flex-wrap gap-1.5">
                          {candidate.reasons.map((reason) => (
                            <span key={reason} className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-medium">
                              {candidateReasonLabels[reason]}
                            </span>
                          ))}
                          {candidate.hasAccount ? (
                            <StatusPill variant="credit">Ya tiene cuenta</StatusPill>
                          ) : null}
                        </span>
                      </span>
                    </label>
                    <Button asChild variant="ghost" size="sm" className="shrink-0">
                      <Link href={`/socios/${candidate.memberId}`} target="_blank" rel="noopener noreferrer">
                        Ver ficha<span className="sr-only"> de {candidate.memberName} (se abre en otra pestaña)</span>
                      </Link>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        )}
      </Panel>

      {canInvite && selected ? (
        <Panel title="Invitar">
          <ReviewInviteForm
            key={candidateKey(selected)}
            requestId={request.id}
            candidate={selected}
            declaredRelationship={declaredPerson?.relationship}
            declaredPhone={request.phoneRaw}
            reissue={request.status === 'invited'}
            onDone={() => router.push(hrefFor(nav.nextId))}
          />
        </Panel>
      ) : null}

      {canReject ? (
        <Panel title="Rechazar">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Si no corresponde darle acceso. Queda anotado con tu motivo y el pedido no se borra.
            </p>
            <Button type="button" variant="destructive" aria-keyshortcuts="r" onClick={() => setRejecting(true)}>
              Rechazar pedido
            </Button>
          </div>
        </Panel>
      ) : null}

      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        showDate={false}
        title="Rechazar este pedido"
        consequence="El pedido queda como rechazado, con el motivo que escribas, en la solapa Resueltos. No se borra y queda registrado quién lo rechazó."
        actionLabel="Rechazar pedido"
        onConfirm={handleReject}
      />
    </div>
  )
}

function NavButton({ href, label, shortcut, icon: Icon }: { href: string | null; label: string; shortcut: string; icon: LucideIcon }) {
  if (href == null) {
    return (
      <Button type="button" variant="outline" size="icon" disabled aria-label={label}>
        <Icon aria-hidden />
      </Button>
    )
  }
  return (
    <Button asChild variant="outline" size="icon">
      <Link href={href} aria-label={label} aria-keyshortcuts={shortcut}>
        <Icon aria-hidden />
      </Link>
    </Button>
  )
}

function Info({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}
