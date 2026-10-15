'use client'

import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { EmptyState } from '@/views/shared/states'
import { PeriodText } from '@/views/shared/date-text'
import { Amount } from '@/views/shared/money'
import { memberTypeLabels } from '@/views/shared/labels'
import { FeePriceSheet } from '@/views/settings/fee-price-sheet'
import { formatCentsCompact } from '@/lib/money'
import { formatPeriod } from '@/lib/dates'
import type { BillingStatus, DisciplineWithCategories, FeePrice, FeePriceHistoryEntry, FeePricesOverview } from '@/models/types'

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

/** Mismo destino: alcance y lo que ese alcance fija (tipo de socio o categoría). */
function sameTarget(a: FeePrice, b: FeePrice): boolean {
  if (a.scope !== b.scope) return false
  if (a.scope === 'member_type') return a.memberType === b.memberType
  if (a.scope === 'category') return a.categoryId === b.categoryId
  return true
}

type RowProps = {
  label: string
  price: FeePrice
  /** Sin `onChange` la fila no ofrece "Cambiar" (Historia). */
  onChange?: () => void
  /** Cambio ya programado para este destino, si existe. */
  scheduled?: FeePrice
  superseded?: boolean
}

function FeePriceRow({ label, price, onChange, scheduled, superseded }: RowProps) {
  return (
    <li className="flex items-center gap-2 py-1">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          desde <PeriodText period={price.validFrom} />
          {superseded ? ' · Reemplazado' : ''}
        </span>
        {scheduled ? (
          <span className="text-xs text-muted-foreground">
            Cambia a {formatCentsCompact(scheduled.amountCents)} desde {formatPeriod(scheduled.validFrom)}
          </span>
        ) : null}
      </div>
      <Amount
        cents={price.amountCents}
        className={`shrink-0 whitespace-nowrap text-sm font-semibold ${superseded ? 'text-muted-foreground' : ''}`}
      />
      {onChange ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onChange}
          aria-label={`Cambiar valor de ${label}`}
          className="h-11 shrink-0 px-3"
        >
          Cambiar
        </Button>
      ) : null}
    </li>
  )
}

export type FeePricesSectionProps = {
  feePrices: FeePricesOverview
  billing: BillingStatus
  /** Todas, incluidas inactivas: para etiquetar valores de categorías que el club ya dio de baja (nada se borra). */
  disciplines: DisciplineWithCategories[]
  /** Solo activas: lo que puede elegir "Nuevo valor" para un precio por categoría. */
  categoriesByDiscipline: DisciplineWithCategories[]
}

/**
 * Panel "Valores de cuota" (route-ajustes.md). Los valores son append-only
 * (CLAUDE.md): "Cambiar" en una fila abre el sheet que INSERTA un valor nuevo
 * (nunca edita el existente) y "Nuevo valor" abre una regla para un destino
 * sin valor propio. La historia solo se lee.
 */
export function FeePricesSection({ feePrices, billing, disciplines, categoriesByDiscipline }: FeePricesSectionProps) {
  const [newOpen, setNewOpen] = useState(false)
  const [changing, setChanging] = useState<{ price: FeePrice; label: string } | null>(null)
  const [changeOpen, setChangeOpen] = useState(false)
  const disciplineByCategory = buildDisciplineByCategory(disciplines)
  const categoryGroups = groupByDiscipline(feePrices.current.byCategory, disciplines)

  const hasDefault = feePrices.current.default !== null

  function openChange(price: FeePrice, label: string) {
    setChanging({ price, label })
    setChangeOpen(true)
  }
  /** El cambio programado más próximo para el destino de una fila vigente. */
  function scheduledFor(price: FeePrice): FeePrice | undefined {
    return feePrices.upcoming
      .filter((u) => sameTarget(u, price))
      .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0))[0]
  }

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
            <FeePriceRow
              label="Por defecto"
              price={feePrices.current.default!}
              scheduled={scheduledFor(feePrices.current.default!)}
              onChange={() => openChange(feePrices.current.default!, 'Por defecto')}
            />
          </ul>

          {feePrices.current.byMemberType.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="font-heading text-sm font-semibold">Por tipo de socio</h4>
              <ul aria-label="Valores por tipo de socio" className="flex flex-col divide-y divide-border">
                {feePrices.current.byMemberType.map((price) => {
                  const label = price.memberType ? memberTypeLabels[price.memberType] : 'Tipo de socio'
                  return (
                    <FeePriceRow
                      key={price.id}
                      label={label}
                      price={price}
                      scheduled={scheduledFor(price)}
                      onChange={() => openChange(price, label)}
                    />
                  )
                })}
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
                    {group.prices.map((price) => {
                      const label = price.categoryName ?? 'Categoría'
                      return (
                        <FeePriceRow
                          key={price.id}
                          label={label}
                          price={price}
                          scheduled={scheduledFor(price)}
                          onChange={() => openChange(price, `${group.disciplineName} · ${label}`)}
                        />
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {feePrices.upcoming.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="font-heading text-sm font-semibold">Próximos</h4>
              <ul aria-label="Valores programados" className="flex flex-col divide-y divide-border">
                {feePrices.upcoming.map((price) => {
                  const label = feePriceLabel(price, disciplineByCategory)
                  return <FeePriceRow key={price.id} label={label} price={price} onChange={() => openChange(price, label)} />
                })}
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
              {feePrices.history.map((price: FeePriceHistoryEntry) => (
                <FeePriceRow
                  key={price.id}
                  label={feePriceLabel(price, disciplineByCategory)}
                  price={price}
                  superseded={price.supersededById !== null}
                />
              ))}
            </ul>
          </details>
        </div>
      )}

      <FeePriceSheet
        mode="new"
        open={newOpen}
        onOpenChange={setNewOpen}
        billing={billing}
        history={feePrices.history}
        categoriesByDiscipline={categoriesByDiscipline}
      />
      {changing ? (
        <FeePriceSheet
          key={changing.price.id}
          mode="change"
          open={changeOpen}
          onOpenChange={setChangeOpen}
          billing={billing}
          history={feePrices.history}
          price={changing.price}
          label={changing.label}
        />
      ) : null}
    </Panel>
  )
}
