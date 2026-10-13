import { PageHeader } from '@/views/shared/page-header'
import { CajaTabs } from '@/views/payments/caja-tabs'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { EmptyState } from '@/views/shared/states'
import { StatusPill } from '@/views/shared/status-pill'
import { Amount } from '@/views/shared/money'
import { DateText } from '@/views/shared/date-text'
import { NewSponsorButton } from '@/views/income/new-sponsor-button'
import type { SponsorSummary } from '@/models/types'

/** Activos primero (por nombre, como los trae el controller); los desactivados al final. */
function activeFirst(sponsors: SponsorSummary[]): SponsorSummary[] {
  return [...sponsors.filter((s) => s.isActive), ...sponsors.filter((s) => !s.isActive)]
}

function lastContribution(sponsor: SponsorSummary): React.ReactNode {
  if (!sponsor.lastContributionOn) return <span className="text-muted-foreground">Sin aportes todavía</span>
  return (
    <span>
      <DateText date={sponsor.lastContributionOn} />
      {sponsor.lastContributionCents != null ? <> · <Amount cents={sponsor.lastContributionCents} /></> : null}
    </span>
  )
}

/**
 * `/caja/sponsors`: el catálogo con lo que aportó cada uno en el año
 * calendario (cifra de la base, no sumada acá). Tocar una fila abre su
 * historial. Un sponsor desactivado sigue en la lista, con su pill, para que
 * sus aportes viejos se puedan consultar.
 */
export function SponsorsView({ sponsors }: { sponsors: SponsorSummary[] }) {
  const items = activeFirst(sponsors)

  const columns: DataListColumn<SponsorSummary>[] = [
    {
      key: 'name',
      header: 'Sponsor',
      render: (s) => (
        <span className="flex items-center gap-2">
          <span className={s.isActive ? undefined : 'text-muted-foreground'}>{s.name}</span>
          {s.isActive ? null : <StatusPill variant="member-inactive">Desactivado</StatusPill>}
        </span>
      ),
    },
    { key: 'year', header: 'Aportado este año', numeric: true, render: (s) => <Amount cents={s.yearTotalCents} /> },
    { key: 'last', header: 'Último aporte', render: (s) => lastContribution(s) },
  ]

  function renderRow(sponsor: SponsorSummary): DataListRow {
    return {
      title: <span className={sponsor.isActive ? undefined : 'text-muted-foreground'}>{sponsor.name}</span>,
      subtitle: lastContribution(sponsor),
      meta: (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Este año: <Amount cents={sponsor.yearTotalCents} className="font-medium" />
          </span>
          {sponsor.isActive ? null : <StatusPill variant="member-inactive">Desactivado</StatusPill>}
        </span>
      ),
      href: `/caja/sponsors/${sponsor.id}`,
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sponsors"
        description="Quiénes aportaron al club y cuánto en el año."
      />
      <CajaTabs />
      {items.length > 0 ? (
        <div>
          <NewSponsorButton />
        </div>
      ) : null}
      <DataList
        items={items}
        getKey={(s) => s.id}
        columns={columns}
        renderRow={renderRow}
        emptyState={
          <EmptyState
            title="Todavía no hay sponsors cargados"
            description="Cargá un sponsor para ver cuánto aportó en el año. También podés agregarlo al registrar un ingreso."
            action={<NewSponsorButton />}
          />
        }
      />
    </div>
  )
}
