'use client'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/views/shared/states'

/**
 * Cuerpo común de los `error.tsx` de cada pestaña de ajustes. `error` nunca se
 * muestra (podría traer detalle de Postgres); el de servidor ya quedó logueado.
 * "Reintentar" remonta la pestaña sin tocar el header ni la barra del layout.
 */
export function SettingsTabError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title="No pudimos cargar esta sección"
      description="Puede ser un problema de conexión. Probá de nuevo en un momento."
      action={<Button onClick={reset}>Reintentar</Button>}
    />
  )
}
