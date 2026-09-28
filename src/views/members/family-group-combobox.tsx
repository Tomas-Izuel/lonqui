'use client'

import { useId, useMemo, useState, useSyncExternalStore } from 'react'
import { useController, type Control, type FieldValues, type Path } from 'react-hook-form'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldError, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import type { FamilyGroupSummary } from '@/models/types'

/** Sentinelas de `familyGroupChoice` (Revisión 3, `member-form.tsx`): viven acá porque este componente arma la lista completa. */
export const NO_GROUP = '__none__'
export const NEW_GROUP = '__new__'

const DESKTOP_QUERY = '(min-width: 768px)'

/**
 * Mismo breakpoint y mismo patrón (`useSyncExternalStore` sobre `matchMedia`)
 * que `useIsDesktop` de `ResponsiveSheet` (`views/shared/**`, sin tocar): esa
 * función no está exportada — repetirla acá (8 líneas) es más barato que
 * pedir un export nuevo de un archivo compartido para un solo consumidor.
 */
function subscribeToDesktopQuery(callback: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}
function getIsDesktopSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches
}
function getIsDesktopServerSnapshot() {
  return false
}
function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeToDesktopQuery, getIsDesktopSnapshot, getIsDesktopServerSnapshot)
}

/** Sin tildes ni mayúsculas: "Perez" tiene que encontrar "Pérez". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

type ComboboxOption = { value: string; label: string }

/**
 * Buscador de grupo familiar (pedido de Tomás, pipeline 2026-09-28-ui-expresiva):
 * antes de esto era un `<select>` nativo (`SelectField`) — con la carga
 * inicial de ~200 socios (seed de demo) y sus grupos, encontrar el correcto
 * desplazándose a mano dejó de alcanzar. Mismas opciones especiales de
 * siempre, ahora buscables: "Sin grupo" (`NO_GROUP`), cada grupo real y
 * "Crear un grupo nuevo" (`NEW_GROUP`, que revela los campos de alta en
 * `member-form.tsx` — sin cambios ahí).
 *
 * Desktop (`md+`): `Popover` anclado al trigger, con `CommandInput` con foco
 * automático — igual que cualquier combobox de escritorio. Mobile (`< md`):
 * `Sheet` desde abajo con el mismo `Command` adentro — un buscador con
 * teclado abierto no entra en un popover angosto flotando sobre el dedo que
 * lo tocó, así que ahí gana la hoja de pantalla completa. Nunca `ResponsiveSheet`:
 * ese primitivo da `Dialog` centrado en escritorio, no un `Popover` anclado
 * al campo, que es lo que un combobox necesita ahí.
 */
export function FamilyGroupCombobox<T extends FieldValues>({
  control,
  name,
  familyGroups,
  disabled,
  className,
}: {
  control: Control<T>
  name: Path<T>
  familyGroups: FamilyGroupSummary[]
  disabled?: boolean
  className?: string
}) {
  const { field, fieldState } = useController({ control, name })
  const reactId = useId()
  const id = `${String(name).replaceAll('.', '-')}-${reactId}`
  const errorId = `${id}-error`
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(false)

  const options: ComboboxOption[] = useMemo(
    () => [{ value: NO_GROUP, label: 'Sin grupo' }, ...familyGroups.map((g) => ({ value: String(g.id), label: g.label }))],
    [familyGroups],
  )
  const selected =
    field.value === NEW_GROUP ? { value: NEW_GROUP, label: 'Crear un grupo nuevo' } : options.find((o) => o.value === field.value)

  function handleSelect(value: string) {
    field.onChange(value)
    setOpen(false)
  }

  /** `listClassName` acota el alto de `CommandList`: más bajo en el popover angosto, más alto en la hoja de pantalla completa. */
  function renderList(listClassName?: string) {
    return (
      <Command
        // Filtro propio con NFD en vez del default de `cmdk` (que no saca
        // tildes): "Perez" tiene que encontrar "Pérez". `itemValue` es el
        // `value` que le puso cada `CommandItem` (el sentinel o el id), no la
        // etiqueta — por eso se busca la opción primero.
        filter={(itemValue, search) => {
          const option = options.find((o) => o.value === itemValue)
          if (!option) return 0
          return normalize(option.label).includes(normalize(search)) ? 1 : 0
        }}
      >
        <CommandInput placeholder="Buscar grupo…" autoFocus />
        <CommandList className={listClassName}>
          <CommandEmpty>No hay grupos con ese nombre.</CommandEmpty>
          <CommandGroup>
            {options.map((option) => (
              <CommandItem key={option.value} value={option.value} data-checked={option.value === field.value} onSelect={handleSelect}>
                {option.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {/* Grupo propio con `forceMount`: "Crear un grupo nuevo" queda
              siempre visible al final, sin importar el texto buscado — cmdk
              lo saca del conteo que decide si se muestra `CommandEmpty`, así
              que "no hay grupos con ese nombre" y esta opción conviven. */}
          <CommandGroup forceMount>
            <CommandItem value={NEW_GROUP} forceMount data-checked={field.value === NEW_GROUP} onSelect={handleSelect}>
              Crear un grupo nuevo
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
  }

  const trigger = (
    <Button
      type="button"
      variant="outline"
      id={id}
      role="combobox"
      aria-expanded={open}
      aria-invalid={Boolean(fieldState.error)}
      aria-describedby={fieldState.error ? errorId : undefined}
      disabled={disabled}
      className="h-11 w-full min-w-0 justify-between font-normal"
    >
      <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>{selected?.label ?? 'Elegí una opción'}</span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Button>
  )

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>Grupo familiar</FieldLabel>
        {isDesktop ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent data-slot="combobox-content" align="start" className="w-(--radix-popover-trigger-width) p-0">
              {renderList()}
            </PopoverContent>
          </Popover>
        ) : (
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>{trigger}</SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-xl p-0">
              <div className="flex items-center border-b border-border py-3 pr-10 pl-4">
                <SheetTitle className="text-base font-medium">Grupo familiar</SheetTitle>
              </div>
              {renderList('max-h-[50vh]')}
            </SheetContent>
          </Sheet>
        )}
        {fieldState.error ? (
          <FieldError id={errorId} role="alert">
            {fieldState.error.message}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}
