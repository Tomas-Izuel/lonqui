'use client'

import { useId, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { cn } from '@/lib/utils'

export type ChoiceOption<T extends string | number> = { value: T; label: string }

/**
 * Grupo de botones grandes de elección única (`role="radiogroup"`): concepto y
 * medio del ingreso. Un solo toque de 48px, sin abrir un menú. Navegable con
 * flechas (tabindex rotativo: solo la opción elegida entra al recorrido de
 * Tab), que es lo que un lector de pantalla espera de un radiogroup.
 */
export function ChoiceGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  columns = 2,
  disabled,
  error,
  errorId,
  autoFocus,
}: {
  label: string
  options: ChoiceOption<T>[]
  value: T | null
  onChange: (value: T) => void
  columns?: 1 | 2
  disabled?: boolean
  error?: string
  /** Id estable del mensaje de error (lo referencia el grupo con `aria-describedby`). */
  errorId: string
  /** Foco inicial en la opción que entra al recorrido de Tab (evita que Radix lo deje en el handle del sheet). */
  autoFocus?: boolean
}) {
  const labelId = useId()
  const groupRef = useRef<HTMLDivElement>(null)
  // Sin elección todavía, la primera opción es la que recibe el foco de Tab.
  const tabbableValue = value ?? options[0]?.value

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    const next = (index + (forward ? 1 : -1) + options.length) % options.length
    onChange(options[next].value)
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={cn('grid gap-2', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}
      >
        {options.map((option, index) => {
          const checked = option.value === value
          return (
            <Button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={option.value === tabbableValue ? 0 : -1}
              variant={checked ? 'default' : 'outline'}
              disabled={disabled}
              autoFocus={autoFocus && option.value === tabbableValue}
              className="h-auto min-h-12 min-w-0 px-3 py-2 text-wrap"
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {option.label}
            </Button>
          )
        })}
      </div>
      {error ? (
        <FieldError id={errorId} role="alert">
          {error}
        </FieldError>
      ) : null}
    </div>
  )
}
