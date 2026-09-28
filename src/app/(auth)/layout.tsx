import { ClubMark } from '@/views/shell/club-mark'
import { AuthCard } from '@/views/auth/auth-card'

/**
 * Envoltorio de `/login` y `/cambiar-contrasena`: identidad del club con
 * presencia real (pipeline 2026-09-28-ui-expresiva, F-polish — feedback de
 * Tomás: "poco atractiva"), sin el `AppShell` del panel — ni siquiera cuando
 * `/cambiar-contrasena` es voluntario, para no repetir la navegación mientras
 * se corta el flujo de contraseña.
 *
 * Composición vara Mercado Pago: una banda de `bg-brand-soft` (naranja al 7%,
 * el único lugar donde ese tono admite texto — DESIGN.md) sostiene el escudo
 * agrandado y el nombre del club; la tarjeta blanca de contenido se monta
 * encima con `shadow-lifted`, nunca anidada — son dos superficies hermanas,
 * no un panel dentro de otro. El naranja institucional en sí (`--brand`, vía
 * `ClubMark`) sigue viviendo solo en el escudo, como manda "La Regla del
 * Naranja Mudo".
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-8 sm:py-12">
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-brand-soft px-6 pt-10 pb-14 text-center">
          <ClubMark size="lg" className="size-16 text-2xl" />
          <div className="flex flex-col gap-0.5">
            <p className="font-heading text-lg font-semibold text-balance">Naranja y Blanco</p>
            <p className="text-sm text-muted-foreground">Club Social y Deportivo</p>
          </div>
        </div>
        <AuthCard>{children}</AuthCard>
      </div>
    </main>
  )
}
