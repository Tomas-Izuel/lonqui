import type { Metadata } from 'next'
import { requirePanelPermission } from '@/controllers/session.controller'
import { getOtherIncomePage } from '@/controllers/income.controller'
import { toPeriod } from '@/lib/dates'
import { OtherIncomeView } from '@/views/income/other-income-view'

export const metadata: Metadata = { title: 'Otros ingresos — Lonqui' }

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** Id positivo o `undefined`: un `?concepto=basura` no rompe la página, solo se ignora. */
function parseId(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/**
 * `/caja/ingresos?mes=YYYY-MM&concepto=<id>&sponsor=<id>`. `getOtherIncomePage`
 * tira `DomainError` con un período inválido: se sanea acá antes de llamarlo.
 */
export default async function OtherIncomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const session = await requirePanelPermission('income.read')

  const mesRaw = firstValue(sp.mes)
  const period = mesRaw && PERIOD_RE.test(mesRaw) ? `${mesRaw}-01` : toPeriod()
  const conceptId = parseId(firstValue(sp.concepto))
  const sponsorId = parseId(firstValue(sp.sponsor))

  const data = await getOtherIncomePage({ period, conceptId, sponsorId })

  return (
    <OtherIncomeView
      period={period}
      movements={data.movements}
      summary={data.summary}
      concepts={data.concepts}
      sponsors={data.sponsors}
      truncated={data.truncated}
      conceptId={conceptId}
      sponsorId={sponsorId}
      canVoid={session.permissions.includes('income.void')}
      canExport={session.permissions.includes('reports.export')}
      canEditConcepts={session.permissions.includes('settings.manage')}
    />
  )
}
