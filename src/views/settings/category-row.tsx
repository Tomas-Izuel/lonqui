'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, MoreVertical, Pencil, Power, PowerOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusPill } from '@/views/shared/status-pill'
import { CategoryFormSheet } from '@/views/settings/category-form-sheet'
import { ConfirmToggleDialog } from '@/views/settings/confirm-toggle-dialog'
import { reorderCategories, setCategoryActive } from '@/controllers/settings.actions'
import type { Category } from '@/models/types'

const memberCountFormatter = new Intl.NumberFormat('es-AR')

function activeMemberNotice(count: number): string | undefined {
  if (count === 0) return undefined
  return count === 1 ? 'Tiene 1 socio activo hoy.' : `Tiene ${memberCountFormatter.format(count)} socios activos hoy.`
}

/**
 * Fila de categoría dentro de una disciplina. `siblingIds` es el orden actual
 * de TODAS las categorías de esa disciplina (ya ordenadas): reordenar arma el
 * array completo con la posición pedida intercambiada y llama a
 * `reorderCategories`, que asigna `sort_order` = índice.
 */
export function CategoryRow({
  category,
  position,
  siblingIds,
  disciplineName,
}: {
  category: Category
  position: number
  siblingIds: number[]
  disciplineName: string
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
      const result = await reorderCategories(category.disciplineId, nextOrder)
      if (!result.ok) toast.error(result.error)
    })
  }

  async function handleActivate() {
    const result = await setCategoryActive(category.id, true)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Categoría activada')
  }

  async function handleDeactivateConfirmed() {
    const result = await setCategoryActive(category.id, false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Categoría desactivada', { description: activeMemberNotice(result.data.activeMemberCount) })
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-l border-border py-2 pl-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{category.name}</span>
        <StatusPill variant={category.isActive ? 'member-active' : 'member-inactive'}>
          {category.isActive ? 'Activa' : 'Inactiva'}
        </StatusPill>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          disabled={isFirst || isReordering}
          onClick={() => move(-1)}
          aria-label={`Subir ${category.name}`}
        >
          <ChevronUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-11"
          disabled={isLast || isReordering}
          onClick={() => move(1)}
          aria-label={`Bajar ${category.name}`}
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
              aria-label={`Más acciones para ${category.name}`}
            >
              <MoreVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil aria-hidden />
              Editar
            </DropdownMenuItem>
            {category.isActive ? (
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

      <CategoryFormSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        disciplineId={category.disciplineId}
        disciplineName={disciplineName}
        category={category}
      />
      <ConfirmToggleDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        title={`¿Desactivar ${category.name}?`}
        description="Deja de aparecer para altas nuevas del padrón. Los socios ya cargados en esta categoría no se ven afectados."
        actionLabel="Desactivar"
        onConfirm={handleDeactivateConfirmed}
      />
    </li>
  )
}
