'use client'

import { useWatch, type Control, type FieldValues, type Path } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { AmountField } from '@/views/shared/form-fields'
import { addMonths } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import { MonthStrip } from '@/views/payments/month-strip'
import {
  closePreSystem,
  isBeforeStart,
  coverageForAmount,
  optionsForSelection,
  defaultSelection,
  derivedAmountCents,
  extendToDueMonths,
  openingBalanceFromSelection,
  selectionSummary,
  summaryText,
  tapCell,
  type Selection,
} from '@/views/payments/month-selection'
import type { ISODate, MemberStatus, OpeningBalanceMonths, PaymentMonthOption } from '@/models/types'

/**
 * Estado de la entrada por meses de UN socio. Lo guarda el formulario (uno en
 * el pago individual, uno por integrante en el de grupo) y `MonthEntry` solo
 * lo dibuja: así el formulario puede leerlo al enviar.
 */
export type EntryState = {
  selection: Selection
  preOpen: boolean
  overrideCents: number | null
  /** El total del saldo anterior tiene algo que no se puede leer: el envío se frena hasta corregirlo. */
  overrideInvalid: boolean
  /** true = "Otro monto": el monto lo tipea la persona y la tira muestra qué cubre. */
  custom: boolean
}

export function initialEntry(options: PaymentMonthOption[], status: MemberStatus): EntryState {
  const selection = defaultSelection(options, status)
  // Antes del inicio los meses previos no se pliegan: son lo que hay que cobrar.
  return { selection, preOpen: isBeforeStart(options), overrideCents: null, overrideInvalid: false, custom: selection === null }
}

export function creditOf(balanceCents: number): number {
  return Math.max(0, -balanceCents)
}

export function entryDerivedCents(options: PaymentMonthOption[], entry: EntryState, creditCents: number): number {
  return derivedAmountCents(options, entry.selection, { openingBalanceOverrideCents: entry.overrideCents, creditCents })
}

/** Opciones tal como quedan al crear el saldo anterior elegido (ver `effectiveOptions`); las de la RPC si no hay. */
export function entryEffectiveOptions(options: PaymentMonthOption[], entry: EntryState, creditCents: number): PaymentMonthOption[] {
  return optionsForSelection(options, entry.selection, { openingBalanceOverrideCents: entry.overrideCents, creditCents })
}

export function entryOpeningBalance(options: PaymentMonthOption[], entry: EntryState): OpeningBalanceMonths | null {
  return openingBalanceFromSelection(options, entry.selection, entry.overrideCents)
}

type Props<T extends FieldValues> = {
  options: PaymentMonthOption[]
  entry: EntryState
  onEntryChange: (next: EntryState) => void
  /** Campo de monto del formulario: en modo meses lo escribe el derivado; en "Otro monto", la persona. */
  control: Control<T>
  amountName: Path<T>
  onAmountChange: (cents: number | null) => void
  creditCents: number
  error?: string
  variant?: 'default' | 'compact'
  disabled?: boolean
  /** Etiqueta accesible del campo de "Otro monto" (en grupo lleva el nombre del integrante). */
  amountLabel?: string
  /** false = el monto y el resumen viven en el pie fijo del formulario (pago individual). */
  showTotal?: boolean
  /** Primer mes de la facturación (`billing.startPeriod`). Sin él se deriva de la última celda previa (solo vale si el inicio es el mes siguiente). */
  startPeriod?: ISODate | null
  /** El formulario ya muestra la línea "Las cuotas arrancan en…" una vez (pago de grupo). */
  hideBeforeStartNote?: boolean
}

/**
 * Tira + resumen + "Otro monto" de un socio. Con `options` vacío nunca se
 * monta (el formulario cae al campo de monto de siempre).
 */
