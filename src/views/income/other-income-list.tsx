'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DataList, type DataListColumn, type DataListRow } from '@/views/shared/data-list'
import { EmptyState } from '@/views/shared/states'
import { Amount } from '@/views/shared/money'
import { DateText } from '@/views/shared/date-text'
import { ReasonDialog, type ReasonDialogResult, type ReasonDialogValues } from '@/views/shared/reason-dialog'
import { paymentMethodLabels } from '@/views/shared/labels'
import { RegisterIncomeButton } from '@/views/income/register-income-button'
import { useCashReceipt } from '@/views/income/use-cash-receipt'
import { voidCashMovement } from '@/controllers/income.actions'
import type { CashMovement } from '@/models/types'

/**
 * Lista de ingresos (de un mes en `/caja/ingresos`, de un sponsor en su
 * ficha). Cero fetch de lectura: las filas llegan como prop y la acción de
 * anular revalida la ruta. "Ver comprobante" firma la URL al tocar;
 * "Anular ingreso" solo con `canVoid` (`income.void`, UX — la defensa real es
 * la RLS). Un ingreso anulado se ve tachado, con su motivo; nunca se borra.
 */
export function OtherIncomeList({
  movements,
  canVoid,
  showSponsor = true,
  emptyTitle = 'Todavía no se registraron otros ingresos',
  emptyDescription,
  emptyAction,
}: {
  movements: CashMovement[]
  canVoid: boolean
  /** En la ficha de un sponsor la columna sobra: todos son del mismo. */
  showSponsor?: boolean
  emptyTitle?: string
  emptyDescription?: string
  /** `null` = sin botón (la ficha de un sponsor ya tiene el suyo arriba). */
  emptyAction?: React.ReactNode
}) {
  const [voidTarget, setVoidTarget] = useState<CashMovement | null>(null)
  const receipt = useCashReceipt()

  async function handleVoidConfirm(values: ReasonDialogValues): Promise<ReasonDialogResult> {
    if (!voidTarget) return { ok: false, error: 'No encontramos el ingreso' }
    const result = await voidCashMovement({ movementId: voidTarget.id, reason: values.reason })
    if (!result.ok) return { ok: false, error: result.error, field: result.field }
    toast.success('Ingreso anulado')
    return { ok: true }
  }

  const struck = (movement: CashMovement) => (movement.voided ? 'text-muted-foreground line-through' : undefined)

  const columns: DataListColumn<CashMovement>[] = [
    { key: 'date', header: 'Fecha', render: (m) => <DateText date={m.occurredOn} className={struck(m)} /> },
    {
      key: 'concept',
      header: 'Concepto',
      render: (m) => <span className={struck(m)}>{m.conceptName}</span>,
    },
    ...(showSponsor
      ? [
          {
            key: 'sponsor',
            header: 'Sponsor o detalle',
            render: (m: CashMovement) => (
              <div className="flex max-w-64 flex-col">
                {m.sponsorName ? <span className={struck(m)}>{m.sponsorName}</span> : null}
                {m.description ? <span className="truncate text-xs text-muted-foreground">{m.description}</span> : null}
                {m.voided ? <s className="text-xs text-muted-foreground">Anulado{m.voidReason ? `: ${m.voidReason}` : ''}</s> : null}
              </div>
            ),
          } satisfies DataListColumn<CashMovement>,
        ]
      : [
          {
            key: 'detail',
            header: 'Detalle',
            render: (m: CashMovement) => (
              <div className="flex max-w-64 flex-col">
                {m.description ? <span className="truncate text-xs text-muted-foreground">{m.description}</span> : null}
                {m.voided ? <s className="text-xs text-muted-foreground">Anulado{m.voidReason ? `: ${m.voidReason}` : ''}</s> : null}
              </div>
            ),
          } satisfies DataListColumn<CashMovement>,
        ]),
    { key: 'amount', header: 'Monto', numeric: true, render: (m) => <Amount cents={m.amountCents} className={struck(m)} /> },
    { key: 'method', header: 'Medio', render: (m) => paymentMethodLabels[m.method] },
    { key: 'createdBy', header: 'Cargó', render: (m) => m.createdByName ?? '—' },
    {
      key: 'actions',
      header: 'Acciones',
      className: 'w-24 text-right',
      render: (m) => renderMenu(m),
    },
  ]

  function renderMenu(movement: CashMovement) {
    const canVoidThis = canVoid && !movement.voided
    if (!movement.hasReceipt && !canVoidThis) return null
    const opening = receipt.openingId === movement.id
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="size-11"
            aria-label={`Más acciones del ingreso de ${movement.conceptName}`}
            disabled={opening}
          >
            {opening ? <Loader2 aria-hidden className="animate-spin" /> : <MoreVertical aria-hidden />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {movement.hasReceipt ? (
            <DropdownMenuItem onSelect={() => void receipt.open(movement.id)}>Ver comprobante</DropdownMenuItem>
          ) : null}
          {canVoidThis ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setVoidTarget(movement)}>
              Anular ingreso
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderRow(movement: CashMovement): DataListRow {
    return {
      title: <span className={struck(movement)}>{movement.sponsorName && showSponsor ? `${movement.conceptName} · ${movement.sponsorName}` : movement.conceptName}</span>,
      subtitle: (
        <span className="flex flex-wrap items-center gap-2">
          <DateText date={movement.occurredOn} />
          <span>{paymentMethodLabels[movement.method]}</span>
        </span>
      ),
      meta: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <Amount cents={movement.amountCents} className={movement.voided ? 'text-muted-foreground line-through' : 'font-medium'} />
          {movement.voided ? (
            <s className="text-xs text-muted-foreground">Anulado{movement.voidReason ? `: ${movement.voidReason}` : ''}</s>
          ) : null}
          {movement.description ? <span className="basis-full text-xs text-muted-foreground">{movement.description}</span> : null}
        </span>
      ),
      actions: renderMenu(movement),
    }
  }

  return (
    <>
      <DataList
        items={movements}
        getKey={(m) => m.id}
        columns={columns}
        renderRow={renderRow}
        emptyState={
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction === undefined ? <RegisterIncomeButton variant="outline" /> : emptyAction}
          />
        }
      />

      {voidTarget ? (
        <ReasonDialog
          open={Boolean(voidTarget)}
          onOpenChange={(open) => {
            if (!open) setVoidTarget(null)
          }}
          title={`Anular el ingreso de ${voidTarget.conceptName}`}
          consequence="Deja de contar en lo ingresado del mes. Queda registrado, tachado, con el motivo."
          actionLabel="Anular ingreso"
          showDate={false}
          onConfirm={handleVoidConfirm}
        />
      ) : null}
    </>
  )
}
