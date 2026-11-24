'use client'

import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { issuePortalInvite } from '@/controllers/portal.actions'
import { ChoiceGroup } from '@/views/income/choice-group'
import { IssuedLinkResult } from '@/views/portal/issued-link-result'
import { issueOpeningWhatsApp } from '@/views/portal/issue-link'
import type { IssuedPortalToken, PortalCandidate, PortalRelationship, PortalTokenDelivery } from '@/models/types'

/** Id fijo: el atajo "i" de la pantalla envía este formulario. */
export const REVIEW_INVITE_FORM_ID = 'review-invite-form'

const schema = z.object({
  scope: z.enum(['member', 'group']),
  relationship: z.enum(['self', 'guardian']),
  delivery: z.enum(['whatsapp', 'qr']),
  phoneChoice: z.enum(['registry', 'declared']),
})
type Values = z.infer<typeof schema>

/**
 * "Invitar" en un paso desde un pedido: el socio ya está elegido, los valores
 * arrancan con lo más probable (la relación que declaró la persona, el grupo
 * si responde por un menor) y un solo botón emite la invitación y abre
 * `wa.me`. El teléfono del padrón es el default; mandarla al que dejó la
 * persona es una elección explícita y con aviso, porque ahí está el riesgo
 * (00 §4.H).
 *
 * El padre `key`ea este formulario con el socio elegido: cambiar de candidato
 * lo remonta con los defaults de ese candidato.
 */
export function ReviewInviteForm({
  requestId,
  candidate,
  declaredRelationship,
  declaredPhone,
  reissue,
  onDone,
}: {
  requestId: number
  candidate: PortalCandidate
  /** Lo que la persona declaró de este socio (madre/padre/tutor o él mismo). */
  declaredRelationship: PortalRelationship | undefined
  declaredPhone: string
  /** El pedido ya tenía una invitación (venció o se anuló): el botón dice "Reemitir". */
  reissue: boolean
  /** Se llama cuando la Comisión cierra el resultado: la pantalla avanza al siguiente pedido. */
  onDone: () => void
}) {
  const ids = { scope: useId(), relationship: useId(), delivery: useId(), phone: useId() }
  const [issued, setIssued] = useState<{ token: IssuedPortalToken; delivery: PortalTokenDelivery; opened: boolean } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const defaultRelationship: PortalRelationship = declaredRelationship ?? 'guardian'
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      scope: candidate.familyGroupId != null && defaultRelationship === 'guardian' ? 'group' : 'member',
      relationship: defaultRelationship,
      delivery: 'whatsapp',
      phoneChoice: 'registry',
    },
  })
  const scope = useWatch({ control: form.control, name: 'scope' })
  const relationship = useWatch({ control: form.control, name: 'relationship' })
  const delivery = useWatch({ control: form.control, name: 'delivery' })
  const phoneChoice = useWatch({ control: form.control, name: 'phoneChoice' })
  const pending = form.formState.isSubmitting

  // Si el teléfono declarado ya coincide con el del padrón, no hay nada que elegir.
  const phoneMatches = candidate.reasons.includes('phone') || candidate.reasons.includes('payer_phone')
  const showPhoneChoice = delivery === 'whatsapp' && !phoneMatches
  const sendToDeclared = showPhoneChoice && phoneChoice === 'declared'

  async function onValid(values: Values) {
    setFormError(null)
    const toDeclared = values.delivery === 'whatsapp' && !phoneMatches && values.phoneChoice === 'declared'
    const { result, opened } = await issueOpeningWhatsApp(values.delivery, () =>
      issuePortalInvite({
        memberId: candidate.memberId,
        familyScope: values.scope === 'group',
        relationship: values.relationship,
        delivery: values.delivery,
        requestId,
        ...(toDeclared ? { sendToDeclaredPhone: true } : {}),
      }),
    )
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setIssued({ token: result.data, delivery: values.delivery, opened })
  }

  function handleResultClose() {
    setIssued(null)
    onDone()
  }

  return (
    <>
      <form id={REVIEW_INVITE_FORM_ID} onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
        {candidate.hasAccount ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            Este socio ya tiene una cuenta. Invitar a otra persona es válido (madre y padre): la cuenta que ya existe va a ver un aviso en la app.
          </p>
        ) : null}

        {candidate.familyGroupId != null ? (
          <ChoiceGroup
            label="¿A quién ve la persona invitada?"
            columns={1}
            value={scope}
            onChange={(value) => form.setValue('scope', value)}
            errorId={ids.scope}
            disabled={pending}
            options={[
              { value: 'member', label: 'Solo a este socio' },
              { value: 'group', label: 'A todo el grupo familiar (incluye a quienes se sumen después)' },
            ]}
          />
        ) : null}

        <ChoiceGroup
          label="¿Quién es la persona que pide?"
          columns={1}
          value={relationship}
          onChange={(value) => form.setValue('relationship', value)}
          errorId={ids.relationship}
          disabled={pending}
          options={[
            { value: 'guardian', label: 'Madre, padre o tutor del socio' },
            { value: 'self', label: 'El propio socio' },
          ]}
        />

        <ChoiceGroup
          label="¿Cómo se la hacés llegar?"
          columns={1}
          value={delivery}
          onChange={(value) => form.setValue('delivery', value)}
          errorId={ids.delivery}
          disabled={pending}
          options={[
            { value: 'whatsapp', label: 'Por WhatsApp (vale 72 horas)' },
            { value: 'qr', label: 'Con un QR en pantalla, si está con vos (vale 15 minutos)' },
          ]}
        />

        {showPhoneChoice ? (
          <div className="flex flex-col gap-2">
            <ChoiceGroup
              label="¿A qué teléfono va?"
              columns={1}
              value={phoneChoice}
              onChange={(value) => form.setValue('phoneChoice', value)}
              errorId={ids.phone}
              disabled={pending}
              options={[
                { value: 'registry', label: 'Al teléfono que el club tiene del socio (recomendado)' },
                { value: 'declared', label: `Al que dejó la persona: ${declaredPhone}` },
              ]}
            />
            {sendToDeclared ? (
              <p role="alert" className="flex items-start gap-2 rounded-lg bg-status-in-debt/10 px-3 py-2 text-sm text-status-in-debt">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  Ese teléfono no coincide con el del padrón. Si quien pidió no es quien dice ser, se queda con el acceso a los datos del socio. Mandala ahí solo si la conocés o la verificaste por otra vía.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        {formError ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
            {delivery === 'whatsapp' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => form.setValue('delivery', 'qr')}>
                Usar el QR en pantalla
              </Button>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" disabled={pending} aria-keyshortcuts="i" className="w-full sm:w-fit">
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {pending ? 'Generando…' : reissue ? (delivery === 'whatsapp' ? 'Reemitir por WhatsApp' : 'Reemitir y mostrar el QR') : delivery === 'whatsapp' ? 'Invitar por WhatsApp' : 'Invitar y mostrar el QR'}
        </Button>
      </form>

      <Dialog open={issued != null} onOpenChange={(open) => !open && handleResultClose()}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invitación lista</DialogTitle>
            <DialogDescription>Cada mensaje lo manda una persona del club: el sistema no envía nada por su cuenta.</DialogDescription>
          </DialogHeader>
          {issued ? <IssuedLinkResult issued={issued.token} delivery={issued.delivery} opened={issued.opened} /> : null}
          <DialogFooter>
            <Button type="button" onClick={handleResultClose}>
              Listo, siguiente pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
