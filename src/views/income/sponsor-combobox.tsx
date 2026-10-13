'use client'

import { useId, useMemo, useState, useSyncExternalStore } from 'react'
import { ChevronDown, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { createSponsor } from '@/controllers/sponsors.actions'
import { cn } from '@/lib/utils'
import type { SponsorOption } from '@/models/types'

const NO_SPONSOR = '__none__'
const DESKTOP_QUERY = '(min-width: 768px)'

/** Mismo breakpoint y patrón que `ResponsiveSheet` / `FamilyGroupCombobox` (esa función no se exporta). */
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

/** Sin tildes ni mayúsculas: "Panaderia" tiene que encontrar "Panadería". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Buscador de sponsor del catálogo con alta en línea: "+ Agregar sponsor"
 * pide solo el nombre (el resto se completa después desde la ficha del
 * sponsor) y deja el sponsor creado ya elegido, para no cortar la carga del
 * ingreso. Desktop: `Popover` anclado; móvil: hoja desde abajo (un buscador
 * con teclado abierto no entra en un popover angosto).
 *
 * El alta NO usa un `<form>` propio: este combobox vive adentro del
 * formulario del ingreso, y el `submit` de un form anidado (aunque esté en un
 * portal) burbujea por React hasta el formulario de arriba.
 */
export function SponsorCombobox({
  value,
  onChange,
  options,
  onCreated,
  required,
  error,
  errorId,
  disabled,
}: {
  value: number | null
  onChange: (sponsorId: number | null) => void
  options: SponsorOption[]
  /** El padre suma el sponsor recién creado a su lista de opciones. */
  onCreated: (sponsor: SponsorOption) => void
  required: boolean
  error?: string
  errorId: string
  disabled?: boolean
}) {
  const reactId = useId()
  const id = `sponsor-${reactId}`
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value])

  function handleOpenChange(next: boolean) {
    if (creating) return
    setOpen(next)
    if (!next) {
      setSearch('')
      setMode('search')
      setCreateError(null)
    }
  }

  function handleSelect(itemValue: string) {
    onChange(itemValue === NO_SPONSOR ? null : Number(itemValue))
    handleOpenChange(false)
  }

  function startCreate() {
    setNewName(search.trim())
    setCreateError(null)
    setMode('create')
  }

  async function handleCreate() {
    const name = newName.trim()
    if (name.length < 2) {
      setCreateError('El nombre tiene que tener al menos 2 caracteres')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createSponsor({ name })
      if (!result.ok) {
        setCreateError(result.error)
        return
      }
      onCreated({ id: result.data.id, name: result.data.name, isActive: true })
      onChange(result.data.id)
      setCreating(false)
      handleOpenChange(false)
    } catch {
      setCreateError('No pudimos agregar el sponsor. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setCreating(false)
    }
  }

  function renderBody(listClassName?: string) {
    if (mode === 'create') {
      const createErrorId = `${id}-create-error`
      return (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-new-name`} className="text-sm font-medium">
              Nombre del sponsor
            </label>
            <Input
              id={`${id}-new-name`}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreate()
                }
              }}
              autoComplete="off"
              autoFocus
              disabled={creating}
              aria-invalid={Boolean(createError)}
              aria-describedby={createError ? createErrorId : undefined}
            />
            <p className="text-xs text-muted-foreground">Después podés cargar el contacto desde la ficha del sponsor.</p>
            {createError ? (
              <p id={createErrorId} role="alert" className="text-sm text-destructive">
                {createError}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="h-11" disabled={creating} onClick={() => setMode('search')}>
              Volver
            </Button>
            <Button type="button" className="h-11" disabled={creating} onClick={() => void handleCreate()}>
              {creating ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {creating ? 'Agregando…' : 'Agregar sponsor'}
            </Button>
          </div>
        </div>
      )
    }

    return (
      <Command
        // Mismo filtro sin tildes que el combobox de grupo familiar. `itemValue`
        // es el id (o el sentinel), no la etiqueta: se busca la opción primero.
        filter={(itemValue, query) => {
          const option = options.find((o) => String(o.id) === itemValue)
          if (!option) return 0
          return normalize(option.name).includes(normalize(query)) ? 1 : 0
        }}
      >
        <CommandInput placeholder="Buscar sponsor…" value={search} onValueChange={setSearch} />
        <CommandList className={listClassName}>
          <CommandEmpty>
            {options.length === 0 ? 'Todavía no hay sponsors cargados.' : 'No hay sponsors con ese nombre.'}
          </CommandEmpty>
          <CommandGroup>
            {required ? null : (
              <CommandItem value={NO_SPONSOR} data-checked={value === null} onSelect={handleSelect}>
                Sin sponsor
              </CommandItem>
            )}
            {options.map((option) => (
              <CommandItem key={option.id} value={String(option.id)} data-checked={option.id === value} onSelect={handleSelect}>
                {option.name}
              </CommandItem>
            ))}
          </CommandGroup>
          {/* `forceMount`: queda siempre al final, sin importar lo buscado. */}
          <CommandGroup forceMount>
            <CommandItem value="__create__" forceMount onSelect={startCreate}>
              <Plus aria-hidden />
              {search.trim() ? `Agregar sponsor “${search.trim()}”` : 'Agregar sponsor'}
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
      aria-invalid={Boolean(error)}
      aria-describedby={error ? errorId : undefined}
      disabled={disabled}
      className="h-12 w-full min-w-0 justify-between font-normal"
    >
      <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
        {selected?.name ?? 'Elegí un sponsor'}
      </span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Button>
  )

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{required ? 'Sponsor' : 'Sponsor (opcional)'}</FieldLabel>
        {isDesktop ? (
          <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent data-slot="combobox-content" align="start" className="w-(--radix-popover-trigger-width) p-0">
              {renderBody()}
            </PopoverContent>
          </Popover>
        ) : (
          <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetTrigger asChild>{trigger}</SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-xl p-0">
              <div className="flex items-center border-b border-border py-3 pr-10 pl-4">
                <SheetTitle className="text-base font-medium">{mode === 'create' ? 'Nuevo sponsor' : 'Sponsor'}</SheetTitle>
              </div>
              {renderBody('max-h-[50vh]')}
            </SheetContent>
          </Sheet>
        )}
        {required && !error ? <FieldDescription>Este concepto pide indicar de qué sponsor es.</FieldDescription> : null}
        {error ? (
          <FieldError id={errorId} role="alert">
            {error}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}
