'use client'

import { useRouter } from 'next/navigation'
import { PaymentForm } from '@/views/payments/payment-form'
import { GroupPaymentForm } from '@/views/payments/group-payment-form'
import type { PaymentFormData } from '@/models/types'

/**
 * `/cobranza/nuevo` (page.tsx): decide individual vs. grupo según si
 * `data.familyGroup` viene poblado (lo decide `getPaymentFormData` según se
 * haya llamado con `memberId` o `familyGroupId`), y vuelve a `volverHref` al
 * terminar — la ficha del socio si se abrió desde ahí, o `/cobranza`.
 */
export function PaymentFormPage({ data, volverHref }: { data: PaymentFormData; volverHref: string }) {
  const router = useRouter()

  function onDone() {
    router.push(volverHref)
  }

  if (data.familyGroup) {
    return <GroupPaymentForm members={data.members} familyGroup={data.familyGroup} onDone={onDone} />
  }
  return <PaymentForm member={data.members[0]} onDone={onDone} />
}
