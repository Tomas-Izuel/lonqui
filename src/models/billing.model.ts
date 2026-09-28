import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { DomainError, PermissionError } from '@/lib/errors'
import { formatPeriod, toPeriod } from '@/lib/dates'
import { getSettings } from './settings.model'
import type { BillingRun, BillingRunStatus, BillingRunTrigger, BillingStatus } from './types'

/**
 * Estado de la facturación, corridas de generación (`billing_runs`, T1) y
 * activación (D18). El generador y sus invariantes viven en Postgres
 * (`private.generate_pending_fees`, `settings_billing_guard`,
 * `00-architecture.md` §6.4/§6.5 del pipeline `2026-09-27-cuotas-pagos-panel`):
 * acá solo se lee y se traduce.
 */

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

const RUN_COLUMNS = 'id, period, trigger, actor_id, started_at, finished_at, status, fees_created, error_message'

type BillingRunRow = {
  id: number
  period: string
  trigger: string
  actor_id: string | null
  started_at: string
  finished_at: string | null
  status: string
  fees_created: number
  error_message: string | null
}

// -----------------------------------------------------------------------------
// Nombre del actor de una corrida
//
// `billing_runs.actor_id` no tiene FK a `app_users` (una corrida del cron no
// tiene actor: queda null), así que no hay embed de PostgREST posible. Se
// resuelve con una consulta propia — el mismo patrón que
// `audit.model.ts:resolveActorNames` — para no acoplar este archivo al de
// otro slice en paralelo.
// -----------------------------------------------------------------------------

