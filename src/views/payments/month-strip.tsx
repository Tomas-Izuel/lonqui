'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CalendarPlus, Check, ChevronDown, CircleCheck, CircleDashed, CircleDot, History, type LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPeriod } from '@/lib/dates'
import { formatCentsCompact, parsePesosToCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { shortMonth } from '@/views/shared/chart-format'
import {
  advancesAllowedOn,
  cellTone,
  isSelectable,
  preCellRole,
  type CellTone,
  type CoverageResult,
  type OpeningScope,
  type Selection,
} from '@/views/payments/month-selection'
import { useMonthDrag } from '@/views/payments/use-month-drag'
import type { ISODate, PaymentMonthOption } from '@/models/types'

/** Misma regla que `MemberPeriodStrip`: un ícono distinto por estado, el color solo refuerza. */
const TONE_ICON: Record<CellTone, LucideIcon> = {
  pre_system: History,
  due: AlertCircle,
  partial: CircleDashed,
  paid: Check,
  covered: Check,
  current: CircleDot,
  advance: CalendarPlus,
}

const TONE_TEXT_CLASS: Record<CellTone, string> = {
  pre_system: 'text-muted-foreground',
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
    case 'due':
      return 'debe'
    case 'partial':
      return `falta ${formatCentsCompact(o.pendingCents)}`
    case 'paid':
      return 'pagado'
    case 'covered':
      // Un mes previo sin pendiente solo se ve cuando el saldo a favor ya lo cubre.
      return o.kind === 'pre_system' ? 'cubierto con saldo a favor' : 'cubierto'
    case 'current':
      return o.kind === 'projected' && !o.pricedAtToday ? `este mes · ${formatCentsCompact(o.amountCents)}` : 'este mes'
    case 'advance':
      // Un valor programado distinto al de hoy se dice con su monto, para que no parezca la cuota actual.
      return o.kind === 'projected' && !o.pricedAtToday ? `adelanto · ${formatCentsCompact(o.amountCents)}` : 'adelanto'
  }
}

