import { formatCentsCompact } from '@/lib/money'
import { Amount } from '@/views/shared/money'
import { DateText, PeriodText } from '@/views/shared/date-text'
import { cn } from '@/lib/utils'
import type { MemberAccount } from '@/models/types'

type AccountAnswerData = Pick<
  MemberAccount,
  'debtStatus' | 'balanceCents' | 'monthsDue' | 'oldestDuePeriod' | 'lastPaymentOn' | 'lastPaymentCents'
>

/**
 * La respuesta central del producto ("¿debe? ¿desde cuándo? ¿cuánto?"), con
 * el mismo tratamiento visual grande en la ficha (`MemberAccountSection`) y
 * en la vista rápida (`MemberQuickViewSheet`) — factorizado acá para no
 * duplicarlo (screenshot review, pipeline 2026-09-28-ui-expresiva, ronda 2).
 * Antes cada lugar mostraba un `DebtStatusPill` Y `accountLineText` lado a
 * lado diciendo lo mismo dos veces; esta pieza reemplaza a los dos juntos —
 * nunca convive con `DebtStatusPill`, el estado se dice una sola vez.
 *
 * Mismo lenguaje visual que `HeroFigure`/`MoneySummaryStrip` (bloque sobre
 * `bg-brand-soft`, tipografía proporcional para el número grande — nunca
 * `tabular-nums`, que es para columnas que alinean, no para un número solo)
 * pero sin reusar `HeroFigure` en sí: el caso "al día" no tiene un monto que
 * mostrar, es una afirmación de texto ("Al día"), algo que `HeroFigure` (que
 * siempre recibe `cents`) no puede expresar.
 *
 * `variant` (code-review, ronda 3): la vista rápida NO está dentro de ningún
 * otro contenedor con chrome propio, así que ahí el bloque necesita su
 * propia tarjeta (`'card'`, default) — borde, radio, sombra. Dentro de
 * `Panel title="Cuenta"` (`MemberAccountSection`), esa misma tarjeta quedaba
 * como una tarjeta dentro de otra tarjeta (piso de calidad: un `Panel` nunca
 * contiene otro, y esto se leía igual aunque no fuera literalmente un
 * `Panel`). `'plain'` saca el borde/sombra/radio propios y deja solo una
 * banda de `bg-brand-soft` que sangra a los bordes del `padding` del panel
 * que la contiene (`-mx-4 -mt-4`, mismo `p-4` que usa `Panel`) — el color
 * sigue marcando "esto es lo importante" sin dibujar una segunda caja.
 */
export function MemberAccountAnswer({
  account,
  variant = 'card',
  className,
}: {
  account: AccountAnswerData
  variant?: 'card' | 'plain'
  className?: string
}) {
  const toneClass = account.debtStatus === 'in_debt' ? 'text-status-in-debt' : 'text-status-up-to-date'

  const headline =
    account.debtStatus === 'up_to_date'
      ? 'Al día'
      : account.debtStatus === 'credit'
        ? `Saldo a favor ${formatCentsCompact(Math.abs(account.balanceCents))}`
        : formatCentsCompact(account.balanceCents)

  // Una sola línea debajo del número, nunca varias apiladas repitiendo
  // "muted-foreground" cada vez (la queja del screenshot): "desde/meses" y el
  // último pago se arman como un único renglón que envuelve si hace falta.
  const detailParts: React.ReactNode[] = []
  if (account.debtStatus === 'in_debt' && account.oldestDuePeriod) {
    detailParts.push(
      <span key="since">
        Debe desde <PeriodText period={account.oldestDuePeriod} /> · {account.monthsDue === 1 ? '1 mes' : `${account.monthsDue} meses`}
      </span>,
    )
  }
  if (account.lastPaymentOn) {
    detailParts.push(
      <span key="last-payment">
        Último pago <Amount cents={account.lastPaymentCents ?? 0} /> el <DateText date={account.lastPaymentOn} />
      </span>,
    )
  } else if (account.debtStatus !== 'in_debt') {
    detailParts.push(<span key="no-payment">Todavía no registró ningún pago.</span>)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1 bg-brand-soft',
        variant === 'card' ? 'rounded-xl border border-border/70 p-4 shadow-raised' : '-mx-4 -mt-4 px-4 pt-4 pb-3',
        className,
      )}
    >

      <p className={cn('text-3xl font-semibold tracking-tight sm:text-4xl', toneClass)}>{headline}</p>
      {detailParts.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {detailParts.map((part, i) => (
            <span key={i}>
              {i > 0 ? ' · ' : null}
              {part}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  )
}
