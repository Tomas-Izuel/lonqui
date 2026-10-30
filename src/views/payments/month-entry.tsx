'use client'

import { useId, useRef } from 'react'
import { useWatch, type Control, type FieldValues, type Path } from 'react-hook-form'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AmountField } from '@/views/shared/form-fields'
import { addMonths } from '@/lib/dates'
import { formatCentsCompact } from '@/lib/money'
import { MonthStrip } from '@/views/payments/month-strip'
import {
  beforeJoinedWarning,
  coverageForAmount,
  debtAfterPayment,
  defaultSelection,
  derivedAmountCents,
  effectiveOptions,
  firstJoinedIndex,
  isBeforeStart,
  isSelectable,
  markedPeriodsFromSelection,
  openingMonthsFromSelection,
  openingScope,
  openingSpan,
  paintRange,
  selectionSummary,
  summaryText,
  toggleCell,
  unmarkPreSystem,
  type Selection,
} from '@/views/payments/month-selection'
import type { ISODate, MemberStatus, OpeningMonth, PaymentMonthOption } from '@/models/types'

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
  /** La grilla está abierta. Cerrada, queda el resumen de lo marcado y "Cambiar". */
  expanded: boolean
}

export function initialEntry(options: PaymentMonthOption[], status: MemberStatus, opts: { expanded: boolean }): EntryState {
  const selection = defaultSelection(options, status)
  return {
    selection,
    // Antes del inicio los meses previos no se pliegan: son lo que hay que cobrar.
    preOpen: isBeforeStart(options),
    overrideCents: null,
    overrideInvalid: false,
    // Sin ningún mes elegible la grilla no sirve: queda el monto.
    custom: !options.some(isSelectable),
    // Sin nada marcado por defecto hay que elegir: la grilla abre sola.
    expanded: opts.expanded || selection.length === 0,
  }
}

export function creditOf(balanceCents: number): number {
  return Math.max(0, -balanceCents)
}

export function entryDerivedCents(options: PaymentMonthOption[], entry: EntryState, creditCents: number): number {
  return derivedAmountCents(options, entry.selection, { openingBalanceOverrideCents: entry.overrideCents, creditCents })
}

/** Opciones tal como quedan al crear el saldo anterior elegido (ver `effectiveOptions`); las de la RPC si no hay. */
export function entryEffectiveOptions(options: PaymentMonthOption[], entry: EntryState, creditCents: number): PaymentMonthOption[] {
  return effectiveOptions(options, entry.selection, { openingBalanceOverrideCents: entry.overrideCents, creditCents })
}

/**
 * Lo que sigue adeudado tras este pago. En "Otro monto" depende de lo que se
 * tipee (`typedCents`): marcados primero, el resto al más viejo (regla de la base).
 */
export function entryDebtAfter(
  options: PaymentMonthOption[],
  entry: EntryState,
  creditCents: number,
  typedCents?: number | null,
): { months: number; cents: number } {
  const ctx = { openingBalanceOverrideCents: entry.overrideCents, creditCents }
  return debtAfterPayment(options, entry.selection, ctx, entry.custom ? (typedCents ?? 0) : undefined)
}

/** "Queda debiendo 4 meses · $40.000". */
export function debtLine(debt: { months: number; cents: number }): string {
  return `Queda debiendo ${debt.months === 1 ? '1 mes' : `${debt.months} meses`} · ${formatCentsCompact(debt.cents)}`
}

/** Los meses de saldo anterior que hay que crear con este pago (incluye los no marcados del tramo). `null` si no hay. */
export function entryOpeningMonths(options: PaymentMonthOption[], entry: EntryState): OpeningMonth[] | null {
  const months = openingMonthsFromSelection(options, entry.selection, entry.overrideCents)
  return months.length > 0 ? months : null
}

