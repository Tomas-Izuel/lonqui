'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { LoadingList, EmptyState, ErrorState } from '@/views/shared/states'
import { StatusPill } from '@/views/shared/status-pill'
import { categoriesLabel } from '@/views/payments/account-format'
import { useOverlayParam, paymentOverlayValue } from '@/views/shared/overlay-params'
import { loadMoreMembers } from '@/controllers/members.actions'
import { Dni } from '@/views/shared/dni'
import { formatCentsCompact } from '@/lib/money'
import type { MemberSummary } from '@/models/types'

/**
 * `loadMoreMembers` es la Server Action de "Ver más" del padrón (`members.
 * actions.ts`, sin cambios): su schema exige un `cursor` no vacío porque está
 * pensada para pedir la página SIGUIENTE, nunca la primera. `decodeCursor`
 * (modelo) ya documenta que un cursor que no decodifica a un keyset válido
 * "se ignora: arranca de nuevo" — exactamente lo que necesita una búsqueda en
 * vivo (primera página, sin acumulado). Este valor nunca decodifica a nada.
 */
const FIRST_PAGE_CURSOR = 'buscar'
const DEBOUNCE_MS = 300

type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; items: MemberSummary[] }

/** "Debe $X · N meses" / "Al día" / "Saldo a favor $X" — solo si `debtStatus` viene (siempre, con `payments.register`, que implica ver la cuenta). */
function debtLine(member: MemberSummary): { label: string; variant: 'up-to-date' | 'in-debt' | 'credit' } | null {
  if (member.debtStatus == null) return null
  if (member.debtStatus === 'in_debt') {
    const months = member.monthsDue === 1 ? '1 mes' : `${member.monthsDue ?? 0} meses`
    return { label: `Debe ${formatCentsCompact(member.balanceCents ?? 0)} · ${months}`, variant: 'in-debt' }
  }
  if (member.debtStatus === 'credit') {
    return { label: `Saldo a favor ${formatCentsCompact(Math.abs(member.balanceCents ?? 0))}`, variant: 'credit' }
  }
  return { label: 'Al día', variant: 'up-to-date' }
}

/**
 * Paso "buscar" del overlay de pago (`PaymentOverlayHost`, `?pagar=buscar`):
 * escribe un nombre o DNI, ve quién debe cuánto ANTES de tocar un resultado —
 * la pregunta que Tesorería resuelve en un toque desde la búsqueda
 * (`PRODUCT.md`) — y al elegir un socio pasa a `?pagar=socio:<id>` en el
 * MISMO overlay (el paso siguiente lo anima `PaymentOverlayHost` con
 * `AnimatePresence`, acá no hace falta saber nada de esa transición).
 */
export function MemberPicker() {
  const paymentOverlay = useOverlayParam('pagar')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })
  const term = query.trim()

  // El estado visible (idle/loading) se decide EN EL RENDER cuando `term`
  // cambia, no dentro del cuerpo del efecto (mismo patrón que `SearchInput`
  // y el `RegisterPaymentSheet` original: evita el "cascading render" de un
  // `setState` síncrono al principio del efecto). El efecto de abajo solo
  // dispara el pedido con debounce y escribe el resultado en su callback.
  const [trackedTerm, setTrackedTerm] = useState(term)
  if (term !== trackedTerm) {
    setTrackedTerm(term)
    setState(term.length === 0 ? { status: 'idle' } : { status: 'loading' })
  }

  useEffect(() => {
    if (term.length === 0) return
    let cancelled = false

    const timeout = setTimeout(async () => {
      const result = await loadMoreMembers({ filters: { q: term, status: 'all' }, cursor: FIRST_PAGE_CURSOR })
      if (cancelled) return
      if (!result.ok) {
        setState({ status: 'error', error: result.error })
        return
      }
      setState({ status: 'ready', items: result.data.items })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [term])

  function selectMember(member: MemberSummary) {
    paymentOverlay.set(paymentOverlayValue({ mode: 'socio', memberId: member.id }))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o DNI…"
          aria-label="Buscar socio para registrar un pago"
          autoFocus
          className="h-11 pl-9"
        />
      </div>

      {state.status === 'loading' ? <LoadingList rows={3} /> : null}
      {state.status === 'error' ? <ErrorState title="No pudimos buscar" description={state.error} /> : null}
      {state.status === 'idle' ? (
        <EmptyState title="Buscá al socio" description="Escribí un nombre, apellido o DNI para empezar a cobrar." />
      ) : null}
      {state.status === 'ready' ? (
        state.items.length === 0 ? (
          <EmptyState title="No encontramos socios" description={`Sin resultados para "${query.trim()}".`} />
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border/70">
            {state.items.map((member) => {
              const debt = debtLine(member)
              return (
                <li key={member.id}>
                  <button
                    type="button"
                    onClick={() => selectMember(member)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">{member.fullName}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Dni dni={member.dni} />
                        <span className="truncate">{categoriesLabel(member.categories)}</span>
                      </span>
                    </span>
                    {debt ? (
                      <StatusPill variant={debt.variant} className="shrink-0">
                        {debt.label}
                      </StatusPill>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )
      ) : null}
    </div>
  )
}