export type MonthStripPreSystem = {
  open: boolean
  /** Con tramo (F..P): rotula el total y la pista de pagó / queda debiendo. */
  scope?: OpeningScope | null
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

/** Lo que cubre un "Otro monto" (`coverageForAmount`): la grilla lo muestra en vivo. */
export type MonthStripCoverage = CoverageResult

/** Aviso de fecha de alta: hay meses previos marcados anteriores al alta (§6.3). No bloquea. */
export type MonthStripJoinedWarning = { joinedPeriod: ISODate | null; memberId: number }

const ADVANCE_HINT = 'Para adelantar meses, primero marcá los que debe.'

/**
 * La grilla de meses del formulario de pago (brief 2026-10-29): un CONJUNTO de
 * meses sueltos. Tocar alterna, arrastrar pinta (marca o desmarca según la
 * celda de partida). Muestra EN ORDEN lo que la cuenta ya hace y deja marcar
 * qué meses se pagan; pagar mayo y julio deja junio adeudado.
 *
 * 4 columnas que crecen hacia abajo (a 390px nunca scrollea de costado). Cada
 * celda lleva ícono + texto, nunca solo color; `aria-pressed` en las marcadas
 * y un `sr-only` con mes, año y estado. Es 100% controlado: la selección y el
 * "otro monto" viven en el formulario. Recibe las opciones EFECTIVAS (con el
 * saldo a favor y el total corregido ya aplicados).
 */
export function MonthStrip({
  options,
  selection,
  onTap,
  onRange,
  onDragStart,
  variant = 'default',
  preSystem,
  coverage,
  joinedWarning = null,
  disabled = false,
  id,
}: {
  options: PaymentMonthOption[]
  selection: Selection
  onTap: (index: number) => void
  /** Arrastre en vivo (mouse y dedo). Sin esto la grilla solo se toca. */
  onRange?: (anchor: number, over: number) => void
  /** Se armó el arrastre: el formulario guarda la selección base sobre la que pinta `onRange`. */
  onDragStart?: (anchor: number) => void
  /** Para que el botón "Cambiar" del resumen apunte a la grilla (`aria-controls`). */
  id?: string
  variant?: 'default' | 'compact'
  preSystem: MonthStripPreSystem | null
  coverage: MonthStripCoverage | null
  joinedWarning?: MonthStripJoinedWarning | null
  disabled?: boolean
}) {
  const dragEnabled = Boolean(onRange) && !disabled
  const { setList, listProps, consumeClick } = useMonthDrag({ onRange: onRange ?? (() => {}), onDragStart, enabled: dragEnabled })
  // El aviso de adelantos vale para ESTA selección: al cambiarla desaparece solo.
  const selectionKey = selection.join(',')
  const [hintKey, setHintKey] = useState<string | null>(null)
  const preOpen = preSystem?.open ?? false
  const marked = new Set(selection)
  const compact = variant === 'compact'
  const advancesOpen = advancesAllowedOn(options, selection)

  const coveredFull = new Map((coverage?.marked ?? []).map((e) => [e.index, e.cents]))
  const coveredUnmarked = new Map((coverage?.unmarked ?? []).map((e) => [e.index, e.cents]))
  const coveredAdvance = new Map((coverage?.advances ?? []).map((e) => [e.index, e.cents]))

  const hasPre = options.some((o) => o.kind === 'pre_system')
  const visible = options.map((option, index) => ({ option, index })).filter(({ option }) => preOpen || option.kind !== 'pre_system')

  const showsAdvanceNote = [...marked].some((i) => options[i]?.kind === 'projected' && !options[i].isCurrent && options[i].pricedAtToday)

  return (
    <div id={id} className="flex flex-col gap-2">
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

      <ul ref={setList} {...listProps} className={cn('grid grid-cols-4 gap-1.5', dragEnabled && 'select-none [-webkit-touch-callout:none]')}>
        {visible.map(({ option, index }, position) => {
          const tone = cellTone(option)
          const selectable = isSelectable(option)
          const isMarked = marked.has(index)
          const locked = option.kind === 'projected' && selectable && !isMarked && !advancesOpen
          // Qué hace "Otro monto" con esta celda (la regla de la base, en vivo).
          const partialCents = coverage?.partial?.index === index ? coverage.partial.cents : null
          const absorbedCents = coveredUnmarked.get(index) ?? (coveredAdvance.has(index) ? option.pendingCents : null)
          const absorbedPartial = coveredUnmarked.has(index) && (coveredUnmarked.get(index) ?? 0) < option.pendingCents
          const paidByAmount = coveredFull.has(index)
          const takesAmount = absorbedCents !== null
          // Solo las celdas SIN marcar que absorben el remanente se dibujan distinto: las marcadas ya tienen su estilo.
          const absorbed = !isMarked && takesAmount
          // Antes del inicio el mes actual es una celda previa: conserva el trazo punteado pero dice "este mes".
          const preCurrent = tone === 'pre_system' && option.isCurrent
          // Una previa dentro del tramo que no se marca queda adeudada: se dice con texto, no solo con color.
          const owed = preCellRole(options, selection, index) === 'owed'
          const previous = position > 0 ? visible[position - 1].option : null
          const showYear = tone === 'pre_system' || !previous || previous.period.slice(0, 4) !== option.period.slice(0, 4)

          let stateLabel: string
          let Icon: LucideIcon
          if (partialCents !== null) {
            stateLabel = `cubre ${formatCentsCompact(partialCents)} de ${formatCentsCompact(option.pendingCents)}`
            Icon = CircleDashed
          } else if (paidByAmount) {
            stateLabel = 'pagado'
            Icon = Check
          } else if (takesAmount) {
            stateLabel = coveredAdvance.has(index) ? 'cubierto' : absorbedPartial ? `se cubre ${formatCentsCompact(absorbedCents ?? 0)}` : 'se cubre'
            Icon = Check
          } else if (owed) {
            stateLabel = 'queda debiendo'
            Icon = AlertCircle
          } else {
            stateLabel = preCurrent ? 'este mes' : toneLabel(option, tone)
            Icon = preCurrent ? CircleDot : TONE_ICON[tone]
          }
          // El pliegue ya dice "antes del sistema": en cada celda previa queda mes, año e ícono (el texto completo, para lectores de pantalla).
          const spokenState = preCurrent && stateLabel === 'este mes' ? 'este mes, antes del sistema' : stateLabel
          const fullLabel = `${formatPeriod(option.period)}: ${spokenState}${isMarked ? ', marcado' : ''}${locked ? ', se habilita al marcar los meses que debe' : selectable || isMarked ? '' : ', no se puede marcar'}`
          // Marcar es tocable si lleva algo pendiente, o si ya está marcada (para poder desmarcarla).
          const inert = !selectable && !isMarked

          return (
            <li key={`${option.period}-${option.kind}`} data-month-index={index} className="min-w-0">
              <button
                type="button"
                disabled={disabled || inert}
                aria-pressed={inert ? undefined : isMarked}
                aria-disabled={locked || undefined}
                onClick={() => {
                  // La cola de un arrastre no es un toque: la selección ya quedó como la dejó el dedo.
                  if (consumeClick()) return
                  if (locked) {
                    setHintKey(selectionKey)
                    return
                  }
                  onTap(index)
                }}
                className={cn(
                  'relative flex w-full flex-col items-start gap-0.5 rounded-lg border px-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                  compact ? 'min-h-11 py-1' : 'min-h-16 py-1.5',
                  dragEnabled && 'touch-pan-y',
                  tone === 'pre_system' && 'border-dashed',
                  isMarked && partialCents === null && 'border-primary bg-primary/10',
                  partialCents !== null && 'border-dashed border-primary bg-primary/5',
                  absorbed && 'border-dashed border-primary bg-primary/5',
                  !isMarked && !absorbed && selectable && 'border-border bg-card hover:bg-muted',
                  inert && 'border-transparent bg-muted',
                  locked && 'opacity-60',
                  (disabled || inert || locked) && 'cursor-default',
                )}
              >
                <span aria-hidden className="flex w-full flex-wrap items-baseline gap-x-1 pr-4 leading-tight">
                  <span className={cn('text-sm font-semibold capitalize', selectable || isMarked ? 'text-foreground' : 'text-muted-foreground')}>
                    {shortMonth(option.period)}
                  </span>
                  {showYear ? <span className="text-xs text-muted-foreground">{option.period.slice(0, 4)}</span> : null}
                </span>
                {isMarked ? <CircleCheck aria-hidden className="absolute top-1.5 right-1.5 size-4 text-primary" /> : null}
                <span
                  aria-hidden
                  className={cn('flex items-start gap-1 text-xs leading-tight tabular-nums', owed ? 'text-status-in-debt' : isMarked ? 'text-foreground' : TONE_TEXT_CLASS[tone])}
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

      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {hintKey === selectionKey ? ADVANCE_HINT : null}
      </p>

      {dragEnabled ? (
        <p className="text-xs text-muted-foreground">
          <span className="pointer-coarse:hidden">Tocá cada mes que pagó, o arrastrá.</span>
          <span className="hidden pointer-coarse:inline">Tocá cada mes que pagó, o mantené apretado y arrastrá.</span>
        </p>
      ) : null}

      {showsAdvanceNote ? <p className="text-xs text-muted-foreground">Los meses de adelanto se cobran al valor de hoy.</p> : null}

      {joinedWarning ? (
        <div className="flex items-start gap-2 text-sm">
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-status-in-debt" />
          <div className="flex min-w-0 flex-col">
            <p>
              Marcaste meses anteriores a la fecha de alta{joinedWarning.joinedPeriod ? ` (${formatPeriod(joinedWarning.joinedPeriod)})` : ''}. Si pagó esos meses, la fecha
              de alta está mal: corregila desde la ficha.
            </p>
            <Link
              href={`/socios/${joinedWarning.memberId}/editar`}
              className="inline-flex min-h-11 w-fit items-center font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
            >
              Corregir fecha de alta
            </Link>
          </div>
        </div>
      ) : null}

      {preSystem && preOpen && preSystem.scope ? (
        <OpeningTotalField
          scope={preSystem.scope}
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

/** Total de la deuda previa (F..P): arranca en la suma de las celdas y se puede corregir. Lo vacío vuelve a la suma. */
function OpeningTotalField({
  scope,
  onOverrideChange,
  onValidityChange,
  onChange,
  disabled,
}: {
  scope: OpeningScope
  overrideCents: number | null
  onOverrideChange: (cents: number | null) => void
  onValidityChange?: (valid: boolean) => void
  onChange?: (cents: number | null, valid: boolean) => void
  disabled: boolean
}) {
  const id = useId()
  const sum = scope.sumCents
  const [text, setText] = useState<string | null>(null)

  // Si cambió "desde cuándo", el texto vuelve a mostrar la suma (el formulario descarta la corrección).
  const key = scope.fromPeriod
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setText(null)
  }

  const shown = text ?? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(sum / 100)
  const parsed = text === null || text.trim() === '' ? undefined : parsePesosToCents(text)
  const invalid = parsed !== undefined && (parsed === null || parsed <= 0)
  const errorId = `${id}-error`
  const plural = (n: number) => (n === 1 ? '1 mes' : `${n} meses`)

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-sm font-medium">
        Total de la deuda desde {formatPeriod(scope.fromPeriod)} ({plural(scope.months)})
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
          {scope.payment
            ? `Pagó ${plural(scope.paidMonths)} · ${formatCentsCompact(scope.paidCents)}.${
                scope.owedMonths > 0 ? ` Queda debiendo ${plural(scope.owedMonths)} · ${formatCentsCompact(scope.owedCents)}.` : ''
              }`
            : `${plural(scope.months)} a la cuota de hoy.`}{' '}
          Si debía otro valor, corregí el total.
        </p>
      )}
    </div>
  )
}
