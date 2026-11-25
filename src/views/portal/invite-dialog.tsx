'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { issuePortalInvite } from '@/controllers/portal.actions'
import { ChoiceGroup } from '@/views/income/choice-group'
import { CheckboxField } from '@/views/shared/form-fields'
import { IssuedLinkResult } from '@/views/portal/issued-link-result'
import { issueOpeningWhatsApp } from '@/views/portal/issue-link'
import type { IssuedPortalToken, PortalRelationship, PortalTokenDelivery } from '@/models/types'

const schema = z.object({
  scope: z.enum(['member', 'group']),
  relationship: z.enum(['self', 'guardian']),
  delivery: z.enum(['whatsapp', 'qr']),
  keepOthers: z.boolean(),
})
type Values = z.infer<typeof schema>

export type InviteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  memberId: number
  /** Con grupo se puede invitar a todo el grupo (`family_scope`). */
  familyGroupId: number | null
  defaultRelationship: PortalRelationship
  /** Ya hay una cuenta vinculada: una segunda invitación es válida (madre y padre), pero se avisa. */
  hasExistingAccount: boolean
  /** Ya hay una invitación vigente: se ofrece NO reemplazarla. */
  hasLiveInvite: boolean
  hasPhoneOnFile: boolean
  /** Viene de "Crear el socio" desde Revisión: la invitación resuelve ese pedido. */
  requestId?: number
}

/**
 * "Invitar a la app" desde la ficha del socio o del grupo: WhatsApp (abre
 * `wa.me`) o QR en pantalla. "Invitar a otra persona" (`keepOthers`) manda
 * `replacePending: false`, para no anular la invitación que ya está viva (la
 * de la madre cuando ahora se invita al padre).
 */
export function InviteDialog({
  open,
  onOpenChange,
  memberId,
  familyGroupId,
  defaultRelationship,
  hasExistingAccount,
  hasLiveInvite,
  hasPhoneOnFile,
  requestId,
}: InviteDialogProps) {
  const router = useRouter()
  const [issued, setIssued] = useState<{ token: IssuedPortalToken; delivery: PortalTokenDelivery; opened: boolean } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const ids = { scope: useId(), relationship: useId(), delivery: useId() }

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      scope: familyGroupId != null && defaultRelationship === 'guardian' ? 'group' : 'member',
      relationship: defaultRelationship,
      // Sin teléfono en el padrón no se ofrece WhatsApp: se arranca en QR.
      delivery: hasPhoneOnFile ? 'whatsapp' : 'qr',
      keepOthers: false,
    },
  })
  const scope = useWatch({ control: form.control, name: 'scope' })
  const relationship = useWatch({ control: form.control, name: 'relationship' })
  const delivery = useWatch({ control: form.control, name: 'delivery' })
  const pending = form.formState.isSubmitting

  function handleOpenChange(next: boolean) {
    if (!next) {
      const hadIssued = issued != null
      form.reset()
      setIssued(null)
      setFormError(null)
      // La ficha muestra invitaciones y cuentas: se actualizan al cerrar.
      if (hadIssued) router.refresh()
    }
    onOpenChange(next)
  }

  async function onValid(values: Values) {
    setFormError(null)
    const { result, opened } = await issueOpeningWhatsApp(values.delivery, () =>
      issuePortalInvite({
        memberId,
        familyScope: values.scope === 'group',
        relationship: values.relationship,
        delivery: values.delivery,
        requestId,
        replacePending: !values.keepOthers,
      }),
    )
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setIssued({ token: result.data, delivery: values.delivery, opened })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{issued ? 'Invitación lista' : 'Invitar a la app de socios'}</DialogTitle>
          <DialogDescription>
            {issued
              ? 'Cada mensaje lo manda una persona del club: el sistema no envía nada por su cuenta.'
              : 'Se genera un enlace de un solo uso. Elegí a quién va y cómo se lo hacés llegar.'}
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <>
            <IssuedLinkResult issued={issued.token} delivery={issued.delivery} opened={issued.opened} />
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Listo
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={form.handleSubmit(onValid)} noValidate method="post" className="flex flex-col gap-4">
            {hasExistingAccount ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm">
                Ya hay una cuenta vinculada. Invitar a otra persona es válido (madre y padre): la cuenta que ya existe va a ver un aviso en la app.
              </p>
            ) : null}

            {familyGroupId != null ? (
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
              label="¿Quién es la persona invitada?"
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
                ...(hasPhoneOnFile ? [{ value: 'whatsapp' as const, label: 'Por WhatsApp (vale 72 horas)' }] : []),
                { value: 'qr' as const, label: 'Con un QR en esta pantalla (vale 15 minutos)' },
              ]}
            />

            {!hasPhoneOnFile ? (
              <p className="text-sm text-muted-foreground">
                WhatsApp no está disponible: no hay un teléfono cargado para este socio. Cargalo en la ficha para poder mandarlo por ahí.
              </p>
            ) : null}

            {hasLiveInvite ? (
              <CheckboxField
                control={form.control}
                name="keepOthers"
                label="Invitar a otra persona"
                description="No anula la invitación que ya está vigente. Sin marcar, la invitación nueva reemplaza a la anterior."
                disabled={pending}
              />
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {pending ? 'Generando…' : delivery === 'whatsapp' ? 'Invitar por WhatsApp' : 'Mostrar el QR'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
