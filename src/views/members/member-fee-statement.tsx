'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Panel } from '@/views/shared/panel'
import { PeriodText } from '@/views/shared/date-text'
import { Amount } from '@/views/shared/money'
import { ReasonDialog, type ReasonDialogResult, type ReasonDialogValues } from '@/views/shared/reason-dialog'
import { feeStatementStatusLabels } from '@/views/shared/labels'
import { formatPeriod } from '@/lib/dates'
import { voidFee } from '@/controllers/payments.actions'
import type { FeeStatementLine } from '@/models/types'

/**
 * "Fútbol masculino · 5ta" / "Cuota social" / "Saldo anterior · hasta agosto
 * 2026". Defensivo con `disciplineName` null (hoy `accounts.model.ts`
 * siempre lo devuelve así en el statement, aunque haya `categoryId` — B2, a
 * reportar: §13.5 pide que la línea traiga el nombre de la disciplina del
 * cargo): sin él, se muestra solo la categoría en vez de imprimir "null".
 */
function lineLabel(line: FeeStatementLine): string {
  if (line.kind === 'opening_balance') return `Saldo anterior · hasta ${formatPeriod(line.period)}`
  if (line.categoryId != null) return line.disciplineName ? `${line.disciplineName} · ${line.categoryName}` : (line.categoryName ?? 'Cuota')
  if (line.kind === 'adjustment') return line.description ?? 'Ajuste'
  return 'Cuota social'
}

const STATUS_TEXT_CLASS: Record<FeeStatementLine['status'], string> = {
  paid: 'text-status-up-to-date',
  partial: 'text-status-in-debt',
  due: 'text-status-in-debt',
  voided: 'text-muted-foreground',
}

/**
 * Panel "Cuotas" de la ficha (§13.6): una línea por cargo, con su deporte ·
 * categoría (o "Cuota social" / "Saldo anterior"), estado y "Anular" solo
 * con `payments.void`. Anuladas tachadas con motivo — nunca desaparecen.
 */
export function MemberFeeStatement({ statement, canVoid }: { statement: FeeStatementLine[]; canVoid: boolean }) {
  const router = useRouter()
  const [voidingId, setVoidingId] = useState<number | null>(null)

  async function handleVoidConfirm(feeId: number, values: ReasonDialogValues): Promise<ReasonDialogResult> {
    const result = await voidFee({ feeId, reason: values.reason })
    if (!result.ok) return { ok: false, error: result.error, field: result.field }
    toast.success('Cargo anulado')
    router.refresh()
    return { ok: true }
  }

  return (
    <Panel title="Cuotas">
      {statement.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay cargos generados.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {[...statement]
            .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0))
            .map((line) => (
              <li key={line.feeId} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {line.kind === 'monthly' ? <PeriodText period={line.period} className="font-medium" /> : null}
                    {line.voidedAt ? (
                      <s className="text-muted-foreground">{lineLabel(line)}</s>
                    ) : (
                      <span className={line.kind === 'monthly' ? undefined : 'font-medium'}>{lineLabel(line)}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {line.voidedAt ? (
                      <s className="text-muted-foreground">
                        <Amount cents={line.amountCents} />
                      </s>
                    ) : (
                      <Amount cents={line.amountCents} className="font-medium" />
                    )}
                    <span className={`text-sm ${STATUS_TEXT_CLASS[line.status]}`}>{feeStatementStatusLabels[line.status]}</span>
                    {canVoid && !line.voidedAt ? (
                      <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => setVoidingId(line.feeId)}>
                        Anular
                      </Button>
                    ) : null}
                  </div>
                </div>
                {line.voidedAt ? (
                  <p className="text-sm text-status-in-debt">Anulado{line.voidReason ? ` · ${line.voidReason}` : ''}</p>
                ) : null}
              </li>
            ))}
        </ul>
      )}

      {voidingId != null ? (
        <ReasonDialog
          open={voidingId != null}
          onOpenChange={(v) => !v && setVoidingId(null)}
          title="Anular cargo"
          consequence="El cargo deja de sumar a la deuda del socio. Queda registrado, tachado y con el motivo."
          actionLabel="Anular cargo"
          onConfirm={(values) => handleVoidConfirm(voidingId, values)}
        />
      ) : null}
    </Panel>
  )
}
