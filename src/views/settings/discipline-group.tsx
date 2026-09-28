'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, MoreVertical, Pencil, Plus, Power, PowerOff } from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusPill } from '@/views/shared/status-pill'
import { CategoryRow } from '@/views/settings/category-row'
import { DisciplineFormSheet } from '@/views/settings/discipline-form-sheet'
import { CategoryFormSheet } from '@/views/settings/category-form-sheet'
import { ConfirmToggleDialog } from '@/views/settings/confirm-toggle-dialog'
import { reorderDisciplines, setDisciplineActive } from '@/controllers/settings.actions'
import { DURATION, EASE_ENTER, staggerDelay, useMotionPreference } from '@/views/shared/motion'
import type { DisciplineWithCategories } from '@/models/types'

/**
 * Una disciplina con su lista de categorías debajo: encabezado + filas, NO
 * tarjetas anidadas (route-ajustes.md). `siblingIds` es el orden actual de
 * TODAS las disciplinas (para reordenar); `position` es el índice de esta.
 */
export function DisciplineGroup({
  discipline,
  position,
  siblingIds,
}: {
  discipline: DisciplineWithCategories
  position: number
  siblingIds: number[]
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
  const [isReordering, startReorder] = useTransition()
  const [isToggling, startToggle] = useTransition()
  const { pick } = useMotionPreference()

  const isFirst = position === 0
  const isLast = position === siblingIds.length - 1
  const categoryIds = discipline.categories.map((c) => c.id)

  function move(delta: 1 | -1) {
    const targetIndex = position + delta
    if (targetIndex < 0 || targetIndex >= siblingIds.length) return
    const nextOrder = [...siblingIds]
    ;[nextOrder[position], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[position]]
    startReorder(async () => {
      const result = await reorderDisciplines(nextOrder)
      if (!result.ok) toast.error(result.error)
    })
  }

  async function handleActivate() {
    const result = await setDisciplineActive(discipline.id, true)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Disciplina activada')
  }

  async function handleDeactivateConfirmed() {
    const result = await setDisciplineActive(discipline.id, false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Disciplina desactivada')
  }

  return (
    // Entrada escalonada al montar (D5/animate.md): solo juega una vez por
    // instancia —`initial`/`animate` no vuelven a correr en los re-renders
    // que disparan el reordenar o abrir un sheet, solo si React remonta el
    // nodo (una disciplina nueva, con otra `key`)—, así que reordenar nunca
    // repite la animación de los que ya estaban.
    <motion.li
      initial={{ opacity: 0, y: pick(8, 0) }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.state, ease: EASE_ENTER, delay: staggerDelay(position) }}
      className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0"
    >
      {/*
        Ronda 2 (screenshot a 390px): `flex-wrap` dejaba que la fila de
        acciones (subir/bajar/más, 3 botones de 44px) se cayera a una línea
        propia debajo del nombre en vez de quedar a la derecha — acá va
        siempre `flex-nowrap` (nombre truncando en `min-w-0 flex-1`, acciones
        fijas a la derecha con `shrink-0`), igual que cualquier fila de
        `DataList`.
      */}
      <div className="group -mx-2 flex flex-nowrap items-center justify-between gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-muted/40">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h3 className="truncate font-heading text-sm font-semibold sm:text-base">{discipline.name}</h3>
          <StatusPill variant={discipline.isActive ? 'member-active' : 'member-inactive'} className="shrink-0">
            {discipline.isActive ? 'Activa' : 'Inactiva'}
          </StatusPill>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11"
            disabled={isFirst || isReordering}
            onClick={() => move(-1)}
            aria-label={`Subir ${discipline.name}`}
          >
            <ChevronUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11"
            disabled={isLast || isReordering}
            onClick={() => move(1)}
            aria-label={`Bajar ${discipline.name}`}
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
                aria-label={`Más acciones para ${discipline.name}`}
              >
                <MoreVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil aria-hidden />
                Editar
              </DropdownMenuItem>
              {discipline.isActive ? (
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
      </div>

      {discipline.categories.length > 0 ? (
        <ul aria-label={`Categorías de ${discipline.name}`} className="flex flex-col divide-y divide-border">
          {discipline.categories.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              position={index}
              siblingIds={categoryIds}
              disciplineName={discipline.name}
            />
          ))}
        </ul>
      ) : (
        <p className="pl-3 text-sm text-muted-foreground">Todavía no tiene categorías.</p>
      )}

      <Button variant="outline" size="sm" onClick={() => setCreateCategoryOpen(true)} className="mt-1 h-11 w-fit">
        <Plus aria-hidden />
        Nueva categoría
      </Button>

      <DisciplineFormSheet open={editOpen} onOpenChange={setEditOpen} discipline={discipline} />
      <CategoryFormSheet
        open={createCategoryOpen}
        onOpenChange={setCreateCategoryOpen}
        disciplineId={discipline.id}
        disciplineName={discipline.name}
      />
      <ConfirmToggleDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        title={`¿Desactivar ${discipline.name}?`}
        description="Deja de aparecer para altas nuevas del padrón, junto con sus categorías. Los socios ya cargados no se ven afectados."
        actionLabel="Desactivar"
        onConfirm={handleDeactivateConfirmed}
      />
    </motion.li>
  )
}
