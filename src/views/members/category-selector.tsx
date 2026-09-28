'use client'

import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { DisciplineWithCategories } from '@/models/types'

/**
 * "Deportes y categorías" (00-architecture.md §13.6): un socio puede jugar
 * varios deportes, pero A LO SUMO una categoría por disciplina — dentro de
 * cada deporte se comporta como radio con la opción "Ninguna". El valor es
 * la lista COMPLETA de `categoryId` elegidos (uno por deporte, como mucho),
 * la misma forma que espera `categoryIds` del alta y de `setMemberCategories`.
 *
 * Sin `RadioGroup` en `components/ui/`: son inputs nativos `type="radio"`
 * agrupados por `name` (un fieldset por disciplina), con el mismo patrón de
 * `Label` envolvente + `min-h-11` que `CheckboxField` (piso de calidad: 44px
 * mínimo, label real asociado, nunca solo color).
 */
export function CategorySelector({
  disciplines,
  value,
  onChange,
  disabled,
  error,
}: {
  disciplines: DisciplineWithCategories[]
  value: number[]
  onChange: (categoryIds: number[]) => void
  disabled?: boolean
  error?: string
}) {
  function handlePick(disciplineCategoryIds: number[], picked: number | null) {
    const rest = value.filter((id) => !disciplineCategoryIds.includes(id))
    onChange(picked != null ? [...rest, picked] : rest)
  }

  return (
    <div className="flex flex-col gap-5" data-invalid={Boolean(error)}>
      <p className="text-sm text-muted-foreground">
        Si no practica ningún deporte, queda como socio no practicante y paga la cuota social.
      </p>
      {disciplines.map((discipline) => {
        const categoryIds = discipline.categories.map((c) => c.id)
        const selected = value.find((id) => categoryIds.includes(id)) ?? null
        return (
          <DisciplineGroup
            key={discipline.id}
            disciplineName={discipline.name}
            categories={discipline.categories.map((c) => ({ id: c.id, name: c.name }))}
            selected={selected}
            disabled={disabled}
            onPick={(picked) => handlePick(categoryIds, picked)}
          />
        )
      })}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function DisciplineGroup({
  disciplineName,
  categories,
  selected,
  disabled,
  onPick,
}: {
  disciplineName: string
  categories: { id: number; name: string }[]
  selected: number | null
  disabled?: boolean
  onPick: (categoryId: number | null) => void
}) {
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{disciplineName}</legend>
      <RadioOption groupName={name} label="Ninguna" checked={selected === null} disabled={disabled} onSelect={() => onPick(null)} />
      {categories.map((category) => (
        <RadioOption
          key={category.id}
          groupName={name}
          label={category.name}
          checked={selected === category.id}
          disabled={disabled}
          onSelect={() => onPick(category.id)}
        />
      ))}
    </fieldset>
  )
}

function RadioOption({
  groupName,
  label,
  checked,
  disabled,
  onSelect,
}: {
  groupName: string
  label: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  const id = useId()
  return (
    <Label
      htmlFor={id}
      className={cn('min-h-11 w-fit items-center gap-2 font-normal has-disabled:opacity-50')}
    >
      <input
        id={id}
        type="radio"
        name={groupName}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect()}
        className="size-4 accent-primary"
      />
      {label}
    </Label>
  )
}