export function MonthEntry<T extends FieldValues>({
  options,
  entry,
  onEntryChange,
  control,
  amountName,
  onAmountChange,
  creditCents,
  error,
  variant = 'default',
  disabled,
  amountLabel = 'Otro monto',
  showTotal = true,
  startPeriod,
  hideBeforeStartNote = false,
}: Props<T>) {
  const compact = variant === 'compact'
  const typed = useWatch({ control, name: amountName }) as number | null | undefined
  const ctx = { openingBalanceOverrideCents: entry.overrideCents, creditCents }
  const derived = derivedAmountCents(options, entry.selection, ctx)
  const beforeStart = isBeforeStart(options)
  const hasPreSystem = options.some((o) => o.kind === 'pre_system')
  // El mes de inicio de la facturación es el siguiente al último "antes del sistema".
  const lastPre = [...options].reverse().find((o) => o.kind === 'pre_system')

  function update(next: EntryState) {
    onEntryChange(next)
    if (!next.custom) onAmountChange(derivedAmountCents(options, next.selection, { openingBalanceOverrideCents: next.overrideCents, creditCents }))
  }

  const coverage = entry.custom ? coverageForAmount(options, entry.selection, typed ?? 0, ctx) : null
  const effective = optionsForSelection(options, entry.selection, ctx)
  const summary = selectionSummary(effective, entry.selection)

  return (
    <div className="flex flex-col gap-3">
      <MonthStrip
        options={effective}
        selection={entry.selection}
        variant={variant}
        disabled={disabled}
        coverage={coverage}
        onTap={(index) => {
          const isPre = options[index]?.kind === 'pre_system'
          let selection = tapCell(effective, entry.selection, index, { preSystemOpen: entry.preOpen })
          if (isPre) selection = extendToDueMonths(options, selection, { creditCents })
          // El total corregido es del saldo anterior: si la selección ya no lo incluye, se descarta.
          const keepsPre = !isPre && selection !== null && options[selection.startIndex]?.kind === 'pre_system'
          update({ ...entry, selection, custom: false, overrideCents: keepsPre ? entry.overrideCents : null, overrideInvalid: keepsPre ? entry.overrideInvalid : false })
        }}
        preSystem={
          hasPreSystem && lastPre
            ? {
                open: entry.preOpen,
                startPeriod: startPeriod ?? addMonths(lastPre.period, 1),
                hideBeforeStartNote,
                overrideCents: entry.overrideCents,
                // Siempre por `onChange`: total y validez en un solo cambio de estado.
                onOverrideChange: () => {},
                onChange: (cents, valid) => update({ ...entry, overrideCents: cents, overrideInvalid: !valid }),
                beforeStart,
                onToggle: beforeStart ? undefined : () => {
                  if (entry.preOpen) update({ ...entry, preOpen: false, overrideCents: null, overrideInvalid: false, selection: closePreSystem(options, entry.selection) })
                  else update({ ...entry, preOpen: true })
                },
              }
            : null
        }
      />

      {entry.custom ? (
        <div className="flex flex-col gap-2">
          <AmountField control={control} name={amountName} label={amountLabel} disabled={disabled} autoFocus={!compact} />
          {coverage && coverage.leftoverCents > 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              Queda saldo a favor de <span className="font-medium text-foreground tabular-nums">{formatCentsCompact(coverage.leftoverCents)}</span>.
            </p>
          ) : null}
          {entry.selection !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 w-fit"
              disabled={disabled}
              onClick={() => update({ ...entry, custom: false })}
            >
              Volver a elegir por meses
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-end justify-between gap-3">
          {showTotal ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              {summary.rangeLabel ? <p className="text-sm text-muted-foreground first-letter:uppercase">{summaryText(summary)}</p> : null}
              <p className={compact ? 'text-base font-semibold tabular-nums' : 'text-2xl font-semibold tabular-nums'}>{formatCentsCompact(derived)}</p>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0"
            disabled={disabled}
            onClick={() => {
              onEntryChange({ ...entry, custom: true })
            }}
          >
            Otro monto
          </Button>
        </div>
      )}

      {!entry.custom && derived === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {openingBalanceFromSelection(options, entry.selection)
            ? 'El saldo a favor ya cubre esos meses. Indicá desde cuándo debía desde la ficha.'
            : 'Marcá al menos un mes.'}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
