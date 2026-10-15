import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Enlace secundario "Editar …" desde un módulo hacia la pestaña de Ajustes
 * donde se configura el dato que la pantalla muestra. Texto con ícono, nunca
 * botón primario; 44px de alto para el pulgar. Quien lo monta decide la
 * visibilidad con `settings.manage` (UX: la defensa real es el guard de la
 * pestaña y RLS).
 */
export function EditInSettingsLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <Settings2 aria-hidden className="size-4" />
      {children}
    </Link>
  )
}
