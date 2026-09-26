import { ClubMark } from '@/views/shell/club-mark'

/**
 * Envoltorio de `/login` y `/cambiar-contrasena`: identidad del club visible
 * pero sin vitrina (route-login.md), sin el `AppShell` del panel — ni
 * siquiera cuando `/cambiar-contrasena` es voluntario, para no repetir la
 * navegación mientras se corta el flujo de contraseña.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-2">
        <ClubMark size="lg" />
        <span className="font-heading text-sm font-semibold text-muted-foreground">Naranja y Blanco</span>
      </div>
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">{children}</div>
    </main>
  )
}
