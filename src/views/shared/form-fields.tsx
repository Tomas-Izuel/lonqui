'use client'

/**
 * Adaptadores de `react-hook-form` sobre `Field`/`Input`/`Select`/`Textarea`
 * de shadcn. Todos: error inline (de Zod o de `DomainError.field`, que el
 * formulario setea con `form.setError(field, { message })`), `aria-invalid`
 * + `aria-describedby` apuntando al mensaje, label real asociado por `id`.
 *
 * Reciben `control` y `name` de RHF en vez de leer un context propio: es más
 * explícito en un formulario chico (login, alta de socio) y no obliga a
 * envolver todo en un `<FormProvider>` que F2/F3/F4 no necesitan.
 */

import { useId, useState } from 'react'
import { useController, type Control, type FieldValues, type Path } from 'react-hook-form'
import { Eye, EyeOff } from 'lucide-react'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { parsePesosToCents } from '@/lib/money'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

type BaseProps<T extends FieldValues> = {
  control: Control<T>
  name: Path<T>
  label: string
  description?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

function useFieldIds<T extends FieldValues>(name: Path<T>) {
  const reactId = useId()
  const id = `${name.replaceAll('.', '-')}-${reactId}`
  return { id, errorId: `${id}-error`, descriptionId: `${id}-description` }
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  autoFocus,
  className,
  type = 'text',
  autoComplete,
  inputMode,
  placeholder,
  spellCheck,
}: BaseProps<T> & {
  type?: string
  autoComplete?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  placeholder?: string
  spellCheck?: boolean
}) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  const describedBy = [fieldState.error && errorId, description && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          placeholder={placeholder}
          spellCheck={spellCheck}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={Boolean(fieldState.error)}
          aria-describedby={describedBy}
          {...field}
          value={field.value ?? ''}
        />
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        {fieldState.error ? (
          <FieldError id={errorId} role="alert">
            {fieldState.error.message}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}

/** Contraseña con mostrar/ocultar. La política se dice ANTES de fallar (`description`). */
export function PasswordField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  autoFocus,
  className,
  autoComplete,
}: BaseProps<T> & { autoComplete?: string }) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  const [visible, setVisible] = useState(false)
  const describedBy = [fieldState.error && errorId, description && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="relative">
          <Input
            id={id}
            type={visible ? 'text' : 'password'}
            autoComplete={autoComplete}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-invalid={Boolean(fieldState.error)}
            aria-describedby={describedBy}
            className="pr-12"
            {...field}
            value={field.value ?? ''}
          />
          {/* `size-11` (44px, piso de calidad): `icon-sm` (28px) quedaba
              chico para un pulgar; el input ya mide 44px de alto, así que el
              botón entra exacto ahí, pegado al borde. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="absolute top-1/2 right-0 size-11 -translate-y-1/2"
            onClick={() => setVisible((v) => !v)}
            tabIndex={-1}
          >
            {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            <span className="sr-only">{visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}</span>
          </Button>
        </div>
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        {fieldState.error ? (
          <FieldError id={errorId} role="alert">
            {fieldState.error.message}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  autoFocus,
  className,
  placeholder,
  rows = 3,
}: BaseProps<T> & { placeholder?: string; rows?: number }) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  const describedBy = [fieldState.error && errorId, description && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Textarea
          id={id}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={Boolean(fieldState.error)}
          aria-describedby={describedBy}
          {...field}
          value={field.value ?? ''}
        />
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        {fieldState.error ? (
          <FieldError id={errorId} role="alert">
            {fieldState.error.message}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  placeholder = 'Elegí una opción',
  options,
}: BaseProps<T> & { placeholder?: string; options: { value: string; label: string; description?: string }[] }) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  // La descripción de la opción elegida gana a la estática del campo (ej. el
  // rol seleccionado en "Nuevo usuario"): sigue siendo el mismo texto de
  // ayuda debajo del campo, nunca duplicado dentro del trigger (evita el
  // desborde que reportó Tomás en el diálogo de usuarios).
  const selectedDescription = options.find((o) => o.value === field.value)?.description
  const effectiveDescription = selectedDescription ?? description
  const describedBy =
    [fieldState.error && errorId, effectiveDescription && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={disabled}>
          <SelectTrigger id={id} aria-invalid={Boolean(fieldState.error)} aria-describedby={describedBy} className="w-full min-w-0">
            <SelectValue placeholder={placeholder} className="min-w-0 truncate" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} description={option.description}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {effectiveDescription ? <FieldDescription id={descriptionId}>{effectiveDescription}</FieldDescription> : null}
        {fieldState.error ? (
          <FieldError id={errorId} role="alert">
            {fieldState.error.message}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}

export function CheckboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
}: BaseProps<T>) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)

  // `Label` nativo (no `FieldLabel`) envolviendo el checkbox y el texto: el
  // `<label>` cubre toda la fila —target de 44px vía `min-h-11`—, sin la
  // tarjeta con borde/radio que trae `FieldLabel` (pensada para un checkbox
  // "de tarjeta seleccionable", no para uno simple — regresión reportada en
  // el segundo pase de la finish review: para un voluntario, esa caja
  // parecía un campo de texto y el checkbox de 16px casi no se veía). Acá el
  // checkbox queda a su tamaño normal, sin borde ni fondo propios de la fila.
  return (
    <div className={cn('flex flex-col gap-1', className)} data-invalid={Boolean(fieldState.error)}>
      <Label htmlFor={id} className="min-h-11 w-fit items-center gap-2 font-normal has-disabled:opacity-50">
        <Checkbox
          id={id}
          checked={Boolean(field.value)}
          onCheckedChange={(checked) => field.onChange(checked === true)}
          disabled={disabled}
          aria-describedby={description ? descriptionId : undefined}
        />
        {label}
      </Label>
      {description ? <FieldDescription id={descriptionId} className="pl-6">{description}</FieldDescription> : null}
      {fieldState.error ? (
        <FieldError id={errorId} role="alert" className="pl-6">
          {fieldState.error.message}
        </FieldError>
      ) : null}
    </div>
  )
}

/** Fecha con teclado numérico en móvil: `type="date"` nativo ya lo hace. */
export function DateField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  max,
  min,
}: BaseProps<T> & { max?: string; min?: string }) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  const describedBy = [fieldState.error && errorId, description && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          type="date"
          max={max}
          min={min}
          disabled={disabled}
          aria-invalid={Boolean(fieldState.error)}
          aria-describedby={describedBy}
          className="tabular-nums"
          {...field}
          value={field.value ?? ''}
        />
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        {fieldState.error ? (
          <FieldError id={errorId} role="alert">
            {fieldState.error.message}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}

/** Teléfono: `type="tel"`, teclado numérico, sin formateo forzado (los hay fijos y celulares). */
export function PhoneField<T extends FieldValues>({ control, name, label, description, disabled, className }: BaseProps<T>) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  const describedBy = [fieldState.error && errorId, description && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="291 4123456"
          disabled={disabled}
          aria-invalid={Boolean(fieldState.error)}
          aria-describedby={describedBy}
          {...field}
          value={field.value ?? ''}
        />
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        {fieldState.error ? (
          <FieldError id={errorId} role="alert">
            {fieldState.error.message}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}

/** DNI: numérico, tabular, sin puntos (se muestran al formatear para lectura, no al tipear). */
export function DniField<T extends FieldValues>({
  control,
  name,
  label = 'DNI',
  description,
  disabled,
  className,
}: Omit<BaseProps<T>, 'label'> & { label?: string }) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  const describedBy = [fieldState.error && errorId, description && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          placeholder="12345678"
          disabled={disabled}
          aria-invalid={Boolean(fieldState.error)}
          aria-describedby={describedBy}
          className="tabular-nums"
          {...field}
          value={field.value ?? ''}
          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
        />
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        {fieldState.error ? (
          <FieldError id={errorId} role="alert">
            {fieldState.error.message}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}

/**
 * Monto en pesos. La persona tipea pesos con formato argentino ("10.000",
 * "10.000,50"); el formulario guarda CENTAVOS enteros (`number | null`), que
 * es lo único que viaja al servidor. `null` = vacío o inválido: el schema Zod
 * del formulario es quien decide si es obligatorio.
 *
 * Si el valor cambia desde afuera (los chips "1/2/3 meses", "Toda la deuda"),
 * el texto se reescribe con el formato argentino.
 */
export function AmountField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  autoFocus,
  className,
}: BaseProps<T>) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  const [text, setText] = useState(() => formatPesosInput(field.value as number | null | undefined))
  const [invalid, setInvalid] = useState(false)
  const [lastValue, setLastValue] = useState<unknown>(field.value)

  // Sincronía desde afuera sin efecto: si el valor del formulario cambió y no
  // coincide con lo que el texto representa, el texto se reescribe.
  if (field.value !== lastValue) {
    setLastValue(field.value)
    if (field.value !== parsePesosToCents(text)) {
      setText(formatPesosInput(field.value as number | null | undefined))
      setInvalid(false)
    }
  }

  const error = fieldState.error?.message ?? (invalid ? 'Ingresá un monto válido' : undefined)
  const describedBy = [error && errorId, description && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
            $
          </span>
          <Input
            {...field}
            id={id}
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            autoFocus={autoFocus}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className="pl-7 tabular-nums"
            value={text}
            onChange={(event) => {
              const next = event.target.value
              setText(next)
              const cents = next.trim() === '' ? null : parsePesosToCents(next)
              setInvalid(next.trim() !== '' && cents === null)
              setLastValue(cents)
              field.onChange(cents)
            }}
          />
        </div>
        {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
        {error ? (
          <FieldError id={errorId} role="alert">
            {error}
          </FieldError>
        ) : null}
      </FieldContent>
    </Field>
  )
}

/** Centavos → "10.000" / "10.000,50" para el input (sin signo: el "$" es un adorno). */
function formatPesosInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return ''
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
