'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getPortalTokenState } from '@/controllers/portal.actions'
import { DateTimeText } from '@/views/shared/date-text'
import type { IssuedPortalToken, PortalTokenState } from '@/models/types'

const POLL_MS = 3000

/** `closed`: la página salió de pantalla (bfcache) y el QR se descartó. */
type QrState = PortalTokenState | 'closed'

const GONE_MESSAGES: Record<Exclude<QrState, 'pending'>, { title: string; detail: string }> = {
  consumed: { title: 'Usada', detail: 'La persona ya entró con este QR. Cerrá esta ventana.' },
  expired: { title: 'Vencida', detail: 'El QR ya no sirve. Generá uno nuevo si hace falta.' },
  revoked: { title: 'Anulada', detail: 'La invitación se anuló. Generá una nueva si hace falta.' },
  locked: { title: 'Bloqueada', detail: 'Se bloqueó por demasiados intentos. Generá una invitación nueva.' },
  closed: { title: 'QR descartado', detail: 'Por seguridad el QR no se conserva al salir de la pantalla. Generá uno nuevo.' },
}

/**
 * QR de invitación dibujado EN EL CLIENTE a partir de la `url` de la respuesta
 * de la action (con `qrcode`, cargado recién acá para no sumarlo al bundle de
 * la ficha). La `url` lleva el token en el fragmento: no se escribe en el
 * DOM como texto ni atributo, solo en un `<canvas>`, y desaparece apenas el
 * token deja de estar vigente.
 *
 * Mientras la pestaña está visible consulta el estado cada ~3 s para mostrar
 * "Usada" en vivo; un temporizador lo marca vencido a la hora exacta aunque
 * el servidor no conteste.
 */
export function QrPanel({ issued }: { issued: IssuedPortalToken }) {
  const [state, setState] = useState<QrState>('pending')
  const [pollFailed, setPollFailed] = useState(false)
  const [drawn, setDrawn] = useState(false)
  const [drawFailed, setDrawFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { tokenId, url, expiresAt } = issued
  const live = state === 'pending'

  useEffect(() => {
    if (!live) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function check() {
      if (document.visibilityState !== 'visible') return
      try {
        const result = await getPortalTokenState({ tokenId })
        if (cancelled) return
        if (!result.ok) {
          setPollFailed(true)
          return
        }
        setPollFailed(false)
        if (result.data.state !== 'pending') setState(result.data.state)
      } catch {
        if (!cancelled) setPollFailed(true)
      }
    }

    function schedule() {
      timer = setTimeout(async () => {
        await check()
        if (!cancelled) schedule()
      }, POLL_MS)
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') void check()
    }
    function onPageHide() {
      setState('closed')
    }

    schedule()
    const expiryTimer = setTimeout(() => !cancelled && setState('expired'), Math.max(0, new Date(expiresAt).getTime() - Date.now()))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      clearTimeout(expiryTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [live, tokenId, expiresAt])

  useEffect(() => {
    if (!live) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    // Blanco y negro duros: un lector de QR necesita contraste, no identidad.
    void import('qrcode')
      .then((QRCode) =>
        QRCode.toCanvas(canvas, url, { width: 256, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }),
      )
      .then(() => {
        if (!cancelled) setDrawn(true)
      })
      .catch(() => {
        if (!cancelled) setDrawFailed(true)
      })
    return () => {
      cancelled = true
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [live, url])

  if (live && drawFailed) {
    return (
      <p role="alert" className="rounded-lg bg-muted px-4 py-6 text-center text-sm">
        No pudimos dibujar el QR. Cerrá esta ventana y generá una invitación nueva, o mandala por WhatsApp.
      </p>
    )
  }

  if (live) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative flex w-full max-w-64 items-center justify-center rounded-lg bg-white p-1">
          <canvas ref={canvasRef} role="img" aria-label="Código QR de la invitación" className="h-auto w-full" />
          {!drawn ? (
            <span className="absolute inset-0 flex items-center justify-center" role="status">
              <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
              <span className="sr-only">Generando el QR…</span>
            </span>
          ) : null}
        </div>
        <p className="text-center text-sm">
          Que la persona lo escanee con la cámara. Vence <DateTimeText instant={expiresAt} /> y sirve una sola vez.
        </p>
        {pollFailed ? (
          <p className="text-center text-xs text-muted-foreground">
            No pudimos actualizar el estado. El QR sigue valiendo hasta que venza.
          </p>
        ) : null}
        <p className="sr-only" role="status">
          QR vigente
        </p>
      </div>
    )
  }

  const gone = GONE_MESSAGES[state as Exclude<QrState, 'pending'>]
  return (
    <div role="status" className="flex flex-col items-center gap-1 rounded-lg bg-muted px-4 py-8 text-center">
      <p className="font-medium">{gone.title}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{gone.detail}</p>
    </div>
  )
}
