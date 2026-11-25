/**
 * Abre `wa.me` en una pestaña nueva sin que el navegador la bloquee.
 *
 * Emitir la invitación es una llamada al servidor: si se hiciera `window.open`
 * recién cuando vuelve la respuesta, Safari y varios navegadores móviles lo
 * toman como una ventana emergente no pedida. Se abre una pestaña en blanco
 * en el mismo gesto del clic y se navega cuando llega el enlace. El enlace
 * (que lleva el token) vive solo en memoria del cliente: nunca en HTML de
 * servidor, storage, logs ni query strings.
 */
export type PendingTab = {
  /** Devuelve `false` si el enlace no es de `wa.me` o el navegador no dejó navegar. */
  navigate: (url: string) => boolean
  close: () => void
}

export function openPendingTab(): PendingTab | null {
  if (typeof window === 'undefined') return null
  const tab = window.open('about:blank', '_blank')
  if (!tab) return null
  return {
    navigate(url) {
      if (!url.startsWith('https://wa.me/')) return false
      try {
        // Sin referencia de vuelta: la pestaña de WhatsApp no tiene que poder tocar el panel.
        tab.opener = null
        tab.location.href = url
        return true
      } catch {
        return false
      }
    },
    close() {
      try {
        tab.close()
      } catch {
        // Ya cerrada: nada que hacer.
      }
    },
  }
}
