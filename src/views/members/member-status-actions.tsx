'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ReasonDialog, type ReasonDialogResult, type ReasonDialogValues } from '@/views/shared/reason-dialog'
import { reactivateMember, withdrawMember } from '@/controllers/members.actions'
import type { MemberStatus } from '@/models/types'

/**
 * Baja y reactivación: solo `admin` (llamante ya lo garantiza — no se
 * renderiza este componente para otro rol). El botón que abre el diálogo es
 * una acción secundaria (`variant="outline"`), nunca un botón rojo
 * prominente (route-socios-id.md); nunca la palabra "eliminar".
 */
export function MemberStatusActions({ memberId, status }: { memberId: number; status: MemberStatus }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  async function handleConfirm(values: ReasonDialogValues): Promise<ReasonDialogResult> {
    const action = status === 'active' ? withdrawMember : reactivateMember
    const result = await action({ memberId, effectiveOn: values.effectiveOn, reason: values.reason })
    if (!result.ok) {
      return { ok: false, error: result.error, field: result.field }
    }
    toast.success(status === 'active' ? 'Socio dado de baja' : 'Socio reactivado')
    router.refresh()
    return { ok: true }
  }

  return (
    <>
      <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
        {status === 'active' ? 'Dar de baja' : 'Reactivar'}
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={status === 'active' ? 'Dar de baja al socio' : 'Reactivar al socio'}
        consequence={
          status === 'active'
            ? 'Deja de generar cuota desde el mes siguiente. La ficha queda en el sistema.'
            : 'Vuelve a figurar activo y a generar cuota desde el mes siguiente. Se guarda la fecha y el motivo.'
        }
        actionLabel={status === 'active' ? 'Dar de baja' : 'Reactivar'}
        onConfirm={handleConfirm}
      />
    </>
  )
}
