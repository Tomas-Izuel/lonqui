import 'server-only'

import { z } from 'zod'
import { requirePanelPermission, requirePermission } from '@/controllers/session.controller'
import { toCsv, type CsvCell } from '@/lib/csv'
import { DomainError, zodToApiError } from '@/lib/errors'
import {
  CASH_MOVEMENTS_LIST_LIMIT,
  listAllCashMovements,
  listCashMovements,
  listCashMovementsSchema,
  listSponsorMovements,
} from '@/models/cash-movements.model'
import { listCashConcepts } from '@/models/cash-concepts.model'
import { logExport } from '@/models/exports.model'
import { getCashMonthSummary } from '@/models/reports.model'
import { getSponsorSummary, listSponsorOptions, listSponsorSummaries } from '@/models/sponsors.model'
import type {
  CashConcept,
  CashMonthSummary,
  CashMovement,
  CashMovementFilters,
  SponsorDetail,
  SponsorOption,
  SponsorSummary,
} from '@/models/types'

/**
 * Lecturas de otros ingresos y sponsors (`/caja/ingresos`, `/caja/sponsors`) y la
 * exportación a CSV. Las escrituras están en `income.actions.ts` y
 * `sponsors.actions.ts`.
 */

export type OtherIncomePageData = {
  movements: CashMovement[]
  summary: CashMonthSummary
  concepts: CashConcept[]
  sponsors: SponsorOption[]
  /** Llegaron 500: hay más ingresos que los que se muestran (la vista lo avisa). */
  truncated: boolean
}

export async function getOtherIncomePage(filters: CashMovementFilters): Promise<OtherIncomePageData> {
  // El resumen del mes incluye la cobranza de cuotas: por eso también payments.read.
  await requirePanelPermission('income.read', 'payments.read')

  const parsed = listCashMovementsSchema.safeParse(filters)
  if (!parsed.success) throw new DomainError('El período no es válido')

  const [movements, summary, concepts, sponsors] = await Promise.all([
    listCashMovements(parsed.data),
    getCashMonthSummary(parsed.data.period),
    // Con inactivos: los filtros tienen que poder elegir un concepto o sponsor ya desactivado.
    listCashConcepts({ includeInactive: true }),
    listSponsorOptions({ includeInactive: true }),
  ])

  // El modelo pide uno de más: solo hay truncado si llegó más que el techo.
  const truncated = movements.length > CASH_MOVEMENTS_LIST_LIMIT

  return {
    movements: truncated ? movements.slice(0, CASH_MOVEMENTS_LIST_LIMIT) : movements,
    summary,
    concepts,
    sponsors,
    truncated,
  }
}

export async function getSponsorsPage(): Promise<SponsorSummary[]> {
  await requirePanelPermission('income.read')
  return listSponsorSummaries()
}

export async function getSponsorDetailPage(sponsorId: number): Promise<SponsorDetail | null> {
  await requirePanelPermission('income.read')

  const [sponsor, movements] = await Promise.all([getSponsorSummary(sponsorId), listSponsorMovements(sponsorId)])
  return sponsor ? { sponsor, movements } : null
}

// -----------------------------------------------------------------------------
// Exportación
// -----------------------------------------------------------------------------

export const exportOtherIncomeSchema = z
  .object({
    mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El mes no es válido'),
    concepto: z.string().regex(/^\d{1,18}$/, 'El concepto no es válido').optional(),
    sponsor: z.string().regex(/^\d{1,18}$/, 'El sponsor no es válido').optional(),
  })
  .strict()

const HEADER = ['Fecha', 'Concepto', 'Sponsor', 'Detalle', 'Monto', 'Medio', 'Cargó', 'Estado', 'Motivo de anulación']

function formatDmy(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

/** Pesos sin separador de miles; con coma solo si los centavos no son redondos. */
function formatPesos(cents: number): CsvCell {
  return cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Texto libre que alguien tipeó (detalle, motivo, nombres): Excel lo
 * ejecutaría como fórmula si empieza con = + - @ (o tab / CR). Se neutraliza
 * con un apóstrofo, que Excel no muestra.
 */
function safeText(value: string | null): string {
  if (value === null) return ''
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/**
 * Tira (no redirige): lo consume un route handler, que traduce el error a
 * una respuesta HTTP. Audita ANTES de devolver el archivo: si `logExport`
 * falla, la exportación no sale.
 */
export async function exportOtherIncomeCsv(input: unknown): Promise<{ filename: string; body: string }> {
  await requirePermission('income.read', 'reports.export')

  const parsed = exportOtherIncomeSchema.safeParse(input)
  if (!parsed.success) {
    throw new DomainError(zodToApiError(parsed.error).body.error)
  }
  const { mes, concepto, sponsor } = parsed.data

  const movements = await listAllCashMovements({
    period: `${mes}-01`,
    ...(concepto !== undefined && { conceptId: Number(concepto) }),
    ...(sponsor !== undefined && { sponsorId: Number(sponsor) }),
  })

  await logExport('other_income', { mes, concepto, sponsor }, movements.length)

  const rows: CsvCell[][] = [
    HEADER,
    ...movements.map((m) => [
      formatDmy(m.occurredOn),
      safeText(m.conceptName),
      safeText(m.sponsorName),
      safeText(m.description),
      formatPesos(m.amountCents),
      m.method === 'cash' ? 'Efectivo' : 'Transferencia',
      safeText(m.createdByName),
      m.voided ? 'Anulado' : 'Vigente',
      safeText(m.voidReason),
    ]),
  ]

  return { filename: `otros-ingresos-${mes}.csv`, body: toCsv(rows) }
}
