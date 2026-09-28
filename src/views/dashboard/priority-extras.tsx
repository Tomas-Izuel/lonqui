import { Amount } from '@/views/shared/money'
import { DataRow, DataRowGroup } from '@/views/dashboard/data-row'
import type { DashboardSummary } from '@/models/types'

/**
 * El resto de "qué hay que resolver" (variante B), además de los atrasados
 * y el aviso de generación fallida: deuda de socios dados de baja y aptos
 * físicos vencidos — los dos ejemplos que dio el coordinador junto con
 * "a quién llamar" y "generación fallida". Null cuando no hay nada
 * pendiente de este tipo (nunca una fila en cero anunciando "0 problemas").
 */
export function PriorityExtras({ summary }: { summary: DashboardSummary }) {
  const items: { key: string; label: string; sublabel?: string; value: React.ReactNode; href: string }[] = []

  if (summary.inactiveDebtCents > 0) {
    items.push({
      key: 'inactive-debt',
      label: 'Deuda de socios dados de baja',
      sublabel: 'Aparte de la deuda de activos',
      value: <Amount cents={summary.inactiveDebtCents} />,
      href: '/cobranza/deuda?estado=inactive',
    })
  }

  if (summary.expiredClearances > 0) {
    items.push({
      key: 'expired-clearances',
      label: 'Aptos físicos vencidos',
      value: summary.expiredClearances,
      href: '/socios',
    })
  }

  if (items.length === 0) return null

  return (
    <DataRowGroup>
      {items.map((item) => (
        <DataRow key={item.key} label={item.label} sublabel={item.sublabel} value={item.value} tone="debt" href={item.href} />
      ))}
    </DataRowGroup>
  )
}
