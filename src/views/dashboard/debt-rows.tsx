import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Amount } from '@/views/shared/money'
import { DataRow, DataRowGroup } from '@/views/dashboard/data-row'
import type { DashboardSummary, MemberAccount } from '@/models/types'

function TopDebtorRow({ member }: { member: MemberAccount }) {
  return (
    <li>
      <Link
        href={`/socios/${member.memberId}`}
        className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{member.fullName}</span>
          <span className="text-xs text-muted-foreground">
            {member.monthsDue} {member.monthsDue === 1 ? 'mes' : 'meses'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 font-medium tabular-nums text-status-in-debt">
          <Amount cents={member.balanceCents} />
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </div>
      </Link>
    </li>
  )
}

/** Lista de los 5 más atrasados. Reutilizada tal cual con o sin `<details>` alrededor (variante C). */
export function TopDebtorsList({ members }: { members: MemberAccount[] }) {
  if (members.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Ningún socio activo tiene deuda.</p>
  }
  return <ul className="flex flex-col divide-y divide-border">{members.map((m) => <TopDebtorRow key={m.memberId} member={m} />)}</ul>
}

/**
 * Detalle de "Deuda": cuántos deben y la deuda de dados de baja APARTE (T9 —
 * nunca sumada a la de activos). "Deuda total" ya se muestra arriba, en
 * `MoneyHeadline`/`MoneySummaryStrip` — no se repite acá (mismo motivo que
 * `MonthDetailRows`).
 */
export function DebtDetailRows({ summary }: { summary: DashboardSummary }) {
  return (
    <DataRowGroup>
      <DataRow label="Socios que deben" value={summary.membersInDebt} href="/cobranza/deuda" />
      <DataRow
        label="Deuda de socios dados de baja"
        sublabel="Aparte de la deuda de activos"
        value={<Amount cents={summary.inactiveDebtCents} />}
        tone={summary.inactiveDebtCents > 0 ? 'debt' : undefined}
        href="/cobranza/deuda?estado=inactive"
      />
    </DataRowGroup>
  )
}
