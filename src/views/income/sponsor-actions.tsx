'use client'

import { useState } from 'react'
import { Pencil, Power, PowerOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useHasPermission } from '@/views/shell/panel-session'
import { ReasonDialog, type ReasonDialogResult, type ReasonDialogValues } from '@/views/shared/reason-dialog'
import { ConfirmToggleDialog } from '@/views/settings/confirm-toggle-dialog'
import { RegisterIncomeButton } from '@/views/income/register-income-button'
import { SponsorFormSheet } from '@/views/income/sponsor-form-sheet'
import { setSponsorActive } from '@/controllers/sponsors.actions'
import type { SponsorSummary } from '@/models/types'

/**
 * Acciones de la ficha del sponsor, cada una con su permiso (UX; la defensa
 * real es la acción y la RLS): registrar aporte y editar con `income.register`,
 * desactivar/reactivar con `sponsors.deactivate`. Un sponsor nunca se borra.
 */
export function SponsorActions({ sponsor }: { sponsor: SponsorSummary }) {
  const canRegister = useHasPermission('income.register')
  const canDeactivate = useHasPermission('sponsors.deactivate')
  const [editOpen, setEditOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [reactivateOpen, setReactivateOpen] = useState(false)

  if (!canRegister && !canDeactivate) return null

  async function handleDeactivate(values: ReasonDialogValues): Promise<ReasonDialogResult> {
    const result = await setSponsorActive({ id: sponsor.id, isActive: false, reason: values.reason })
    if (!result.ok) return { ok: false, error: result.error, field: result.field }
    toast.success('Sponsor desactivado')
    return { ok: true }
  }

  async function handleReactivate() {
    const result = await setSponsorActive({ id: sponsor.id, isActive: true })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Sponsor reactivado')
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <RegisterIncomeButton label="Registrar aporte" sponsorId={sponsor.id} disabled={!sponsor.isActive} />
      {canRegister ? (
        <Button type="button" variant="outline" className="h-11" onClick={() => setEditOpen(true)}>
          <Pencil aria-hidden />
          Editar
        </Button>
      ) : null}
      {canDeactivate ? (
        sponsor.isActive ? (
          <Button type="button" variant="outline" className="h-11" onClick={() => setDeactivateOpen(true)}>
            <PowerOff aria-hidden />
            Desactivar
          </Button>
        ) : (
          <Button type="button" variant="outline" className="h-11" onClick={() => setReactivateOpen(true)}>
            <Power aria-hidden />
            Reactivar
          </Button>
        )
      ) : null}

      {canRegister ? <SponsorFormSheet open={editOpen} onOpenChange={setEditOpen} sponsor={sponsor} /> : null}

      {deactivateOpen ? (
        <ReasonDialog
          open={deactivateOpen}
          onOpenChange={setDeactivateOpen}
          title={`Desactivar a ${sponsor.name}`}
          consequence="Deja de ofrecerse al registrar ingresos nuevos. Sus aportes ya cargados siguen visibles y cuentan igual."
          actionLabel="Desactivar"
          showDate={false}
          onConfirm={handleDeactivate}
        />
      ) : null}
      <ConfirmToggleDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        title={`¿Reactivar a ${sponsor.name}?`}
        description="Vuelve a ofrecerse al registrar ingresos."
        actionLabel="Reactivar"
        onConfirm={handleReactivate}
      />
    </div>
  )
}