async function resolveActorNames(supabase: SupabaseClient, actorIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(actorIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase.from('app_users').select('user_id, display_name').in('user_id', ids)
  if (error) throw error

  return new Map((data ?? []).map((row) => [row.user_id, row.display_name]))
}

function toBillingRun(row: BillingRunRow, actorNames: Map<string, string>): BillingRun {
  return {
    id: row.id,
    period: row.period,
    trigger: row.trigger as BillingRunTrigger,
    actorName: row.actor_id ? (actorNames.get(row.actor_id) ?? null) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as BillingRunStatus,
    feesCreated: row.fees_created,
    errorMessage: row.error_message,
  }
}

/**
 * Las últimas `limit` corridas, la más nueva primero. Vacío si RLS no deja
 * leer `billing_runs` (la policy es `can('billing.configure')`, solo admin):
 * no es un error, es la fila que la SELECT no puede ver.
 */
export async function listBillingRuns(limit = 10): Promise<BillingRun[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billing_runs')
    .select(RUN_COLUMNS)
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
    .overrideTypes<BillingRunRow[], { merge: false }>()

  if (error) throw error

  const actorNames = await resolveActorNames(
    supabase,
    data.map((row) => row.actor_id),
  )
  return data.map((row) => toBillingRun(row, actorNames))
}

type DashboardBillingRow = {
  active_members: number
  pending_periods: string[]
}

/**
 * Estado de la facturación para el panel, `/ajustes` y la ficha del socio.
 * No exige permiso (la usan `/socios`, `/cobranza` y el panel inicial, para
 * cualquier rol): `billing_runs` solo lo puede leer quien tiene
 * `billing.configure` (RLS), así que acá se pregunta primero con
 * `my_permissions()` en vez de asumir "no hay filas = no corrió" — eso
 * confundiría "no tiene permiso para ver corridas" con "faltó la corrida del
 * mes". Quien no puede ver corridas nunca recibe `failed`/`missing`: no
 * podría reintentar de todos modos, así que mostrarle el aviso sería un
 * callejón sin salida.
 */
export async function getBillingStatus(): Promise<BillingStatus> {
  const supabase = await createClient()
  const currentPeriod = toPeriod()

  const [settings, lastFeeResult, summaryResult, permissionsResult] = await Promise.all([
    getSettings(),
    supabase
      .from('fees')
      .select('period')
      .eq('kind', 'monthly')
      .order('period', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc('dashboard_summary').single().overrideTypes<DashboardBillingRow, { merge: false }>(),
    supabase.rpc('my_permissions'),
  ])

  if (lastFeeResult.error) throw lastFeeResult.error
  if (summaryResult.error) throw summaryResult.error

  const active = settings.billingStartPeriod !== null
  const notDue = !active || settings.billingStartPeriod! > currentPeriod

  const permissions = !permissionsResult.error && Array.isArray(permissionsResult.data) ? permissionsResult.data : []
  const canSeeRuns = permissions.includes('billing.configure')

  let currentPeriodRun: BillingStatus['currentPeriodRun'] = notDue ? 'not_due' : 'ok'
  let lastRun: BillingRun | null = null
  let recentRuns: BillingRun[] = []

  if (canSeeRuns) {
    const [currentRunResult, recent] = await Promise.all([
      supabase
        .from('billing_runs')
        .select(RUN_COLUMNS)
        .eq('period', currentPeriod)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .overrideTypes<BillingRunRow, { merge: false }>(),
      listBillingRuns(10),
    ])

    if (currentRunResult.error) throw currentRunResult.error

    recentRuns = recent
    lastRun = recentRuns[0] ?? null

    if (!notDue) {
      const row = currentRunResult.data
      currentPeriodRun = !row ? 'missing' : row.status === 'error' ? 'failed' : 'ok'
    }
  }

  return {
    active,
    startPeriod: settings.billingStartPeriod,
    currentPeriod,
    lastGeneratedPeriod: lastFeeResult.data?.period ?? null,
    pendingPeriods: summaryResult.data?.pending_periods ?? [],
    activeMembers: summaryResult.data?.active_members ?? 0,
    currentPeriodRun,
    lastRun,
    recentRuns,
  }
}

// -----------------------------------------------------------------------------
// Activación y generación (D18, T1)
// -----------------------------------------------------------------------------

/**
 * Traduce los cuatro rechazos de `settings_billing_guard` (§6.5, todos
 * `check_violation`: no se puede desactivar, no se puede cambiar con cuotas
 * ya generadas, el mes no puede ser pasado, falta el valor por defecto). El
 * mensaje ya está pensado para el usuario, se envuelve tal cual. El
 * `insufficient_privilege` del propio trigger es defensivo: la action ya
 * exige `billing.configure` antes de llegar acá.
 */
function translateSettingsBillingError(error: PostgrestError): unknown {
  if (error.code === '23514') {
    return new DomainError(error.message, { field: 'startPeriod' })
  }
  if (error.code === '42501') {
    return new PermissionError()
  }
  return error
}

/**
 * Corre `generate_pending_fees()`. La RPC NO relanza sus errores —relanzar
 * revertiría la fila de `billing_runs` que registra la falla—: devuelve
 * `(status, fees_created, error_message)` y acá se traduce.
 * `error` (algo falló a mitad de una corrida) y `skipped` (facturación
 * inactiva, o el mes de inicio todavía no llegó) llegan como `DomainError`
 * con el mensaje ya registrado; `ok` devuelve la cantidad creada.
 */
export async function generatePendingFees(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('generate_pending_fees')

  if (error) {
    // Defensivo: la action ya exige `billing.configure` antes de llamar acá.
    throw error.code === '42501' ? new PermissionError() : error
  }

  const row = data?.[0]
  if (!row) throw new Error('generate_pending_fees no devolvió resultado')
  if (row.status === 'ok') return row.fees_created

  throw new DomainError(row.error_message ?? 'No se pudieron generar las cuotas')
}

/**
 * La activación (`UPDATE settings`) y la generación (`generate_pending_fees`)
 * son dos round-trips separados: si el primero ya se aplicó y el segundo
 * falla, la excepción tiene que decir las dos cosas (03-review.md, MINOR 3).
 * `billing.actions.ts` la distingue de cualquier otro `DomainError` para
 * revalidar igual — la activación en sí SÍ quedó hecha, aunque la action la
 * reporte como `ok: false`.
 */
export class PartialBillingActivationError extends DomainError {}

/**
 * Activa la facturación desde `startPeriod` (D18): `UPDATE settings`, que el
 * trigger valida contra las cuatro condiciones de §6.5. Si `startPeriod` es
 * el mes actual, genera de una las cuotas pendientes; si es futuro, las
 * genera el cron el día 1 (o un admin con "Generar cuotas ahora" antes).
 */
export async function activateBilling(startPeriod: string): Promise<{ generated: number }> {
  const supabase = await createClient()
  const { error } = await supabase.from('settings').update({ billing_start_period: startPeriod }).eq('id', 1)

  if (error) throw translateSettingsBillingError(error)

  const currentPeriod = toPeriod()
  if (startPeriod > currentPeriod) return { generated: 0 }

  try {
    const generated = await generatePendingFees()
    return { generated }
  } catch (err) {
    const reason = err instanceof DomainError ? err.message : 'No se pudieron generar las cuotas'
    throw new PartialBillingActivationError(
      `La facturación quedó activada desde ${formatPeriod(startPeriod)}, pero la generación de cuotas falló: ${reason}. Reintentá desde Ajustes.`,
    )
  }
}
