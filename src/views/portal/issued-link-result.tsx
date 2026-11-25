'use client'

import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QrPanel } from '@/views/portal/qr-panel'
import { DateTimeText } from '@/views/shared/date-text'
import type { IssuedPortalToken, PortalTokenDelivery } from '@/models/types'

/**
 * Lo que se ve después de emitir un enlace: el aviso de WhatsApp (con el
 * botón por si el navegador no dejó abrir la pestaña) o el QR en pantalla.
 * `issued` solo existe en memoria del cliente: se descarta al cerrar el
 * diálogo que lo contiene.
 */
export function IssuedLinkResult({
  issued,
  delivery,
  opened,
}: {
  issued: IssuedPortalToken
  delivery: PortalTokenDelivery
  opened: boolean
}) {
  if (delivery === 'qr') return <QrPanel issued={issued} />

  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="text-sm">
        {opened
          ? 'Se abrió WhatsApp con el mensaje armado. Falta que toques enviar: nada se manda solo.'
          : 'El mensaje está armado. Abrí WhatsApp y tocá enviar: nada se manda solo.'}
      </p>
      {issued.whatsappUrl ? (
        <Button asChild variant={opened ? 'outline' : 'default'} className="w-full gap-2">
          <a href={issued.whatsappUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden />
            {opened ? 'Abrir WhatsApp de nuevo' : 'Abrir WhatsApp'}
          </a>
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        El enlace vence <DateTimeText instant={issued.expiresAt} /> y sirve una sola vez.
      </p>
    </div>
  )
}
