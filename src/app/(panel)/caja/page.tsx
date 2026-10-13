import type { Metadata } from 'next'
import { requirePanelAccess } from '@/controllers/session.controller'
import { getCajaHub } from '@/controllers/reports.controller'
import { CajaHubView } from '@/views/payments/caja-hub-view'

export const metadata: Metadata = { title: 'Caja — Lonqui' }

/**
 * Hub de `/caja` (route-caja.md). El chequeo de permisos de lectura vive en
 * `getCajaHub()`; acá solo se resuelve la sesión para decidir qué botones se
 * muestran (UX, no defensa: la defensa son las RLS). "Registrar pago" y
 * "Registrar otro ingreso" abren overlays globales (`?pagar=`, `?ingreso=`).
 */
export default async function CajaPage() {
  const [session, hub] = await Promise.all([requirePanelAccess(), getCajaHub()])

  return (
    <CajaHubView
      cash={hub.cash}
      summary={hub.summary}
      billing={hub.billing}
      daily={hub.daily}
      permissions={session.permissions}
    />
  )
}
