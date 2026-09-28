'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Panel } from '@/views/shared/panel'
import { Button } from '@/components/ui/button'
import { DateText } from '@/views/shared/date-text'
import { LeaveCategoryDialog } from '@/views/members/leave-category-dialog'
import { ChangeCategoryDialog } from '@/views/members/change-category-dialog'
import { AddCategoryDialog } from '@/views/members/add-category-dialog'
import type { DisciplineWithCategories, MemberCategoryMembership } from '@/models/types'

/**
 * Panel "Deportes" de la ficha (§13.6): las inscripciones ABIERTAS con
 * "desde <fecha>" y, con `members.write`, "Cambiar de categoría" (solo si
 * la disciplina tiene más de una) y "Dar de baja de <categoría>"; "Agregar
 * deporte" (solo disciplinas sin inscripción abierta); historia plegada con
 * TODA la pertenencia (abierta y cerrada). Nunca "eliminar".
 */
export function MemberCategoriesSection({
  memberId,
  categoryHistory,
  disciplines,
  canManage,
}: {
  memberId: number
  categoryHistory: MemberCategoryMembership[]
  disciplines: DisciplineWithCategories[]
  canManage: boolean
}) {
  const router = useRouter()
  const [leavingId, setLeavingId] = useState<number | null>(null)
  const [changingId, setChangingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const open = categoryHistory.filter((m) => m.leftOn === null)
  const openCategoryIds = open.map((m) => m.categoryId)
  const disciplineById = new Map(disciplines.map((d) => [d.id, d]))
  const availableDisciplines = disciplines.filter((d) => !open.some((m) => m.disciplineId === d.id))

  function handleDone() {
    router.refresh()
  }

  const leaving = open.find((m) => m.id === leavingId)
  const changing = open.find((m) => m.id === changingId)
  const changingDiscipline = changing ? disciplineById.get(changing.disciplineId) : undefined
  const changingOtherCategories = (changingDiscipline?.categories ?? []).filter((c) => c.id !== changing?.categoryId)

  return (
    <Panel
      title="Deportes"
      action={
        canManage && availableDisciplines.length > 0 ? (
          <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => setAdding(true)}>
            Agregar deporte
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">No practica ningún deporte. Paga la cuota social.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {open.map((m) => {
              const canChangeCategory = (disciplineById.get(m.disciplineId)?.categories.length ?? 0) > 1
              return (
                <li
                  key={m.id}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {m.disciplineName} · {m.categoryName}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Desde <DateText date={m.joinedOn} />
                    </span>
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      {canChangeCategory ? (
                        <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => setChangingId(m.id)}>
                          Cambiar de categoría
                        </Button>
                      ) : null}
                      <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => setLeavingId(m.id)}>
                        Dar de baja de {m.categoryName}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {categoryHistory.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground select-none">Historia</summary>
            <ul className="mt-2 flex flex-col divide-y divide-border">
              {categoryHistory.map((m) => (
                <li key={m.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                  <span className="font-medium">
                    {m.disciplineName} · {m.categoryName}
                  </span>
                  <span className="text-muted-foreground">
                    Desde <DateText date={m.joinedOn} /> hasta {m.leftOn ? <DateText date={m.leftOn} /> : 'hoy'}
                  </span>
                  {m.leftReason ? <span className="block text-muted-foreground">Motivo: {m.leftReason}</span> : null}
                  {m.leftByName ? <span className="block text-xs text-muted-foreground">{m.leftByName}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {leaving ? (
        <LeaveCategoryDialog
          open={leavingId != null}
          onOpenChange={(v) => !v && setLeavingId(null)}
          membershipId={leaving.id}
          disciplineName={leaving.disciplineName}
          categoryName={leaving.categoryName}
          onDone={handleDone}
        />
      ) : null}

      {changing ? (
        <ChangeCategoryDialog
          open={changingId != null}
          onOpenChange={(v) => !v && setChangingId(null)}
          membershipId={changing.id}
          disciplineName={changing.disciplineName}
          currentCategoryName={changing.categoryName}
          otherCategories={changingOtherCategories}
          onDone={handleDone}
        />
      ) : null}

      {adding ? (
        <AddCategoryDialog
          open={adding}
          onOpenChange={setAdding}
          memberId={memberId}
          openCategoryIds={openCategoryIds}
          availableDisciplines={availableDisciplines}
          onDone={handleDone}
        />
      ) : null}
    </Panel>
  )
}
