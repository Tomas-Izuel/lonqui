import { redirect } from 'next/navigation'
import { requirePanelPermission } from '@/controllers/session.controller'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { paymentOverlayValue } from '@/views/shared/overlay-values'

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * `/cobranza/nuevo` ya NO tiene vista propia (pipeline 2026-09-28-ui-expresiva,
 * D1): el formulario de pago vive en `PaymentOverlayHost`, montado sobre
 * cualquier página, direccionable con `?pagar=socio:<id>` / `?pagar=grupo:<id>`
 * (`overlay-params.ts`; los valores puros, en `overlay-values.ts`). Esta ruta queda solo para que un link viejo guardado
 * (`/cobranza/nuevo?socio=5&volver=/socios/5`) siga funcionando: redirige, sin
 * JS, a `volver` con el overlay ya puesto en la URL de destino — nunca renderiza
 * un formulario propio.
 *
 * `volver` viaja del cliente (queda en la URL, cualquiera la puede editar):
 * se sanea con `safeRedirectPath` antes de usarla, igual que antes.
 */
export default async function RegisterPaymentRedirectPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  await requirePanelPermission('payments.register')

  const socioRaw = firstValue(sp.socio)
  const grupoRaw = firstValue(sp.grupo)
  const memberId = socioRaw && /^\d+$/.test(socioRaw) ? Number(socioRaw) : undefined
  const familyGroupId = grupoRaw && /^\d+$/.test(grupoRaw) ? Number(grupoRaw) : undefined
  const volverHref = safeRedirectPath(firstValue(sp.volver), '/cobranza')

  if (memberId == null && familyGroupId == null) {
    redirect(volverHref)
  }

  const overlayValue =
    familyGroupId != null ? paymentOverlayValue({ mode: 'grupo', familyGroupId }) : paymentOverlayValue({ mode: 'socio', memberId: memberId as number })

  const separator = volverHref.includes('?') ? '&' : '?'
  redirect(`${volverHref}${separator}pagar=${encodeURIComponent(overlayValue)}`)
}