/** Los meses que el operador marcó y llevan cuota: la base los imputa primero. `null` si no hay. */
export function entryMarkedPeriods(options: PaymentMonthOption[], entry: EntryState): ISODate[] | null {
  const periods = markedPeriodsFromSelection(options, entry.selection)
  return periods.length > 0 ? periods : null
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
  /** Para el link "Corregir fecha de alta" del aviso de meses anteriores al alta. */
  memberId?: number
  /** Etiqueta accesible del campo de "Otro monto" (en grupo lleva el nombre del integrante). */
  amountLabel?: string
  /** false = el monto y el resumen viven en el pie fijo del formulario (pago individual). */
  showTotal?: boolean
  /** Primer mes de la facturación (`billing.startPeriod`). Sin él se deriva de la última celda previa (solo vale si el inicio es el mes siguiente). */
  startPeriod?: ISODate | null
  /** El formulario ya muestra la línea "Las cuotas arrancan en…" una vez (pago de grupo). */
  hideBeforeStartNote?: boolean
  /** false = la línea "Queda debiendo…" la dibuja el formulario en su pie fijo (pago individual). */
  showDebtLine?: boolean
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
  memberId,
  amountLabel = 'Otro monto',
  showTotal = true,
  startPeriod,
  hideBeforeStartNote = false,
  showDebtLine = true,
}: Props<T>) {
  const gridId = useId()
  const compact = variant === 'compact'
  const typed = useWatch({ control, name: amountName }) as number | null | undefined
  const ctx = { openingBalanceOverrideCents: entry.overrideCents, creditCents }
  const derived = derivedAmountCents(options, entry.selection, ctx)
  const beforeStart = isBeforeStart(options)
  const hasPreSystem = options.some((o) => o.kind === 'pre_system')
  // El mes de inicio de la facturación es el siguiente al último "antes del sistema".
  const lastPre = [...options].reverse().find((o) => o.kind === 'pre_system')
  // Selección que había al armarse el arrastre: `paintRange` pinta siempre sobre esta, no sobre la que va saliendo.
  const dragBaseRef = useRef<Selection>([])
  const paintOpts = { preSystemOpen: entry.preOpen, ctx }

  function update(next: EntryState) {
    onEntryChange(next)
    if (!next.custom) onAmountChange(derivedAmountCents(options, next.selection, { openingBalanceOverrideCents: next.overrideCents, creditCents }))
  }

  function pick(selection: Selection) {
    // El total corregido es de la deuda desde F: solo vale mientras F no cambie.
    const before = openingSpan(options, entry.selection)
    const after = openingSpan(options, selection)
    const keeps = before !== null && after !== null && before.from === after.from
    // En "Otro monto" marcar meses sigue siendo "Otro monto": la base aplica primero a los marcados.
    update({
      ...entry,
      selection,
      overrideCents: keeps ? entry.overrideCents : null,
      overrideInvalid: keeps ? entry.overrideInvalid : false,
    })
  }

  const coverage = entry.custom ? coverageForAmount(options, entry.selection, typed ?? 0, ctx) : null
  const effective = effectiveOptions(options, entry.selection, ctx)
  const summary = selectionSummary(effective, entry.selection)
  const summaryLabel = summaryText(summary)
  const debt = entryDebtAfter(options, entry, creditCents, typed)
  const scope = openingScope(options, entry.selection, ctx, { payment: true })
  // El mes del alta solo se conoce si cae dentro de la ventana de previos; si no, el aviso va sin mes.
  const joinedIndex = firstJoinedIndex(options)
  const joinedWarning =
    memberId !== undefined && beforeJoinedWarning(options, entry.selection)
      ? { memberId, joinedPeriod: joinedIndex !== -1 ? options[joinedIndex].period : null }
      : null

  return (
    <div className="flex flex-col gap-3">
      {!entry.custom ? (
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="min-w-0 text-sm font-medium first-letter:uppercase">
            {summaryLabel || <span className="font-normal text-muted-foreground">Ningún mes marcado</span>}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0"
            disabled={disabled}
            aria-expanded={entry.expanded}
            aria-controls={gridId}
            onClick={() => update({ ...entry, expanded: !entry.expanded })}
          >
            {entry.expanded ? 'Listo' : 'Cambiar'}
          </Button>
        </div>
      ) : null}

      <div id={gridId} className="flex flex-col gap-2">
        {entry.expanded ? (
          <MonthStrip
            options={effective}
            selection={entry.selection}
            variant={variant}
            disabled={disabled}
            coverage={coverage}
            joinedWarning={joinedWarning}
            onTap={(index) => {
              const result = toggleCell(options, entry.selection, index, paintOpts)
              // `blocked` ('advance'): la grilla ya muestra el aviso; la selección no cambia.
              if (!result.blocked) pick(result.selection)
            }}
            onDragStart={() => {
              dragBaseRef.current = entry.selection
            }}
            onRange={(anchor, over) => pick(paintRange(options, dragBaseRef.current, anchor, over, paintOpts))}
            preSystem={
              hasPreSystem && lastPre
                ? {
                    open: entry.preOpen,
                    scope,
                    startPeriod: startPeriod ?? addMonths(lastPre.period, 1),
                    hideBeforeStartNote,
                    overrideCents: entry.overrideCents,
                    // Siempre por `onChange`: total y validez en un solo cambio de estado.
                    onOverrideChange: () => {},
                    onChange: (cents, valid) => update({ ...entry, overrideCents: cents, overrideInvalid: !valid }),
                    beforeStart,
                    onToggle: beforeStart
                      ? undefined
                      : () => {
                          if (entry.preOpen) {
                            update({ ...entry, preOpen: false, overrideCents: null, overrideInvalid: false, selection: unmarkPreSystem(options, entry.selection, ctx) })
                          } else {
                            update({ ...entry, preOpen: true })
                          }
                        },
                  }
                : null
            }
          />
        ) : null}
      </div>

      {showDebtLine && debt.months > 0 ? (
        <p className="flex items-start gap-1.5 text-sm font-medium tabular-nums">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-in-debt" />
          {debtLine(debt)}
        </p>
      ) : null}

      {entry.custom ? (
        <div className="flex flex-col gap-2">
          <AmountField control={control} name={amountName} label={amountLabel} disabled={disabled} autoFocus={!compact} />
          {coverage && coverage.leftoverCents > 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              Queda saldo a favor de <span className="font-medium text-foreground tabular-nums">{formatCentsCompact(coverage.leftoverCents)}</span>.
            </p>
          ) : null}
          {options.some(isSelectable) ? (
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
              <p className={compact ? 'text-base font-semibold tabular-nums' : 'text-2xl font-semibold tabular-nums'}>{formatCentsCompact(derived)}</p>
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0"
            disabled={disabled}
            onClick={() => {
              // "Otro monto" necesita ver qué cubre: abre la grilla.
              onEntryChange({ ...entry, custom: true, expanded: true })
            }}
          >
            Otro monto
          </Button>
        </div>
      )}

      {!entry.custom && derived === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {openingSpan(options, entry.selection)
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
