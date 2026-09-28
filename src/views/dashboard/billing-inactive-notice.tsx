import Link from 'next/link'
import { CircleDollarSign } from 'lucide-react'
import { EmptyState } from '@/views/shared/states'

/**
 * Estado "las cuotas todavía no están activadas" (route.md). Reemplaza el
 * panel de números por una explicación + acción para quien puede activar; el
 * resto de la Comisión solo ve la explicación (ocultar el botón es UX, no
 * seguridad: `activateBilling` vuelve a chequear `billing.configure`).
 */
export function BillingInactiveNotice({ canConfigure }: { canConfigure: boolean }) {
  return (
    <EmptyState
      title="Las cuotas todavía no están activadas"
      description={
        canConfigure
          ? 'Activalas desde Ajustes para que el sistema empiece a generar la cuota mensual y a calcular la deuda de cada socio.'
          : 'Un administrador tiene que activarlas desde Ajustes para que el sistema calcule la cuota y la deuda de cada socio.'
      }
      action={
        canConfigure ? (
          <Link
            href="/ajustes"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            <CircleDollarSign aria-hidden className="size-4" />
            Ir a Ajustes
          </Link>
        ) : undefined
      }
    />
  )
}
