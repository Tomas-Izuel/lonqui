import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getPaymentFormData } from '@/controllers/payments.actions'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { ErrorState } from '@/views/shared/states'
import { PaymentFormPage } from '@/views/payments/payment-form-page'

export const metadata: Metadata = { title: 'Registrar pago — Club Naranja y Blanco' }

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * `/cobranza/nuevo?socio=<id>` o `?grupo=<id>`, con `?volver=` para saber a
 * dónde volver después de registrar (la ficha del socio si se abrió desde
 * ahí, `/cobranza` si no). `volver` viaja del cliente (queda en la URL, lo
 * puede editar cualquiera) y `PaymentFormPage`/`PaymentForm` hacen
 * `router.push(volverHref)` en el browser: sin validar, `?volver=https://evil.
 * example` o `?volver=//evil.example` es un open redirect (mismo blocker que
 * tuvo el login en el slice 1). Se sanea ACÁ, en el servidor, con
 * `safeRedirectPath` — la vista nunca recibe nada que no sea una ruta interna.
 * `getPaymentFormData` es una Server Action
 * (`payments.actions.ts`, B2) pero se llama DIRECTO acá: en un Server
 * Component es una función async común — nada la distingue de un controller
 * de lectura salvo que también puede importarla un Client Component (la usa
 * `RegisterPaymentSheet`). Sin esto, el formulario más rápido del sistema
 * pagaría un viaje cliente-servidor extra antes de poder mostrar nada.
 */
export default async function RegisterPaymentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  await requirePanelPermission('payments.register')

  const socioRaw = firstValue(sp.socio)
  const grupoRaw = firstValue(sp.grupo)
  const memberId = socioRaw && /^\d+$/.test(socioRaw) ? Number(socioRaw) : undefined
  const familyGroupId = grupoRaw && /^\d+$/.test(grupoRaw) ? Number(grupoRaw) : undefined
  const volverHref = safeRedirectPath(firstValue(sp.volver), '/cobranza')

  if (memberId == null && familyGroupId == null) {
    redirect('/cobranza')
  }

  const result = await getPaymentFormData({ memberId, familyGroupId })

  if (!result.ok) {
    return <ErrorState title="No pudimos abrir el formulario de pago" description={result.error} />
  }

  return <PaymentFormPage data={result.data} volverHref={volverHref} />
}
