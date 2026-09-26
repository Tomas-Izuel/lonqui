'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { MemberStatusPill } from '@/views/shared/status-pill'
import { WhatsAppLink } from '@/views/shared/whatsapp-link'
import { setPaymentResponsible } from '@/controllers/members.actions'
import type { FamilyGroupSummary } from '@/models/types'

/**
 * No hay una acción separada de "asignar a un grupo" (B2, dev log): unirse o
 * salir de un grupo se hace editando al socio (`familyGroupId`). Acá solo se
 * gestiona el responsable de pago dentro de un grupo ya armado, vía la RPC
 * atómica `set_family_payment_responsible`.
 */
export function FamilyGroupSection({
  familyGroup,
  currentMemberId,
  canManage,
}: {
  familyGroup: FamilyGroupSummary | null
  currentMemberId: number
  canManage: boolean
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!familyGroup) {
    return (
      <Panel title="Grupo familiar">
        <p className="text-sm text-muted-foreground">
          Este socio no pertenece a un grupo familiar.
          {canManage ? (
            <>
              {' '}
              Se asigna desde{' '}
              <Link href={`/socios/${currentMemberId}/editar`} className="underline underline-offset-4 hover:text-foreground">
                Editar
              </Link>
              .
            </>
          ) : null}
        </p>
      </Panel>
    )
  }

  function handleSetResponsible(memberId: number) {
    setError(null)
    setPendingId(memberId)
    startTransition(async () => {
      const result = await setPaymentResponsible({ groupId: familyGroup!.id, memberId })
      setPendingId(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Responsable de pago actualizado')
      router.refresh()
    })
  }

  return (
    <Panel title="Grupo familiar" description={familyGroup.label}>
      <div className="flex flex-col gap-3">
        {familyGroup.missingResponsible ? (
          <p className="rounded-lg bg-status-in-debt/10 px-3 py-2 text-sm text-status-in-debt">
            Este grupo no tiene un responsable de pago activo.
          </p>
        ) : null}

        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {familyGroup.members.map((groupMember) => (
            <li key={groupMember.id} className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2">
              {groupMember.id === currentMemberId ? (
                <span className="font-medium">{groupMember.fullName}</span>
              ) : (
                <Link href={`/socios/${groupMember.id}`} className="font-medium underline-offset-4 hover:underline">
                  {groupMember.fullName}
                </Link>
              )}
              <MemberStatusPill status={groupMember.status} />
              {groupMember.isPaymentResponsible ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Star aria-hidden className="size-3.5" />
                  Responsable de pago
                </span>
              ) : null}
              {canManage && !groupMember.isPaymentResponsible && groupMember.status === 'active' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={pendingId === groupMember.id}
                  onClick={() => handleSetResponsible(groupMember.id)}
                >
                  {pendingId === groupMember.id ? <Loader2 aria-hidden className="animate-spin" /> : null}
                  Marcar como responsable
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {familyGroup.payerContactName || familyGroup.payerContactPhone ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              Contacto de pago: {familyGroup.payerContactName ?? 'Sin nombre'}
              {familyGroup.payerContactPhone ? ` · ${familyGroup.payerContactPhone}` : ''}
            </span>
            {familyGroup.payerContactPhone ? (
              <WhatsAppLink phone={familyGroup.payerContactPhone} label="Escribir al contacto" />
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
