'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, MoreVertical, Pencil, Power, PowerOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { StatusPill } from '@/views/shared/status-pill'
import { IncomeConceptFormSheet } from '@/views/settings/income-concept-form-sheet'
import { ConfirmToggleDialog } from '@/views/settings/confirm-toggle-dialog'
import { reorderCashConcepts, setCashConceptActive } from '@/controllers/settings.actions'
import type { CashConcept } from '@/models/types'

/**
 * Fila de concepto de ingreso, mismo molde que `CategoryRow`. `siblingIds` es
 * el orden actual de TODOS los conceptos (activos e inactivos): reordenar
 * arma el array completo con dos posiciones intercambiadas y llama a
 * `reorderCashConcepts`.
 */
export function IncomeConceptRow({
  concept,
  position,
  siblingIds,
}: {
  concept: CashConcept
  position: number
  siblingIds: number[]
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [isReordering, startReorder] = useTransition()
  const [isToggling, startToggle] = useTransition()

  const isFirst = position === 0
  const isLast = position === siblingIds.length - 1

  function move(delta: 1 | -1) {
    const targetIndex = position + delta
    if (targetIndex < 0 || targetIndex >= siblingIds.length) return
    const nextOrder = [...siblingIds]
    ;[nextOrder[position], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[position]]
    startReorder(async () => {
      const result = await reorderCashConcepts(nextOrder)
      if (!result.ok) toast.error(result.error)
    })
  }

  async function handleActivate() {
    const result = await setCashConceptActive(concept.id, true)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Concepto activado')
  }

  async function handleDeactivateConfirmed() {
    const result = await setCashConceptActive(concept.id, false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Concepto desactivado')
  }

  return (
    <li className="flex flex-nowrap items-center justify-between gap-2 py-3 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{concept.name}</span>
          <StatusPill variant={concept.isActive ? 'member-active' : 'member-inactive'} className="shrink-0">
            {concept.isActive ? 'Activo' : 'Inactivo'}
          </StatusPill>
        </div>
        {concept.requiresSponsor ? <span className="text-xs text-muted-foreground">Pide sponsor</span> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          disabled={isFirst || isReordering}
          onClick={() => move(-1)}
          aria-label={`Subir ${concept.name}`}
        >
          <ChevronUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          disabled={isLast || isReordering}
          onClick={() => move(1)}
          aria-label={`Bajar ${concept.name}`}
        >
          <ChevronDown aria-hidden />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              className="size-11"
              disabled={isToggling}
              aria-label={`Más acciones para ${concept.name}`}
            >
              <MoreVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil aria-hidden />
              Editar
            </DropdownMenuItem>
            {concept.isActive ? (
              <DropdownMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault()
                  setDeactivateOpen(true)
                }}
              >
                <PowerOff aria-hidden />
                Desactivar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => startToggle(() => handleActivate())}>
                <Power aria-hidden />
                Activar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <IncomeConceptFormSheet open={editOpen} onOpenChange={setEditOpen} concept={concept} />
      <ConfirmToggleDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        title={`¿Desactivar ${concept.name}?`}
        description="Deja de ofrecerse al registrar ingresos. Los ingresos ya cargados lo siguen mostrando."
        actionLabel="Desactivar"
        onConfirm={handleDeactivateConfirmed}
      />
    </li>
  )
}
