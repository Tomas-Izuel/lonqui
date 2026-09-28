import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MemberStatusPill } from '@/views/shared/status-pill'
import { Dni } from '@/views/shared/dni'
import { DateText, DateTimeText } from '@/views/shared/date-text'
import { WhatsAppLink } from '@/views/shared/whatsapp-link'
import { memberStatusEventLabels } from '@/views/shared/labels'
import { categoriesLabel } from '@/views/payments/account-format'
import { FamilyGroupSection } from '@/views/members/family-group-section'
import { MedicalClearanceSection } from '@/views/members/medical-clearance-section'
import { MemberStatusActions } from '@/views/members/member-status-actions'
import { MemberCategoriesSection } from '@/views/members/member-categories-section'
import { MemberAccountSection } from '@/views/members/member-account-section'
import { MemberPeriodStrip } from '@/views/members/member-period-strip'
import { MemberFeeStatement } from '@/views/members/member-fee-statement'
import { MemberPaymentsList } from '@/views/members/member-payments-list'
import type { DisciplineWithCategories, MemberPageData, Permission } from '@/models/types'

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

/**
 * Ficha del socio (route-socios-id.md + Revisión 3 §13.6). Server Component:
 * cero data fetching, todo llega de `getMemberPage` (controller) vía
 * `page.tsx`. Las piezas interactivas (deportes, cuenta, cuotas, pagos,
 * responsable de pago, apto físico, baja/reactivación) son Client Components
 * chicos — nunca toda la página.
 *
 * `permissions`, nunca un rol (T12, CLAUDE.md): qué se muestra lo decide el
 * catálogo de permisos de la sesión, no `session.role`.
 */
export function MemberDetailView({
  data,
  disciplines,
  permissions,
}: {
  data: MemberPageData
  disciplines: DisciplineWithCategories[]
  permissions: Permission[]
}) {
  const { member, account, billing } = data
  const canEdit = permissions.includes('members.write')
  const canManageStatus = permissions.includes('members.status')
  const canRegisterPayments = permissions.includes('payments.register')
  const canVoid = permissions.includes('payments.void')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-xl font-semibold text-balance sm:text-2xl">{member.fullName}</h1>
            <MemberStatusPill status={member.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {categoriesLabel(member.categories)}
            {member.age != null ? ` · ${member.age} años${member.isMinor ? ' · menor' : ''}` : ''}
          </p>
        </div>
        {/*
          Compactas y secundarias a propósito (screenshot review, ronda 2):
          antes competían visualmente con la cuenta de abajo, que es la
          verdadera respuesta de la página. `size="sm"` sigue dando 44px de
          alto (piso de calidad, ver el comentario de `buttonVariants` en
          `components/ui/button.tsx`) con menos padding y texto más chico —
          "más chico" nunca es "menos tocable" acá.
        */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/socios/${member.id}/editar`}>
                <Pencil aria-hidden />
                Editar
              </Link>
            </Button>
          ) : null}
          {canManageStatus ? <MemberStatusActions memberId={member.id} status={member.status} /> : null}
        </div>
      </div>

      {account ? (
        <MemberAccountSection
          memberId={member.id}
          familyGroupId={member.familyGroupId}
          account={account.account}
          openingBalance={account.openingBalance}
          billing={billing}
          canRegister={canRegisterPayments}
        />
      ) : null}

      {/*
        Reorganización en pestañas (pipeline 2026-09-28-ui-expresiva,
        addendum): antes eran 8 paneles apilados de igual peso debajo de la
        cuenta; ahora se agrupan en 3 pestañas SIN envolver ninguna en un
        `Panel` nuevo — cada tab contiene los mismos `Panel`s hermanos de
        siempre, nunca uno anidado dentro de otro. El foco de teclado al
        cambiar de tab aterriza en el contenido (Radix da `tabIndex={0}` al
        panel activo por default, WAI-ARIA Tabs pattern): no hace falta
        manejarlo a mano.
      */}
      <Tabs defaultValue="datos">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="datos">Datos</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
          <TabsTrigger value="historia">Historia</TabsTrigger>
        </TabsList>

        <TabsContent value="datos" className="mt-4 flex flex-col gap-4">
          <Panel title="Datos personales">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InfoField label="DNI">
                <Dni dni={member.dni} />
              </InfoField>
              <InfoField label="Fecha de nacimiento">{member.birthDate ? <DateText date={member.birthDate} /> : '—'}</InfoField>
              <InfoField label="Domicilio">{member.address ?? '—'}</InfoField>
              <InfoField label="Teléfono">{member.phone ?? '—'}</InfoField>
              <InfoField label="Email">{member.email ?? '—'}</InfoField>
              <InfoField label="Alta">
                <DateText date={member.joinedOn} />
              </InfoField>
            </dl>
            {member.phone ? <WhatsAppLink phone={member.phone} className="mt-4" /> : null}
          </Panel>

          <FamilyGroupSection familyGroup={member.familyGroup} currentMemberId={member.id} canManage={canEdit} />

          <MedicalClearanceSection
            memberId={member.id}
            status={member.medicalClearanceStatus}
            currentClearance={member.currentMedicalClearance}
            canManage={canEdit}
          />

          <MemberCategoriesSection
            memberId={member.id}
            categoryHistory={member.categoryHistory}
            disciplines={disciplines}
            canManage={canEdit}
          />
        </TabsContent>

        <TabsContent value="movimientos" className="mt-4 flex flex-col gap-4">
          {account ? (
            <>
              <MemberPeriodStrip statement={account.statement} currentPeriod={billing.currentPeriod} />
              <MemberFeeStatement statement={account.statement} canVoid={canVoid} />
              <MemberPaymentsList payments={account.payments} canVoid={canVoid} />
            </>
          ) : (
            <Panel title="Movimientos">
              <p className="text-sm text-muted-foreground">No tenés permiso para ver la cuenta de este socio.</p>
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="historia" className="mt-4">
          <Panel title="Historia">
            {member.statusHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin eventos registrados.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {[...member.statusHistory].reverse().map((event) => (
                  <li key={event.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{memberStatusEventLabels[event.eventType]}</span>
                      <span className="text-sm text-muted-foreground">
                        <DateText date={event.effectiveOn} />
                      </span>
                    </div>
                    <p className="text-sm">{event.reason}</p>
                    {event.notes ? <p className="text-sm text-muted-foreground">{event.notes}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {event.createdByName ? `${event.createdByName} · ` : ''}
                      <DateTimeText instant={event.createdAt} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  )
}
