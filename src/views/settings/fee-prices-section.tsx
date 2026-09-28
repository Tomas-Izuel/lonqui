'use client'

import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { PeriodText } from '@/views/shared/date-text'
import { Amount } from '@/views/shared/money'
import { memberTypeLabels } from '@/views/shared/labels'
import { NewFeePriceSheet } from '@/views/settings/new-fee-price-sheet'
import type { BillingStatus, DisciplineWithCategories, FeePrice } from '@/models/types'

/** `categoryId` → nombre de disciplina, para desambiguar categorías con el mismo nombre en dos deportes (p. ej. "Sub 18"). */
function buildDisciplineByCategory(disciplines: DisciplineWithCategories[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const discipline of disciplines) {
    for (const category of discipline.categories) map.set(category.id, discipline.name)
  }
  return map
}

/** Etiqueta genérica de un valor de cuota, sin agrupar — para "Próximos" e "Historia". */
function feePriceLabel(price: FeePrice, disciplineByCategory: Map<number, string>): string {
  if (price.scope === 'default') return 'Por defecto'
  if (price.scope === 'member_type') return price.memberType ? memberTypeLabels[price.memberType] : 'Por tipo de socio'
  const disciplineName = price.categoryId != null ? disciplineByCategory.get(price.categoryId) : undefined
  const categoryName = price.categoryName ?? 'Categoría'
  return disciplineName ? `${disciplineName} · ${categoryName}` : categoryName
}

type CategoryGroup = { disciplineName: string; prices: FeePrice[] }

/** "Por categoría, agrupadas por disciplina" (route-ajustes.md): un grupo por disciplina, en su orden de `/ajustes`. */
function groupByDiscipline(prices: FeePrice[], disciplines: DisciplineWithCategories[]): CategoryGroup[] {
  const disciplineByCategory = buildDisciplineByCategory(disciplines)
  const byName = new Map<string, FeePrice[]>()

  for (const price of prices) {
    const name = (price.categoryId != null && disciplineByCategory.get(price.categoryId)) || 'Otras categorías'
    const list = byName.get(name) ?? []
    list.push(price)
    byName.set(name, list)
  }

  const order = [...disciplines.map((d) => d.name), 'Otras categorías']
  return order.filter((name) => byName.has(name)).map((name) => ({ disciplineName: name, prices: byName.get(name)! }))
}

function FeePriceRow({ label, price }: { label: string; price: FeePrice }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          desde <PeriodText period={price.validFrom} />
        </span>
      </div>
      <Amount cents={price.amountCents} className="shrink-0 text-sm font-semibold" />
    </li>
  )
}

export type FeePricesSectionProps = {
  feePrices: {
    current: { default: FeePrice | null; byMemberType: FeePrice[]; byCategory: FeePrice[] }
    upcoming: FeePrice[]
    history: FeePrice[]
  }
  billing: BillingStatus
  /** Todas, incluidas inactivas: para etiquetar valores de categorías que el club ya dio de baja (nada se borra). */
  disciplines: DisciplineWithCategories[]
  /** Solo activas: lo que puede elegir "Nuevo valor" para un precio por categoría. */
  categoriesByDiscipline: DisciplineWithCategories[]
}

/**
 * Panel "Valores de cuota" (route-ajustes.md, F4). Los valores son
 * append-only (CLAUDE.md): esta sección solo LEE la historia — nunca hay un
 * botón "editar" en una fila, solo "Nuevo valor" que agrega otra.
 */
export function FeePricesSection({ feePrices, billing, disciplines, categoriesByDiscipline }: FeePricesSectionProps) {
  const [newOpen, setNewOpen] = useState(false)
  const disciplineByCategory = buildDisciplineByCategory(disciplines)
  const categoryGroups = groupByDiscipline(feePrices.current.byCategory, disciplines)

  const hasDefault = feePrices.current.default !== null

  return (
    <Panel
      title="Valores de cuota"
      description="El valor que se cobra cada mes. El más específico gana."
      action={
        hasDefault ? (
          <Button size="sm" onClick={() => setNewOpen(true)} className="h-11">
            <Plus aria-hidden />
            Nuevo valor
          </Button>
        ) : undefined
      }
    >
      {!hasDefault ? (
        <EmptyState
          title="Cargá un valor de cuota"
          description="Necesitás un valor por defecto antes de poder activar las cuotas. Con eso alcanza para empezar: después podés sumar valores distintos por tipo de socio o por categoría."
          action={
            <Button onClick={() => setNewOpen(true)} className="h-11">
              Cargar valor por defecto
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          <ul aria-label="Valor por defecto" className="flex flex-col divide-y divide-border">
            <FeePriceRow label="Por defecto" price={feePrices.current.default!} />
          </ul>

          {feePrices.current.byMemberType.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="font-heading text-sm font-semibold">Por tipo de socio</h4>
              <ul aria-label="Valores por tipo de socio" className="flex flex-col divide-y divide-border">
                {feePrices.current.byMemberType.map((price) => (
                  <FeePriceRow
                    key={price.id}
                    label={price.memberType ? memberTypeLabels[price.memberType] : 'Tipo de socio'}
                    price={price}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {categoryGroups.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h4 className="font-heading text-sm font-semibold">Por categoría</h4>
              {categoryGroups.map((group) => (
                <div key={group.disciplineName} className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">{group.disciplineName}</p>
                  <ul aria-label={`Valores de ${group.disciplineName}`} className="flex flex-col divide-y divide-border">
                    {group.prices.map((price) => (
                      <FeePriceRow key={price.id} label={price.categoryName ?? 'Categoría'} price={price} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {feePrices.upcoming.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="font-heading text-sm font-semibold">Próximos</h4>
              <ul aria-label="Valores programados" className="flex flex-col divide-y divide-border">
                {feePrices.upcoming.map((price) => (
                  <FeePriceRow key={price.id} label={feePriceLabel(price, disciplineByCategory)} price={price} />
                ))}
              </ul>
            </div>
          ) : null}

          <details className="group rounded-lg border border-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span>Historia ({feePrices.history.length})</span>
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <ul aria-label="Historia de valores de cuota" className="flex flex-col divide-y divide-border border-t border-border px-3">
              {feePrices.history.map((price) => (
                <FeePriceRow key={price.id} label={feePriceLabel(price, disciplineByCategory)} price={price} />
              ))}
            </ul>
          </details>
        </div>
      )}

      <NewFeePriceSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        billing={billing}
        categoriesByDiscipline={categoriesByDiscipline}
      />
    </Panel>
  )
}
