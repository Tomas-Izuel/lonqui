import Link from 'next/link'
import { ChevronLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CajaTabs } from '@/views/payments/caja-tabs'
import { Panel } from '@/views/shared/panel'
import { StatusPill } from '@/views/shared/status-pill'
import { Amount } from '@/views/shared/money'
import { DateText } from '@/views/shared/date-text'
import { WhatsAppLink } from '@/views/shared/whatsapp-link'
import { OtherIncomeList } from '@/views/income/other-income-list'
import { SponsorActions } from '@/views/income/sponsor-actions'
import type { SponsorDetail } from '@/models/types'

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * `/caja/sponsors/[id]`: la respuesta a "¿cuánto aportó este sponsor este
 * año?" en un toque. Las cifras vienen de la base (`sponsor_summaries`). El
 * contacto no viaja en la URL ni en el título de la página.
 */
export function SponsorDetailView({
  detail,
  canVoid,
}: {
  detail: SponsorDetail
  /** `income.void`: en el historial también se puede anular un aporte mal cargado. */
  canVoid: boolean
}) {
  const { sponsor, movements } = detail
  const hasContact = Boolean(sponsor.contactName || sponsor.phone || sponsor.email || sponsor.notes)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2 min-h-11 w-fit">
          <Link href="/caja/sponsors">
            <ChevronLeft aria-hidden />
            Sponsors
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-balance sm:text-2xl">{sponsor.name}</h1>
          {sponsor.isActive ? null : <StatusPill variant="member-inactive">Desactivado</StatusPill>}
        </div>
        {sponsor.isActive ? null : (
          <p className="text-sm text-muted-foreground">
            {sponsor.deactivatedAt ? <>Desactivado el <DateText date={sponsor.deactivatedAt.slice(0, 10)} />. </> : null}
            {sponsor.deactivationReason ? `Motivo: ${sponsor.deactivationReason}` : null}
          </p>
        )}
      </div>

      <CajaTabs />

      <SponsorActions sponsor={sponsor} />

      <Panel title="Aportes">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <Stat label="Aportado este año">
            <Amount cents={sponsor.yearTotalCents} className="text-lg" />
          </Stat>
          <Stat label="Total histórico">
            <Amount cents={sponsor.allTimeTotalCents} />
          </Stat>
          <Stat label="Último aporte">
            {sponsor.lastContributionOn ? (
              <span className="flex flex-col">
                <DateText date={sponsor.lastContributionOn} />
                {sponsor.lastContributionCents != null ? (
                  <Amount cents={sponsor.lastContributionCents} className="text-sm text-muted-foreground" />
                ) : null}
              </span>
            ) : (
              <span className="text-muted-foreground">Todavía no aportó</span>
            )}
          </Stat>
          <Stat label="Cantidad de aportes">{sponsor.contributionsCount}</Stat>
        </dl>
      </Panel>

      <Panel title="Contacto">
        {hasContact ? (
          <div className="flex flex-col gap-3">
            {sponsor.contactName ? <p className="font-medium">{sponsor.contactName}</p> : null}
            {sponsor.phone || sponsor.email ? (
              <div className="flex flex-wrap items-center gap-2">
                {sponsor.phone ? <WhatsAppLink phone={sponsor.phone} className="h-11" label={`WhatsApp ${sponsor.phone}`} /> : null}
                {sponsor.email ? (
                  <Button asChild variant="outline" className="h-11 min-w-0">
                    <a href={`mailto:${sponsor.email}`}>
                      <Mail aria-hidden />
                      <span className="truncate">{sponsor.email}</span>
                    </a>
                  </Button>
                ) : null}
              </div>
            ) : null}
            {sponsor.notes ? <p className="text-sm whitespace-pre-line text-muted-foreground">{sponsor.notes}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no hay datos de contacto. Podés cargarlos con “Editar”.</p>
        )}
      </Panel>

      <h2 className="font-heading text-base font-semibold">Historial de aportes</h2>
      <OtherIncomeList
        movements={movements}
        canVoid={canVoid}
        showSponsor={false}
        emptyTitle="Este sponsor todavía no tiene aportes"
        emptyDescription="Cuando se registre un ingreso de este sponsor, aparece acá con su comprobante."
        emptyAction={null}
      />
    </div>
  )
}
