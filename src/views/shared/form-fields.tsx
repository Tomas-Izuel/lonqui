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
            className="pr-10"
            {...field}
            value={field.value ?? ''}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2"
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
}: BaseProps<T> & { placeholder?: string; options: { value: string; label: string }[] }) {
  const { field, fieldState } = useController({ control, name })
  const { id, errorId, descriptionId } = useFieldIds<T>(name)
  const describedBy = [fieldState.error && errorId, description && descriptionId].filter(Boolean).join(' ') || undefined

  return (
    <Field data-invalid={Boolean(fieldState.error)} className={className}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={disabled}>
          <SelectTrigger id={id} aria-invalid={Boolean(fieldState.error)} aria-describedby={describedBy} className="w-full">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

  return (
    <Field orientation="horizontal" data-invalid={Boolean(fieldState.error)} className={className}>
      <Checkbox
        id={id}
        checked={Boolean(field.value)}
        onCheckedChange={(checked) => field.onChange(checked === true)}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
      />
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
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
