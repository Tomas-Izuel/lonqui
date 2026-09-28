import { DataRow, DataRowGroup } from '@/views/dashboard/data-row'
import type { DashboardSummary } from '@/models/types'

/** Activos, altas (+ reactivaciones aparte, nunca sumadas — T9), bajas del mes. */
export function PadronHeadlineRows({ summary }: { summary: DashboardSummary }) {
  return (
    <DataRowGroup>
      <DataRow label="Socios activos" value={summary.activeMembers} href="/socios?status=active" />
      <DataRow
        label="Altas del mes"
        sublabel={summary.reactivationsCount > 0 ? `+${summary.reactivationsCount} reactivaciones` : undefined}
        value={summary.admissionsCount}
      />
      <DataRow label="Bajas del mes" value={summary.withdrawalsCount} />
    </DataRowGroup>
  )
}

/**
 * Aptos físicos: vencidos y faltantes. `/socios` sin filtro propio todavía
 * (dev log): `MemberFilters` (S3/F2, `socios/page.tsx`) no tiene un parámetro
 * de estado de apto físico, así que el link cae al padrón sin filtrar.
 */
export function MedicalClearanceRows({ summary }: { summary: DashboardSummary }) {
  return (
    <DataRowGroup>
      <DataRow
        label="Aptos físicos vencidos"
        value={summary.expiredClearances}
        tone={summary.expiredClearances > 0 ? 'debt' : undefined}
        href="/socios"
      />
      <DataRow
        label="Aptos físicos faltantes"
        value={summary.missingClearances}
        tone={summary.missingClearances > 0 ? 'debt' : undefined}
        href="/socios"
      />
    </DataRowGroup>
  )
}

/**
 * Deuda por categoría (D32/D14): ya no vive acá — pasó a
 * `<CategoryDebtChart rows={byCategory} variant="compact" />`
 * (`views/payments/category-debt-chart.tsx`, dueño: F-cobranza, contrato
 * C5). Reemplaza uno a uno la vieja `CategoryList`/`CategoryRow`: la barra
 * de magnitud detrás de cada fila hace legible de un vistazo "quién debe
 * más", cosa que una columna de números sueltos no lograba (queja de Tomás:
 * "todo números, ni un gráfico"). El corte a N filas + "Ver todas" ahora es
 * responsabilidad del propio componente (`limit`, default 6), no de quien
 * lo llama — ver `dashboard-content.tsx`.
 */
