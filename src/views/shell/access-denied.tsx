import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Rol sin permiso para una sección admin-only (`/usuarios`, `/ajustes`,
 * `/auditoria`). Se renderiza DENTRO del `AppShell`: el usuario tiene sesión
 * y rol, solo no el que hace falta acá — no es `notFound()` ni una API
 * experimental (D10).
 */
export function AccessDenied() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <ShieldAlert aria-hidden className="size-8 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">No tenés permiso para ver esto</p>
        <p className="text-sm text-muted-foreground">Esta sección es solo para administradores del club.</p>
      </div>
      <Button asChild variant="outline" className="mt-1">
        <Link href="/">Volver al inicio</Link>
      </Button>
    </div>
  )
}
