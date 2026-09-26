'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

/**
 * Boundary de error de la ruta (App Router), Client Component obligatorio de
 * Next: no puede importar `@/lib/log` (`server-only`). El error de servidor ya
 * quedó logueado del lado del servidor antes de llegar acá (Next lo hace
 * automático); `error` nunca se muestra tal cual al usuario (podría traer
 * detalle de Postgres). "Reintentar" con `reset()` vuelve a montar la page y
 * reintenta `getSettingsPage()`.
 */
export default function AjustesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="No pudimos cargar los ajustes"
      description="Puede ser un problema de conexión. Probá de nuevo en un momento."
      action={<Button onClick={reset}>Reintentar</Button>}
    />
  )
}
