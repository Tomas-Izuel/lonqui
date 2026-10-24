'use client'

import { useId, useState } from 'react'
import { AlertCircle, CalendarPlus, Check, ChevronDown, CircleCheck, CircleDashed, CircleDot, History, Wallet, type LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPeriod } from '@/lib/dates'
import { formatCentsCompact, parsePesosToCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { shortMonth } from '@/views/shared/chart-format'
import { cellTone, isSelectable, selectedIndexes, type CellTone, type Selection } from '@/views/payments/month-selection'
import type { ISODate, PaymentMonthOption } from '@/models/types'

/** Misma regla que `MemberPeriodStrip`: un ícono distinto por estado, el color solo refuerza. */
const TONE_ICON: Record<CellTone, LucideIcon> = {
  pre_system: History,
  opening_balance: Wallet,
  due: AlertCircle,
  partial: CircleDashed,
  paid: Check,
  covered: Check,
  current: CircleDot,
  advance: CalendarPlus,
}

const TONE_TEXT_CLASS: Record<CellTone, string> = {
  pre_system: 'text-muted-foreground',
  opening_balance: 'text-status-in-debt',
  due: 'text-status-in-debt',
  partial: 'text-status-in-debt',
  paid: 'text-status-up-to-date',
  covered: 'text-status-up-to-date',
  current: 'text-foreground',
  advance: 'text-muted-foreground',
}

function toneLabel(o: PaymentMonthOption, tone: CellTone): string {
  switch (tone) {
    case 'pre_system':
      return 'antes del sistema'
    case 'opening_balance':
      return `Saldo anterior · ${formatCentsCompact(o.pendingCents)}`
    case 'due':
      return 'debe'
    case 'partial':
      return `falta ${formatCentsCompact(o.pendingCents)}`
    case 'paid':
      return 'pagado'
    case 'covered':
      return 'cubierto'
    case 'current':
      return o.kind === 'projected' && !o.pricedAtToday ? `este mes · ${formatCentsCompact(o.amountCents)}` : 'este mes'
    case 'advance':
      // Un valor programado distinto al de hoy se dice con su monto, para que no parezca la cuota actual.
      return o.kind === 'projected' && !o.pricedAtToday ? `adelanto · ${formatCentsCompact(o.amountCents)}` : 'adelanto'
  }
}

export type MonthStripPreSystem = {
  open: boolean
  /** Sin `onToggle` el pliegue no se dibuja y las celdas previas quedan siempre visibles (la ficha). */
  onToggle?: () => void
  /** Primer mes de la facturación (el real, no derivado de las celdas): "¿Debe meses de antes de octubre 2026?". */
  startPeriod: ISODate
  /** Antes del inicio: sin pliegue y con la línea que explica por qué los meses previos son saldo anterior. */
  beforeStart?: boolean
  /** El formulario ya muestra la línea una vez (pago de grupo). */
  hideBeforeStartNote?: boolean
  overrideCents: number | null
  onOverrideChange: (cents: number | null) => void
  /** false mientras el total tipeado no se puede leer (o es 0): el formulario frena el envío. Legado: preferí `onChange`. */
  onValidityChange?: (valid: boolean) => void
  /**
   * Total tipeado y validez en UN solo callback (un cambio de estado por tecla).
   * Si está, la tira no llama a `onOverrideChange` ni a `onValidityChange`.
   */
  onChange?: (cents: number | null, valid: boolean) => void
}

/** La línea que explica por qué antes del inicio todo es saldo anterior (la usa también el pago de grupo, una sola vez). */
export function BeforeStartNote({ startPeriod }: { startPeriod: ISODate }) {
  return (
    <p className="text-sm text-muted-foreground">
      Las cuotas arrancan en {formatPeriod(startPeriod)}. Los meses anteriores se cargan como saldo anterior.
    </p>
  )
}

export type MonthStripCoverage = {
  fullyCovered: number[]
  partial: { index: number; cents: number } | null
}

/**
 * La tira de meses del formulario de pago (brief 2026-10-24): muestra EN ORDEN
 * lo que la cuenta ya hace (balance forward) y deja marcar hasta qué mes se
 * paga. Tocar un mes marca todo hasta ahí; no hay meses sueltos.
 *
 * 4 columnas que crecen hacia abajo (a 390px nunca scrollea de costado). Cada
 * celda lleva ícono + texto, nunca solo color; `aria-pressed` en las marcadas
 * y un `sr-only` con mes, año y estado. Es 100% controlado: la selección y el
 * "otro monto" viven en el formulario.
 */
export function MonthStrip({
  options,
  selection,
  onTap,
  variant = 'default',
  preSystem,
  coverage,
  disabled = false,
}: {
  options: PaymentMonthOption[]
  selection: Selection
  onTap: (index: number) => void
  variant?: 'default' | 'compact'
  preSystem: MonthStripPreSystem | null
  coverage: MonthStripCoverage | null
  disabled?: boolean
}) {
  const preOpen = preSystem?.open ?? false
  const marked = new Set(selectedIndexes(options, selection))
  const covered = coverage ? new Set(coverage.fullyCovered) : null
  const compact = variant === 'compact'

  const hasPre = options.some((o) => o.kind === 'pre_system')
  const visible = options.map((option, index) => ({ option, index })).filter(({ option }) => preOpen || option.kind !== 'pre_system')

  const preSelected = [...marked].filter((i) => options[i].kind === 'pre_system')
  const showsAdvanceNote = [...marked].some((i) => options[i].kind === 'projected' && !options[i].isCurrent && options[i].pricedAtToday)

  return (
    <div className="flex flex-col gap-2">
      {preSystem?.onToggle && hasPre ? (
        <button
          type="button"
          aria-expanded={preOpen}
          onClick={preSystem.onToggle}
          disabled={disabled}
          className="flex min-h-11 w-fit items-center gap-1.5 rounded-lg text-sm font-medium text-primary outline-none hover:text-primary-hover focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <ChevronDown aria-hidden className={cn('size-4 shrink-0 transition-transform', preOpen && 'rotate-180')} />
          ¿Debe meses de antes de {formatPeriod(preSystem.startPeriod)}?
        </button>
      ) : null}

      {preSystem?.beforeStart && !preSystem.hideBeforeStartNote ? <BeforeStartNote startPeriod={preSystem.startPeriod} /> : null}

      <ul className="grid grid-cols-4 gap-1.5">
        {visible.map(({ option, index }, position) => {
          const tone = cellTone(option)
          const selectable = isSelectable(option)
          const isPartialCover = coverage?.partial?.index === index
          const isMarked = covered ? covered.has(index) || isPartialCover : marked.has(index)
          // Antes del inicio el mes actual es una celda previa: conserva el trazo punteado pero dice "este mes".
          const preCurrent = tone === 'pre_system' && option.isCurrent
          const Icon = preCurrent ? CircleDot : TONE_ICON[tone]
          const previous = position > 0 ? visible[position - 1].option : null
          const showYear = tone === 'pre_system' || !previous || previous.period.slice(0, 4) !== option.period.slice(0, 4)

          // El pliegue ya dice "antes del sistema": en cada celda previa queda mes, año e ícono (el texto completo, para lectores de pantalla).
          const stateLabel = isPartialCover
            ? `cubre ${formatCentsCompact(coverage!.partial!.cents)} de ${formatCentsCompact(option.pendingCents)}`
            : covered && isMarked
              ? 'se cubre'
              : preCurrent
                ? 'este mes'
                : toneLabel(option, tone)
          const spokenState = preCurrent && stateLabel === 'este mes' ? 'este mes, antes del sistema' : stateLabel
          const fullLabel = `${formatPeriod(option.period)}: ${spokenState}${isMarked ? ', marcado' : ''}${selectable ? '' : ', no se puede marcar'}`

          return (
            <li key={`${option.period}-${option.kind}`} className="min-w-0">
              <button
                type="button"
                disabled={disabled || !selectable}
                aria-pressed={selectable ? isMarked : undefined}
                onClick={() => onTap(index)}
                className={cn(
                  'relative flex w-full flex-col items-start gap-0.5 rounded-lg border px-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                  compact ? 'min-h-11 py-1' : 'min-h-16 py-1.5',
                  tone === 'pre_system' && 'border-dashed',
                  isMarked && !isPartialCover && 'border-primary bg-primary/10',
                  isPartialCover && 'border-dashed border-primary bg-primary/5',
                  !isMarked && selectable && 'border-border bg-card hover:bg-muted',
                  !selectable && 'border-transparent bg-muted',
                  (disabled || !selectable) && 'cursor-default',
                )}
              >
                <span aria-hidden className="flex w-full flex-wrap items-baseline gap-x-1 pr-4 leading-tight">
                  <span className={cn('text-sm font-semibold capitalize', selectable ? 'text-foreground' : 'text-muted-foreground')}>
                    {shortMonth(option.period)}
                  </span>
                  {showYear ? <span className="text-xs text-muted-foreground">{option.period.slice(0, 4)}</span> : null}
                </span>
                {isMarked ? <CircleCheck aria-hidden className="absolute top-1.5 right-1.5 size-4 text-primary" /> : null}
                <span
                  aria-hidden
                  className={cn('flex items-start gap-1 text-xs leading-tight tabular-nums', isMarked ? 'text-foreground' : TONE_TEXT_CLASS[tone])}
                >
                  <Icon className="mt-px size-3 shrink-0" />
                  {tone === 'pre_system' && stateLabel === 'antes del sistema' ? null : <span className="min-w-0 break-words">{stateLabel}</span>}
                </span>
                <span className="sr-only">{fullLabel}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {showsAdvanceNote ? <p className="text-xs text-muted-foreground">Los meses de adelanto se cobran al valor de hoy.</p> : null}

      {preSystem && preOpen && preSelected.length > 0 ? (
        <OpeningTotalField
          preSelected={preSelected.map((i) => options[i])}
          overrideCents={preSystem.overrideCents}
          onOverrideChange={preSystem.onOverrideChange}
          onValidityChange={preSystem.onValidityChange}
          onChange={preSystem.onChange}
          disabled={disabled}
        />
      ) : null}
    </div>
  )
}

/** Total del saldo anterior: arranca en la suma de los marcados y se puede corregir. Lo vacío vuelve a la suma. */
function OpeningTotalField({
  preSelected,
  onOverrideChange,
  onValidityChange,
  onChange,
  disabled,
}: {
  preSelected: PaymentMonthOption[]
  overrideCents: number | null
  onOverrideChange: (cents: number | null) => void
  onValidityChange?: (valid: boolean) => void
  onChange?: (cents: number | null, valid: boolean) => void
  disabled: boolean
}) {
  const id = useId()
  const sum = preSelected.reduce((total, o) => total + o.amountCents, 0)
  const [text, setText] = useState<string | null>(null)

  // Si se movió la selección, el texto vuelve a mostrar la suma (el formulario descarta la corrección).
  const key = preSelected.map((o) => o.period).join()
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setText(null)
  }

  const shown = text ?? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(sum / 100)
  const parsed = text === null || text.trim() === '' ? undefined : parsePesosToCents(text)
  const invalid = parsed !== undefined && (parsed === null || parsed <= 0)
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-sm font-medium">
        Total del saldo anterior
      </Label>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
          $
        </span>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          className="pl-7 tabular-nums"
          value={shown}
          onChange={(event) => {
            const next = event.target.value
            setText(next)
            const parsedNext = next.trim() === '' ? undefined : parsePesosToCents(next)
            const valid = parsedNext === undefined || (parsedNext !== null && parsedNext > 0)
            const cents = parsedNext !== undefined && valid ? parsedNext : null
            if (onChange) {
              onChange(cents, valid)
              return
            }
            onOverrideChange(cents)
            onValidityChange?.(valid)
          }}
        />
      </div>
      {invalid ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          Ingresá un monto válido
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {preSelected.length === 1 ? '1 mes' : `${preSelected.length} meses`} a la cuota de hoy. Si debía otro valor, corregí el total.
        </p>
      )}
    </div>
  )
}
