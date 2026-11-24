'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { issuePortalLoginLink } from '@/controllers/portal.actions'
import { ChoiceGroup } from '@/views/income/choice-group'
import { IssuedLinkResult } from '@/views/portal/issued-link-result'
import { issueOpeningWhatsApp } from '@/views/portal/issue-link'
import type { IssuedPortalToken, PortalTokenDelivery } from '@/models/types'

/**
 * "Enlace de ingreso": para que una cuenta vuelva a entrar cuando no puede
 * (solo Administrador, `portal.login_link`). El aviso de que quien lo emite
 * puede abrirlo es parte de la pantalla, no letra chica (00 §4.A.7). No hay
 * formulario con campos de texto: la única elección es la entrega, así que
 * no hace falta RHF.
 */
export function LoginLinkDialog({
  open,
  onOpenChange,
  accountId,
  accountName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  accountName: string
}) {
  const router = useRouter()
  const groupId = useId()
  const [delivery, setDelivery] = useState<PortalTokenDelivery>('whatsapp')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ token: IssuedPortalToken; delivery: PortalTokenDelivery; opened: boolean } | null>(null)

  function handleOpenChange(next: boolean) {
    if (!next) {
      const hadIssued = issued != null
      setIssued(null)
      setError(null)
      setDelivery('whatsapp')
      if (hadIssued) router.refresh()
    }
    onOpenChange(next)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    const { result, opened } = await issueOpeningWhatsApp(delivery, () => issuePortalLoginLink({ accountId, delivery }))
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setIssued({ token: result.data, delivery, opened })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{issued ? 'Enlace de ingreso listo' : `Enlace de ingreso para ${accountName}`}</DialogTitle>
          <DialogDescription>Sirve para que la persona vuelva a entrar a la app. Es de un solo uso.</DialogDescription>
        </DialogHeader>

        <p role="note" className="rounded-lg bg-status-in-debt/10 px-3 py-2 text-sm text-status-in-debt">
          Atención: quien emite este enlace puede abrirlo y entrar como la persona. Emitilo solo si ella te lo pidió. Queda registrado quién lo emitió y cuándo.
        </p>

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
          <form onSubmit={handleSubmit} noValidate method="post" className="flex flex-col gap-4">
            <ChoiceGroup
              label="¿Cómo se lo hacés llegar?"
              columns={1}
              value={delivery}
              onChange={setDelivery}
              errorId={groupId}
              disabled={pending}
              options={[
                { value: 'whatsapp', label: 'Por WhatsApp (vale 30 minutos)' },
                { value: 'qr', label: 'Con un QR en esta pantalla (vale 15 minutos)' },
              ]}
            />
            {error ? (
              <div className="flex flex-col items-start gap-2">
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
                {delivery === 'whatsapp' ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setDelivery('qr')}>
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
                {pending ? 'Generando…' : 'Emitir enlace'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
